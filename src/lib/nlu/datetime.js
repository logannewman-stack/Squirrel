/**
 * Date, time, and duration parsing for the built-in assistant.
 *
 * Entirely deterministic — no model, no network, no per-use cost. This is the
 * hardest part of a coded assistant: almost every command carries a time
 * reference, and getting "next Wednesday at 2" wrong is worse than not
 * understanding the sentence at all.
 *
 * Every function returns null rather than guessing. A null propagates up and
 * becomes a targeted clarifying question, which is recoverable; a wrong
 * timestamp silently moves a board meeting.
 */

const WEEKDAYS = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, weds: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const MONTHS = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10,
  december: 11, dec: 11,
};

/**
 * Numbers as people write them.
 *
 * "two and a half hours" and "a couple of days" are how durations and offsets
 * actually get typed; digits are the exception in conversational input, not
 * the rule. Kept here rather than in the duration parser because dates need
 * them just as much — "in two weeks" is the same problem.
 */
export const WORD_NUMBERS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
  thirty: 30, forty: 40, forty5: 45, fifty: 50, sixty: 60, ninety: 90,
  couple: 2, few: 3, several: 3, dozen: 12,
};

// Longest first, or the alternation matches the "a" in "a couple of days" and
// then finds no unit behind it.
const NUM_WORDS = Object.keys(WORD_NUMBERS)
  .sort((x, y) => y.length - x.length)
  .join("|");

/**
 * A written number, with the halves people actually say.
 * "two and a half" → 2.5, "an hour and a half" is handled by the caller.
 */
export function wordNumber(text) {
  const m = text.match(new RegExp(`\\b(${NUM_WORDS})\\b(?:\\s+of)?(\\s+and\\s+a\\s+half)?`, "i"));
  if (!m) return null;
  const base = WORD_NUMBERS[m[1].toLowerCase()];
  return m[2] ? base + 0.5 : base;
}

/** Rough parts of day, used when no clock time is given. */
const DAYPARTS = {
  morning: 9, afternoon: 14, evening: 18, night: 19, noon: 12, midday: 12,
  midnight: 0,
  // "Call Bob first thing" names an hour as plainly as "at nine" does, and
  // carried none — so it read as a job to do rather than a meeting to book.
  "first thing": 9,
};

const pad = (n) => String(n).padStart(2, "0");

export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const atLocal = (d, h, m = 0) => {
  const x = new Date(d);
  x.setHours(h, m, 0, 0);
  return x;
};

