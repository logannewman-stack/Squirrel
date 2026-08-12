/**
 * When is this actually happening?
 *
 * The planner already decides. Set a two-hour job at high priority due Friday
 * and `distribute` books it into tomorrow, 09:00–11:00, before the form has
 * finished closing — correctly, against the real gaps in the real week. Then
 * the screen you are standing on says:
 *
 *     Draft the lease redlines
 *     120m   3d
 *
 * Two numbers, neither of them the answer. A browser walk of the whole chain —
 * make a project, add work to it with a duration, a rank and a deadline, then
 * go looking for the consequence — found the decision reached the store and
 * reached no screen at all. The calendar had it. Nothing else did, and nothing
 * said to go and look.
 *
 * That is the difference between an app that plans your week and an app that
 * files your week: the second one makes you go and check. Every screen here
 * that shows a task now says when it will be done, and they all say it from
 * this one function, because the failure mode of putting the sentence in three
 * components is three components that eventually disagree — and a planner
 * caught contradicting itself about your Thursday is finished.
 *
 * ## Two registers
 *
 * `short` goes on a row beside a title, where there is space for three or four
 * words and the reader is scanning. `long` is a whole sentence, for the moment
 * after somebody has just done something and is owed an answer about it.
 *
 * They are the same fact. A row saying "3h short" and a sentence saying "an
 * extra 45m a day would do it" are one state of the world, described at two
 * lengths, and they are computed together so they cannot drift apart.
 */
import { sayMins } from "./hours.js";
import { whenLabel } from "./search.js";
import { dayKey } from "./store.js";

/** 09:00 → "9:00 AM". Blocks that never got a real slot have no time at all. */
const clock = (iso) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";

/**
 * "tomorrow", "Thu", "12 Aug" — the search palette's date, deliberately.
 *
 * There were already two ways to say a date in this codebase and no reason for
 * a third. A person who reads "tomorrow" in one list and "Aug 12" in the next
 * has to do the conversion themselves to notice it is the same day.
 */
const day = (key, now) => whenLabel(key, now);

/** Sentence-initial "Tomorrow" from a mid-sentence "tomorrow". */
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * The state of one task's schedule, in both registers.
 *
 * `plan` is the store — `{blocks, shortfalls, spent}` — so callers pass the
 * state they already have rather than re-running the planner. Re-running it
 * per row would be the other way to get two screens disagreeing: a component
 * that plans for itself is planning against a slightly different `now`.
 *
 * @returns {{state, short, long, blocks, day, start, mins}}
 *   state  scheduled | short | spent | unestimated | unplanned | delegated | done
 */
