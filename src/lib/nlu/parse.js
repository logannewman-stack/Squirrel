/**
 * Intent classification.
 *
 * Ordered rules, most specific first — "cancel the 3pm and book a 4pm" should
 * classify as cancel, not create, because the leading verb governs. Each intent
 * declares which slots it needs; missing slots become one targeted question
 * rather than a guess.
 */

import { parseDateTime, parseDuration, parseTime, parseDate } from "./datetime.js";

export const INTENTS = {
  MOVE_EVENT: "move_event",
  CANCEL_EVENT: "cancel_event",
  CREATE_EVENT: "create_event",
  CREATE_TASK: "create_task",
  COMPLETE_TASK: "complete_task",
  DELEGATE_TASK: "delegate_task",
  INVITE: "invite",
  QUERY_DAY: "query_day",
  QUERY_EVENT: "query_event",
  QUERY_PROGRESS: "query_progress",
  RESIZE_EVENT: "resize_event",
  QUERY_FREE: "query_free",
  PLAN_DAY: "plan_day",
  HELP: "help",
  UNKNOWN: "unknown",
};

const RULES = [
  [INTENTS.HELP, /\b(help|what can you do|commands?)\b/],
  [INTENTS.INVITE, /\b(invite|send (?:an? )?invit|email .* about|send .* (?:the )?(?:invite|calendar))\b/],
  [INTENTS.MOVE_EVENT, /\b(move|reschedul\w*|push|shift|bump|postpone)\b/],
  [INTENTS.CANCEL_EVENT, /\b(cancel|delete|remove|drop|call off)\b/],
  // "mark ... as done" allows words in between — that is how people write it.
  [INTENTS.COMPLETE_TASK, /\b(?:complete|completed|finish\w*|tick off|check off|did the)\b|\bmark\b.*\bdone\b/],
  [INTENTS.DELEGATE_TASK, /\b(delegate|hand off|assign|give .* to)\b/],
  // Before MOVE, because "shorten"/"extend" are edits to length rather than
  // to when — and "push the review out by an hour" is genuinely ambiguous, so
  // the explicit length verbs win.
  [INTENTS.RESIZE_EVENT, /\b(shorten|lengthen|extend|trim|cut)\b.*\b(?:to|by|in half)\b|\bmake\b.*\b(?:\d+|one|two|three|four|five|half)\s*(?:h\b|hrs?\b|hours?\b|m\b|mins?\b|minutes?\b)/],
  // Questions about one specific thing on the calendar, which want a fact
  // rather than a day's worth of listing.
  [INTENTS.QUERY_EVENT, /\b(?:where(?:'s| is)|how long is|who am i (?:meeting|seeing)|is .* still on|when(?:'s| is) (?:my|the)|what time is (?:my|the))\b/],
  [INTENTS.QUERY_PROGRESS, /\bhow much (?:time|have i|did i)\b|\bhow am i doing\b|\bwhat did i (?:do|finish|get done)\b|\bhow many hours\b|\bhow'?s my (?:focus|week)\b/],
  [INTENTS.PLAN_DAY, /\b(plan (?:my|the)? ?(?:day|week|month)|plan today|what should i (?:do|work on)|priorit\w+ (?:my|the) day|schedule (?:my|the) work|spread .* out|when (?:will|can) i (?:do|finish)|will .* fit|fit .* deadline|most urgent|what'?s urgent|behind on|on track|how much .* left|how (?:is|are) .* (?:going|doing)|triage)\b/],
  [INTENTS.QUERY_FREE, /\b(free|available|open (?:time|slot)|any (?:time|gaps?)|when can i)\b/],
  [INTENTS.QUERY_DAY, /\b(what(?:'s| is| does)?|show|list|when|do i have|how many|agenda|(?:my|the) schedule|look like|going on)\b/],
  [INTENTS.CREATE_EVENT, /\b(schedule|book|block|set up|pencil in|hold|put .* (?:on|in) (?:my|the) calendar|get .* (?:on|in) (?:my|the) calendar|(?:find|make|set aside|carve out|free up|squeeze in) .*(?:time|hours?|minutes?)|add .* (?:meeting|call|event))\b/],
  [INTENTS.CREATE_TASK, /\b(add|create|new|remind me to|need to|todo)\b/],
];

const PRIORITY = [
  [/\b(critical|urgent|asap|drop everything)\b/, "critical"],
  [/\b(high priority|important|high)\b/, "high"],
  [/\b(low priority|whenever|low|someday)\b/, "low"],
];

/**
 * Openers that mean "what I just said was wrong".
 *
 * Stripped before classification so the rest of the sentence is read as the
 * command it is — otherwise "no schedule it for friday" becomes an event
 * titled "No schedule it", which is exactly the failure this exists to stop.
 */
const REPAIR = /^\s*(?:no+|nope|nah|actually|sorry|wait|whoops|oops|i meant|i said|not that|scratch that|never ?mind that|instead)\b[\s,.:;!—-]*/i;

/** "make it 3pm", "move it to Friday" — an edit to something already named. */
const AMEND = /^\s*(?:make|change|set|push|move|shift|bump)\s+(?:it|that|this|them)\b/i;

const PRONOUN = /\b(?:it|that one|that|this one|them|those|the meeting|the event|the task|the call)\b/i;

/** The noun that decides whether a bare booking is a "Call" or a "Meeting". */
const KIND_NOUN = /\b(call|meeting|sync|standup|stand-up|interview|review|1:1|one on one|lunch|dinner|coffee|appointment|catch ?up)\b/i;

/**
 * Words that follow "with" but are not people.
 *
 * Capitalisation used to be the signal here, which fails the moment anyone
 * types the way people actually type: "meeting with bob" produced no attendee
 * at all. A stopword list is the right test — "with the team" is not a name,
 * "with bob" is.
 */
const NOT_A_NAME = new Set([
  "a", "an", "the", "my", "our", "your", "his", "her", "their", "this", "that",
  "these", "those", "team", "board", "everyone", "everybody", "them", "him",
  "us", "me", "you", "it", "client", "clients", "group", "staff", "room",
  "zoom", "google", "meet", "teams", "no", "yes", "regard", "regards",
  "respect", "time", "someone", "anyone", "each", "both", "all",
]);

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Words worth recognising through a typo. Command verbs and time words only —
 * this list is never used to correct anything a user might have meant
 * literally, like a name or a project.
 */
const VOCAB = [
  "schedule", "reschedule", "book", "block", "cancel", "delete", "remove",
  "move", "push", "postpone", "shift", "bump", "complete", "finish",
  "delegate", "assign", "remind", "calendar", "meeting", "meetings",
  "tomorrow", "tonight", "today", "monday", "tuesday", "wednesday",
  "thursday", "friday", "saturday", "sunday", "morning", "afternoon",
  "evening", "minutes", "minute", "hours", "clock", "oclock", "priority",
];

/** Levenshtein, abandoned as soon as it cannot come in under `max`. */
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (row[j] < best) best = row[j];
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

/**
 * Nudge obvious typos onto known command words.
 *
 * Only runs when nothing classified at all, so a sentence that already makes
 * sense is never rewritten, and a name is never "corrected" into a verb. Words
 * sitting where a name goes are skipped outright. A wrong guess here is caught
 * by the confirmation before it reaches the calendar, where doing nothing at
 * all — which is what "scheduke" used to get — is not.
 */
function despell(text) {
  const parts = text.split(/(\s+)/);
  let namePosition = false;
  return parts
    .map((tok) => {
      if (/^\s*$/.test(tok)) return tok;
      const w = tok.toLowerCase().replace(/[^a-z']/g, "");
      const after = namePosition;
      namePosition = /^(?:with|to|for|and)$/.test(w);
      if (after || w.length < 4 || VOCAB.includes(w)) return tok;

      const max = w.length >= 6 ? 2 : 1;
      let best = null;
      let bestD = max + 1;
      for (const v of VOCAB) {
        const d = distance(w, v, max);
        if (d < bestD) {
          bestD = d;
          best = v;
        }
      }
      return bestD <= max ? tok.replace(w, best) : tok;
    })
    .join("");
}

const classify = (s) => {
  for (const [name, re] of RULES) if (re.test(s)) return name;
  return INTENTS.UNKNOWN;
};

/** Strip leading command verbs so the remainder reads as a title. */
function stripVerbs(text) {
  return text
    .replace(/^\s*(?:can you|could you|please|hey|ok|okay)\s+/i, "")
    .replace(/^\s*(?:add|create|new|schedule|book|block|set up|remind me to|i need to)\s+/i, "")
    .replace(/\bput\s+(?:it|this|that)?\s*(?:on|in)\s+(?:my|the)\s+calendar\b/i, " ")
    .replace(/\b(?:a|an|the)\s+(?:task|meeting|call|event|reminder)\s+(?:to|for|called|named)?\s*/i, "")
    .trim();
}

/** Remove time/date/duration phrases so they don't end up inside a title. */
function stripTemporal(text) {
  return text
    .replace(/\b(?:on|at|for|by|due)?\s*\b(?:next|this|coming)?\s*\b(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)(?:day|nesday|rsday|urday)?\b/gi, " ")
    .replace(/\b(?:today|tomorrow|tonight|yesterday|tmrw)\b/gi, " ")
    .replace(/\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)\b/gi, " ")
    // Bare "at 10" with no meridiem — otherwise it survives into a title or
    // subject as trailing noise.
    .replace(/\b\d{1,2}\s*o'?\s*c?l[o0]?c?k\b/gi, " ")
    .replace(/\bat\s+\d{1,2}(?::\d{2})?\b/gi, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:h|hrs?|hours?|m|mins?|minutes?)\b/gi, " ")
    .replace(/\b(?:half an hour|an hour|a hour)\b/gi, " ")
    .replace(/\b(?:in\s+\d+\s+days?)\b/gi, " ")
    .replace(/\b(?:morning|afternoon|evening|noon|midnight|night)\b/gi, " ")
    .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\w*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b/gi, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\bdue\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** "with bob and Sarah" → ["Bob", "Sarah"]. Case-insensitive by design. */
function extractPeople(text) {
  const m = text.match(/\bwith\s+([\w'-]+(?:\s*(?:,|and)\s*[\w'-]+)*)/i);
  if (!m) return [];
  const out = [];
  for (const part of m[1].split(/\s*,\s*|\s+and\s+/)) {
    const w = part.trim();
    if (!w || NOT_A_NAME.has(w.toLowerCase())) continue;
    out.push(w[0].toUpperCase() + w.slice(1));
  }
  return out;
}

/** Matches the exact "with <people>" phrase so it can be cut from a title. */
function withPhrase(people) {
  if (!people.length) return /\bwith\s+[A-Z][\w'-]*(?:\s+(?:and\s+|,\s*)[A-Z][\w'-]*)*/g;
  return new RegExp(`\\bwith\\s+${people.map(esc).join("\\s*(?:,|and)\\s*")}`, "gi");
}

/**
 * "call it the board prep" → an explicit rename.
 *
 * Amendments only ever rename when asked in so many words. Reusing whatever
 * words were left over would mean "actually make it an hour" quietly retitles
 * the meeting, which is not a mistake anyone would think to check for.
 */
function extractRename(text) {
  const m = text.match(/\b(?:call it|rename(?:\s+it)?(?:\s+to)?|title it|name it)\s+(.+)$/i);
  if (!m) return null;
  const cleaned = m[1].replace(/^[\s"“'’]+|[\s"”'’.,]+$/g, "").trim();
  if (!cleaned) return null;
  return cleaned[0].toUpperCase() + cleaned.slice(1);
}

/**
 * "about the Q3 pipeline", "re: financials", "on financials for DOD".
 *
 * "on" earns its place — people say "a meeting on financials" constantly — but
 * it is also how they say "on Friday" and "on my calendar". Both are stripped
 * before the result is judged empty, so those produce no subject at all.
 */
function extractSubject(text, people = []) {
  const m = text.match(/\b(?:about|regarding|re:?|to discuss|to go over|covering|on)\s+(.+)$/i);
  if (!m) return null;
  const cleaned = stripTemporal(m[1])
    .replace(withPhrase(people), " ")
    .replace(/^[\s,;:.\-]+|[\s,;:.\-]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!cleaned || /^(?:my|the|our)?\s*calendar$/i.test(cleaned)) return null;
  return cleaned;
}

/**
 * Left over after every slot is removed, none of these is a name: either a
 * bare noun ("meeting") or a stranded function word ("for"). Both mean the
 * sentence was all slots, and the caller should compose a title instead.
 */
const BARE_NOUN =
  /^(?:meetings?|calls?|events?|syncs?|chats?|1:1|one on one|appointments?|catch ?up|blocks?|times?|slots?|lunch|dinner|breakfast|coffee|drinks|standups?|stand-ups?|interviews?|reviews?|for|about|on|to|with|and|it|that|this|them|those|an?|the|re)$/i;

/**
 * Produce the title a human would have typed.
 *
 * Everything the parser consumed as a slot has to come back out of the title,
 * or it shows up in the UI as "sign the Munich lease, high priority," — the
 * command echoed back rather than a task name. Leading connectors and stray
 * punctuation go too: "for the board deck" should read "Board deck".
 *
 * The verb strip runs twice on purpose. "a 2 pm meeting for 30 minutes" only
 * becomes the contiguous phrase "a meeting for" once the temporal parts are
 * gone, and until it does, the noun-phrase rule cannot see it — which is how
 * "Meeting for with bob" used to end up on the calendar.
 */
function cleanTitle(text, people = [], subject = null) {
  // "make it an hour" is an instruction about an existing thing, not a name.
  // Without this the leftovers spell "Make" and the meeting gets renamed.
  let t = stripVerbs(text.replace(AMEND, " "))
    .replace(/\b(?:about|regarding|re:?|to discuss|to go over|covering)\s+.+$/i, " ")
    // Cut the exact subject that was extracted rather than everything after a
    // preposition — "on" is far too common to truncate a title on.
    .replace(subject ? new RegExp(`\\b(?:on\\s+)?${esc(subject)}\\b`, "i") : /$^/, " ")
    .replace(withPhrase(people), " ");
  t = stripTemporal(t);
  t = stripVerbs(t);
  t = t.replace(/\b(?:high priority|low priority|critical|urgent|asap|drop everything)\b/gi, " ");
  t = t.replace(/\s{2,}/g, " ").trim();
  // Peel connectors, articles, and stranded pronouns off both ends until
  // nothing changes: "for the board deck" is a phrase from the command,
  // "Board deck" is the thing itself, and "it for" is nothing at all.
  // Whitespace is required after each word so "On-site review" survives.
  let prev;
  do {
    prev = t;
    t = t.replace(/^(?:for|about|on|to|with|re|called|named|and|it|that|this|them|those|a|an|the)\s+/i, "");
    t = t.replace(/\s+(?:for|about|on|to|with|and|it|that)$/i, "");
    t = t.replace(/^[\s,;:.\-]+|[\s,;:.\-]+$/g, "").trim();
  } while (t !== prev);
  // A bare "meeting" is not a title. Returning null lets the caller compose one
  // from who it is with, which is what the user would have written anyway.
  if (!t || BARE_NOUN.test(t)) return null;
  return t[0].toUpperCase() + t.slice(1);
}

/**
 * @returns {{intent, slots, text, body, repair, amend, pronoun, fragment}}
 */
export function parse(text, now = new Date()) {
  const raw = text.trim();

  // Classify what is left after "no," / "actually," — the correction marker is
  // discourse, not content, and leaving it in poisons both intent and title.
  const repair = REPAIR.test(raw);
  let body = repair ? raw.replace(REPAIR, "").trim() : raw;

  let intent = classify(body.toLowerCase());
  if (intent === INTENTS.UNKNOWN) {
    // Nothing matched — before giving up, try it as though it were typed in a
    // hurry. "can you scheduke a 3 o clok" is a booking, not a mystery.
    const fixed = despell(body);
    const retry = classify(fixed.toLowerCase());
    if (retry !== INTENTS.UNKNOWN) {
      intent = retry;
      body = fixed;
    }
  }
  const s = body.toLowerCase();

  // "move X to Y" — the target time is what follows the last "to"/"until".
  let targetPhrase = body;
  let subjectPhrase = body;
  if (intent === INTENTS.MOVE_EVENT) {
    const split = body.match(/^(.*?)\s+\b(?:to|until|till|->)\b\s+(.*)$/i);
    if (split) {
      subjectPhrase = split[1];
      targetPhrase = split[2];
    }
  }

  const when = parseDateTime(targetPhrase, now);
  const durationMins = parseDuration(body);

  let priority = null;
  for (const [re, level] of PRIORITY) {
    if (re.test(s)) {
      priority = level;
      break;
    }
  }

  // "delegate X to Anders" / "assign X to Priya"
  const toPerson = body.match(/\b(?:to|with|for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*$/);
  const people = extractPeople(body);
  const subject = extractSubject(body, people);
  const dateOnly = parseDate(body, now)?.date ?? null;
  const timeOnly = parseTime(body);
  const kindNoun = body.match(KIND_NOUN)?.[1]?.toLowerCase() ?? null;

  // "lunch with priya friday at 12" — nobody writes a verb in front of that.
  // A meeting noun with a time attached is a booking, and the only reason it
  // needed "schedule" in front was that the rules were looking for a verb.
  if (intent === INTENTS.UNKNOWN && kindNoun && (dateOnly || timeOnly)) {
    intent = INTENTS.CREATE_EVENT;
  }

  const slots = {
    when: when?.at ?? null,
    hadTime: when?.hadTime ?? false,
    hadDate: when?.hadDate ?? false,
    durationMins,
    priority,
    person: toPerson ? toPerson[1] : null,
    subjectPhrase,
    targetPhrase,
    // Title with verbs, temporal phrases, and priority wording removed.
    title: cleanTitle(body, people, subject),
    rename: extractRename(body),
    people,
    subject,
    kindNoun,
    // "due friday" marks a deadline rather than a start time.
    isDue: /\bdue\b|\bby\b/.test(s),
    dateOnly,
    timeOnly,
  };

  // A fragment carries information but no verb: "for friday", "make it 30 min",
  // "with Sarah too". On its own it means nothing; against the previous turn it
  // means everything.
  const fragment =
    intent === INTENTS.UNKNOWN &&
    Boolean(dateOnly || timeOnly || durationMins || priority || people.length);

  return {
    text: raw,
    body,
    intent,
    repair,
    amend: AMEND.test(body),
    pronoun: PRONOUN.test(s),
    fragment,
    slots,
  };
}
