import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env for local development (Render sets env vars itself)
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const { listModels, streamChat, ProviderError } = await import("./lib/providers.js");
const { createStore } = await import("./lib/store.js");

const PORT = process.env.PORT || 3000;
const ACCESS_PASSWORD = (process.env.ACCESS_PASSWORD || "").trim();

const SYSTEM_PROMPT = `You are a helpful assistant for a telecommunications and computer engineering student.
You mainly help with code: explaining it, debugging it and writing it (Python, C/C++, Java, JavaScript,
MATLAB, LabVIEW concepts, SQL, Bash, networking and security tooling). You also help with course material.
Rules:
- Put code in fenced Markdown blocks with the language name (e.g. \`\`\`python).
- When fixing a bug, say what was wrong in one or two sentences, then show the corrected code.
- When the user shares an image (screenshot, diagram, handwritten notes, circuit), describe what matters in it and use it to answer.
- Keep explanations clear and reasonably short unless asked for detail.`;

const store = await createStore(__dirname);
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/healthz", (_req, res) => res.send("ok"));
app.get("/api/config", (_req, res) => res.json({ needsPassword: Boolean(ACCESS_PASSWORD), storage: store.kind }));

// Everything below needs the password (when one is set)
app.use("/api", (req, res, next) => {
  if (ACCESS_PASSWORD && req.get("x-access-password") !== ACCESS_PASSWORD) {
    return res.status(401).json({ error: "Wrong or missing password." });
  }
  next();
});

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: "Something went wrong on the server." });
  });

/* ---------- Models ---------- */
app.get("/api/models", wrap(async (req, res) => {
  res.json(await listModels({ force: req.query.refresh === "1" }));
}));

/* ---------- Chat (streaming) ---------- */
app.post("/api/chat", async (req, res) => {
  const { model, messages } = req.body || {};
  if (typeof model !== "string" || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Send a model and a list of messages." });
  }
  const controller = new AbortController();
  res.on("close", () => controller.abort());

  try {
    const stream = streamChat({ modelId: model, messages: messages.slice(-60), system: SYSTEM_PROMPT, signal: controller.signal });
    let started = false;
    for await (const text of stream) {
      if (!started) {
        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("X-Accel-Buffering", "no");
        started = true;
      }
      res.write(JSON.stringify({ t: text }) + "\n");
    }
    if (!started) res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.end(JSON.stringify({ done: true }) + "\n");
  } catch (err) {
    if (controller.signal.aborted) return;
    const message = err instanceof ProviderError ? err.message : "The AI provider stopped unexpectedly.";
    if (!(err instanceof ProviderError)) console.error(err);
    if (!res.headersSent) return res.status(err.status && err.status < 600 ? err.status : 502).json({ error: message });
    res.end(JSON.stringify({ error: message }) + "\n");
  }
});

/* ---------- Saved chats ---------- */
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const cleanCourse = (c) => String(c || "GENERAL").replace(/[^\w.-]/g, "").slice(0, 40) || "GENERAL";

app.get("/api/chats", wrap(async (req, res) => {
  res.json(await store.list(req.query.course ? cleanCourse(req.query.course) : null));
}));

app.get("/api/chats/counts", wrap(async (_req, res) => res.json(await store.counts())));

app.get("/api/chats/:id", wrap(async (req, res) => {
  if (!ID.test(req.params.id)) return res.status(400).json({ error: "Bad chat id." });
  const chat = await store.get(req.params.id);
  if (!chat) return res.status(404).json({ error: "This chat no longer exists." });
  res.json(chat);
}));

app.put("/api/chats/:id", wrap(async (req, res) => {
  const { id } = req.params;
  if (!ID.test(id)) return res.status(400).json({ error: "Bad chat id." });
  const b = req.body || {};
  if (!Array.isArray(b.messages) || b.messages.length > 500) return res.status(400).json({ error: "Invalid messages." });

  const messages = b.messages.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || "").slice(0, 200000),
    images: (Array.isArray(m.images) ? m.images : []).filter((u) => typeof u === "string" && u.startsWith("data:image/")).slice(0, 10),
    files: (Array.isArray(m.files) ? m.files : []).slice(0, 10).map((f) => ({ name: String(f.name).slice(0, 120), text: String(f.text || "").slice(0, 200000) })),
    model: typeof m.model === "string" ? m.model.slice(0, 120) : undefined,
    at: typeof m.at === "string" ? m.at : undefined,
  }));
  const firstUser = messages.find((m) => m.role === "user");
  const now = new Date().toISOString();
  const chat = {
    id,
    course: cleanCourse(b.course),
    title: String(b.title || firstUser?.content || "Untitled chat").replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled chat",
    model: String(b.model || "").slice(0, 120),
    createdAt: typeof b.createdAt === "string" ? b.createdAt : now,
    updatedAt: now,
    messageCount: messages.length,
    preview: String(messages.at(-1)?.content || "").replace(/[`#*_>\n]+/g, " ").trim().slice(0, 160),
    messages,
  };
  if (JSON.stringify(chat).length > 15_000_000) {
    return res.status(413).json({ error: "This chat is too big to save (too many images). Start a new chat." });
  }
  await store.put(chat);
  res.json({ ok: true, updatedAt: now, title: chat.title, course: chat.course });
}));

app.patch("/api/chats/:id", wrap(async (req, res) => {
  if (!ID.test(req.params.id)) return res.status(400).json({ error: "Bad chat id." });
  const fields = {};
  if (typeof req.body?.title === "string" && req.body.title.trim()) fields.title = req.body.title.trim().slice(0, 120);
  if (typeof req.body?.course === "string") fields.course = cleanCourse(req.body.course);
  if (!Object.keys(fields).length) return res.status(400).json({ error: "Nothing to change." });
  fields.updatedAt = new Date().toISOString();
  const ok = await store.patch(req.params.id, fields);
  if (!ok) return res.status(404).json({ error: "This chat no longer exists." });
  res.json({ ok: true, ...fields });
}));

app.delete("/api/chats/:id", wrap(async (req, res) => {
  if (!ID.test(req.params.id)) return res.status(400).json({ error: "Bad chat id." });
  await store.remove(req.params.id);
  res.json({ ok: true });
}));

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

app.listen(PORT, () => {
  console.log(`E-Learning Chat running on http://localhost:${PORT}`);
  listModels().then(({ providers }) => {
    for (const p of providers) console.log(`  ${p.enabled ? "✓" : "·"} ${p.label}${p.error ? `  (${p.error})` : ""}`);
  });
});
