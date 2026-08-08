// GoDaddy-compatible server - pure Node.js, no native modules
const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://161.118.177.83:11434';

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
          reject(new Error('Invalid JSON response from upstream'));
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy());
    if (data) req.write(data);
    req.end();
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`).pathname;
  
  if (url === '/health' || url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'ok', 
      node_version: process.version,
      timestamp: new Date().toISOString(),
      service: 'free-llm-ollama-proxy',
      ollama_url: OLLAMA_URL
    }));
  } else if (url === '/v1/models') {
    makeRequest(`${OLLAMA_URL}/api/tags`, { method: 'GET' })
      .then(data => {
        const models = (data.models || []).map(m => ({
          id: m.name,
          object: 'model'
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: models }));
      })
      .catch(err => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          data: [{ id: 'phi3', object: 'model' }],
          note: 'Using fallback model list'
        }));
      });
  } else if (url === '/v1/chat/completions' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const { messages, model = 'phi3', max_tokens = 512, temperature = 0.7 } = payload;
        
        makeRequest(`${OLLAMA_URL}/api/generate`, { method: 'POST' }, {
          model: model,
          prompt: messages.map(m => `${m.role}: ${m.content}`).join('\n'),
          stream: false,
          options: {
            num_predict: Math.min(max_tokens, 512),
            temperature: temperature,
            top_p: 0.9
          }
        }).then(data => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [{
              index: 0,
              message: { role: 'assistant', content: data.response || '' },
              finish_reason: 'stop'
            }]
          }));
        }).catch(err => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [{
              index: 0,
              message: { 
                role: 'assistant', 
                content: 'Ollama service is initializing. Please try again in a moment.'
              },
              finish_reason: 'stop'
            }]
          }));
        });
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON', detail: err.message }));
      }
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[${new Date().toISOString()}] Ollama Proxy running on ${HOST}:${PORT}`);
  console.log(`Ollama endpoint: ${OLLAMA_URL}`);
  console.log(`Node.js version: ${process.version}`);
});

process.on('uncaughtException', (err) => {
  console.error('[ERROR] Uncaught exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[ERROR] Unhandled rejection:', reason);
});
