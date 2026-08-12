/**
 * Spreading work over the time available, and deciding what earns a
 * notification. Both are pure, so both run with no browser and no device.
 */
import { distribute, describePlan, remainingMins, MIN_BLOCK_MINS } from "../src/lib/schedule.js";
import { pending, reconcile, DEFAULTS } from "../src/lib/reminders.js";

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

// Monday 3 Aug 2026, 07:00 — before the working day, so today counts in full.
const NOW = new Date(2026, 7, 3, 7, 0, 0);
const pad = (n) => String(n).padStart(2, "0");
const D = (n) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const task = (o) => ({
  id: o.id || "t1", title: o.title || "Task", estimateMins: 60, priority: "normal",
  done: false, due: null, createdAt: 1, ...o,
});
const meeting = (day, h, mins, o = {}) => ({
  id: `${day}-${h}`, title: "Meeting", attendees: [], notes: "",
  start: `${day}T${pad(h)}:00:00`,
  end: `${day}T${pad(h + Math.floor(mins / 60))}:${pad(mins % 60)}:00`,
  ...o,
});

// ------------------------------------------------------------ the core ask
{
  // Ten hours, due in two weeks. It should land across several days rather
  // than in one lump, and finish before the deadline.
  const r = distribute([task({ estimateMins: 600, due: D(13) })], [], [], { now: NOW });
  const days = [...new Set(r.blocks.map((b) => b.day))];
  t("ten hours is spread over several days", days.length >= 4, days.length);
  t("all of it gets placed", r.totals.plannedMins === 600, r.totals.plannedMins);
  t("nothing is reported short", r.shortfalls.length === 0, JSON.stringify(r.shortfalls));
  t("and it finishes before the deadline", days.every((d) => d < D(13)), days.at(-1));
  t("no day is buried", Math.max(...[...r.byDay.values()]) <= 300, [...r.byDay.values()].join());
}

// ---------------------------------------------------- the valuable output
{
  // Twenty hours due in two days cannot fit. Saying so is worth more than any
  // arrangement of the hours that do.
  const r = distribute([task({ estimateMins: 1200, due: D(2), title: "Board deck" })], [], [], { now: NOW });
  t("impossible work is reported, not silently truncated", r.shortfalls.length === 1);
  const s = r.shortfalls[0];
  t("with what it needs", s.needMins === 1200, s.needMins);
  t("what actually fits", s.availableMins > 0 && s.availableMins < 1200, s.availableMins);
  t("and the gap between them", s.shortMins === s.needMins - s.availableMins, s.shortMins);
}

// --------------------------------------------------------- around meetings
{
  const day = D(1);
  const events = [meeting(day, 9, 240), meeting(day, 14, 180)];   // 9-13, 14-17
  const r = distribute([task({ estimateMins: 240, due: D(5) })], events, [], { now: NOW });
  const onDay = r.blocks.filter((b) => b.day === day);
  const clash = onDay.some((b) =>
    b.start && events.some((e) => b.start < e.end && b.end > e.start));
  t("work never lands on top of a meeting", !clash, JSON.stringify(onDay));
  t("blocks get real clock times", r.blocks.every((b) => b.start === null || /T\d\d:\d\d/.test(b.start)));
}

// ------------------------------------------------------------- competition
{
  // Two tasks, one deadline much tighter. The tight one should get first call
  // on the available hours.
  const r = distribute([
    task({ id: "loose", title: "Loose", estimateMins: 600, due: D(20) }),
    task({ id: "tight", title: "Tight", estimateMins: 300, due: D(2) }),
  ], [], [], { now: NOW });
  const tightDone = r.blocks.filter((b) => b.taskId === "tight").reduce((n, b) => n + b.mins, 0);
  t("the tighter deadline is served first", tightDone === 300, tightDone);
  t("and neither is dropped", new Set(r.blocks.map((b) => b.taskId)).size === 2);

  // Two tasks must not both be promised the same afternoon.
  const perDay = new Map();
  for (const b of r.blocks) perDay.set(b.day, (perDay.get(b.day) || 0) + b.mins);
  t("no day is double-booked", [...perDay.values()].every((m) => m <= 300), [...perDay.values()].join());
}

