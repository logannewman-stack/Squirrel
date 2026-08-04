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

const DAY_MS = 86400000;
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  x.setHours(0, 0, 0, 0);
  return x;
};

/** Weekends are off by default — the setting is per user, not per task. */
const isWorkday = (d, workWeekend) => workWeekend || (d.getDay() !== 0 && d.getDay() !== 6);

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
  if (!task.due) {
    // No deadline: plan the next working week and no further. Anything without
    // a date is not urgent by definition, and filling a month with it would
    // crowd out work that actually has one.
    for (let i = 0; out.length < 5 && i < 14; i++) {
      const d = addDays(from, i);
      if (isWorkday(d, opts.workWeekend)) out.push(d);
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
    if (isWorkday(d, opts.workWeekend)) out.push(d);
  }
  // Everything is already inside the buffer, or past due. Use what is left up
  // to the deadline itself rather than refusing to plan at all — a late plan
  // still beats no plan.
  if (!out.length) {
    for (let i = 0; i <= HORIZON_DAYS; i++) {
      const d = addDays(from, i);
      if (d > due) break;
      if (isWorkday(d, opts.workWeekend)) out.push(d);
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
 * @returns {{blocks, shortfalls, byDay, totals}}
 *   blocks     [{taskId, day, mins, start, end}] — placed work, in day order
 *   shortfalls [{taskId, title, needMins, availableMins, due}] — what does not fit
 *   byDay      Map(day → minutes committed)
 *   totals     {plannedMins, shortfallMins, taskCount}
 */
export function distribute(tasks, events, sessions = [], opts = {}) {
  const o = {
    from: opts.now || new Date(),
    minBlock: opts.minBlock ?? MIN_BLOCK_MINS,
    bufferDays: opts.bufferDays ?? BUFFER_DAYS,
    dailyCapacity: opts.dailyCapacity ?? DAILY_CAPACITY_MINS,
    workStart: opts.workStart ?? WORK_START,
    workEnd: opts.workEnd ?? WORK_END,
    workWeekend: opts.workWeekend ?? false,
  };
  o.after = o.from;
  const from = new Date(o.from);
  from.setHours(0, 0, 0, 0);

  const open = tasks
    .filter((t) => !t.done && remainingMins(t, sessions) > 0)
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
    const key = day;
    if (!capacityCache.has(key)) {
      capacityCache.set(key, capacityOf(key, events, new Map(), o));
    }
    return Math.max(0, capacityCache.get(key) - (committed.get(key) || 0));
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
    const usable = keys.slice(0, Math.max(1, Math.floor(need / o.minBlock)));
    const share = Math.max(o.minBlock, Math.ceil(need / usable.length));
    for (const day of usable) {
      if (left <= 0) break;
      const room = capacity(day);
      if (room < Math.min(o.minBlock, left)) continue;
      const take = Math.min(left, share, room);
      if (take <= 0) continue;
      committed.set(day, (committed.get(day) || 0) + take);
      blocks.push({ taskId: task.id, day, mins: take });
      left -= take;
    }

    // Pass two: whatever is left goes wherever it still fits. The even share
    // is a preference, not a rule, and missing a deadline to honour it would
    // be a strange trade.
    if (left > 0) {
      for (const day of keys) {
        if (left <= 0) break;
        const room = capacity(day);
        if (room <= 0) continue;
        const take = Math.min(left, room);
        const at = blocks.find((b) => b.taskId === task.id && b.day === day);
        if (at) at.mins += take;
        else blocks.push({ taskId: task.id, day, mins: take });
        committed.set(day, (committed.get(day) || 0) + take);
        left -= take;
      }
    }

    if (left > 0) {
      shortfalls.push({
        taskId: task.id,
        title: task.title,
        needMins: need,
        availableMins: need - left,
        shortMins: left,
        due: task.due,
      });
    }
  }

  // Give every block a real time by laying it into the day's actual gaps.
  const placed = placeInDay(blocks, events, o);

  return {
    blocks: placed,
    shortfalls,
    byDay: committed,
    totals: {
      plannedMins: placed.reduce((n, b) => n + b.mins, 0),
      shortfallMins: shortfalls.reduce((n, s) => n + s.shortMins, 0),
      taskCount: new Set(placed.map((b) => b.taskId)).size,
    },
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

  const o = { workWeekend: opts.workWeekend ?? false, ...opts };
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
      if (!isWorkday(day, o.workWeekend)) continue;
      workdays++;
      capacity += capacityOf(dayKey(day), events, new Map(), {
        minBlock: MIN_BLOCK_MINS,
        workStart: opts.workStart ?? WORK_START,
        workEnd: opts.workEnd ?? WORK_END,
        dailyCapacity: opts.dailyCapacity ?? DAILY_CAPACITY_MINS,
      });
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
  const days = eligibleDays(task, from, {
    bufferDays: opts.bufferDays ?? BUFFER_DAYS,
    workWeekend: opts.workWeekend ?? false,
  });

  const o = {
    minBlock: MIN_BLOCK_MINS,
    workStart: opts.workStart ?? WORK_START,
    workEnd: opts.workEnd ?? WORK_END,
    dailyCapacity: opts.dailyCapacity ?? DAILY_CAPACITY_MINS,
  };
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
  const lead =
    `${load.name}: ${load.openCount} ${load.openCount === 1 ? "task" : "tasks"}, ` +
    `${h(load.remainingMins)} of work, due ${load.due} — ` +
    `${load.workdays} working ${load.workdays === 1 ? "day" : "days"} left, ` +
    `about ${h(load.perDayMins)} a day.`;
  if (load.fits) return `${lead} That fits, with ${h(load.slackMins)} to spare.`;
  return `${lead} It does not fit — you're ${h(Math.abs(load.slackMins))} short.`;
}

/** Human summary of a plan, for the assistant and the day view. */
export function describePlan(result, tasks) {
  const title = (id) => tasks.find((t) => t.id === id)?.title || "work";
  const hours = (m) => (m >= 60 ? `${+(m / 60).toFixed(1)}h` : `${m}m`);
  const lines = [];

  const days = [...new Set(result.blocks.map((b) => b.day))].sort();
  for (const day of days) {
    const of = result.blocks.filter((b) => b.day === day);
    const total = of.reduce((n, b) => n + b.mins, 0);
    lines.push(
      `${new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })} — ${hours(total)}: ` +
        of.map((b) => `${title(b.taskId)} ${hours(b.mins)}`).join(", "),
    );
  }

  for (const s of result.shortfalls) {
    lines.push(
      `⚠ ${s.title} needs ${hours(s.needMins)} and only ${hours(s.availableMins)} fits before ${s.due || "the deadline"} — ${hours(s.shortMins)} short.`,
    );
  }
  return lines.join("\n");
}
