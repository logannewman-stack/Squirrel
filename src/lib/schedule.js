/**
 * Laying work out over the time available for it.
 *
 * A task carries two numbers that a plain to-do list throws away: how long it
 * takes, and when it is due. Those two together decide everything. "Six hours,
 * due in nine days" is not a reminder, it is a shape — and the useful thing an
 * app can do is put that shape on a calendar around the meetings that are
 * already there.
 *
 * The method is water-filling. Each task gets an even share across the days it
 * can use; where a day cannot take its share, the excess flows to the next day
 * that can. Even spreading beats front-loading everything, because a day that
 * gets filled to the brim is a day that gets abandoned. But it deliberately
 * does not spread all the way to the deadline: there is a buffer, because
 * finishing on the morning something is due is the same as being late once
 * anything at all goes wrong.
 *
 * Two properties matter more than elegance here:
 *
 *   It says when it does not fit. The most valuable output is not a schedule,
 *   it is "you have nineteen hours of work and eleven hours open before
 *   Friday." That is a decision the user has to make while there is still time
 *   to make it, and no amount of clever packing substitutes for it.
 *
 *   It is stable. Re-planning keeps blocks that are still valid, because a
 *   planner that reshuffles the week every time you open it is one nobody
 *   trusts twice.
 */

import { dayKey } from "./store.js";
import { findFreeSlots, atHour, WORK_START, WORK_END, DAILY_CAPACITY_MINS } from "./agenda.js";

/** Below this, a block is an interruption rather than a session. */
export const MIN_BLOCK_MINS = 45;

/** Days of air before the deadline. Finishing the morning of is being late. */
export const BUFFER_DAYS = 1;

/** How far out to plan at all. Past this, a deadline is not yet actionable. */
export const HORIZON_DAYS = 60;

/**
 * Most tasks one day may carry.
 *
 * Not a capacity limit — capacity is minutes. This is about shape: a day cut
 * into eight pieces is a day of context switches, and the plan that produces
 * it looks thorough and is unfollowable. Fewer, longer sittings finish more
 * work than a schedule that is technically optimal.
 */
export const MAX_TASKS_PER_DAY = 4;

/** Below this a placed piece is an interruption, not a sitting. */
const MIN_FRAGMENT_MINS = 15;

/** Allocations are quarter-hour multiples, so remainders are too. */
const QUARTER = 15;

const DAY_MS = 86400000;
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  x.setHours(0, 0, 0, 0);
  return x;
};

/**
 * Does this date fall on a day the user works?
 *
 * `workDays` is the real answer — an explicit list, because Tuesday-to-Saturday
 * is a normal week for plenty of people and "weekends off" cannot express it.
 * The older `workWeekend` boolean is still honoured so settings written before
 * the list existed keep meaning what they meant.
 */
export function isWorkday(d, opts = {}) {
  const days = opts.workDays;
  if (Array.isArray(days) && days.length) return days.includes(d.getDay());
  return opts.workWeekend || (d.getDay() !== 0 && d.getDay() !== 6);
}

/**
 * One reading of the options, shared by every entry point here.
 *
 * The same four numbers were being defaulted independently in four functions,
 * which is how `distribute` came to respect a user's working hours while
 * `urgencyOf` — the thing that decides whether work *fits* in them — quietly
 * kept using 08:00 to 19:00. Two answers to the same question is worse than
 * one wrong answer, because only one of them is visible.
 */
function windowOf(opts = {}) {
  return {
    /**
     * Hours already gone today are not available, and every caller has to
     * agree about that.
     *
     * `distribute` set this for itself and nothing else did, so at five in the
     * afternoon `urgencyOf` and `projectLoad` were still counting the whole
     * 08:00–19:00 window as free. A task needing four hours by tomorrow came
     * back "high, fits, 300 minutes of room" from one and "120 minutes short"
     * from the other, on identical input — which is precisely the two-answers
     * failure this function was written to end, reappearing one field lower
     * down. Setting it here means no entry point can forget.
     */
    after: opts.after ?? opts.now ?? new Date(),
    minBlock: opts.minBlock ?? MIN_BLOCK_MINS,
    bufferDays: opts.bufferDays ?? BUFFER_DAYS,
    dailyCapacity: opts.dailyCapacity ?? DAILY_CAPACITY_MINS,
    workStart: opts.workStart ?? WORK_START,
    workEnd: opts.workEnd ?? WORK_END,
    workDays: Array.isArray(opts.workDays) && opts.workDays.length ? opts.workDays : null,
    workWeekend: opts.workWeekend ?? false,
    breaks: opts.breaks ?? [],
    maxPerDay: opts.maxPerDay ?? MAX_TASKS_PER_DAY,
  };
}

