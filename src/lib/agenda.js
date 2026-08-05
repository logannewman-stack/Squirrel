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

/**
 * Work planned for one day, from the distribution.
 *
 * There used to be a second planner here — its own scoring, its own capacity
 * arithmetic, its own idea of what deserved the day — and the Today screen
 * used it while the calendar, the reminders and the assistant used
 * `distribute`. Two answers to "what should I work on today", and no way for a
 * user to know which one they were looking at. This is now a lookup into the
 * one plan rather than a second opinion about it.
 */
export const blocksOn = (blocks = [], day = dayKey()) =>
  blocks
    .filter((b) => b.day === day)
    .sort((a, b) => (a.start || "").localeCompare(b.start || ""));

/** Those blocks, joined to the tasks they belong to. */
export const workOn = (blocks = [], tasks = [], day = dayKey()) =>
  blocksOn(blocks, day)
    .map((b) => ({ ...b, task: tasks.find((t) => t.id === b.taskId) }))
    .filter((b) => b.task && !b.task.done);

/** Distinct tasks the plan gives to a day, in the order they are worked. */
export function tasksOn(blocks = [], tasks = [], day = dayKey()) {
  const seen = new Set();
  const out = [];
  for (const b of workOn(blocks, tasks, day)) {
    if (seen.has(b.taskId)) continue;
    seen.add(b.taskId);
    out.push(b.task);
  }
  return out;
}