/** ISO without a timezone suffix — the format the rest of the app stores. */
export const toLocalIso = (d) =>
  `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

/**
 * Business-hours disambiguation for a bare hour.
 *
 * "Move it to 2" in a work calendar means 14:00. Reading it as 02:00 is
 * technically defensible and always wrong in practice.
 */
function disambiguateHour(h, meridiem) {
  if (meridiem === "am") return h === 12 ? 0 : h;
  if (meridiem === "pm") return h === 12 ? 12 : h + 12;
  if (h === 12) return 12;
  if (h >= 1 && h <= 6) return h + 12;  // 1-6 → afternoon
  return h;                              // 7-11 → morning, 0 and 13-23 as given
}

/**
 * ---------------------------------------------------------------- spoken time
 *
 * A clock time as somebody says it rather than types it.
 *
 * Dictation arrives as words: "half past two", "quarter to nine", "ten thirty",
 * "oh nine hundred". None of it contains a digit, so the scan below — which is
 * built entirely out of `\d` — found nothing at all and the sentence carried no
 * time. That is the good failure. The bad one is the daypart fallback at the
 * end of `parseTime` picking the phrase up instead: "book a call at three in
 * the afternoon" matched `afternoon` and booked 14:00, confidently, an hour
 * before the meeting. A missing time asks a question; a wrong one moves a board
 * meeting.
 *
 * This lives in `datetime.js` rather than in the recogniser shim in `speech.js`
 * on purpose. `fromSpeech` is wired only to the in-app microphone; Siri, the
 * Shortcuts app, the widget and the deep link all hand their sentence straight
 * to `parse()`. Time understanding put here is shared by every one of them.
 */

/** Numbers a clock is said in, 0–59. */
const CLOCK_NUM = {
  oh: 0, zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50,
};

const ONES_W = "one|two|three|four|five|six|seven|eight|nine";
const TENS_W = "twenty|thirty|forty|fourty|fifty";
/** An hour anybody names out loud. Longest first, so "six" never eats "sixteen". */
const H12_W = "eleven|twelve|seven|three|eight|four|five|nine|ten|one|two|six";
/** Any spoken 0–59, compound included: "twenty five", "forty-five". */
const CLOCK_W =
  `(?:${TENS_W})[\\s-]+(?:${ONES_W})|` +
  Object.keys(CLOCK_NUM).sort((a, b) => b.length - a.length).join("|");

/** "forty five" → 45. Null if any word in it is not a number. */
function spokenNumber(w) {
  if (!w) return null;
  let total = 0;
  for (const part of w.toLowerCase().trim().split(/[\s-]+/)) {
    if (!(part in CLOCK_NUM)) return null;
    total += CLOCK_NUM[part];
  }
  return total;
}

/**
 * A meridiem said as a part of the day.
 *
 * "At 8 in the evening" was reading as 08:00 — the hour is bare, so
 * `disambiguateHour` applied the business-hours rule and put a dinner twelve
 * hours early. The words are right there in the sentence; they were simply
 * never consulted.
 */
function spokenMeridiem(s) {
  if (/\bin the morning\b|\bthis morning\b/.test(s)) return "am";
  if (/\bin the (?:afternoon|evening)\b|\bthis (?:afternoon|evening)\b|\bat night\b|\btonight\b/.test(s)) return "pm";
  return null;
}

/**
 * A clock time written out in words.
 *
 * Ordered most specific first, exactly like the intent table: "half past two"
 * has to be read before the bare "two" inside it, or every relative time
 * collapses onto its own hour.
 *
 * @returns {{h: number, m: number, source: string} | null}
 */
function spokenClock(s, mer) {
  // 24-hour, said aloud. Never disambiguated — military time means what it says.
  // "at" or a trailing part is required so the interjection in "oh, one more
  // thing" is not read as one o'clock.
  const lead = s.match(new RegExp(`\\b(at\\s+)?(?:oh|zero)\\s+(${ONES_W})(?:\\s+(hundred|${CLOCK_W}))?\\b`));
  if (lead && (lead[1] || lead[3])) {
    const h = spokenNumber(lead[2]);
    const m = !lead[3] || lead[3] === "hundred" ? 0 : spokenNumber(lead[3]);
    if (h !== null && m !== null && m <= 59) return { h, m, source: lead[0].trim() };
  }
  // "fifteen hundred", "eighteen hundred". Below thirteen it needs the word
  // "hours", because "two hundred" is a quantity far more often than a time.
  const mil = s.match(new RegExp(`\\b(${CLOCK_W})\\s+hundred(\\s+hours)?\\b`));
  if (mil) {
    const h = spokenNumber(mil[1]);
    if (h !== null && h <= 23 && (h >= 13 || mil[2])) return { h, m: 0, source: mil[0] };
  }

  // "half past two", "quarter to nine", "twenty past three", "ten to five".
  //
  // The backward forms are fenced behind "at" unless the amount is half or a
  // quarter, because "move my two to five" is a reschedule and reading it as
  // 16:58 would be both wrong and unnoticeable.
  const rel = s.match(new RegExp(
    `\\b(at\\s+|for\\s+)?(half|(?:a\\s+)?quarter|${CLOCK_W})\\s+(?:minutes?\\s+)?` +
    `(past|after|to|till|til|before)\\s+(${H12_W}|\\d{1,2})\\b`));
  if (rel) {
    const word = rel[2].replace(/^a\s+/, "");
    const mins = word === "half" ? 30 : word === "quarter" ? 15 : spokenNumber(word);
    const hour = /^\d+$/.test(rel[4]) ? Number(rel[4]) : spokenNumber(rel[4]);
    const forward = /past|after/.test(rel[3]);
    const fenced = forward || rel[1] || word === "half" || word === "quarter";
    if (fenced && mins !== null && mins >= 1 && mins <= 59 && hour !== null && hour >= 1 && hour <= 12) {
      return {
        h: disambiguateHour(forward ? hour : hour === 1 ? 12 : hour - 1, mer),
        m: forward ? mins : 60 - mins,
        source: rel[0].trim(),
      };
    }
  }

  // "half two" — British for 2:30, and American for nothing at all, so it is
  // fenced behind a preposition. Bare "half" is a fraction: "half an hour",
  // "cut it in half", "an hour and a half" all have to survive untouched.
  const brit = s.match(new RegExp(
    `(?:^|\\b(?:at|by|around|about|from|until|till|til)\\s+)half\\s+(${H12_W})\\b` +
    `(?!\\s*(?:hours?|hrs?|mins?|minutes?|days?|weeks?|months?|past|to))`));
  if (brit) {
    const h = spokenNumber(brit[1]);
    if (h !== null) return { h: disambiguateHour(h, mer), m: 30, source: brit[0].trim() };
  }

  // "at ten thirty", "at nine fifteen", "at eleven forty five" — an hour and
  // its minutes said as two numbers. Fenced behind a preposition or a meridiem,
  // the same caution the digit scan uses: without it "block two hours" and
  // "book five ten minute slots" become clock times.
  const unit = "(?!\\s*(?:hours?|hrs?|mins?|minutes?|days?|weeks?|months?|people|meetings?|calls?))";
  // The articles are here because a spoken time is as often named as booked:
  // "cancel the two thirty" points at a meeting the same way "cancel my 4pm"
  // does, and without them that sentence carried no time to find it by.
  const pair =
    s.match(new RegExp(`\\b(?:at|for|from|by|around|about|the|my|our|that|this)\\s+(${H12_W})\\s+(${CLOCK_W})\\b${unit}`)) ||
    s.match(new RegExp(`\\b(${H12_W})\\s+(${CLOCK_W})\\s*(am|pm)\\b`));
  if (pair) {
    const h = spokenNumber(pair[1]);
    const m = spokenNumber(pair[2]);
    if (h !== null && m !== null && m <= 59) {
      return { h: disambiguateHour(h, pair[3] || mer), m, source: pair[0].trim() };
    }
  }

  // "four o'clock", said without a digit in it.
  const oc = s.match(new RegExp(`\\b(${H12_W})\\s+o'?\\s*c?l[o0]?c?k\\b`));
  if (oc) return { h: disambiguateHour(spokenNumber(oc[1]), mer), m: 0, source: oc[0] };

  // "three pm", "eight am".
  const merW = s.match(new RegExp(`\\b(${H12_W})\\s*(am|pm)\\b`));
  if (merW) return { h: disambiguateHour(spokenNumber(merW[1]), merW[2]), m: 0, source: merW[0] };

  // A bare spoken hour, which needs "at" in front of it for exactly the reason
  // a bare digit does: "book four meetings" is a count, "at four" is a time.
  const bare = s.match(new RegExp(`\\bat\\s+(${H12_W})\\b${unit}`));
  if (bare) return { h: disambiguateHour(spokenNumber(bare[1]), mer), m: 0, source: bare[0] };

  return null;
}

