/**
 * What a company can see about its team, said as a number somebody can act on.
 *
 * The enterprise tier sells visibility, and visibility delivered literally is
 * close to worthless: twelve people, a list of tasks each, and a manager
 * scrolling. Nobody reads forty lists. The question a person who bought seats
 * actually has is not "what is Sam doing" — it is **"who is drowning, and what
 * is going to slip"** — and that question has an arithmetic answer the app
 * already holds every input for.
 *
 * So this module turns rows into that answer. Per person: how much work is
 * committed in the next stretch of days, how much room there is to do it in,
 * and the ratio between them. Across the team: who is over, what is already
 * late, and one sentence a manager can read on a phone.
 *
 * ## Committed against room, not tasks against days
 *
 * Counting open tasks is the obvious measure and a misleading one — eleven
 * two-minute errands and one three-day rewrite both read as "eleven or twelve
 * tasks". The number that predicts a missed deadline is hours of work due
 * against hours available to do it in, which is the same arithmetic the
 * planner already uses to decide a week does not fit. Every estimate in the
 * app exists because somebody typed it; this spends them.
 *
 * Overdue work counts against the window in full. It has no time left of its
 * own, so it takes time from the days ahead — which is exactly what happens in
 * practice, and exactly why a person with a backlog keeps falling further
 * behind. A model that quietly excludes late work reports the calmest number
 * about the most stretched person.
 *
 * ## The working week is assumed, and the app says so
 *
 * A member's own hours live on their device, and the administrator reading
 * this cannot see them. So the standard week is assumed and the assumption is
 * printed on the screen rather than hidden in a constant — the difference
 * between "Sam is at 140%" and "Sam is at 140% of a standard week" is the
 * difference between a fact and an accusation, and only one of them survives
 * the conversation where Sam says they work Tuesdays to Saturdays.
 *
 * ## What is deliberately not here
 *
 * No score, no ranking, no "productivity". The numbers are load and lateness —
 * measures of whether a commitment is realistic — and they stop there.
 * A per-person productivity score computed by an employer out of a planner is
 * how a planning tool becomes a thing employees route around, and a planner
 * people keep a second private list to avoid is worth nothing to the company
 * that bought it.
 */

import { hoursOf, usableMinsOn } from "./hours.js";
import { dayKey } from "./store.js";

/** The window everything is measured over: the working week ahead, in days. */
export const HORIZON = 7;

/**
 * The standard week, normalised.
 *
 * `hoursOf({})` rather than `DEFAULT_HOURS` because the raw defaults are a
 * settings shape, not a usable one — the derived `windowMins` that every
 * capacity calculation divides by is added by the normaliser. Reading the
 * constant directly produces NaN through a chain long enough that the first
 * symptom is a team screen full of "over capacity".
 */
export const STANDARD_WEEK = hoursOf({});

/**
 * The states a person's week can be in, in the order a manager should meet
 * them: the problem first, the fine last.
 *
 * `empty` is separate from `clear` on purpose. Both look like "no work" in a
 * count, and they mean opposite things — one person has a genuinely open week,
 * the other has not written anything down, which is the more interesting fact
 * of the two and the one a total would bury.
 */
export const LOAD = {
  over:   { rank: 0, label: "Over capacity", tone: "alert" },
  full:   { rank: 1, label: "Full", tone: "warn" },
  steady: { rank: 2, label: "Steady", tone: "calm" },
  clear:  { rank: 3, label: "Clear", tone: "calm" },
  empty:  { rank: 4, label: "Nothing on record", tone: "quiet" },
};

const mins = (t) => (Number.isFinite(t?.estimateMins) ? t.estimateMins : 30);
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/**
 * Minutes of focused work available between today and the end of the horizon.
 *
 * Today counts in full, which slightly overstates the room on a Friday
 * afternoon. The alternative — prorating the current day by the clock — makes
 * the same person's load jump every time they look at it, and a number that
 * changes while nothing changed is a number people stop believing.
 */
export function roomFor(from = new Date(), hours = STANDARD_WEEK, horizon = HORIZON) {
  let total = 0;
  for (let i = 0; i < horizon; i++) {
    const d = addDays(from, i);
    if (hours.days.includes(d.getDay())) total += usableMinsOn(hours, d.getDay());
  }
  return total;
}

/**
 * One person's week: what is committed, what room there is, and what is late.
 *
 * @param tasks  their tasks in the app's own shape — decode() Supabase rows first
 */
