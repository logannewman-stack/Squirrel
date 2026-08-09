/**
 * Talking, and being talked to.
 *
 * Both halves run on the device's own engines — `speechSynthesis` and
 * `SpeechRecognition` — which keeps them consistent with the rest of the
 * assistant: no API key, no per-message cost, nothing sent anywhere. The
 * trade is that recognition is Chrome and Safari only, so every entry point
 * here reports whether it is available and the interface hides what is not.
 *
 * The interesting work is not the API calls, which are four lines each. It is
 * the two translation layers around them:
 *
 *   toSpeech   Prose written to be *read* sounds wrong spoken. "• 1:1 with
 *              Dana — 1h 30m" is a fine line on screen and gibberish aloud.
 *   fromSpeech Recognition returns unpunctuated lowercase words. "book bob at
 *              three thirty p m" has to become something the parser already
 *              understands, or dictation fails on the one slot every command
 *              carries.
 *
 * Without those two, both halves technically work and neither is usable.
 */

export const canSpeak = () =>
  typeof globalThis.speechSynthesis !== "undefined" && typeof globalThis.SpeechSynthesisUtterance !== "undefined";

const Recognition = () => globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;

export const canListen = () => Boolean(Recognition());

/* ------------------------------------------------------------------ speaking */

/** Symbols and shorthand that are read aloud badly, or not at all. */
const SAY = [
  [/[\u201C\u201D]/g, ""],
  [/[\u2018\u2019]/g, "'"],
  [/^[•·]\s*/gm, ""],
  [/\s*[—–]\s*/g, ", "],
  [/\s*·\s*/g, ", "],
  [/⚠\s*/g, "Careful. "],
  [/\b1:1\b/gi, "one to one"],
  [/\bQ(\d)\b/g, "quarter $1"],
  [/\bEOD\b/gi, "end of day"],
  [/\bCOB\b/gi, "close of business"],
  [/\bASAP\b/gi, "as soon as possible"],
  [/\bQBR\b/gi, "Q B R"],
  // Durations. "1h 30m" is compact to read and unpronounceable.
  [/\b(\d+)h\s*(\d+)m\b/g, (_, h, m) => `${h} ${plural(h, "hour")} ${m} minutes`],
  [/\b(\d+(?:\.\d+)?)h\b/g, (_, h) => `${h} ${plural(h, "hour")}`],
  [/\b(\d+)m\b/g, (_, m) => `${m} ${plural(m, "minute")}`],
  [/\b(\d+)\s*mins?\b/gi, (_, m) => `${m} ${plural(m, "minute")}`],
  // A trailing colon introduces a list; a pause reads better than the word.
  [/:\s*\n/g, ". "],

  /* ---------------------------------------------------------------- o'clock
     The single worst thing a synthesiser does to this app. "11:00 AM" is read
     "eleven colon zero zero A M" or "eleven hundred hours" depending on the
     engine, and every confirmation she gives contains one — which is most of
     what made her sound like a machine reading a table. Nobody says the
     zeroes. Half past is fine as digits: engines say "2:30" as "two thirty".
     Done after the durations, so "1h" has already stopped looking like an
     hour on a clock. */
  [/\b(\d{1,2}):00(?=\s*(?:AM|PM|am|pm)\b)/g, "$1"],
  [/\b(\d{1,2}):00\b(?!\s*(?:AM|PM|am|pm))/g, "$1 o'clock"],

  /* A colon between a label and its contents — "Thursday: 2 PM Call with
     Priya" — is silent in some engines and a long stop in others. A comma is
     the pause that was meant. Times are already safe: they have no space after
     the colon, and the ones that did have just lost it above. */
  [/:\s+/g, ", "],
];

const plural = (n, word) => (Number(n) === 1 ? word : `${word}s`);

/**
 * A reply, as it should sound.
 *
 * Line breaks become sentence ends rather than pauses, because a synthesiser
 * runs straight through a newline and a five-meeting day comes out as one
 * unbroken sentence forty words long.
 */
