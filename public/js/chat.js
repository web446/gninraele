import { api, getJSON, sendJSON } from "./api.js";
import { allCourses, courseById, shortName } from "./courses.js";
import { ask, toast, showImage, timeAgo, esc, uid } from "./ui.js";

const $ = (id) => document.getElementById(id);
const el = {
  fab: $("chatFab"), chat: $("chat"), body: $("chatBody"), welcome: $("chatWelcome"),
  title: $("chatTitle"), sub: $("chatSub"),
  historyBtn: $("historyBtn"), newBtn: $("newChatBtn"), expandBtn: $("expandBtn"), closeBtn: $("closeChat"),
  modelBtn: $("modelBtn"), modelName: $("modelName"), modelTier: $("modelTier"),
  modelMenu: $("modelMenu"), modelSearch: $("modelSearch"), modelList: $("modelList"), modelRefresh: $("modelRefresh"),
  courseSelect: $("courseSelect"),
  history: $("historyPane"), historyFilter: $("historyFilter"), historyList: $("historyList"), storageWarn: $("storageWarn"),
  form: $("composer"), text: $("chatText"), send: $("sendBtn"), attachBtn: $("attachBtn"), fileInput: $("fileInput"),
  strip: $("attachStrip"), warn: $("composerWarn"), drop: $("dropOverlay"),
};

const MODEL_KEY = "elc-model";
const MAX_IMAGES = 6;
const TEXT_EXT = /\.(txt|md|py|js|ts|jsx|tsx|java|c|h|cpp|hpp|cs|m|sql|sh|json|xml|html|css|ya?ml|csv|log|ino|vhd|v|go|rs|php|rb|kt|swift)$/i;

const state = {
  chat: blankChat("GENERAL"),
  models: [],
  providers: [],
  modelId: localStorage.getItem(MODEL_KEY) || "",
  attachments: [],
  controller: null,
  saving: null,
  onChange: () => {},
};

function blankChat(course) {
  return { id: null, course, title: "", createdAt: null, messages: [] };
}

/* ======================= Rendering ======================= */

