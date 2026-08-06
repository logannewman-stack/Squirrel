/**
 * The fallback seam, tested mostly for what it refuses to do.
 *
 * A model on the other end of this is the one part of the assistant that can
 * return anything at all — a paragraph, an echo, an error, silence, or a
 * perfectly plausible instruction to delete a week. So the tests that matter
 * are the ones where the far end misbehaves, and every one of them has the
 * same expected outcome: the deterministic answer, unchanged.
 *
 * There is no network here and no key. The resolver is a plain function, which
 * is exactly what makes this seam worth having — the far end is replaceable
 * and, in tests, entirely in hand.
 */

import { store, ask, iso, reset, t, report } from "./harness.mjs";

const misses = await import("../src/lib/misses.js");
const { askAsync, forgetMiss } = await import("../src/lib/nlu/index.js");
const fb = await import("../src/lib/nlu/fallback.js");

const NOW = new Date(iso(2026, 3, 10, 9, 0)); // Tuesday

function fresh() {
  reset();
  misses.clear();
  forgetMiss();
  fb.clearResolver();
  return store.getState;
}

/** A sentence the rules genuinely have no rule for. */
const MISSED = "email the deck to legal";

// --------------------------------------------------------------- the socket
{
  fb.clearResolver();
  t("nothing installed by default", fb.hasResolver() === false);
  t("no resolver interprets to null", (await fb.interpret("anything")) === null);

  fb.setResolver(() => "a rewrite");
  t("installing takes", fb.hasResolver() === true);
  t("it is used", (await fb.interpret("something")) === "a rewrite");

  fb.setResolver("not a function");
  t("a non-function is refused", fb.hasResolver() === false);

  fb.setResolver(() => "x");
  fb.clearResolver();
  t("clearing takes", fb.hasResolver() === false);
}

// ------------------------------------------------------- what it will not run
{
  const bad = {
    "null": () => null,
    "undefined": () => undefined,
    "a number": () => 42,
    "an object": () => ({ intent: "cancel_event" }),
    "empty string": () => "",
    "whitespace": () => "   \n  ",
    "an echo": () => "book lunch friday",
    "a differently-cased echo": () => "BOOK LUNCH FRIDAY",
    "a paragraph": () => "Certainly! ".repeat(40),
    "a thrown error": () => { throw new Error("500"); },
    "a rejected promise": () => Promise.reject(new Error("network")),
  };
  for (const [name, fn] of Object.entries(bad)) {
    fb.setResolver(fn);
    t(`refuses ${name}`, (await fb.interpret("book lunch friday")) === null);
  }

  fb.setResolver(() => new Promise((r) => setTimeout(() => r("too late"), 200)));
  t("refuses a slow answer", (await fb.interpret("x", {}, { timeoutMs: 20 })) === null);

  fb.setResolver(async () => "  move the board call to friday  ");
  t("trims a good answer", (await fb.interpret("x")) === "move the board call to friday");

  fb.clearResolver();
  t("an empty question is not sent", (await fb.interpret("   ")) === null);
}

// ------------------------------------------------------------------ context
{
  const state = fresh();
  store.addEvent({ title: "Board call", start: iso(2026, 3, 11, 14, 0), end: iso(2026, 3, 11, 15, 0) });
  store.addTask({ title: "Term sheet", estimateMins: 60 });
  store.addTask({ title: "Done thing" });
  const doneId = store.getState().tasks.find((x) => x.title === "Done thing").id;
  store.toggleTask(doneId);

  const ctx = fb.contextFor(state(), NOW);
  t("context carries upcoming titles", ctx.upcoming[0].title === "Board call", JSON.stringify(ctx.upcoming));
  t("context carries open tasks", ctx.tasks.some((x) => x.title === "Term sheet"));
  t("context leaves finished work out", !ctx.tasks.some((x) => x.title === "Done thing"));
  t("context carries the clock", typeof ctx.now === "string");

  // Ten and ten. The cap is the difference between a prompt you can read
  // before sending and a prompt that quietly ships someone's whole quarter.
  for (let i = 0; i < 30; i++) {
    store.addEvent({ title: `Filler ${i}`, start: iso(2026, 3, 12, 9, 0), end: iso(2026, 3, 12, 10, 0) });
    store.addTask({ title: `Chore ${i}` });
  }
  const big = fb.contextFor(store.getState(), NOW);
  t("events capped at ten", big.upcoming.length === 10, big.upcoming.length);
  t("tasks capped at ten", big.tasks.length === 10, big.tasks.length);
  t("context sends no notes or attendees",
    Object.keys(big.upcoming[0]).join(",") === "title,start", Object.keys(big.upcoming[0]).join(","));
}

