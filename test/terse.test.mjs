/**
 * How somebody types once they already know the app.
 *
 * A new user writes "Can you book a call with Priya on Friday at 10?". Three
 * weeks later the same person types "call priya fri 10" — and if only the first
 * is understood, the app gets *slower* to use the better you know it, which is
 * backwards.
 *
 * Two of these were acting on the wrong half of the sentence:
 *
 *   "book lunch fri, cancel the 4pm"        → cancelled a meeting and booked
 *                                             nothing. The opposite of both
 *                                             instructions.
 *   "move standup to 10 and cancel the 3pm" → moved the standup to **3pm** —
 *                                             the hour of the meeting it was
 *                                             being told to delete.
 *
 * And a family that routed correctly while quietly getting the details wrong,
 * which is harder to notice than a miss: "call priya fri 10" booked at nine
 * o'clock with the hour left in the title, "3-4pm" booked at four, and "1h30"
 * meant an hour.
 */
import { store, reset, iso } from "./harness.mjs";
import { parse } from "../src/lib/nlu/parse.js";

const { ask } = await import("../src/lib/nlu/index.js");

let pass = 0, fail = 0;
const failures = [];
const t = (name, ok, detail) => {
  if (ok) pass++; else { fail++; failures.push(name); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const NOW = new Date(2026, 7, 3, 9, 0);

function seed() {
  reset();
  store.addTask({ title: "Board deck", estimateMins: 480, due: "2026-08-14" });
  store.addEvent({ title: "Standup", start: iso(2026, 8, 3, 9), end: iso(2026, 8, 3, 9, 15) });
  store.addEvent({ title: "Client sync", start: iso(2026, 8, 3, 16), end: iso(2026, 8, 3, 17) });
}

/** The event this sentence created: its title and the hour it landed on. */
function booked(sentence) {
  seed();
  const before = new Set(store.getState().events.map((e) => e.id));
  ask(sentence, store.getState(), { now: NOW });
  const made = store.getState().events.find((e) => !before.has(e.id));
  return made ? { title: made.title, at: made.start.slice(11, 16), day: made.start.slice(0, 10) } : null;
}

/* ------------------------------------------------------ the hour in the name */
/**
 * The single biggest one. A bare hour beside a day word carried no time at all,
 * so the booking took the nine o'clock default and the number stayed in the
 * title — an event called "Priya 10" at the wrong time.
 */
console.log("\n  a bare hour beside a day");
{
  const b = booked("call priya fri 10");
  t('"call priya fri 10" lands at ten', b?.at === "10:00", JSON.stringify(b));
  t("  and is not called “Priya 10”", b?.title === "Priya", b?.title);
  t("  on Friday", b?.day === "2026-08-07", b?.day);
}
for (const [s, at] of [["lunch 12", "12:00"], ["dentist tues 3", "15:00"], ["standup mon 9", "09:00"]]) {
  const b = booked(s);
  t(`"${s}" lands at ${at}`, b?.at === at, JSON.stringify(b));
}

console.log("\n  spans");
{
  // "3-4pm" was booking at four: an hour after the thing starts.
  const b = booked("3-4pm board call");
  t('"3-4pm board call" starts at three', b?.at === "15:00", JSON.stringify(b));
}

console.log("\n  run-together lengths");
for (const [s, want] of [["block 1h30", 90], ["block 90m", 90], ["block 1.5h", 90], ["block 45min", 45]]) {
  const got = parse(s, NOW).slots?.durationMins;
  t(`"${s}" is ${want} minutes`, got === want, got);
}

/* ------------------------------------------ a month is not a clock, or a name */
/**
 * Every rule above had to be taught what it is *not* looking at. "Sept 3" is a
 * date, and before the guard it booked at three in the afternoon with an
 * attendee called Sept.
 */
console.log("\n  and what those rules must not touch");
{
  const b = booked("board call sept 3");
  t('"board call sept 3" is a date, not three o\'clock', b?.day === "2026-09-03", JSON.stringify(b));
  t("  with nobody called Sept invited",
    !/sept/i.test(JSON.stringify(store.getState().events.map((e) => e.attendees))));

  t('"block 2h" is a length, not two o\'clock', parse("block 2h", NOW).slots?.durationMins === 120);
  t('"cancel the next 3 days" is not three o\'clock', !parse("cancel the next 3 days", NOW).slots?.timeOnly);
  // "90m" alone is a duration with nothing to attach to, not a task called "9".
  t('"90m" alone does not become a task called "9"', parse("90m", NOW).intent !== "edit_task");
  // The triage question shares its shape with a terse priority edit.
  t('"what\'s most urgent" is not a priority edit', parse("what's most urgent", NOW).intent !== "edit_task");
}

/* ------------------------------------------------------------- two at once */
/**
 * The dangerous pair. Reading the whole line let the *second* verb win, so a
 * sentence asking for a booking performed a deletion.
 */
console.log("\n  two instructions on one line");
{
  seed();
  const events = store.getState().events.length;
  const r = ask("book lunch fri, cancel the 4pm", store.getState(), { now: NOW });
  t("the first instruction is the one carried out", r.intent === "create_event", r.intent);
  t("  and nothing was cancelled", store.getState().events.length === events + 1,
    `${events} → ${store.getState().events.length}`);
  /**
   * Doing half and reporting it as done is worse than doing neither: somebody
   * told "Booked 1h Friday" believes the 4pm is gone, and finds out by turning
   * up to it. So the remainder is said back in their own words.
   */
  t("  and the half she did not do is said back", /cancel the 4pm/.test(r.text ?? ""),
    (r.text ?? "").replace(/\n/g, " | ").slice(-70));
}
{
  seed();
  const r = ask("move standup to 10 and cancel the 3pm", store.getState(), { now: NOW });
  const standup = store.getState().events.find((e) => e.title === "Standup");
  t('"move standup to 10 and cancel the 3pm" moves it to ten', standup?.start.slice(11, 16) === "10:00",
    standup?.start);
  t("  not to the hour of the meeting it was told to delete", standup?.start.slice(11, 16) !== "15:00");
  t("  and offers the rest", /cancel the 3pm/.test(r.text ?? ""));
}

/**
 * The boundary that a global split gets wrong. "Cancel X and reschedule it for
 * Y" is one move stated as two clauses, and cutting on "and" turns it into a
 * cancellation — the user loses the meeting they were rescheduling.
 */
console.log("\n  and what is one instruction wearing two clauses");
{
  seed();
  const r = ask("cancel my meeting for 4pm and reschedule it for friday at 2", store.getState(), { now: NOW });
  t("cancel-and-reschedule is a move, not a cancellation", r.intent === "move_event", r.intent);
  const moved = store.getState().events.find((e) => e.title === "Client sync");
  t("  and the meeting still exists, on Friday", moved?.start.slice(0, 10) === "2026-08-07", moved?.start);
  t("  with no remainder offered, because there isn't one",
    !/only done the first part/.test(r.text ?? ""));
}
{
  seed();
  const r = ask("book lunch friday", store.getState(), { now: NOW });
  t("an ordinary single instruction says nothing about halves",
    !/only done the first part/.test(r.text ?? ""));
}

/* ---------------------------------------------------- destinations that were lost */
/**
 * Recorded as a known gap by the spoken-times pass and fixed here: a bare
 * number after "to" was not read as a time, so the move had nowhere to go.
 */
console.log("\n  move destinations");
for (const s of ["move my 3pm to 4", "push my 3pm to 4", "move 3pm -> 4"]) {
  seed();
  store.addEvent({ title: "Review", start: iso(2026, 8, 3, 15), end: iso(2026, 8, 3, 16) });
  ask(s, store.getState(), { now: NOW });
  const review = store.getState().events.find((e) => e.title === "Review");
  t(`"${s}" lands the review at four`, review?.start.slice(11, 16) === "16:00", review?.start);
}

/* ---------------------------------------------------------- known, unfixed */
/**
 * Printed rather than asserted. Each is genuinely ambiguous, and the app asking
 * is a better answer than the app guessing.
 */
console.log("\n  too ambiguous to route, printed rather than asserted");
for (const [s, why] of [
  ["priya: lease", "<person>: <thing> and <thing>: <property> are the same shape"],
  ["board deck fri", "a task due Friday, or an all-day event?"],
  ["add priya + tom to standup", "the handler writes one attendee, so both names become one person"],
]) {
  seed();
  const r = ask(s, store.getState(), { now: NOW });
  console.log(`    "${s}" → ${r.intent ?? r.miss}  — ${why}`);
}

console.log(`\nTerse: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
