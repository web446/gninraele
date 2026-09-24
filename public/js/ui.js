// Dialog, toast, lightbox and formatting helpers.
const dialog = document.getElementById("dialog");
const dTitle = document.getElementById("dialogTitle");
const dText = document.getElementById("dialogText");
const dInput = document.getElementById("dialogInput");
const dError = document.getElementById("dialogError");
const dOk = document.getElementById("dialogOk");
const dCancel = document.getElementById("dialogCancel");
const dForm = document.getElementById("dialogForm");

/** Opens a dialog. Resolves with the input value (or true) on OK, null on cancel. */
export function ask({ title, text = "", input = null, okText = "OK", danger = false, error = "", cancel = true }) {
  dTitle.textContent = title;
  dText.textContent = text;
  dText.hidden = !text;
  dError.textContent = error;
  dError.hidden = !error;
  dInput.hidden = !input;
  if (input) {
    dInput.type = input.type || "text";
    dInput.value = input.value || "";
    dInput.placeholder = input.placeholder || "";
  }
  dOk.textContent = okText;
  dOk.classList.toggle("danger", danger);
  dCancel.hidden = !cancel;

  return new Promise((resolve) => {
    const done = (value) => {
      dForm.removeEventListener("submit", onSubmit);
      dCancel.removeEventListener("click", onCancel);
      dialog.removeEventListener("cancel", onCancel);
      dialog.close();
      resolve(value);
    };
    const onSubmit = (e) => {
      e.preventDefault();
      if (input && !dInput.value.trim()) { dInput.focus(); return; }
      done(input ? dInput.value.trim() : true);
    };
    const onCancel = (e) => { e.preventDefault(); if (cancel) done(null); };
    dForm.addEventListener("submit", onSubmit);
    dCancel.addEventListener("click", onCancel);
    dialog.addEventListener("cancel", onCancel);
    dialog.showModal();
    (input ? dInput : dOk).focus();
    if (input) dInput.select();
  });
}

const toastEl = document.getElementById("toast");
let toastTimer;
export function toast(message, kind = "info") {
  toastEl.textContent = message;
  toastEl.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.className = "toast"), 3200);
}

const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightboxImg");
document.getElementById("lightboxClose").addEventListener("click", () => lightbox.close());
lightbox.addEventListener("click", (e) => { if (e.target === lightbox) lightbox.close(); });
export function showImage(src) {
  lightboxImg.src = src;
  lightbox.showModal();
}

export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!isFinite(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- Course editor dialog ---------- */
const courseDialog = document.getElementById("courseDialog");

export function askCourse(existing = null) {
  if (!courseDialog) return Promise.resolve(null);
  const f = courseDialog.querySelector("form");
  const [id, title, term, color, pattern] = ["cId", "cTitle", "cTerm", "cColor", "cPattern"].map((x) => document.getElementById(x));
  document.getElementById("courseDialogTitle").textContent = existing ? "Edit course" : "Add a course";
  id.value = existing?.id || "";
  id.disabled = Boolean(existing);
  title.value = existing?.title || "";
  term.value = existing?.term || "";
  color.value = existing?.color || "#10b58c";
  pattern.value = existing?.pattern || "diamonds";

  return new Promise((resolve) => {
    const finish = (value) => {
      f.removeEventListener("submit", onSubmit);
      courseDialog.removeEventListener("cancel", onCancel);
      courseDialog.querySelector("[data-cancel]").removeEventListener("click", onCancel);
      courseDialog.close();
      resolve(value);
    };
    const onSubmit = (e) => {
      e.preventDefault();
      const code = id.value.trim().toUpperCase().replace(/[^\w.-]/g, "");
      if (!code || code === "GENERAL") { id.focus(); return; }
      finish({ id: code, title: title.value.trim() || code, term: term.value.trim(), color: color.value, pattern: pattern.value });
    };
    const onCancel = (e) => { e.preventDefault(); finish(null); };
    f.addEventListener("submit", onSubmit);
    courseDialog.addEventListener("cancel", onCancel);
    courseDialog.querySelector("[data-cancel]").addEventListener("click", onCancel);
    courseDialog.showModal();
    (existing ? title : id).focus();
  });
}
