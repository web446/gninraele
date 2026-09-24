import { esc, timeAgo } from "./ui.js";

/* Courses now belong to each student and come from the server (User.courses). */
let COURSES = [];

export function setCourses(list) {
  COURSES = (Array.isArray(list) ? list : []).map((c) => ({
    id: String(c.id || "").toUpperCase(),
    code: c.title || c.id,
    title: c.title || c.id,
    term: c.term || "",
    color: c.color || "#10b58c",
    pattern: c.pattern || "diamonds",
  }));
  return COURSES;
}
export const getCourses = () => COURSES;
export const toStored = () => COURSES.map(({ id, title, term, color, pattern }) => ({ id, title, term, color, pattern }));

export const GENERAL = { id: "GENERAL", code: "General (no course)", title: "General", term: "", color: "#6b7a90", pattern: "tiles" };
export const allCourses = () => [...COURSES, GENERAL];
export const courseById = (id) => allCourses().find((c) => c.id === id) || { ...GENERAL, id, code: id, title: id };
export const shortName = (id) => (id === "GENERAL" ? "General" : id);

/* ---------- Moodle-style generated course images ---------- */
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
const imageCache = new Map();
export function patternImage({ code, color, pattern }) {
  const key = `${code}|${color}|${pattern}`;
  if (imageCache.has(key)) return imageCache.get(key);
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
        s += dir === "h" ? `<rect x="0" y="${p}" width="${W}" height="${w}" ${shade()}/>` : `<rect x="${p}" y="0" width="${w}" height="${H}" ${shade()}/>`;
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
      for (let x = 0; x < W / d + 1; x++) s += `<rect x="${x * d}" y="${y * d}" width="${d}" height="${d}" ${shade()}/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><rect width="${W}" height="${H}" fill="${color}"/>${s}</svg>`;
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  imageCache.set(key, url);
  return url;
}

const icon = {
  chat: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  kebab: '<svg width="4" height="16" viewBox="0 0 4 16" fill="currentColor"><circle cx="2" cy="2" r="2"/><circle cx="2" cy="8" r="2"/><circle cx="2" cy="14" r="2"/></svg>',
  pencil: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>',
};

/* ---------- Dashboard: My courses ---------- */
export function renderDashboard(view, { counts = {}, onAsk, onAddCourse, onEditCourse }) {
  view.innerHTML = `
    <div class="toolbar">
      <div class="select-wrap">
        <select id="statusFilter" aria-label="Filter courses">
          <option value="inprogress">In progress</option><option value="all">All</option>
          <option value="future">Future</option><option value="past">Past</option>
        </select>
      </div>
      <div class="toolbar-right">
        <label class="search">
          <input id="search" type="search" placeholder="Search" aria-label="Search courses" />
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
        </label>
        <div class="select-wrap">
          <select id="sortSelect" aria-label="Sort courses">
            <option value="accessed">Sort by last accessed</option><option value="name">Sort by course name</option>
          </select>
        </div>
        <div class="select-wrap">
          <select id="viewSelect" aria-label="Display"><option value="card">Card</option><option value="list">List</option></select>
        </div>
      </div>
    </div>
    <section class="courses" id="courses"></section>
    <p class="empty" id="empty" hidden>No courses match your search.</p>
    <a class="general-link" href="#/course/GENERAL">${icon.chat} General chats (not linked to a course)${counts.GENERAL ? ` <span class="count-pill">${counts.GENERAL}</span>` : ""}</a>`;

  const grid = view.querySelector("#courses");
  const search = view.querySelector("#search");
  const sort = view.querySelector("#sortSelect");
  const display = view.querySelector("#viewSelect");
  const status = view.querySelector("#statusFilter");
  display.value = localStorage.getItem("elc-view") || "card";

  const draw = () => {
    const q = search.value.trim().toLowerCase();
    let list = COURSES.filter((c) => c.code.toLowerCase().includes(q));
    if (status.value === "future" || status.value === "past") list = [];
    if (sort.value === "name") list = [...list].sort((a, b) => a.code.localeCompare(b.code));
    grid.classList.toggle("list", display.value === "list");
    localStorage.setItem("elc-view", display.value);
    grid.innerHTML = list
      .map((c) => {
        const n = counts[c.id] || 0;
        return `
        <article class="course">
          <a class="course-img" href="#/course/${esc(c.id)}" tabindex="-1" aria-hidden="true" style='background-image:${patternImage(c)}'></a>
          <div class="course-body">
            <span class="term">${esc(c.term)}</span>
            <h3 class="course-title"><a href="#/course/${esc(c.id)}">${esc(c.code)}</a></h3>
            <div class="course-foot">
              <a class="chat-count ${n ? "" : "zero"}" href="#/course/${esc(c.id)}">${icon.chat}${n ? `${n} saved chat${n > 1 ? "s" : ""}` : "No chats yet"}</a>
              <span class="course-actions">
                <button class="kebab" data-edit="${esc(c.id)}" title="Edit this course" aria-label="Edit ${esc(c.code)}">${icon.pencil}</button>
                <button class="kebab" data-ask="${esc(c.id)}" title="New AI chat in this course" aria-label="New AI chat in ${esc(c.code)}">${icon.chat}</button>
              </span>
            </div>
          </div>
        </article>`;
      })
      .join("") + `
        <button class="course add-course" id="addCourse">
          <span class="add-course-plus">+</span>
          <span>Add a course</span>
        </button>`;
    view.querySelector("#empty").hidden = list.length > 0 || !q;
    grid.querySelectorAll("[data-ask]").forEach((b) => b.addEventListener("click", () => onAsk(b.dataset.ask)));
    grid.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => onEditCourse(b.dataset.edit)));
    grid.querySelector("#addCourse").addEventListener("click", onAddCourse);
  };
  [search, sort, display, status].forEach((el) => el.addEventListener("input", draw));
  draw();
}

