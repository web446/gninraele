// Small fetch wrapper. The session cookie is sent automatically by the browser.
export async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (res.status === 401) {
    if (!location.pathname.endsWith("login.html")) location.href = "/login.html";
    throw new Error("Please log in.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.access = body.access;
    throw err;
  }
  return res;
}

export const getJSON = async (path) => (await api(path)).json();
export const sendJSON = async (path, method, body) => (await api(path, { method, body: JSON.stringify(body) })).json();
export const logout = async () => {
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  location.href = "/login.html";
};
