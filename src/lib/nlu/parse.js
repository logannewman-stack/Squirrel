/**
 * Intent classification.
 *
 * Ordered rules, most specific first — "cancel the 3pm and book a 4pm" should
 * classify as cancel, not create, because the leading verb governs. Each intent
 * declares which slots it needs; missing slots become one targeted question
 * rather than a guess.
 */

import { parseDateTime, parseDuration, parseTime, parseDate, parseRange } from "./datetime.js";

export const INTENTS = {
  MOVE_EVENT: "move_event",
  CANCEL_EVENT: "cancel_event",
  CLEAR_RANGE: "clear_range",
  CREATE_EVENT: "create_event",
  CREATE_TASK: "create_task",
  COMPLETE_TASK: "complete_task",
  DELEGATE_TASK: "delegate_task",
  INVITE: "invite",
  QUERY_DAY: "query_day",
  QUERY_EVENT: "query_event",
  QUERY_PROGRESS: "query_progress",
  QUERY_HOURS: "query_hours",
  RESIZE_EVENT: "resize_event",
  QUERY_FREE: "query_free",
  PLAN_DAY: "plan_day",
  HELP: "help",
  UNKNOWN: "unknown",
};

/**
 * Emptying a stretch of calendar, as opposed to cancelling one thing.
 *
 * These were the same intent for far too long, and the single-event resolver
 * answered "I couldn't find that on your calendar" to "can you clear my
 * calendar" — a sentence with nothing ambiguous in it. Three separate signals
 * point at a bulk operation and any one is enough:
 */

/** Verbs that only ever mean "empty this out". */
const CLEAR_VERB = /\b(?:clear|clean|wipe|empty|blank|scrub|purge|nuke|blow away|free up|freeing up|get rid of)\b/;

/**
 * The subset that cannot mean anything else.
 *
 * "Clear it" and "wipe it" are about a stretch of time — there is no such
 * thing as clearing a single meeting. "Get rid of it" and "free up" are softer
 * and can point at one thing, so they are left out: with them in, "get rid of
 * it" after naming one meeting would empty the day it sits in.
 */
const SWEEP_VERB = /\b(?:clear|clean|wipe|empty|blank|scrub|purge|nuke|blow away)\b/;

/** A back-reference to whatever was just being discussed. */
const POINTS_BACK = /\b(?:it|that|this|them|those|these|my day|the day|my week|the week)\b/;

/** Verbs that remove one thing or many, depending on what follows. */
const REMOVE_VERB = /\b(?:cancel\w*|delete|remove|drop|kill|scrap|bin|axe|ditch|nix|call off|take off|clear out)\b/;

/** An object that is plainly plural or total. */
const BULK_OBJECT =
  /\b(?:everything|every ?thing|anything|all|whole|entire|the rest|the lot|meetings|appointments|events|calls|bookings|commitments|things|them|those|these|both)\b/;