/**
 * How much of a task is left to do, in minutes.
 * Sessions already logged against it count as done, so a plan made on Tuesday
 * does not re-schedule Monday's work.
 */
export function remainingMins(task, sessions = []) {
  if (task.done) return 0;
  const spent = sessions
    .filter((s) => s.taskId === task.id)
    .reduce((n, s) => n + (s.focusedMs || 0), 0) / 60000;
  return Math.max(0, Math.round((task.estimateMins || 0) - spent));
}

/**
 * Minutes genuinely available on one day, after meetings and after whatever is
 * already committed to other tasks.
 */
function capacityOf(day, events, committed, opts) {
  const slots = findFreeSlots(day, events, {
    minMins: opts.minBlock,
    start: opts.workStart,
    end: opts.workEnd,
    after: opts.after,
    breaks: opts.breaks,
  });
  const free = slots.reduce((n, s) => n + s.mins, 0);
  const used = committed.get(day) || 0;
  return Math.max(0, Math.min(free, opts.dailyCapacity) - used);
}

/**
 * The days a task may use: from today (or its start) up to its deadline, less
 * the buffer, workdays only.
 */
function eligibleDays(task, from, opts) {
  const out = [];
  /**
   * "Don't start this until Thursday."
   *
   * The mirror of a deadline, and the thing that made "split it across
   * tomorrow and Thursday" impossible to honour: the planner front-loads
   * towards the earliest day with room, so naming the days it should use had
   * no way of being heard.
   */
  if (task.notBeforeDay) {
    const [ny, nm, nd] = task.notBeforeDay.split("-").map(Number);
    const earliest = new Date(ny, nm - 1, nd);
    earliest.setHours(0, 0, 0, 0);
    if (earliest > from) from = earliest;
  }
  if (!task.due) {
    // No deadline: plan the next working week and no further. Anything without
    // a date is not urgent by definition, and filling a month with it would
    // crowd out work that actually has one.
    for (let i = 0; out.length < 5 && i < 14; i++) {
      const d = addDays(from, i);
      if (isWorkday(d, opts)) out.push(d);
    }
    return out;
  }
  const [y, m, dd] = task.due.split("-").map(Number);
  const due = new Date(y, m - 1, dd);
  due.setHours(0, 0, 0, 0);
  const last = addDays(due, -opts.bufferDays);

  for (let i = 0; i <= HORIZON_DAYS; i++) {
    const d = addDays(from, i);
    if (d > last) break;
    if (isWorkday(d, opts)) out.push(d);
  }
  // Everything is already inside the buffer. Use what is left up to the
  // deadline itself rather than refusing to plan at all — a late plan still
  // beats no plan.
  if (!out.length) {
    for (let i = 0; i <= HORIZON_DAYS; i++) {
      const d = addDays(from, i);
      if (d > due) break;
      if (isWorkday(d, opts)) out.push(d);
    }
  }

  /**
   * The deadline has already gone, and neither loop above could help.
   *
   * Both walk forward from today and stop at a date in the past, so both ended
   * empty — and `distribute` drops any task with no eligible days. That
   * produced the worst answer this planner is capable of: an overdue task with
   * no block, no shortfall and no mention anywhere, while `urgencyOf` on the
   * same task returned "critical" and triage ranked it first. Surfaced
   * everywhere, scheduled nowhere.
   *
   * The same silence fell whenever the whole remaining window was non-working
   * — a Saturday, for something due Sunday, for a Monday-to-Friday worker.
   *
   * Once the window has closed the question stops being "which days are left
   * before the deadline" and becomes "when can this actually be done", so it
   * is answered the way work with no deadline is: the next few working days.
   * `distribute` fills the earliest first, so a short overdue task lands today
   * and only a genuinely large one spreads.
   */
  if (!out.length) {
    for (let i = 0; out.length < 5 && i <= HORIZON_DAYS; i++) {
      const d = addDays(from, i);
      if (isWorkday(d, opts)) out.push(d);
    }
  }
  return out;
}

