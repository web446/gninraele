import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
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
const { createStore, chatMeta } = await import("./lib/store.js");
const auth = await import("./lib/auth.js");
const { accessState, nextPeriod, today, isDate, SEMESTER_MONTHS, GRACE_DAYS } = await import("./lib/access.js");

const PORT = process.env.PORT || 3000;
const DAILY_LIMIT = Number(process.env.DAILY_MESSAGE_LIMIT ?? 100);
const DEFAULT_PRICE = Number(process.env.SEMESTER_PRICE ?? 0);
const CURRENCY = process.env.CURRENCY || "USD";

const SYSTEM_PROMPT = `You are a helpful study assistant for engineering and computer-science students.
You mainly help with code: explaining it, debugging it and writing it (Python, C/C++, Java, JavaScript,
MATLAB, LabVIEW concepts, SQL, Bash, networking and security tooling). You also help with course material.
Rules:
- Put code in fenced Markdown blocks with the language name (e.g. \`\`\`python).
- When fixing a bug, say what was wrong in one or two sentences, then show the corrected code.
- When the user shares an image (screenshot, diagram, handwritten notes, circuit), describe what matters in it and use it to answer.
- Keep explanations clear and reasonably short unless asked for detail.`;

const store = await createStore(__dirname);
const uid = () => crypto.randomUUID();