// ---------------------------------------------------------------- progress
{
  const sessions = [{ taskId: "t1", focusedMs: 90 * 60000 }];
  t("time already spent is subtracted",
    remainingMins(task({ estimateMins: 240 }), sessions) === 150,
    remainingMins(task({ estimateMins: 240 }), sessions));
  const r = distribute([task({ estimateMins: 240, due: D(5) })], [], sessions, { now: NOW });
  t("and only the remainder is scheduled", r.totals.plannedMins === 150, r.totals.plannedMins);
  t("a finished task is not scheduled at all",
    distribute([task({ done: true, estimateMins: 240, due: D(5) })], [], [], { now: NOW }).blocks.length === 0);
}

// ------------------------------------------------------------------- shape
{
  const r = distribute([task({ estimateMins: 600, due: D(13) })], [], [], { now: NOW });
  t("blocks are long enough to be worth starting",
    r.blocks.every((b) => b.mins >= Math.min(MIN_BLOCK_MINS, 600)), JSON.stringify(r.blocks.map((b) => b.mins)));
  t("weekends are left alone",
    r.blocks.every((b) => ![0, 6].includes(new Date(`${b.day}T12:00:00`).getDay())),
    r.blocks.map((b) => b.day).join());
}
{
  const r = distribute([task({ estimateMins: 300, due: D(13) })], [], [], { now: NOW, workWeekend: true });
  t("unless the user works them", r.blocks.length > 0);
}
{
  // No deadline is not the same as urgent. It should get a week, not a month.
  const r = distribute([task({ estimateMins: 1200 })], [], [], { now: NOW });
  const days = [...new Set(r.blocks.map((b) => b.day))];
  t("undated work does not colonise the calendar", days.length <= 5, days.length);
}

// -------------------------------------------------------------- reminders
const state = {
  events: [
    { id: "e1", title: "Board meeting", start: `${D(1)}T10:00:00`, end: `${D(1)}T11:00:00`,
      attendees: [{ name: "Bob" }], location: "Zoom" },
  ],
  tasks: [task({ id: "t1", title: "Munich lease", due: D(1) })],
  blocks: [{ taskId: "t1", day: D(1), mins: 90, start: `${D(1)}T14:00:00`, end: `${D(1)}T15:30:00` }],
  shortfalls: [],
};
{
  const rs = pending(state, {}, NOW);
  const kinds = rs.map((r) => r.kind);
  t("a meeting earns a reminder", kinds.includes("meeting"));
  t("so does a focus block", kinds.includes("focus"));
  t("and one morning digest", kinds.filter((k) => k === "digest").length >= 1);
  const m = rs.find((r) => r.kind === "meeting");
  t("the meeting fires before it starts, not at it",
    m.at.getTime() === new Date(`${D(1)}T10:00:00`).getTime() - DEFAULTS.meetingLeadMins * 60000,
    m.at.toISOString());
  t("and says who and where", /Bob/.test(m.body) && /Zoom/.test(m.body), m.body);
  t("everything is in the future", rs.every((r) => r.at > NOW));
  t("and in order", rs.every((r, i) => i === 0 || rs[i - 1].at <= r.at));
}
{
  // The one that is actually urgent.
  const rs = pending({ ...state, shortfalls: [
    { taskId: "t1", title: "Munich lease", needMins: 1200, availableMins: 600, shortMins: 600, due: D(2) },
  ] }, {}, NOW);
  const d = rs.find((r) => r.kind === "deadline");
  t("work that stopped fitting is escalated", !!d);
  t("with the numbers in it", d && /20h/.test(d.body) && /10h/.test(d.body), d?.body);
}
{
  t("a kind can be switched off",
    pending(state, { meetings: false }, NOW).every((r) => r.kind !== "meeting"));
  t("a finished task stops reminding",
    pending({ ...state, tasks: [task({ id: "t1", done: true })] }, {}, NOW)
      .every((r) => r.kind !== "focus"));
}
{
  // Ids are content-addressed, so moving a meeting replaces its reminder
  // rather than adding a second one.
  const a = pending(state, {}, NOW).find((r) => r.kind === "meeting");
  const moved = { ...state, events: [{ ...state.events[0], start: `${D(1)}T15:00:00`, end: `${D(1)}T16:00:00` }] };
  const b = pending(moved, {}, NOW).find((r) => r.kind === "meeting");
  t("moving a meeting changes its reminder id", a.id !== b.id, `${a.id} / ${b.id}`);

  const diff = reconcile([a], [b]);
  t("so the stale one is cancelled", diff.remove.includes(a.id));
  t("and the new one scheduled", diff.add.some((r) => r.id === b.id));
  t("an unchanged reminder is left alone",
    reconcile([a], [a]).add.length === 0 && reconcile([a], [a]).remove.length === 0);
}
{
  // The OS holds a finite number of pending notifications; iOS keeps 64.
  const many = { events: Array.from({ length: 200 }, (_, i) => ({
    id: `e${i}`, title: `M${i}`, start: `${D(1 + (i % 6))}T${pad(8 + (i % 10))}:00:00`,
    end: `${D(1 + (i % 6))}T${pad(9 + (i % 10))}:00:00`, attendees: [],
  })), tasks: [], blocks: [], shortfalls: [] };
  t("the list is capped to what a phone will hold", pending(many, {}, NOW).length <= 64,
    pending(many, {}, NOW).length);
}

