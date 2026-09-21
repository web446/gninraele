// Every AI provider the site can talk to. A provider shows up in the model
// picker only when its key is set in the environment.

const env = (k) => (process.env[k] || "").trim();

export const PROVIDERS = {
  github: {
    label: "GitHub Models",
    tier: "free",
    keyEnv: "GITHUB_TOKEN",
    style: "openai",
    base: "https://models.github.ai/inference",
    note: "Free GPT models (GPT-4.1, GPT-4o, GPT-5 mini…) with daily limits",
  },
  gemini: {
    label: "Google Gemini",
    tier: "free",
    keyEnv: "GEMINI_API_KEY",
    style: "openai",
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    note: "Free Gemini Flash models",
  },
  openrouter: {
    label: "OpenRouter",
    tier: "free",
    keyEnv: "OPENROUTER_API_KEY",
    style: "openai",
    base: "https://openrouter.ai/api/v1",
    note: "Only the models OpenRouter currently offers at $0",
  },
  ollama: {
    label: "Ollama",
    tier: "free",
    keyEnv: "OLLAMA_API_KEY",
    style: "ollama",
    note: "Ollama Cloud free tier or your own Ollama",
  },
  anthropic: {
    label: "Anthropic Claude",
    tier: "paid",
    keyEnv: "ANTHROPIC_API_KEY",
    style: "anthropic",
    note: "Claude Opus / Sonnet / Haiku (pay per use)",
  },
  openai: {
    label: "OpenAI",
    tier: "paid",
    keyEnv: "OPENAI_API_KEY",
    style: "openai",
    base: "https://api.openai.com/v1",
    note: "ChatGPT models (pay per use)",
  },
};

// Optional override so OpenAI-compatible servers (Azure, LM Studio, etc.) can be used
if (env("OPENAI_BASE_URL")) PROVIDERS.openai.base = env("OPENAI_BASE_URL").replace(/\/+$/, "");

const ollamaHost = () => (env("OLLAMA_HOST") || "https://ollama.com").replace(/\/+$/, "");

export function isEnabled(id) {
  if (id === "ollama") return Boolean(env("OLLAMA_API_KEY") || env("OLLAMA_HOST"));
  return Boolean(env(PROVIDERS[id]?.keyEnv));
}

function authHeaders(id) {
  const key = env(PROVIDERS[id].keyEnv);
  if (id === "anthropic") return { "x-api-key": key, "anthropic-version": "2023-06-01" };
  const h = key ? { Authorization: `Bearer ${key}` } : {};
  if (id === "openrouter") Object.assign(h, { "HTTP-Referer": env("SITE_URL") || "https://onrender.com", "X-Title": "E-Learning Chat" });
  return h;
}

async function getJson(url, headers = {}, init = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000), ...init });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ---------------- Model discovery ---------------- */

const FALLBACK = {
  github: [
    ["openai/gpt-4.1", "OpenAI GPT-4.1", true],
    ["openai/gpt-4.1-mini", "OpenAI GPT-4.1 mini", true],
    ["openai/gpt-4o", "OpenAI GPT-4o", true],
    ["openai/gpt-4o-mini", "OpenAI GPT-4o mini", true],
  ],
  gemini: [
    ["gemini-2.5-flash", "Gemini 2.5 Flash", true],
    ["gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite", true],
  ],
  openrouter: [["openrouter/free", "Auto (any free model)", true]],
  ollama: [
    ["gpt-oss:120b", "gpt-oss 120b", false],
    ["gpt-oss:20b", "gpt-oss 20b", false],
    ["qwen3-coder:480b", "Qwen3 Coder 480b", false],
  ],
  anthropic: [
    ["claude-opus-5", "Claude Opus 5", true],
    ["claude-sonnet-5", "Claude Sonnet 5", true],
    ["claude-haiku-4-5-20251001", "Claude Haiku 4.5", true],
  ],
  openai: [
    ["gpt-4.1", "gpt-4.1", true],
    ["gpt-4o-mini", "gpt-4o-mini", true],
  ],
};

