# E-Learning Chat

A Moodle-style "My courses" page with a floating 💬 coding assistant powered by Ollama.

```
elearning-chat/
├── server.js          Express server: serves the page + proxies /api/chat to Ollama (streaming)
├── public/
│   ├── index.html     Page layout (header, toolbar, course cards, chat panel)
│   ├── style.css      Styling
│   └── app.js         Your course list, card patterns, search/sort, chat logic
├── render.yaml        One-click Render blueprint
├── .env.example       Settings template
└── package.json
```

## Important: where does Ollama run?

Render's free plan has 512 MB RAM and no GPU, so it cannot run an Ollama model itself.
The Render server only hosts the website and forwards chat messages to Ollama somewhere else.
Pick one:

**A. Ollama Cloud (easiest, works 24/7)**
1. Create an account at ollama.com and make an API key at ollama.com/settings/keys.
2. Use `OLLAMA_HOST=https://ollama.com`, `OLLAMA_API_KEY=<your key>`, and a cloud model such as `gpt-oss:20b`.

**B. Ollama on your own PC (free, only works while your PC is on)**
1. Install Ollama, then `ollama pull qwen2.5-coder:7b`
2. Expose it with a tunnel: `cloudflared tunnel --url http://localhost:11434`
3. Use the printed `https://....trycloudflare.com` URL as `OLLAMA_HOST`, the model name as `OLLAMA_MODEL`, and leave `OLLAMA_API_KEY` empty.

## Run locally

```bash
npm install
cp .env.example .env      # then edit .env
npm start                 # open http://localhost:3000
```

With Ollama installed locally you can simply set `OLLAMA_HOST=http://localhost:11434`.

## Deploy on Render

1. Push this folder to a GitHub repo.
2. On render.com: **New → Blueprint**, pick the repo (it reads `render.yaml`).
   Or **New → Web Service**: Runtime Node, Build `npm install`, Start `npm start`.
3. In **Environment**, set `OLLAMA_API_KEY` (and `ACCESS_PASSWORD` if you want one).
4. Your site will be at `https://<service-name>.onrender.com`. The service name you choose is the subdomain.

Free Render services sleep after about 15 minutes idle, so the first visit afterwards takes ~30–60 s to wake up.

## Protect your API key

The site is public, so anyone with the link could use your Ollama quota.
Set `ACCESS_PASSWORD` in Render and the chat will ask for it once per browser.

## Customize

- **Courses:** edit the `COURSES` array at the top of `public/app.js`.
- **Assistant behaviour:** edit `SYSTEM_PROMPT` in `server.js`.
- **Logo/name:** the brand block in `public/index.html`.