/**
 * Order tasks by how little room they have to manoeuvre.
 *
 * Slack — time available minus time needed — is the right measure, not the
 * deadline alone. A two-hour task due Friday is less urgent than a twelve-hour
 * task due next Tuesday, and sorting by date gets that backwards.
 */
function byUrgency(a, b) {
  // Work that cannot fit goes last, however alarming its slack.
  //
  // Slack alone put the most impossible task first, and being greedy it took
  // every hour in the window — so forty hours of work due Saturday consumed
  // Wednesday, Thursday and Friday, and two three-hour tasks that would each
  // have finished comfortably were reported as fitting in nothing at all.
  // Three missed deadlines where one was unavoidable. Missing a deadline by
  // thirty hours is missing it whether or not the other two are also blown.
  const aLost = a.slack < 0;
  const bLost = b.slack < 0;
  if (aLost !== bLost) return aLost ? 1 : -1;
  if (a.slack !== b.slack) return a.slack - b.slack;
  const rank = { critical: 0, high: 1, normal: 2, low: 3 };
  if (rank[a.task.priority] !== rank[b.task.priority]) {
    return rank[a.task.priority] - rank[b.task.priority];
  }
  return (a.task.createdAt || 0) - (b.task.createdAt || 0);
}

/**
 * Distribute open work across the days before each deadline.
 *
 * @returns {{blocks, shortfalls, unestimated, byDay, totals}}
 *   blocks      [{taskId, day, mins, start, end}] — placed work, in day order
 *   shortfalls  what does not fit, and what would make it fit
 *   unestimated tasks with no duration on them, which cannot be planned at all
 *   spent       tasks whose estimate is used up but which are still open
 *   byDay       Map(day → minutes committed)
 *   totals      {plannedMins, shortfallMins, taskCount}
 */
