/**
 * The two translation layers around the browser's speech engines.
 *
 * The engines themselves need a browser, so what is tested here is the part
 * that actually decides whether voice is usable: whether a reply written to be
 * read comes out sounding like English, and whether a dictated sentence
 * arrives in a shape the parser already understands. Both were the difference
 * between "the microphone works" and "I can book a meeting by talking".
 */
import {
  toSpeech, fromSpeech, voiceSettings, bestVoiceFor, inCharacter, temper,
  intoSentences, contourFor, speak, stopSpeaking,
} from "../src/lib/speech.js";
import { neuralReady, neuralSupported, neuralStatus } from "../src/lib/neural.js";
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

  t("half an hour is said as one, not as thirty minutes",
    /half an hour/.test(toSpeech("Booked 30m with Bob.")), toSpeech("Booked 30m with Bob."));
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
  // The house voice. Google's US English first — a neural voice rather than the
  // compact engine an operating system ships with — and Samantha everywhere it
  // is absent, which is every Apple device.
  t("the standard character is Samantha where Google's voice is absent",
    bestVoiceFor("natural")?.voiceURI === "samantha", bestVoiceFor("natural")?.name);
  t("and brisk is the same voice in a hurry",
    bestVoiceFor("brisk")?.voiceURI === "samantha", bestVoiceFor("brisk")?.name);

  const withGoogle = [
    { name: "Samantha", lang: "en-US", voiceURI: "samantha", localService: true },
    { name: "Samantha (Enhanced)", lang: "en-US", voiceURI: "samantha-x", localService: true },
    { name: "Google US English", lang: "en-US", voiceURI: "guse", localService: false },
  ];
  globalThis.speechSynthesis = { getVoices: () => withGoogle };
  t("but Google's is the standard wherever it exists",
    bestVoiceFor("natural")?.voiceURI === "guse", bestVoiceFor("natural")?.name);
  t("even against a downloaded Enhanced voice",
    bestVoiceFor("natural")?.name === "Google US English", bestVoiceFor("natural")?.name);
  // The whole point of the fallback: the best thing that needs no connection.
  t("and the offline fallback is the best local one, not silence",
    bestVoiceFor("natural", { localOnly: true })?.voiceURI === "samantha-x",
    bestVoiceFor("natural", { localOnly: true })?.name);

  // Ordered, not a set: with both installed, the first name wins.
  globalThis.speechSynthesis = {
    getVoices: () => [
      { name: "Ava", lang: "en-US", voiceURI: "ava", localService: true },
      { name: "Samantha", lang: "en-US", voiceURI: "samantha", localService: true },
    ],
  };
  t("Samantha outranks the other US voices whatever order the device lists them in",
    bestVoiceFor("natural")?.voiceURI === "samantha", bestVoiceFor("natural")?.name);
  // …but the engine matters more than the name.
  globalThis.speechSynthesis = {
    getVoices: () => [
      { name: "Ava (Premium)", lang: "en-US", voiceURI: "ava-p", localService: true },
      { name: "Samantha", lang: "en-US", voiceURI: "samantha", localService: true },
    ],
  };
  t("except where the alternative is a far better engine",
    bestVoiceFor("natural")?.voiceURI === "ava-p", bestVoiceFor("natural")?.name);

  globalThis.speechSynthesis = {
    getVoices: () => [{ name: "Anna", lang: "de-DE", voiceURI: "anna", localService: true }],
  };
  t("a device with nothing close defers to its own default",
    bestVoiceFor("natural") === null, bestVoiceFor("natural")?.name);

  globalThis.speechSynthesis = { getVoices: () => CATALOGUE };
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

  // Only the butler performs. The other two say exactly what is on screen —
  // the character picker chooses a voice and a pace, not a script.
  for (const p of ["natural", "brisk"]) {
    t(`${p} does not acknowledge before reporting`,
      !/^(Very good|Done|There we are|Of course)/.test(said("Booked 1h with Ronnie tomorrow at 11:00 AM.", p)),
      said("Booked 1h with Ronnie tomorrow at 11:00 AM.", p));
  }
  // The breath is not an affectation, so the standard voice gets it too: it is
  // one comma, and only in a sentence with no punctuation of its own.
  t("but the standard voice still breathes before a time",
    /Ronnie, tomorrow/.test(said("Booked 1h with Ronnie tomorrow at 11:00 AM.", "natural")),
    said("Booked 1h with Ronnie tomorrow at 11:00 AM.", "natural"));
  t("and brisk, which is meant to get out of the way, does not",
    !/Ronnie, tomorrow/.test(said("Booked 1h with Ronnie tomorrow at 11:00 AM.", "brisk")),
    said("Booked 1h with Ronnie tomorrow at 11:00 AM.", "brisk"));

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
  // Only the pitch. Rate and pitch fail differently on a compact engine:
  // playing back faster is what these voices are built for, resampling to a
  // different pitch is where the warble comes from. Easing both meant a
  // persona tuned to 0.97 arrived as 0.985 and did nothing at all.
  t("the rate is left alone, because rate is safe",
    temper({ rate: 0.95, pitch: 0.9 }, compact).rate === 0.95,
    temper({ rate: 0.95, pitch: 0.9 }, compact).rate);
  t("even a hard one", temper({ rate: 1.6, pitch: 1 }, compact).rate === 1.6);
  t("the system default, which cannot be inspected, is treated as compact",
    temper({ rate: 0.95, pitch: 0.9 }, null).pitch === 0.95);
  t("neutral stays neutral whatever the voice",
    temper({ rate: 1, pitch: 1 }, compact).pitch === 1 && temper({ rate: 1, pitch: 1 }, compact).rate === 1);
  t("the standard voice asks for no pitch shift, so nothing is eased away",
    temper({ rate: 0.97, pitch: 1 }, compact).rate === 0.97 &&
      temper({ rate: 0.97, pitch: 1 }, compact).pitch === 1);
}

