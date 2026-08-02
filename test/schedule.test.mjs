/**
 * Spreading work over the time available, and deciding what earns a
 * notification. Both are pure, so both run with no browser and no device.
 */
import { distribute, remainingMins, MIN_BLOCK_MINS } from "../src/lib/schedule.js";
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
