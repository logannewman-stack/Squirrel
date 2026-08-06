/**
 * The miss log, and the pairing that makes it worth keeping.
 *
 * Two things are being checked here. The store itself — grouping, the cap,
 * surviving a hostile `localStorage` — and the wiring into `ask`, which is
 * where it either records real traffic or quietly records nothing.
 *
 * The second is the one that would rot silently. A log that stops recording
 * looks exactly like a parser that stopped missing.
 */

import { store, ask, iso, reset, t, report } from "./harness.mjs";

const misses = await import("../src/lib/misses.js");
const { forgetMiss } = await import("../src/lib/nlu/index.js");

const NOW = new Date(iso(2026, 3, 10, 9, 0)); // Tuesday

function fresh() {
  reset();
  misses.clear();
  forgetMiss();
  return store.getState;
}

// ------------------------------------------------------------------ shaping
{
  t("shape strips a clock", misses.shapeOf("book lunch at 1pm") === "book lunch at <time>",
    misses.shapeOf("book lunch at 1pm"));

  const a = misses.shapeOf("book lunch with priya friday at 1");
  const b = misses.shapeOf("book dinner with tom tuesday at 7");
  t("shape keeps the skeleton", a === "book lunch with priya <day> at <time>", a);
  t("different nouns stay different shapes", a !== b);

  const c = misses.shapeOf("shift the 3:30 to Friday");
  const d = misses.shapeOf("shift the 9:00 to Monday");
  t("same request, same shape", c === d, `${c} vs ${d}`);

  t("punctuation does not fork a shape",
    misses.shapeOf("cancel it!") === misses.shapeOf("cancel it"));
  t("empty text shapes to empty", misses.shapeOf(null) === "");
}

// ------------------------------------------------------------------- the log
{
  misses.clear();
  t("starts empty", misses.count() === 0);
  t("empty export says so", misses.exportText() === "No misses logged.");

  const id = misses.record({ text: "warp the meeting into next tuesday" });
  t("record returns an id", typeof id === "string" && id.length > 0);
  t("one row", misses.count() === 1);
  t("default reason is unparsed", misses.all()[0].reason === misses.REASONS.UNPARSED);

  t("blank text is not logged", misses.record({ text: "   " }) === null);
  t("blank text left the count alone", misses.count() === 1);

  misses.clear();
  t("clear empties it", misses.count() === 0);
}

// -------------------------------------------------------------------- the cap
{
  misses.clear();
  for (let i = 0; i < 260; i++) misses.record({ text: `nonsense number ${i}` });
  t("capped at 200", misses.count() === 200, misses.count());
  // The cap drops from the front, so the newest survive — a log that forgets
  // what just happened is the one thing worse than no log.
  t("keeps the newest", misses.all().at(-1).text === "nonsense number 259");
  misses.clear();
}

// ---------------------------------------------------------------- the pairing
{
  misses.clear();
  const id = misses.record({ text: "sort out thursday for me" });
  t("unpaired at first", misses.all()[0].fix === null);

  t("pairing reports success", misses.resolve(id, { text: "clear thursday", intent: "clear_range" }));
  t("pair is stored", misses.all()[0].fix === "clear thursday");
  t("pair carries the intent", misses.all()[0].fixIntent === "clear_range");

  t("a second pairing is refused",
    misses.resolve(id, { text: "clear thursday properly", intent: "x" }) === false);
  t("the first pair survived", misses.all()[0].fix === "clear thursday");
  t("pairing an unknown id is refused", misses.resolve("nope", { text: "x", intent: "y" }) === false);
  t("pairing a null id is refused", misses.resolve(null, { text: "x", intent: "y" }) === false);
  misses.clear();
}

// A miss followed by an unrelated command is not a rephrasing, and filing it
// as one sends whoever reads the log looking for a rule that was never needed.
{
  misses.clear();
  const id = misses.record({ text: "order me a coffee" });
  t("an unrelated next turn does not pair",
    misses.resolve(id, { text: "move the board call", intent: "move_event" }) === false);
  t("and nothing was written", misses.all()[0].fix === null);

  t("a genuine rephrasing still pairs",
    misses.resolve(id, { text: "add a task to order coffee for the offsite", intent: "create_task" }));
  misses.clear();
}

{
  const state = fresh();
  ask("order me a coffee", state(), { now: NOW });
  ask("book lunch with priya thursday at noon", state(), { now: NOW });
  t("an unrelated command is not recorded as the fix", misses.all()[0].fix === null,
    misses.all()[0].fix);
  t("and the miss is still there to be seen", misses.count() === 1);
}

// -------------------------------------------------------------------- summary
{
  misses.clear();
  misses.record({ text: "warp lunch to friday at 1" });
  misses.record({ text: "warp lunch to monday at 3" });
  misses.record({ text: "warp lunch to sunday at 9" });
  misses.record({ text: "teleport me to the board meeting" });

  const s = misses.summary();
  t("grouped by shape", s.length === 2, s.length);
  t("commonest first", s[0].count === 3, s[0].count);
  t("keeps up to three examples", s[0].examples.length === 3);
  t("examples are verbatim", s[0].examples[0] === "warp lunch to friday at 1");
  t("singleton kept too", s[1].count === 1);

  const text = misses.exportText();
  t("export leads with the count", text.startsWith("3×"), text.slice(0, 20));
  t("export names the reason", text.includes("Didn't understand"));

  t("rate against handled traffic", Math.abs(misses.rate(96) - 0.04) < 1e-9, misses.rate(96));
  t("rate with no traffic is zero", (misses.clear(), misses.rate(0)) === 0);
}

