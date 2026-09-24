import { getJSON, sendJSON, logout } from "./api.js";
import { ask, toast, esc, timeAgo } from "./ui.js";

const $ = (id) => document.getElementById(id);
let data = { students: [], summary: {}, settings: {} };
let openId = null;

/* ---------- helpers ---------- */
const STATUS_LABEL = { active: "Active", expired: "Expired", suspended: "Suspended", deactivated: "Closed" };
const money = (n) => `${Number(n || 0).toLocaleString()} ${data.settings.currency || "USD"}`;

function dialogForm(dialogId, onSubmit) {
  const dialog = $(dialogId);
  const form = dialog.querySelector("form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    onSubmit(dialog);
  });
  dialog.querySelector("[data-cancel]")?.addEventListener("click", () => dialog.close());
  return dialog;
}

function showCredentials(username, password) {
  $("creds").innerHTML = `
    <div><span>Website</span><b>${esc(location.origin)}</b></div>
    <div><span>Username</span><b>${esc(username)}</b></div>
    <div><span>Password</span><b>${esc(password)}</b></div>`;
  $("copyCreds").onclick = async () => {
    try {
      await navigator.clipboard.writeText(`Website: ${location.origin}\nUsername: ${username}\nPassword: ${password}`);
      toast("Copied. Send it to the student.", "success");
    } catch { toast("Couldn't copy, write it down instead.", "error"); }
  };
  $("credsDialog").showModal();
}

/* ---------- rendering ---------- */
function renderSummary() {
  const s = data.summary;
  const cards = [
    ["Students", s.total || 0, ""],
    ["Active", s.active || 0, "ok"],
    ["Ending soon", s.expiringSoon || 0, "warn"],
    ["Expired", s.expired || 0, "danger"],
    ["Suspended", (s.suspended || 0) + (s.deactivated || 0), ""],
    ["Cash collected", money(s.collected), ""],
  ];
  $("summary").innerHTML = cards
    .map(([label, value, kind]) => `<div class="summary-card ${kind}"><span>${esc(label)}</span><b>${esc(value)}</b></div>`)
    .join("");
  $("settingsLine").textContent = `Semester length ${data.settings.semesterMonths} months, ${data.settings.graceDays} grace days, today is ${data.settings.today}.`;
}

function studentRow(s) {
  const a = s.access;
  const open = s.id === openId;
  const subs = [...s.subscriptions].sort((x, y) => y.startDate.localeCompare(x.startDate));
  return `
  <article class="student ${open ? "open" : ""}" data-id="${esc(s.id)}">
    <button class="student-main" data-toggle="${esc(s.id)}">
      <span class="student-who">
        <span class="student-name">${esc(s.name)}</span>
        <span class="student-sub">${esc(s.username)}${s.phone ? `, ${esc(s.phone)}` : ""}</span>
      </span>
      <span class="student-state">
        <span class="pill ${a.status}">${STATUS_LABEL[a.status]}</span>
        <span class="student-until">${a.until ? `until ${esc(a.until)}${a.status === "active" && a.daysLeft !== null ? ` (${a.daysLeft}d)` : ""}` : "never paid"}</span>
      </span>
    </button>
    ${open ? `
    <div class="student-body">
      <div class="student-actions">
        <button class="btn primary" data-pay="${esc(s.id)}">Record payment</button>
        <button class="btn ghost" data-password="${esc(s.id)}">New password</button>
        ${s.accountStatus === "active"
          ? `<button class="btn ghost" data-status="suspended" data-id="${esc(s.id)}">Suspend</button>`
          : `<button class="btn ghost" data-status="active" data-id="${esc(s.id)}">Reactivate</button>`}
        ${s.accountStatus === "deactivated" ? "" : `<button class="btn ghost danger-text" data-status="deactivated" data-id="${esc(s.id)}">Close account</button>`}
        <button class="btn ghost" data-note="${esc(s.id)}">Edit note</button>
      </div>
      <div class="student-meta">
        ${s.adminNote ? `<p><b>Note:</b> ${esc(s.adminNote)}</p>` : ""}
        <p>Created ${esc(s.createdAt.slice(0, 10))}, last login ${s.lastLoginAt ? esc(timeAgo(s.lastLoginAt)) : "never"}.
        <span id="usage-${esc(s.id)}" class="usage">Loading usage…</span></p>
      </div>
      <h4>Payments</h4>
      ${subs.length ? `<table class="pay-table">
        <tr><th>Period</th><th>Label</th><th>Amount</th><th>Status</th><th></th></tr>
        ${subs.map((p) => `<tr class="${p.paymentStatus === "void" ? "void" : ""}">
          <td>${esc(p.startDate)} → ${esc(p.endDate)}</td>
          <td>${esc(p.termLabel || "")}</td>
          <td>${esc(money(p.amount))}</td>
          <td>${p.paymentStatus === "paid" ? "Paid cash" : p.paymentStatus === "free" ? "Free" : "Cancelled"}</td>
          <td>${p.paymentStatus === "void" ? "" : `<button class="row-btn" data-void="${esc(p.id)}" title="Cancel this entry">✕</button>`}</td>
        </tr>`).join("")}
      </table>` : `<p class="muted">No payments recorded yet.</p>`}
    </div>` : ""}
  </article>`;
}