export function toSpeech(text) {
  let out = String(text ?? "");
  for (const [re, to] of SAY) out = out.replace(re, to);
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (/[.!?]$/.test(line) ? line : `${line}.`))
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .replace(/,\s*\./g, ".")
    .trim();
}

let current = null;

/** Voices worth offering: this page's language, best quality first. */
export function voices() {
  if (!canSpeak()) return [];
  const lang = (globalThis.navigator?.language || "en-US").slice(0, 2);
  return speechSynthesis
    .getVoices()
    .filter((v) => v.lang.slice(0, 2) === lang)
    .sort((a, b) => Number(b.localService) - Number(a.localService) || a.name.localeCompare(b.name));
}

/**
 * Chrome populates the voice list asynchronously and returns an empty array on
 * the first call. Anything reading it at mount sees nothing and concludes the
 * device cannot speak.
 */
export function onVoicesReady(fn) {
  if (!canSpeak()) return () => {};
  const handler = () => fn(voices());
  speechSynthesis.addEventListener("voiceschanged", handler);
  if (speechSynthesis.getVoices().length) fn(voices());
  return () => speechSynthesis.removeEventListener("voiceschanged", handler);
}

/* ---------------------------------------------------------------- personas
   How she sounds, as a small set of choices rather than three sliders.
   Nobody wants to tune a pitch value; people want "the calm British one".

   A word on the obvious request. The voice from the films is a specific
   performer, and cloning a real person's voice is their right to license, not
   ours to take — so this does not attempt it and never will. What it does
   instead is the part that actually carries the character: an English male
   voice, measured rather than brisk, pitched a little low, addressing you by
   title. Most of what people recognise in that assistant is diction and
   manner, and diction and manner are ours to write.
   ------------------------------------------------------------------------ */

export const PERSONAS = {
  natural: {
    id: "natural",
    name: "Natural",
    blurb: "Whatever your device does best.",
    prefer: { lang: null, names: [] },
    rate: 1,
    pitch: 1,
    breath: false,
    openers: [],
  },
  butler: {
    id: "butler",
    name: "The butler",
    blurb: "English, unhurried, understated. Acknowledges before it reports.",
    // Daniel is the long-standing en-GB male voice on Apple platforms; Arthur
    // and Oliver are the newer ones, Google UK English Male the Chrome one.
    // Named rather than guessed at, because "pick a male voice" is not
    // something the API will answer.
    prefer: {
      lang: "en-GB",
      names: ["daniel", "arthur", "oliver", "graham", "jamie", "george", "uk english male"],
    },
    // Lower, and only a little slower. Dragging the rate down further is the
    // obvious move and the wrong one — a uniformly slowed voice sounds sedated,
    // not considered. The measured quality comes from `breath` below, which
    // puts the pauses where a person would take them and leaves the words
    // themselves at close to ordinary speed.
    //
    // The pitch is a request, not a promise: `temper` below pulls it back on a
    // voice that cannot take the shift without warbling.
    rate: 0.95,
    pitch: 0.9,
    breath: true,
    // Said before the report, the way somebody who has already done the thing
    // answers. Rotated by content rather than at random so a given reply always
    // sounds the same, and two different replies rarely open alike.
    openers: ["Very good", "Done", "There we are", "Of course"],
  },
  brisk: {
    id: "brisk",
    name: "Brisk",
    blurb: "Quick and out of the way.",
    prefer: { lang: null, names: [] },
    rate: 1.15,
    pitch: 1,
    breath: false,
    openers: [],
  },
};

/**
 * Voices that exist to be jokes.
 *
 * macOS ships a shelf of them — Albert, Bubbles, Jester, Zarvox — and they are
 * ordinary local voices as far as the API is concerned, so a scoring pass that
 * rewards "installed on this device" will cheerfully hand somebody Bad News to
 * read their calendar in. Named rather than detected, because there is no flag
 * for "this one is a gag".
 */
const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|jester|junior|kathy|organ|princess|ralph|superstar|trinoids|whisper|wobble|zarvox|hysterical|bruce|fred\b/i;

