import { getJSON, sendJSON, api, onPasswordNeeded, setPassword } from "./api.js";
import { renderDashboard, renderCourse, courseById, shortName } from "./courses.js";
import { initChat, loadModels, newChat, openSavedChat, currentChatId } from "./chat.js";
import { ask, toast } from "./ui.js";

const view = document.getElementById("view");

onPasswordNeeded(async (wasWrong) => {
  const pw = await ask({
    title: "Enter the site password",
    text: "This site is private. The password is the ACCESS_PASSWORD you set on Render.",
    input: { type: "password", placeholder: "Password" },
    okText: "Unlock",
    error: wasWrong ? "That password is wrong. Try again." : "",
    cancel: false,
  });
  if (!pw) return false;
  setPassword(pw);
  return true;
});

/* ---------- Router ---------- */
let routeToken = 0;

async function route(scroll = true) {
  const token = ++routeToken;
  const match = location.hash.match(/^#\/course\/([\w.-]+)/);
  if (scroll) window.scrollTo(0, 0);
  document.getElementById("primaryNav").classList.remove("open");

  if (!match) {
    document.title = "My courses | E-Learning";
    renderDashboard(view, { counts: {}, onAsk: (id) => newChat(id) });
    try {
      const counts = await getJSON("/api/chats/counts");
      if (token === routeToken) renderDashboard(view, { counts, onAsk: (id) => newChat(id) });
    } catch (err) {
      toast(err.message, "error");
    }
    return;
  }

  const course = courseById(match[1]);
  document.title = `${shortName(course.id)} | E-Learning`;
  const handlers = {
    onOpen: (id) => openSavedChat(id),
    onNew: () => newChat(course.id),
    onRename: async (id) => {
      const current = view.querySelector(`[data-id="${CSS.escape(id)}"] .chat-row-title`)?.textContent || "";
      const title = await ask({ title: "Rename chat", input: { value: current }, okText: "Save" });
      if (!title) return;
      try {
        await sendJSON(`/api/chats/${id}`, "PATCH", { title });
        toast("Chat renamed.", "success");
        route(false);
      } catch (err) { toast(err.message, "error"); }
    },
    onDelete: async (id) => {
      const ok = await ask({ title: "Delete this chat?", text: "It will be removed for good, including its photos.", okText: "Delete", danger: true });
      if (!ok) return;
      try {
        await api(`/api/chats/${id}`, { method: "DELETE" });
        toast("Chat deleted.", "success");
        if (currentChatId() === id) newChat(course.id);
        route(false);
      } catch (err) { toast(err.message, "error"); }
    },
  };
  renderCourse(view, { course, chats: [], loading: true, ...handlers });
  try {
    const chats = await getJSON(`/api/chats?course=${encodeURIComponent(course.id)}`);
    if (token === routeToken) renderCourse(view, { course, chats, loading: false, ...handlers });
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ---------- Start ---------- */
const menuBtn = document.getElementById("menuBtn");
menuBtn.addEventListener("click", () => {
  const open = document.getElementById("primaryNav").classList.toggle("open");
  menuBtn.setAttribute("aria-expanded", open);
});

let refreshTimer;
const config = await fetch("/api/config").then((r) => r.json()).catch(() => ({ storage: "file" }));
initChat({
  storage: config.storage,
  // Re-draw the page (chat counts, course lists) whenever a chat is saved or moved
  onChange: () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => route(false), 300); },
});
window.addEventListener("hashchange", () => route());
await route();
loadModels();
