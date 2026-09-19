import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env for local development (Render sets env vars itself)
try {
  const fs = await import("fs");
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  }
} catch { /* ignore */ }

const OLLAMA_HOST = (process.env.OLLAMA_HOST || "https://ollama.com").replace(/\/+$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gpt-oss:20b";
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || "";
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || "";
const PORT = process.env.PORT || 3000;

const SYSTEM_PROMPT = `You are a friendly assistant for a telecommunications / computer engineering student.
You mainly help with code: explaining it, debugging it, and writing it (Python, C/C++, Java, JavaScript,
MATLAB, LabVIEW concepts, SQL, Bash, networking and security tooling).
Rules:
- Always put code in fenced Markdown blocks with the language name (e.g. \`\`\`python).
- When fixing a bug, say what was wrong in one or two sentences, then show the corrected code.
- Keep explanations short and clear unless asked for detail.
- If a question is ambiguous, make a reasonable assumption and state it.`;

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/healthz", (_req, res) => res.send("ok"));

app.get("/api/config", (_req, res) => {
  res.json({ model: OLLAMA_MODEL, needsPassword: Boolean(ACCESS_PASSWORD) });
});

app.post("/api/chat", async (req, res) => {
  if (ACCESS_PASSWORD && req.get("x-access-password") !== ACCESS_PASSWORD) {
    return res.status(401).json({ error: "Wrong or missing access password." });
  }

  const incoming = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const messages = incoming
    .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string")
    .slice(-30) // keep the last 30 turns so requests stay small
    .map((m) => ({ role: m.role, content: m.content.slice(0, 20000) }));

  if (!messages.length) return res.status(400).json({ error: "Send at least one message." });

  const controller = new AbortController();
  // user pressed Stop or closed the tab (res "close" also fires after a normal finish, which is harmless)
  res.on("close", () => controller.abort());

  let upstream;
  try {
    upstream = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(OLLAMA_API_KEY ? { Authorization: `Bearer ${OLLAMA_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: true,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) return;
    console.error("Ollama unreachable:", err.message);
    return res.status(502).json({ error: `Could not reach Ollama at ${OLLAMA_HOST}. Check OLLAMA_HOST.` });
  }

  if (!upstream.ok) {
    const detail = (await upstream.text().catch(() => "")).slice(0, 300);
    const hint =
      upstream.status === 401 ? " Check OLLAMA_API_KEY." :
      upstream.status === 404 ? ` Check that the model "${OLLAMA_MODEL}" exists.` : "";
    return res.status(upstream.status).json({ error: `Ollama returned ${upstream.status}.${hint} ${detail}`.trim() });
  }

  // Pass Ollama's NDJSON stream straight through to the browser
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  try {
    for await (const chunk of upstream.body) res.write(chunk);
  } catch {
    /* stream stopped early */
  }
  res.end();
});

app.listen(PORT, () => {
  console.log(`E-Learning Chat on http://localhost:${PORT}`);
  console.log(`Ollama: ${OLLAMA_HOST}  model: ${OLLAMA_MODEL}  key: ${OLLAMA_API_KEY ? "set" : "not set"}`);
});
