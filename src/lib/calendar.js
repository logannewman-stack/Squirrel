/**
 * Zoom levels for the calendar.
 *
 * Five scales, and they are not the same view at five sizes. A day and a week
 * want the hour grid, because at that range the question is "what is at 2pm".
 * A month wants named events in day cells. A quarter and a year cannot show an
 * event at all without becoming illegible, and the honest thing to show there
 * is *load* — which weeks are already full, where the deadlines cluster, which
 * fortnight has room in it. Rendering the same thing progressively smaller
 * would produce three views that are useless in three different ways.
 *
 * All ranges are half-open — `from` inclusive, `to` exclusive — matching the
 * convention the assistant's own range parser uses, so a meeting at midnight
 * belongs to one day and not to two.
 */

import { dayKey } from "./store.js";
import { worksOn, breakMinsOn } from "./hours.js";

export const SCALES = [
  { id: "agenda", label: "Agenda", key: "a" },
  { id: "day", label: "Day", key: "d" },
  { id: "week", label: "Week", key: "w" },
  { id: "month", label: "Month", key: "m" },
  { id: "quarter", label: "Quarter", key: "q" },
  { id: "year", label: "Year", key: "y" },
];

export const isScale = (id) => SCALES.some((s) => s.id === id);

const midnight = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const addDays = (d, n) => {
  const x = midnight(d);
  x.setDate(x.getDate() + n);
  return x;
};

/** Monday of the week containing `d`. Monday-first everywhere, to match weekOf. */
export const mondayOf = (d) => addDays(d, -((new Date(d).getDay() + 6) % 7));

/** The quarter index, 0–3. */
export const quarterOf = (d) => Math.floor(new Date(d).getMonth() / 3);

export function rangeOf(scale, anchor) {
  const a = midnight(anchor);
  switch (scale) {
    case "agenda":
      return { from: a, to: addDays(a, 21) };
    case "day":
      return { from: a, to: addDays(a, 1) };
    case "week": {
      const mon = mondayOf(a);
      return { from: mon, to: addDays(mon, 7) };
    }
    case "month":
      return {
        from: new Date(a.getFullYear(), a.getMonth(), 1),
        to: new Date(a.getFullYear(), a.getMonth() + 1, 1),
      };
    case "quarter": {
      const q = quarterOf(a) * 3;
      return {
        from: new Date(a.getFullYear(), q, 1),
        to: new Date(a.getFullYear(), q + 3, 1),
      };
    }
    default:
      return {
        from: new Date(a.getFullYear(), 0, 1),
        to: new Date(a.getFullYear() + 1, 0, 1),
      };
  }
}

/** Move the anchor by whole units of the current scale. */
export function shiftBy(scale, anchor, n) {
  const a = midnight(anchor);
  switch (scale) {
    case "agenda":
      return addDays(a, n * 21);
    case "day":
      return addDays(a, n);
    case "week":
      return addDays(a, n * 7);
    case "month":
      // Clamp to the last day: stepping from 31 March must not land in May.
      return clampedMonth(a, n);
    case "quarter":
      return clampedMonth(a, n * 3);
    default:
      return new Date(a.getFullYear() + n, a.getMonth(), Math.min(a.getDate(), 28));
  }
}

function clampedMonth(a, months) {
  const target = new Date(a.getFullYear(), a.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(a.getDate(), last));
  return target;
}

/** The heading over the grid — the shortest phrase that is still unambiguous. */
export function titleOf(scale, anchor) {
  const a = new Date(anchor);
  switch (scale) {
    case "agenda": {
      const end = addDays(a, 20);
      const sameMonth = a.getMonth() === end.getMonth();
      return sameMonth
        ? `${a.toLocaleDateString([], { month: "long" })} ${a.getDate()}–${end.getDate()}`
        : `${a.toLocaleDateString([], { month: "short", day: "numeric" })} – ${end.toLocaleDateString([], { month: "short", day: "numeric" })}`;
    }
    case "day":
      return a.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
    case "week": {
      const mon = mondayOf(a);
      const sun = addDays(mon, 6);
      const sameMonth = mon.getMonth() === sun.getMonth();
      return sameMonth
        ? `${mon.toLocaleDateString([], { month: "long" })} ${mon.getDate()}–${sun.getDate()}`
        : `${mon.toLocaleDateString([], { month: "short", day: "numeric" })} – ${sun.toLocaleDateString([], { month: "short", day: "numeric" })}`;
    }
    case "month":
      return a.toLocaleDateString([], { month: "long", year: "numeric" });
    case "quarter":
      return `Q${quarterOf(a) + 1} ${a.getFullYear()}`;
    default:
      return String(a.getFullYear());
  }
}

/** The year, shown under the title when the title itself does not carry it. */
export const subtitleOf = (scale, anchor) =>
  scale === "agenda" || scale === "day" || scale === "week"
    ? String(new Date(anchor).getFullYear())
    : "";

/**
 * Six weeks of cells for one month, Monday-first.
 *
 * Always six rows, never five: a grid that changes height as you page through
 * the year makes the whole view jump, and the two leading blanks are cheaper
 * than that.
 */
export function monthMatrix(year, month) {
  const first = new Date(year, month, 1);
  const start = mondayOf(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** The months a scale spans, as [year, month] pairs. */
export function monthsIn(scale, anchor) {
  const { from, to } = rangeOf(scale, anchor);
  const out = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  while (cursor < to) {
    out.push([cursor.getFullYear(), cursor.getMonth()]);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

/**
 * Everything committed on one day, in minutes, indexed once.
 *
 * Built as a map rather than filtered per cell because a year view asks this
 * question 365 times and a linear scan of every event inside each of them is
 * how a calendar starts to feel slow on a real dataset.
 */
export function loadIndex(events = [], blocks = [], tasks = []) {
  const meetings = new Map();
  const work = new Map();
  const due = new Map();
  const bump = (map, key, mins) => map.set(key, (map.get(key) || 0) + mins);

  for (const e of events) {
    const k = dayKey(new Date(e.start));
    bump(meetings, k, Math.max(0, (new Date(e.end) - new Date(e.start)) / 60000));
  }
  for (const b of blocks) bump(work, b.day, b.mins || 0);
  for (const t of tasks) {
    if (t.done || !t.due) continue;
    due.set(t.due, (due.get(t.due) || 0) + 1);
  }
  return { meetings, work, due };
}

/**
 * How full a day is, 0 to 1.
 *
 * Measured against the part of the working window that is actually available —
 * the window less any standing commitments — so someone with a six-hour day
 * sees a full day at six hours rather than at eleven. A non-working day
 * reports null, which the grid draws differently: empty and off are not the
 * same thing, and colouring a Saturday "wide open" invites planning into it.
 */
export function loadOf(date, index, hours) {
  const k = dayKey(date);
  const mins = (index.meetings.get(k) || 0) + (index.work.get(k) || 0);
  if (!worksOn(date, hours.days)) return mins > 0 ? { off: true, ratio: 1, mins } : { off: true, ratio: 0, mins: 0 };
  const usable = Math.max(60, hours.windowMins - breakMinsOn(hours, new Date(date).getDay()));
  return { off: false, ratio: Math.min(1, mins / usable), mins };
}
