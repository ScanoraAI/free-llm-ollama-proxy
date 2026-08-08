// GoDaddy-compatible Ollama proxy
// Pure Node.js http/https modules - zero dependencies
// Includes web UI for testing chat completions
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
      headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }
    }, (res) => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(responseBody)); }
        catch(e) { reject(new Error('Invalid JSON response from upstream')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy());
    if (data) req.write(data);
    req.end();
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const pathname = url.pathname;

  // Web UI
  if (pathname === '/chat' || pathname === '/ui') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ollama Chat</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    .chat-container { background: white; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.1); overflow: hidden; }
    #chat-messages { height: 500px; overflow-y: auto; padding: 20px; }
    .message { margin-bottom: 15px; padding: 12px 16px; border-radius: 8px; }
    .user { background: #e3f2fd; margin-left: auto; max-width: 80%; }
    .assistant { background: #f1f1f1; margin-right: auto; max-width: 80%; }
    .input-container { display: flex; padding: 15px; border-top: 1px solid #eee; }
    #message-input { flex: 1; padding: 12px; border: 1px solid #ddd; border-radius: 20px; outline: none; }
    button { padding: 12px 20px; margin-left: 10px; background: #ff6b35; color: white; border: none; border-radius: 20px; cursor: pointer; }
    button:hover { background: #e55a2b; }
    button:disabled { background: #ccc; }
    .model-select { padding: 8px; border-radius: 6px; border: 1px solid #ddd; margin-right: 10px; }
  </style>
</head>
<body>
  <h1>Free LLM Chat</h1>
  <p>Using <strong>Ollama</strong> via proxy</p>
  <div class="chat-container">
    <div id="chat-messages"></div>
    <div class="input-container">
      <select class="model-select" id="model-select">
        <option value="phi3">phi3</option>
        <option value="tinyllama">tinyllama</option>
        <option value="gemma:2b">gemma:2b</option>
      </select>
      <input type="text" id="message-input" placeholder="Type a message..." autocomplete="off">
      <button onclick="sendMessage()" id="send-btn">Send</button>
    </div>
  </div>
  <script>
    async function sendMessage() {
      const input = document.getElementById('message-input');
      const modelSelect = document.getElementById('model-select');
      const message = input.value.trim();
      if (!message) return;
      
      const btn = document.getElementById('send-btn');
      btn.disabled = true;
      
      const messagesDiv = document.getElementById('chat-messages');
      messagesDiv.innerHTML += '<div class="message user"><strong>You:</strong> ' + message + '</div>';
      input.value = '';
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
      
      try {
        const resp = await fetch('/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: message }],
            model: modelSelect.value,
            max_tokens: 500,
            temperature: 0.7
          })
        });
        
        const data = await resp.json();
        const reply = data.choices[0].message.content;
        
        messagesDiv.innerHTML += '<div class="message assistant"><strong>Assistant:</strong> ' + reply + '</div>';
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
      } catch (err) {
        messagesDiv.innerHTML += '<div class="message assistant"><strong>Error:</strong> Failed to connect to Ollama. Check server logs.</div>';
      }
      
      btn.disabled = false;
    }
    
    document.getElementById('message-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
  </script>
</body>
</html>`);
    return;
  }
  
  // Health check
  if (pathname === '/health' || pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'ok', 
      node_version: process.version,
      timestamp: new Date().toISOString(),
      service: 'free-llm-ollama-proxy',
      ollama_url: OLLAMA_URL,
      ui: '/chat'
    }));
    return;
  }

  // Models endpoint
  if (pathname === '/v1/models') {
    makeRequest(`${OLLAMA_URL}/api/tags`, { method: 'GET' })
      .then(data => {
        const models = (data.models || []).map(m => ({ id: m.name, object: 'model' }));
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
    return;
  }

  // Chat completions
  if (pathname === '/v1/chat/completions' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const { messages, model = 'phi3', max_tokens = 512, temperature = 0.7 } = payload;
        
        makeRequest(`${OLLAMA_URL}/api/generate`, { method: 'POST' }, {
          model: model,
          prompt: messages.map(m => `${m.role}: ${m.content}`).join('\\n'),
          stream: false,
          options: { num_predict: Math.min(max_tokens, 512), temperature, top_p: 0.9 }
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
              message: { role: 'assistant', content: 'Ollama service is initializing. Please try again in a moment.' },
              finish_reason: 'stop'
            }]
          }));
        });
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON', detail: err.message }));
      }
    });
    return;
  }
  
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found', paths: ['/health', '/v1/models', '/v1/chat/completions', '/chat'] }));
});

server.listen(PORT, HOST, () => {
  console.log(`[${new Date().toISOString()}] Ollama Proxy running on ${HOST}:${PORT}`);
  console.log(`Ollama endpoint: ${OLLAMA_URL}`);
  console.log(`Web UI: /chat`);
  console.log(`Node.js version: ${process.version}`);
});

process.on('uncaughtException', (err) => console.error('[ERROR] Uncaught:', err.message));
process.on('unhandledRejection', (reason) => console.error('[ERROR] Unhandled rejection:', reason));
