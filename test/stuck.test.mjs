/**
 * What she does when somebody is not coping.
 *
 * This app is built for people who struggle to start, and the sentences below
 * are what that sounds like. They are not commands — "I'm drowning" is a
 * request with a real answer, and the answer is *show me what to do first* —
 * but they are full of verbs that belong to other rules. `finish`, `drop`,
 * `push`, `do`, `start`: every one is owned by something that acts.
 *
 * Which produced the worst behaviour in the product. Executed against a real
 * store, "I'll never finish the deck by Friday" reached COMPLETE_TASK and
 * **ticked the board deck off** — somebody despairing about work they had not
 * started got it marked done. "I can't do all this" reached CANCEL_EVENT.
 * "How far behind am I" was answered "that's outside what I know", about the
 * user's own backlog.
 *
 * So this file asserts two things at once for every sentence: where it routes,
 * and that **nothing in the store moved**. The second is the one that matters.
 * A wrong answer is a bad day; a wrong answer that deletes something is why
 * people stop using an app they were relying on.
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
  store.addTask({ title: "Board deck", estimateMins: 480, due: "2026-08-07" });
  store.addTask({ title: "Investor letter", estimateMins: 120, due: "2026-08-05" });
  store.addTask({ title: "Munich lease", estimateMins: 45, due: "2026-08-10" });
  store.addEvent({ title: "Board call", start: iso(2026, 8, 4, 15), end: iso(2026, 8, 4, 16) });
  store.addEvent({ title: "Standup", start: iso(2026, 8, 5, 9), end: iso(2026, 8, 5, 9, 15) });
}

/** A fingerprint of everything a wrong answer could destroy. */
const snapshot = () => {
  const s = store.getState();
  return JSON.stringify([
    s.tasks.map((x) => [x.title, x.done, x.due, x.delegatedTo]),
    s.events.map((x) => [x.title, x.start]),
    s.projects.map((x) => x.name),
  ]);
};

/** Route it, and prove the week is exactly as it was. */
function harmless(sentence, want) {
  seed();
  const before = snapshot();
  const r = ask(sentence, store.getState(), { now: NOW });
  const got = r.intent ?? r.miss ?? "none";
  const moved = snapshot() !== before;
  t(`"${sentence}" → ${want}, and nothing moved`,
    want.split("|").includes(got) && !moved,
    `${got}${moved ? " AND CHANGED THE STORE" : ""}`);
  return r;
}

/* ----------------------------------------------------- drowning, not ordering */
console.log("\n  under it");
for (const s of [
  "i'm drowning",
  "im drowning",
  "i'm swamped",
  "i'm so behind",
  "i'm buried",
  "i'm completely overwhelmed",
  "this is too much",
  "i can't do all this",
  "everything is on fire",
  "my week is a mess",
  "this week is insane",
  "i have way too much on",
]) harmless(s, "plan_day");

console.log("\n  arguing with the arithmetic");
for (const s of [
  // The one that ticked the deck off.
  "i'll never finish the deck by friday",
  "i'm never going to finish this",
  "there's no way this fits",
  "can i actually finish this",
  "i need more time",
  "something has to give",
]) harmless(s, "plan_day");

console.log("\n  asking to be told what to do");
for (const s of [
  "what should i do first",
  "where do i start",
  "i don't know where to start",
  "what's most important",
  "what matters today",
  "what can i drop",
  "what would you do",
  "you pick",
]) harmless(s, "plan_day|query_day");

console.log("\n  asking how bad it is");
for (const s of [
  "am i behind",
  // Was answered "that's outside what I know" — about the user's own backlog.
  "how far behind am i",
  "how bad is it",
  "am i on track",
  "am i going to miss the deadline",
]) harmless(s, "plan_day|query_day|query_progress");

console.log("\n  avoiding it, and starting over");
for (const s of [
  "i haven't started the deck",
  "i keep putting this off",
  // Emphatically not a request to delete anything.
  "give me a fresh start",
  "let's start over",
  "clean slate",
]) harmless(s, "plan_day");

/* ------------------------------------------------------- nothing left to give */
/**
 * A separate answer on purpose. Hardest-first is the wrong ranking for somebody
 * with nothing left — the top of that list is the eight-hour job they have
 * already failed to start, and being handed it again is why they stopped.
 */
