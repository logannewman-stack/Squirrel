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
  [INTENTS.PLAN_DAY, /\b(plan (?:my|the)? ?day|plan today|what should i (?:do|work on)|priorit\w+ (?:my|the) day)\b/],
  [INTENTS.QUERY_FREE, /\b(free|available|open (?:time|slot)|any (?:time|gaps?)|when can i)\b/],
  [INTENTS.QUERY_DAY, /\b(what(?:'s| is| does)?|show|list|when|do i have|how many|agenda|(?:my|the) schedule|look like|going on)\b/],
  [INTENTS.CREATE_EVENT, /\b(schedule|book|block|set up|put .* (?:on|in) (?:my|the) calendar|add .* (?:meeting|call|event))\b/],
  [INTENTS.CREATE_TASK, /\b(add|create|new|remind me to|need to|todo)\b/],
];

const PRIORITY = [
  [/\b(critical|urgent|asap|drop everything)\b/, "critical"],
  [/\b(high priority|important|high)\b/, "high"],
  [/\b(low priority|whenever|low|someday)\b/, "low"],
];

/** Strip leading command verbs so the remainder reads as a title. */
function stripVerbs(text) {
  return text
    .replace(/^\s*(?:can you|could you|please|hey|ok|okay)\s+/i, "")
    .replace(/^\s*(?:add|create|new|schedule|book|block|set up|remind me to|i need to)\s+/i, "")
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

/**
 * "with Bob and Sarah" → the people. Capitalisation is the signal, since a
 * lowercase word after "with" is far more likely to be "with the team" than a
 * name we should put on an invite.
 */
function extractPeople(text) {
  const m = text.match(/\bwith\s+([A-Z][\w'-]*(?:\s+(?:and\s+|,\s*)[A-Z][\w'-]*)*)/);
  if (!m) return [];
  return m[1]
    .split(/\s+and\s+|,\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** "about the Q3 pipeline" / "re: financials" → what the meeting covers. */
function extractSubject(text) {
  const m = text.match(/\b(?:about|regarding|re:?|to discuss|to go over|covering)\s+(.+)$/i);
  if (!m) return null;
  const cleaned = stripTemporal(m[1]).replace(/^[\s,;:.\-]+|[\s,;:.\-]+$/g, "").trim();
  return cleaned || null;
}

/**
 * Produce the title a human would have typed.
 *
 * Everything the parser consumed as a slot has to come back out of the title,
 * or it shows up in the UI as "sign the Munich lease, high priority," — the
 * command echoed back rather than a task name. Leading connectors and stray
 * punctuation go too: "for the board deck" should read "Board deck".
 */
function cleanTitle(text) {
  let t = stripVerbs(text)
    .replace(/\b(?:about|regarding|re:?|to discuss|to go over|covering)\s+.+$/i, " ")
    .replace(/\bwith\s+[A-Z][\w'-]*(?:\s+(?:and\s+|,\s*)[A-Z][\w'-]*)*/g, " ");
  t = stripTemporal(t);
  t = t.replace(/\b(?:high priority|low priority|critical|urgent|asap|drop everything)\b/gi, " ");
  t = t.replace(/\s{2,}/g, " ").trim();
  // Drop a leading connector and any article behind it: "for the board deck"
  // is a phrase from the command, "Board deck" is the thing itself.
  t = t.replace(/^(?:for|about|on|to|with|re|called|named)\s+/i, "");
  t = t.replace(/^(?:a|an|the)\s+/i, "");
  t = t.replace(/^[\s,;:.\-]+|[\s,;:.\-]+$/g, "").trim();
  if (!t) return null;
  return t[0].toUpperCase() + t.slice(1);
}

/**
 * @returns {{intent: string, slots: object, text: string}}
 */
export function parse(text, now = new Date()) {
  const raw = text.trim();
  const s = raw.toLowerCase();

  let intent = INTENTS.UNKNOWN;
  for (const [name, re] of RULES) {
    if (re.test(s)) {
      intent = name;
      break;
    }
  }

  // "move X to Y" — the target time is what follows the last "to"/"until".
  let targetPhrase = raw;
  let subjectPhrase = raw;
  if (intent === INTENTS.MOVE_EVENT) {
    const split = raw.match(/^(.*?)\s+\b(?:to|until|till|->)\b\s+(.*)$/i);
    if (split) {
      subjectPhrase = split[1];
      targetPhrase = split[2];
    }
  }

  const when = parseDateTime(targetPhrase, now);
  const durationMins = parseDuration(raw);

  let priority = null;
  for (const [re, level] of PRIORITY) {
    if (re.test(s)) {
      priority = level;
      break;
    }
  }

  // "delegate X to Anders" / "assign X to Priya"
  const toPerson = raw.match(/\b(?:to|with|for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*$/);

  return {
    text: raw,
    intent,
    slots: {
      when: when?.at ?? null,
      hadTime: when?.hadTime ?? false,
      hadDate: when?.hadDate ?? false,
      durationMins,
      priority,
      person: toPerson ? toPerson[1] : null,
      subjectPhrase,
      targetPhrase,
      // Title with verbs, temporal phrases, and priority wording removed.
      title: cleanTitle(raw),
      people: extractPeople(raw),
      subject: extractSubject(raw),
      // "due friday" marks a deadline rather than a start time.
      isDue: /\bdue\b|\bby\b/.test(s),
      dateOnly: parseDate(raw, now)?.date ?? null,
      timeOnly: parseTime(raw),
    },
  };
}