function renderMarkdown(target, text) {
  if (!(window.marked && window.DOMPurify)) {
    target.textContent = text;
    target.style.whiteSpace = "pre-wrap";
    return;
  }
  target.innerHTML = DOMPurify.sanitize(marked.parse(text, { breaks: true, gfm: true }));
  target.querySelectorAll("a").forEach((a) => { a.target = "_blank"; a.rel = "noopener noreferrer"; });
  target.querySelectorAll("pre code").forEach((code) => {
    const pre = code.parentElement;
    const lang = (code.className.match(/language-([\w+#-]+)/) || [])[1];
    if (window.hljs) hljs.highlightElement(code);
    const bar = document.createElement("div");
    bar.className = "code-bar";
    bar.innerHTML = `<span>${esc(lang || "code")}</span><button type="button">Copy</button>`;
    bar.querySelector("button").addEventListener("click", (e) => copy(code.innerText, e.currentTarget));
    pre.prepend(bar);
  });
}

async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = "Copied";
    setTimeout(() => (btn.textContent = old), 1400);
  } catch {
    toast("Couldn't copy. Select the text and press Ctrl+C.", "error");
  }
}

function messageEl(m) {
  const wrap = document.createElement("div");
  if (m.role === "user") {
    wrap.className = "msg user";
    const imgs = (m.images || []).map((src, i) => `<button type="button" class="msg-img" data-i="${i}"><img src="${src}" alt="Attached image ${i + 1}" /></button>`).join("");
    const files = (m.files || []).map((f) => `<span class="file-chip">${fileIcon}${esc(f.name)}</span>`).join("");
    wrap.innerHTML = `${imgs ? `<div class="msg-imgs">${imgs}</div>` : ""}${files ? `<div class="msg-files">${files}</div>` : ""}${m.content ? `<div class="msg-text"></div>` : ""}`;
    if (m.content) wrap.querySelector(".msg-text").textContent = m.content;
    wrap.querySelectorAll(".msg-img").forEach((b) => b.addEventListener("click", () => showImage(m.images[b.dataset.i])));
  } else {
    wrap.className = "msg bot";
    wrap.innerHTML = `<div class="msg-md"></div><div class="msg-foot"><span class="msg-model"></span><button type="button" class="msg-copy">Copy</button></div>`;
    renderMarkdown(wrap.querySelector(".msg-md"), m.content || "");
    wrap.querySelector(".msg-model").textContent = m.model || "";
    wrap.querySelector(".msg-copy").addEventListener("click", (e) => copy(m.content || "", e.currentTarget));
  }
  return wrap;
}

const fileIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></svg>';

function renderMessages() {
  el.body.querySelectorAll(".msg").forEach((n) => n.remove());
  el.welcome.hidden = state.chat.messages.length > 0;
  for (const m of state.chat.messages) el.body.appendChild(messageEl(m));
  el.body.scrollTop = el.body.scrollHeight;
}

function renderHeader(status) {
  const c = state.chat;
  el.title.textContent = c.title || "New chat";
  el.sub.textContent = status ?? (c.id ? `Saved in ${shortName(c.course)}` : `Will be saved in ${shortName(c.course)}`);
  el.courseSelect.value = c.course;
}

function fillCourseSelects() {
  const opts = allCourses().map((c) => `<option value="${esc(c.id)}">${esc(c.id === "GENERAL" ? "General" : c.id)}</option>`).join("");
  el.courseSelect.innerHTML = opts;
  el.historyFilter.innerHTML = `<option value="">All courses</option>${opts}`;
}

/* ======================= Models ======================= */

const currentModel = () => state.models.find((m) => m.id === state.modelId);

function renderModelButton() {
  const m = currentModel();
  el.modelName.textContent = m ? m.label : state.models.length ? "Choose a model" : "No models available";
  el.modelTier.hidden = !m;
  if (m) {
    el.modelTier.textContent = m.tier === "free" ? "Free" : "Paid";
    el.modelTier.className = `tier-pill ${m.tier}`;
  }
  updateWarning();
}

function renderModelList() {
  const q = el.modelSearch.value.trim().toLowerCase();
  let html = "";
  for (const p of state.providers) {
    if (!p.enabled) continue;
    const list = state.models.filter((m) => m.provider === p.id && (!q || `${m.label} ${m.model} ${p.label}`.toLowerCase().includes(q)));
    if (!list.length) continue;
    html += `<div class="model-group"><div class="model-group-head"><span>${esc(p.label)}</span><span class="tier-pill ${p.tier}">${p.tier === "free" ? "Free" : "Paid"}</span></div>`;
    if (p.error) html += `<p class="model-group-note">${esc(p.error)}</p>`;
    html += list
      .map(
        (m) => `<button type="button" role="option" class="model-item ${m.id === state.modelId ? "selected" : ""}" data-id="${esc(m.id)}" aria-selected="${m.id === state.modelId}">
          <span class="model-item-name">${esc(m.label)}</span>
          ${m.label !== m.model ? `<span class="model-item-id">${esc(m.model)}</span>` : ""}
          ${m.vision ? '<span class="vision-tag" title="Can read images">Images</span>' : ""}
        </button>`
      )
      .join("");
    html += `</div>`;
  }
  const off = state.providers.filter((p) => !p.enabled);
  if (off.length && !q) {
    html += `<div class="model-off"><strong>Not connected yet</strong>${off
      .map((p) => `<span>${esc(p.label)}: add <code>${esc(p.keyEnv)}</code> on Render. ${esc(p.note)}.</span>`)
      .join("")}</div>`;
  }
  el.modelList.innerHTML = html || `<p class="model-empty">${q ? "No models match your search." : "No providers are connected. Add an API key on Render."}</p>`;
  el.modelList.querySelectorAll(".model-item").forEach((b) =>
    b.addEventListener("click", () => {
      state.modelId = b.dataset.id;
      localStorage.setItem(MODEL_KEY, state.modelId);
      renderModelButton();
      toggleModelMenu(false);
      el.text.focus();
    })
  );
}

function placeOverlay(panel) {
  const controls = el.chat.querySelector(".chat-controls");
  panel.style.top = `${controls.offsetTop + controls.offsetHeight + 6}px`;
}

function toggleModelMenu(open = el.modelMenu.hidden) {
  if (open) placeOverlay(el.modelMenu);
  el.modelMenu.hidden = !open;
  el.modelBtn.setAttribute("aria-expanded", open);
  if (open) {
    el.history.hidden = true;
    el.modelSearch.value = "";
    renderModelList();
    el.modelSearch.focus();
    el.modelList.querySelector(".selected")?.scrollIntoView({ block: "center" });
  }
}

export async function loadModels(force = false) {
  el.modelName.textContent = "Loading models…";
  try {
    const data = await getJSON(`/api/models${force ? "?refresh=1" : ""}`);
    state.models = data.models;
    state.providers = data.providers;
    if (!currentModel()) {
      const pick = state.models.find((m) => m.tier === "free" && m.vision) || state.models[0];
      state.modelId = pick?.id || "";
    }
  } catch (err) {
    toast(err.message, "error");
  }
  renderModelButton();
  if (!el.modelMenu.hidden) renderModelList();
}

/* ======================= Attachments ======================= */

async function compressImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.85);
}

