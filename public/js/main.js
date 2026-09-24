import { getJSON, sendJSON, api, logout } from "./api.js";
import { renderDashboard, renderCourse, courseById, shortName, setCourses, getCourses, toStored } from "./courses.js";
import { initChat, loadModels, newChat, openSavedChat, currentChatId, refreshCourses, setAccess } from "./chat.js";
import { ask, askCourse, toast } from "./ui.js";

const view = document.getElementById("view");
let me = null;

/* ---------- Courses (saved inside the student's account) ---------- */
async function saveCourses(list) {
  const { courses } = await sendJSON("/api/me/courses", "PUT", { courses: list });
  setCourses(courses);
  refreshCourses();
  return courses;
}

async function addCourse() {
  const c = await askCourse();
  if (!c) return;
  if (getCourses().some((x) => x.id === c.id)) return toast("You already have a course with that code.", "error");
  try {
    await saveCourses([...toStored(), c]);
    toast("Course added.", "success");
    route(false);
  } catch (err) { toast(err.message, "error"); }
}

async function editCourse(id) {
  const current = getCourses().find((c) => c.id === id);
  if (!current) return;
  const c = await askCourse(current);
  if (!c) return;
  try {
    await saveCourses(toStored().map((x) => (x.id === id ? { ...c, id } : x)));
    toast("Course updated.", "success");
    route(false);
  } catch (err) { toast(err.message, "error"); }
}

async function deleteCourse(id) {
  const ok = await ask({
    title: `Remove ${id}?`,
    text: "The course card is removed. Chats saved in it stay in your account and move to General in the list.",
    okText: "Remove", danger: true,
  });
  if (!ok) return;
  try {
    await saveCourses(toStored().filter((c) => c.id !== id));
    toast("Course removed.", "success");
    location.hash = "#/";
    route();
  } catch (err) { toast(err.message, "error"); }
}

/* ---------- Router ---------- */
let routeToken = 0;

async function route(scroll = true) {
  const token = ++routeToken;
  const match = location.hash.match(/^#\/course\/([\w.-]+)/);
  if (scroll) window.scrollTo(0, 0);
  document.getElementById("primaryNav").classList.remove("open");

  if (!match) {
    document.title = "My courses | E-Learning";
    const draw = (counts) => renderDashboard(view, { counts, onAsk: (id) => newChat(id), onAddCourse: addCourse, onEditCourse: editCourse });
    draw({});
    try {
      const counts = await getJSON("/api/chats/counts");
      if (token === routeToken) draw(counts);
    } catch (err) { toast(err.message, "error"); }
    return;
  }

  const course = courseById(match[1]);
  document.title = `${shortName(course.id)} | E-Learning`;
  const handlers = {
    onOpen: (id) => openSavedChat(id),
    onNew: () => newChat(course.id),
    onEditCourse: editCourse,
    onDeleteCourse: deleteCourse,
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
  } catch (err) { toast(err.message, "error"); }
}

/* ---------- Account bar ---------- */
function renderAccount() {
  document.getElementById("userName").textContent = me.name || me.username;
  const adminLink = document.getElementById("adminLink");
  adminLink.hidden = me.role !== "admin";

  const bar = document.getElementById("statusBar");
  const a = me.access || {};
  if (me.role === "admin" || a.status === "active" && !a.inGrace && !(a.daysLeft !== null && a.daysLeft <= 14)) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  if (a.status === "expired") {
    bar.className = "status-bar danger";
    bar.textContent = a.until
      ? `Your subscription ended on ${a.until}. You can read your old chats, but you can't send new messages. Please pay for the new semester.`
      : "You don't have an active subscription yet. Please contact your teacher.";
  } else {
    bar.className = "status-bar warn";
    bar.textContent = a.inGrace
      ? `Your semester ended on ${a.until}. You have a short grace period, so please pay soon.`
      : `Your subscription ends on ${a.until} (${a.daysLeft} day${a.daysLeft === 1 ? "" : "s"} left).`;
  }
}

/* ---------- Start ---------- */
const menuBtn = document.getElementById("menuBtn");
menuBtn.addEventListener("click", () => {
  const open = document.getElementById("primaryNav").classList.toggle("open");
  menuBtn.setAttribute("aria-expanded", open);
});
document.getElementById("logoutBtn").addEventListener("click", logout);

const { user } = await getJSON("/api/me");
me = user;
setCourses(user.courses);
renderAccount();

let refreshTimer;
initChat({
  storage: "mongodb",
  onChange: () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => route(false), 300); },
});
refreshCourses();
setAccess(user.access);
window.addEventListener("hashchange", () => route());
await route();
loadModels();