export function memberLoad(tasks = [], opts = {}) {
  const { today = new Date(), hours = STANDARD_WEEK, horizon = HORIZON } = opts;
  const from = dayKey(today);
  const to = dayKey(addDays(today, horizon - 1));

  const open = tasks.filter((t) => t && !t.done && !t.deletedAt);
  const overdue = open.filter((t) => t.due && t.due < from);
  const soon = open.filter((t) => t.due && t.due >= from && t.due <= to);
  // Work nobody has put a date on. Not counted as load — it is not committed
  // to anything — but named, because a team whose work is mostly undated has a
  // planning problem that no capacity number will ever show.
  const undated = open.filter((t) => !t.due);

  const committedMins = [...overdue, ...soon].reduce((n, t) => n + mins(t), 0);
  const roomMins = roomFor(today, hours, horizon);
  // A person with commitments and a week containing no working days is over,
  // not dividing by zero. Ratio is only meaningful when there is room to fill.
  const ratio = roomMins > 0 ? committedMins / roomMins : committedMins > 0 ? Infinity : 0;

  const state =
    !open.length ? "empty"
    : ratio >= 1 ? "over"
    : ratio >= 0.8 ? "full"
    : committedMins > 0 ? "steady"
    : "clear";

  return {
    state,
    open: open.length,
    overdue: overdue.length,
    dueSoon: soon.length,
    undated: undated.length,
    committedMins,
    roomMins,
    ratio,
    // The specific work behind the number, worst first. A manager who is told
    // somebody is over capacity immediately asks "over with what", and an
    // answer that requires another tap is an answer most people never get.
    late: overdue.slice().sort((a, b) => (a.due < b.due ? -1 : 1)),
  };
}

const hrs = (m) => Math.round((m / 60) * 10) / 10;

/** A person's load in a phrase, for the line under their name. */
export function sayLoad(load) {
  if (!load || load.state === "empty") return "Nothing on this account yet.";
  if (load.state === "clear") {
    return `${load.open} open · nothing due this week`;
  }
  const of = `${hrs(load.committedMins)}h due · ${hrs(load.roomMins)}h of room`;
  return load.overdue ? `${of} · ${load.overdue} late` : of;
}

/**
 * The whole team, worst first.
 *
 * @param people  [{ id, name, tasks }]
 */
export function teamLoad(people = [], opts = {}) {
  const rows = people.map((p) => ({ ...p, load: memberLoad(p.tasks, opts) }));

  rows.sort((a, b) => {
    const r = LOAD[a.load.state].rank - LOAD[b.load.state].rank;
    if (r) return r;
    // Within a state the more stretched person comes first, and a tie on load
    // is broken by who has more already late.
    if (b.load.ratio !== a.load.ratio) return b.load.ratio - a.load.ratio;
    return b.load.overdue - a.load.overdue;
  });

  const totals = rows.reduce(
    (t, r) => ({
      people: t.people + 1,
      open: t.open + r.load.open,
      overdue: t.overdue + r.load.overdue,
      undated: t.undated + r.load.undated,
      committedMins: t.committedMins + r.load.committedMins,
      roomMins: t.roomMins + r.load.roomMins,
      over: t.over + (r.load.state === "over" ? 1 : 0),
      silent: t.silent + (r.load.state === "empty" ? 1 : 0),
    }),
    { people: 0, open: 0, overdue: 0, undated: 0, committedMins: 0, roomMins: 0, over: 0, silent: 0 },
  );

  return { rows, totals, headline: headlineFor(rows, totals) };
}

const NAMES = ["Nobody", "One person", "Two people", "Three people", "Four people"];
const count = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const people = (n) => (n < NAMES.length ? NAMES[n] : `${n} people`);

/**
 * One sentence, and only the most useful one.
 *
 * Ordered by what a manager would want interrupted for: somebody drowning,
 * then work already late, then a team that is not writing anything down, then
 * the good news. Three findings stacked into one line is a line nobody
 * finishes reading, so the others stay in the table underneath.
 */
export function headlineFor(rows, totals) {
  if (!totals.people) return "Nobody holds a seat yet.";
  if (totals.over) {
    const worst = rows[0];
    const who = totals.over === 1 ? (worst.name || "One person") : people(totals.over);
    return totals.over === 1
      ? `${who} has more due this week than the week holds.`
      : `${who} have more due this week than their weeks hold.`;
  }
  if (totals.overdue) return `${count(totals.overdue, "task")} across the team ${totals.overdue === 1 ? "is" : "are"} already late.`;
  if (totals.silent === totals.people) return "Nobody has anything on record yet.";
  if (totals.silent) return `${people(totals.silent)} ${totals.silent === 1 ? "has" : "have"} nothing on record.`;
  if (!totals.open) return "Nothing open across the team.";
  return `${count(totals.open, "task")} open, and everybody's week fits.`;
}