async function addFiles(fileList) {
  const files = [...fileList];
  for (const file of files) {
    const isImage = file.type.startsWith("image/");
    try {
      if (isImage) {
        if (state.attachments.filter((a) => a.kind === "image").length >= MAX_IMAGES) {
          toast(`You can attach up to ${MAX_IMAGES} photos per message.`, "error");
          break;
        }
        if (file.size > 25 * 1024 * 1024) throw new Error("is larger than 25 MB");
        state.attachments.push({ kind: "image", name: file.name, dataUrl: await compressImage(file) });
      } else if (file.type.startsWith("text/") || TEXT_EXT.test(file.name)) {
        if (file.size > 300 * 1024) throw new Error("is larger than 300 KB");
        state.attachments.push({ kind: "file", name: file.name, text: await file.text() });
      } else {
        throw new Error("isn't a photo or a code/text file");
      }
    } catch (err) {
      const why = err?.message?.startsWith("is") ? err.message : "couldn't be read (HEIC photos aren't supported, try JPG or PNG)";
      toast(`${file.name} ${why}.`, "error");
    }
  }
  renderAttachments();
}

function renderAttachments() {
  el.strip.hidden = state.attachments.length === 0;
  el.strip.innerHTML = state.attachments
    .map((a, i) =>
      a.kind === "image"
        ? `<div class="att att-img"><img src="${a.dataUrl}" alt="${esc(a.name)}" /><button type="button" data-rm="${i}" aria-label="Remove ${esc(a.name)}">×</button></div>`
        : `<div class="att att-file">${fileIcon}<span>${esc(a.name)}</span><button type="button" data-rm="${i}" aria-label="Remove ${esc(a.name)}">×</button></div>`
    )
    .join("");
  el.strip.querySelectorAll("[data-rm]").forEach((b) =>
    b.addEventListener("click", () => {
      state.attachments.splice(Number(b.dataset.rm), 1);
      renderAttachments();
    })
  );
  updateWarning();
}

function updateWarning() {
  const m = currentModel();
  const hasImages = state.attachments.some((a) => a.kind === "image");
  const blocked = hasImages && m && !m.vision;
  el.warn.hidden = !blocked;
  if (blocked) el.warn.textContent = `${m.label} can't read photos. Pick a model tagged "Images" to send them.`;
  return blocked;
}

/* ======================= Sending & saving ======================= */

function setBusy(busy) {
  el.send.classList.toggle("stop", busy);
  el.send.setAttribute("aria-label", busy ? "Stop" : "Send");
  el.send.innerHTML = busy
    ? '<svg width="14" height="14" viewBox="0 0 16 16"><rect width="16" height="16" rx="2" fill="currentColor"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3 20.5 21 12 3 3.5 3 10l12 2-12 2z"/></svg>';
}

function makeTitle(m) {
  const t = (m.content || "").replace(/\s+/g, " ").trim();
  if (t) return t.length > 60 ? `${t.slice(0, 57)}…` : t;
  if (m.images?.length) return "Photo question";
  if (m.files?.length) return `About ${m.files[0].name}`;
  return "New chat";
}

async function saveChat(c = state.chat) {
  if (!c.id || !c.messages.length) return;
  const isCurrent = () => state.chat === c;
  const job = (async () => {
    if (isCurrent()) renderHeader("Saving…");
    try {
      const r = await sendJSON(`/api/chats/${c.id}`, "PUT", {
        course: c.course, title: c.title, createdAt: c.createdAt,
        model: currentModel()?.label || "", messages: c.messages,
      });
      c.title = r.title;
      if (isCurrent()) renderHeader();
      state.onChange();
    } catch (err) {
      if (isCurrent()) renderHeader("Not saved");
      toast(`Couldn't save the chat: ${err.message}`, "error");
    }
  })();
  state.saving = job;
  await job;
}

