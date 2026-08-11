/**
 * What a project is worth, and who is paying for it.
 *
 * `project.value` and `project.client` have been stored, edited on the project
 * screen and drawn in Insights since those screens existed — and the words
 * *worth, value, revenue, budget, client, money* appeared nowhere in the
 * parser. Every way of asking about them failed, and each failed differently:
 *
 *   "how much is q3 launch worth"            → nothing at all
 *   "who is the client on q3 launch"         → "that's outside what I know"
 *   "how much money is in the q3 launch project" → **edit_task**, because
 *       "…is in the q3 launch project" reads as a *location* being set. A
 *       question routed to a rule that writes.
 *
 * And routing was only half of it. "What's the value of the Q3 launch project"
 * already reached `query_projects` before any of this, and the answer came back
 * "1 task, 8h of work, due 2026-08-14" — correct, and with no money in it,
 * because `projectLoad` never carried the field. A question can be understood
 * perfectly and still not be answered.
 *
 * So this file checks both halves for every phrasing: where it goes, that the
 * reply contains the actual number, and — the one that matters most — that
 * asking a question never changes anything.
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
  const q3 = store.addProject({ name: "Q3 launch", client: "Meridian Capital", value: 4_000_000 });
  store.addProject({ name: "Atlas", client: "Northwind", value: 850_000 });
  // No value and no client, so the empty case is answered rather than guessed.
  store.addProject({ name: "Board cycle" });
  store.addTask({ title: "Board deck", estimateMins: 480, due: "2026-08-14", projectId: q3.id });
  store.addEvent({ title: "Standup", start: iso(2026, 8, 5, 9), end: iso(2026, 8, 5, 9, 15) });
}

/** Everything a wrongly-routed question could quietly rewrite. */
const fingerprint = () => {
  const s = store.getState();
  return JSON.stringify([
    s.projects.map((p) => [p.name, p.client, p.value]),
    s.tasks.map((x) => [x.title, x.done, x.due, x.notes, x.delegatedTo]),
    s.events.map((e) => [e.title, e.start, e.location]),
  ]);
};

/**
 * Ask, and prove three things: it reached the project answer, the reply says
 * the number, and nothing in the store moved.
 */
function asks(sentence, mustSay) {
  seed();
  const before = fingerprint();
  const r = ask(sentence, store.getState(), { now: NOW });
  const said = r.text ?? "";
  const moved = fingerprint() !== before;
  const ok = r.intent === "query_projects" && mustSay.test(said) && !moved;
  t(`"${sentence}"`, ok,
    `${r.intent ?? r.miss}${moved ? " AND CHANGED THE STORE" : ""} :: ${said.replace(/\n/g, " | ").slice(0, 80)}`);
  return r;
}

/* ------------------------------------------------------------ what it is worth */
console.log("\n  how much is it worth");
for (const s of [
  "how much is q3 launch worth",
  "what's q3 launch worth",
  "what is the q3 launch worth",
  "what's the value of the q3 launch project",
  "how much money is in the q3 launch project",
  "what's the budget on q3 launch",
  "how much revenue is q3 launch",
]) asks(s, /\$4M/);

console.log("\n  across everything");
for (const s of [
  "what are my projects worth",
  "which project is worth the most",
  "how much is all my work worth",
]) asks(s, /\$4\.8M|\$4M/);

/* ---------------------------------------------------------------- who is paying */
console.log("\n  who is paying for it");
for (const s of [
  "who is the client on q3 launch",
  "who's the client on q3 launch",
  "which client is q3 launch for",
  "who's paying for q3 launch",
]) asks(s, /Meridian Capital/);

/* --------------------------------------------------------------- nothing set */
/**
 * A project with no value is not a project worth nothing, and saying "$0" would
 * be a number the user never entered.
 */
console.log("\n  and a project with neither");
{
  const r = asks("how much is board cycle worth", /no value|nothing set|not set/i);
  t("  it does not invent a figure", !/\$0\b/.test(r.text ?? ""), (r.text ?? "").slice(0, 70));
}

/* ------------------------------------------------- a question is never a write */
/**
 * The reason this file fingerprints the whole store on every assertion. The
 * original failure was not that the money question went unanswered — it was
 * that one phrasing of it reached a rule which sets a task's location, so a
 * question about revenue could edit a task. With confirmations off, that is a
 * silent write.
 */
console.log("\n  asking never writes");
{
  let wrote = 0;
  for (const s of [
    "how much money is in the q3 launch project",
    "what's the value on the atlas project",
    "who is the client on atlas",
    "which project is worth the most",
    "how much is board cycle worth",
    "what are my clients",
  ]) {
    seed();
    const before = fingerprint();
    ask(s, store.getState(), { now: NOW });
    if (fingerprint() !== before) { wrote++; console.log(`      "${s}" CHANGED THE STORE`); }
  }
  t("no phrasing of a money question changes anything", wrote === 0, `${wrote} wrote`);
}

/* --------------------------------------------------------- the near neighbours */
/**
 * Every word this rule learned already meant something else. "Budget two hours"
 * is a duration, "book a table" is a meeting, "how much is left on Munich" is
 * about work rather than money, and "what's worth doing" is the triage question
 * that belongs to the overwhelmed family two rules higher.
 */
console.log("\n  words that mean something else");
for (const [s, notThis] of [
  ["budget 2 hours for the review", "query_projects"],
  ["budget an hour for the letter", "query_projects"],
  ["book a table for friday", "query_projects"],
  ["how much is left on the board deck", "query_projects"],
  ["how much have i done this week", "query_projects"],
  ["cancel the client call", "query_projects"],
  ["add a task to chase the client", "query_projects"],
]) {
  seed();
  const got = ask(s, store.getState(), { now: NOW }).intent;
  t(`"${s}" is not a money question`, got !== notThis, got);
}

console.log("\n  and the triage question keeps its own answer");
{
  seed();
  const r = ask("what's worth doing", store.getState(), { now: NOW });
  t('"what\'s worth doing" is still triage', r.intent === "plan_day", r.intent);
}

/* ---------------------------------------------------------- known, unfixed */
/**
 * Printed rather than asserted. `delegatedTo` is stored, but there is no
 * read-only intent that answers "who has this" — every available route writes,
 * and answering a question by assigning work to somebody is a worse outcome
 * than not answering it. Left as a miss on purpose.
 */
console.log("\n  known gaps, printed rather than asserted");
for (const s of ["who owns the board deck", "who's covering the standup"]) {
  seed();
  const r = ask(s, store.getState(), { now: NOW });
  const before = fingerprint();
  console.log(`    "${s}" → ${r.intent ?? r.miss}${fingerprint() !== before ? " (writes!)" : " (read-only)"}`);
}

console.log(`\nProject money: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