// ------------------------------------------------------- hostile localStorage
{
  const real = globalThis.localStorage;

  globalThis.localStorage = {
    getItem: () => "{not json at all",
    setItem: () => {},
    removeItem: () => {},
  };
  t("corrupt storage reads as empty", misses.all().length === 0);
  t("corrupt storage still records without throwing",
    (() => { try { misses.record({ text: "hello" }); return true; } catch { return false; } })());

  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => { throw new Error("QuotaExceeded"); },
    removeItem: () => {},
  };
  t("a full disk does not throw",
    (() => { try { misses.record({ text: "hello" }); return true; } catch { return false; } })());
  t("summary survives a full disk",
    (() => { try { misses.summary(); return true; } catch { return false; } })());

  globalThis.localStorage = undefined;
  t("no storage at all reads as empty", misses.all().length === 0);
  t("no storage at all still records without throwing",
    (() => { try { misses.record({ text: "hello" }); return true; } catch { return false; } })());

  globalThis.localStorage = real;
  misses.clear();
}

// ------------------------------------------------------------ wired into ask
{
  const state = fresh();

  const res = ask("play some music", state(), { now: NOW });
  t("nonsense is marked a miss", res.miss === misses.REASONS.UNPARSED, res.miss);
  t("nonsense reached the log", misses.count() === 1, misses.count());
  t("the log holds what was typed", misses.all()[0].text === "play some music");
}

{
  const state = fresh();
  // Understood the verb, and there is nothing on the calendar to move.
  const res = ask("move the board deck to friday at 2", state(), { now: NOW });
  t("an unfindable thing is a no-match", res.miss === misses.REASONS.NO_MATCH, res.miss);
  t("no-match reached the log", misses.count() === 1);
}

{
  const state = fresh();
  const res = ask("invite priya to the standup", state(), { now: NOW });
  t("an unbuilt capability is marked unsupported",
    res.miss === misses.REASONS.UNSUPPORTED, res.miss);
}

{
  const state = fresh();
  const res = ask("what do I have tomorrow?", state(), { now: NOW });
  t("an ordinary answer is not a miss", !res.miss, res.miss);
  t("an ordinary answer is not logged", misses.count() === 0, misses.count());
}

{
  const state = fresh();
  ask("book lunch with priya thursday at noon", state(), { now: NOW });
  t("a booking is not logged", misses.count() === 0, misses.count());
}

// The whole point: the sentence that worked, attached to the one that didn't.
// This pair is a rule waiting to be written — "email X to Y" should have been
// a task all along, and the log says so in the user's own words.
{
  const state = fresh();
  ask("email the deck to legal", state(), { now: NOW });
  t("miss recorded", misses.count() === 1, misses.count());

  ask("add a task to email the deck to legal", state(), { now: NOW });
  const row = misses.all()[0];
  t("the retry was paired to it",
    row.fix === "add a task to email the deck to legal", row.fix);
  t("the pair carries the intent that worked", row.fixIntent === "create_task", row.fixIntent);
  t("summary surfaces the fix",
    misses.summary()[0].resolvedAs[0].text === "add a task to email the deck to legal");
  t("export shows the fix", misses.exportText().includes("worked as:"));
}

// Small talk between the failure and the retry must not eat the pair — people
// thank her mid-thread, and a thank-you is not the answer.
{
  const state = fresh();
  ask("email the deck to legal", state(), { now: NOW });
  ask("thanks", state(), { now: NOW });
  ask("add a task to email the deck to legal", state(), { now: NOW });
  t("small talk did not break the pair",
    misses.all()[0].fix === "add a task to email the deck to legal",
    misses.all()[0].fix);
  t("small talk was not itself logged", misses.count() === 1, misses.count());
}

// Two failures running log two rows, and only the last one is even a candidate
// for the pair — the sentence that worked answers the sentence before it, and
// reaching further back is how a log fills with pairs that mean nothing.
{
  const state = fresh();
  ask("email the deck to legal", state(), { now: NOW });
  ask("order me a coffee", state(), { now: NOW });
  ask("add a task to email the deck to legal", state(), { now: NOW });
  const rows = misses.all();
  t("both failures logged", rows.length === 2, rows.length);
  // Neither pairs: the first is out of reach, and the second is about coffee.
  // Two honest rows beats one row with a confident wrong answer attached.
  t("the out-of-reach failure stayed unpaired", rows[0].fix === null, rows[0].fix);
  t("the unrelated failure stayed unpaired", rows[1].fix === null, rows[1].fix);
}

// Two failures at the same thing, though, do pair — this is the common shape.
{
  const state = fresh();
  ask("email the deck to legal", state(), { now: NOW });
  ask("email deck legal now", state(), { now: NOW });
  ask("add a task to email the deck to legal", state(), { now: NOW });
  const rows = misses.all();
  t("both attempts logged", rows.length === 2, rows.length);
  t("the most recent attempt got the pair",
    rows[1].fix === "add a task to email the deck to legal", rows[1].fix);
}

// A caller asking for a pure function is not real traffic.
{
  const state = fresh();
  ask("play some music", state(), { now: NOW, memory: { turns: [] } });
  t("stateless callers are not logged", misses.count() === 0, misses.count());
}

misses.clear();
report("Miss log");