async function send() {
  const text = el.text.value.trim();
  const images = state.attachments.filter((a) => a.kind === "image").map((a) => a.dataUrl);
  const files = state.attachments.filter((a) => a.kind === "file").map(({ name, text }) => ({ name, text }));
  if (!text && !images.length && !files.length) return;
  const model = currentModel();
  if (!model) { toast("Choose a model first.", "error"); toggleModelMenu(true); return; }
  if (updateWarning()) return;

  const c = state.chat;
  if (!c.id) { c.id = uid(); c.createdAt = new Date().toISOString(); }
  const userMsg = { role: "user", content: text, images, files, at: new Date().toISOString() };
  c.messages.push(userMsg);
  if (!c.title) c.title = makeTitle(userMsg);

  el.text.value = "";
  el.text.style.height = "auto";
  state.attachments = [];
  renderAttachments();
  el.welcome.hidden = true;
  el.body.appendChild(messageEl(userMsg));
  renderHeader("Thinking…");

  const bot = document.createElement("div");
  bot.className = "msg bot";
  bot.innerHTML = `<div class="msg-md"><span class="typing"><span></span><span></span><span></span></span></div><div class="msg-foot"><span class="msg-model"></span></div>`;
  bot.querySelector(".msg-model").textContent = model.label;
  el.body.appendChild(bot);
  el.body.scrollTop = el.body.scrollHeight;
  const md = bot.querySelector(".msg-md");

  let reply = "";
  let frame = 0;
  let failure = null;
  const paint = () => {
    frame = 0;
    const nearBottom = el.body.scrollHeight - el.body.scrollTop - el.body.clientHeight < 120;
    renderMarkdown(md, reply);
    if (nearBottom) el.body.scrollTop = el.body.scrollHeight;
  };

  state.controller = new AbortController();
  setBusy(true);
  try {
    const res = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({ model: model.id, messages: c.messages }),
      signal: state.controller.signal,
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const data = JSON.parse(line);
        if (data.error) throw new Error(data.error);
        if (data.t) {
          reply += data.t;
          if (!frame) frame = requestAnimationFrame(paint);
        }
      }
    }
    if (!reply) failure = "The model returned an empty answer. Try again or pick another model.";
  } catch (err) {
    if (err.name !== "AbortError") failure = err.message || "Something went wrong.";
  } finally {
    cancelAnimationFrame(frame);
    state.controller = null;
    setBusy(false);
  }

  bot.remove();
  const visible = state.chat === c;
  if (reply) {
    const botMsg = { role: "assistant", content: reply, model: model.label, at: new Date().toISOString() };
    c.messages.push(botMsg);
    if (visible) el.body.appendChild(messageEl(botMsg));
  }
  if (failure && visible) {
    const err = document.createElement("div");
    err.className = "msg error";
    err.textContent = failure;
    el.body.appendChild(err);
  }
  if (visible) el.body.scrollTop = el.body.scrollHeight;
  await saveChat(c);
}

/* ======================= History ======================= */

async function renderHistory() {
  el.historyList.innerHTML = `<p class="history-empty">Loading…</p>`;
  try {
    const course = el.historyFilter.value;
    const chats = await getJSON(`/api/chats${course ? `?course=${encodeURIComponent(course)}` : ""}`);
    el.historyList.innerHTML = chats.length
      ? chats
          .map(
            (c) => `<button type="button" class="history-item ${c.id === state.chat.id ? "current" : ""}" data-id="${esc(c.id)}">
              <span class="history-title">${esc(c.title)}</span>
              <span class="history-meta"><span class="course-tag">${esc(shortName(c.course))}</span>${esc(timeAgo(c.updatedAt))}, ${c.messageCount} msgs</span>
            </button>`
          )
          .join("")
      : `<p class="history-empty">No saved chats${course ? " in this course" : ""} yet.</p>`;
    el.historyList.querySelectorAll(".history-item").forEach((b) => b.addEventListener("click", () => openSavedChat(b.dataset.id)));
  } catch (err) {
    el.historyList.innerHTML = `<p class="history-empty">${esc(err.message)}</p>`;
  }
}