export function distribute(tasks, events, sessions = [], opts = {}) {
  const o = { ...windowOf(opts), from: opts.now || new Date() };
  o.after = o.from;
  const from = new Date(o.from);
  from.setHours(0, 0, 0, 0);

  // Delegated work is tracked, not personally scheduled. Handing something to
  // Anders and then finding it blocked out in your own Thursday is the planner
  // arguing with a decision you already made.
  const mine = tasks.filter((t) => !t.done && !t.delegatedTo);

  // A task with no duration on it cannot be laid anywhere. It used to be
  // dropped in silence, which is the worst of the options: the week looks like
  // it fits because a third of the work was never counted. It comes back as
  // its own list instead.
  const unestimated = mine
    .filter((t) => !(t.estimateMins > 0))
    .map((t) => ({ taskId: t.id, title: t.title, due: t.due || null }));

  /**
   * Work whose estimate is used up but which nobody has ticked off.
   *
   * `remainingMins` reaches zero once logged sessions cover the estimate, and
   * such a task was simply dropped here — no block, no shortfall, and not in
   * `unestimated` either, so it appeared on no screen at all. The app
   * manufactures this state with its own core loop: start a focus session, let
   * the timer run out, forget the checkbox. For a planner built around
   * *starting* things, that is the commonest way a session ends, and the work
   * silently left the plan at exactly the moment somebody had done it.
   *
   * It is not a scheduling problem — there is nothing left to schedule — it is
   * a question only the person can answer: is this finished, or did it need
   * longer than you thought? So it comes back as its own list, the same way
   * unestimated work does, and Today asks.
   */
  const spent = mine
    .filter((t) => t.estimateMins > 0 && remainingMins(t, sessions) <= 0)
    .map((t) => ({
      taskId: t.id,
      title: t.title,
      due: t.due || null,
      estimateMins: t.estimateMins,
      spentMins: Math.round(
        sessions.filter((x) => x.taskId === t.id).reduce((n, x) => n + (x.focusedMs || 0), 0) / 60000,
      ),
    }));

  const open = mine
    .filter((t) => t.estimateMins > 0 && remainingMins(t, sessions) > 0)
    .map((task) => {
      const need = remainingMins(task, sessions);
      const days = eligibleDays(task, from, o);
      return { task, need, days };
    })
    .filter((x) => x.days.length);

  // Committed minutes per day, shared by every task, so two deadlines cannot
  // both claim the same afternoon.
  const committed = new Map();
  const capacityCache = new Map();
  const capacity = (day) => {
    if (!capacityCache.has(day)) {
      capacityCache.set(day, capacityOf(day, events, new Map(), o));
    }
    return Math.max(0, capacityCache.get(day) - (committed.get(day) || 0));
  };

  // How many distinct jobs each day has already been given. Minutes are not
  // the only budget; attention is one too.
  const jobsOn = new Map();
  const hasRoomFor = (day, taskId) => {
    const set = jobsOn.get(day);
    return !set || set.has(taskId) || set.size < o.maxPerDay;
  };
  const claim = (day, taskId, mins) => {
    if (!jobsOn.has(day)) jobsOn.set(day, new Set());
    jobsOn.get(day).add(taskId);
    committed.set(day, (committed.get(day) || 0) + mins);
  };

  // Rank by slack, which needs each task's available time first.
  const ranked = open
    .map((x) => ({
      ...x,
      slack: x.days.reduce((n, d) => n + capacity(dayKey(d)), 0) - x.need,
    }))
    .sort(byUrgency);

  const blocks = [];
  const shortfalls = [];

  for (const { task, need, days } of ranked) {
    let left = need;
    const keys = days.map(dayKey);

    // Pass one: an even share, so the work is spread rather than dumped on the
    // first day with room.
    //
    // Spread across at most as many days as can each take a real block. An
    // hour of work over a fortnight was coming out as 45 minutes and then a
    // stranded 15 — the split is supposed to make work approachable, and a
    // quarter-hour fragment on its own day is the opposite of that.
    //
    // The share is rounded up to a quarter of an hour. Sixty-nine-minute
    // shares are arithmetically neat and produce nine-minute leftovers the
    // moment a meeting cuts the day, and nine minutes is not a sitting.
    /**
     * A rate the person asked for: "give the term sheet two hours a day".
     *
     * Without it the even share is decided purely by the runway, so a request
     * to go at two hours a day came back at two and a half — the arithmetic
     * was right and the answer was not what was asked for. With a cap set, the
     * spread widens instead of the daily amount growing.
     */
    const cap = task.maxPerDayMins > 0 ? task.maxPerDayMins : Infinity;

    const spreadOver = Math.max(
      1,
      Math.floor(need / o.minBlock),
      Number.isFinite(cap) ? Math.ceil(need / cap) : 0,
    );
    const usable = keys.slice(0, spreadOver);
    const even = Math.ceil(need / usable.length);
    let share = Math.min(cap, Math.max(o.minBlock, Math.ceil(even / QUARTER) * QUARTER));
    // Rounding up can strand the last day with a stub — 200 minutes at a
    // 60-minute share is 60, 60, 60, and then 20. Spreading the same work over
    // one fewer sitting fixes it without leaving a fragment anywhere.
    const full = Math.floor(need / share);
    const tail = need - full * share;
    if (full >= 1 && tail > 0 && tail < o.minBlock) {
      share = Math.max(o.minBlock, Math.ceil(need / full / QUARTER) * QUARTER);
    }
    for (const day of usable) {
      if (left <= 0) break;
      if (!hasRoomFor(day, task.id)) continue;
      const room = capacity(day);
      if (room < Math.min(o.minBlock, left)) continue;
      const take = Math.min(left, share, room);
      if (take <= 0) continue;
      claim(day, task.id, take);
      blocks.push({ taskId: task.id, day, mins: take });
      left -= take;
    }

    // Pass two: whatever is left goes wherever it still fits. The even share
    // is a preference, not a rule, and missing a deadline to honour it would
    // be a strange trade.
    if (left > 0) {
      for (const day of keys) {
        if (left <= 0) break;
        if (!hasRoomFor(day, task.id)) continue;
        const room = capacity(day);
        if (room <= 0) continue;
        const at = blocks.find((b) => b.taskId === task.id && b.day === day);
        // The cap is a rate, not a preference, so it holds even here — the
        // point of asking for two hours a day is not to be given five on
        // Thursday because Thursday happened to be free.
        const take = Math.min(left, room, cap - (at?.mins || 0));
        if (take < Math.min(o.minBlock, left)) continue;
        if (at) at.mins += take;
        else blocks.push({ taskId: task.id, day, mins: take });
        claim(day, task.id, take);
        left -= take;
      }
    }

    if (left > 0) {
      shortfalls.push(shortfallFor(task, need, left, days, events, o, capacityCache, committed));
    }
  }

  // Give every block a real time by laying it into the day's actual gaps.
  const placed = placeInDay(blocks, events, o);

  return {
    blocks: placed,
    shortfalls,
    unestimated,
    spent,
    byDay: committed,
    totals: {
      plannedMins: placed.reduce((n, b) => n + b.mins, 0),
      shortfallMins: shortfalls.reduce((n, s) => n + s.shortMins, 0),
      taskCount: new Set(placed.map((b) => b.taskId)).size,
      unestimatedCount: unestimated.length,
      spentCount: spent.length,
    },
  };
}

