import { dayKey } from "./store.js";
import { workOn } from "./agenda.js";

/**
 * The end of the day, said once.
 *
 * A planner is a thing you fill in. That is the whole reason people stop using
 * them: every visit is another chore, and nothing ever visits you. This is the
 * one moment in the day the app has something to say rather than something to
 * ask — what got done, what did not, and one decision worth making before
 * tomorrow starts.
 *
 * It is not a notification and not a nag. It appears on the screen somebody is
 * already looking at, after their working day has ended, and it goes away when
 * it is dismissed or acted on. A review that reappears is a review that gets
 * dismissed unread within a week.
 *
 * The one action is deliberate. "Move what you did not get to into tomorrow"
 * is the decision people actually make at six o'clock, and offering three
 * choices instead of one turns a moment of closure into a small admin task.
 */

/**
 * What happened today, and what is worth doing about it.
 *
 * @returns {{
 *   finished: object[], missed: object[], focusedMs: number, meetings: number,
 *   worthShowing: boolean, headline: string,
 * }}
 */
export function reviewOf(state, now = new Date()) {
  const day = dayKey(now);

  const finished = (state?.tasks ?? []).filter(
    (t) => t.done && t.doneAt && dayKey(new Date(t.doneAt)) === day,
  );

  // Work the planner laid into today that is still open. Not "everything
  // overdue" — this is about the day just spent, and a task that was never
  // scheduled for today was never missed today.
  const planned = workOn(state?.blocks ?? [], state?.tasks ?? [], day);
  const missed = [...new Map(
    planned.filter((b) => b.task && !b.task.done).map((b) => [b.taskId, b.task]),
  ).values()];

  const focusedMs = (state?.sessions ?? [])
    .filter((s) => dayKey(new Date(s.endedAt)) === day)
    .reduce((n, s) => n + (s.focusedMs || 0), 0);

  const meetings = (state?.events ?? [])
    .filter((e) => dayKey(new Date(e.start)) === day).length;

  return {
    finished,
    missed,
    focusedMs,
    meetings,
    // A day with nothing in it has nothing to review. Saying "you did nothing
    // today" to somebody who took the day off is the single fastest way to
    // make this feature unwelcome.
    worthShowing: finished.length > 0 || missed.length > 0 || focusedMs > 0,
    headline: headlineFor(finished.length, missed.length),
  };
}

/**
 * The first line, which sets whether this reads as encouragement or as an
 * audit. Every branch is neutral about the shortfall and specific about the
 * work: naming what was finished is the part that makes somebody open this
 * again tomorrow, and no branch implies the day should have gone differently.
 */
function headlineFor(done, missed) {
  if (done && !missed) return done === 1 ? "One thing done, and the day's clear." : "All of it done.";
  if (done && missed) return `${done} done, ${missed} didn't get to.`;
  if (!done && missed) return missed === 1 ? "One thing didn't get to." : `${missed} things didn't get to.`;
  return "That's the day.";
}

/**
 * Whether to offer the review at all.
 *
 * After the working day has ended, once, on a day that had something in it.
 * `seenOn` is the day key it was last dismissed — stored rather than derived,
 * because "have they seen this" is not something the rest of the state knows.
 */
export function shouldReview(state, now = new Date(), endHour = 17) {
  if (state?.settings?.review === false) return false;
  const day = dayKey(now);
  if (state?.settings?.reviewSeen === day) return false;
  if (now.getHours() < endHour) return false;
  return reviewOf(state, now).worthShowing;
}
