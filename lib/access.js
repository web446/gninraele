// Dates are plain "YYYY-MM-DD" strings in your local time zone, so there are no
// surprises with UTC. A subscription covers whole days, end date included.

const TZ = process.env.TIMEZONE || "Asia/Beirut";
export const GRACE_DAYS = Number(process.env.GRACE_DAYS ?? 3);
export const SEMESTER_MONTHS = Number(process.env.SEMESTER_MONTHS ?? 5);

export function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Adds whole months, clamping the day (Jan 31 + 1 month = Feb 28). */
export function addMonths(date, months) {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

export const daysBetween = (from, to) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/** A new semester starts today, or the day after the current one ends if they pay early. */
export function nextPeriod(currentEnd, months = SEMESTER_MONTHS) {
  const start = currentEnd && currentEnd >= today() ? addDays(currentEnd, 1) : today();
  return { startDate: start, endDate: addDays(addMonths(start, months), -1) };
}

/** The last day covered by a paid (or free) subscription, ignoring voided ones. */
export const paidUntil = (subs) =>
  subs.filter((s) => s.paymentStatus !== "void").reduce((max, s) => (s.endDate > max ? s.endDate : max), "");

/**
 * Works out what a user may do right now.
 * status: active | expired | suspended | deactivated
 */
export function accessState(user, subs) {
  const until = paidUntil(subs);
  const now = today();
  const base = { until: until || null, graceUntil: until ? addDays(until, GRACE_DAYS) : null, graceDays: GRACE_DAYS };

  if (user.role === "admin") return { ...base, status: "active", canRead: true, canWrite: true, daysLeft: null };
  if (user.accountStatus === "deactivated") return { ...base, status: "deactivated", canRead: false, canWrite: false };
  if (user.accountStatus === "suspended") return { ...base, status: "suspended", canRead: false, canWrite: false };
  if (!until || addDays(until, GRACE_DAYS) < now) {
    return { ...base, status: "expired", canRead: true, canWrite: false, daysLeft: until ? daysBetween(now, until) : null };
  }
  return { ...base, status: "active", canRead: true, canWrite: true, daysLeft: daysBetween(now, until), inGrace: until < now };
}
