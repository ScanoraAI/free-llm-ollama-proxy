const express = require('express');
const axios = require('axios');

// Error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('[ERROR] Unhandled Rejection at:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[ERROR] Uncaught Exception:', err);
  process.exit(1);
});

const app = express();
app.use(express.json({limit: '1mb'}));

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'phi3';

// Health check - doesn't require Ollama connection
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    ollama_url: OLLAMA_URL, 
    default_model: DEFAULT_MODEL,
    node_version: process.version 
  });
});

// Models endpoint
app.get('/v1/models', async (req, res) => {
  try {
    const resp = await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 5000 });
    const models = resp.data.models?.map(m => ({
      id: m.name,
      object: 'model',
      owned_by: 'ollama'
    })) || [];
    res.json({ data: models });
  } catch (err) {
    res.status(502).json({ error: 'Failed to list models', detail: err.message });
  }
});

// Chat completions - proxy to Ollama
app.post('/v1/chat/completions', express.json({limit: '1mb'}), async (req, res) => {
  try {
    const { messages, model, max_tokens = 2048, temperature = 0.7 } = req.body;
    
    const ollamaPayload = {
      model: model || DEFAULT_MODEL,
      prompt: messages.map(m => `${m.role}: ${m.content}`).join('\n'),
      stream: false,
      options: {
        num_predict: Math.min(max_tokens, 2000),
        temperature: temperature,
        top_p: 0.9
      }
    };

    console.log(`[INFO] Proxying to Ollama: ${OLLAMA_URL}`);
    const response = await axios.post(`${OLLAMA_URL}/api/generate`, ollamaPayload, {
      timeout: 60000,
      maxContentLength: 10 * 1024 * 1024,
    });

    res.json({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: ollamaPayload.model,
      choices: [{
        index: 0,
        message: { 
          role: 'assistant', 
          content: response.data.response || '' 
        },
        finish_reason: 'stop'
      }]
    });
  } catch (err) {
    console.error('[ERROR] Proxy error:', err.response?.data || err.message);
    res.status(502).json({ 
      error: 'Failed to connect to Ollama', 
      detail: err.message 
    });
  }
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`[INFO] Ollama Proxy listening on ${HOST}:${PORT}`);
  console.log(`[INFO] Ollama endpoint: ${OLLAMA_URL}`);
  console.log(`[INFO] Node version: ${process.version}`);
});