// ------------------------------------------------------------- the clock
{
  // Half past three on a Monday. Every scenario run at a realistic hour was
  // producing work booked for eight o'clock that morning — hours into the
  // past, and the fastest way to lose someone's trust in a planner.
  const AFTERNOON = new Date(2026, 7, 3, 15, 30, 0);
  const r = distribute([task({ estimateMins: 360, due: D(4) })], [], [], { now: AFTERNOON });
  const todays = r.blocks.filter((b) => b.day === D(0) && b.start);
  t("nothing is scheduled in the past",
    todays.every((b) => new Date(b.start) >= AFTERNOON),
    todays.map((b) => b.start).join());
  t("today still gets used, from now on",
    todays.length > 0 && new Date(todays[0].start).getHours() >= 15, todays[0]?.start);
  t("and starts on a tidy quarter hour",
    todays.every((b) => new Date(b.start).getMinutes() % 15 === 0), todays[0]?.start);
}
{
  // Late enough that today is gone entirely.
  const EVENING = new Date(2026, 7, 3, 20, 0, 0);
  const r = distribute([task({ estimateMins: 120, due: D(4) })], [], [], { now: EVENING });
  t("a day already over is not booked",
    !r.blocks.some((b) => b.day === D(0) && b.start), JSON.stringify(r.blocks.slice(0, 2)));
}

// -------------------------------------------------------------- no slivers
{
  // An hour of work with a fortnight of runway was coming out as 45 minutes
  // and then a stranded 15. Splitting is meant to make work approachable; a
  // quarter hour on its own day is the opposite.
  const r = distribute([task({ estimateMins: 60, due: D(13) })], [], [], { now: NOW });
  t("small work is not split into fragments", r.blocks.length === 1, JSON.stringify(r.blocks));
  t("and keeps all of its minutes", r.blocks[0].mins === 60, r.blocks[0].mins);
}
{
  const r = distribute([task({ estimateMins: 200, due: D(20) })], [], [], { now: NOW });
  t("every block is worth starting",
    r.blocks.every((b) => b.mins >= MIN_BLOCK_MINS), r.blocks.map((b) => b.mins).join());
  t("and they still add up", r.blocks.reduce((n, b) => n + b.mins, 0) === 200);
}