const LISTERS = {
  async github() {
    const data = await getJson("https://models.github.ai/catalog/models", {
      ...authHeaders("github"),
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    });
    return data
      .filter((m) => (m.supported_output_modalities || ["text"]).includes("text") && !/embed/i.test(m.id))
      .map((m) => ({ model: m.id, label: m.name || m.id, vision: (m.supported_input_modalities || []).includes("image") }));
  },

  async gemini() {
    const data = await getJson(`${PROVIDERS.gemini.base}/models`, authHeaders("gemini"));
    return (data.data || [])
      .map((m) => m.id.replace(/^models\//, ""))
      .filter((id) => /^(gemini|gemma)/.test(id) && !/(embed|tts|image|live|audio|aqa|native|robotics|computer)/.test(id))
      .filter((id) => !/pro/.test(id)) // Pro models are not on the free tier
      .map((id) => ({ model: id, label: id.replace(/-/g, " ").replace(/^gemini/, "Gemini").replace(/^gemma/, "Gemma"), vision: true }));
  },

  async openrouter() {
    const data = await getJson("https://openrouter.ai/api/v1/models");
    return (data.data || [])
      .filter((m) => Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0)
      .filter((m) => (m.architecture?.output_modalities || ["text"]).includes("text"))
      .map((m) => ({
        model: m.id,
        label: m.id === "openrouter/free" ? "Auto (any free model)" : (m.name || m.id).replace(/\s*\(free\)\s*$/i, ""),
        vision: m.id === "openrouter/free" || (m.architecture?.input_modalities || []).includes("image"),
      }));
  },

  async ollama() {
    const host = ollamaHost();
    const headers = authHeaders("ollama");
    const data = await getJson(`${host}/api/tags`, headers);
    const names = (data.models || []).map((m) => m.name || m.model).filter(Boolean);
    const guess = (n) => /(vl|vision|llava|gemma3|gemma4|gemini|mistral-small3|llama4)/i.test(n);
    const details = await Promise.allSettled(
      names.map((name) =>
        getJson(`${host}/api/show`, { ...headers, "Content-Type": "application/json" }, {
          method: "POST",
          body: JSON.stringify({ model: name }),
        })
      )
    );
    return names.map((name, i) => {
      const caps = details[i].status === "fulfilled" ? details[i].value.capabilities : null;
      return { model: name, label: name, vision: Array.isArray(caps) ? caps.includes("vision") : guess(name) };
    });
  },

  async anthropic() {
    const data = await getJson("https://api.anthropic.com/v1/models?limit=100", authHeaders("anthropic"));
    return (data.data || []).map((m) => ({ model: m.id, label: m.display_name || m.id, vision: true }));
  },

  async openai() {
    const data = await getJson(`${PROVIDERS.openai.base}/models`, authHeaders("openai"));
    return (data.data || [])
      .map((m) => m.id)
      .filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id))
      .filter((id) => !/(audio|realtime|transcribe|tts|image|search|embed|instruct|moderation|codex|\d{4}-\d{2}-\d{2})/.test(id))
      .map((id) => ({ model: id, label: id, vision: !/^gpt-3/.test(id) }));
  },
};

let cache = { at: 0, data: null };

export async function listModels({ force = false } = {}) {
  if (!force && cache.data && Date.now() - cache.at < 6 * 60 * 60 * 1000) return cache.data;

  const providers = [];
  const models = [];
  await Promise.all(
    Object.entries(PROVIDERS).map(async ([id, p]) => {
      const info = { id, label: p.label, tier: p.tier, note: p.note, keyEnv: p.keyEnv, enabled: isEnabled(id), error: null };
      providers.push(info);
      if (!info.enabled) return;
      let list;
      try {
        list = await LISTERS[id]();
        if (!list.length) throw new Error("no models returned");
      } catch (err) {
        info.error = `Showing default list (live list failed: ${err.message})`;
        list = FALLBACK[id].map(([model, label, vision]) => ({ model, label, vision }));
      }
      list.sort((a, b) => a.label.localeCompare(b.label));
      for (const m of list) models.push({ id: `${id}:${m.model}`, provider: id, tier: p.tier, ...m });
    })
  );
  const order = Object.keys(PROVIDERS);
  providers.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  cache = { at: Date.now(), data: { providers, models } };
  return cache.data;
}

/* ---------------- Message preparation ---------------- */

const DATA_URL = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/;
const MAX_IMAGES = 8; // only the most recent images are re-sent each turn

function prepare(messages) {
  let budget = MAX_IMAGES;
  const out = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const imgs = (Array.isArray(m.images) ? m.images : []).filter((u) => typeof u === "string" && DATA_URL.test(u));
    const keep = imgs.slice(Math.max(0, imgs.length - budget));
    budget -= keep.length;
    let text = typeof m.content === "string" ? m.content : "";
    if (keep.length < imgs.length) text += `\n[${imgs.length - keep.length} earlier image(s) not re-sent]`;
    for (const f of Array.isArray(m.files) ? m.files : []) {
      if (f && typeof f.text === "string") text += `\n\nAttached file: ${String(f.name).slice(0, 120)}\n\`\`\`\n${f.text.slice(0, 200000)}\n\`\`\``;
    }
    out.unshift({ role: m.role === "assistant" ? "assistant" : "user", text, images: keep });
  }
  const merged = [];
  for (const m of out) {
    if (!m.text.trim() && !m.images.length) continue;
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) {
      last.text += `\n\n${m.text}`;
      last.images.push(...m.images);
    } else merged.push({ ...m, images: [...m.images] });
  }
  while (merged.length && merged[0].role !== "user") merged.shift();
  return merged;
}

