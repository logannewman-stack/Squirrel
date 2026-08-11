/**
 * English as most English speakers write it.
 *
 * An app that only understands American phrasing fails silently for most of the
 * people on earth who speak the language, and they experience it as the app
 * being broken rather than as a dialect gap. Three of these were destructive:
 *
 *   "prepone the board call to Tuesday"     → booked a SECOND board call,
 *      titled "Prepone the board call", with an attendee named "To".
 *      Prepone is everyday Indian English and has no American equivalent, so
 *      it fell to the booking fallback with the verb still in the title.
 *   "kindly revert back with the schedule"  → UNDO. Across South Asia "revert"
 *      means *reply*; here it threw away the user's last change.
 *   "book a call on the 3rd of September"   → booked TODAY. The month patterns
 *      required adjacency, so "the 3rd" hit the bare-ordinal rule and
 *      September was discarded.
 *
 * And one that has nothing to do with dialect at all, found here and affecting
 * everybody: **"book a call on friday at 2" invented a person called "On"**,
 * and "schedule the board call for friday" invented "For".
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

const NOW = new Date(2026, 7, 3, 9, 0); // Monday 3 August 2026

function seed() {
  reset();
  store.addTask({ title: "Board deck", estimateMins: 60, due: "2026-08-14" });
  store.addTask({ title: "Munich lease", estimateMins: 45, due: "2026-08-10" });
  store.addEvent({ title: "Board call", start: iso(2026, 8, 5, 15), end: iso(2026, 8, 5, 16) });
  store.addEvent({ title: "Standup", start: iso(2026, 8, 4, 9), end: iso(2026, 8, 4, 9, 15) });
}

/** What this sentence put on the calendar: title, day, hour, and who is on it. */
function booked(sentence) {
  seed();
  const before = new Set(store.getState().events.map((e) => e.id));
  ask(sentence, store.getState(), { now: NOW });
  const made = store.getState().events.find((e) => !before.has(e.id));
  return made
    ? { title: made.title, day: made.start.slice(0, 10), at: made.start.slice(11, 16),
        people: (made.attendees ?? []).map((a) => a.name ?? a) }
    : null;
}

const routes = (sentence, want) => {
  seed();
  const got = ask(sentence, store.getState(), { now: NOW }).intent;
  t(`"${sentence}" → ${want}`, want.split("|").includes(got), got);
};

/* --------------------------------------------------------------- phantom people */
/**
 * Dialect-neutral, and the one with the widest blast radius: a preposition was
 * being read as a name, so an ordinary booking carried an attendee who does not
 * exist and a title with the date still in it.
 */
console.log("\n  prepositions are not people");
for (const s of [
  "book a call on friday at 2",
  "schedule the board call for friday",
  "book a call in the morning",
]) {
  const b = booked(s);
  t(`"${s}" invites nobody`, b !== null && b.people.length === 0, JSON.stringify(b));
}

console.log("\n  and real people still are");
{
  seed();
  ask("add priya to the board call", store.getState(), { now: NOW });
  t("adding Priya adds Priya",
    store.getState().events.some((e) => (e.attendees ?? []).some((a) => (a.name ?? a) === "Priya")),
    JSON.stringify(store.getState().events.map((e) => e.attendees)));

  seed();
  ask("delegate the lease to anders", store.getState(), { now: NOW });
  t("handing the lease to Anders still works",
    store.getState().tasks.find((x) => x.title === "Munich lease")?.delegatedTo === "Anders",
    store.getState().tasks.find((x) => x.title === "Munich lease")?.delegatedTo);
}

/* ----------------------------------------------------------------- Indian English */
console.log("\n  prepone, and reverting");
{
  seed();
  const before = store.getState().events.length;
  const r = ask("prepone the board call to tuesday", store.getState(), { now: NOW });
  t('"prepone" moves rather than books', r.intent === "move_event", r.intent);
  t("  and does not leave a second board call behind",
    store.getState().events.length === before, `${before} → ${store.getState().events.length}`);
}
/**
 * The one that destroyed something. "Revert" as *reply* is standard across
 * South Asia, and it was reaching rule one and throwing away the last change.
 */
/**
 * The property that matters is not where these land but that they no longer
 * land on UNDO. "Please revert with the timings" is a miss now, and a miss is
 * honest — she says she did not catch it and nothing happens. Undoing the
 * user's last change because they used a South Asian idiom for "reply" is a
 * different order of wrong, so that is what is asserted.
 */
