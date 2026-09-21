// Small fetch wrapper that adds the access password and asks for it when needed.
const PW_KEY = "elc-password";
let askPassword = null;
let pending = null;

export const getPassword = () => localStorage.getItem(PW_KEY) || "";
export const setPassword = (p) => localStorage.setItem(PW_KEY, p);
export function onPasswordNeeded(fn) { askPassword = fn; }

export async function api(path, opts = {}, retried = false) {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", "x-access-password": getPassword(), ...(opts.headers || {}) },
  });
  if (res.status === 401 && askPassword) {
    pending ||= askPassword(retried).finally(() => { pending = null; });
    const ok = await pending;
    if (ok) return api(path, opts, true);
    throw new Error("The password is required to use this site.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res;
}

export const getJSON = async (path) => (await api(path)).json();
export const sendJSON = async (path, method, body) => (await api(path, { method, body: JSON.stringify(body) })).json();
