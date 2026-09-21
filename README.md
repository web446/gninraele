# E-Learning Chat (v2)

A Moodle-style "My courses" site with an AI assistant that:

- saves every chat inside a course (each course page lists its chats),
- lets you pick from many AI models (free ones first, paid Claude/OpenAI if you add keys),
- accepts photos and code files by drag-and-drop, paste (Ctrl+V) or the paperclip button.

```
server.js            web server + API
lib/providers.js     talks to GitHub Models, Gemini, OpenRouter, Ollama, Claude, OpenAI
lib/store.js         saves chats (MongoDB, or local files as a fallback)
public/index.html    page layout
public/style.css     design
public/js/courses.js YOUR COURSE LIST (edit this) + course pages
public/js/chat.js    the chat panel
```

## What is free and what isn't

| Provider | Cost | What you get | Where to get the key |
|---|---|---|---|
| GitHub Models | Free, daily limits | OpenAI GPT-4.1, GPT-4o, GPT-5 mini and more, plus Llama, DeepSeek | github.com, Settings, Developer settings, Fine-grained tokens, permission **Models: read** |
| Google Gemini | Free (Flash models) | Gemini Flash / Flash-Lite, reads photos | aistudio.google.com/apikey |
| OpenRouter | Free models only | Whatever OpenRouter offers at $0 today (list updates automatically) | openrouter.ai/keys |
| Ollama Cloud | Free tier with usage limits | gpt-oss, Qwen, DeepSeek, Kimi | ollama.com/settings/keys |
| Anthropic | **Paid** | Claude Opus, Sonnet, Haiku | console.anthropic.com |
| OpenAI | **Paid** | Full ChatGPT model range | platform.openai.com |

Each provider appears in the model picker only when its key is set. Models tagged **Images** can read photos.

## Keeping chats (MongoDB Atlas, free)

Render's free plan erases files whenever the service restarts or sleeps, so saved chats need a database:

1. Sign up at mongodb.com/atlas and create a **free (M0)** cluster.
2. Create a database user (username + password).
3. Network Access, Add IP Address, **Allow access from anywhere** (0.0.0.0/0), because Render's IP changes.
4. Connect, Drivers, copy the connection string. Replace `<db_password>` with your password.
5. Put it in Render as `MONGODB_URI`.

Without `MONGODB_URI` the site still works, but chats can vanish after a restart (the History panel shows a warning).

## Run locally

```bash
npm install
cp .env.example .env   # fill in the keys you have
npm start              # http://localhost:3000
```

## Customize

- **Courses:** edit `COURSES` at the top of `public/js/courses.js`. `id` is the short name chats are saved under.
- **Assistant behaviour:** edit `SYSTEM_PROMPT` in `server.js`.
