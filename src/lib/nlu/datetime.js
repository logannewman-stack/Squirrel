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
export function parseTime(text) {
  const s = text.toLowerCase();

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

  // "in 3 days"
  const inDays = s.match(/\bin\s+(\d+)\s+days?\b/);
  if (inDays) {
    const d = new Date(base);
    d.setDate(d.getDate() + Number(inDays[1]));
    return { date: d, source: inDays[0] };
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
  if (/\ban hour\b|\ba hour\b/.test(s)) return 60;

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