function render() {
  const list = $("students");
  list.innerHTML = data.students.length
    ? data.students.map(studentRow).join("")
    : `<p class="chat-rows-loading">No students yet. Click "New student" to create the first account.</p>`;

  list.querySelectorAll("[data-toggle]").forEach((b) =>
    b.addEventListener("click", () => {
      openId = openId === b.dataset.toggle ? null : b.dataset.toggle;
      render();
      if (openId) loadUsage(openId);
    })
  );
  list.querySelectorAll("[data-pay]").forEach((b) => b.addEventListener("click", () => openPayment(b.dataset.pay)));
  list.querySelectorAll("[data-password]").forEach((b) => b.addEventListener("click", () => resetPassword(b.dataset.password)));
  list.querySelectorAll("[data-status]").forEach((b) => b.addEventListener("click", () => changeStatus(b.dataset.id, b.dataset.status)));
  list.querySelectorAll("[data-note]").forEach((b) => b.addEventListener("click", () => editNote(b.dataset.note)));
  list.querySelectorAll("[data-void]").forEach((b) => b.addEventListener("click", () => voidPayment(b.dataset.void)));
  renderSummary();
}

async function loadUsage(id) {
  try {
    const u = await getJSON(`/api/admin/students/${id}/usage`);
    const el = $(`usage-${id}`);
    if (el) el.textContent = `${u.chats} chats, ${u.messages} messages, ${u.today}/${u.dailyLimit} used today.`;
  } catch { /* ignore */ }
}

/* ---------- actions ---------- */
async function load() {
  const q = $("search").value.trim();
  const status = $("statusFilter").value;
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  data = await getJSON(`/api/admin/students?${params}`);
  render();
}

const studentDialog = dialogForm("studentDialog", async () => {
  const err = $("studentError");
  err.hidden = true;
  try {
    const body = { name: $("sName").value.trim(), username: $("sUsername").value.trim(), phone: $("sPhone").value.trim(), note: $("sNote").value.trim() };
    const res = await sendJSON("/api/admin/students", "POST", body);
    studentDialog.close();
    await load();
    showCredentials(res.student.username, res.password);
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
});

$("newStudent").addEventListener("click", () => {
  ["sName", "sUsername", "sPhone", "sNote"].forEach((id) => ($(id).value = ""));
  $("studentError").hidden = true;
  studentDialog.showModal();
  $("sName").focus();
});

let payingId = null;
const paymentDialog = dialogForm("paymentDialog", async () => {
  const err = $("paymentError");
  err.hidden = true;
  try {
    await sendJSON(`/api/admin/students/${payingId}/payments`, "POST", {
      amount: Number($("pAmount").value) || 0,
      months: Number($("pMonths").value) || data.settings.semesterMonths,
      startDate: $("pStart").value || undefined,
      endDate: $("pEnd").value || undefined,
      termLabel: $("pLabel").value.trim(),
      note: $("pNote").value.trim(),
      free: $("pFree").checked,
    });
    paymentDialog.close();
    await load();
    toast("Payment recorded. The student now has access.", "success");
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
});

function openPayment(id) {
  const s = data.students.find((x) => x.id === id);
  payingId = id;
  $("paymentTitle").textContent = `Payment for ${s.name}`;
  $("paymentHint").textContent = s.access.until
    ? `Paid until ${s.access.until}. A new semester is added after that date.`
    : "This student has never paid. The semester starts today.";
  $("pAmount").value = data.settings.price || "";
  $("pMonths").value = data.settings.semesterMonths;
  $("pStart").value = "";
  $("pEnd").value = "";
  $("pLabel").value = "";
  $("pNote").value = "";
  $("pFree").checked = false;
  $("paymentError").hidden = true;
  paymentDialog.showModal();
  $("pAmount").focus();
}

async function resetPassword(id) {
  const s = data.students.find((x) => x.id === id);
  const ok = await ask({
    title: `New password for ${s.name}?`,
    text: "The old password stops working immediately and the student is logged out everywhere.",
    okText: "Generate",
  });
  if (!ok) return;
  try {
    const res = await sendJSON(`/api/admin/students/${id}/password`, "POST", {});
    showCredentials(s.username, res.password);
  } catch (e) { toast(e.message, "error"); }
}

async function changeStatus(id, accountStatus) {
  const s = data.students.find((x) => x.id === id);
  const texts = {
    suspended: ["Suspend this account?", "The student can't log in until you reactivate them. Their chats are kept."],
    active: ["Reactivate this account?", "The student can log in again, as long as their semester is paid."],
    deactivated: ["Close this account?", "The student can't log in. Their data stays in the database until you delete it."],
  };
  const ok = await ask({ title: texts[accountStatus][0], text: `${s.name}. ${texts[accountStatus][1]}`, okText: "Confirm", danger: accountStatus !== "active" });
  if (!ok) return;
  try {
    await sendJSON(`/api/admin/students/${id}`, "PATCH", { accountStatus });
    await load();
    toast("Account updated.", "success");
  } catch (e) { toast(e.message, "error"); }
}

async function editNote(id) {
  const s = data.students.find((x) => x.id === id);
  const note = await ask({ title: `Note about ${s.name}`, input: { value: s.adminNote || "", placeholder: "Anything you want to remember" }, okText: "Save" });
  if (note === null) return;
  try {
    await sendJSON(`/api/admin/students/${id}`, "PATCH", { adminNote: note });
    await load();
  } catch (e) { toast(e.message, "error"); }
}

async function voidPayment(id) {
  const ok = await ask({ title: "Cancel this payment entry?", text: "Use this if you recorded it by mistake. It stays visible as cancelled.", okText: "Cancel entry", danger: true });
  if (!ok) return;
  try {
    await sendJSON(`/api/admin/payments/${id}`, "PATCH", { paymentStatus: "void" });
    await load();
    toast("Entry cancelled.", "success");
  } catch (e) { toast(e.message, "error"); }
}

/* ---------- start ---------- */
let searchTimer;
$("search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(load, 250); });
$("statusFilter").addEventListener("change", load);
$("logoutBtn").addEventListener("click", logout);

const { user } = await getJSON("/api/me");
if (user.role !== "admin") location.href = "/";
$("userName").textContent = user.name || user.username;
await load();
