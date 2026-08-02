/**
 * Agenda maths: merging fixed events with flexible tasks, finding gaps, and
 * ranking what deserves the day.
 *
 * Everything here is deterministic and runs with no network. The assistant
 * calls the same functions, so a planned day is identical whether it came from
 * a button or a sentence.
 */

import { dayKey } from "./store";

export const WORK_START = 8;   // 08:00
export const WORK_END = 19;    // 19:00
/** Executive days are meeting-dense; this is deep-work capacity, not hours awake. */
export const DAILY_CAPACITY_MINS = 300;
/**
 * Hard cap on the daily list. A twenty-item list is itself a reason to avoid
 * the list — overflow stays in the project.
 */
export const MAX_DAILY_TASKS = 7;

export const atHour = (day, hour, min = 0) =>
  new Date(`${day}T${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`);

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
export function findFreeSlots(day, events, { minMins = 15, start = WORK_START, end = WORK_END } = {}) {
  const booked = events
    .filter((e) => dayKey(new Date(e.start)) === day)
    .map((e) => [new Date(e.start), new Date(e.end)])
    .sort((a, b) => a[0] - b[0]);

  const slots = [];
  let cursor = atHour(day, start);
  const close = atHour(day, end);

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
export function planDay(tasks, events, { day = dayKey(), now = new Date() } = {}) {
  const open = tasks.filter((t) => !t.done && !t.delegatedTo);
  const ranked = [...open].sort((a, b) => score(b, now) - score(a, now));
  const capacity = Math.min(DAILY_CAPACITY_MINS, Math.max(60, freeMinutes(day, events)));

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
  const slots = findFreeSlots(day, events);
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
