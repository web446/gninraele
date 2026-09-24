import crypto from "crypto";

const COOKIE = "elc_session";
const DAYS = 30;
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.SESSION_SECRET) console.warn("SESSION_SECRET is not set: everyone will be logged out on every restart.");

/* ---------- Passwords (scrypt, from Node's own crypto) ---------- */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, salt, key] = String(stored).split("$");
    if (scheme !== "scrypt") return false;
    const expected = Buffer.from(key, "base64");
    const actual = crypto.scryptSync(password, Buffer.from(salt, "base64"), expected.length, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/* ---------- Readable PIN storage (admin can see student PINs) ---------- */
// The PIN is kept encrypted with AES-256-GCM so it can be shown in the admin area.
// The key never leaves the server. Losing PIN_SECRET only means PINs can't be shown
// any more; logging in still works, because passwords are verified by their hash.
const PIN_KEY = crypto.createHash("sha256").update(process.env.PIN_SECRET || `${SECRET}:pins`).digest();

export function encryptPin(pin) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", PIN_KEY, iv);
  const data = Buffer.concat([cipher.update(String(pin), "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${data.toString("base64")}`;
}

export function decryptPin(stored) {
  try {
    const [iv, tag, data] = String(stored).split(".");
    const d = crypto.createDecipheriv("aes-256-gcm", PIN_KEY, Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/* ---------- Generated usernames and passwords ---------- */
const PIN_DIGITS = Math.min(10, Math.max(4, Number(process.env.PASSWORD_DIGITS ?? 4)));

/** Digits only, evenly distributed, e.g. "4821". */
export function generatePin(digits = PIN_DIGITS) {
  let pin = "";
  while (pin.length < digits) pin += crypto.randomInt(0, 10);
  return pin;
}

const ALPHABET = "abcdefghijkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789"; // no l, 1, I, O, 0
export const generatePassword = (length = 12) =>
  Array.from(crypto.randomBytes(length), (b) => ALPHABET[b % ALPHABET.length]).join("");

export function usernameFrom(name) {
  const base = String(name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "").slice(0, 24);
  return base || `student.${crypto.randomInt(1000, 9999)}`;
}
export const isUsername = (u) => typeof u === "string" && /^[a-z0-9._-]{3,32}$/.test(u);

/* ---------- Session cookie: id.version.expiry, signed ---------- */
const b64 = (s) => Buffer.from(s).toString("base64url");
const sign = (payload) => crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");

export function issueCookie(res, user, req) {
  const payload = `${b64(user.id)}.${user.sessionVersion || 1}.${Date.now() + DAYS * 86400000}`;
  const secure = req.secure || req.get("x-forwarded-proto") === "https";
  res.cookie(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: DAYS * 86400000,
    path: "/",
  });
}

export const clearCookie = (res) => res.clearCookie(COOKIE, { path: "/" });

/** Returns {id, version} when the cookie is valid, otherwise null. */
export function readCookie(req) {
  const raw = req.cookies?.[COOKIE];
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 4) return null;
  const payload = parts.slice(0, 3).join(".");
  const expected = sign(payload);
  if (expected.length !== parts[3].length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[3]))) return null;
  const [id, version, expires] = [Buffer.from(parts[0], "base64url").toString(), Number(parts[1]), Number(parts[2])];
  if (!id || !Number.isFinite(version) || !(expires > Date.now())) return null;
  return { id, version };
}

/* ---------- Login throttling (kept in memory, no database model) ---------- */
const attempts = new Map();
const WINDOW = 15 * 60 * 1000;
const MAX_TRIES = 5;

export function loginBlocked(key) {
  const rec = attempts.get(key);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW) { attempts.delete(key); return false; }
  return rec.count >= MAX_TRIES;
}
export function loginFailed(key) {
  const rec = attempts.get(key);
  if (!rec || Date.now() - rec.first > WINDOW) attempts.set(key, { first: Date.now(), count: 1 });
  else rec.count++;
}
export const loginSucceeded = (key) => attempts.delete(key);