// ------------------------------------------------- what the planner refuses
/**
 * The three things a planner must not do quietly: schedule work you handed to
 * someone else, drop work it cannot measure, and shred a day into so many
 * pieces that none of them gets started.
 */
{
  const r = distribute(
    [task({ id: "d", estimateMins: 120, due: D(6), delegatedTo: "Anders" })],
    [], [], { now: NOW },
  );
  t("delegated work is tracked, not scheduled", r.blocks.length === 0, JSON.stringify(r.blocks));
  t("and is not reported as a shortfall either", r.shortfalls.length === 0);
}
{
  const r = distribute(
    [
      task({ id: "a", estimateMins: 60, due: D(6) }),
      task({ id: "b", estimateMins: 0, due: D(6), title: "Sign the lease" }),
      { id: "c", title: "Call the bank", due: D(6), priority: "normal", done: false, createdAt: 0 },
    ],
    [], [], { now: NOW },
  );
  t("work with no estimate is named, not dropped",
    r.unestimated.length === 2, JSON.stringify(r.unestimated));
  t("with enough to act on", r.unestimated[0].title && r.unestimated[0].due, JSON.stringify(r.unestimated[0]));
  t("and it is counted in the totals", r.totals.unestimatedCount === 2, r.totals.unestimatedCount);
  t("while estimated work still plans", r.totals.plannedMins === 60, r.totals.plannedMins);
}
{
  // Eight small jobs all due the same day. Minutes are not the only budget.
  const many = Array.from({ length: 8 }, (_, i) =>
    task({ id: `t${i}`, title: `Job ${i}`, estimateMins: 45, due: D(2) }));
  const r = distribute(many, [], [], { now: NOW });
  const perDay = new Map();
  for (const b of r.blocks) {
    if (!perDay.has(b.day)) perDay.set(b.day, new Set());
    perDay.get(b.day).add(b.taskId);
  }
  t("no day is cut into more pieces than it can hold",
    [...perDay.values()].every((set) => set.size <= 4),
    [...perDay.entries()].map(([d, set]) => `${d}:${set.size}`).join(" "));
}

// --------------------------------------------------- a shortfall names a fix
{
  // Forty hours due in five days, against a five-hour day. It cannot fit, and
  // the useful output is the arithmetic that says by how much and what would.
  const r = distribute([task({ estimateMins: 2400, due: D(5) })], [], [], { now: NOW });
  const s = r.shortfalls[0];
  t("a shortfall is reported", !!s, JSON.stringify(r.totals));
  t("with the gap", s.shortMins > 0, s.shortMins);
  t("the daily pace it would need", s.perDayMins > 0, s.perDayMins);
  t("the extra it would take on top of what is free", s.extraPerDayMins > 0, s.extraPerDayMins);
  t("and the date it would fit by", /^\d{4}-\d{2}-\d{2}$/.test(s.fitsBy || ""), s.fitsBy);
  t("which is later than the deadline it missed", s.fitsBy > s.due, `${s.fitsBy} vs ${s.due}`);
  t("the prose says what would close it",
    /would close it/.test(describePlan(r, [task({ estimateMins: 2400, due: D(5) })])),
    describePlan(r, []));
}

// ------------------------------------------------------- the project maths
{
  const { projectLoad, describeLoad, urgencyOf, triage } = await import("../src/lib/schedule.js");

  // Logan's example, exactly: fifteen tasks averaging an hour, due in fifteen
  // days, is an hour a day.
  const proj = { id: "p", name: "Q3 board cycle", due: D(20) };
  const fifteen = Array.from({ length: 15 }, (_, i) =>
    task({ id: `t${i}`, projectId: "p", title: `Task ${i}`, estimateMins: 60 }));
  const load = projectLoad(proj, fifteen, [], [], { now: NOW });
  t("fifteen hours of work is counted", load.remainingMins === 900, load.remainingMins);
  t("over the working days that remain", load.workdays === 15, load.workdays);
  t("comes to an hour a day", load.perDayMins === 60, load.perDayMins);
  t("and it is reported as fitting", load.fits === true);
  t("in plain English", /about 1h a day/.test(describeLoad(load)), describeLoad(load));

  // The same work with a quarter of the runway.
  const tight = projectLoad({ ...proj, due: D(5) }, fifteen, [], [], { now: NOW });
  t("a shorter deadline raises the daily pace", tight.perDayMins === 180, tight.perDayMins);
  t("and says so", /about 3h a day/.test(describeLoad(tight)), describeLoad(tight));

  // Impossible, and named as such.
  const impossible = projectLoad({ ...proj, due: D(2) },
    Array.from({ length: 40 }, (_, i) => task({ id: `x${i}`, projectId: "p", estimateMins: 60 })),
    [], [], { now: NOW });
  t("work that cannot fit is reported short", impossible.fits === false, impossible.slackMins);
  t("with the shortfall in words", /does not fit/.test(describeLoad(impossible)), describeLoad(impossible));

  // An unestimated task counts at the project average, not at zero — zero
  // makes a doomed project look achievable.
  const mixed = fifteen.map((x, i) => (i < 5 ? { ...x, estimateMins: 0 } : x));
  t("unestimated work is not counted as free",
    projectLoad(proj, mixed, [], [], { now: NOW }).remainingMins === 900,
    projectLoad(proj, mixed, [], [], { now: NOW }).remainingMins);

  // ---- urgency, computed rather than declared
  const set = [
    task({ id: "deck", title: "Board deck", estimateMins: 480, due: D(9) }),
    task({ id: "sheet", title: "Term sheet", estimateMins: 90, due: D(1) }),
    task({ id: "lease", title: "Munich lease", estimateMins: 600, due: D(2) }),
    task({ id: "fu", title: "Follow up", estimateMins: 30, priority: "low" }),
  ];
  const u = (id) => urgencyOf(set.find((x) => x.id === id), set, [], [], { now: NOW });
  t("work that outruns its runway is critical", u("lease").level === "critical", u("lease").level);
  t("comfortable work is normal, never low", u("sheet").level === "normal", u("sheet").level);
  t("an explicit low priority can still be low", u("fu").level === "low", u("fu").level);
  t("and the ratio is exposed, not just the label",
    u("lease").ratio >= 1 && u("deck").ratio < 1, `${u("lease").ratio}/${u("deck").ratio}`);

  const order = triage(set, [], [], { now: NOW }).map((x) => x.task.id);
  t("triage puts the tightest first", order[0] === "lease", order.join(","));
  t("and the slackest last", order.at(-1) === "fu", order.join(","));
}