/** Engines worth reaching for when a device has more than one tier installed. */
const PREMIUM = /premium|enhanced|neural|siri|natural/i;

/**
 * Where a measured speaker would take a breath.
 *
 * This is the whole of "pace" that the browser actually gives us. A
 * `SpeechSynthesisUtterance` has one rate for the entire sentence — no SSML, no
 * per-word timing, no pause tag — so the only way to make delivery uneven,
 * which is what makes it sound like speech rather than a readout, is to put the
 * pauses into the text as punctuation. Every engine honours a comma.
 *
 * One comma, before the first time reference in the tail, and **only in a
 * sentence that has none of its own**. That guard is the entire lesson from the
 * first attempt at this: without it, "a 1 hour call with Priya, Thursday at 2
 * PM" — already punctuated — became "…with Priya, Thursday, at 2 PM", and a
 * confirmation ended up with seven pauses in sixteen words. That is not
 * measured, it is a stammer. A sentence that already has commas already has
 * somewhere to breathe; this exists for the run-ons that do not.
 */
const breathe = (text) =>
  text.includes(",")
    ? text
    : text.replace(/(\w)\s+((?:tomorrow|today|tonight)\b|at \d{1,2}(?::\d{2})?\b)/i, "$1, $2");

/**
 * Which opener this reply gets, or none.
 *
 * Chosen from the text rather than at random, so a given reply always sounds
 * the same — a voice that says something different each time you ask the same
 * question sounds broken rather than lively.
 *
 * The extra slot is silence, and it is the important one. Four openers rotating
 * is variety within a sentence and still a drumbeat across a session: three
 * commands in a row would each be answered "Very good, Mr. Newman. …". Somebody
 * who has already acknowledged you twice does not do it a third time.
 */
const pickOpener = (openers, text) => {
  if (!openers.length) return null;
  let n = 0;
  for (let i = 0; i < text.length; i++) n = (n * 31 + text.charCodeAt(i)) >>> 0;
  const slot = n % (openers.length + 1);
  return slot < openers.length ? openers[slot] : null;
};

/**
 * Replies that are reports of something already done, and so can be
 * acknowledged before they are read. A question or a list cannot: "Very good.
 * What does Friday look like" is nonsense, and prefixing an answer with a
 * confirmation is the kind of tic that gets a voice turned off in a week.
 */
const REPORTS_AN_ACTION =
  /^(booked|added|moved|cancelled|canceled|cleared|marked|removed|rescheduled|shortened|extended|handed|put|scheduled|set|updated|delegated|renamed)\b/i;

/**
 * A reply, in this persona's voice.
 *
 * Spoken only. The text on screen is unchanged, deliberately: the persona is a
 * choice about how she sounds, and rewriting the visible reply to match would
 * make a voice setting quietly edit the app.
 */
export function inCharacter(text, personaId, address = "") {
  const persona = PERSONAS[personaId] ?? PERSONAS.natural;
  let out = String(text ?? "");
  if (!out) return out;

  if (persona.breath) out = breathe(out);

  const opener = REPORTS_AN_ACTION.test(out) ? pickOpener(persona.openers, out) : null;
  if (opener) out = `${opener}${address ? `, ${address}` : ""}. ${out}`;

  return out;
}

/**
 * The best available voice for a persona, or null to let the device decide.
 *
 * Scored rather than matched, because the catalogue differs on every device
 * and an exact name that is missing should degrade to something close instead
 * of to silence.
 */