/* --------------------------------------------------------------- durations
   A screen can carry "5h 30m". An ear hears a stopwatch reading. The half is
   the one fraction English has a word for, and it covers nearly everything
   this app produces. */
{
  const say = (t) => toSpeech(t);
  t("half hours are said the way people say them",
    say("5h 30m of focus time") === "5 and a half hours of focus time.", say("5h 30m of focus time"));
  t("and one and a half is an idiom of its own",
    /an hour and a half/.test(say("Board deck needs 1h 30m")), say("Board deck needs 1h 30m"));
  t("a bare half hour too", /half an hour/.test(say("30m with Bob")), say("30m with Bob"));
  t("but a length with no idiom is left alone",
    /2 hours 15 minutes/.test(say("2h 15m of work")), say("2h 15m of work"));
  t("and so is a plain count of minutes", /45 minutes/.test(say("45m free")), say("45m free"));
  t("nothing is said as nothing, not as zero minutes",
    /no meetings and no planned work/.test(say("0m of meetings and 0m of planned work")),
    say("0m of meetings and 0m of planned work"));
  t("an hour is still singular", /\b1 hour\b/.test(say("1h")), say("1h"));

  // A decimal hour is a spreadsheet talking. Nobody says "two point three
  // hours" about their own week, and the number was an estimate before it was
  // spoken — so it is rounded to the resolution people actually think in.
  t("a decimal hour is rounded to a half",
    /2 and a half hours/.test(say("2.3h of work")), say("2.3h of work"));
  t("and to a whole where that is nearer",
    /13 hours/.test(say("12.8h to spare")), say("12.8h to spare"));
  t("a half hour said as a decimal is still half an hour",
    /half an hour/.test(say("0.5h left")), say("0.5h left"));
  t("and one and a half keeps its idiom",
    /an hour and a half/.test(say("1.5h laid in")), say("1.5h laid in"));
  t("a whole number of hours is left exactly as it is",
    /25 hours a week/.test(say("25h a week")), say("25h a week"));

  // The right format to store and to sort, and unspeakable: "due 2026-08-14"
  // reads "two thousand twenty six dash zero eight dash fourteen".
  t("an ISO date is said as a date", /due August 14/.test(say("due 2026-08-14")), say("due 2026-08-14"));
  t("in any month", /December 1/.test(say("Due 2026-12-01.")), say("Due 2026-12-01."));
  t("with the year left off, because a deadline is always near",
    !/2026/.test(say("due 2026-08-14")), say("due 2026-08-14"));
  t("and a number that only looks like a date is left alone",
    /1234-99-99/.test(say("Code 1234-99-99")), say("Code 1234-99-99"));
}