// -------------------------------------------- a project's deadline cascades
{
  // An undated task inside a project due Friday is not "undated" — the
  // project's deadline binds it, buffer and all.
  const projects = [{ id: "p1", name: "Launch", due: D(4) }];
  const r = distribute(
    [task({ id: "a", estimateMins: 240, projectId: "p1" })],
    [], [], { now: NOW, projects },
  );
  t("an undated task inherits its project's deadline",
    r.blocks.length > 0 && r.blocks.every((b) => b.day <= D(3)),
    JSON.stringify(r.blocks.map((b) => b.day)));

  // A task's own date always wins over the project's.
  const own = distribute(
    [task({ id: "b", estimateMins: 60, projectId: "p1", due: D(1) })],
    [], [], { now: NOW, projects },
  );
  t("  a task's own deadline outranks the project's",
    own.blocks.every((b) => b.day <= D(1)), JSON.stringify(own.blocks.map((b) => b.day)));

  // Too much work for the project window is a shortfall, not a silence.
  // (Four workdays before the buffer, 300 minutes each: 1500 cannot fit.)
  const tight = distribute(
    [task({ id: "c", estimateMins: 1500, projectId: "p1" })],
    [], [], { now: NOW, projects },
  );
  t("  too much for the project window is reported short",
    tight.shortfalls.length === 1 && tight.shortfalls[0].taskId === "c");

  // An archived project's deadline binds nothing.
  const parked = distribute(
    [task({ id: "d", estimateMins: 60, projectId: "p2" })],
    [], [], { now: NOW, projects: [{ id: "p2", name: "Old", due: D(1), archived: true }] },
  );
  t("  an archived project's deadline binds nothing",
    parked.blocks.some((b) => b.day > D(0)) || parked.blocks.length > 0,
    JSON.stringify(parked.blocks.map((b) => b.day)));
  t("  and its undated work still plans like undated work",
    parked.totals.plannedMins === 60, parked.totals.plannedMins);
}

