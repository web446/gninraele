/* =========================================================
   1) YOUR COURSES — edit this list
   ========================================================= */
const COURSES = [
  { code: "202710 - GRT581 - 11958", term: "FALL 2026-2027", color: "#10b58c", pattern: "plaid" },
  { code: "202710 - GEN499 - 12125", term: "FALL 2026-2027", color: "#f27ea3", pattern: "diamonds" },
  { code: "202710 - GRT531 - 10940", term: "FALL 2026-2027", color: "#9b93eb", pattern: "diamonds" },
  // Add the rest of your courses here (pattern: "plaid" | "diamonds" | "circles" | "tiles")
  { code: "202710 - COURSE4 - 00000", term: "FALL 2026-2027", color: "#f27ea3", pattern: "circles" },
  { code: "202710 - COURSE5 - 00000", term: "FALL 2026-2027", color: "#f27ea3", pattern: "tiles" },
  { code: "202710 - COURSE6 - 00000", term: "FALL 2026-2027", color: "#bdbdbd", pattern: "diamonds" },
];

/* =========================================================
   2) Moodle-style generated course images (SVG patterns)
   ========================================================= */
function hash(str) {
  let h = 2166136261;
  for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function patternImage({ code, color, pattern }) {
  const W = 600, H = 330, r = seeded(hash(code));
  const shade = () => `fill="${r() > 0.5 ? "#000" : "#fff"}" fill-opacity="${(0.02 + r() * 0.13).toFixed(3)}"`;
  let s = "";

  if (pattern === "diamonds") {
    const d = 90;
    for (let y = 0; y <= H / (d / 2) + 1; y++)
      for (let x = -1; x <= W / d + 1; x++) {
        const cx = x * d + (y % 2 ? d / 2 : 0), cy = y * (d / 2);
        s += `<polygon points="${cx},${cy - d / 2} ${cx + d / 2},${cy} ${cx},${cy + d / 2} ${cx - d / 2},${cy}" ${shade()} stroke="#fff" stroke-opacity=".08"/>`;
      }
  } else if (pattern === "plaid") {
    for (const dir of ["h", "v"]) {
      let p = 0;
      while (p < (dir === "h" ? H : W)) {
        const w = 5 + Math.floor(r() * 16);
        s += dir === "h"
          ? `<rect x="0" y="${p}" width="${W}" height="${w}" ${shade()}/>`
          : `<rect x="${p}" y="0" width="${w}" height="${H}" ${shade()}/>`;
        p += w + Math.floor(r() * 12);
      }
    }
  } else if (pattern === "circles") {
    const d = 50;
    for (let y = 0; y < H / d + 1; y++)
      for (let x = 0; x < W / d + 1; x++)
        s += `<circle cx="${x * d}" cy="${y * d}" r="${d / 2}" fill="none" stroke="#000" stroke-opacity="${(0.03 + r() * 0.1).toFixed(3)}" stroke-width="12"/>`;
  } else {
    const d = 55;
    for (let y = 0; y < H / d + 1; y++)
      for (let x = 0; x < W / d + 1; x++)
        s += `<rect x="${x * d}" y="${y * d}" width="${d}" height="${d}" ${shade()}/>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><rect width="${W}" height="${H}" fill="${color}"/>${s}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/* =========================================================
   3) Course grid, search, sort, view
   ========================================================= */
const grid = document.getElementById("courses");
const emptyMsg = document.getElementById("empty");
const searchInput = document.getElementById("search");
const sortSelect = document.getElementById("sortSelect");
const viewSelect = document.getElementById("viewSelect");
const statusFilter = document.getElementById("statusFilter");

function renderCourses() {
  const q = searchInput.value.trim().toLowerCase();
  let list = COURSES.filter((c) => c.code.toLowerCase().includes(q));
  if (statusFilter.value === "future" || statusFilter.value === "past") list = [];
  if (sortSelect.value === "name") list = [...list].sort((a, b) => a.code.localeCompare(b.code));

  grid.innerHTML = "";
  for (const c of list) {
    const card = document.createElement("article");
    card.className = "course";
    card.innerHTML = `
      <a class="course-img" href="#" tabindex="-1" aria-hidden="true" style='background-image:${patternImage(c)}'></a>
      <div class="course-body">
        <span class="term">${c.term}</span>
        <h3 class="course-title"><a href="#">${c.code}</a></h3>
        <button class="kebab" title="Ask the assistant about this course" aria-label="Ask the assistant about ${c.code}">
          <svg width="4" height="16" viewBox="0 0 4 16"><circle cx="2" cy="2" r="2"/><circle cx="2" cy="8" r="2"/><circle cx="2" cy="14" r="2"/></svg>
        </button>
      </div>`;
    const courseName = c.code.split(" - ")[1] || c.code;
    card.querySelector(".kebab").addEventListener("click", () => openChat(`[${courseName}] `));
    grid.appendChild(card);
  }
  emptyMsg.hidden = list.length > 0;
  grid.classList.toggle("list", viewSelect.value === "list");
}
[searchInput, sortSelect, viewSelect, statusFilter].forEach((el) => el.addEventListener("input", renderCourses));
renderCourses();

const menuBtn = document.getElementById("menuBtn");
const nav = document.getElementById("primaryNav");
menuBtn.addEventListener("click", () => {
  const open = nav.classList.toggle("open");
  menuBtn.setAttribute("aria-expanded", open);
});

/* =========================================================
   4) Chat assistant (streams from /api/chat → Ollama)
   ========================================================= */
const fab = document.getElementById("chatFab");
const chat = document.getElementById("chat");
const body = document.getElementById("chatBody");
const welcome = document.getElementById("chatWelcome");
const form = document.getElementById("chatForm");
const textarea = document.getElementById("chatText");
const sendBtn = document.getElementById("sendBtn");
const modelLabel = document.getElementById("chatModel");

const STORE_KEY = "elearning-chat-history";
const PW_KEY = "elearning-chat-password";
let history = [];
let controller = null;

try { history = JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { history = []; }
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(history.slice(-60))); } catch {} };

fetch("/api/config")
  .then((r) => r.json())
  .then((cfg) => { modelLabel.textContent = `Ollama · ${cfg.model}`; })
  .catch(() => { modelLabel.textContent = "Server offline"; });

function openChat(prefill = "") {
  chat.hidden = false;
  fab.setAttribute("aria-expanded", "true");
  if (prefill) textarea.value = prefill;
  textarea.focus();
  body.scrollTop = body.scrollHeight;
}
function closeChat() {
  chat.hidden = true;
  fab.setAttribute("aria-expanded", "false");
  fab.focus();
}
fab.addEventListener("click", () => (chat.hidden ? openChat() : closeChat()));
document.getElementById("closeChat").addEventListener("click", closeChat);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !chat.hidden) closeChat(); });

document.getElementById("newChat").addEventListener("click", () => {
  controller?.abort();
  history = [];
  save();
  body.querySelectorAll(".msg").forEach((m) => m.remove());
  welcome.hidden = false;
  textarea.focus();
});

body.querySelectorAll(".chip").forEach((chip) =>
  chip.addEventListener("click", () => { textarea.value = chip.textContent + ": "; textarea.focus(); })
);

// Markdown → safe HTML with highlighted, copyable code blocks
function renderMarkdown(el, text) {
  if (window.marked && window.DOMPurify) {
    el.innerHTML = DOMPurify.sanitize(marked.parse(text, { breaks: true, gfm: true }));
  } else {
    el.textContent = text; // CDN blocked: show plain text
    el.style.whiteSpace = "pre-wrap";
    return;
  }
  el.querySelectorAll("pre code").forEach((code) => {
    const pre = code.parentElement;
    const lang = (code.className.match(/language-([\w+#-]+)/) || [])[1];
    if (window.hljs) hljs.highlightElement(code);
    if (lang) {
      const tag = document.createElement("span");
      tag.className = "code-lang";
      tag.textContent = lang;
      pre.appendChild(tag);
    }
    const btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.type = "button";
    btn.textContent = "Copy";
    btn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(code.innerText); btn.textContent = "Copied"; }
      catch { btn.textContent = "Copy failed"; }
      setTimeout(() => (btn.textContent = "Copy"), 1500);
    });
    pre.appendChild(btn);
  });
}

function addMessage(role, text = "") {
  welcome.hidden = true;
  const el = document.createElement("div");
  el.className = `msg ${role === "user" ? "user" : role === "error" ? "error" : "bot"}`;
  if (role === "assistant") renderMarkdown(el, text);
  else el.textContent = text;
  body.appendChild(el);
  body.scrollTop = body.scrollHeight;
  return el;
}

function setBusy(busy) {
  sendBtn.classList.toggle("stop", busy);
  sendBtn.setAttribute("aria-label", busy ? "Stop" : "Send");
  sendBtn.innerHTML = busy
    ? '<svg width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" rx="2" fill="currentColor"/></svg>'
    : '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 20.5 21 12 3 3.5 3 10l12 2-12 2z"/></svg>';
}

async function send(text) {
  history.push({ role: "user", content: text });
  save();
  addMessage("user", text);

  const botEl = addMessage("assistant");
  botEl.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
  let reply = "";
  let frame = 0;
  const paint = () => {
    frame = 0;
    const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
    renderMarkdown(botEl, reply);
    if (nearBottom) body.scrollTop = body.scrollHeight;
  };

  controller = new AbortController();
  let retry = false;
  setBusy(true);
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-access-password": localStorage.getItem(PW_KEY) || "" },
      body: JSON.stringify({ messages: history }),
      signal: controller.signal,
    });

    if (res.status === 401) {
      const pw = prompt("This assistant is password-protected. Enter the access password:");
      botEl.remove();
      history.pop();
      body.lastElementChild?.remove();
      if (pw) { localStorage.setItem(PW_KEY, pw); retry = true; return; }
      throw new Error("Access password required.");
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const data = JSON.parse(line);
        if (data.error) throw new Error(data.error);
        if (data.message?.content) {
          reply += data.message.content;
          if (!frame) frame = requestAnimationFrame(paint);
        }
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      if (!reply) botEl.remove();
      addMessage("error", err.message || "Something went wrong.");
    }
  } finally {
    cancelAnimationFrame(frame);
    if (reply) {
      renderMarkdown(botEl, reply);
      history.push({ role: "assistant", content: reply });
      save();
    } else if (botEl.isConnected) {
      botEl.remove();
    }
    controller = null;
    setBusy(false);
  }
  if (retry) return send(text);
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (controller) { controller.abort(); return; } // acts as Stop while streaming
  const text = textarea.value.trim();
  if (!text) return;
  textarea.value = "";
  textarea.style.height = "auto";
  send(text);
});

textarea.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    form.requestSubmit();
  }
});
textarea.addEventListener("input", () => {
  textarea.style.height = "auto";
  textarea.style.height = Math.min(textarea.scrollHeight, 180) + "px";
});

// Restore previous conversation
for (const m of history) addMessage(m.role, m.content);