export function bestVoiceFor(personaId) {
  const persona = PERSONAS[personaId];
  if (!persona || !canSpeak()) return null;
  // A persona with no preferences means "whatever this device does best",
  // which is the device default — not the first entry of a catalogue that
  // opens with novelty voices on macOS.
  if (!persona.prefer.lang && !persona.prefer.names.length) return null;

  const all = speechSynthesis.getVoices();
  if (!all.length) return null;

  const score = (v) => {
    // A gag voice is never the answer, however well it scores otherwise. Zero
    // rather than a penalty: nothing should be able to add it back up.
    if (NOVELTY.test(v.name)) return 0;

    let n = 0;
    const name = v.name.toLowerCase();
    if (persona.prefer.names.some((w) => name.includes(w))) n += 100;
    if (persona.prefer.lang && v.lang === persona.prefer.lang) n += 40;
    else if (persona.prefer.lang && v.lang.startsWith(persona.prefer.lang.slice(0, 2))) n += 10;
    // The higher-quality engines. Apple's "Enhanced" and "Premium" downloads
    // and Google's "Neural" voices are a different class from the compact ones
    // that ship by default, and are worth preferring wherever one is installed.
    if (PREMIUM.test(v.name)) n += 25;
    if (v.localService) n += 5;
    return n;
  };

  const best = all.map((v) => ({ v, n: score(v) })).sort((a, b) => b.n - a.n)[0];
  // A zero score means nothing matched at all; the device default is a better
  // answer than an arbitrary voice from the top of the list.
  return best && best.n > 0 ? best.v : null;
}

/**
 * How much of the persona's delivery this particular voice can actually carry.
 *
 * A pitch shift is not free. The high-quality engines — Apple's Enhanced and
 * Premium downloads, Google's Neural voices — resynthesise and stay natural a
 * long way from 1.0. The compact voices that ship by default do something
 * closer to resampling, and at 0.85 they get the metallic warble that everybody
 * recognises instantly as a robot. Which meant the persona intended to sound
 * like a person was, on the most common devices, the one that sounded least
 * like one.
 *
 * So the persona asks and this decides. On a voice known to be good, it gets
 * what it asked for; on anything else — including the system default, which
 * cannot be inspected at all — the shift is halved back toward neutral. Being
 * unremarkable is a much smaller loss than being unlistenable.
 */
/**
 * Is this voice one of the good ones?
 *
 * There is no quality field on a `SpeechSynthesisVoice`, so this reads the
 * name, which is the only signal there is. Apple labels its downloads
 * "Enhanced" and "Premium", Google labels its good ones "Neural"; everything
 * else is the compact engine that ships with the operating system, and the
 * difference between the two is not subtle — it is most of the distance
 * between "an assistant" and "a robot reading a table".
 *
 * Worth surfacing rather than silently working around, because the fix belongs
 * to the person and takes them a minute: the better voices are a free download
 * sitting in their own settings, and nothing this app can do to a compact
 * voice comes close to it.
 */
export const isHiFi = (voice) => Boolean(voice && PREMIUM.test(voice.name));

/**
 * Which voice will actually be used, given a settings blob.
 *
 * The picker shows a chosen voice or "system default", and the second of those
 * is not inspectable — so "are you on a good voice" cannot be answered from
 * the setting alone.
 */
export function activeVoice(settings = {}) {
  if (!canSpeak()) return null;
  const v = voiceSettings(settings);
  if (!v.voiceURI) return null;
  return speechSynthesis.getVoices().find((x) => x.voiceURI === v.voiceURI) ?? null;
}

export function temper({ rate = 1, pitch = 1 }, voice) {
  if (isHiFi(voice)) return { rate, pitch };
  const half = (n) => Number((1 + (n - 1) / 2).toFixed(3));
  return { rate: half(rate), pitch: half(pitch) };
}

/**
 * Say something.
 * @returns {() => void} stop
 */