/**
 * What does not fit, and what would make it.
 *
 * "You are eight hours short" is a fact. "You are eight hours short; two more
 * hours a day would do it, or moving the deadline to Tuesday" is a decision
 * someone can act on this morning. The second is the whole reason to compute
 * the first, and reporting only the gap leaves the user to do the arithmetic
 * that the planner just did and threw away.
 */
function shortfallFor(task, need, short, days, events, o, cache, committed = new Map()) {
  const workdays = days.length;
  const fresh = (day) => {
    if (!cache.has(day)) cache.set(day, capacityOf(day, events, new Map(), o));
    return cache.get(day);
  };

  /**
   * The first date by which the work would fit — the answer to "so when
   * could this be done?"
   *
   * Counted against the week as it actually stands, not an empty one. The
   * running sum used raw capacity and ignored everything the plan had just
   * committed, so the banner contradicted itself in adjacent clauses: "none
   * of it fits before the 15th — it fits by the 12th." Both clauses were
   * arithmetic; only one was about this person's week. Days the deadline has
   * already passed count for nothing either, or the promise can land before
   * the miss it is consoling.
   */
  let fitsBy = null;
  let running = 0;
  for (let i = 0; i <= HORIZON_DAYS; i++) {
    const d = addDays(days[0] || new Date(), i);
    if (!isWorkday(d, o)) continue;
    const k = dayKey(d);
    running += Math.max(0, fresh(k) - (committed.get(k) || 0));
    if (running >= need) {
      fitsBy = k;
      break;
    }
  }

  const perDay = workdays ? Math.ceil(need / workdays) : null;
  const extraPerDay = workdays ? Math.ceil(short / workdays) : null;

  return {
    taskId: task.id,
    title: task.title,
    needMins: need,
    availableMins: need - short,
    shortMins: short,
    due: task.due,
    workdays,
    // Minutes a day this would need to fit in the time that is left.
    perDayMins: perDay,
    // Extra minutes a day on top of what is already free.
    extraPerDayMins: extraPerDay,
    // Whether that extra is a thing a person could actually do. "Ten more
    // hours a day" is arithmetic, not advice, and offering it as an option
    // makes the rest of the sentence untrustworthy.
    catchUpIsPossible: perDay != null && perDay <= o.dailyCapacity,
    // The date it *would* fit by, if the deadline could move.
    fitsBy,
  };
}

/**
 * Turn "90 minutes on Tuesday" into "Tuesday 09:00–10:30".
 *
 * Blocks are laid into the day's real gaps in the order they were allocated. A
 * block that will not fit any single remaining gap is split rather than
 * dropped — two 45-minute halves on the same day are still the work.
 */
function placeInDay(blocks, events, o) {
  const byDay = new Map();
  for (const b of blocks) {
    if (!byDay.has(b.day)) byDay.set(b.day, []);
    byDay.get(b.day).push(b);
  }

  const out = [];
  for (const [day, list] of byDay) {
    const gaps = findFreeSlots(day, events, {
      minMins: Math.min(o.minBlock, 15),
      start: o.workStart,
      end: o.workEnd,
      after: o.after,
      breaks: o.breaks,
    }).map((s) => ({ at: new Date(s.start), end: new Date(s.end) }));

    for (const b of list) {
      let left = b.mins;
      for (const gap of gaps) {
        if (left <= 0) break;
        const room = Math.round((gap.end - gap.at) / 60000);
        if (room <= 0) continue;
        const take = Math.min(left, room);
        const start = new Date(gap.at);
        const end = new Date(start.getTime() + take * 60000);
        out.push({ ...b, mins: take, start: iso(start), end: iso(end) });
        gap.at = end;
        left -= take;
      }
      // No gap could hold it — keep the commitment, without a clock time, so
      // it still shows up as work owed rather than silently evaporating.
      if (left > 0) out.push({ ...b, mins: left, start: null, end: null });
    }
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : (a.start || "").localeCompare(b.start || "")));
}

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

