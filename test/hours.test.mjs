/**
 * The working day, and everything that depends on it.
 *
 * These four numbers used to be constants, and the complaint that got them
 * changed was exactly right: a planner that assumes you start at eight and
 * finish at seven will confidently tell a 6am-to-3pm person that their week
 * fits, and be wrong by hours. So the tests that matter here are not "does the
 * setting save" — they are "does changing it change the answer", asked once
 * per consumer, because a setting that only half the code reads is worse than
 * no setting at all.
 */
import { hoursOf, planOpts, weeklyMins, usableMinsOn, describeHours, toHours, toClock } from "../src/lib/hours.js";
import { findFreeSlots, freeMinutes, planDay } from "../src/lib/agenda.js";
import { distribute, projectLoad, urgencyOf } from "../src/lib/schedule.js";

let pass = 0, fail = 0;
const failures = [];
const t = (name, ok, detail) => {
  if (ok) pass++;
  else { fail++; failures.push(name); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

// Wednesday 5 August 2026, 06:00 — before any working day starts, so nothing
// is clipped by "the morning has already gone".
const NOW = new Date(2026, 7, 5, 6, 0);
const iso = (d, h, m = 0) =>
  `2026-08-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;

// --------------------------------------------------------------- normalising
{
  t("a blank settings object is the default day",
    describeHours(hoursOf({})) === "8:00 AM to 7:00 PM, Mon–Fri", describeHours(hoursOf({})));
  t("half hours survive the round trip", toClock(toHours("06:30")) === "06:30", toClock(toHours("06:30")));
  t("a finish before the start is repaired rather than obeyed",
    hoursOf({ hours: { start: "17:00", end: "09:00" } }).end > 17, hoursOf({ hours: { start: "17:00", end: "09:00" } }).end);
  t("no working days at all falls back to the week",
    hoursOf({ hours: { days: [] } }).days.length === 5);
  t("capacity cannot exceed the window it lives in",
    hoursOf({ hours: { start: "09:00", end: "13:00", capacityMins: 900 } }).capacityMins === 240,
    hoursOf({ hours: { start: "09:00", end: "13:00", capacityMins: 900 } }).capacityMins);
  t("a break outside the window costs nothing",
    hoursOf({ hours: { start: "09:00", end: "17:00", breaks: [{ start: "07:00", end: "08:00" }] } }).breaks[0].mins === 0);
}

// ------------------------------------------------------------- free time
{
  const early = planOpts({ hours: { start: "06:00", end: "15:00", days: [1, 2, 3, 4, 5] } });
  const free = freeMinutes("2026-08-06", [], { start: early.workStart, end: early.workEnd });
  t("an early finish shortens the day", free === 540, `${free}m`);

  const withLunch = planOpts({
    hours: { start: "09:00", end: "17:00", breaks: [{ label: "Lunch", start: "12:00", end: "13:00", days: [0, 1, 2, 3, 4, 5, 6] }] },
  });
  const slots = findFreeSlots("2026-08-06", [], {
    start: withLunch.workStart, end: withLunch.workEnd, breaks: withLunch.breaks,
  });
  t("lunch splits the day in two", slots.length === 2, `${slots.length} slots`);
  t("and costs exactly its own hour",
    slots.reduce((n, s) => n + s.mins, 0) === 420, slots.reduce((n, s) => n + s.mins, 0));
  t("with work resuming when it ends",
    slots[1].start.getHours() === 13, slots[1].start.toString());

  const notToday = planOpts({
    hours: { start: "09:00", end: "17:00", breaks: [{ label: "Gym", start: "09:00", end: "10:00", days: [1] }] },
  });
  const thu = findFreeSlots("2026-08-06", [], {
    start: notToday.workStart, end: notToday.workEnd, breaks: notToday.breaks,
  });
  t("a Monday-only break does not touch Thursday",
    thu.length === 1 && thu[0].mins === 480, JSON.stringify(thu.map((s) => s.mins)));
}

// ------------------------------------------------------------- distribution
const task = (over) => ({
  id: "t1", title: "Board deck", estimateMins: 600, due: "2026-08-14",
  priority: "normal", done: false, createdAt: Date.now(), ...over,
});

{
  const wide = distribute([task()], [], [], { now: NOW });
  // Ten hours of work, seven working days before the deadline, one hour a day.
  // It cannot fit, and the useful output is saying so rather than packing it.
  const narrow = distribute([task()], [], [], {
    now: NOW, ...planOpts({ hours: { start: "09:00", end: "10:00", capacityMins: 60 } }),
  });
  t("a shorter day places less work",
    narrow.totals.plannedMins < wide.totals.plannedMins,
    `${narrow.totals.plannedMins} vs ${wide.totals.plannedMins}`);
  t("and says what will not fit",
    narrow.totals.shortfallMins > 0 && wide.totals.shortfallMins === 0,
    `${narrow.totals.shortfallMins} short`);
}

{
  const weekdays = distribute([task()], [], [], { now: NOW });
  const everyDay = distribute([task()], [], [], {
    now: NOW, ...planOpts({ hours: { days: [0, 1, 2, 3, 4, 5, 6] } }),
  });
  const onWeekend = everyDay.blocks.some((b) => [0, 6].includes(new Date(`${b.day}T12:00:00`).getDay()));
  const none = weekdays.blocks.every((b) => ![0, 6].includes(new Date(`${b.day}T12:00:00`).getDay()));
  t("weekdays only, by default", none, weekdays.blocks.map((b) => b.day).join(" "));
  t("and Saturday is used once it is a working day", onWeekend, everyDay.blocks.map((b) => b.day).join(" "));
}

{
  const withLunch = distribute([task()], [], [], {
    now: NOW,
    ...planOpts({
      hours: { start: "09:00", end: "17:00", capacityMins: 480,
               breaks: [{ label: "Lunch", start: "12:00", end: "13:00", days: [1, 2, 3, 4, 5] }] },
    }),
  });
  const overLunch = withLunch.blocks.some((b) => {
    if (!b.start) return false;
    const h = Number(b.start.slice(11, 13));
    const endH = Number(b.end.slice(11, 13)) + Number(b.end.slice(14, 16)) / 60;
    return h < 13 && endH > 12;
  });
  t("no work block runs through lunch", !overLunch,
    withLunch.blocks.map((b) => `${b.day} ${b.start?.slice(11, 16)}–${b.end?.slice(11, 16)}`).join(" · "));
}

// ------------------------------------------------------- the derived answers
/**
 * The two functions that decide whether something is urgent, and whether a
 * project fits. They took their own defaults for a while, so a user could
 * narrow their day in Settings and still be told the week was comfortable.
 */
{
  const short = planOpts({ hours: { start: "09:00", end: "10:00", capacityMins: 60 } });
  const relaxed = urgencyOf(task(), [task()], [], [], { now: NOW });
  const tight = urgencyOf(task(), [task()], [], [], { now: NOW, ...short });
  t("urgency is measured against the day you actually have",
    tight.capacity < relaxed.capacity, `${tight.capacity} vs ${relaxed.capacity}`);
  t("and a ten-hour job in a one-hour day is critical",
    tight.level === "critical", tight.level);
}

{
  const project = { id: "p1", name: "Raise", due: "2026-08-14" };
  const tasks = [task({ projectId: "p1" })];
  const wide = projectLoad(project, tasks, [], [], { now: NOW });
  const narrow = projectLoad(project, tasks, [], [], {
    now: NOW, ...planOpts({ hours: { start: "09:00", end: "10:00", capacityMins: 60 } }),
  });
  t("a project fits in a long day", wide.fits === true, JSON.stringify(wide.slackMins));
  t("and does not in a short one", narrow.fits === false, JSON.stringify(narrow.slackMins));
}

// ----------------------------------------------------------------- the week
{
  const h = hoursOf({ hours: { start: "06:30", end: "15:00", capacityMins: 240, days: [2, 3, 4, 5, 6] } });
  t("five days at four hours is twenty", weeklyMins(h) === 1200, weeklyMins(h));
  t("a day off is worth nothing", usableMinsOn(h, 1) === 0, usableMinsOn(h, 1));
  t("and the summary reads back what was set",
    describeHours(h) === "6:30 AM to 3:00 PM, Tue–Sat", describeHours(h));
}

// ------------------------------------------------------------------ the day
{
  const tasks = [
    { id: "a", title: "Review", estimateMins: 60, due: null, priority: "high", done: false, createdAt: 0 },
    { id: "b", title: "Letter", estimateMins: 60, due: null, priority: "high", done: false, createdAt: 0 },
  ];
  const events = [{ id: "e", title: "Standup", start: iso(5, 9), end: iso(5, 10) }];
  const short = planDay(tasks, events, {
    day: "2026-08-05", now: NOW, workStart: 9, workEnd: 11, dailyCapacity: 60,
  });
  t("today's list respects the capacity set for it",
    short.capacity <= 60, `${short.capacity}`);
  t("and lays blocks inside the window",
    short.blocks.every((b) => b.start.getHours() >= 9 && b.end.getHours() <= 11),
    short.blocks.map((b) => `${b.start.getHours()}–${b.end.getHours()}`).join(" "));
}

console.log(`\nWorking hours: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