console.log("\n  running on empty");
{
  const r = harmless("i'm tired", "plan_day");
  t("  is offered the shortest job, not the most urgent one",
    /Munich lease/.test(r.text ?? ""), (r.text ?? "").replace(/\n/g, " | ").slice(0, 90));
  t("  and the big one is mentioned after it, not first",
    (r.text ?? "").indexOf("Munich") < (r.text ?? "").indexOf("Board deck"));

  for (const s of ["give me something small", "i've got no focus left", "my brain is fried", "something easy"]) {
    const x = harmless(s, "plan_day");
    t(`  "${s}" is offered something small`, /Munich lease/.test(x.text ?? ""),
      (x.text ?? "").slice(0, 70));
  }
}

/* ------------------------------------------------------- an order is an order */
/**
 * The guard that makes the whole family safe to put this high in the table. A
 * complaint with an instruction bolted onto it is the instruction — answering
 * "I'm swamped, clear my Wednesday" with a triage list would lose the work.
 * The instruction has to name a calendar object, so the idiom in "wipe the
 * slate clean" can never be mistaken for a request to wipe anything.
 */
console.log("\n  a complaint with an order attached is the order");
for (const [s, want] of [
  ["i'm swamped, clear my wednesday", "clear_range"],
  ["i'm drowning, cancel the standup", "cancel_event"],
]) {
  seed();
  const before = snapshot();
  const got = ask(s, store.getState(), { now: NOW }).intent;
  t(`"${s}" → ${want}, and it actually happened`, got === want && snapshot() !== before, got);
}

/**
 * The strongest form of the same claim, and the one that scales past the words
 * the guard happens to know: bolting a complaint onto the front of an
 * instruction must change *nothing at all* about what the instruction does.
 * Compared against the bare sentence rather than against an expected outcome,
 * so it keeps holding whatever the instruction's own behaviour turns out to be
 * — "move the board call to 4" asks which day rather than guessing, and the
 * complaint version has to ask exactly the same question.
 */
console.log("\n  and prefixing a complaint changes nothing about it");
for (const [complaint, bare] of [
  ["this week is insane, move the board call to 4", "move the board call to 4"],
  ["i'm drowning, book lunch friday", "book lunch friday"],
  ["everything is on fire, cancel the standup", "cancel the standup"],
  ["i'm so behind, what's on thursday", "what's on thursday"],
]) {
  seed();
  const a = ask(complaint, store.getState(), { now: NOW });
  const afterA = snapshot();
  seed();
  const b = ask(bare, store.getState(), { now: NOW });
  t(`"${complaint}" behaves exactly like "${bare}"`,
    a.intent === b.intent && afterA === snapshot(),
    `${a.intent} vs ${b.intent}${afterA === snapshot() ? "" : " (different effect on the store)"}`);
}

console.log("\n  and ordinary instructions are untouched");
for (const [s, want] of [
  ["cancel the standup", "cancel_event"],
  ["book lunch friday", "create_event"],
  ["move my 3pm to 4", "move_event"],
  ["i finished the board deck", "complete_task"],
  ["clear my wednesday", "clear_range"],
]) {
  seed();
  t(`"${s}" → ${want}`, ask(s, store.getState(), { now: NOW }).intent === want,
    ask(s, store.getState(), { now: NOW }).intent);
}

/* ---------------------------------------------------------- still small talk */
/**
 * The mirror-image failure. "How are you" is about her, not about the week, and
 * answering it with a triage report would be the same mistake in the other
 * direction.
 */
console.log("\n  courtesies are still courtesies");
for (const [s, want] of [
  ["how are you", "small:howareyou"],
  ["thanks", "small:thanks"],
  ["hi", "small:greet"],
  ["good morning", "small:greet"],
  ["bye", "small:bye"],
  ["what time is it", "small:time"],
  ["what can you do", "small:whatcanyoudo"],
]) {
  seed();
  const r = ask(s, store.getState(), { now: NOW });
  t(`"${s}" → ${want}`, (r.intent ?? r.miss) === want, r.intent ?? r.miss);
}

/* ------------------------------------------------------------ tone of the reply */
/**
 * Somebody having a hard time wants a list, not a hug. She has no standing to
 * offer sympathy and every ability to offer arithmetic, so the reply is
 * numbers and names — and specifically not the encouragement that would make it
 * read as a wellness app.
 */
console.log("\n  the answer is arithmetic, not sympathy");
{
  const r = harmless("i'm drowning", "plan_day");
  const said = r.text ?? "";
  t("  it counts what is actually there", /\d/.test(said), said.slice(0, 60));
  t("  it names the work", /Board deck/.test(said));
  t("  and it does not commiserate",
    !/sorry|hang in|you'?ve got this|deep breath|don'?t worry|it'?s ok|proud/i.test(said), said.slice(0, 120));
}

console.log(`\nStuck: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