/**
 * A project's whole shape: how many hours are left in it, how many days remain,
 * and therefore the daily pace it demands.
 *
 * This is the arithmetic a person does badly in their head and then gets wrong
 * by a factor of two. Fifteen tasks averaging an hour, due in fifteen days, is
 * an hour a day — obvious once stated and almost never stated. Where it earns
 * its keep is the other direction: the same fifteen hours due in four days is
 * nearly four hours a day, every day, on top of whatever meetings already
 * exist, and that is a conversation to have on day one rather than day three.
 *
 * A task with no estimate is counted at the project's own average rather than
 * at zero. Zero silently understates the total, which is the failure mode that
 * matters — a project that looks achievable and is not.
 */
export function projectLoad(project, tasks, sessions = [], events = [], opts = {}) {
  const now = opts.now || new Date();
  const mine = tasks.filter((t) => t.projectId === project.id);
  const open = mine.filter((t) => !t.done);

  const estimated = open.filter((t) => t.estimateMins > 0);
  const avg = estimated.length
    ? Math.round(estimated.reduce((n, t) => n + t.estimateMins, 0) / estimated.length)
    : 60;

  const remaining = open.reduce(
    (n, t) => n + (t.estimateMins > 0 ? remainingMins(t, sessions) : avg), 0);

  // The project's own deadline if it has one, otherwise the last task deadline.
  const dates = [project.due, ...open.map((t) => t.due)].filter(Boolean).sort();
  const due = project.due || dates[dates.length - 1] || null;

  const o = windowOf(opts);
  let workdays = 0;
  let capacity = 0;
  if (due) {
    const [y, m, d] = due.split("-").map(Number);
    const end = new Date(y, m - 1, d);
    end.setHours(0, 0, 0, 0);
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    for (let i = 0; i <= HORIZON_DAYS; i++) {
      const day = addDays(from, i);
      if (day > end) break;
      if (!isWorkday(day, o)) continue;
      workdays++;
      capacity += capacityOf(dayKey(day), events, new Map(), o);
    }
  }

  const perDay = workdays ? Math.round(remaining / workdays) : null;

  return {
    projectId: project.id,
    name: project.name,
    due,
    openCount: open.length,
    doneCount: mine.length - open.length,
    avgMins: avg,
    remainingMins: remaining,
    workdays,
    // Minutes a day this project needs, if the work is spread evenly.
    perDayMins: perDay,
    // Minutes actually open across those days, after existing meetings.
    capacityMins: capacity,
    // Negative means it does not fit. This is the number worth surfacing.
    slackMins: due ? capacity - remaining : null,
    fits: due ? capacity >= remaining : null,
  };
}

/**
 * How urgent a task actually is, computed rather than declared.
 *
 * A user-set priority says how much something matters. It says nothing about
 * whether there is still time for it, and those are different questions —
 * "important" and "due in six hours with four hours of work in it" need
 * different responses. This derives the second from the ratio of work left to
 * time left:
 *
 *   over 1.0  there is not enough time. Something has to give, today.
 *   over 0.7  no slack for a bad day. Start now.
 *   over 0.4  comfortable but real.
 *   under     plenty of room.
 *
 * The declared priority breaks ties and lifts the result by one step, so
 * something the user marked critical is never reported as relaxed just because
 * the arithmetic is comfortable.
 */
export function urgencyOf(task, tasks, events, sessions = [], opts = {}) {
  const now = opts.now || new Date();
  const need = remainingMins(task, sessions);
  if (!need || task.done) return { level: "none", ratio: 0, need, capacity: 0 };

  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  const o = windowOf(opts);
  const days = eligibleDays(task, from, o);

  const capacity = days.reduce(
    (n, d) => n + capacityOf(dayKey(d), events, new Map(), o), 0);

  const ratio = capacity > 0 ? need / capacity : Infinity;
  const bump = { critical: 2, high: 1, normal: 0, low: -1 }[task.priority] ?? 0;
  const scale = ["low", "normal", "high", "critical"];
  // The floor is normal, not low. Comfortable is not the same as unimportant,
  // and 90 minutes due tomorrow reported as "low" is the kind of answer that
  // teaches a user to stop trusting the label. Only an explicit low priority,
  // via the bump below, can reach the bottom of the scale.
  const base = ratio >= 1 ? 3 : ratio >= 0.7 ? 2 : 1;
  const level = scale[Math.max(0, Math.min(3, base + bump))];

  return { level, ratio: Number.isFinite(ratio) ? Math.round(ratio * 100) / 100 : null, need, capacity, days: days.length };
}

