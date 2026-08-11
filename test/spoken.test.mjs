/**
 * Times said in words, and the hours she used to get wrong.
 *
 * A misrouted sentence is caught by the person reading the reply. A *mis-timed*
 * one is not: the intent is right, the confirmation reads perfectly, and the
 * meeting lands at the wrong hour. "Book dinner at 8 in the evening" booked
 * dinner at **8am**. "At three in the afternoon" landed at **2pm**, off by one
 * in a way nobody would think to check. "Forty five minutes" was read as
 * **five**.
 *
 * None of those were voice-only bugs, which is the thing worth recording. They
 * were found by an audit of spoken input and they affect typed input exactly as
 * badly — the words that settle a bare hour sat two tokens away from it and
 * nothing was looking that far.
 *
 * ## The structural finding underneath them
 *
 * `fromSpeech` normalises dictation, and it was wired only to the in-app
 * microphone. Anything arriving from Siri, a Shortcut, the widget or a deep
 * link comes in through `?ask=` and never touched it — so every spoken form it
 * knew how to fix was fixed for one entry point out of five. That is why the
 * knowledge below lives in `datetime.js`, which every path shares, rather than
 * in the normaliser.
 */
import { parse } from "../src/lib/nlu/parse.js";

let pass = 0, fail = 0;
const failures = [];
const t = (name, ok, detail) => {
  if (ok) pass++; else { fail++; failures.push(name); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const NOW = new Date(2026, 7, 3, 9, 0);

/** The clock time a sentence resolves to, as HH:MM. */
const at = (sentence) => {
  const when = parse(sentence, NOW).slots?.when;
  return when ? new Date(when).toTimeString().slice(0, 5) : "none";
};
const clock = (sentence, want) => t(`"${sentence}" → ${want}`, at(sentence) === want, at(sentence));

/** Minutes, however the length was phrased. */
const mins = (sentence) => {
  const s = parse(sentence, NOW).slots ?? {};
  return s.durationMins ?? s.estimateMins ?? "none";
};
const lasts = (sentence, want) => t(`"${sentence}" → ${want}m`, mins(sentence) === want, mins(sentence));

/* ----------------------------------------------- the word that settles the hour */
/**
 * A bare hour is ambiguous and the sentence almost always resolves it a few
 * words later. The business-hours default was being applied before anybody
 * looked.
 */
console.log("\n  evening and night");
clock("book dinner at 8 in the evening", "20:00");
clock("book a call at 8 tonight", "20:00");
clock("meeting at 9 at night", "21:00");
clock("call bob at 7 this evening", "19:00");
clock("dinner at 6 tonight", "18:00");

console.log("\n  morning and afternoon");
clock("book a call at three in the afternoon", "15:00");
clock("book a call at 9 in the morning", "09:00");
clock("standup at 8 in the morning", "08:00");
clock("review at 4 in the afternoon", "16:00");

/**
 * The half that must not have moved. An explicit meridiem, and the sensible
 * business-hours guess for a bare hour with nothing to settle it, both have to
 * survive everything above.
 */
console.log("\n  and what was already right");
clock("book a call at 3pm", "15:00");
clock("book a call at 9am", "09:00");
clock("book a call at 11am", "11:00");
clock("book lunch at noon", "12:00");
clock("book a call at 2", "14:00");
clock("book a call at 10", "10:00");

/* ------------------------------------------------------------ times in words */
console.log("\n  said rather than typed");
clock("book a call at half past two", "14:30");
clock("book a call at quarter past nine", "09:15");
clock("book a call at quarter to nine", "08:45");
clock("book a call at ten to five", "16:50");
clock("book a call at twenty past three", "15:20");
clock("book a call at ten thirty", "10:30");
clock("book a call at nine fifteen", "09:15");
clock("book a call at three o'clock", "15:00");

/**
 * "Half two" means 2:30 to a British speaker and 1:30 to a German one. The app
 * is in English; the English reading is the right one, and getting it backwards
 * would be an hour out in the direction nobody checks.
 */
console.log("\n  and the British half-hour");
clock("book a call at half two", "14:30");
clock("book a call at half nine", "09:30");

/* --------------------------------------------------------------- how long */
/**
 * "Forty five minutes" was five, because the scan read only the second word of
 * a compound number. Every multiple of ten had the same fault.
 */
console.log("\n  lengths");
lasts("the deck will take forty five minutes", 45);
lasts("block twenty five minutes", 25);
lasts("block thirty five minutes", 35);
lasts("three quarters of an hour on the deck", 45);
lasts("block an hour and a half", 90);
lasts("block half an hour", 30);
lasts("block two hours", 120);
lasts("block 45 minutes", 45);
lasts("block 90 minutes", 90);

/* ----------------------------------------------------- counts are not clocks */
/**
 * The guard on all of the above. Every number these rules learned to read is a
 * number that already meant something else somewhere — a count of meetings, a
 * fraction, a quantity. Widening a time rule until it eats those is the easy
 * way to make this worse while the tests go green.
 */
console.log("\n  a number that is not a time");
{
  const counts = parse("book four meetings", NOW);
  t('"book four meetings" is not a time', !counts.slots?.when, counts.slots?.when);

  const half = parse("cut the standup in half", NOW);
  t('"cut the standup in half" is not half past anything', !half.slots?.when, half.slots?.when);

  t('"block two hours" is a length, not two o\'clock', mins("block two hours") === 120);

  // Homophones corrected only where the neighbour makes the wrong reading
  // impossible, so ordinary uses of the same words are untouched.
  for (const s of ["we won the deal", "i ate lunch with bob", "book bob too"]) {
    t(`"${s}" survives the homophone pass`, parse(s, NOW).intent !== undefined);
  }
}

/* ---------------------------------------------------------- known, unfixed */
/**
 * Printed rather than asserted, so a run says out loud what is still wrong.
 * A bare trailing number is deliberately not read as a time — widening it
 * would break "book four meetings" — so this one is a real cost of a rule that
 * is right on balance.
 */
console.log("\n  known gaps, printed rather than asserted");
for (const s of ["move my three pm to four", "move my 3pm to 4"]) {
  const p = parse(s, NOW);
  console.log(`    "${s}" → ${p.intent}, destination time ${p.slots?.when ? "found" : "not found"}`);
}

console.log(`\nSpoken times: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
