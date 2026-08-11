/**
 * Sentences she used to be confidently wrong about.
 *
 * A miss is honest: she says she didn't catch it and nothing happens. A
 * misroute is the expensive one — the sentence matches a rule that was not
 * meant for it, and she does something. "I have to finish the board deck this
 * week" was a task being *created* and she marked it done; "push the board deck
 * deadline to Friday" was a task edit and she moved a real meeting.
 *
 * The table is ordered and first match wins, so every one of these is a
 * question of which rule got there first. Which is also why the boundary cases
 * matter as much as the fixes: a rule added to catch one phrasing is a rule
 * that can swallow the neighbour it sits in front of, and this file is where
 * that would show up.
 */
import { parse } from "../src/lib/nlu/parse.js";

let pass = 0, fail = 0;
const failures = [];
const t = (name, ok, detail) => {
  if (ok) pass++; else { fail++; failures.push(name); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const NOW = new Date(2026, 7, 3, 9, 0);
const routes = (sentence, want) => {
  const got = parse(sentence, NOW).intent;
  t(`"${sentence}" → ${want}`, want.split("|").includes(got), got);
};

/* -------------------------------------------- an obligation is not a report */
/**
 * The worst of the set, because it silently closed open work. An obligation
 * and a report of having met it are one auxiliary verb apart, and in a planner
 * the obligation is by far the commoner thing to say.
 */
console.log("\n  work you still have to do");
for (const s of [
  "i have to finish the board deck this week",
  "i need to finish the term sheet by friday",
  "we need to finish the deck",
  "i want to finish the lease today",
  "i've got to finish the board deck",
  "ive got to finish the board deck",
  "i still have to finish the board deck",
  "i must finish the diligence index",
  "i should finish the lease this week",
  "i gotta finish the deck",
  "i have to complete the review",
  "i need to wrap up the term sheet",
]) routes(s, "create_task");

/**
 * The other side of the same line. `POLITE_WRAPPER` strips "I need to" as
 * courtesy, which is right everywhere except in front of these verbs — so the
 * guard that fixed the group above must not have taken the courtesy stripping
 * with it.
 */
console.log("\n  work you have actually done");
for (const s of [
  "i finished the board deck",
  "finish the board deck",
  "please finish the board deck",
  "i've finished the term sheet",
  "mark the term sheet as done",
  "the board deck is done",
]) routes(s, "complete_task");

console.log("\n  and the courtesy wrapper still works on everything else");
routes("i need to book a call with bob friday at 2", "create_event");
routes("i need to cancel the board call", "cancel_event");
routes("i'd like you to move my 3pm to 4", "move_event");
routes("can you book lunch friday", "create_event");

/* ------------------------------------------------ a deadline is not a meeting */
/**
 * `SAYS_DUE` knew the adjective "due" and not the noun "deadline", so
 * `isTaskEdit` declined and `MOVE_EVENT` — two rules further down — took the
 * sentence and moved an actual meeting.
 */
console.log("\n  deadlines belong to tasks");
for (const s of [
  "push the board deck deadline to next friday",
  "move the board deck deadline to friday",
  "change the board deck deadline to friday",
  "the board deck deadline is friday",
  "the board deck deadline moved to friday",
  "move the q3 launch deadline to october",
]) routes(s, "edit_task");

console.log("\n  and meetings still move");
routes("move the board call to friday", "move_event");
routes("push my 3pm to 4", "move_event");
routes("shift the standup to 10", "move_event");

/* ------------------------------------------------------ a number is not a person */
/**
 * "Add two hours to the board deck" has the exact shape of "add Priya to the
 * board call", and the attendee rule sits thirteen places ahead of the one that
 * wanted it — so it added somebody named "Two hours" to a meeting.
 */
console.log("\n  quantities are not attendees");
for (const s of [
  "add two hours to the board deck",
  "add 2 hours to the board deck",
  "add half an hour to the review",
  "add another hour to the deck",
]) {
  const got = parse(s, NOW).intent;
  t(`"${s}" is not an attendee edit`, got !== "edit_attendees", got);
}

console.log("\n  and people still are");
for (const s of [
  "add priya to the board call",
  "add tom to the board call",
]) routes(s, "edit_attendees");

/* ------------------------------------------------------------- known gaps */
/**
 * Found while writing the tests above, confirmed present before those changes
 * as well as after, and deliberately not asserted — a test that encodes a bug
 * has to be remembered and updated the day somebody fixes it, and it never is.
 * Printed instead, so a run of this file says out loud what is still wrong.
 *
 * Both are real misroutes rather than misses: she acts, on the wrong thing.
 */
console.log("\n  known gaps, printed rather than asserted");
for (const [sentence, want] of [
  ["add priya and tom to the standup", "edit_attendees"],
  ["get priya to do the board deck", "delegate_task"],
  ["put priya on the board deck", "delegate_task"],
  ["board deck done", "complete_task"],
]) {
  const got = parse(sentence, NOW).intent;
  console.log(`    ${got === want ? "fixed now" : "still"}  "${sentence}" → ${got}  (wants ${want})`);
}

console.log(`\nMisroutes: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