/* ------------------------------------------------------------- long a day
   A screen and an ear are not the same instrument: eight meetings is a list
   you scan, and three quarters of a minute of times you cannot skim back
   through. */
{
  const day = (n) =>
    ["You have some meetings on Friday.", ""]
      .concat(Array.from({ length: n }, (_, i) => `Item ${i + 1} at ${i + 1} PM.`))
      .join("\n");

  const six = toSpeech(day(6));
  t("a day that fits is read in full", /Item 6/.test(six), six);
  t("with nothing tacked on the end", !/more\.$/.test(six), six);

  const nine = toSpeech(day(9));
  t("a day that does not is cut", !/Item 7/.test(nine), nine);
  t("after a generous number of them", /Item 6/.test(nine), nine);
  t("and says how many are left rather than pretending", /And 3 more\.$/.test(nine), nine);
  t("the headline is never counted as an item", /You have some meetings/.test(nine), nine);

  t("a short reply is untouched by any of it",
    toSpeech("Booked an hour.") === "Booked an hour.");
}

/* ------------------------------------------------------------------ ranges
   A dash is a pause in an aside and a word in a range, and reading the second
   as the first turned the list of free slots into disconnected times with no
   way to tell a start from an end. */
{
  const say = (t) => toSpeech(t);
  const open = say("Open time:\n8:00 AM–9:00 AM (1h)\n10:00 AM–2:00 PM (4h)");
  t("a time range is spoken as a range", /8 AM to 9 AM/.test(open), open);
  t("not as two separate times", !/8 AM, 9 AM/.test(open), open);
  t("and the length beside it is an aside, not a bracket",
    /9 AM, 1 hour/.test(open), open);

  const hours = say("You work 8:00 AM to 7:00 PM, Mon–Fri, with 5h a day.");
  t("a day range is spoken as one too", /Monday to Friday/.test(hours), hours);
  t("a lone weekday abbreviation is said as the day",
    /Saturday/.test(say("Nothing on Sat.")), say("Nothing on Sat."));
  t("an em-dash aside is still a pause",
    /Wide open, no meetings/.test(say("Wide open — 0m of meetings")), say("Wide open — 0m of meetings"));
}

/* --------------------------------------------------------------- delivery II
   The flattest thing about browser speech is that an utterance carries one
   pitch from start to finish. A reply is queued a sentence at a time so it can
   move — which is only safe if the cuts land where a speaker would stop. */
{
  const parts = intoSentences("Very good, Mr. Newman. Booked an hour with Ronnie.");
  t("a sentence split does not tear a name in half",
    parts.length === 2 && parts[0] === "Very good, Mr. Newman.", JSON.stringify(parts));
  t("nor a doctor", intoSentences("Ask Dr. Patel. Then call Bob.").length === 2,
    JSON.stringify(intoSentences("Ask Dr. Patel. Then call Bob.")));
  t("a question is its own sentence",
    intoSentences("Move it to when? Give me a day.").length === 2);
  t("one sentence stays one", intoSentences("Booked an hour.").length === 1);
  t("nothing in, nothing out", intoSentences("").length === 0 && intoSentences(null).length === 0);

  const base = { rate: 0.95, pitch: 0.9 };
  t("the voice drifts down across a list", contourFor(3, base).pitch < contourFor(0, base).pitch);
  t("and picks up a little speed", contourFor(3, base).rate > contourFor(0, base).rate);
  t("the first sentence is the persona as written",
    contourFor(0, base).pitch === 0.9 && contourFor(0, base).rate === 0.95);
  t("and the drift is floored, not endless",
    contourFor(40, base).pitch === contourFor(4, base).pitch, contourFor(40, base).pitch);
  t("staying well inside a natural range",
    contourFor(40, base).pitch > 0.85 && contourFor(40, base).rate < 1.05,
    JSON.stringify(contourFor(40, base)));
}

