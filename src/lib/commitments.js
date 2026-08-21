/**
 * The parts of the week that are already spoken for.
 *
 * Lunch, the gym, the school run, standing team time. These are not meetings
 * and nobody wants to enter them as meetings every week, but the planner has
 * to know the time is gone — otherwise it lays two hours of focus across the
 * school run and hands back a week that cannot be kept.
 *
 * They are stored as `hours.breaks`, which the scheduler already subtracts
 * from every day's usable minutes. Nothing new is invented here: this is the
 * vocabulary for the same field, so that onboarding can ask the question in
 * words somebody recognises rather than showing them a repeating-interval
 * editor on their first morning.
 *
 * ## Why presets rather than a blank form
 *
 * A blank "add a commitment" form on step two of onboarding gets skipped, and
 * a skipped answer here is the difference between a plan that fits and a plan
 * that looks fine and cannot be kept. Four buttons that fill themselves in are
 * answered; a form is abandoned. Every one of them is still editable
 * afterwards in Settings, where somebody who cares has the patience for it.
 */

/** Monday to Friday. 0 is Sunday, matching `Date#getDay`. */
const WEEKDAYS = [1, 2, 3, 4, 5];

/**
 * The four that cover most people, with hours that are defensible defaults
 * rather than guesses: lunch at midday, a gym hour at either end of the day,
 * a school run at the times schools actually start and finish.
 */
export const PRESETS = [
  { id: "lunch", label: "Lunch", start: 12, end: 13, days: WEEKDAYS },
  { id: "gym", label: "Gym", start: 7, end: 8, days: [1, 3, 5] },
  { id: "school", label: "School run", start: 8, end: 9, days: WEEKDAYS },
  { id: "standup", label: "Standing team meeting", start: 9, end: 9.5, days: [1] },
];

/** "12pm", "9:30am" — the way a person says a time, not the way a clock stores it. */
export function sayTime(h) {
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  const hour = ((whole + 11) % 12) + 1;
  const suffix = whole < 12 ? "am" : "pm";
  return mins ? `${hour}:${String(mins).padStart(2, "0")}${suffix}` : `${hour}${suffix}`;
}

const DAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * Which days, said briefly.
 *
 * "Weekdays" rather than "M T W T F", because five letters in a row is
 * something to decode and one word is something to read. The named cases are
 * the ones that come up; anything else falls back to the letters, which is
 * still shorter than a sentence.
 */
export function sayDays(days = []) {
  const set = [...new Set(days)].sort();
  if (set.length === 7) return "Every day";
  if (set.length === 5 && set.every((d) => d >= 1 && d <= 5)) return "Weekdays";
  if (set.length === 2 && set.includes(0) && set.includes(6)) return "Weekends";
  if (set.length === 1) return ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"][set[0]];
  return set.map((d) => DAY_LETTER[d]).join(" ");
}

/** "Lunch · Weekdays · 12pm–1pm" — one commitment, as one line. */
export const sayCommitment = (c) =>
  `${c.label} · ${sayDays(c.days)} · ${sayTime(c.start)}–${sayTime(c.end)}`;

/**
 * How much of the week these actually take, in minutes.
 *
 * The number onboarding shows back, because "three commitments" means nothing
 * and "six and a half hours a week" is a person recognising their own life.
 * Counted per day rather than per commitment: a gym hour on three days is
 * three hours, and a table that says one is a table nobody trusts twice.
 */
export const weeklyMinsOf = (commitments = []) =>
  commitments.reduce(
    (total, c) => total + Math.max(0, (c.end - c.start) * 60) * (c.days?.length || 0),
    0,
  );

/**
 * Ready for `hours.breaks`.
 *
 * Anything without a real span is dropped rather than stored: a commitment
 * that takes no time is a row somebody has to look at for ever and a zero the
 * scheduler has to defend against on every day it plans.
 */
export const toBreaks = (commitments = []) =>
  commitments
    .filter((c) => c && c.end > c.start && (c.days?.length || 0) > 0)
    .map((c) => ({
      id: c.id,
      label: c.label,
      start: c.start,
      end: c.end,
      days: c.days,
    }));