/* ---------------- Streaming ---------------- */

async function* readLines(body) {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      yield buf.slice(0, i).replace(/\r$/, "");
      buf = buf.slice(i + 1);
    }
  }
  if (buf.trim()) yield buf;
}

export class ProviderError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function upstream(url, headers, body, signal, providerLabel) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new ProviderError(502, `Could not reach ${providerLabel}.`);
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let msg = raw;
    try {
      const j = JSON.parse(raw);
      msg = j.error?.message || (typeof j.error === "string" ? j.error : "") || j.message || raw;
    } catch { /* not JSON */ }
    const hint =
      res.status === 401 || res.status === 403 ? " Check the API key for this provider." :
      res.status === 429 ? " You hit this provider's free limit. Wait a bit or pick another model." :
      res.status === 404 ? " This model isn't available right now. Pick another one." : "";
    throw new ProviderError(res.status, `${providerLabel}: ${String(msg).slice(0, 300)}${hint}`.trim());
  }
  return res;
}

export async function* streamChat({ modelId, messages, system, signal }) {
  const sep = modelId.indexOf(":");
  const providerId = modelId.slice(0, sep);
  const model = modelId.slice(sep + 1);
  const p = PROVIDERS[providerId];
  if (!p || sep < 0) throw new ProviderError(400, "Unknown model. Pick one from the list.");
  if (!isEnabled(providerId)) throw new ProviderError(400, `${p.label} isn't set up on the server (${p.keyEnv} is missing).`);

  const msgs = prepare(messages);
  if (!msgs.length) throw new ProviderError(400, "Write a message or attach something first.");

  if (p.style === "ollama") {
    const res = await upstream(`${ollamaHost()}/api/chat`, authHeaders(providerId), {
      model,
      stream: true,
      messages: [
        { role: "system", content: system },
        ...msgs.map((m) => ({
          role: m.role,
          content: m.text,
          ...(m.images.length ? { images: m.images.map((u) => u.match(DATA_URL)[2]) } : {}),
        })),
      ],
    }, signal, p.label);
    for await (const line of readLines(res.body)) {
      if (!line.trim()) continue;
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      if (j.error) throw new ProviderError(502, `${p.label}: ${j.error}`);
      if (j.message?.content) yield j.message.content;
    }
    return;
  }

  if (p.style === "anthropic") {
    const res = await upstream("https://api.anthropic.com/v1/messages", authHeaders(providerId), {
      model,
      max_tokens: 8192,
      stream: true,
      system,
      messages: msgs.map((m) => ({
        role: m.role,
        content: m.images.length
          ? [
              ...m.images.map((u) => {
                const [, mediaType, data] = u.match(DATA_URL);
                return { type: "image", source: { type: "base64", media_type: mediaType, data } };
              }),
              { type: "text", text: m.text.trim() || "Please look at this image." },
            ]
          : m.text,
      })),
    }, signal, p.label);
    for await (const line of readLines(res.body)) {
      if (!line.startsWith("data:")) continue;
      let j;
      try { j = JSON.parse(line.slice(5)); } catch { continue; }
      if (j.type === "error") throw new ProviderError(502, `${p.label}: ${j.error?.message || "stream error"}`);
      if (j.type === "content_block_delta" && j.delta?.type === "text_delta") yield j.delta.text;
    }
    return;
  }

  // OpenAI-compatible (GitHub Models, Gemini, OpenRouter, OpenAI)
  const res = await upstream(`${p.base}/chat/completions`, authHeaders(providerId), {
    model,
    stream: true,
    messages: [
      { role: "system", content: system },
      ...msgs.map((m) => ({
        role: m.role,
        content:
          m.images.length && m.role === "user"
            ? [
                { type: "text", text: m.text.trim() || "Please look at this image." },
                ...m.images.map((url) => ({ type: "image_url", image_url: { url } })),
              ]
            : m.text,
      })),
    ],
  }, signal, p.label);
  for await (const line of readLines(res.body)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") return;
    let j;
    try { j = JSON.parse(data); } catch { continue; }
    if (j.error) throw new ProviderError(502, `${p.label}: ${j.error.message || "stream error"}`);
    const t = j.choices?.[0]?.delta?.content;
    if (typeof t === "string" && t) yield t;
  }
}
