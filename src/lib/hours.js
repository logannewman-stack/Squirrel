/**
 * When this particular person actually works.
 *
 * Every scheduling decision in the app used to rest on three constants — 08:00,
 * 19:00, five hours of focus a day — applied identically to a surgeon, a
 * founder in a different timezone, and someone who works Tuesday to Saturday.
 * The numbers were reasonable. Being reasonable for everybody is exactly the
 * problem: a planner that thinks your day starts at eight when it starts at
 * six will quietly hand back a schedule you cannot keep, and the arithmetic
 * that says work "does not fit" is only worth trusting if the day it measures
 * against is yours.
 *
 * Four things are configurable, and they answer four different questions:
 *
 *   days      which days you work at all
 *   start/end the window a meeting or a block may be placed in
 *   capacity  how much focused work is realistic inside that window — not the
 *             same number, and never should be. An eleven-hour window with
 *             eleven hours of deep work in it is a fantasy that produces a plan
 *             nobody follows.
 *   breaks    the parts of the day already spoken for. Lunch, the school run,
 *             the gym, standing team time. These are not meetings and should
 *             not have to be entered as meetings every week, but the planner
 *             has to know the time is gone.
 *
 * Everything is normalised here so no caller has to defend against a half-typed
 * time or a capacity of minus four hours.
 */

export const DEFAULT_HOURS = {
  // 08:00–19:00 is a wide window on purpose: it is the range a *meeting* may be
  // placed in, not a claim about how long anyone works. Narrow it in Settings
  // and every number in the app narrows with it. It stays the default because
  // changing it would silently re-plan the week of everyone already using this.
  start: 8,
  end: 19,
  /** Focused work, not hours awake. Executive days are meeting-dense. */
  capacityMins: 300,
  /** Monday–Friday. 0 is Sunday, matching Date#getDay. */
  days: [1, 2, 3, 4, 5],
  breaks: [],
};

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DAY_SHORT = ["S", "M", "T", "W", "T", "F", "S"];

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** "08:30" → 8.5. Numbers pass straight through, so old settings still load. */
export function toHours(v, fallback = null) {
  if (v == null || v === "") return fallback;
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  const m = String(v).match(/^\s*(\d{1,2})(?::(\d{2}))?\s*$/);
  if (!m) return fallback;
  const h = Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0);
  return Number.isFinite(h) ? h : fallback;
}