/* -------------------------------------------------------- finishing exactly once
   Hands-free reopens the microphone when she finishes. A reply queued as five
   utterances must therefore report finishing once, at the end — and a reply
   that was interrupted must not report finishing at all, or the microphone
   opens on behalf of an answer nobody heard the end of. */
{
  const queue = [];
  globalThis.SpeechSynthesisUtterance = function (text) { this.text = text; };
  globalThis.speechSynthesis = {
    speaking: false, pending: false,
    getVoices: () => [{ name: "Daniel", lang: "en-GB", voiceURI: "daniel", localService: true }],
    speak(u) { queue.push(u); },
    cancel() { queue.length = 0; },
  };

  let ends = 0, starts = 0;
  speak("You have three meetings on Friday.\nAt 9:00 AM you have Exec staff.\nAt 3:00 PM you have Board call.", {
    voiceURI: "daniel", rate: 0.95, pitch: 0.9,
    onStart: () => starts++, onEnd: () => ends++,
  });
  t("a multi-sentence reply is queued as several utterances", queue.length === 3, queue.length);
  t("each with its own pitch", queue[0].pitch !== queue[2].pitch, `${queue[0].pitch} / ${queue[2].pitch}`);
  t("all on the chosen voice", queue.every((u) => u.voice?.voiceURI === "daniel"));

  queue[0].onstart?.();
  t("it starts once, on the first", starts === 1, starts);
  queue[0].onend?.();
  queue[1].onend?.();
  t("and does not report finishing part-way", ends === 0, ends);
  queue[2].onend?.();
  t("only at the end", ends === 1, ends);
  queue[2].onend?.();
  t("and only once, however often the engine says so", ends === 1, ends);

  // Interrupted: she is cut off, and the caller must not be told she finished.
  let ends2 = 0;
  speak("A long answer. In several parts. Like this one.", {
    voiceURI: "daniel", onEnd: () => ends2++,
  });
  t("a new reply replaces the last one rather than queueing behind it",
    queue.every((u) => !/Exec staff/.test(u.text)), queue.map((u) => u.text).join(" | "));
  const live = [...queue];
  stopSpeaking();
  live.at(-1).onend?.();
  t("a cancelled reply never reports finishing", ends2 === 0, ends2);

  delete globalThis.speechSynthesis;
  delete globalThis.SpeechSynthesisUtterance;
}

