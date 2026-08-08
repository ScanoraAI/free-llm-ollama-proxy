// Ollama Proxy - GoDaddy compatible (minimal version)
const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

function makeRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const data = body ? JSON.stringify(body) : null;
    
    const req = lib.request(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseBody));
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy());
    if (data) req.write(data);
    req.end();
  });
}

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

const server = http.createServer((req, res) => {
  const handleResponse = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  if (req.url === '/health' || req.url === '/') {
    return handleResponse({ 
      status: 'ok',
      ollama_url: OLLAMA_URL,
      node_version: process.version
    });
  }

  if (req.url === '/v1/models') {
    makeRequest(`${OLLAMA_URL}/api/tags`, { method: 'GET' })
      .then(data => {
        const models = (data.models || []).map(m => ({
          id: m.name,
          object: 'model'
        }));
        handleResponse({ data: models });
      })
      .catch(err => handleResponse({ 
        error: 'Failed to list models', 
        detail: err.message 
      }, 502));
    return;
  }

  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const { messages, model = 'phi3', max_tokens = 2048, temperature = 0.7 } = payload;
        
        makeRequest(`${OLLAMA_URL}/api/generate`, { method: 'POST' }, {
          model: model,
          prompt: messages.map(m => `${m.role}: ${m.content}`).join('\n'),
          stream: false,
          options: {
            num_predict: Math.min(max_tokens, 2000),
            temperature: temperature,
            top_p: 0.9
          }
        }).then(data => {
          handleResponse({
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [{
              index: 0,
              message: { role: 'assistant', content: data.response || '' },
              finish_reason: 'stop'
            }]
          });
        }).catch(err => handleResponse({
          error: 'Failed to connect to Ollama',
          detail: err.message
        }, 502));
      } catch (err) {
        handleResponse({ error: 'Invalid JSON', detail: err.message }, 400);
      }
    });
    return;
  }

  handleResponse({ error: 'Not found' }, 404);
});

server.listen(PORT, HOST, () => {
  console.log(`Ollama Proxy running on ${HOST}:${PORT}`);
  console.log(`Ollama endpoint: ${OLLAMA_URL}`);
  console.log(`Node version: ${process.version}`);
});

process.on('uncaughtException', (err) => {
  console.error('[ERROR] Uncaught exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[ERROR] Unhandled rejection:', reason);
});