/** 8.5 → "08:30", which is what `input[type=time]` wants back. */
export function toClock(h) {
  const total = Math.round(clamp(h ?? 0, 0, 24) * 60);
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** 8.5 → "8:30 AM", for prose the assistant speaks. */
export function sayHour(h) {
  const total = Math.round(clamp(h ?? 0, 0, 24) * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  const d = new Date(2000, 0, 1, hh === 24 ? 23 : hh, hh === 24 ? 59 : mm);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Minutes → "5h", "5h 30m", "45m". Used all over the settings panel. */
export function sayMins(m) {
  const n = Math.max(0, Math.round(m || 0));
  if (n < 60) return `${n}m`;
  const h = Math.floor(n / 60);
  const r = n % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/**
 * A distance in time, said the way it was asked for.
 *
 * `sayMins` is for amounts of work, where hours stay the natural unit all the
 * way up. This is for the gap between two points, where they do not: "push it
 * out a week", answered with "moved 168h later", is arithmetically perfect and
 * reads like a machine showing its working.
 */
export function saySpan(m) {
  const n = Math.max(0, Math.round(m || 0));
  const plural = (v, word) => `${v} ${word}${v === 1 ? "" : "s"}`;
  if (n && n % 10080 === 0) return plural(n / 10080, "week");
  if (n && n % 1440 === 0) return plural(n / 1440, "day");
  return sayMins(n);
}

function normalizeDays(days) {
  if (!Array.isArray(days)) return DEFAULT_HOURS.days;
  const clean = [...new Set(days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))]
    .sort((a, b) => a - b);
  // Nobody works zero days. An empty list is a half-finished edit, not an
  // instruction, and honouring it would make the planner refuse every task.
  return clean.length ? clean : DEFAULT_HOURS.days;
}

/**
 * A recurring commitment inside the working window.
 *
 * Stored with its own day list because lunch is every day and the Thursday
 * school run is not.
 */
function normalizeBreak(b, windowStart, windowEnd) {
  if (!b) return null;
  const start = toHours(b.start, null);
  let end = toHours(b.end, null);
  if (start == null || end == null) return null;
  if (end <= start) end = Math.min(24, start + 0.5);
  // A break entirely outside the working window is not wrong, it is simply
  // already free time — clipping keeps the arithmetic honest either way.
  const from = clamp(start, windowStart, windowEnd);
  const to = clamp(end, windowStart, windowEnd);
  return {
    id: b.id || `${start}-${end}`,
    label: (b.label || "Break").trim() || "Break",
    start,
    end,
    days: normalizeDays(b.days ?? DEFAULT_HOURS.days),
    // Minutes this break actually removes from the working window.
    mins: Math.max(0, Math.round((to - from) * 60)),
  };
}

/**
 * The settings, made safe.
 * @returns {{start, end, days, breaks, capacityMins, windowMins}}
 */
export function hoursOf(settings = {}) {
  const raw = (settings && settings.hours) || {};
  const start = clamp(toHours(raw.start, DEFAULT_HOURS.start) ?? DEFAULT_HOURS.start, 0, 23.5);
  let end = clamp(toHours(raw.end, DEFAULT_HOURS.end) ?? DEFAULT_HOURS.end, 0.5, 24);
  if (end <= start) end = Math.min(24, start + 1);

  const breaks = (Array.isArray(raw.breaks) ? raw.breaks : [])
    .map((b) => normalizeBreak(b, start, end))
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  const windowMins = Math.round((end - start) * 60);
  const capacityMins = clamp(
    Math.round(Number(raw.capacityMins ?? DEFAULT_HOURS.capacityMins) || DEFAULT_HOURS.capacityMins),
    15,
    // Capped at the window rather than at 24 hours: a capacity larger than the
    // day it lives in is not a preference, it is a typo, and the planner would
    // silently ignore it anyway.
    Math.max(15, windowMins),
  );

  return { start, end, days: normalizeDays(raw.days), breaks, capacityMins, windowMins };
}

/** Does this date fall on a working day? */
export const worksOn = (date, days = DEFAULT_HOURS.days) => days.includes(new Date(date).getDay());

/** Break intervals that apply to one weekday. */
export const breaksOn = (hours, weekday) => hours.breaks.filter((b) => b.days.includes(weekday));

/** Minutes lost to breaks on one weekday. */
export const breakMinsOn = (hours, weekday) =>
  breaksOn(hours, weekday).reduce((n, b) => n + b.mins, 0);

/**
 * Focused minutes genuinely reachable on one weekday.
 *
 * This was `min(capacity, window − breaks)`, which reads correctly and was
 * almost inert. The window is wide — 08:00 to 19:00 is 660 minutes — and
 * capacity is a realistic 300, so taking breaks off the window changed nothing
 * at all until they passed *360 minutes in a single day*. Somebody could
 * commit lunch, the school run and an hour at the gym and the planner went on
 * believing they had five clear hours: it laid work across all three and
 * handed back a week that could not be kept.
 *
 * That made every commitment anybody entered decoration — asked for, stored,
 * and changing no decision — which is worse than never asking.
 *
 * So capacity shrinks with the day it lives in. It was an estimate of
 * realistic focus across the *whole* window, so committing a fifth of the
 * window costs about a fifth of the focus: an hour of lunch takes roughly
 * twenty-seven minutes off the five hours, rather than nothing. The `min`
 * survives as the floor for the extreme case, where so much of the day is
 * committed that the time left is smaller than the scaled capacity.
 */
export const usableMinsOn = (hours, weekday) => {
  if (!worksOn(new Date(2024, 0, 7 + weekday), hours.days)) return 0;
  if (!hours.windowMins) return 0;

  const left = Math.max(0, hours.windowMins - breakMinsOn(hours, weekday));
  const scaled = hours.capacityMins * (left / hours.windowMins);
  return Math.round(Math.min(scaled, left));
};

/** Focused minutes across a normal week. The number the pacing maths rests on. */
export const weeklyMins = (hours) =>
  [0, 1, 2, 3, 4, 5, 6].reduce((n, d) => n + usableMinsOn(hours, d), 0);

/**
 * The options object every scheduler entry point takes.
 *
 * One place that knows how a settings blob becomes planner arguments, so a new
 * caller cannot forget half of them and quietly plan against the defaults —
 * which is the failure that made these values feel hardcoded even after they
 * were not.
 */
export function planOpts(settings = {}, extra = {}) {
  const h = hoursOf(settings);
  return {
    workStart: h.start,
    workEnd: h.end,
    dailyCapacity: h.capacityMins,
    workDays: h.days,
    breaks: h.breaks,
    ...extra,
  };
}

/** "9:00 AM to 5:00 PM, Mon–Fri" — one line, for the assistant and the panel. */
export function describeHours(hours) {
  const d = hours.days;
  const runs = [];
  for (const day of d) {
    const last = runs[runs.length - 1];
    if (last && day === last[1] + 1) last[1] = day;
    else runs.push([day, day]);
  }
  const label = runs
    .map(([a, b]) => (a === b ? DAY_NAMES[a].slice(0, 3) : `${DAY_NAMES[a].slice(0, 3)}–${DAY_NAMES[b].slice(0, 3)}`))
    .join(", ");
  return `${sayHour(hours.start)} to ${sayHour(hours.end)}, ${label}`;
}