/* ---------- Course page with saved chats ---------- */
export function renderCourse(view, { course, chats, loading, onOpen, onNew, onRename, onDelete, onEditCourse, onDeleteCourse }) {
  const rows = loading
    ? `<div class="chat-rows-loading">Loading saved chats…</div>`
    : chats.length
    ? chats
        .map(
          (c) => `
      <div class="chat-row" data-id="${esc(c.id)}">
        <button class="chat-row-main" data-open="${esc(c.id)}">
          <span class="chat-row-icon">${icon.chat}</span>
          <span class="chat-row-text">
            <span class="chat-row-title">${esc(c.title)}</span>
            <span class="chat-row-meta">${esc(c.model || "")}${c.model ? ", " : ""}${c.messageCount} message${c.messageCount === 1 ? "" : "s"}, updated ${esc(timeAgo(c.updatedAt))}</span>
            ${c.preview ? `<span class="chat-row-preview">${esc(c.preview)}</span>` : ""}
          </span>
        </button>
        <div class="chat-row-actions">
          <button class="row-btn" data-rename="${esc(c.id)}" title="Rename" aria-label="Rename">${icon.pencil}</button>
          <button class="row-btn danger" data-delete="${esc(c.id)}" title="Delete" aria-label="Delete">${icon.trash}</button>
        </div>
      </div>`
        )
        .join("")
    : `<div class="chat-empty">
        <p><strong>No saved chats in this course yet.</strong></p>
        <p>Start one and every message is saved here automatically.</p>
      </div>`;

  view.innerHTML = `
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="#/">My courses</a><span>/</span><span>${esc(shortName(course.id))}</span></nav>
    <section class="course-header" style='background-image:${patternImage(course)}'>
      <div class="course-header-inner">
        ${course.term ? `<span class="term">${esc(course.term)}</span>` : ""}
        <h1>${esc(course.code)}</h1>
        ${course.id === "GENERAL" ? "" : `<div class="course-header-actions">
          <button class="btn ghost" id="editCourse">${icon.pencil} Edit course</button>
          <button class="btn ghost" id="removeCourse">${icon.trash} Remove course</button>
        </div>`}
      </div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>AI chats</h2>
          <p>${loading ? "" : `${chats.length} saved`}</p>
        </div>
        <button class="btn primary" id="newInCourse">${icon.plus} New chat in this course</button>
      </div>
      <div class="chat-rows">${rows}</div>
    </section>`;

  view.querySelector("#newInCourse").addEventListener("click", onNew);
  view.querySelector("#editCourse")?.addEventListener("click", () => onEditCourse(course.id));
  view.querySelector("#removeCourse")?.addEventListener("click", () => onDeleteCourse(course.id));
  view.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => onOpen(b.dataset.open)));
  view.querySelectorAll("[data-rename]").forEach((b) => b.addEventListener("click", () => onRename(b.dataset.rename)));
  view.querySelectorAll("[data-delete]").forEach((b) => b.addEventListener("click", () => onDelete(b.dataset.delete)));
}