// --------------------------------------------------- askAsync with no fallback
{
  const state = fresh();
  const res = await askAsync(MISSED, state(), { now: NOW });
  t("without a fallback the answer is unchanged", res.miss === misses.REASONS.UNPARSED);
  t("without a fallback nothing was rewritten", res.rewrote === undefined);
  t("without a fallback the miss is still logged", misses.count() === 1);
}

{
  const state = fresh();
  const res = await askAsync("what do I have tomorrow?", state(), { now: NOW });
  t("a hit is returned as-is", !res.miss && res.intent === "query_day");
}

// ------------------------------------------------------ askAsync with one in
{
  const state = fresh();
  let sawText = null;
  let sawContext = null;
  let calls = 0;
  fb.setResolver((text, context) => {
    calls++;
    sawText = text;
    sawContext = context;
    return "add a task to email the deck to legal";
  });

  const res = await askAsync(MISSED, state(), { now: NOW });
  t("the rewrite acted", res.intent === "create_task", res.intent);
  t("the task was really created",
    store.getState().tasks.some((x) => /email the deck/i.test(x.title)));
  t("the answer carries no miss", !res.miss);
  t("the answer says what it rewrote", res.rewrote === "add a task to email the deck to legal");
  t("the answer keeps the original", res.rewroteFrom === MISSED);
  t("the resolver saw the original sentence", sawText === MISSED);
  t("the resolver was given context", Boolean(sawContext?.now));
  t("called exactly once", calls === 1, calls);
}

// A hit never reaches the fallback — this is the entire cost argument.
{
  const state = fresh();
  let calls = 0;
  fb.setResolver(() => { calls++; return "whatever"; });
  await askAsync("book lunch with priya thursday at noon", state(), { now: NOW });
  await askAsync("what do I have tomorrow?", state(), { now: NOW });
  await askAsync("clear my thursday", state(), { now: NOW });
  t("understood traffic never calls out", calls === 0, calls);
}

// --------------------------------------------------- when the far end is wrong
{
  const state = fresh();
  fb.setResolver(() => "flurble the wibble sideways");
  const res = await askAsync(MISSED, state(), { now: NOW });
  t("a useless rewrite falls back to the honest answer",
    res.miss === misses.REASONS.UNPARSED, res.miss);
  t("the user is not shown the failed rewrite", res.rewrote === undefined);
  t("only the original was logged", misses.count() === 1, misses.count());
  t("the log holds what the person said, not the rewrite",
    misses.all()[0].text === MISSED, misses.all()[0].text);
}

{
  const state = fresh();
  fb.setResolver(() => { throw new Error("api down"); });
  const res = await askAsync(MISSED, state(), { now: NOW });
  t("a thrown resolver degrades to the honest answer", res.miss === misses.REASONS.UNPARSED);
}

{
  const state = fresh();
  fb.setResolver(() => null);
  const res = await askAsync(MISSED, state(), { now: NOW });
  t("a resolver with nothing to say degrades cleanly", res.miss === misses.REASONS.UNPARSED);
}

// One pass, always. A resolver that keeps returning misses must not recurse.
{
  const state = fresh();
  let calls = 0;
  fb.setResolver(() => { calls++; return `still nonsense ${calls}`; });
  await askAsync(MISSED, state(), { now: NOW });
  t("never rewrites a rewrite", calls === 1, calls);
}

// ------------------------------------------------ destructive rewrites are gated
{
  reset({ confirm: true });
  misses.clear();
  forgetMiss();
  const state = store.getState;
  store.addEvent({ title: "Board call", start: iso(2026, 3, 11, 14, 0), end: iso(2026, 3, 11, 15, 0) });

  fb.setResolver(() => "cancel the board call");
  const res = await askAsync("get shot of the kowalski thing", state(), { now: NOW });
  t("a destructive rewrite asks first", Boolean(res.choices || res.text.includes("?")), res.text);
  t("nothing was deleted yet",
    store.getState().events.some((e) => e.title === "Board call"));
}

// ------------------------------------------------------------- the paper trail
{
  const state = fresh();
  fb.setResolver(() => "add a task to email the deck to legal");
  await askAsync(MISSED, state(), { now: NOW });

  const row = misses.all()[0];
  t("the miss is still the user's sentence", row.text === MISSED);
  t("the fix is recorded", row.fix === "add a task to email the deck to legal", row.fix);
  t("the fix is attributed to the model", row.fixSource === "model", row.fixSource);
  t("only one row", misses.count() === 1, misses.count());
}

{
  const state = fresh();
  ask(MISSED, state(), { now: NOW });
  ask("add a task to email the deck to legal", state(), { now: NOW });
  t("a human fix is attributed to the human", misses.all()[0].fixSource === "user");
}

fb.clearResolver();
misses.clear();
report("Fallback seam");
