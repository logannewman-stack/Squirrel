/**
 * Agenda maths: merging fixed events with flexible tasks, finding gaps, and
 * ranking what deserves the day.
 *
 * Everything here is deterministic and runs with no network. The assistant
 * calls the same functions, so a planned day is identical whether it came from
 * a button or a sentence.
 */

import { dayKey } from "./store.js";
import { DEFAULT_HOURS, breaksOn } from "./hours.js";

/**
 * The defaults, and only the defaults. Every one of them is overridable per
 * user — see lib/hours.js. They live here as named constants so a caller that
 * genuinely has no settings to hand still lands somewhere sensible instead of
 * on zero.
 */
export const WORK_START = DEFAULT_HOURS.start;
export const WORK_END = DEFAULT_HOURS.end;
export const DAILY_CAPACITY_MINS = DEFAULT_HOURS.capacityMins;
export const WORK_DAYS = DEFAULT_HOURS.days;
/**
 * Hard cap on the daily list. A twenty-item list is itself a reason to avoid
 * the list — overflow stays in the project.
 */
export const MAX_DAILY_TASKS = 7;

/**
 * Hours may be fractional — 8.5 is half past eight — because a working day
 * that starts at 09:30 is completely ordinary and an integer-only clock made
 * it unrepresentable.
 */
export const atHour = (day, hour, min = 0) => {
  const total = Math.round(hour * 60) + min;
  const h = Math.floor(total / 60);
  const m = total % 60;
  // 24:00 is the end of the day, which Date will not parse — take the last
  // instant of it instead.
  if (h >= 24) return new Date(`${day}T23:59:59`);
  return new Date(`${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`);
};

export const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export const minsBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 60000);

export function weekOf(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d);
    x.setDate(d.getDate() + i);
    return x;
  });
}

/** Free gaps inside working hours on `day`, after existing events. */
/**
 * Open stretches on one day.
 *
 * `after` matters more than it looks. Without it the planner cheerfully books
 * this morning at half past three in the afternoon — every scenario run at a
 * realistic hour produced work scheduled hours into the past, which is the
 * kind of output that makes someone stop trusting a planner immediately.
 */
export function findFreeSlots(
  day,
  events,
  { minMins = 15, start = WORK_START, end = WORK_END, after = null, breaks = [] } = {},
) {
  // Recurring commitments are busy time that nobody should have to re-enter as
  // a meeting every week. Lunch is not on the calendar and the hour is still
  // gone; planning into it is how a schedule stops being believable.
  const weekday = new Date(`${day}T12:00:00`).getDay();
  const standing = breaks?.length
    ? breaksOn({ breaks }, weekday).map((b) => [atHour(day, b.start), atHour(day, b.end)])
    : [];

  const booked = [
    ...events
      .filter((e) => dayKey(new Date(e.start)) === day)
      .map((e) => [new Date(e.start), new Date(e.end)]),
    ...standing,
  ].sort((a, b) => a[0] - b[0]);

  const slots = [];
  let cursor = atHour(day, start);
  const close = atHour(day, end);

  // Time already gone is not available. Rounded up to the next quarter hour,
  // because a block starting at 15:32 reads as a glitch rather than a plan.
  if (after) {
    const from = new Date(after);
    if (from > cursor) {
      const q = 15 * 60000;
      cursor = new Date(Math.ceil(from.getTime() / q) * q);
    }
  }

  for (const [s, e] of booked) {
    if (s > cursor) {
      const gap = Math.round((Math.min(s, close) - cursor) / 60000);
      if (gap >= minMins) slots.push({ start: new Date(cursor), end: new Date(Math.min(s, close)), mins: gap });
    }
    if (e > cursor) cursor = e;
  }
  if (cursor < close) {
    const gap = Math.round((close - cursor) / 60000);
    if (gap >= minMins) slots.push({ start: new Date(cursor), end: close, mins: gap });
  }
  return slots;
}

export const freeMinutes = (day, events, opts) =>
  findFreeSlots(day, events, opts).reduce((s, x) => s + x.mins, 0);

const PRIORITY_WEIGHT = { critical: 900, high: 450, normal: 0, low: -250 };

function dayDiff(due, now) {
  if (!due) return null;
  return Math.round((new Date(due + "T00:00:00") - new Date(dayKey(now) + "T00:00:00")) / 86400000);
}

/** Higher scores get scheduled first. */
export function score(task, now = new Date()) {
  let s = PRIORITY_WEIGHT[task.priority] ?? 0;
  const days = dayDiff(task.due, now);
  if (days !== null) {
    if (days < 0) s += 1000 + Math.min(200, -days * 20);
    else if (days === 0) s += 800;
    else if (days === 1) s += 500;
    else s += Math.max(0, 320 - days * 22);
  }
  // Cheap work earns a real bonus: the first item decides whether the list gets
  // touched at all, so a small win up front is worth more than strict ordering.
  if (task.estimateMins <= 15) s += 130;
  else if (task.estimateMins <= 30) s += 45;
  // Delegated work is tracked, not personally scheduled.
  if (task.delegatedTo) s -= 600;
  s += Math.min(70, ((now - task.createdAt) / 86400000) * 7); // age, so nothing rots
  return s;
}

/**
 * Choose today's tasks and fit them into the gaps between meetings.
 * Capacity is the lesser of the deep-work budget and the day's actual free time.
 */
export function planDay(tasks, events, opts = {}) {
  const {
    day = dayKey(), now = new Date(),
    workStart = WORK_START, workEnd = WORK_END,
    dailyCapacity = DAILY_CAPACITY_MINS, breaks = [],
  } = opts;
  const window = { start: workStart, end: workEnd, breaks };
  const open = tasks.filter((t) => !t.done && !t.delegatedTo);
  const ranked = [...open].sort((a, b) => score(b, now) - score(a, now));
  const capacity = Math.min(dailyCapacity, Math.max(60, freeMinutes(day, events, window)));

  const picked = [];
  let used = 0;
  for (const t of ranked) {
    if (picked.length >= MAX_DAILY_TASKS) break;
    if (used + t.estimateMins > capacity && picked.length > 0) continue;
    picked.push(t);
    used += t.estimateMins;
  }

  // Lead with the shortest task that made the cut.
  if (picked.length > 1) {
    const quickest = picked.reduce((a, b) => (b.estimateMins < a.estimateMins ? b : a));
    if (quickest !== picked[0]) {
      picked.splice(picked.indexOf(quickest), 1);
      picked.unshift(quickest);
    }
  }

  // Lay them into real gaps so the plan has times, not just an order.
  const slots = findFreeSlots(day, events, window);
  const blocks = [];
  let si = 0;
  let cursor = slots[0] ? new Date(slots[0].start) : null;
  for (const t of picked) {
    while (si < slots.length && cursor && (slots[si].end - cursor) / 60000 < t.estimateMins) {
      si++;
      cursor = slots[si] ? new Date(slots[si].start) : null;
    }
    if (!cursor || si >= slots.length) break;
    const start = new Date(cursor);
    const end = new Date(start.getTime() + t.estimateMins * 60000);
    blocks.push({ task: t, start, end });
    cursor = end;
  }

  return { tasks: picked, blocks, overflow: ranked.filter((t) => !picked.includes(t)), plannedMins: used, capacity };
}

export const todaysPlan = (tasks, day = dayKey()) =>
  tasks.filter((t) => t.scheduledFor === day && !t.done).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