/* ---------------- first admin + migration of old data ---------------- */
async function bootstrap() {
  let admin = await store.users.findOne({ role: "admin" });
  if (!admin) {
    const username = (process.env.ADMIN_USERNAME || "admin").toLowerCase();
    const password = process.env.ADMIN_PASSWORD || auth.generatePassword();
    admin = await store.users.insert({
      id: uid(), username, passwordHash: auth.hashPassword(password), name: process.env.ADMIN_NAME || "Administrator",
      phone: "", email: "", role: "admin", accountStatus: "active", courses: [], sessionVersion: 1,
      usage: { day: today(), messages: 0 }, adminNote: "", lastLoginAt: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    console.log("=".repeat(60));
    console.log(`Admin account created.  username: ${username}`);
    console.log(process.env.ADMIN_PASSWORD ? "password: the ADMIN_PASSWORD you set" : `password: ${password}   <-- copy this now, it is shown only once`);
    console.log("=".repeat(60));
  }
  // Chats saved before accounts existed belong to the admin
  const legacy = (await store.chats.find({})).filter((c) => !c.userId);
  for (const chat of legacy) {
    await store.chats.update(chat.id, { userId: admin.id, courseId: chat.courseId || chat.course || "GENERAL" });
  }
  if (legacy.length) console.log(`Moved ${legacy.length} old chat(s) to the admin account.`);
}
await bootstrap();

/* ---------------- app ---------------- */
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(cookieParser());
app.use(express.json({ limit: "16mb" }));

// Block cross-site writes (the cookie is SameSite=Lax as well)
app.use((req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    const origin = req.get("origin");
    if (origin && origin !== `${req.protocol}://${req.get("host")}`) return res.status(403).json({ error: "Blocked request." });
  }
  next();
});

app.get("/healthz", (_req, res) => res.send("ok"));
app.use(express.static(path.join(__dirname, "public")));

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

async function loadUser(req) {
  const session = auth.readCookie(req);
  if (!session) return null;
  const user = await store.users.findOne({ id: session.id });
  if (!user || (user.sessionVersion || 1) !== session.version) return null;
  return user;
}

const requireAuth = wrap(async (req, res, next) => {
  const user = await loadUser(req);
  if (!user) return res.status(401).json({ error: "Please log in." });
  const subs = user.role === "admin" ? [] : await store.subs.find({ userId: user.id });
  const access = accessState(user, subs);
  if (!access.canRead) return res.status(403).json({ error: `Your account is ${access.status}. Please contact your teacher.`, access });
  req.user = user;
  req.access = access;
  next();
});

const requireWrite = (req, res, next) =>
  req.access.canWrite ? next() : res.status(402).json({ error: "Your subscription has expired. Pay for the new semester to keep using the assistant.", access: req.access });

const requireAdmin = (req, res, next) => (req.user.role === "admin" ? next() : res.status(403).json({ error: "Admins only." }));

const publicUser = (u, access) => ({ id: u.id, username: u.username, name: u.name, role: u.role, courses: u.courses || [], access });

/* ---------------- auth ---------------- */
app.post("/api/auth/login", wrap(async (req, res) => {
  const username = String(req.body?.username || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const key = `${req.ip}|${username}`;
  if (auth.loginBlocked(key)) return res.status(429).json({ error: "Too many attempts. Wait 15 minutes and try again." });

  const user = username ? await store.users.findOne({ username }) : null;
  if (!user || !auth.verifyPassword(password, user.passwordHash)) {
    auth.loginFailed(key);
    return res.status(401).json({ error: "Wrong username or password." });
  }
  const subs = user.role === "admin" ? [] : await store.subs.find({ userId: user.id });
  const access = accessState(user, subs);
  if (!access.canRead) {
    return res.status(403).json({
      error: access.status === "suspended"
        ? "Your account is suspended. Please contact your teacher."
        : "This account is closed. Please contact your teacher.",
    });
  }
  auth.loginSucceeded(key);
  auth.issueCookie(res, user, req);
  await store.users.update(user.id, { lastLoginAt: new Date().toISOString() });
  res.json({ user: publicUser(user, access) });
}));

app.post("/api/auth/logout", (_req, res) => {
  auth.clearCookie(res);
  res.json({ ok: true });
});

app.get("/api/me", requireAuth, (req, res) => res.json({ user: publicUser(req.user, req.access) }));

/* Students manage their own course cards (stored inside their user document) */
app.put("/api/me/courses", requireAuth, requireWrite, wrap(async (req, res) => {
  const list = Array.isArray(req.body?.courses) ? req.body.courses : null;
  if (!list || list.length > 30) return res.status(400).json({ error: "Send up to 30 courses." });
  const seen = new Set();
  const courses = [];
  for (const c of list) {
    const id = String(c?.id || "").replace(/[^\w.-]/g, "").slice(0, 40).toUpperCase();
    if (!id || id === "GENERAL" || seen.has(id)) continue;
    seen.add(id);
    courses.push({
      id,
      title: String(c.title || id).slice(0, 120),
      term: String(c.term || "").slice(0, 60),
      color: /^#[0-9a-f]{6}$/i.test(c.color || "") ? c.color : "#10b58c",
      pattern: ["plaid", "diamonds", "circles", "tiles"].includes(c.pattern) ? c.pattern : "diamonds",
    });
  }
  await store.users.update(req.user.id, { courses, updatedAt: new Date().toISOString() });
  res.json({ courses });
}));

/* ---------------- models ---------------- */
app.get("/api/models", requireAuth, wrap(async (req, res) => {
  res.json(await listModels({ force: req.query.refresh === "1" && req.user.role === "admin" }));
}));

/* ---------------- chat (streaming) ---------------- */
app.post("/api/chat", requireAuth, requireWrite, async (req, res) => {
  const { model, messages } = req.body || {};
  if (typeof model !== "string" || !Array.isArray(messages)) return res.status(400).json({ error: "Send a model and a list of messages." });

  if (req.user.role !== "admin" && DAILY_LIMIT > 0) {
    const usage = req.user.usage?.day === today() ? req.user.usage : { day: today(), messages: 0 };
    if (usage.messages >= DAILY_LIMIT) {
      return res.status(429).json({ error: `You have reached today's limit of ${DAILY_LIMIT} messages. It resets tomorrow.` });
    }
    await store.users.update(req.user.id, { usage: { day: usage.day, messages: usage.messages + 1 } });
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
      res.write(`${JSON.stringify({ t: text })}\n`);
    }
    if (!started) res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.end(`${JSON.stringify({ done: true })}\n`);
  } catch (err) {
    if (controller.signal.aborted) return;
    const message = err instanceof ProviderError ? err.message : "The AI provider stopped unexpectedly.";
    if (!(err instanceof ProviderError)) console.error(err);
    if (!res.headersSent) return res.status(err.status && err.status < 600 ? err.status : 502).json({ error: message });
    res.end(`${JSON.stringify({ error: message })}\n`);
  }
});

/* ---------------- saved chats (always scoped to the owner) ---------------- */
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const cleanCourse = (c) => String(c || "GENERAL").replace(/[^\w.-]/g, "").slice(0, 40) || "GENERAL";

app.get("/api/chats", requireAuth, wrap(async (req, res) => {
  const where = { userId: req.user.id };
  if (req.query.course) where.courseId = cleanCourse(req.query.course);
  const chats = await store.chats.find(where, { sort: { updatedAt: -1 }, limit: 500 });
  res.json(chats.map(chatMeta));
}));

app.get("/api/chats/counts", requireAuth, wrap(async (req, res) => {
  res.json(await store.chats.groupCount("courseId", { userId: req.user.id }));
}));

app.get("/api/chats/:id", requireAuth, wrap(async (req, res) => {
  if (!ID.test(req.params.id)) return res.status(400).json({ error: "Bad chat id." });
  const chat = await store.chats.findOne({ id: req.params.id, userId: req.user.id });
  if (!chat) return res.status(404).json({ error: "This chat no longer exists." });
  res.json(chat);
}));

app.put("/api/chats/:id", requireAuth, requireWrite, wrap(async (req, res) => {
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
    userId: req.user.id,
    courseId: cleanCourse(b.course || b.courseId),
    title: String(b.title || firstUser?.content || "Untitled chat").replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled chat",
    model: String(b.model || "").slice(0, 120),
    createdAt: typeof b.createdAt === "string" ? b.createdAt : now,
    updatedAt: now,
    messageCount: messages.length,
    preview: String(messages.at(-1)?.content || "").replace(/[`#*_>\n]+/g, " ").trim().slice(0, 160),
    messages,
  };
  if (JSON.stringify(chat).length > 15_000_000) return res.status(413).json({ error: "This chat is too big to save (too many images). Start a new chat." });

  const saved = await store.chats.replace(chat, { userId: req.user.id });
  if (!saved) return res.status(404).json({ error: "This chat no longer exists." });
  res.json({ ok: true, updatedAt: now, title: chat.title, course: chat.courseId });
}));

app.patch("/api/chats/:id", requireAuth, requireWrite, wrap(async (req, res) => {
  if (!ID.test(req.params.id)) return res.status(400).json({ error: "Bad chat id." });
  const fields = {};
  if (typeof req.body?.title === "string" && req.body.title.trim()) fields.title = req.body.title.trim().slice(0, 120);
  if (typeof req.body?.course === "string") fields.courseId = cleanCourse(req.body.course);
  if (!Object.keys(fields).length) return res.status(400).json({ error: "Nothing to change." });
  fields.updatedAt = new Date().toISOString();
  const updated = await store.chats.update(req.params.id, fields, { userId: req.user.id });
  if (!updated) return res.status(404).json({ error: "This chat no longer exists." });
  res.json({ ok: true, ...fields });
}));

app.delete("/api/chats/:id", requireAuth, wrap(async (req, res) => {
  if (!ID.test(req.params.id)) return res.status(400).json({ error: "Bad chat id." });
  await store.chats.remove(req.params.id, { userId: req.user.id });
  res.json({ ok: true });
}));

/* ---------------- admin ---------------- */
const adminOnly = [requireAuth, requireAdmin];

async function studentCard(user) {
  const subs = await store.subs.find({ userId: user.id }, { sort: { endDate: -1 } });
  return {
    id: user.id, username: user.username, name: user.name, phone: user.phone || "", email: user.email || "",
    accountStatus: user.accountStatus, adminNote: user.adminNote || "", lastLoginAt: user.lastLoginAt || null,
    createdAt: user.createdAt, access: accessState(user, subs), subscriptions: subs,
  };
}

app.get("/api/admin/students", ...adminOnly, wrap(async (req, res) => {
  const users = await store.users.find({ role: "student" });
  const all = await Promise.all(users.map(studentCard));
  const summary = { total: all.length, active: 0, expiringSoon: 0, expired: 0, suspended: 0, deactivated: 0, collected: 0 };
  for (const c of all) {
    summary[c.access.status] = (summary[c.access.status] || 0) + 1;
    if (c.access.status === "active" && c.access.daysLeft !== null && c.access.daysLeft <= 14) summary.expiringSoon++;
    for (const s of c.subscriptions) if (s.paymentStatus === "paid") summary.collected += Number(s.amount) || 0;
  }
  const q = String(req.query.q || "").toLowerCase().trim();
  let students = all;
  if (q) students = students.filter((c) => `${c.name} ${c.username} ${c.phone}`.toLowerCase().includes(q));
  if (req.query.status) students = students.filter((c) => c.access.status === req.query.status);
  students.sort((a, b) => a.name.localeCompare(b.name));
  res.json({ students, summary, settings: { semesterMonths: SEMESTER_MONTHS, graceDays: GRACE_DAYS, price: DEFAULT_PRICE, currency: CURRENCY, today: today() } });
}));

app.post("/api/admin/students", ...adminOnly, wrap(async (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 120);
  if (!name) return res.status(400).json({ error: "Type the student's name." });
  let username = String(req.body?.username || "").trim().toLowerCase() || auth.usernameFrom(name);
  if (!auth.isUsername(username)) return res.status(400).json({ error: "Username: 3-32 letters, digits, dot, dash or underscore." });
  if (await store.users.findOne({ username })) {
    if (req.body?.username) return res.status(409).json({ error: "That username is already taken." });
    username = `${username}.${crypto.randomInt(10, 99)}`;
  }
  const password = auth.generatePassword();
  const now = new Date().toISOString();
  const user = await store.users.insert({
    id: uid(), username, passwordHash: auth.hashPassword(password), name,
    phone: String(req.body?.phone || "").slice(0, 40), email: String(req.body?.email || "").slice(0, 120),
    role: "student", accountStatus: "active", courses: [], sessionVersion: 1,
    usage: { day: today(), messages: 0 }, adminNote: String(req.body?.note || "").slice(0, 500),
    lastLoginAt: null, createdAt: now, updatedAt: now,
  });
  res.json({ student: await studentCard(user), password });
}));

app.post("/api/admin/students/:id/password", ...adminOnly, wrap(async (req, res) => {
  const user = await store.users.findOne({ id: req.params.id, role: "student" });
  if (!user) return res.status(404).json({ error: "Student not found." });
  const password = auth.generatePassword();
  await store.users.update(user.id, {
    passwordHash: auth.hashPassword(password),
    sessionVersion: (user.sessionVersion || 1) + 1, // logs them out everywhere
    updatedAt: new Date().toISOString(),
  });
  res.json({ password });
}));

app.patch("/api/admin/students/:id", ...adminOnly, wrap(async (req, res) => {
  const user = await store.users.findOne({ id: req.params.id, role: "student" });
  if (!user) return res.status(404).json({ error: "Student not found." });
  const fields = { updatedAt: new Date().toISOString() };
  if (["active", "suspended", "deactivated"].includes(req.body?.accountStatus)) {
    fields.accountStatus = req.body.accountStatus;
    if (fields.accountStatus !== "active") fields.sessionVersion = (user.sessionVersion || 1) + 1;
  }
  for (const key of ["name", "phone", "email", "adminNote"]) {
    if (typeof req.body?.[key] === "string") fields[key] = req.body[key].slice(0, 500);
  }
  await store.users.update(user.id, fields);
  res.json({ student: await studentCard({ ...user, ...fields }) });
}));

app.post("/api/admin/students/:id/payments", ...adminOnly, wrap(async (req, res) => {
  const user = await store.users.findOne({ id: req.params.id, role: "student" });
  if (!user) return res.status(404).json({ error: "Student not found." });
  const subs = await store.subs.find({ userId: user.id });
  const state = accessState(user, subs);

  const free = req.body?.free === true;
  const months = Math.min(12, Math.max(1, Number(req.body?.months ?? SEMESTER_MONTHS)));
  let { startDate, endDate } = nextPeriod(state.until, months);
  if (isDate(req.body?.startDate)) startDate = req.body.startDate;
  if (isDate(req.body?.endDate)) endDate = req.body.endDate;
  if (endDate < startDate) return res.status(400).json({ error: "The end date is before the start date." });

  const now = new Date().toISOString();
  await store.subs.insert({
    id: uid(), userId: user.id,
    termLabel: String(req.body?.termLabel || "").slice(0, 60),
    startDate, endDate,
    amount: free ? 0 : Number(req.body?.amount ?? DEFAULT_PRICE) || 0,
    currency: CURRENCY, paymentMethod: "cash",
    paymentStatus: free ? "free" : "paid",
    paidAt: now, recordedBy: req.user.id,
    note: String(req.body?.note || "").slice(0, 300),
    createdAt: now, updatedAt: now,
  });
  // Paying brings a suspended account back to life
  const accountStatus = user.accountStatus === "suspended" ? "active" : user.accountStatus;
  if (accountStatus !== user.accountStatus) await store.users.update(user.id, { accountStatus, updatedAt: now });
  res.json({ student: await studentCard({ ...user, accountStatus }) });
}));

app.patch("/api/admin/payments/:id", ...adminOnly, wrap(async (req, res) => {
  const sub = await store.subs.findOne({ id: req.params.id });
  if (!sub) return res.status(404).json({ error: "Payment not found." });
  const status = req.body?.paymentStatus;
  if (!["paid", "free", "void"].includes(status)) return res.status(400).json({ error: "Bad status." });
  await store.subs.update(sub.id, { paymentStatus: status, updatedAt: new Date().toISOString() });
  const user = await store.users.findOne({ id: sub.userId });
  res.json({ student: await studentCard(user) });
}));

/* Counts only, never the content of a student's chats */
app.get("/api/admin/students/:id/usage", ...adminOnly, wrap(async (req, res) => {
  const user = await store.users.findOne({ id: req.params.id });
  if (!user) return res.status(404).json({ error: "Student not found." });
  const chats = await store.chats.find({ userId: user.id }, { sort: { updatedAt: -1 }, limit: 500 });
  res.json({
    chats: chats.length,
    messages: chats.reduce((n, c) => n + (c.messageCount || 0), 0),
    lastActivity: chats[0]?.updatedAt || null,
    today: user.usage?.day === today() ? user.usage.messages : 0,
    dailyLimit: DAILY_LIMIT,
  });
}));

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));
app.use((err, _req, res, _next) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: "Something went wrong on the server." });
});

app.listen(PORT, () => {
  console.log(`E-Learning Chat running on http://localhost:${PORT}`);
  console.log(`Semester: ${SEMESTER_MONTHS} months, grace: ${GRACE_DAYS} days, daily limit: ${DAILY_LIMIT} messages`);
  listModels().then(({ providers }) => {
    for (const p of providers) console.log(`  ${p.enabled ? "✓" : "·"} ${p.label}${p.error ? `  (${p.error})` : ""}`);
  });
});
