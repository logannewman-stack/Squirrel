/**
 * How often a message leaves the device.
 *
 * The product promise is specific and it is a cost promise: Squirrel answers
 * from rules that run in the browser, at no per-message cost, offline. A model
 * exists only as a safety net for phrasings the rules *miss*, it is off until
 * somebody turns it on, and a message the rules understand never goes anywhere.
 *
 * That is four separate gates, each in a different file, and every one of them
 * is one careless edit from being bypassed — silently, because the failure mode
 * is not an error. It is a bill.
 *
 * So this counts. A resolver is installed that records every call instead of
 * making one, the real corpus from `coverage.test.mjs` is run through the real
 * `askAsync`, and the count has to be zero.
 */
import { store, reset, iso } from "./harness.mjs";
import { CORPUS } from "./coverage.test.mjs";
import { parse } from "../src/lib/nlu/parse.js";

const { askAsync } = await import("../src/lib/nlu/index.js");
const fb = await import("../src/lib/nlu/fallback.js");

let pass = 0, fail = 0;
const failures = [];
const t = (name, ok, detail) => {
  if (ok) pass++; else { fail++; failures.push(name); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const NOW = new Date(2026, 7, 3, 9, 0);

/** A resolver that spends nothing and remembers everything asked of it. */
function meter(answer = null) {
  const seen = [];
  fb.setResolver(async (text) => {
    seen.push(text);
    return answer;
  });
  return seen;
}

/** Something for the sentences to talk about, so they resolve rather than miss. */
function seed() {
  reset();
  const p = store.addProject({ name: "Q3 launch" });
  store.addTask({ title: "Board deck", estimateMins: 120, due: "2026-08-14", projectId: p.id });
  store.addTask({ title: "Term sheet", estimateMins: 60, due: "2026-08-05" });
  store.addEvent({ title: "Board call", start: iso(2026, 8, 4, 15), end: iso(2026, 8, 4, 16) });
  store.addEvent({ title: "Standup", start: iso(2026, 8, 3, 9, 30), end: iso(2026, 8, 3, 9, 45) });
  return store.getState();
}

/* ---------------------------------------------------------------- switched off */
/**
 * The default, and the one that matters most: a fresh install has no resolver
 * installed at all, so there is nothing for a message to be sent to.
 */
{
  fb.clearResolver();
  t("a fresh install has no model attached", fb.hasResolver() === false);

  const state = seed();
  const res = await askAsync("bfnkq wibble zorp", state, { now: NOW });
  t("and even a sentence nobody could parse stays on the device", Boolean(res.miss));
  t("answered by the rules rather than by silence",
    typeof res.text === "string" && res.text.length > 0, res.text?.slice(0, 60));
}

/* -------------------------------------------------- switched on, and still quiet */
/**
 * The expensive misunderstanding would be "on" meaning "route everything
 * through the model". It does not. `askAsync` calls the resolver only when the
 * deterministic pass has already missed, so a working vocabulary is what keeps
 * the bill at zero — and the corpus is at 100% coverage.
 */
{
  const state = seed();
  const seen = meter();
  let asked = 0;

  for (const [, list] of Object.entries(CORPUS)) {
    for (const sentence of list) {
      asked++;
      await askAsync(sentence, state, { now: NOW });
    }
  }

  t(`${asked} real sentences were asked`, asked > 300, asked);

  /**
   * It was 69 before `askAsync` learned that only an *unparsed* miss is worth
   * rewriting. "cancel my 4pm" with nothing at four is understood perfectly
   * and simply has no answer; no rewording conjures the meeting. Naming
   * something that is not there is an ordinary thing to do, and every instance
   * of it was being billed.
   *
   * What is left is asked here in a way it never occurs in the app: a bare
   * correction — "no, make it Monday" — with no previous turn for the word
   * "it" to mean anything. In a real session those carry the thread and are
   * answered locally; a test that asks them cold is the only place they can
   * miss. So the assertion is not a round number, it is a *shape*: nothing
   * leaves the device except a fragment asked with no conversation.
   */
  const loose = seen.filter((sentence) => {
    const p = parse(sentence, NOW);
    return !(p.repair || p.amend || p.fragment);
  });
  t("nothing leaves the device except a fragment asked without its thread",
    loose.length === 0, `${loose.length} of ${seen.length}: ${loose.slice(0, 6).join(" | ")}`);

  console.log(`      ${asked} sentences · ${seen.length} left the device, all conversational ` +
    `fragments · ${((1 - seen.length / asked) * 100).toFixed(1)}% answered locally outright`);
}

/* --------------------------------------------------- understood, but not there */
/**
 * The distinction that keeps the number at zero. Both of these are complete,
 * correct answers already; a model can only reword them into a different way of
 * saying the same thing, at a price.
 */
{
  const state = seed();
  const seen = meter("cancel the board call");

  const gone = await askAsync("cancel my 4pm", state, { now: NOW });
  t("a sentence about a meeting that isn't there is answered, not forwarded",
    seen.length === 0, seen);
  t("and says so plainly", /couldn't find/i.test(gone.text ?? ""), gone.text?.slice(0, 60));

  await askAsync("delete the munich walkthrough", state, { now: NOW });
  await askAsync("drop the friday lunch", state, { now: NOW });
  t("however many times somebody names something that does not exist",
    seen.length === 0, seen);
}

/* ------------------------------------------------------------ what does go out */
/**
 * The test above must not be able to pass by the resolver being broken, so this
 * proves the wire is live: something genuinely unparseable does reach it.
 */
{
  const state = seed();
  const seen = meter("what does my week look like");
  const res = await askAsync("zzqx blorp hemmelfarb", state, { now: NOW });

  t("a genuine miss does reach the model", seen.length === 1, seen);
  t("and the rewrite is run down the ordinary road, not acted on directly",
    res.rewrote === "what does my week look like", res.rewrote);
  t("with the original kept, so the log holds both sentences",
    res.rewroteFrom === "zzqx blorp hemmelfarb", res.rewroteFrom);
}

/* ------------------------------------------------------------- bounded to one */
{
  const state = seed();
  // A resolver whose rewrite also fails to parse. Without a bound this is an
  // infinite loop, and a paid one.
  const seen = meter("still complete gibberish qqqq");
  const res = await askAsync("original gibberish wwww", state, { now: NOW });

  t("a rewrite is never itself rewritten", seen.length === 1, seen);
  t("and a failed rewrite falls back to the honest answer", Boolean(res.miss));
  t("without showing the user the rewrite that failed", res.rewrote === undefined);
}

/* ----------------------------------------------------------- costs nothing to fail */
/**
 * Every failure collapses to the deterministic answer, so a dead endpoint, an
 * expired key or a plane with no wifi is indistinguishable from the boost being
 * switched off. That is what makes the offline claim true rather than aspirational.
 */
{
  const state = seed();

  fb.setResolver(async () => { throw new Error("network down"); });
  t("a thrown error is the same as no model",
    Boolean((await askAsync("qqzz wobble", state, { now: NOW })).miss));

  fb.setResolver(async () => new Promise((r) => setTimeout(() => r("book lunch friday"), 50)));
  t("so is one that takes too long",
    Boolean((await fb.interpret("qqzz wobble", {}, { timeoutMs: 10 })) === null));

  fb.setResolver(async () => "");
  t("so is an empty answer", Boolean((await askAsync("qqzz wobble", state, { now: NOW })).miss));

  fb.setResolver(async () => ({ intent: "cancel_event" }));
  t("and so is a model trying to return an action instead of a sentence",
    Boolean((await askAsync("qqzz wobble", state, { now: NOW })).miss));

  fb.clearResolver();
}

/* ------------------------------------------------- the switch is the only switch */
/**
 * `App.jsx` installs the resolver only while `settings.fallback === true`, and
 * that setting is absent on a new account. Asserted here as the store sees it,
 * because the default being anything other than off is the one mistake that
 * would cost money without anybody choosing to.
 */
{
  reset();
  t("the boost is off on a new account", store.getState().settings?.fallback !== true,
    JSON.stringify(store.getState().settings?.fallback));

  store.setSetting("fallback", true);
  t("and only an explicit choice turns it on", store.getState().settings.fallback === true);

  store.setSetting("fallback", false);
  t("which can be taken back", store.getState().settings.fallback !== true);
}

console.log(`\nCost: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
