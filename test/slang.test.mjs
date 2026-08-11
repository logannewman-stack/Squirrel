/**
 * How people actually type when they are not being careful.
 *
 * Nobody writes "Please reschedule the standup to tomorrow" twice. By the
 * second week it is "shove the standup to tmrw", and an app that only
 * understands the first gets *slower* to use the better you know it.
 *
 * Four of these were changing the wrong data, measured against a real store:
 *
 *   "shove the standup to tmrw"    → created a **second standup** instead of
 *                                    moving the one that exists
 *   "term sheet is off my plate"   → tried to delete a meeting
 *   "board deck is in the bag"     → filed the task in a venue called "the bag"
 *   "get bob to do the deck"       → invited Bob to a meeting named "do the deck"
 *
 * Each is the same shape: a casual idiom whose literal words belong to a rule
 * that sits earlier in the table. "In the bag" reads as a place because it has
 * the grammar of one.
 */
import { store, reset, iso } from "./harness.mjs";

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
  store.addTask({ title: "Term sheet", estimateMins: 60, due: "2026-08-05" });
  store.addTask({ title: "Board deck", estimateMins: 480, due: "2026-08-14" });
  store.addEvent({ title: "Standup", start: iso(2026, 8, 4, 9), end: iso(2026, 8, 4, 9, 15) });
  store.addEvent({ title: "Board call", start: iso(2026, 8, 5, 15), end: iso(2026, 8, 5, 16) });
}

const routes = (sentence, want) => {
  seed();
  const got = ask(sentence, store.getState(), { now: NOW }).intent;
  t(`"${sentence}" → ${want}`, want.split("|").includes(got), got);
};

/** Did it finish that task, without touching anything else? */
function finishes(sentence, title) {
  seed();
  const events = store.getState().events.length;
  ask(sentence, store.getState(), { now: NOW });
  const done = store.getState().tasks.find((x) => x.title === title)?.done;
  t(`"${sentence}" finishes ${title}`, done === true && store.getState().events.length === events,
    `done=${done}, events ${events} → ${store.getState().events.length}`);
}

/* --------------------------------------------------- the ones that acted wrongly */
console.log("\n  moving, not duplicating");
{
  seed();
  const before = store.getState().events.length;
  const r = ask("shove the standup to tmrw", store.getState(), { now: NOW });
  t('"shove the standup to tmrw" moves it', r.intent === "move_event", r.intent);
  t("  and does not leave a second standup behind",
    store.getState().events.length === before, `${before} → ${store.getState().events.length}`);
}
for (const s of ["shunt the standup to friday", "scoot the board call to 4", "bump the standup to 10"]) {
  routes(s, "move_event");
}

console.log("\n  finished, said casually");
finishes("term sheet is off my plate", "Term sheet");
finishes("board deck is in the bag", "Board deck");
finishes("smashed the term sheet", "Term sheet");
finishes("knocked out the term sheet", "Term sheet");
finishes("term sheet is done and dusted", "Term sheet");
finishes("sorted the term sheet", "Term sheet");

console.log("\n  handing it over");
{
  seed();
  ask("get bob to do the deck", store.getState(), { now: NOW });
  t('"get bob to do the deck" gives it to Bob',
    store.getState().tasks.find((x) => x.title === "Board deck")?.delegatedTo === "Bob",
    store.getState().tasks.find((x) => x.title === "Board deck")?.delegatedTo);
  t("  and books nothing", store.getState().events.length === 2, store.getState().events.length);
}
routes("chuck the lease to anders", "delegate_task|create_task");
routes("take the term sheet off my plate", "delegate_task");

/* ------------------------------------------------------------ casual scheduling */
console.log("\n  casual booking and asking");
routes("can we sync up thursday", "create_event");
routes("chuck a call in with bob friday at 2", "create_event");
routes("pencil in lunch with priya friday", "create_event");
routes("lets hop on a call tomorrow at 3", "create_event");
routes("blow off the board call", "cancel_event");
routes("sack off the standup", "cancel_event");
routes("whats my day looking like", "query_day|plan_day");
routes("am i busy tomorrow", "query_day|plan_day");

console.log("\n  texting shorthand");
routes("book a call w/ bob friday at 2", "create_event");
routes("move the standup to tmrw", "move_event");

/* ------------------------------------------------------------ the near misses */
/**
 * Every idiom above shares its words with something that means the opposite.
 * These are the sentences each new rule was most likely to steal.
 */
console.log("\n  words that still mean what they meant");
{
  // "is off" cancels a meeting; "off my plate" finishes a task. One lookahead
  // apart, and getting it wrong either deletes a meeting or loses a task.
  routes("the board call is off", "cancel_event");
  routes("take the standup off my calendar", "cancel_event");

  // A bare past-tense verb is not a completion — "sorted" alone is agreement.
  seed();
  const before = store.getState().tasks.map((x) => x.done).join();
  ask("sorted", store.getState(), { now: NOW });
  t('bare "sorted" does not finish anything',
    store.getState().tasks.map((x) => x.done).join() === before);

  // Hedged completions are not completions.
  for (const s of ["almost done with the deck", "nearly finished the term sheet"]) {
    seed();
    const was = store.getState().tasks.map((x) => x.done).join();
    ask(s, store.getState(), { now: NOW });
    t(`"${s}" does not tick anything off`,
      store.getState().tasks.map((x) => x.done).join() === was);
  }

  // "nudge" is a reminder about a person, not a meeting move.
  routes("ping priya about the lease", "create_task|delegate_task");
  routes("nudge bob about the term sheet", "create_task|delegate_task");

  // The obligation guard from misroute.test.mjs has to survive the new
  // casual modals being added to the courtesy stripper.
  routes("i gotta finish the deck", "create_task");
  routes("i wanna finish the term sheet today", "create_task");
  routes("i finished the term sheet", "complete_task");
}

/* ---------------------------------------------------------- known, unfixed */
/**
 * Printed rather than asserted. Each is a real ambiguity where guessing wrong
 * destroys something, so a miss is the honest answer.
 */
console.log("\n  known gaps, printed rather than asserted");
for (const [s, why] of [
  ["chuck the standup to 11", "chuck creates and delegates; teaching move would break delegation"],
  ["ive knocked the deck on the head", "British for stop doing it as often as finished it"],
  ["wat should i do rn", "pure abbreviation; needs a dictionary, not a rule"],
]) {
  seed();
  const got = ask(s, store.getState(), { now: NOW });
  console.log(`    "${s}" → ${got.intent ?? got.miss}  — ${why}`);
}

console.log(`\nSlang: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