function toggleHistory(open = el.history.hidden) {
  if (open) placeOverlay(el.history);
  el.history.hidden = !open;
  el.historyBtn.classList.toggle("active", open);
  if (open) {
    toggleModelMenu(false);
    renderHistory();
  }
}

/* ======================= Public API ======================= */

export function openPanel() {
  el.chat.hidden = false;
  el.fab.setAttribute("aria-expanded", "true");
  el.text.focus();
}

function closePanel() {
  el.chat.hidden = true;
  el.fab.setAttribute("aria-expanded", "false");
  toggleModelMenu(false);
  toggleHistory(false);
}

/** Starts a fresh chat. The current one is already saved after every reply. */
export async function newChat(course = state.chat.course) {
  state.controller?.abort();
  if (state.saving) await state.saving;
  const hadMessages = state.chat.messages.length > 0;
  state.chat = blankChat(course);
  state.attachments = [];
  renderAttachments();
  renderMessages();
  renderHeader();
  toggleHistory(false);
  openPanel();
  if (hadMessages) toast("Previous chat saved. New chat started.", "success");
}

export async function openSavedChat(id) {
  state.controller?.abort();
  if (state.saving) await state.saving;
  try {
    const chat = await getJSON(`/api/chats/${encodeURIComponent(id)}`);
    state.chat = chat;
    renderMessages();
    renderHeader();
    toggleHistory(false);
    openPanel();
  } catch (err) {
    toast(err.message, "error");
  }
}

export const currentChatId = () => state.chat.id;

export function initChat({ onChange, storage }) {
  state.onChange = onChange;
  el.storageWarn.hidden = storage !== "file";
  fillCourseSelects();
  renderHeader();
  setBusy(false);

  el.fab.addEventListener("click", () => (el.chat.hidden ? openPanel() : closePanel()));
  el.closeBtn.addEventListener("click", closePanel);
  el.newBtn.addEventListener("click", () => newChat());
  el.historyBtn.addEventListener("click", () => toggleHistory());
  el.historyFilter.addEventListener("change", renderHistory);
  el.expandBtn.addEventListener("click", () => {
    const full = el.chat.classList.toggle("full");
    el.expandBtn.title = full ? "Shrink" : "Expand";
  });
  el.modelBtn.addEventListener("click", () => toggleModelMenu());
  el.modelSearch.addEventListener("input", renderModelList);
  el.modelRefresh.addEventListener("click", () => loadModels(true));

  el.courseSelect.addEventListener("change", async () => {
    const course = el.courseSelect.value;
    state.chat.course = course;
    renderHeader();
    if (state.chat.id && state.chat.messages.length) {
      try {
        await sendJSON(`/api/chats/${state.chat.id}`, "PATCH", { course });
        toast(`Chat moved to ${shortName(course)}.`, "success");
        state.onChange();
      } catch (err) {
        toast(err.message, "error");
      }
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || document.querySelector("dialog[open]")) return;
    if (!el.modelMenu.hidden) toggleModelMenu(false);
    else if (!el.history.hidden) toggleHistory(false);
    else if (!el.chat.hidden) closePanel();
  });
  document.addEventListener("click", (e) => {
    if (!el.modelMenu.hidden && !el.modelMenu.contains(e.target) && !el.modelBtn.contains(e.target)) toggleModelMenu(false);
  });

  el.body.querySelectorAll(".chip").forEach((chip) =>
    chip.addEventListener("click", () => { el.text.value = `${chip.textContent}: `; el.text.focus(); })
  );

  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (state.controller) { state.controller.abort(); return; }
    send();
  });
  el.text.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      el.form.requestSubmit();
    }
  });
  el.text.addEventListener("input", () => {
    el.text.style.height = "auto";
    el.text.style.height = `${Math.min(el.text.scrollHeight, 200)}px`;
  });
  el.text.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  });

  el.attachBtn.addEventListener("click", () => el.fileInput.click());
  el.fileInput.addEventListener("change", () => { addFiles(el.fileInput.files); el.fileInput.value = ""; });

  // Drag & drop anywhere on the page opens the chat and attaches the files
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  document.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    depth++;
    if (el.chat.hidden) openPanel();
    el.drop.hidden = false;
  });
  document.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) el.drop.hidden = true;
  });
  document.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    el.drop.hidden = true;
    addFiles(e.dataTransfer.files);
  });
}
