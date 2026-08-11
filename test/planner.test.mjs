/**
 * Four ways the planner was confidently wrong.
 *
 * Every one of these produced an answer rather than an error, which is what
 * made them expensive: a planner that crashes gets fixed on Tuesday, and a
 * planner that quietly books work inside a meeting gets trusted until somebody
 * misses something. All four were found by executing the real functions with
 * adversarial inputs, and each test below is the reproduction that found them.
 *
 * They share a shape worth naming: none is a crash, none is a missing feature,
 * and all four disagree with something the app says elsewhere on the same
 * screen.
 */
process.env.TZ = "America/New_York";

import { freeMinutes, findFreeSlots } from "../src/lib/agenda.js";
import { distribute, urgencyOf, projectLoad, describeLoad } from "../src/lib/schedule.js";

let pass = 0, fail = 0;
const failures = [];
const t = (name, ok, detail) => {
  if (ok) pass++; else { fail++; failures.push(name); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const MON_7AM = new Date("2026-08-03T07:00:00");
const HOURS = { start: 8, end: 19 };

/* ------------------------------------------- meetings that began yesterday */
/**
 * `findFreeSlots` matched an event's *start* day, so anything running into the
 * day from the one before was invisible — and the planner does not merely miss
 * those, it lays work inside them. Real calendars produce this constantly:
 * a red-eye, a multi-day offsite, a call that runs past midnight. EventKit
 * hands them over verbatim through `calsync.js`.
 */
{
  const overnight = { id: "e", title: "Offsite", start: "2026-08-02T22:00:00", end: "2026-08-03T14:00:00" };

  t("a meeting running into today takes the morning with it",
    freeMinutes("2026-08-03", [overnight], HOURS) === 300,
    freeMinutes("2026-08-03", [overnight], HOURS));

  const plan = distribute([{ id: "z", title: "Work", estimateMins: 120, due: "2026-08-05" }], [overnight], [], { now: MON_7AM });
  const monday = plan.blocks.filter((b) => b.day === "2026-08-03");
  t("and no work is laid inside it",
    monday.every((b) => new Date(b.start) >= new Date(overnight.end)),
    JSON.stringify(monday.map((b) => b.start)));

  // A three-day offsite has to cost all three days, not just the first.
  const offsite = { id: "o", title: "Offsite", start: "2026-08-03T00:00:00", end: "2026-08-06T00:00:00" };
  for (const day of ["2026-08-03", "2026-08-04", "2026-08-05"]) {
    t(`  ${day} is fully booked by a three-day offsite`,
      freeMinutes(day, [offsite], HOURS) === 0, freeMinutes(day, [offsite], HOURS));
  }

  // The ordinary case has to keep working: an event on a *later* day must not
  // subtract from today just because the interval test is now wider.
  t("a meeting tomorrow does not shorten today",
    freeMinutes("2026-08-03", [{ id: "x", start: "2026-08-04T09:00:00", end: "2026-08-04T10:00:00" }], HOURS) === 660);
  t("and one that ended yesterday does not either",
    freeMinutes("2026-08-03", [{ id: "y", start: "2026-08-02T09:00:00", end: "2026-08-02T10:00:00" }], HOURS) === 660);

  t("a same-day meeting still costs exactly its own length",
    freeMinutes("2026-08-03", [{ id: "s", start: "2026-08-03T09:00:00", end: "2026-08-03T10:00:00" }], HOURS) === 600);

  // Clipped to the day, not counted whole: an event spanning midnight must not
  // subtract its out-of-hours half from the working window twice.
  const slots = findFreeSlots("2026-08-03", [overnight], HOURS);
  t("the free time starts when the meeting ends, not before",
    slots.length === 1 && slots[0].start.getHours() === 14, JSON.stringify(slots.map((s) => s.start)));
}

/* ------------------------------------------------ work that is already late */
/**
 * The worst answer this planner can give. Both day-walks stopped at a date in
 * the past, so an overdue task got no block, no shortfall and no mention —
 * while `urgencyOf` on the same task returned "critical" and triage ranked it
 * first. Surfaced everywhere, scheduled nowhere.
 */
{
  const late = { id: "o", title: "Late thing", estimateMins: 180, due: "2026-07-31" };
  const plan = distribute([late], [], [], { now: MON_7AM });
  t("an overdue task is not silently dropped",
    plan.blocks.length > 0 || plan.shortfalls.length > 0,
    `blocks ${plan.blocks.length}, shortfalls ${plan.shortfalls.length}`);
  t("and it is planned from today rather than from a date that has gone",
    plan.blocks.every((b) => b.day >= "2026-08-03"), JSON.stringify(plan.blocks.map((b) => b.day)));
  t("with the whole estimate accounted for",
    plan.blocks.reduce((n, b) => n + b.mins, 0) === 180,
    plan.blocks.reduce((n, b) => n + b.mins, 0));

  /**
   * The sibling case: the deadline is still ahead, but every day between now
   * and it is a non-working day. Same empty walk, same silent drop.
   */
  const sat = new Date("2026-08-08T09:00:00");
  const weekendPlan = distribute(
    [{ id: "w", title: "Due Sunday", estimateMins: 60, due: "2026-08-09" }],
    [], [], { now: sat, workDays: [1, 2, 3, 4, 5] },
  );
  t("nor is work whose whole window falls on days off",
    weekendPlan.blocks.length > 0 || weekendPlan.shortfalls.length > 0,
    `blocks ${weekendPlan.blocks.length}, shortfalls ${weekendPlan.shortfalls.length}`);
  t("and it lands on the next working day",
    weekendPlan.blocks.every((b) => b.day >= "2026-08-10"), JSON.stringify(weekendPlan.blocks.map((b) => b.day)));

  // Work that genuinely cannot fit must still report a shortfall rather than
  // being spread into silence.
  const huge = distribute([{ id: "h", title: "Huge", estimateMins: 6000, due: "2026-07-31" }], [], [], { now: MON_7AM });
  t("an impossible overdue task reports a shortfall", huge.shortfalls.length === 1,
    JSON.stringify(huge.shortfalls));
}

/* ------------------------------------------- one question, one answer */
/**
 * `distribute` clipped the hours already gone today; `urgencyOf` and
 * `projectLoad` did not. At five in the afternoon one said a task fitted
 * comfortably and the other said it was two hours short, on identical input —
 * the exact two-answers failure `windowOf` exists to prevent, reappearing one
 * field lower down.
 */
{
  const evening = new Date("2026-08-03T17:00:00");
  const task = { id: "u", title: "Board deck", estimateMins: 240, due: "2026-08-04" };

  const urgency = urgencyOf(task, [], [], [], { now: evening });
  const plan = distribute([task], [], [], { now: evening });

  t("at 5pm the day has two hours left in it, not eleven",
    urgency.capacity === 120, urgency.capacity);
  t("so the task reads as critical rather than comfortable",
    urgency.level === "critical", urgency.level);
  t("and the planner agrees with it",
    plan.shortfalls.length === 1 && plan.shortfalls[0].shortMins === 240 - urgency.capacity,
    JSON.stringify(plan.shortfalls.map((s) => s.shortMins)));

  const load = projectLoad(
    { id: "p", name: "Q3", due: "2026-08-03" },
    [{ id: "t", projectId: "p", estimateMins: 300, done: false }],
    [], [], { now: evening },
  );
  t("a project's load is measured against the hours actually left",
    load.capacityMins === 120, load.capacityMins);
  t("so it says plainly that it does not fit", load.fits === false);

  /**
   * The clip must not eat hours that have not happened yet. In the morning the
   * answer is the full daily allowance — 300 minutes, not the 660 the clock is
   * open for, because the planner caps a day at five hours of focused work
   * rather than pretending eleven are available. The evening figure above is
   * lower than this one only because the hours are actually gone.
   */
  const morning = urgencyOf(task, [], [], [], { now: MON_7AM });
  t("first thing in the morning a whole day's allowance is still there",
    morning.capacity === 300, morning.capacity);
  t("and it is more than the same day offers at five in the afternoon",
    morning.capacity > urgency.capacity, `${morning.capacity} vs ${urgency.capacity}`);
}

/* ------------------------------------------------- saying nothing sensible */
/**
 * A deadline already gone leaves no working days, so there was no pace to
 * quote — and dividing by zero printed "about nullm a day" in a sentence she
 * reads out loud.
 */
{
  const load = projectLoad(
    { id: "p", name: "Munich lease", due: "2026-07-20" },
    [{ id: "t", projectId: "p", estimateMins: 300, done: false }],
    [], [], { now: MON_7AM },
  );
  const said = describeLoad(load);
  t("a project past its deadline is described without arithmetic that cannot be done",
    !/null/.test(said), said);
  t("and it still says how much is open", /5h/.test(said), said);
  t("and that the date has gone", /past/.test(said), said);

  // The ordinary case keeps its pacing sentence.
  const ahead = projectLoad(
    { id: "q", name: "Q3", due: "2026-08-14" },
    [{ id: "t2", projectId: "q", estimateMins: 300, done: false }],
    [], [], { now: MON_7AM },
  );
  t("a project with time left still gets a pace", /a day/.test(describeLoad(ahead)), describeLoad(ahead));
}

console.log(`\nPlanner: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