/** A span of time, as opposed to a thing sitting inside one. */
const SPAN_WORD =
  /\b(?:calendar|schedule|diary|agenda|day|days|morning|afternoon|evening|tonight|week|weekend|month|today|tomorrow|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/;

/**
 * Words that survive the strip only if the sentence names something specific.
 *
 * "Clear my Friday" leaves nothing behind; "cancel the board prep" leaves
 * "board prep". That residue is the whole test — a sentence made entirely of
 * verbs, possessives, calendar nouns, and dates is talking about a span, and a
 * sentence with a noun left in it is talking about a thing.
 */
const SPAN_FILLER = new RegExp(
  "\\b(?:" +
  "can|could|would|will|you|please|kindly|mind|do|me|a|favou?r|i|id|i'd|want|need|would like|lets|let's|" +
  "my|our|the|this|that|these|those|all|whole|entire|full|rest|lot|of|for|on|in|at|from|to|and|out|off|up|" +
  "next|last|coming|following|upcoming|couple|few|several|\\d+|" +
  "clear|clean|wipe|empty|blank|scrub|purge|nuke|blow|away|free|get|rid|take|" +
  "cancel\\w*|delete|remove|drop|kill|scrap|bin|axe|ditch|nix|" +
  "calendar|schedule|diary|agenda|day|days|everything|every|thing|things|anything|" +
  "meetings?|appointments?|events?|calls?|bookings?|commitments?|blocks?|slots?|" +
  "please|now|entirely|completely|totally|just|already|" +
  "them|those|it|there" +
  ")\\b", "gi");

/**
 * True when what is left after stripping is nothing at all.
 * Temporal phrases go first, so "clear my Friday afternoon" empties out.
 */
function spanOnly(body) {
  const rest = stripTemporal(body)
    .replace(SPAN_FILLER, " ")
    .replace(/[^a-z0-9]/gi, "");
  return rest.length === 0;
}

/**
 * Booking time is not clearing time.
 *
 * "Free up an hour Thursday" and "free up Thursday" share a verb and mean
 * opposite things. A duration means make room; a span means empty it.
 */
const WANTS_ROOM = /\b(?:free up|make|find|carve out|set aside|squeeze in|block(?: out)?)\b[^.]*\b(?:\d+\s*(?:h|hrs?|hours?|m|mins?|minutes?)|an? hour|half an hour|some time|time)\b/;

/** "take Friday off my calendar" — a removal verb split around its object. */
const TAKE_OFF = /\btake\s+(.{2,24}?)\s+off (?:my|the)\s+(?:calendar|schedule|diary)\b/i;

/** Does this sentence ask for a whole stretch to be emptied? */
export function isClearRange(body) {
  const s = body.toLowerCase();
  if (WANTS_ROOM.test(s)) return false;
  // "Take Friday off my calendar" names a day; "take the standup off my
  // calendar" names a meeting. Same shape, and only the object separates them.
  const takeOff = s.match(TAKE_OFF);
  if (takeOff) return spanOnly(takeOff[1]) && SPAN_WORD.test(takeOff[1]);
  const clears = CLEAR_VERB.test(s);
  const removes = REMOVE_VERB.test(s);
  if (!clears && !removes) return false;
  // A clearing verb aimed at a span: "wipe Friday", "clear my afternoon".
  if (clears && (SPAN_WORD.test(s) || BULK_OBJECT.test(s))) return true;
  // Or at whatever was just being talked about: "clear it", "wipe that".
  if (SWEEP_VERB.test(s) && POINTS_BACK.test(s)) return true;
  // A removal verb aimed at something plural: "cancel all my meetings Friday".
  if (removes && BULK_OBJECT.test(s)) return true;
  // A removal verb aimed at a bare day, with no thing named and no clock time
  // to pick one out: "cancel Friday", "take Thursday off my calendar".
  return removes && SPAN_WORD.test(s) && spanOnly(body) && !hasClock(s);
}

/**
 * A time made of digits, as opposed to a part of the day.
 *
 * "Cancel my 4pm" names one meeting; "clear my afternoon" names a stretch.
 * `parseTime` answers both with an hour, so the distinction has to be drawn
 * here or every "cancel my 4pm" becomes a request to empty the afternoon.
 */
const hasClock = (s) => /\d\s*(?:am|pm|a\.m\.|p\.m\.|:\d{2})|\bat\s+\d|\b\d{1,2}\s*o'?\s*c?l[o0]?c?k\b/i.test(s);

/**
 * "Cancel Friday's 1pm and rebook it Saturday at 2" — two verbs, one intention.
 *
 * Read literally this is a cancellation followed by a booking, and handling it
 * that way loses the attendees, the length, and the title. It is a move, and
 * the only hard part is that the two halves each carry a date: without the
 * split, the target time parses out of the first half and the meeting moves to
 * where it already was.
 */
const CANCEL_THEN_REBOOK =
  /\b(?:cancel\w*|delete|remove|drop|scrap|move|push)\b(.+?)(?:,\s*)?\b(?:and|then|&)\s+(?:can you\s+|please\s+)?(?:re-?schedul\w*|re-?book\w*|re-?arrange|rearrange|move|put|book|set|slot|pop|stick|do)\b\s*(?:it|that|this|them|the\s+\w+)?\s*(?:back\s+)?(?:for|to|on|at|in)\b(.+)$/i;

const RULES = [
  [INTENTS.HELP, /\b(help|what can you do|commands?)\b/],
  [INTENTS.INVITE, /\b(invite|send (?:an? )?invit|email .* about|send .* (?:the )?(?:invite|calendar))\b/],
  // Very early, and deliberately narrow. "Finish" belongs to completing a task
  // and "how many hours" to progress, so both are only surrendered when the
  // sentence is unmistakably about the shape of the working day itself.
  [INTENTS.QUERY_HOURS, /\b(?:my |the )?working (?:hours|day|days|week)\b|\bwhat (?:are|is) my hours\b|\bwhat hours do i (?:work|do)\b|\bwhen do i (?:start|finish|stop|knock off)(?:\s+work(?:ing)?)?\s*[?.!]*$|\bhow (?:many|much) (?:hours|time) (?:do|can|should) i (?:work|focus)\b|\bmy (?:daily )?capacity\b|\bwhat days do i work\b|\bdo i work (?:weekends?|saturdays?|sundays?)\b/],
  [INTENTS.MOVE_EVENT, /\b(move|reschedul\w*|push|shift|bump|postpone)\b/],
  // Before cancel, after move: "move everything on Friday to Monday" is a bulk
  // move and stays a move; "cancel everything on Friday" is a bulk clear.
  [INTENTS.CLEAR_RANGE, isClearRange],
  // `cancel\w*` on purpose: "cancelled" and "cancelling" have no word boundary
  // after "cancel", so the strict form missed every past-tense report — and
  // people report as often as they command. "The exec staff is cancelled" is
  // not a request but it means exactly one thing.
  [INTENTS.CANCEL_EVENT, /\b(cancel\w*|delete|remove|drop|call off|scrap|bin|kill|nix|axe|ditch|scratch)\b|\btake .* off (?:my|the) calendar\b|\b(?:is|are|has been|have been) (?:off|cancelled|canceled)\b|\bno longer (?:need|needed|happening)\b|\b(?:don'?t|do not|dont|didn'?t) (?:need|want)\b.*\b(?:any ?more|any longer)?\b|\bnot happening\b|\bfell through\b|\bwe'?re not doing\b/],
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
  // Booking verbs, which is most of them. Every one of these was a real
  // sentence that fell through to "I didn't catch that" — people reach for a
  // startling number of words for "put this on the calendar".
  [INTENTS.CREATE_EVENT, /\b(schedule|book|block|set up|pencil in|pencil|hold|reserve|pop in|stick in|slot in|line up|put .* (?:on|in) (?:my|the) calendar|get .* (?:on|in) (?:my|the) calendar|(?:find|make|set aside|carve out|free up|squeeze in) .*(?:time|hours?|minutes?)|(?:give|get|book) me\b.*\b(?:hour|minutes?|time|slot)|add .* (?:meeting|call|event))\b/],
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

/** A reference to more than one thing already mentioned. */
const PLURAL_PRONOUN = /\b(?:them|those|these|they|both|all of (?:them|it|those)|the rest of (?:them|it)|everything)\b/i;

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

/**
 * A rule is a regex or a predicate. Most questions are answerable by pattern;
 * "is this a span or a thing?" is not, and forcing it into one produced a
 * regex nobody could safely edit.
 */
const classify = (s) => {
  for (const [name, rule] of RULES) {
    if (typeof rule === "function" ? rule(s) : rule.test(s)) return name;
  }
  return INTENTS.UNKNOWN;
};

/**
 * Strip leading command verbs so the remainder reads as a title.
 *
 * The list is long because the verb is the one word nobody notices they typed.
 * "Put a meeting with Ronnie at 11" was landing on the calendar as "Put" —
 * every slot correctly extracted, and the one field a human reads left holding
 * the imperative.
 */
function stripVerbs(text) {
  return text
    // "on my calendar" goes first. Strip the leading verb ahead of it and the
    // phrase loses its anchor, leaving the word "calendar" behind as a title.
    .replace(/\s*(?:it|this|that|them)?\s*\b(?:on|in)(?:to)?\s+(?:my|the)\s+(?:calendar|schedule|diary)\b/i, " ")
    .replace(/^\s*(?:can you|could you|would you|will you|please|hey|ok|okay|i'?d like(?: you)? to|i want(?: you)? to|i need(?: you)? to|let'?s|lets)\s+/i, "")
    .replace(
      /^\s*(?:add|create|make|new|schedule|book|block(?: out| off)?|set up|set aside|carve out|pencil in|pencil|pop in|pop|put down|put|stick(?: in)?|slot in|slot|throw|line up|arrange|organi[sz]e|reserve|hold|open|squeeze in|find|get me|give me|find me|get|remind me to|need to|want to)\s+/i,
      "",
    )
    .replace(/\b(?:a|an|the)\s+(?:task|meeting|call|event|reminder)\s+(?:to|for|called|named)?\s*/i, "")
    // "new task review the deck" — the noun with no article in front of it.
    .replace(/^\s*(?:task|meeting|call|event|reminder)\s+(?:to|for|called|named)?\s*/i, "")
    // "make time for the letter" — the object of the verb is the time itself.
    .replace(/^\s*(?:some\s+)?time\s+(?:for|on|to)\s+/i, "")
    .trim();
}

/** Remove time/date/duration phrases so they don't end up inside a title. */
function stripTemporal(text) {
  return text
    .replace(/\b(?:on|at|for|by|due)?\s*\b(?:next|this|coming)?\s*\b(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)(?:day|nesday|rsday|urday)?\b/gi, " ")
    .replace(/\b(?:today|tomorrow|tonight|yesterday|tmrw)\b/gi, " ")
    // "2 to 4", "9 until 11:30" — a span written as two clock times. Left in,
    // it becomes the title: "hold thursday 2 to 4" booked a meeting called
    // "2 to 4".
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:to|until|till|–|-)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, " ")
    .replace(/\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)\b/gi, " ")
    // Bare "at 10" with no meridiem — otherwise it survives into a title or
    // subject as trailing noise.
    .replace(/\b\d{1,2}\s*o'?\s*c?l[o0]?c?k\b/gi, " ")
    .replace(/\bat\s+\d{1,2}(?::\d{2})?\b/gi, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:h|hrs?|hours?|m|mins?|minutes?)\b/gi, " ")
    .replace(/\b(?:half an hour|an hour|a hour)\b/gi, " ")
    .replace(/\b(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple|few|several|half)\s+(?:of\s+)?(?:and a half\s+)?(?:hours?|hrs?|minutes?|mins?)\b/gi, " ")
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
    t = t.replace(/^(?:for|about|on|in|at|to|with|re|called|named|and|it|that|this|them|those|a|an|the|my|our)\s+/i, "");
    t = t.replace(/\s+(?:for|about|on|in|at|to|by|from|with|and|it|that)$/i, "");
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

  // "cancel the Friday 1pm and rebook it Saturday at 2" — a move written as
  // two commands. Checked before anything else reads the sentence, because
  // every slot below would otherwise be pulled from the wrong half of it.
  let targetPhrase = body;
  let subjectPhrase = body;
  const compound = body.match(CANCEL_THEN_REBOOK);
  if (compound) {
    intent = INTENTS.MOVE_EVENT;
    subjectPhrase = compound[1].trim();
    targetPhrase = compound[2].trim();
  } else if (intent === INTENTS.MOVE_EVENT) {
    // "move X to Y" — the target time is what follows the first "to"/"until".
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
  // A compound carries two of everything. The half after "and rebook it" is
  // the one that says where the meeting is going.
  const whenPhrase = compound ? targetPhrase : body;
  const dateOnly = parseDate(whenPhrase, now)?.date ?? null;
  const timeOnly = parseTime(whenPhrase);
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
    // The stretch of calendar this names, if it names one. Distinct from
    // `dateOnly`: "this week" is Friday as a deadline and Monday-to-Sunday as
    // a span, and only one of those is right for emptying a calendar.
    range: parseRange(body, now),
    // Digits, not "afternoon" — the difference between naming one meeting and
    // naming a stretch of the day.
    hadClock: hasClock(s),
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
    // "remove them" points at a set, "remove it" at one thing. Answering the
    // first as though it were the second cancels one meeting out of four and
    // reports success.
    plural: PLURAL_PRONOUN.test(s),
    compound: Boolean(compound),
    fragment,
    slots,
  };
}