/** Everything open, hardest first, with the arithmetic that put it there. */
export function triage(tasks, events, sessions = [], opts = {}) {
  const rank = { critical: 0, high: 1, normal: 2, low: 3, none: 4 };
  return tasks
    .filter((t) => !t.done)
    .map((task) => ({ task, ...urgencyOf(task, tasks, events, sessions, opts) }))
    .filter((x) => x.level !== "none")
    .sort((a, b) => rank[a.level] - rank[b.level] || (b.ratio ?? 0) - (a.ratio ?? 0));
}

/** Plain-English version of the above, for the assistant. */
export function describeLoad(load) {
  const h = (m) => (m >= 60 ? `${+(m / 60).toFixed(m % 60 ? 1 : 0)}h` : `${m}m`);
  if (!load.openCount) return `${load.name} is done — nothing open.`;
  if (!load.due) {
    return `${load.name}: ${load.openCount} open, ${h(load.remainingMins)} of work left. No deadline set, so I'm not pacing it.`;
  }
  const opening =
    `${load.name}: ${load.openCount} ${load.openCount === 1 ? "task" : "tasks"}, ` +
    `${h(load.remainingMins)} of work, due ${load.due}`;

  /**
   * A deadline already gone leaves no working days, so there is no pace to
   * quote — and dividing by zero produced `perDayMins: null`, which fell
   * straight through the `m >= 60` test and printed "about nullm a day" in a
   * sentence she reads out loud. There is nothing to say about pacing work
   * whose deadline has passed, so nothing is said.
   */
  if (!load.workdays) {
    return `${opening} — that's past, and ${h(load.remainingMins)} still open.`;
  }

  const lead =
    `${opening} — ${load.workdays} working ${load.workdays === 1 ? "day" : "days"} left, ` +
    `about ${h(load.perDayMins)} a day.`;
  if (load.fits) return `${lead} That fits, with ${h(load.slackMins)} to spare.`;
  return `${lead} It does not fit — you're ${h(Math.abs(load.slackMins))} short.`;
}

/** Human summary of a plan, for the assistant and the day view. */
export function describePlan(result, tasks) {
  const title = (id) => tasks.find((t) => t.id === id)?.title || "work";
  const lines = [];

  const days = [...new Set(result.blocks.map((b) => b.day))].sort();
  for (const day of days) {
    // Merged per task. A block split around lunch is one job with a gap in it,
    // not two — "Board deck 1h, Board deck 1h 45m" reads as a scheduling bug.
    const of = new Map();
    for (const b of result.blocks.filter((x) => x.day === day)) {
      of.set(b.taskId, (of.get(b.taskId) || 0) + b.mins);
    }
    const total = [...of.values()].reduce((n, m) => n + m, 0);
    lines.push(
      `${new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })} — ${say(total)}: ` +
        [...of.entries()].map(([id, mins]) => `${title(id)} ${say(mins)}`).join(", "),
    );
  }

  for (const s of result.shortfalls) {
    const fix = [
      s.catchUpIsPossible && s.extraPerDayMins ? `${say(s.extraPerDayMins)} more a day` : null,
      s.fitsBy && s.fitsBy !== s.due ? `a deadline of ${s.fitsBy}` : null,
    ].filter(Boolean);
    lines.push(
      `⚠ ${s.title} needs ${say(s.needMins)} and ` +
      `${s.availableMins > 0 ? `only ${say(s.availableMins)} fits` : "none of it fits"} before ` +
      `${s.due || "the deadline"} — ${say(s.shortMins)} short` +
      (fix.length ? `; ${fix.join(" or ")} would close it.` : "."),
    );
  }

  // A plan that silently omits a third of the work is worse than no plan.
  if (result.unestimated?.length) {
    const n = result.unestimated.length;
    lines.push(
      `${n} ${n === 1 ? "task has" : "tasks have"} no estimate, so ${n === 1 ? "it is" : "they are"} ` +
      `not in this: ${result.unestimated.slice(0, 3).map((u) => u.title).join(", ")}` +
      (n > 3 ? `, and ${n - 3} more` : "") + ".",
    );
  }
  return lines.join("\n");
}

/** "1h 45m", not "1.8h". Durations are read, not computed with. */
function say(mins) {
  const n = Math.max(0, Math.round(mins || 0));
  if (n < 60) return `${n}m`;
  const h = Math.floor(n / 60);
  const r = n % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}
