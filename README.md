# Ollama Proxy

OpenAI-compatible proxy server that routes `/v1/chat/completions` requests to [Ollama](https://github.com/ollama/ollama) running in the background. Perfect for cPanel where Ollama runs as a daemon but your app needs a Node.js API.

## Architecture
```
Internet → Node.js Proxy (cPanel) → Ollama (localhost:11434)
```

## Setup

### 1. Install Ollama (on your VM/server)
```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama serve &
ollama pull phi3  # lightweight model
```

### 2. Deploy Proxy (cPanel)
1. Fork this repo → GitHub
2. cPanel: Setup Node.js App → pull from Git
3. Env vars:
   - `OLLAMA_URL` = `http://localhost:11434` (or remote URL)
   - `OLLAMA_MODEL` = `phi3` (or any model pulled via `ollama pull`)
   - `PORT` = auto-set by cPanel
4. Start

## API Usage
```bash
curl -X POST https://your-app.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}]}'

# Check health (verifies Ollama connection)
curl https://your-app.com/health
```
