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
const DAYPARTS = { morning: 9, afternoon: 14, evening: 18, night: 19, noon: 12, midnight: 0 };

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

  const oc = s.match(OCLOCK);
  if (oc) {
    const hour = Number(oc[1]);
    if (hour <= 23) return { h: disambiguateHour(hour, null), m: 0, source: oc[0] };
  }

  // 3pm, 3:30 pm, 15:00, at 2
  const m = s.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/);
  if (m) {
    const hour = Number(m[1]);
    const mins = m[2] ? Number(m[2]) : 0;
    const mer = m[3] ? m[3].replace(/\./g, "").slice(0, 2) : null;
    // A bare number with no meridiem, no colon, and no "at" is more likely a
    // duration or a count than a time — leave it to the duration parser.
    const explicit = Boolean(mer || m[2] || /\bat\s+\d/.test(s));
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
  if (/\ban hour\b|\ba hour\b/.test(s)) return 60;

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
