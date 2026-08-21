/**
 * The parts of the week that are already gone.
 *
 * A commitment the planner does not know about is worse than no commitment at
 * all: it lays two hours of focus across the school run, hands back a week
 * that looks fine, and is wrong every single day until somebody stops
 * trusting the plan. So the arithmetic is asserted per *day* rather than per
 * commitment — an hour at the gym on three mornings is three hours gone, and
 * a total that says one is the bug nobody notices until their Wednesday is
 * over-booked.
 */
import { PRESETS, sayTime, sayDays, sayCommitment, weeklyMinsOf, toBreaks } from "../src/lib/commitments.js";
import { hoursOf, usableMinsOn } from "../src/lib/hours.js";

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

/* ------------------------------------------------------------- the clock */
t("a whole hour drops the minutes", sayTime(12) === "12pm", sayTime(12));
t("and a half hour keeps them", sayTime(9.5) === "9:30am", sayTime(9.5));
t("midnight is 12am, not 0am", sayTime(0) === "12am", sayTime(0));
t("noon is 12pm, not 0pm", sayTime(12) === "12pm");
t("and the evening reads as the evening", sayTime(17) === "5pm", sayTime(17));

/* -------------------------------------------------------------- the days */
t("five weekdays are a word, not five letters", sayDays([1, 2, 3, 4, 5]) === "Weekdays");
t("all seven are every day", sayDays([0, 1, 2, 3, 4, 5, 6]) === "Every day");
t("the weekend is named", sayDays([0, 6]) === "Weekends");
t("one day is said in full", sayDays([3]) === "Wednesdays", sayDays([3]));
t("anything else falls back to letters", sayDays([1, 3]) === "M W", sayDays([1, 3]));
t("and nothing says nothing odd", typeof sayDays([]) === "string");

/* ------------------------------------------------------------ the totals */
{
  // The case a per-commitment count gets wrong.
  const gym = [{ label: "Gym", start: 7, end: 8, days: [1, 3, 5] }];
  t("an hour on three mornings is three hours, not one", weeklyMinsOf(gym) === 180, weeklyMinsOf(gym));

  const both = [...gym, { label: "Lunch", start: 12, end: 13, days: [1, 2, 3, 4, 5] }];
  t("and commitments add up across the week", weeklyMinsOf(both) === 180 + 300, weeklyMinsOf(both));

  t("half hours are counted as half hours",
    weeklyMinsOf([{ start: 9, end: 9.5, days: [1] }]) === 30);
  t("nothing committed is nothing counted", weeklyMinsOf([]) === 0);
  t("and a commitment with no days takes no time",
    weeklyMinsOf([{ start: 9, end: 10, days: [] }]) === 0);
}

/* ------------------------------------------------------------ the presets */
t("every preset ends after it starts", PRESETS.every((p) => p.end > p.start));
t("every preset falls on at least one day", PRESETS.every((p) => p.days.length > 0));
t("every preset has a name somebody would recognise",
  PRESETS.every((p) => p.label && p.label.length > 2));
t("and they read as one line",
  sayCommitment(PRESETS[0]) === "Lunch · Weekdays · 12pm–1pm", sayCommitment(PRESETS[0]));

/* ------------------------------------------------ and the planner sees them */
/**
 * The assertion the rest of this file exists to reach. A commitment that does
 * not reduce the day's usable minutes is decoration — it looks answered, it
 * changes nothing, and the plan it produces is the plan it would have produced
 * if the question had never been asked.
 */
{
  const plain = hoursOf({});
  const withLunch = hoursOf({ hours: { breaks: toBreaks([PRESETS[0]]) } });

  const before = usableMinsOn(plain, 1);
  const after = usableMinsOn(withLunch, 1);

  /**
   * It costs a share of the focus, not the whole hour and not nothing.
   *
   * Capacity is an estimate of realistic focus across the whole window, so
   * committing an hour of an eleven-hour window costs about a proportional
   * slice of the five hours — roughly twenty-seven minutes. Taking the full
   * sixty would double-count, since nobody was focusing for all eleven hours
   * anyway; taking zero is what the code did before this test existed, and it
   * made every commitment somebody entered decoration.
   */
  t("an hour of lunch costs a real share of the day's focus",
    before - after > 15 && before - after < 45, `${before} → ${after}`);
  t("  and an account with no commitments is untouched", before === 300, before);

  // The property that matters more than any single number: more committed is
  // never more available. The old arithmetic was flat for six hours, which is
  // how a planner ends up scheduling across a school run.
  let last = Infinity, monotonic = true;
  for (const mins of [0, 30, 60, 120, 240, 360, 480, 600]) {
    const hrs = hoursOf({ hours: { breaks: [{ label: "x", start: 8, end: 8 + mins / 60, days: [1] }] } });
    const usable = usableMinsOn(hrs, 1);
    if (usable > last) monotonic = false;
    last = usable;
  }
  t("  and committing more time never leaves more of it", monotonic);
  t("  a day committed end to end leaves nothing",
    usableMinsOn(hoursOf({ hours: { breaks: [{ label: "all", start: 8, end: 19, days: [1] }] } }), 1) === 0);

  // Sunday is not a working day, so nothing is taken from it either way.
  t("and takes nothing off a day it does not fall on",
    usableMinsOn(withLunch, 0) === usableMinsOn(plain, 0));

  const gymDays = hoursOf({ hours: { breaks: toBreaks([PRESETS[1]]) } });
  t("a Monday-Wednesday-Friday commitment misses Tuesday",
    usableMinsOn(gymDays, 2) === usableMinsOn(plain, 2),
    `${usableMinsOn(gymDays, 2)} vs ${usableMinsOn(plain, 2)}`);
}

/* --------------------------------------------------- what is not stored */
t("a commitment with no span is dropped rather than stored",
  toBreaks([{ id: "x", label: "Nothing", start: 9, end: 9, days: [1] }]).length === 0);
t("and so is one on no days",
  toBreaks([{ id: "x", label: "Nowhere", start: 9, end: 10, days: [] }]).length === 0);
t("a real one survives with every field the scheduler needs",
  (() => {
    const [b] = toBreaks([PRESETS[0]]);
    return b && b.label === "Lunch" && b.start === 12 && b.end === 13 && b.days.length === 5;
  })());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