/**
 * Extract a clock time.
 * @returns {{h: number, m: number, source: string} | null}
 */
/**
 * "3 o'clock", "3 oclock", "3 o clock", "3 o clok".
 *
 * Deliberately forgiving — this gets typed at speed and mistyped constantly,
 * and a missed time is the difference between booking a meeting and asking a
 * question the user already answered.
 */
export const OCLOCK = /\b(\d{1,2})\s*o'?\s*c?l[o0]?c?k\b/i;

export function parseTime(text) {
  const s = text.toLowerCase();
  // "in the evening" is a meridiem with no am or pm in it. Read once, up front,
  // and handed to every branch below — an hour is disambiguated in three
  // different places and all three were ignoring the words next to it.
  const dayMer = spokenMeridiem(s);

  const oc = s.match(OCLOCK);
  if (oc) {
    const hour = Number(oc[1]);
    if (hour <= 23) return { h: disambiguateHour(hour, dayMer), m: 0, source: oc[0] };
  }

  // Words before digits. A sentence with both — "at ten thirty on the 15th" —
  // has its time in the words, and the digit scan below would take the date.
  const said = spokenClock(s, dayMer);
  if (said) return said;

  // 3pm, 3:30 pm, 15:00, at 2
  //
  // Every number is tried, not just the first. "30 minute call with Dana at
  // 11" leads with a duration, and stopping at the first match read it as an
  // impossible hour and then gave up — so the sentence carried no time at all
  // and the booking never happened.
  for (const m of s.matchAll(/\b(at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/g)) {
    const hour = Number(m[2]);
    const mins = m[3] ? Number(m[3]) : 0;
    // "at 8 in the evening" is 20:00, and was 08:00 — the bare hour fell to the
    // business-hours rule while the half of the sentence that settles it sat
    // two words away, unread.
    const mer = m[4] ? m[4].replace(/\./g, "").slice(0, 2) : dayMer;
    // A bare number with no meridiem, no colon, and no "at" in front of it is
    // more likely a duration or a count — leave it to the duration parser.
    const explicit = Boolean(mer || m[3] || m[1]);
    if (hour <= 23 && mins <= 59 && explicit) {
      return { h: disambiguateHour(hour, mer), m: mins, source: m[0].trim() };
    }
  }

  for (const [word, h] of Object.entries(DAYPARTS)) {
    if (new RegExp(`\\b${word}\\b`).test(s)) return { h, m: 0, source: word };
  }
  return null;
}

/**
 * Extract a calendar date.
 * @param {string} text
 * @param {Date} now
 * @returns {{date: Date, source: string} | null}  Date at local midnight.
 */
export function parseDate(text, now = new Date()) {
  const s = text.toLowerCase();
  const base = atLocal(now, 0);

  /**
   * "The day after tomorrow." "A week today."
   *
   * Both have to be read before the plain words inside them, or the scan finds
   * "tomorrow" and stops — which put a meeting a day early, and "a week today"
   * squarely on today.
   */
  const shifted = s.match(
    /\bthe day after tomorrow\b|\bday after tomorrow\b|\bthe day before yesterday\b|\b(?:a|one|1)\s+week\s+(today|tomorrow|from today|from now)\b|\b(?:a|one|1)\s+fortnight\s+(?:today|from today|from now)\b|\bthis time next week\b/,
  );
  if (shifted) {
    const d = new Date(base);
    const by =
      /day after tomorrow/.test(shifted[0]) ? 2
      : /day before yesterday/.test(shifted[0]) ? -2
      : /fortnight/.test(shifted[0]) ? 14
      : /week/.test(shifted[0]) && /tomorrow/.test(shifted[0]) ? 8
      : 7;
    d.setDate(d.getDate() + by);
    return { date: d, source: shifted[0] };
  }

  if (/\btoday\b|\btonight\b/.test(s)) return { date: base, source: "today" };
  if (/\btomorrow\b|\btmrw\b/.test(s)) {
    const d = new Date(base);
    d.setDate(d.getDate() + 1);
    return { date: d, source: "tomorrow" };
  }
  if (/\byesterday\b/.test(s)) {
    const d = new Date(base);
    d.setDate(d.getDate() - 1);
    return { date: d, source: "yesterday" };
  }

  // 2026-08-05
  const isoM = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoM) {
    return {
      date: new Date(Number(isoM[1]), Number(isoM[2]) - 1, Number(isoM[3])),
      source: isoM[0],
    };
  }

  // "aug 5", "5 august", "august 5th"
  const monthNames = Object.keys(MONTHS).join("|");
  const md = s.match(new RegExp(`\\b(${monthNames})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`));
  const dm = s.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})\\b`));
  if (md || dm) {
    const month = MONTHS[(md ? md[1] : dm[2])];
    const day = Number(md ? md[2] : dm[1]);
    let year = now.getFullYear();
    const candidate = new Date(year, month, day);
    // A date already well past is almost always meant for next year.
    if (candidate < atLocal(now, 0) - 86400000 * 180) year += 1;
    return { date: new Date(year, month, day), source: (md || dm)[0] };
  }

  // 8/5 — day/month order is locale-dependent, so only accept the
  // unambiguous US reading when the first number cannot be a day-of-month
  // in the other reading, and otherwise leave it alone.
  const slash = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    if (a <= 12 && b <= 31) {
      const year = slash[3] ? Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]) : now.getFullYear();
      return { date: new Date(year, a - 1, b), source: slash[0] };
    }
  }

  // Weekdays: "monday", "next monday", "this friday"
  const wdNames = Object.keys(WEEKDAYS).join("|");
  const wd = s.match(new RegExp(`\\b(next|this|coming)?\\s*(${wdNames})\\b`));
  if (wd) {
    const target = WEEKDAYS[wd[2]];
    const qualifier = wd[1];
    const d = new Date(base);
    let delta = (target - d.getDay() + 7) % 7;
    // Bare "monday" on a Monday means the one coming, not today — someone
    // rescheduling says "today" when they mean today.
    if (delta === 0) delta = 7;
    // "next monday" skips the upcoming one and takes the week after.
    if (qualifier === "next") delta += 7;
    d.setDate(d.getDate() + delta);
    return { date: d, source: wd[0].trim() };
  }

  // "in 3 days", "in a couple of days", "in two weeks", "in a month"
  const inN = s.match(new RegExp(`\\bin\\s+(?:an?\\s+)?(\\d+|${NUM_WORDS})\\s*(?:of\\s+)?(day|week|month)s?\\b`));
  if (inN) {
    const n = /^\d+$/.test(inN[1]) ? Number(inN[1]) : WORD_NUMBERS[inN[1]];
    const d = new Date(base);
    if (inN[2] === "day") d.setDate(d.getDate() + n);
    else if (inN[2] === "week") d.setDate(d.getDate() + n * 7);
    else d.setMonth(d.getMonth() + n);
    return { date: d, source: inN[0] };
  }

  // "the 15th", "on the 3rd" — a bare day of the month, which means the next
  // time that number comes round rather than one that has already gone.
  const ord = s.match(/\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/);
  if (ord) {
    const n = Number(ord[1]);
    if (n >= 1 && n <= 31) {
      const d = new Date(base.getFullYear(), base.getMonth(), n);
      if (d < base) d.setMonth(d.getMonth() + 1);
      return { date: d, source: ord[0] };
    }
  }

  // Coarse points in a week or a month. Each resolves to one concrete date,
  // because a range cannot be booked — "early next week" is Monday, and the
  // confirmation says Monday so a wrong reading is visible and correctable.
  const coarse = s.match(/\b(early|start|beginning|mid|middle|end|later?)\s+(?:of\s+)?(?:the\s+)?(this\s+|next\s+|coming\s+)?(week|month)\b/);
  if (coarse) {
    const [, where, , unitRaw] = coarse;
    const nextOne = /next|coming/.test(coarse[2] || "");
    const d = new Date(base);
    if (unitRaw === "week") {
      // Monday of the target week, then offset within it.
      const toMonday = (1 - d.getDay() + 7) % 7;
      d.setDate(d.getDate() + toMonday + (nextOne ? 7 : 0));
      if (/mid|middle/.test(where)) d.setDate(d.getDate() + 2);
      if (/end|later?/.test(where)) d.setDate(d.getDate() + 4);
    } else {
      if (nextOne) d.setMonth(d.getMonth() + 1);
      if (/early|start|beginning/.test(where)) d.setDate(1);
      else if (/mid|middle/.test(where)) d.setDate(15);
      else d.setMonth(d.getMonth() + 1, 0);        // last day of that month
    }
    return { date: d, source: coarse[0] };
  }

  /**
   * Office shorthand for a deadline, read last so anything more specific in
   * the same sentence wins: "COB Friday" is Friday, not today, because the
   * weekday matcher above has already claimed it.
   *
   * Every one of these resolves to a date rather than a time. "EOD" does mean
   * the end of the working day, but a deadline in this app is a day — and
   * inventing 17:00 out of it would put a false precision on the screen.
   */
  const shorthand = s.match(
    /\b(?:eow|e\.o\.w|end of (?:the )?week)\b|\b(?:eod|e\.o\.d|eop|end of (?:play|business|the day|day)|close of (?:business|play)|by close|cob|c\.o\.b)\b|\bthis quarter\b/,
  );
  if (shorthand) {
    const d = new Date(base);
    const word = shorthand[0];
    if (/^(?:eow|e\.o\.w|end of)/.test(word) && /week/.test(word)) {
      // Friday of the week it is said in, which is what "end of week" buys.
      d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7));
    } else if (/quarter/.test(word)) {
      d.setMonth(Math.floor(d.getMonth() / 3) * 3 + 3, 0);
    }
    return { date: d, source: word };
  }

  // "sometime this week", "later this week" — treated as the end of it, since
  // vague intent with a deadline attached means "before it runs out".
  const thisWeek = s.match(/\b(?:some ?time|any ?time|at some point)?\s*(this|next) week\b/);
  if (thisWeek) {
    const d = new Date(base);
    const toFriday = (5 - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + toFriday + (thisWeek[1] === "next" ? 7 : 0));
    return { date: d, source: thisWeek[0].trim() };
  }

  return null;
}

// ---------------------------------------------------------------- ranges
/**
 * A stretch of calendar, rather than a point on it.
 *
 * "Cancel my 4pm" needs a moment. "Clear my calendar this week" needs a span,
 * and the two readings of the same words genuinely differ: as a deadline,
 * "this week" resolves to Friday — before it runs out — which is why
 * `parseDate` sends it there. As a span it means Monday through Sunday, and
 * using the deadline reading to select events for deletion would clear one day
 * and report success.
 *
 * Everything returned is half-open — `from` inclusive, `to` exclusive — so a
 * meeting at exactly midnight belongs to the day it starts and to nothing else.
 */

/** Boundaries of the rough parts of a day, for "clear my afternoon". */
const DAYPART_SPAN = {
  morning: [0, 12],
  afternoon: [12, 17],
  evening: [17, 24],
  tonight: [17, 24],
  night: [17, 24],
  "the day": [0, 24],
};

const startOfDay = (d) => atLocal(d, 0);
const nextDay = (d, n = 1) => {
  const x = atLocal(d, 0);
  x.setDate(x.getDate() + n);
  return x;
};
const mondayOf = (d, weeksOut = 0) => {
  const x = atLocal(d, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7) + weeksOut * 7);
  return x;
};

/**
 * Whether "this week" should mean the working week that starts on Monday.
 *
 * Weeks here run Monday to Sunday, which puts the weekend at the *end* of the
 * week it belongs to. Taken literally that made "what does my week look like"
 * on a Saturday evening report the day and a half remaining — so somebody who
 * had just booked a meeting for Thursday was told their week was clear — and
 * "clear this week" would have cleared only those two days.
 *
 * Nobody asking a work planner about "my week" from a weekend means the tail of
 * the one that is ending. They mean the one that starts on Monday, which on the
 * default settings is also the only part of it with any working hours in it at
 * all.
 *
 * "This weekend" is matched earlier and is unaffected: asked on a Saturday, it
 * still means the two days in hand.
 *
 * @returns {0|1} weeks to shift a "this week" / "next week" reading by
 */
const weekendLooksForward = (now) => (now.getDay() === 0 || now.getDay() === 6 ? 1 : 0);
const at = (d, h) => {
  const x = atLocal(d, 0);
  x.setMinutes(Math.round(h * 60));
  return x;
};

/**
 * Date words, recognised through a typo.
 *
 * Narrower than the command vocabulary in parse.js and used only as a retry:
 * "remove my appointments for this wek" is unmistakably about this week, and
 * answering "which stretch?" to it is the kind of pedantry that makes people
 * stop typing to an assistant. Only ever consulted after a clean parse found
 * nothing, so a sentence that already makes sense is never rewritten.
 */
const DATE_VOCAB = [
  "today", "tonight", "tomorrow", "yesterday", "week", "weekend", "weeks",
  "month", "morning", "afternoon", "evening", "calendar", "schedule",
  "everything", "monday", "tuesday", "wednesday", "thursday", "friday",
  "saturday", "sunday",
];

/**
 * One edit away, counting a swapped pair as one edit.
 *
 * Transposition has to count as a single mistake, or "friady" — which is how
 * Friday actually gets mistyped — sits two plain edits from the word and is
 * never recognised. One edit is the whole budget: allow two and "monthly"
 * corrects to "month", so a question about a monthly review starts clearing
 * the month.
 */
function nearlyEqual(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a === b) return true;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  const ra = a.slice(i, a.length - j);
  const rb = b.slice(i, b.length - j);
  // One insertion, deletion, or substitution.
  if (ra.length <= 1 && rb.length <= 1) return true;
  // Or one swapped pair.
  return ra.length === 2 && rb.length === 2 && ra[0] === rb[1] && ra[1] === rb[0];
}

/** Nudge date words onto their spelling. Only ever run after a clean parse failed. */
export function fixDateWords(text) {
  return text.replace(/[a-z']+/gi, (w) => {
    const low = w.toLowerCase();
    if (low.length < 3 || DATE_VOCAB.includes(low)) return w;
    return DATE_VOCAB.find((v) => nearlyEqual(low, v)) ?? w;
  });
}

/**
 * @param {string} text
 * @param {Date} now
 * @param {{clampToNow?: boolean}} [opts]  Trim a range that starts in the past.
 * @returns {{from: Date, to: Date, label: string, scope: string} | null}
 */
export function parseRange(text, now = new Date(), opts = {}) {
  const s = text.toLowerCase();
  const today = startOfDay(now);
  const clamp = (r) => {
    // Clearing "this week" on Thursday means the part of it still ahead. The
    // days already spent hold history, and deleting history is never what was
    // meant by a forward-looking instruction.
    if (opts.clampToNow !== false && r.from < today && r.to > today) {
      return { ...r, from: today };
    }
    return r;
  };

  // "from Monday to Wednesday", "Monday through Friday" — an explicit span,
  // checked first because both halves would otherwise parse as one date.
  const span = s.match(/\b(?:from\s+)?(.{2,24}?)\s+(?:to|until|till|through|thru|[-–])\s+(.{2,24}?)\s*$/);
  if (span) {
    const a = parseDate(span[1], now);
    const b = parseDate(span[2], now);
    if (a && b && b.date >= a.date) {
      return clamp({
        from: startOfDay(a.date),
        to: nextDay(b.date),
        label: `${label(a.date, now)} through ${label(b.date, now)}`,
        scope: "span",
      });
    }
  }

  // "the rest of today", "the rest of this week", "the rest of my afternoon".
  const rest = s.match(/\b(?:the\s+)?rest of (?:the\s+|my\s+|this\s+)?(day|today|morning|afternoon|evening|week|month)\b/);
  if (rest) {
    const unit = rest[1];
    if (unit === "week") {
      return {
        from: now,
        to: nextDay(mondayOf(now, 1 + weekendLooksForward(now)), 0),
        label: "the rest of this week",
        scope: "week",
      };
    }
    if (unit === "month") {
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { from: now, to: end, label: "the rest of this month", scope: "month" };
    }
    const [, hi] = DAYPART_SPAN[unit === "today" ? "the day" : unit] ?? DAYPART_SPAN["the day"];
    return { from: now, to: at(today, hi), label: `the rest of ${unit === "day" || unit === "today" ? "today" : `the ${unit}`}`, scope: "part" };
  }

  // A part of a named day: "friday afternoon", "tomorrow morning", "tonight".
  const part = s.match(/\b(morning|afternoon|evening|tonight|night)\b/);
  if (part) {
    const kind = part[1];
    // "tonight" carries its own day; anything else takes whatever day the
    // sentence named, defaulting to today.
    const on = kind === "tonight" ? today : (parseDate(s, now)?.date ?? today);
    const [lo, hi] = DAYPART_SPAN[kind];
    return clamp({
      from: at(on, lo),
      to: at(on, hi),
      label: kind === "tonight" ? "tonight" : `${label(on, now)} ${kind}`,
      scope: "part",
    });
  }

  // "the next three days", "the next 2 weeks"
  const nextN = s.match(new RegExp(`\\b(?:the\\s+)?next\\s+(\\d+|${NUM_WORDS})\\s*(day|week|month)s?\\b`));
  if (nextN) {
    const n = /^\d+$/.test(nextN[1]) ? Number(nextN[1]) : WORD_NUMBERS[nextN[1]];
    const to = startOfDay(now);
    if (nextN[2] === "day") to.setDate(to.getDate() + n);
    else if (nextN[2] === "week") to.setDate(to.getDate() + n * 7);
    else to.setMonth(to.getMonth() + n);
    return { from: now, to, label: `the next ${n} ${nextN[2]}${n === 1 ? "" : "s"}`, scope: "span" };
  }

  if (/\bthis weekend\b/.test(s)) {
    const sat = new Date(today);
    sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7));
    return clamp({ from: sat, to: nextDay(sat, 2), label: "this weekend", scope: "span" });
  }

  // Whole weeks and months. "this week" is Monday to Sunday here, deliberately
  // unlike the deadline reading.
  const ahead = weekendLooksForward(now);
  if (/\bnext week\b/.test(s)) {
    return { from: mondayOf(now, 1 + ahead), to: mondayOf(now, 2 + ahead), label: "next week", scope: "week" };
  }
  if (/\b(?:this|the|my|current)\s+(?:whole\s+|entire\s+|full\s+)?week\b/.test(s)) {
    return clamp({ from: mondayOf(now, ahead), to: mondayOf(now, 1 + ahead), label: "this week", scope: "week" });
  }
  if (/\bnext month\b/.test(s)) {
    return {
      from: new Date(now.getFullYear(), now.getMonth() + 1, 1),
      to: new Date(now.getFullYear(), now.getMonth() + 2, 1),
      label: "next month",
      scope: "month",
    };
  }
  if (/\b(?:this|the|my)\s+(?:whole\s+|entire\s+|full\s+)?month\b/.test(s)) {
    return clamp({
      from: new Date(now.getFullYear(), now.getMonth(), 1),
      to: new Date(now.getFullYear(), now.getMonth() + 1, 1),
      label: "this month",
      scope: "month",
    });
  }

  // A single named day covers that whole day.
  const one = parseDate(s, now);
  if (one) {
    return { from: startOfDay(one.date), to: nextDay(one.date), label: label(one.date, now), scope: "day" };
  }

  // "everything", with no day attached at all. Not a range — a request to be
  // asked which one, because the honest reading spans months.
  return null;
}

/** One whole day, as a range. Used when a revision re-aims a clear. */
export const dayRange = (date, now = new Date()) => ({
  from: startOfDay(date),
  to: nextDay(date),
  label: label(date, now),
  scope: "day",
});

/** "today", "tomorrow", "Friday", "Tue, Aug 18" — a day, said the short way. */
function label(d, now) {
  const k = dayKey(d);
  if (k === dayKey(now)) return "today";
  const t = new Date(now);
  t.setDate(t.getDate() + 1);
  if (k === dayKey(t)) return "tomorrow";
  const within = (atLocal(d, 0) - atLocal(now, 0)) / 86400000;
  if (within > 0 && within < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

/**
 * Combined date + time. Falls back to today when only a time is given, rolling
 * to tomorrow if that time has already passed.
 * @returns {{at: Date, hadTime: boolean, hadDate: boolean} | null}
 */
export function parseDateTime(text, now = new Date()) {
  const d = parseDate(text, now);
  const t = parseTime(text);
  if (!d && !t) return null;

  const day = d ? d.date : atLocal(now, 0);
  const at = t ? atLocal(day, t.h, t.m) : atLocal(day, 9);

  if (!d && t && at <= now) at.setDate(at.getDate() + 1);

  return { at, hadTime: Boolean(t), hadDate: Boolean(d) };
}

/** Minutes, from "2 hours", "90 min", "an hour", "half an hour", "45m". */
export function parseDuration(text) {
  const s = text.toLowerCase();

  if (/\bhalf an hour\b|\bhalf hour\b/.test(s)) return 30;
  if (/\ban hour and a half\b|\bhour and a half\b/.test(s)) return 90;
  // Before the plain "an hour" below, which is inside both of these and was
  // answering 60 to a phrase that says three quarters of that.
  if (/\bthree quarters of an? hour\b/.test(s)) return 45;
  if (/\b(?:a )?quarter of an? hour\b/.test(s)) return 15;
  if (/\ban hour\b|\ba hour\b/.test(s)) return 60;

  /**
   * "Forty five minutes." "Twenty five minutes."
   *
   * A two-word number, and the single-word scan below read only its second
   * half — "forty five minutes" booked five minutes, silently, which is the
   * same class of failure as booking at the wrong hour. Placed above that scan
   * because it is the same text and the longer reading has to win.
   */
  const compound = s.match(/\b(twenty|thirty|forty|fourty|fifty)[\s-]+(one|two|three|four|five|six|seven|eight|nine)\s*(?:m\b|mins?\b|minutes?\b)/);
  if (compound) {
    const tens = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50 };
    const ones = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
    return tens[compound[1]] + ones[compound[2]];
  }

  // "a couple of hours", "two and a half hours", "three quarters of an hour".
  const wordHours = s.match(new RegExp(`\\b(${NUM_WORDS})\\b(?:\\s+of)?(\\s+and\\s+a\\s+half)?\\s*(?:h\\b|hrs?\\b|hours?\\b)`));
  if (wordHours) {
    const base = WORD_NUMBERS[wordHours[1]];
    return Math.round((base + (wordHours[2] ? 0.5 : 0)) * 60);
  }
  const wordMins = s.match(new RegExp(`\\b(${NUM_WORDS})\\b(?:\\s+of)?\\s*(?:m\\b|mins?\\b|minutes?\\b)`));
  if (wordMins) return WORD_NUMBERS[wordMins[1]];

  const hm = s.match(/\b(\d+(?:\.\d+)?)\s*(?:h\b|hrs?\b|hours?\b)/);
  const mm = s.match(/\b(\d+)\s*(?:m\b|mins?\b|minutes?\b)/);
  if (hm || mm) {
    return Math.round((hm ? Number(hm[1]) * 60 : 0) + (mm ? Number(mm[1]) : 0));
  }

  /**
   * "A quick 15 with Priya." "Grab a fast 30."
   *
   * A bare number is a time far more often than a length — "book 3 with Bob"
   * means three o'clock — so this stays deliberately narrow: only directly
   * after a word that can only mean brevity, never in front of a meridiem or a
   * colon, and only for values that read as a number of minutes.
   */
  const brief = s.match(/\b(?:quick|fast|short|brief|little)\s+(\d{1,3})\b(?!\s*(?::|\s*[ap]\.?m\.?|o'?clock))/);
  if (brief && Number(brief[1]) >= 5 && Number(brief[1]) <= 240) return Number(brief[1]);

  return null;
}

/** Human phrasing for confirmations. */
export function describe(d, now = new Date()) {
  const today = dayKey(now);
  const target = dayKey(d);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (target === today) return `today at ${time}`;
  if (target === dayKey(tomorrow)) return `tomorrow at ${time}`;

  const withinAWeek = (d - atLocal(now, 0)) / 86400000 < 7;
  const day = withinAWeek
    ? d.toLocaleDateString([], { weekday: "long" })
    : d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  return `${day} at ${time}`;
}
