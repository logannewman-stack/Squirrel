/**
 * The two translation layers around the browser's speech engines.
 *
 * The engines themselves need a browser, so what is tested here is the part
 * that actually decides whether voice is usable: whether a reply written to be
 * read comes out sounding like English, and whether a dictated sentence
 * arrives in a shape the parser already understands. Both were the difference
 * between "the microphone works" and "I can book a meeting by talking".
 */
import { toSpeech, fromSpeech, voiceSettings, bestVoiceFor, inCharacter, temper } from "../src/lib/speech.js";
import { parse } from "../src/lib/nlu/parse.js";

let pass = 0, fail = 0;
const failures = [];
const t = (name, ok, detail) => {
  if (ok) pass++;
  else { fail++; failures.push(name); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

// ------------------------------------------------------------------ speaking
{
  const said = toSpeech("Booked 1h with Ronnie tomorrow at 11:00 AM.");
  t("a duration is spoken, not spelled", /1 hour/.test(said), said);

  t("half an hour reads as minutes",
    /30 minutes/.test(toSpeech("Booked 30m with Bob.")), toSpeech("Booked 30m with Bob."));
  t("an hour and a half too",
    /2 hours 15 minutes/.test(toSpeech("2h 15m of work")), toSpeech("2h 15m of work"));
  t("one hour is singular", /\b1 hour\b/.test(toSpeech("1h")) , toSpeech("1h"));

  const day = toSpeech("You have three meetings on Friday.\n\nAt 9:00 AM you have Exec staff.\nAt 3:00 PM you're meeting with Bob.");
  t("each line becomes its own sentence",
    (day.match(/\./g) || []).length >= 3, day);
  t("and the blank line does not become a pause of nothing",
    !/\s\s/.test(day), JSON.stringify(day));

  t("bullets are dropped, not read",
    !/[•·]/.test(toSpeech("• Added “Board prep”\n• Moved the 3pm")), toSpeech("• Added “Board prep”"));
  t("smart quotes are not read aloud",
    !/[“”]/.test(toSpeech("Cancelled “Exec staff”.")), toSpeech("Cancelled “Exec staff”."));
  t("an em dash becomes a breath",
    /,/.test(toSpeech("Friday — 3 meetings")), toSpeech("Friday — 3 meetings"));
  t("a 1:1 is not read as a ratio",
    /one to one/.test(toSpeech("1:1 with Dana")), toSpeech("1:1 with Dana"));
  t("the warning glyph becomes a word",
    /Careful/.test(toSpeech("⚠ Board deck needs 8h")), toSpeech("⚠ Board deck needs 8h"));
  t("empty in, empty out", toSpeech("") === "" && toSpeech(null) === "");
}

// ----------------------------------------------------------------- listening
/**
 * Every case is a sentence a recogniser actually returns, checked twice: that
 * it normalises, and that the parser then extracts the right time from it.
 */
const HEARD = [
  ["book bob at three thirty p m friday", "3:30", { h: 15, m: 30 }],
  ["schedule a call at three p m", "3pm", { h: 15, m: 0 }],
  ["put a meeting with ronnie at eleven", "at 11", { h: 11, m: 0 }],
  ["book the review at three o'clock friday", "3 o'clock", { h: 15, m: 0 }],
  ["book lunch at half past twelve", "12:30", { h: 12, m: 30 }],
  ["meeting at a quarter past nine", "9:15", { h: 9, m: 15 }],
  ["call bob at quarter to four", "3:45", { h: 15, m: 45 }],
  ["schedule it for two thirty pm", "2:30", { h: 14, m: 30 }],
  ["book bob at 3 pm", "3pm", { h: 15, m: 0 }],
];
for (const [heard, contains, time] of HEARD) {
  const typed = fromSpeech(heard);
  t(`heard: “${heard}”`, typed.includes(contains), typed);
  const p = parse(typed, new Date(2026, 7, 5, 9, 0));
  t(`  → parses to ${time.h}:${String(time.m).padStart(2, "0")}`,
    p.slots.timeOnly?.h === time.h && p.slots.timeOnly?.m === time.m,
    `${typed} → ${JSON.stringify(p.slots.timeOnly)}`);
}

// Things that merely look like times and must be left alone.
{
  t("a duration is not turned into a clock time",
    fromSpeech("book thirty minutes with bob") === "book thirty minutes with bob",
    fromSpeech("book thirty minutes with bob"));
  t("and still parses as one",
    parse(fromSpeech("book thirty minutes with bob"), new Date()).slots.durationMins === 30,
    parse(fromSpeech("book thirty minutes with bob"), new Date()).slots.durationMins);
  t("a couple of hours survives",
    parse(fromSpeech("a couple of hours on the deck"), new Date()).slots.durationMins === 120);
  t("a name that sounds like a number is left alone",
    fromSpeech("cancel the meeting with seven seas") === "cancel the meeting with seven seas",
    fromSpeech("cancel the meeting with seven seas"));
  t("the recogniser's trailing full stop goes",
    fromSpeech("what does friday look like.") === "what does friday look like",
    fromSpeech("what does friday look like."));
  t("one on one becomes the shorthand the parser knows",
    fromSpeech("book a one on one with sarah") === "book a 1:1 with sarah",
    fromSpeech("book a one on one with sarah"));
  t("spoken punctuation is punctuation",
    fromSpeech("add a task comma high priority").includes(","),
    fromSpeech("add a task comma high priority"));
}

// In a move the two halves mean different things, and dictation must not blur
// them: the hour said first is the meeting being moved, not where it is going.
{
  const p = parse(fromSpeech("move my three o'clock to friday"), new Date(2026, 7, 5, 9));
  t("a dictated move is a move", p.intent === "move_event", p.intent);
  t("the spoken hour identifies which meeting", /3 o'clock/.test(p.slots.subjectPhrase), p.slots.subjectPhrase);
  t("and the target is the day, keeping the hour it already had",
    p.slots.when?.getDay() === 5 && p.slots.timeOnly === null,
    `${p.slots.when} / ${JSON.stringify(p.slots.timeOnly)}`);
}

// A dictated command has to survive the whole round trip, not just the clock.
{
  const p = parse(fromSpeech("cancel my meeting for friday at one and reschedule it for saturday at two"), new Date(2026, 7, 5, 9));
  t("a dictated compound is still one move", p.intent === "move_event", p.intent);
  t("landing on the day said second", p.slots.when?.getDay() === 6, p.slots.when?.toString());
}
{
  const p = parse(fromSpeech("clear my calendar for this week"), new Date(2026, 7, 5, 9));
  t("a dictated clear is still a clear", p.intent === "clear_range", p.intent);
}

/* ------------------------------------------------------------------ personas
   The defaults decide whether anybody ever hears the assistant at all, so they
   are worth pinning down: speaking is on in the installed app and off in a
   browser tab, and a choice already made always beats both. */
{
  // A catalogue in the shape a device returns one, deliberately opening with a
  // novelty voice so "first in the list" would be visibly wrong.
  const CATALOGUE = [
    { name: "Albert", lang: "en-US", voiceURI: "albert", localService: true },
    { name: "Samantha", lang: "en-US", voiceURI: "samantha", localService: true },
    { name: "Daniel", lang: "en-GB", voiceURI: "daniel", localService: true },
    { name: "Kate", lang: "en-GB", voiceURI: "kate", localService: true },
    { name: "Google UK English Male", lang: "en-GB", voiceURI: "guk", localService: false },
  ];
  globalThis.speechSynthesis = { getVoices: () => CATALOGUE };
  globalThis.SpeechSynthesisUtterance = function () {};

  t("the butler finds the English male voice", bestVoiceFor("butler")?.voiceURI === "daniel",
    bestVoiceFor("butler")?.name);

  globalThis.speechSynthesis = {
    getVoices: () => [...CATALOGUE, { name: "Daniel (Enhanced)", lang: "en-GB", voiceURI: "daniel-x", localService: true }],
  };
  t("and prefers the downloaded high-quality one", bestVoiceFor("butler")?.voiceURI === "daniel-x",
    bestVoiceFor("butler")?.name);

  globalThis.speechSynthesis = { getVoices: () => CATALOGUE };
  t("a persona with no preference defers to the device", bestVoiceFor("natural") === null,
    bestVoiceFor("natural")?.name);
  t("an unknown persona does not throw", bestVoiceFor("jarvis") === null);

  // Defaults.
  delete globalThis.__SQUIRREL_NATIVE__;
  t("a browser tab does not start talking at you", voiceSettings({}).speak === false);
  globalThis.__SQUIRREL_NATIVE__ = true;
  t("an installed app answers out loud", voiceSettings({}).speak === true);
  t("but a person who turned it off stays off",
    voiceSettings({ voice: { speak: false } }).speak === false);
  t("hands-free is never assumed", voiceSettings({}).handsFree === false);

  // Personas carry the delivery, not just the voice.
  const butler = voiceSettings({ voice: { persona: "butler" } });
  t("the butler is slower than default", butler.rate < 1, butler.rate);
  t("and pitched lower", butler.pitch < 1, butler.pitch);
  t("and reaches for its own voice", butler.voiceURI === "daniel", butler.voiceURI);
  t("brisk is quicker", voiceSettings({ voice: { persona: "brisk" } }).rate > 1);

  // A slider moved by hand outranks the persona that suggested it.
  t("a hand-set rate wins",
    voiceSettings({ voice: { persona: "butler", rate: 1.4 } }).rate === 1.4);
  t("a hand-picked voice wins",
    voiceSettings({ voice: { persona: "butler", voiceURI: "samantha" } }).voiceURI === "samantha");
  t("a nonsense persona falls back rather than breaking",
    voiceSettings({ voice: { persona: "nope" } }).persona === "natural");

  delete globalThis.__SQUIRREL_NATIVE__;
  delete globalThis.speechSynthesis;
  delete globalThis.SpeechSynthesisUtterance;
  t("with no engine at all there is still a settings object",
    voiceSettings({}).voiceURI === null && voiceSettings({}).speak === false);
}

/* ----------------------------------------------------------------- delivery
   The only part of "pace" the browser actually exposes. An utterance has one
   rate for the whole sentence — no SSML, no pause tag — so the pauses have to
   be written into the text as punctuation, and that makes them testable. */
{
  const said = (t, p = "butler", who = "Mr. Newman") => inCharacter(toSpeech(t), p, who);

  const booked = said("Booked 1h with Ronnie tomorrow at 11:00 AM.");
  t("the butler acknowledges before reporting", /^Very good|^Done|^There we are|^Of course/.test(booked), booked);
  t("using the name they chose", /Mr\. Newman/.test(booked), booked);
  t("and takes a breath before the time",
    /Ronnie, tomorrow/.test(booked), booked);
  t("without chopping it into a list",
    (booked.match(/,/g) || []).length <= 2, booked);

  // A question cannot be acknowledged — "Very good. What does Friday look
  // like" is nonsense, and it is the tic that gets a voice switched off.
  const asked = said("What does Friday look like?");
  t("a question gets no acknowledgement", !/^Very good|^Done|^There we are|^Of course/.test(asked), asked);
  const listed = said("You have three meetings on Friday.");
  t("nor does an answer", !/^Very good|^Done|^There we are|^Of course/.test(listed), listed);

  t("the same reply always opens the same way",
    said("Moved the standup to 10:00 AM.") === said("Moved the standup to 10:00 AM."));
  t("but two different ones usually do not",
    new Set(["Booked a call.", "Added the deck.", "Moved the standup.", "Cleared Friday."]
      .map((x) => said(x).split(",")[0])).size > 1);

  // The other two characters leave the words alone: the persona is a choice
  // about how she sounds, not a licence to rewrite what she says.
  for (const p of ["natural", "brisk"]) {
    t(`${p} does not add an opener`,
      said("Booked 1h with Ronnie tomorrow at 11:00 AM.", p) === toSpeech("Booked 1h with Ronnie tomorrow at 11:00 AM."),
      said("Booked 1h with Ronnie tomorrow at 11:00 AM.", p));
  }

  t("no name, no comma left dangling",
    !/^\w+, \./.test(said("Booked a call tomorrow at 2:00 PM.", "butler", "")),
    said("Booked a call tomorrow at 2:00 PM.", "butler", ""));
  t("empty in, empty out", inCharacter("", "butler", "Mr. Newman") === "");
  t("an unknown persona is inert, not broken",
    inCharacter("Booked a call.", "jarvis", "sir") === "Booked a call.");

  // A gag voice is never the answer, however local it is.
  globalThis.speechSynthesis = {
    getVoices: () => [
      { name: "Albert", lang: "en-GB", voiceURI: "albert", localService: true },
      { name: "Zarvox", lang: "en-GB", voiceURI: "zarvox", localService: true },
      { name: "Google UK English Male", lang: "en-GB", voiceURI: "guk", localService: false },
    ],
  };
  globalThis.SpeechSynthesisUtterance = function () {};
  t("novelty voices are not offered a calendar to read",
    bestVoiceFor("butler")?.voiceURI === "guk", bestVoiceFor("butler")?.name);

  globalThis.speechSynthesis = {
    getVoices: () => [{ name: "Albert", lang: "en-GB", voiceURI: "albert", localService: true }],
  };
  t("and if a gag is all there is, the device decides instead",
    bestVoiceFor("butler") === null, bestVoiceFor("butler")?.name);

  delete globalThis.speechSynthesis;
  delete globalThis.SpeechSynthesisUtterance;
}

/* ------------------------------------------------------- clarity out loud
   The two complaints that matter — "robotic" and "choppy" — are both things
   that can be measured on the text before it ever reaches an engine. */
{
  const say = (t) => toSpeech(t);

  // The single worst thing a synthesiser did to this app: every confirmation
  // she gave contained a time, and every time was read "eleven colon zero
  // zero A M".
  t("o'clock times lose the zeroes", say("Booked at 11:00 AM.") === "Booked at 11 AM.", say("Booked at 11:00 AM."));
  t("and so do the afternoon ones", say("Moved to 3:00 PM.") === "Moved to 3 PM.", say("Moved to 3:00 PM."));
  t("half past keeps its digits", /12:30 PM/.test(say("Lunch at 12:30 PM.")), say("Lunch at 12:30 PM."));
  t("a bare hour with no meridiem is still said",
    /10 o'clock/.test(say("Starts at 10:00.")), say("Starts at 10:00."));
  t("and a one to one is not mistaken for a time",
    /one to one/.test(say("1:1 with Dana")), say("1:1 with Dana"));

  // A label colon is silent in some engines and a full stop in others.
  t("a label colon becomes the pause it meant",
    /Thursday, 2 PM/.test(say("Thursday: 2:00 PM Call with Priya.")),
    say("Thursday: 2:00 PM Call with Priya."));

  /**
   * Choppiness, measured. The first attempt at "measured delivery" inserted a
   * breath into sentences that were already punctuated, and turned a
   * confirmation into seven pauses in sixteen words — a stammer, not a butler.
   */
  const pauses = (s) => (s.match(/[,;:]/g) || []).length;
  const confirm = inCharacter(
    say("Okay, Mr. Newman — just to confirm: a 1h call with Priya, Thursday at 2:00 PM?"),
    "butler", "Mr. Newman",
  );
  t("an already-punctuated sentence gets no extra breath",
    pauses(confirm) <= 4, `${pauses(confirm)} — ${confirm}`);
  t("but a run-on still gets one",
    /Ronnie, tomorrow/.test(inCharacter(say("Booked 1h with Ronnie tomorrow at 11:00 AM."), "butler", "")),
    inCharacter(say("Booked 1h with Ronnie tomorrow at 11:00 AM."), "butler", ""));

  // No reply should be pausing more often than every three words or so.
  for (const line of [
    "Booked 1h with Ronnie tomorrow at 11:00 AM.",
    "Moved “Exec staff” to 10:00 AM · 1h.",
    "Cleared Friday afternoon — 3 meetings removed.",
    "You have three meetings on Friday.\n\nAt 9:00 AM you have Exec staff.\nAt 3:00 PM you're meeting with Bob.",
  ]) {
    const s = inCharacter(say(line), "butler", "Mr. Newman");
    const words = s.split(/\s+/).length;
    t(`“${line.split("\n")[0].slice(0, 28)}…” is not a stammer`,
      pauses(s) * 3 <= words, `${pauses(s)} pauses / ${words} words — ${s}`);
  }
}

/* ----------------------------------------------------------------- temper
   A pitch shift is not free. The good engines resynthesise; the compact ones
   that ship by default resample, and warble. */
{
  const good = { name: "Daniel (Enhanced)" };
  const compact = { name: "Daniel" };

  t("a high-quality voice gets the persona as written",
    temper({ rate: 0.95, pitch: 0.9 }, good).pitch === 0.9);
  t("a compact one gets half the shift",
    temper({ rate: 0.95, pitch: 0.9 }, compact).pitch === 0.95,
    temper({ rate: 0.95, pitch: 0.9 }, compact).pitch);
  t("and the rate is eased with it",
    temper({ rate: 0.95, pitch: 0.9 }, compact).rate === 0.975);
  t("the system default, which cannot be inspected, is treated as compact",
    temper({ rate: 0.95, pitch: 0.9 }, null).pitch === 0.95);
  t("neutral stays neutral whatever the voice",
    temper({ rate: 1, pitch: 1 }, compact).pitch === 1 && temper({ rate: 1, pitch: 1 }, compact).rate === 1);
  t("a hand-cranked pitch is still eased rather than ignored",
    temper({ rate: 1.6, pitch: 1 }, compact).rate === 1.3);
}

console.log(`\nSpeech: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