export function speak(text, { voiceURI, rate = 1, pitch = 1, persona, address = "", onStart, onEnd } = {}) {
  if (!canSpeak()) return () => {};
  // Read for speech first, then given the persona's delivery. The order
  // matters: `toSpeech` turns a multi-line reply into sentences and "1h" into
  // "1 hour", and the character pass has to see the finished sentence to know
  // where the tail of it is.
  const said = inCharacter(toSpeech(text), persona, address);
  if (!said) return () => {};

  stopSpeaking();
  const u = new SpeechSynthesisUtterance(said);
  // Looked up in the whole catalogue rather than in `voices()`, which is
  // filtered to the page's language for the picker. A persona reaches for an
  // en-GB voice; on a browser set to anything but English that filter dropped
  // it, and the choice silently became the system default.
  const pick = voiceURI && speechSynthesis.getVoices().find((v) => v.voiceURI === voiceURI);
  if (pick) u.voice = pick;
  // What this voice can carry, which is not always what the persona asked for.
  const delivery = temper({ rate, pitch }, pick || null);
  u.rate = delivery.rate;
  u.pitch = delivery.pitch;
  u.onstart = () => onStart?.();
  u.onend = () => {
    current = null;
    onEnd?.();
  };
  // A synthesis error must still release the caller, or hands-free mode waits
  // forever for a voice that already failed.
  u.onerror = () => {
    current = null;
    onEnd?.();
  };
  current = u;
  speechSynthesis.speak(u);
  return stopSpeaking;
}

export function stopSpeaking() {
  if (!canSpeak()) return;
  current = null;
  speechSynthesis.cancel();
}

export const isSpeaking = () => canSpeak() && (speechSynthesis.speaking || speechSynthesis.pending);

/* ----------------------------------------------------------------- listening */

const ONES = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50 };

const numberWord = (w) => (w in ONES ? ONES[w] : w in TENS ? TENS[w] : null);

/**
 * What was dictated, as it would have been typed.
 *
 * Recognition hands back lowercase words with no punctuation, and almost every
 * command to this assistant carries a time. "Book bob at three thirty p m
 * friday" is a perfectly clear sentence that the parser cannot read, because
 * it wants "3:30pm". Everything here is that one problem.
 */
