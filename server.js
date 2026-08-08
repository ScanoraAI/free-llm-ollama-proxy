const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// Ollama API endpoint — change this if Ollama runs on a different host/port
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

// OpenAI ↔ Ollama message format converter
function openaiToOllama(messages, model) {
  const template = `<|start|><|system|>\nYou are a helpful assistant.`; 
  let prompt = '';
  
  for (const msg of messages) {
    if (msg.role === 'system') {
      prompt += `\n${msg.content}`;
    } else if (msg.role === 'user') {
      prompt += `<|start|><|user|>\n${msg.content}`;
    } else if (msg.role === 'assistant') {
      prompt += `<|start|><|assistant|>${msg.content}`;
    }
  }
  
  prompt += `<|start|><|assistant|>`;
  
  return {
    model: model || process.env.OLLAMA_MODEL || 'phi3',
    prompt: prompt,
    stream: false
  };
}

// OpenAI-compatible chat completions endpoint
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { messages, model, max_tokens = 2048, temperature = 0.7 } = req.body;
    
    const ollamaPayload = {
      model: model || process.env.OLLAMA_MODEL || 'phi3',
      prompt: messages.map(m => `${m.role}: ${m.content}`).join('\n'),
      stream: false,
      options: {
        num_predict: max_tokens,
        temperature: temperature,
        top_p: 0.9
      }
    };

    const response = await axios.post(`${OLLAMA_URL}/api/generate`, ollamaPayload, {
      timeout: 60000
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
      }],
      usage: {
        prompt_tokens: response.data.prompt_eval_count || 0,
        completion_tokens: response.data.eval_count || 0
      }
    });
  } catch (err) {
    console.error('Proxy error:', err.response?.data || err.message);
    res.status(502).json({ 
      error: 'Failed to connect to Ollama', 
      detail: err.message 
    });
  }
});

// Health check — verifies Ollama is running
app.get('/health', async (req, res) => {
  try {
    const resp = await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 5000 });
    const models = resp.data.models?.map(m => m.name) || [];
    res.json({ 
      status: 'ok', 
      ollama: 'running', 
      url: OLLAMA_URL,
      models: models.slice(0, 10) 
    });
  } catch (err) {
    res.status(502).json({ 
      status: 'error', 
      ollama: 'not running', 
      url: OLLAMA_URL, 
      error: err.message 
    });
  }
});

// Models endpoint — lists available Ollama models
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Ollama Proxy listening on port ${PORT}`);
  console.log(`Ollama endpoint: ${OLLAMA_URL}`);
});
