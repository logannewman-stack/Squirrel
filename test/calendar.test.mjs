/**
 * Range arithmetic for the calendar's five zoom levels.
 *
 * Dates are where quiet bugs live: a month step from the 31st, a quarter that
 * starts in the wrong month, a week grid that silently begins on Sunday for
 * half the year. None of it is visible in a screenshot — every view renders
 * perfectly well while showing the wrong seven days — so it is pinned here.
 */
import {
  rangeOf, shiftBy, titleOf, monthMatrix, monthsIn, mondayOf, quarterOf,
  loadIndex, loadOf, isScale,
} from "../src/lib/calendar.js";
import { hoursOf } from "../src/lib/hours.js";

let pass = 0, fail = 0;
const failures = [];
const t = (name, ok, detail) => {
  if (ok) pass++;
  else { fail++; failures.push(name); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const span = (r) => `${key(r.from)}→${key(r.to)}`;

// Wednesday 5 August 2026.
const WED = new Date(2026, 7, 5, 14, 30);

// ------------------------------------------------------------------- ranges
{
  t("a day is one day", span(rangeOf("day", WED)) === "2026-08-05→2026-08-06", span(rangeOf("day", WED)));
  t("a week runs Monday to Monday",
    span(rangeOf("week", WED)) === "2026-08-03→2026-08-10", span(rangeOf("week", WED)));
  t("a month is the calendar month",
    span(rangeOf("month", WED)) === "2026-08-01→2026-09-01", span(rangeOf("month", WED)));
  t("August sits in Q3", quarterOf(WED) === 2, quarterOf(WED));
  t("and Q3 is July through September",
    span(rangeOf("quarter", WED)) === "2026-07-01→2026-10-01", span(rangeOf("quarter", WED)));
  t("a year is the calendar year",
    span(rangeOf("year", WED)) === "2026-01-01→2027-01-01", span(rangeOf("year", WED)));
  // A range is half-open, so midnight belongs to exactly one of them.
  const r = rangeOf("day", WED);
  t("midnight belongs to the day it starts",
    new Date(2026, 7, 5, 0, 0) >= r.from && new Date(2026, 7, 6, 0, 0) >= r.to);
}

// ------------------------------------------------------------------ paging
{
  t("a week forward is seven days", key(shiftBy("week", WED, 1)) === "2026-08-12", key(shiftBy("week", WED, 1)));
  t("and back", key(shiftBy("week", WED, -1)) === "2026-07-29", key(shiftBy("week", WED, -1)));
  t("a quarter forward is three months",
    key(shiftBy("quarter", WED, 1)) === "2026-11-05", key(shiftBy("quarter", WED, 1)));
  // The classic: 31 March + 1 month is not 1 May.
  const mar31 = new Date(2026, 2, 31);
  t("stepping a month from the 31st lands in the next month",
    key(shiftBy("month", mar31, 1)) === "2026-04-30", key(shiftBy("month", mar31, 1)));
  t("and from January 31st lands in February",
    key(shiftBy("month", new Date(2026, 0, 31), 1)) === "2026-02-28",
    key(shiftBy("month", new Date(2026, 0, 31), 1)));
  t("a leap day survives a year step",
    key(shiftBy("year", new Date(2024, 1, 29), 1)).startsWith("2025-02"),
    key(shiftBy("year", new Date(2024, 1, 29), 1)));
  // Paging must be reversible, or holding an arrow key drifts.
  let d = WED;
  for (let i = 0; i < 12; i++) d = shiftBy("month", d, 1);
  for (let i = 0; i < 12; i++) d = shiftBy("month", d, -1);
  t("twelve months out and back returns to the start", key(d) === "2026-08-05", key(d));
}

// ------------------------------------------------------------------- grids
{
  const cells = monthMatrix(2026, 7);
  t("a month grid is always six weeks", cells.length === 42, cells.length);
  t("starting on a Monday", cells[0].getDay() === 1, cells[0].toString());
  t("and covering the whole month",
    cells.some((d) => key(d) === "2026-08-01") && cells.some((d) => key(d) === "2026-08-31"));
  t("Monday of a Sunday is six days back",
    key(mondayOf(new Date(2026, 7, 9))) === "2026-08-03", key(mondayOf(new Date(2026, 7, 9))));
  t("a quarter holds three months", monthsIn("quarter", WED).length === 3);
  t("a year holds twelve", monthsIn("year", WED).length === 12);
  t("and they start at the right one", monthsIn("quarter", WED)[0][1] === 6, monthsIn("quarter", WED)[0][1]);
}

// ------------------------------------------------------------------ titles
{
  t("a week inside one month reads as a span",
    titleOf("week", WED) === "August 3–9", titleOf("week", WED));
  t("a week across two names both",
    titleOf("week", new Date(2026, 6, 30)).includes("Jul") && titleOf("week", new Date(2026, 6, 30)).includes("Aug"),
    titleOf("week", new Date(2026, 6, 30)));
  t("a quarter is named as one", titleOf("quarter", WED) === "Q3 2026", titleOf("quarter", WED));
  t("scales are validated", isScale("week") && !isScale("fortnight"));
}

// -------------------------------------------------------------------- load
{
  const iso = (d, h, len = 1) => ({
    id: `e${d}${h}`, title: "x",
    start: `2026-08-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00`,
    end: `2026-08-${String(d).padStart(2, "0")}T${String(h + len).padStart(2, "0")}:00:00`,
  });
  const index = loadIndex(
    [iso(5, 9), iso(5, 11, 2), iso(8, 10)],
    [{ taskId: "t", day: "2026-08-05", mins: 60 }],
    [{ id: "t", due: "2026-08-07", done: false }, { id: "u", due: "2026-08-07", done: true }],
  );
  t("meetings and planned work both count", index.meetings.get("2026-08-05") === 180);
  t("work is tracked separately", index.work.get("2026-08-05") === 60);
  t("finished tasks are not counted as due", index.due.get("2026-08-07") === 1, index.due.get("2026-08-07"));

  const hours = hoursOf({ hours: { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] } });
  const wed = loadOf(new Date(2026, 7, 5), index, hours);
  t("four of eight hours is half a day", Math.round(wed.ratio * 100) === 50, wed.ratio);
  t("and a working day is not marked off", wed.off === false);

  const sat = loadOf(new Date(2026, 7, 8), index, hours);
  t("a non-working day is flagged as off", sat.off === true);
  t("and anything on it counts as full, not as spare capacity", sat.ratio === 1, sat.ratio);

  const sun = loadOf(new Date(2026, 7, 9), index, hours);
  t("an empty day off is empty", sun.off === true && sun.ratio === 0);

  const narrow = hoursOf({ hours: { start: "09:00", end: "13:00", days: [1, 2, 3, 4, 5] } });
  t("a shorter day fills up faster",
    loadOf(new Date(2026, 7, 5), index, narrow).ratio === 1,
    loadOf(new Date(2026, 7, 5), index, narrow).ratio);

  const withLunch = hoursOf({
    hours: { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5],
             breaks: [{ label: "Lunch", start: "12:00", end: "13:00", days: [1, 2, 3, 4, 5] }] },
  });
  t("and a standing commitment counts against the day too",
    loadOf(new Date(2026, 7, 5), index, withLunch).ratio > wed.ratio,
    loadOf(new Date(2026, 7, 5), index, withLunch).ratio);
}

console.log(`\nCalendar ranges: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