/* ------------------------------------------------------------ losing the wifi
   The house voice is synthesised on Google's servers, so the ordinary reason it
   fails is a train or a lift. Going quiet at exactly that moment is the worst
   possible reading of "works offline": everything else in the app carries on
   without a network and only the talking stops, with no indication why. */
{
  const spoken = [];
  globalThis.SpeechSynthesisUtterance = function (text) { this.text = text; };
  globalThis.speechSynthesis = {
    speaking: false, pending: false,
    getVoices: () => [
      { name: "Google US English", lang: "en-US", voiceURI: "guse", localService: false },
      { name: "Samantha", lang: "en-US", voiceURI: "samantha", localService: true },
    ],
    speak(u) { spoken.push(u); },
    cancel() { spoken.length = 0; },
  };

  let ends = 0;
  speak("Booked an hour with Ronnie.", {
    voiceURI: "guse", persona: "natural", onEnd: () => ends++,
  });
  t("she starts on the network voice", spoken[0]?.voice?.voiceURI === "guse",
    spoken[0]?.voice?.name);

  // The connection drops.
  spoken[0].onerror();
  t("a network failure is retried rather than swallowed", spoken.length === 1, spoken.length);
  t("on a voice that needs no connection",
    spoken[0]?.voice?.localService === true, spoken[0]?.voice?.name);
  t("saying the same thing", /Ronnie/.test(spoken[0]?.text || ""), spoken[0]?.text);
  t("and the caller has not been told it finished", ends === 0, ends);

  spoken[0].onend?.();
  t("only once the fallback has actually finished", ends === 1, ends);

  // The fallback is local, so a failure there is the end of it — no loop.
  const before = spoken.length;
  spoken[0].onerror?.();
  t("a local voice failing does not retry for ever", spoken.length <= before, spoken.length);

  // With nothing local to fall back to, it still has to release the caller or
  // hands-free waits for a voice that already failed.
  globalThis.speechSynthesis.getVoices = () => [
    { name: "Google US English", lang: "en-US", voiceURI: "guse", localService: false },
  ];
  let ends2 = 0;
  speak("Booked an hour.", { voiceURI: "guse", persona: "natural", onEnd: () => ends2++ });
  spoken[0].onerror();
  t("with nothing to fall back to, it gives up rather than hanging", ends2 === 1, ends2);

  delete globalThis.speechSynthesis;
  delete globalThis.SpeechSynthesisUtterance;
}

/* ------------------------------------------------------- the downloaded voice
   An optional model that has to be fetched before it can say anything, which
   makes "what happens when it hasn't been, or has stopped working" the only
   part of it worth defending in a unit test. The answer is always the same:
   the device voice speaks instead. Nobody should discover that a *better*
   voice was installed by the app going silent. */
{
  t("nothing is downloaded until somebody asks", neuralReady() === false);
  t("and a plain Node process is not somewhere it can run",
    neuralSupported() === false, neuralSupported());
  t("its status starts idle rather than failed",
    neuralStatus().state === "idle", JSON.stringify(neuralStatus()));

  t("the setting defaults to the device voice", voiceSettings({}).neuralVoice === null);
  t("and carries a chosen one through",
    voiceSettings({ voice: { neuralVoice: "af_heart" } }).neuralVoice === "af_heart");

  // The fallback, which is the whole contract.
  const queue = [];
  globalThis.SpeechSynthesisUtterance = function (text) { this.text = text; };
  globalThis.speechSynthesis = {
    speaking: false, pending: false,
    getVoices: () => [{ name: "Samantha", lang: "en-US", voiceURI: "sam", localService: true }],
    speak(u) { queue.push(u); },
    cancel() { queue.length = 0; },
  };

  let ends = 0;
  speak("Booked an hour with Ronnie.", {
    voiceURI: "sam", neuralVoice: "af_heart", onEnd: () => ends++,
  });
  t("asking for a voice that was never downloaded still speaks",
    queue.length === 1, queue.length);
  t("on the device voice", queue[0]?.voice?.voiceURI === "sam", queue[0]?.voice?.name);
  t("saying the same thing", /Ronnie/.test(queue[0]?.text || ""), queue[0]?.text);
  queue[0].onend?.();
  t("and finishing normally", ends === 1, ends);

  // Stopping has to reach both engines, since the caller has no idea which one
  // is speaking.
  stopSpeaking();
  t("stopping clears the device queue", queue.length === 0, queue.length);
  t("and leaves the model in a usable state", neuralStatus().state === "idle");

  delete globalThis.speechSynthesis;
  delete globalThis.SpeechSynthesisUtterance;
}

console.log(`\nSpeech: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