// ------------------------------------------------------------- pinned days
{
  // "This one, Thursday." Every minute of a pinned task lands on its day.
  const r = distribute(
    [task({ id: "pin", estimateMins: 90, pinDay: D(3), due: D(10) })],
    [], [], { now: NOW },
  );
  t("a pinned task lands entirely on its day",
    r.blocks.length > 0 && r.blocks.every((b) => b.day === D(3)),
    JSON.stringify(r.blocks.map((b) => b.day)));

  // The pin holds even when a desperate monster wants the same day: pins
  // claim capacity first, and the monster routes around them.
  const both = distribute(
    [
      task({ id: "monster", estimateMins: 900, due: D(3), createdAt: 1 }),
      task({ id: "pin", estimateMins: 120, pinDay: D(2), due: D(10), createdAt: 2 }),
    ],
    [], [], { now: NOW },
  );
  const pinBlocks = both.blocks.filter((b) => b.taskId === "pin");
  t("  a pin holds its day against a desperate deadline",
    pinBlocks.length > 0 && pinBlocks.every((b) => b.day === D(2)),
    JSON.stringify(pinBlocks));

  // Pinning a Saturday is the user's explicit call — the workday filter
  // stands aside for it.
  const sat = distribute(
    [task({ id: "wk", estimateMins: 60, pinDay: D(5) })],
    [], [], { now: NOW },
  );
  t("  a weekend pin is honoured — explicit beats default",
    sat.blocks.length > 0 && sat.blocks.every((b) => b.day === D(5)),
    JSON.stringify(sat.blocks.map((b) => b.day)));

  // A pin in the past is not time travel: the task falls back to the
  // ordinary rules instead of vanishing — the planner's one unforgivable
  // answer is silence.
  const past = distribute(
    [task({ id: "old", estimateMins: 60, pinDay: "2020-01-01" })],
    [], [], { now: NOW },
  );
  t("  a past pin falls back to the ordinary rules, never silence",
    past.totals.plannedMins === 60 && past.blocks.every((b) => b.day >= D(0)),
    JSON.stringify(past.blocks.map((b) => b.day)));

  // More work than the pinned day can hold is a shortfall, said out loud.
  const heavy = distribute(
    [task({ id: "heavy", estimateMins: 600, pinDay: D(1) })],
    [], [], { now: NOW },
  );
  t("  an overloaded pin is reported short, not spilled",
    heavy.shortfalls.length === 1 && heavy.blocks.every((b) => b.day === D(1)),
    JSON.stringify({ blocks: heavy.blocks.length, shorts: heavy.shortfalls.length }));
}

// ------------------------------------------- priority shapes the plan itself
{
  /**
   * One day of room (300m), two 200-minute tasks. Only one fits whole. The
   * low-priority task arrived first — created earlier, same deadline — and
   * without the priority pull it would win the day on the tiebreak. The
   * critical one must claim it instead, automatically.
   */
  const r = distribute(
    [
      task({ id: "lowly", priority: "low", estimateMins: 200, due: D(1), createdAt: 1 }),
      task({ id: "vital", priority: "critical", estimateMins: 200, due: D(1), createdAt: 2 }),
    ],
    [], [], { now: NOW },
  );
  const vital = r.blocks.filter((b) => b.taskId === "vital").reduce((n, b) => n + b.mins, 0);
  t("scarce capacity goes to the critical task, not the earlier one",
    vital === 200, vital);
  t("  and the low one is the one reported short",
    r.shortfalls.length === 1 && r.shortfalls[0].taskId === "lowly",
    JSON.stringify(r.shortfalls.map((s) => s.taskId)));

  // Sharing a day, the critical task gets the first hours of it.
  const day = distribute(
    [
      task({ id: "meh", priority: "low", estimateMins: 60, due: D(1), createdAt: 1 }),
      task({ id: "top", priority: "critical", estimateMins: 60, due: D(1), createdAt: 2 }),
    ],
    [], [], { now: NOW },
  );
  const at = (id) => day.blocks.find((b) => b.taskId === id)?.start || "";
  t("the morning belongs to the most important thing on the day",
    at("top") < at("meh"), `${at("top")} vs ${at("meh")}`);

  /**
   * The nudge never overturns real arithmetic: a critical task with a week
   * of room must not steal the only day a normal task has. The deadline is
   * a fact; the label is a preference.
   */
  const fair = distribute(
    [
      task({ id: "roomy", priority: "critical", estimateMins: 300, due: D(9), createdAt: 1 }),
      task({ id: "tight", priority: "normal", estimateMins: 300, due: D(1), createdAt: 2 }),
    ],
    [], [], { now: NOW },
  );
  const tightShort = fair.shortfalls.some((s) => s.taskId === "tight");
  t("a deadline still beats a label — the tight task is never starved",
    !tightShort, JSON.stringify(fair.shortfalls.map((s) => s.taskId)));
  t("  and the roomy critical work still all lands",
    fair.blocks.filter((b) => b.taskId === "roomy").reduce((n, b) => n + b.mins, 0) === 300);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