export function whenTask(task, plan = {}, opts = {}) {
  if (!task) return null;
  const now = opts.now || new Date();
  const none = { blocks: [], day: null, start: null, mins: 0 };

  if (task.done) return { state: "done", short: "", long: "Done.", ...none };

  // Handed over is a decision, not a gap. Reporting "not booked yet" for work
  // that is deliberately somebody else's reads as the app having missed the
  // handover, and invites you to make it twice.
  if (task.delegatedTo) {
    return {
      state: "delegated",
      short: `with ${task.delegatedTo}`,
      long: `${task.delegatedTo} has it.`,
      ...none,
    };
  }

  const mine = (plan.blocks || [])
    .filter((b) => b.taskId === task.id)
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  /**
   * It does not fit — and this is checked *before* the bookings, because a
   * task is routinely both.
   *
   * Fifty hours due Thursday comes back as ten hours booked across two days
   * and a forty-hour shortfall. Reading the blocks first, that task reports
   * "10h across 2 sittings" — true, reassuring, and missing the only part that
   * matters. The planner already knew the deadline was gone; the sentence
   * quietly agreed to a plan that misses it.
   *
   * So the gap wins, and the booked hours go into the same sentence rather
   * than being dropped in turn. Both facts are real and a person needs both:
   * what is committed, and that it is not enough.
   */
  const miss = (plan.shortfalls || []).find((s) => s.taskId === task.id);
  if (miss) {
    const gap = sayMins(miss.shortMins);
    const by = miss.due ? ` before ${day(miss.due, now)}` : "";
    const booked = mine.reduce((n, b) => n + b.mins, 0);
    const some = booked
      ? ` ${sayMins(booked)} of it is booked, from ${day(mine[0].day, now)}.`
      : "";
    const fix = miss.catchUpIsPossible && miss.extraPerDayMins
      ? ` An extra ${sayMins(miss.extraPerDayMins)} a day would do it.`
      : miss.fitsBy
        ? ` It would fit by ${day(miss.fitsBy, now)}.`
        : "";
    return {
      state: "short",
      short: `${gap} short`,
      long: `Won't fit${by} — ${gap} short.${some}${fix}`,
      blocks: mine,
      day: mine[0]?.day || null,
      start: mine[0]?.start || null,
      mins: booked,
    };
  }

  if (mine.length) {
    const first = mine[0];
    const last = mine[mine.length - 1];
    const total = mine.reduce((n, b) => n + b.mins, 0);
    const at = clock(first.start);
    const startDay = day(first.day, now);

    // One sitting is the ordinary case and gets the ordinary sentence: a day
    // and a time, which is what somebody means by "when".
    if (mine.length === 1) {
      const ends = clock(first.end);
      return {
        state: "scheduled",
        // Both ends of the sitting already say how long it is. "9:00 AM–11:00
        // AM — 2h" is the app doing subtraction out loud at somebody who can
        // see both numbers.
        long: at && ends
          ? `${cap(startDay)}, ${at}–${ends}.`
          : at
            ? `${cap(startDay)} at ${at} — ${sayMins(total)}.`
            : `${cap(startDay)} — ${sayMins(total)}, once the day has room.`,
        short: at ? `${startDay} ${at}` : startDay,
        blocks: mine,
        day: first.day,
        start: first.start || null,
        mins: total,
      };
    }

    /**
     * Split work: the row wants the runway, not the itinerary. "tomorrow →
     * Fri" is the shape of the commitment; the sentence underneath can afford
     * the sitting count.
     *
     * Unless the sittings share one day — "today → today" is an arrow from a
     * place to itself, and it displaced the clock time, which on a same-day
     * split is the only fact the reader wanted.
     */
    if (first.day === last.day) {
      return {
        state: "scheduled",
        short: at ? `${startDay} ${at}` : startDay,
        long: `${sayMins(total)} across ${mine.length} sittings ${startDay}${at ? `, first at ${at}` : ""}.`,
        blocks: mine,
        day: first.day,
        start: first.start || null,
        mins: total,
      };
    }
    return {
      state: "scheduled",
      short: `${startDay} → ${day(last.day, now)}`,
      long:
        `${sayMins(total)} across ${mine.length} sittings, ` +
        `${startDay}${at ? ` at ${at}` : ""} through ${day(last.day, now)}.`,
      blocks: mine,
      day: first.day,
      start: first.start || null,
      mins: total,
    };
  }

  /**
   * The estimate is used up and nobody ticked the box. Only the person knows
   * whether that means finished or means longer than you thought, so the
   * sentence is a question rather than a verdict.
   */
  const used = (plan.spent || []).find((s) => s.taskId === task.id);
  if (used) {
    return {
      state: "spent",
      short: "time's up",
      long: `The ${sayMins(used.estimateMins)} you set is used up — finished, or does it need longer?`,
      ...none,
    };
  }

  // No duration means nothing to lay down. This is the commonest reason a task
  // is missing from the calendar, and it is entirely fixable by the person
  // reading it, so the sentence says which fix.
  if (!(task.estimateMins > 0)) {
    return {
      state: "unestimated",
      short: "no estimate",
      long: "No estimate on it, so it isn't in the plan. Say how long it takes and it books itself.",
      ...none,
    };
  }

  // Estimated, open, and still nowhere: the days it could use are full of
  // other work. Not a shortfall — there is no deadline being missed — but not
  // planned either, and silently showing nothing is how work goes missing.
  return {
    state: "unplanned",
    short: "not booked",
    long: "Nothing booked yet — the days it could use are already full.",
    ...none,
  };
}

/**
 * When does a whole project land?
 *
 * `projectLoad` answers how much is left and whether the pace is survivable.
 * This answers the other half — the date the last piece of it is currently
 * booked for — which is the number somebody actually reports to a client.
 *
 * Deliberately built from the same blocks as `whenTask`, so the project's
 * finish date can never be a day the tasks disagree with.
 */
export function whenProject(project, tasks = [], plan = {}, opts = {}) {
  const now = opts.now || new Date();
  const mine = tasks.filter((t) => t.projectId === project?.id && !t.done && !t.delegatedTo);
  if (!mine.length) return { state: "clear", short: "", long: "Nothing open on it." };

  const ids = new Set(mine.map((t) => t.id));
  const blocks = (plan.blocks || []).filter((b) => ids.has(b.taskId));
  const missing = (plan.shortfalls || []).filter((s) => ids.has(s.taskId));
  const mins = blocks.reduce((n, b) => n + b.mins, 0);

  /**
   * A project with anything at all that does not fit is described by that,
   * whatever else is booked. "Finishes Wednesday" beside three tasks that miss
   * their deadlines is the most expensive kind of true.
   */
  if (missing.length) {
    const gap = sayMins(missing.reduce((n, s) => n + s.shortMins, 0));
    return {
      state: "short",
      short: `${gap} short`,
      long:
        missing.length === 1
          ? `“${missing[0].title}” won't fit — ${gap} short.`
          : `${missing.length} pieces won't fit — ${gap} short between them.`,
    };
  }

  if (!blocks.length) {
    const why = mine.every((t) => !(t.estimateMins > 0))
      ? "Nothing has an estimate, so none of it is in the plan."
      : "None of it is booked yet.";
    return { state: "unplanned", short: "not booked", long: why };
  }

  const last = blocks.reduce((a, b) => (b.day > a.day ? b : a));
  const ends = day(last.day, now);
  const late = project?.due && last.day > project.due;

  return {
    state: late ? "late" : "scheduled",
    short: late ? `ends ${ends}, past due` : `ends ${ends}`,
    long: late
      ? `As booked it finishes ${ends} — after the ${day(project.due, now)} deadline.`
      : `${sayMins(mins)} booked, finishing ${ends}.`,
    day: last.day,
    mins,
  };
}

/**
 * Everything booked for one day, newest plan first — used by the day view and
 * by the confirmation after something is added, which needs to say what the
 * new work is sharing the day with.
 */
export const bookedOn = (plan = {}, key = dayKey()) =>
  (plan.blocks || []).filter((b) => b.day === key);