for (const s of [
  "kindly revert back with the schedule",
  "please revert with the timings",
  "kindly revert back with your availability",
]) {
  seed();
  const was = [store.getState().events.length, store.getState().tasks.length];
  const r = ask(s, store.getState(), { now: NOW });
  const now = [store.getState().events.length, store.getState().tasks.length];
  // Nothing removed. One of these now files a task, which is a generous
  // reading of a request rather than a destructive one — the line being drawn
  // is between misreading somebody and throwing their work away.
  t(`"${s}" does not undo or delete anything`,
    r.intent !== "undo" && now[0] >= was[0] && now[1] >= was[1],
    `${r.intent ?? r.miss} · events ${was[0]}→${now[0]}, tasks ${was[1]}→${now[1]}`);
}

console.log("\n  while undo is still undo");
routes("undo", "undo");
routes("revert that", "undo");
routes("put it back", "undo");

/* -------------------------------------------------------------------- dates */
/**
 * Every one of these booked confidently at the wrong moment, which is the
 * failure nobody catches until they miss the meeting.
 */
console.log("\n  dates said the other way round");
{
  const b = booked("book a call on the 3rd of september");
  t('"the 3rd of september" is in September', b?.day === "2026-09-03", JSON.stringify(b));
  t("  and September is not left in the title", b?.title === "Call", b?.title);
}
{
  // Was exactly seven days early, every time.
  const b = booked("book the review a week on tuesday");
  t('"a week on tuesday" is the Tuesday after next', b?.day === "2026-08-11", JSON.stringify(b));
  t("  and is not called “Week”", b?.title === "Review", b?.title);
}
for (const [s, day] of [
  ["book the retro tuesday week", "2026-08-11"],
  ["book a call in a fortnight", "2026-08-17"],
]) {
  const b = booked(s);
  t(`"${s}" → ${day}`, b?.day === day, JSON.stringify(b));
}

console.log("\n  and ordinary dates are unmoved");
for (const [s, day] of [
  ["book a call tuesday", "2026-08-04"],
  ["book a call next tuesday", "2026-08-11"],
  ["book a call on september 3rd", "2026-09-03"],
]) {
  const b = booked(s);
  t(`"${s}" → ${day}`, b?.day === day, JSON.stringify(b));
}

/* ----------------------------------------------------------------- spellings */
/**
 * `finalis|finaliz` and `analys|analyz` were dead alternatives in *both*
 * dialects — the group ends in a word boundary, which the next letter of
 * "finalise" never supplies. Neither spelling had ever matched.
 */
console.log("\n  -ise and -ize");
for (const s of [
  "i need to finalise the term sheet",
  "i need to finalize the term sheet",
  "organise the offsite",
  "organize the offsite",
]) {
  seed();
  const got = ask(s, store.getState(), { now: NOW }).intent;
  t(`"${s}" is understood`, got !== undefined && got !== "unknown", got);
}

/* ------------------------------------------------------- the half-day collision */
/**
 * A cross-agent collision, caught because two passes touched delegation.
 * "I'm taking a half-day" was read as handing work to a person called "I'm" —
 * so the leave never reached the calendar and a task went to a nonexistent
 * teammate.
 */
console.log("\n  taking leave is not delegating it");
for (const s of [
  "i'm taking a half-day on friday",
  "i'm on annual leave next week",
  "i'm on holiday friday",
]) {
  seed();
  const r = ask(s, store.getState(), { now: NOW });
  t(`"${s}" does not delegate`, r.intent !== "delegate_task", r.intent);
  t(`  and assigns work to nobody`,
    !store.getState().tasks.some((x) => x.delegatedTo),
    store.getState().tasks.filter((x) => x.delegatedTo).map((x) => x.delegatedTo).join());
}

console.log("\n  while real hand-offs are untouched");
for (const s of [
  "bob is taking point on munich",
  "let sarah run with the term sheet",
  "get bob to do the deck",
  "anders takes over the lease",
]) routes(s, "delegate_task");

/* ------------------------------------------------------------- vocabulary */
console.log("\n  the diary, and putting things back");
routes("put the standup back an hour", "move_event");
routes("bring the board call forward to 2", "move_event");
routes("what's in my diary on friday", "query_day");
routes("pop a call in with bob on friday at 2", "create_event");

/* ---------------------------------------------------------- known, unfixed */
/**
 * Printed rather than asserted. The first is the only remaining
 * confidently-wrong date, and it is unfixable from the sentence alone.
 */
console.log("\n  known gaps, printed rather than asserted");
{
  const b = booked("book a call on 12/8");
  console.log(`    "book a call on 12/8" → ${b?.day} — both readings are valid and both ahead;` +
    " nothing in the sentence decides it. A dmy install setting is the only fix.");
  for (const s of ["ring the office at 3", "minimise my meetings on friday"]) {
    console.log(`    "${s}" → ${parse(s, NOW).intent}`);
  }
}

console.log(`\nInternational: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