export function fromSpeech(raw = "") {
  let s = ` ${String(raw).toLowerCase().trim()} `;

  // Meridiem, spelled every way a recogniser spells it.
  s = s.replace(/\b([ap])[\s.]*m\b\.?/g, "$1m");
  s = s.replace(/\bin the morning\b/g, "am").replace(/\bin the (?:afternoon|evening)\b/g, "pm");

  // "half past three" → "3:30", "quarter to four" → "3:45".
  s = s.replace(/\bhalf past (\w+)\b/g, (m, w) => {
    const n = numberWord(w) ?? Number(w);
    return Number.isFinite(n) && n >= 1 && n <= 12 ? `${n}:30` : m;
  });
  s = s.replace(/\b(?:a )?quarter past (\w+)\b/g, (m, w) => {
    const n = numberWord(w) ?? Number(w);
    return Number.isFinite(n) && n >= 1 && n <= 12 ? `${n}:15` : m;
  });
  s = s.replace(/\b(?:a )?quarter (?:to|till|before) (\w+)\b/g, (m, w) => {
    const n = numberWord(w) ?? Number(w);
    if (!Number.isFinite(n) || n < 1 || n > 12) return m;
    return `${n === 1 ? 12 : n - 1}:45`;
  });

  // "three thirty" → "3:30", but only where a time is plainly meant — after
  // "at", or in front of a meridiem. "Thirty minutes" must survive untouched,
  // which is why the meridiem is captured rather than looked ahead to: the
  // match has to be able to read it before deciding.
  s = s.replace(
    /\b(at\s+)?(\w+)\s+(twenty|thirty|forty|fifty)(?:[\s-]+(one|two|three|four|five|six|seven|eight|nine))?\b(\s*(?:am|pm|o'?clock))?/g,
    (m, at, hourWord, tensWord, onesWord, tail) => {
      const h = numberWord(hourWord);
      if (h === null || h < 1 || h > 12) return m;
      const mins = TENS[tensWord] + (onesWord ? ONES[onesWord] : 0);
      if (mins > 59) return m;
      // Neither "at" in front nor a meridiem behind means this is a count of
      // something, not a clock time.
      if (!at && !tail) return m;
      return `${at || ""}${h}:${String(mins).padStart(2, "0")}${tail || ""}`;
    },
  );

  // A bare hour word: "at three", "three pm", "three o'clock".
  const hourWords = Object.keys(ONES).join("|");
  s = s.replace(new RegExp(`\\bat\\s+(${hourWords})\\b`, "g"), (m, w) => `at ${ONES[w]}`);
  s = s.replace(new RegExp(`\\b(${hourWords})\\s*(am|pm)\\b`, "g"), (m, w, mer) => `${ONES[w]}${mer}`);
  s = s.replace(new RegExp(`\\b(${hourWords})\\s+o'?clock\\b`, "g"), (m, w) => `${ONES[w]} o'clock`);

  // Digits, spaced apart by the recogniser: "3 pm" → "3pm", "3 : 30" → "3:30".
  s = s.replace(/\b(\d{1,2})\s+(am|pm)\b/g, "$1$2");
  s = s.replace(/(\d)\s*:\s*(\d)/g, "$1:$2");

  // Spoken punctuation, and the full stop a recogniser adds at the end.
  s = s.replace(/\b(?:full stop|period)\b/g, ".").replace(/\bcomma\b/g, ",");
  s = s.replace(/\bone on one\b/g, "1:1");

  return s.replace(/\s{2,}/g, " ").trim().replace(/[.,]+$/, "");
}

/**
 * Listen once, or keep listening.
 *
 * `interimResults` is on because a transcript that appears only when you stop
 * talking gives no sign the microphone is working, and people repeat
 * themselves into the silence.
 *
 * @returns {{stop: () => void, abort: () => void}}
 */
export function listen({ onInterim, onFinal, onEnd, onError, continuous = false } = {}) {
  const Ctor = Recognition();
  if (!Ctor) {
    onError?.("unsupported");
    return { stop() {}, abort() {} };
  }

  const rec = new Ctor();
  rec.lang = globalThis.navigator?.language || "en-US";
  rec.interimResults = true;
  rec.continuous = continuous;
  rec.maxAlternatives = 1;

  let finished = false;
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const said = r[0]?.transcript || "";
      if (r.isFinal) {
        const clean = fromSpeech(said);
        if (clean) {
          finished = true;
          onFinal?.(clean, said);
        }
      } else {
        interim += said;
      }
    }
    if (interim) onInterim?.(fromSpeech(interim), interim);
  };
  rec.onerror = (e) => {
    // "no-speech" and "aborted" are ordinary endings, not faults worth
    // reporting to someone who simply changed their mind.
    if (e.error && !["no-speech", "aborted"].includes(e.error)) onError?.(e.error);
  };
  rec.onend = () => onEnd?.(finished);

  try {
    rec.start();
  } catch {
    // Already running — the browser throws rather than queueing.
    onEnd?.(false);
  }

  return {
    stop: () => {
      try {
        rec.stop();
      } catch { /* already stopped */ }
    },
    abort: () => {
      try {
        rec.abort();
      } catch { /* already stopped */ }
    },
  };
}

/**
 * The settings blob, with defaults, so no caller has to guess.
 *
 * Speaking is on by default in the native app and off on the web. In an app
 * somebody installed, a voice answering is the feature; in a browser tab it is
 * a surprise noise, and possibly one in an open-plan office.
 */
export const voiceSettings = (settings = {}) => {
  const persona = PERSONAS[settings?.voice?.persona] ?? PERSONAS.natural;
  const native = globalThis.__SQUIRREL_NATIVE__ === true;
  return {
    speak: settings?.voice?.speak ?? native,
    handsFree: settings?.voice?.handsFree ?? false,
    // An explicitly chosen voice always wins; otherwise the persona picks.
    voiceURI: settings?.voice?.voiceURI ?? bestVoiceFor(persona.id)?.voiceURI ?? null,
    persona: persona.id,
    // A rate the person set by hand beats the persona's, so the slider still
    // means something after a persona is chosen.
    rate: Number(settings?.voice?.rate ?? persona.rate),
    pitch: Number(settings?.voice?.pitch ?? persona.pitch),
  };
};
