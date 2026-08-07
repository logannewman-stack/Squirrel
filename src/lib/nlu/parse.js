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
  EDIT_TASK: "edit_task",
  UNDO: "undo",
  REPEAT_EVENT: "repeat_event",
  RESIZE_EVENT: "resize_event",
  QUERY_FREE: "query_free",
  QUERY_NEXT: "query_next",
  SWAP_EVENTS: "swap_events",
  SPREAD_TASK: "spread_task",
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
 * Is this setting a property on a task?
 *
 * Three shapes, and the first is the one that mattered. People state estimates
 * rather than command them — "the lease is about 45 minutes", "the deck will
 * take 8 hours" — and a rule table built out of imperatives is blind to every
 * one of them.
 */
const SAYS_LENGTH = /\b(?:is|will take|takes|needs|should take|is about|is roughly|is around)\b[^.]*\b(?:\d+(?:\.\d+)?\s*(?:h|hrs?|hours?|m|mins?|minutes?)|an? hour|half an hour|(?:one|two|three|four|five|six|seven|eight|nine|ten|couple|few)\s+(?:and a half\s+)?(?:hours?|minutes?|mins?))/i;
const SAYS_PRIORITY = /\b(?:make|mark|set|bump|flag|treat)\b[^.]*\b(?:critical|urgent|high|low|normal)\b|\bis (?:critical|urgent|high|low)(?: priority)?\b|\b(?:critical|high|low|normal) priority\b/i;
const SAYS_DUE = /\b(?:is |isn'?t |is not )?(?:due|not due until|needed by|wanted by|has to be (?:done|in|ready) by)\b/i;
const SAYS_REOPEN = /\b(?:re-?open|un-?complete|un-?tick|un-?check|not done|isn'?t done|didn'?t (?:actually )?finish|still open|mark .* (?:as )?(?:not done|undone|open))\b/i;
const SAYS_TASK_DELETE = /\b(?:delete|remove|drop|bin|scrap|get rid of)\b[^.]*\btasks?\b|\btasks?\b[^.]*\b(?:delete|removed?)\b/i;
const SAYS_RENAME = /\b(?:rename|re-?title|call it|title it|name it)\b/i;

/**
 * "The Meridian call is on Zoom."
 *
 * A place, stated. The trap is that "the review is on Friday" has the same
 * shape, so the tail has to fail to parse as a date before this can be a
 * location — which is why it is a function rather than another alternation.
 */
const SAYS_PLACE = /\b(?:is|will be|happens|takes place|meets)\s+(?:at|on|in|over)\s+(.{2,40})$/i;

export function placeIn(body, now) {
  const m = body.match(SAYS_PLACE);
  if (!m) return null;
  const tail = m[1].replace(/[.,!?]+$/, "").trim();
  if (!tail || parseDate(tail, now) || parseTime(tail)) return null;
  if (/^(?:my|the)?\s*(?:calendar|schedule|diary|track|hold|time)$/i.test(tail)) return null;
  return tail;
}

/** Making something new carries the same words as changing something old. */
const IS_CREATION = /^\s*(?:add|create|new|make an?|remind me to|todo|i need to|i want to|put|book|schedule|set up)\b/i;

export function isTaskEdit(body) {
  const s = body.toLowerCase();
  // A clock time means a meeting is being talked about, not a task's length.
  if (hasClock(s)) return false;
  // "Add a task to sign the lease, high priority, due Friday" names a priority
  // and a deadline and is nonetheless a creation. The leading verb governs.
  if (IS_CREATION.test(s)) return false;
  return (
    SAYS_LENGTH.test(s) || SAYS_PRIORITY.test(s) || SAYS_REOPEN.test(s) ||
    SAYS_TASK_DELETE.test(s) || SAYS_RENAME.test(s) || Boolean(placeIn(body)) ||
    (SAYS_DUE.test(s) && /\b(?:the|my)\b/.test(s))
  );
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

/**
 * "Right after the board call." "An hour before the standup."
 *
 * Executives do not schedule against the clock nearly as often as they
 * schedule against each other — the debrief goes after the meeting it debriefs,
 * the prep goes before the thing being prepped for. Every one of those
 * sentences used to fall through to "I didn't catch that", because there is no
 * time in them at all.
 *
 * What comes back is the phrase naming the other event, which side of it, and
 * how far. Resolving the phrase is the caller's job — it needs the calendar,
 * and if nothing matches, the sentence is read the ordinary way instead.
 */
const OFFSET_WORD = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, half: 0.5, "a couple": 2, "a couple of": 2 };
const UNIT_MINS = { h: 60, hr: 60, hrs: 60, hour: 60, hours: 60, m: 1, min: 1, mins: 1, minute: 1, minutes: 1 };

const ANCHOR =
  /\b(?:(\d+|an?|one|two|three|four|half an?|a couple(?: of)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\s+)?(right\s+|just\s+|immediately\s+|straight\s+)?(after|before|following|ahead of|prior to)\s+(?:the\s+|my\s+|our\s+|that\s+)?([^,.]+?)\s*[,.]?\s*$/i;

/** Phrases that read as an anchor but name a stretch of time, not a meeting. */
const NOT_AN_ANCHOR =
  /^(?:that|this|it|then|lunch|now|today|tomorrow|tonight|yesterday|the weekend|work|hours?|noon|midday|midnight|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|this week|the week|the day|the morning|the afternoon|the evening|\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/i;

function parseAnchor(text) {
  const m = text.match(ANCHOR);
  if (!m) return null;

  const [, count, unit, , side, phraseRaw] = m;
  const phrase = phraseRaw.trim();
  if (!phrase || NOT_AN_ANCHOR.test(phrase)) return null;

  const rest = text.slice(0, m.index).trim();

  /**
   * "Book 30 minutes after the board call" is thirty minutes long.
   * "Book a debrief 30 minutes after the board call" is thirty minutes later.
   *
   * Same words, opposite meanings, and the thing that separates them is what
   * sits between the verb and the number. If the number is the direct object
   * of the booking verb it is a length; if something else is being booked, the
   * number is the distance. Reading it wrong books an hour-long meeting at the
   * wrong time, which is the sort of error nobody notices until they are late.
   */
  const isLength = count && BARE_BOOKING.test(rest);

  let offsetMins = 0;
  if (count && unit && !isLength) {
    const key = count.toLowerCase().replace(/^half an?$/, "half").replace(/^a couple of$/, "a couple");
    const n = /^\d+$/.test(count) ? Number(count) : (OFFSET_WORD[key] ?? 1);
    const u = unit.toLowerCase();
    offsetMins = Math.round(n * (UNIT_MINS[u] ?? UNIT_MINS[u.replace(/s$/, "")] ?? 1));
  }

  return {
    phrase,
    side: /^(?:before|ahead of|prior to)$/i.test(side) ? "before" : "after",
    offsetMins,
    // The sentence with the anchor removed, so the length and the title are
    // read from what is actually left of it. When the number turned out to be
    // a length rather than a distance, it is put back for `parseDuration`.
    rest: isLength ? `${rest} ${count} ${unit}` : rest,
  };
}

/** Verbs that put something somewhere, without necessarily saying when. */
const PLACE_VERB = /\b(?:put|slot|squeeze|wedge|stick|pop|pencil|schedule|book|add|set up|fit)\b|\bgive me an?\b|\bi (?:need|want)s? an?\b/;

/** A booking verb with nothing between it and what follows. */
const BARE_BOOKING =
  /^(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:book|schedule|put|add|set|make|find|block|slot|pop|stick|get|grab|arrange|pencil|reserve|hold|carve out|set aside)(?:\s+(?:me|us|in|out|up|aside))*$/i;


/**
 * "Bring the standup forward." "Push the board call out a week."
 *
 * A move with no destination — only a direction and, sometimes, a distance.
 * It is how anyone actually talks about nudging a meeting, and it used to be
 * unparseable because every move rule was looking for somewhere to move *to*.
 *
 * Returns null when the sentence also names a real time, because then the
 * direction is decoration: "move it back to Friday at 2" is a move to Friday,
 * not a shift backwards.
 */
const NUDGE_DIR = /\b(forwards?|earlier|sooner|ahead|back|backwards?|later|out|up)\b/i;
const NUDGE_AMOUNT =
  /\b(?:by\s+)?(\d+|an?|one|two|three|four|five|six|half an?|a couple(?: of)?|a few)\s*(hours?|hrs?|h|minutes?|mins?|m|days?|weeks?|wks?)\b/i;
const NUDGE_UNIT = { h: 60, hr: 60, hrs: 60, hour: 60, hours: 60, m: 1, min: 1, mins: 1, minute: 1, minutes: 1,
  day: 1440, days: 1440, week: 10080, weeks: 10080, wk: 10080, wks: 10080 };

function parseNudge(text) {
  const dir = text.match(NUDGE_DIR);
  if (!dir) return null;

  // "up" and "out" are only directions next to a movement verb. Without this,
  // "set up a call" and "sort out Friday" both read as nudges.
  if (/^(?:up|out)$/i.test(dir[1]) && !/\b(?:mov|push|bump|shift|bring|pull|shuffl|slid|knock|kick)\w*\b/i.test(text)) {
    return null;
  }

  const earlier = /^(?:forwards?|earlier|sooner|ahead|up)$/i.test(dir[1]);
  const amt = text.match(NUDGE_AMOUNT);
  let mins = null;
  if (amt) {
    const key = amt[1].toLowerCase().replace(/^half an?$/, "half").replace(/^a couple of$/, "a couple").replace(/^a few$/, "three");
    const n = /^\d+$/.test(amt[1]) ? Number(amt[1]) : (OFFSET_WORD[key] ?? 1);
    const u = amt[2].toLowerCase();
    mins = Math.round(n * (NUDGE_UNIT[u] ?? NUDGE_UNIT[u.replace(/s$/, "")] ?? 1));
  }
  return { dir: earlier ? "earlier" : "later", mins };
}


/**
 * "No meetings before 10 tomorrow." "Nothing after 4 on Friday."
 *
 * A statement about what must *not* be booked, which is the one shape the
 * booking rules could never see — there is no thing being scheduled in it,
 * only a boundary. Kept as a side and read against the working day, so the
 * hold runs from when the day starts rather than from midnight.
 */
const PROTECT =
  /\bno\s+(?:meetings?|calls?|appointments?|anything)\b|\bnothing\b[^.]*\b(?:before|after|until|till|past)\b|\bkeep\b[^.]{0,24}\b(?:free|clear|open)\b|\bprotect\b/i;

function parseProtect(text) {
  if (!PROTECT.test(text)) return null;
  const after = /\b(?:after|past|from)\b/i.test(text) && !/\b(?:before|until|till)\b/i.test(text);
  const side = after ? "after" : "before";

  /**
   * The boundary, read here rather than by `parseTime`.
   *
   * A bare number is normally too ambiguous to be a time — "book 3 with Bob"
   * is three o'clock, not three minutes — so `parseTime` rightly wants an "at"
   * or a meridiem. Directly after "before" or "after" there is no ambiguity
   * left: nothing else in English follows those words in a sentence about a
   * calendar.
   */
  const at = text.match(/\b(?:before|until|till|after|past|from)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i);
  if (!at) return { side, h: null, m: 0 };

  let h = Number(at[1]);
  const m = Number(at[2] || 0);
  const mer = at[3]?.[0]?.toLowerCase();
  if (mer === "p" && h < 12) h += 12;
  else if (mer === "a" && h === 12) h = 0;
  // No meridiem, in a sentence about a working day: single digits below eight
  // are the afternoon. "Nothing after 4" is never four in the morning.
  else if (!mer && h >= 1 && h <= 7) h += 12;

  return { side, h, m };
}

const RULES = [
  // First, and unmissable. Undo is the thing people reach for while something
  // is going wrong, and it must never be shadowed by a verb inside the same
  // sentence — "undo that meeting move" is an undo, not a move.
  [INTENTS.UNDO, /\bundo\b|\bredo that\b|\bput (?:it|that|them) back\b|\brevert\b|\btake (?:that|it) back\b|\bnever ?mind that,? undo\b|\bi didn'?t mean (?:that|to)\b|\bthat was a mistake\b|\bchange (?:that|it) back\b|\brestore\b/],
  [INTENTS.HELP, /\b(help|what can you do|commands?)\b/],
  // Asking what to give up is a triage question, not a cancellation. It has to
  // come this early because "drop", "cut", and "lose" are all cancel verbs, and
  // CANCEL was answering "what should I drop?" with "I couldn't find that on
  // your calendar" — a question about the whole week, answered as a failed
  // lookup of a meeting called "I".
  [INTENTS.PLAN_DAY, /\bwhat should i (?:drop|cut|skip|postpone|shelve|lose|let go)\b|\bwhat (?:can|could) i (?:drop|cut|skip)\b|\bwhat (?:has to|needs to|should) (?:go|give)\b/],
  [INTENTS.INVITE, /\b(invite|send (?:an? )?invit|email .* about|send .* (?:the )?(?:invite|calendar))\b/],
  // Very early, and deliberately narrow. "Finish" belongs to completing a task
  // and "how many hours" to progress, so both are only surrendered when the
  // sentence is unmistakably about the shape of the working day itself.
  [INTENTS.QUERY_HOURS, /\b(?:my |the )?working (?:hours|day|days|week)\b|\bwhat (?:are|is) my hours\b|\bwhat hours do i (?:work|do)\b|\bwhen do i (?:start|finish|stop|knock off)(?:\s+work(?:ing)?)?\s*[?.!]*$|\bhow (?:many|much) (?:hours|time) (?:do|can|should) i (?:work|focus)\b|\bmy (?:daily )?capacity\b|\bwhat days do i work\b|\bdo i work (?:weekends?|saturdays?|sundays?)\b/],
  // `mov(?:e|ing|ed)` rather than `move\w*`: English drops the e, so "moving my
  // 3pm" — which is how half of these arrive — contains no "move" at all.
  // Setting a property on a task that is named rather than pointed at.
  //
  // Ahead of move and cancel on purpose. "Bump the term sheet to critical" is
  // not a reschedule and "delete the diligence index task" is not a
  // cancellation, and both verbs belong to those rules. The object decides.
  // Laying one job across several days, as opposed to setting how long it
  // takes. Ahead of EDIT_TASK because "give the term sheet two hours a day"
  // has the exact shape of an estimate — a task, a number, a unit — and being
  // read as one would quietly replace a six-hour job with a two-hour one.
  [INTENTS.SPREAD_TASK, /\b(?:spread|split|divide|break (?:it |them |this |that )?up|chunk|stagger|stretch|lay)\b[^.]*\b(?:across|over|out|between|into|through|up)\b|\b(?:\d+|an?|one|two|three|four|half an?)\s*(?:h\b|hrs?\b|hours?\b|m\b|mins?\b|minutes?\b)\s*(?:a|per|each|every)\s+day\b/],
  [INTENTS.EDIT_TASK, isTaskEdit],
  // Two meetings changing places. Ahead of MOVE because "swap X and Y" has no
  // move verb in it at all, and a rule that merely tolerated it would move one
  // of the two and leave the other sitting on top of it.
  // Holding time open, said as a prohibition. Ahead of the clearing and
  // cancelling rules because "no meetings before 10" is a fence, not a
  // deletion, and either of those would have read it as one.
  [INTENTS.CREATE_EVENT, (body) => Boolean(parseProtect(body))],
  [INTENTS.SWAP_EVENTS, /\b(?:swap|switch|exchange|trade|flip)\b[^.]*\b(?:and|with|for|round|around)\b/],
  [INTENTS.MOVE_EVENT, /\b(mov(?:e|es|ed|ing)|reschedul\w*|push\w*|shift\w*|bump\w*|postpon\w*|shuffl\w*|slid(?:e|ing)|bring\w*\s+(?:it|that|them|the|my|forward)|pull\w*\s+(?:it|that|them|the|my)\b)\b/],
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
  // `give (?!me)`: "give me something to do" is someone asking for work, not
  // handing it over, and it was being answered with "delegate it to whom?".
  [INTENTS.DELEGATE_TASK, /\b(delegate|hand off|hand over|assign|give\s+(?!me\b|us\b)[^.]{2,30}?\s+to)\b/],
  // Before MOVE, because "shorten"/"extend" are edits to length rather than
  // to when — and "push the review out by an hour" is genuinely ambiguous, so
  // the explicit length verbs win.
  [INTENTS.RESIZE_EVENT, /\b(shorten|lengthen|extend|trim|cut)\b.*\b(?:to|by|in half)\b|\bmake\b.*\b(?:\d+|one|two|three|four|five|half)\s*(?:h\b|hrs?\b|hours?\b|m\b|mins?\b|minutes?\b)/],
  // Questions about one specific thing on the calendar, which want a fact
  // rather than a day's worth of listing.
  // "When is my next meeting" is a question about the calendar, not about a
  // meeting called "next" — which is what QUERY_EVENT tried to look up, and it
  // answered "I couldn't find that on your calendar" to the single most
  // ordinary question anyone asks a diary. Placed ahead of it for that reason;
  // MOVE and CANCEL still win, so "move my next meeting" is a move.
  [INTENTS.QUERY_NEXT, /\b(?:what|when|which)(?:'s| is)?\s+(?:my |the )?next\b|\bwhat'?s (?:up )?next\b|\bnext (?:meeting|thing|one|up|appointment|call)\b|\bwhat'?s after (?:this|that)\b|\bhow long (?:until|till|til|to) (?:my |the )?next\b/],
  [INTENTS.QUERY_EVENT, /\b(?:where(?:'s| is)|how long is|who am i (?:meeting|seeing)|is .* still on|when(?:'s| is) (?:my|the)|what time is (?:my|the))\b/],
  [INTENTS.QUERY_PROGRESS, /\bhow much (?:time|have i|did i)\b|\bhow am i doing\b|\bwhat did i (?:do|finish|get done)\b|\bhow many hours\b|\bhow'?s my (?:focus|week)\b/],
  [INTENTS.PLAN_DAY, /\b(plan (?:my|the)? ?(?:day|week|month)|plan today|what should i (?:do|work on)|priorit\w+ (?:my|the) day|schedule (?:my|the) work|spread .* out|when (?:will|can) i (?:do|finish)|will .* fit|fit .* deadline|most urgent|what'?s urgent|behind on|on track|how much .* left|how (?:is|are) .* (?:going|doing)|triage|give me something to (?:do|work on)|what can i (?:do|work on)|something to work on|what'?s? (?:first|next up)|what should i (?:drop|cut|skip|postpone|shelve|lose)|(?:am|are) i (?:going to |gonna )?(?:make|hit|miss)\b|will i (?:make|hit|miss)\b|what'?s (?:at risk|slipping|in trouble)|falling behind|realistic)\b/],
  [INTENTS.QUERY_FREE, /\b(free|available|open (?:time|slot)|gaps?|any time|when can i|spare (?:time|hour|minutes?))\b/],
  [INTENTS.QUERY_DAY, /\b(what(?:'s| is| does)?|show|list|when|do i have|how many|agenda|(?:my|the) schedule|look like|going on|how (?:busy|full|packed|loaded)|on my plate|how'?s? (?:my|the) (?:day|week)|read me|read back|run me through|walk me through|talk me through|anything (?:on|in|this|that|tomorrow|today|tonight|next|left)|overbooked|over ?committed|over ?loaded|too (?:full|packed))\b/],
  // A series, not a booking. Checked before create, or only the first one of
  // twelve ever reaches the calendar.
  [INTENTS.REPEAT_EVENT, /\bevery (?:day|weekday|week|other week|month|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(?:daily|weekly|fortnightly|biweekly|monthly)\b|\brepeat(?:s|ing)?\b|\brecurring\b|\beach (?:day|week|monday|tuesday|wednesday|thursday|friday)\b/],
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
/**
 * "No, make it Monday."
 *
 * A correction marker, stripped so what follows is read as content.
 *
 * The bare negatives carry an exception, because "no" is also an ordinary
 * determiner: "no meetings before 10" is an instruction about the morning, and
 * stripping the "no" off the front turned it into precisely its opposite. The
 * exception lists the nouns rather than the verbs — what can follow a
 * correction is most of English, and what makes "no" a determiner here is a
 * short closed set of calendar words.
 */
const REPAIR = /^\s*(?:(?:no+|nope|nah|wait|whoops|oops)(?!\s+(?:meetings?|calls?|appointments?|events?|bookings?|commitments?|time|room|space|more|one)\b)|actually|sorry|i meant|i said|not that|scratch that|never ?mind that|instead)\b[\s,.:;!—-]*/i;

/** "make it 3pm", "move it to Friday" — an edit to something already named. */
const AMEND = /^\s*(?:make|change|set|push|move|shift|bump)\s+(?:it|that|this|them)\b/i;

const PRONOUN = /\b(?:it|that one|that|this one|them|those|the meeting|the event|the task|the call)\b/i;

/** A reference to more than one thing already mentioned. */
const PLURAL_PRONOUN = /\b(?:them|those|these|they|both|all of (?:them|it|those)|the rest of (?:them|it)|everything)\b/i;

/** The noun that decides whether a bare booking is a "Call" or a "Meeting". */
const KIND_NOUN = /\b(call|meeting|sync|standup|stand-up|interview|review|1:1|one on one|lunch|dinner|coffee|appointment|catch ?up|break|breather|debrief|prep|block|slot|session|walk|workout|gym|school run|commute|travel|drive|flight|train)\b/i;

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
 * Everything people put in front of a request.
 *
 * Applied in a loop rather than once: "actually, could you please go ahead
 * and…" stacks four of these, and stripping one leaves the rest shielding the
 * verb behind it from the pass meant to remove it. That is how "are you able
 * to schedule an appointment for me this Thursday" landed on the calendar
 * titled "Are you able to schedule an appointment for me" — every slot read
 * correctly, and the one field a person actually looks at holding the question.
 */
/**
 * The wrapper around a request, which is never itself a message.
 *
 * Safe to remove before the sentence is classified, because none of these can
 * stand alone. "When you get a chance, book lunch Friday" was reading as a
 * question about *when*, purely because the courtesy in front of the verb got
 * to the classifier first.
 */
const POLITE_WRAPPER =
  /^\s*(?:please|kindly|just|quickly|go ahead and|do me a favou?r and|if you (?:could|can|would)|whenever you (?:get|have) a (?:chance|moment|sec|second)|when you (?:get|have) a (?:chance|moment|sec|second)|i was wondering if you (?:could|can)|any chance (?:you )?(?:could|can)|do you think you could|is it possible to|would it be possible to|are you able to|would you be able to|can you|could you|would you|will you|would you mind|do you mind|i'?d like(?: you)? to|i want(?: you)? to|i need(?: you)? to|we need to|help me)\b[\s,]*/i;

/**
 * Softer openers, removed only when composing a title.
 *
 * "Hey", "hello" and "okay" are messages in their own right — stripping them
 * before classification would turn "hey there" into "there" and lose the
 * greeting entirely.
 */
const POLITE_SOFT = /^\s*(?:actually|so|ok|okay|hey|hi|hello|right|well|mind|let'?s|lets|we should|for me)\b[\s,]*/i;

/** Peel openers until none is left; people stack three or four of them. */
function stripPolite(text, re = POLITE_WRAPPER) {
  let t = text;
  for (let i = 0; i < 8; i++) {
    const next = t.replace(re, "").replace(POLITE_SOFT, "");
    if (next === t) break;
    t = next;
  }
  return t;
}

/** Only the wrappers, for the classifier. */
export const unwrap = (text) => {
  let t = text;
  for (let i = 0; i < 6; i++) {
    const next = t.replace(POLITE_WRAPPER, "");
    if (next === t) break;
    t = next;
  }
  return t;
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
  return stripPolite(text)
    // "on my calendar" goes first. Strip the leading verb ahead of it and the
    // phrase loses its anchor, leaving the word "calendar" behind as a title.
    .replace(/\s*(?:it|this|that|them)?\s*\b(?:on|in)(?:to)?\s+(?:my|the)\s+(?:calendar|schedule|diary)\b/i, " ")
    .replace(
      /^\s*(?:add|create|make|new|schedule|book|block(?: out| off)?|set up|set aside|carve out|pencil in|pencil|pop in|pop|put down|put|stick(?: in)?|slot in|slot|throw|line up|arrange|organi[sz]e|reserve|hold|open|squeeze in|find|get me|give me|find me|get|remind me to|need to|want to|i need(?: to)?|i want(?: to)?|i'?d like|we need(?: to)?|i have to|i've got to|i gotta|mov(?:e|ing)|reschedul(?:e|ing)|shift(?:ing)?|bump(?:ing)?|postpon(?:e|ing)|push(?:ing)?|cancel(?:l?ing)?|delet(?:e|ing)|remov(?:e|ing)|drop(?:ping)?|clear(?:ing)?|wip(?:e|ing))\s+/i,
      "",
    )
    .replace(/\b(?:a|an|the)\s+(?:task|meeting|call|event|reminder|appointment|sync|standup|stand-up|catch ?up|chat|block|slot|interview|review|1:1|one on one)\s+(?:to|for|called|named)?\s*/i, "")
    // "new task review the deck" — the noun with no article in front of it.
    .replace(/^\s*(?:task|meeting|call|event|reminder)\s+(?:to|for|called|named)?\s*/i, "")
    // "make time for the letter" — the object of the verb is the time itself.
    .replace(/^\s*(?:some\s+)?time\s+(?:for|on|to)\s+/i, "")
    .trim();
}

/** Remove time/date/duration phrases so they don't end up inside a title. */
function stripTemporal(text) {
  return text
    // Recurrence wording. "Every Monday at 9 standup" was booking a series of
    // meetings all called "Every standup".
    .replace(/\b(?:every|each)\s+(?:other\s+)?(?:day|weekday|week|month|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/gi, " ")
    .replace(/\b(?:daily|weekly|fortnightly|bi-?weekly|monthly|recurring|repeat(?:s|ing|ed)?)\b/gi, " ")
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
  // "Rename the board deck to Q3 board deck" names both the thing and the new
  // name. Matching only the tail turned the whole phrase into the new title.
  const both = text.match(/\b(?:rename|re-?title)\s+(?:the\s+|my\s+)?(.+?)\s+(?:to|as)\s+(.+)$/i);
  const m = both ? [both[0], both[2]]
    : text.match(/\b(?:call it|rename(?:\s+it)?(?:\s+to)?|title it|name it)\s+(.+)$/i);
  if (!m) return null;
  const cleaned = m[1].replace(/^[\s"“'’]+|[\s"”'’.,]+$/g, "").trim();
  if (!cleaned) return null;
  return cleaned[0].toUpperCase() + cleaned.slice(1);
}

/** The half of "rename X to Y" that says which thing. */
function renameSubject(text) {
  const m = text.match(/\b(?:rename|re-?title)\s+(?:the\s+|my\s+)?(.+?)\s+(?:to|as)\s+.+$/i);
  return m ? m[1].trim() : null;
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
  /^(?:meetings?|calls?|events?|syncs?|chats?|1:1|one on one|appointments?|catch ?up|blocks?|times?|slots?|lunch|dinner|breakfast|coffee|drinks|standups?|stand-ups?|interviews?|reviews?|for|about|on|in|at|to|by|from|with|and|it|that|this|them|those|an?|the|re|my|our|your|me|us|you|i|mine|ours)$/i;

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
  // "a quick 15 with Priya" is fifteen minutes long, not a meeting called
  // "Quick 15" — the length is read elsewhere and has no business in the name.
  t = t.replace(/\b(?:quick|fast|short|brief|little)\s+\d{1,3}\b/gi, " ");
  t = t.replace(/\s{2,}/g, " ").trim();
  // Peel connectors, articles, and stranded pronouns off both ends until
  // nothing changes: "for the board deck" is a phrase from the command,
  // "Board deck" is the thing itself, and "it for" is nothing at all.
  // Whitespace is required after each word so "On-site review" survives.
  let prev;
  do {
    prev = t;
    t = t.replace(/^(?:for|about|on|in|at|to|with|re|called|named|and|it|that|this|them|those|a|an|the|my|our|me|us|you|from)\s+/i, "");
    t = t.replace(/\s+(?:for|about|on|in|at|to|by|from|with|and|it|that|me|us)$/i, "");
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

  // Classified without the courtesy in front of it. "When you get a chance,
  // book lunch Friday" is a booking; left wrapped, the "when" made it a
  // question about the calendar.
  let intent = classify(unwrap(body).toLowerCase());
  if (intent === INTENTS.UNKNOWN) {
    // Nothing matched — before giving up, try it as though it were typed in a
    // hurry. "can you scheduke a 3 o clok" is a booking, not a mystery.
    const fixed = despell(body);
    const retry = classify(unwrap(fixed).toLowerCase());
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
  // The anchor is read first and its span cut out before the length is looked
  // for, or "an hour before the board call" books an hour-long meeting at some
  // default time instead of a meeting one hour earlier than the board call.
  const anchor = parseAnchor(body);
  const durationMins = parseDuration(anchor ? anchor.rest : body);

  let priority = null;
  for (const [re, level] of PRIORITY) {
    if (re.test(s)) {
      priority = level;
      break;
    }
  }

  // "delegate X to Anders" / "assign X to Priya"
  const toPerson = body.match(/\b(?:to|with|for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*$/);
  // With an anchor present, everything descriptive is read from the half of
  // the sentence that isn't the anchor. Otherwise "put a debrief right after
  // the board call" is titled "Debrief right after the board call", and the
  // meeting it is named for ends up inside its own name.
  const said = anchor ? anchor.rest : body;
  const people = extractPeople(said);
  const subject = extractSubject(said, people);
  // A move carries two of everything: where it is now, and where it is going.
  // Scanning the whole sentence finds the first date in it, which is the one
  // being moved *away from* — so "move that appointment from tomorrow at 4 to
  // Saturday at 2" resolved to tomorrow at 4 and reported nothing had changed.
  const whenPhrase = targetPhrase === body ? body : targetPhrase;
  const dateOnly = parseDate(whenPhrase, now)?.date ?? null;
  let timeOnly = parseTime(whenPhrase);
  // "Make it 1." In a correction there is nothing else a bare number can be —
  // the thing being corrected already exists, so the number is not a length,
  // a count, or a person. Everywhere else it stays ambiguous and is left alone.
  if (!timeOnly && AMEND.test(body)) {
    const bare = body.match(/\b(?:make|change|set|move|shift|push|bump)\s+(?:it|that|this|them)\s+(?:to\s+)?(\d{1,2})(?::(\d{2}))?\s*$/i);
    if (bare) {
      let h = Number(bare[1]);
      // A working day, so single digits below eight are the afternoon.
      if (h >= 1 && h <= 7) h += 12;
      timeOnly = { h, m: Number(bare[2] || 0), source: "amend" };
    }
  }
  const kindNoun = body.match(KIND_NOUN)?.[1]?.toLowerCase() ?? null;

  // "lunch with priya friday at 12" — nobody writes a verb in front of that.
  // A meeting noun with a time attached is a booking, and the only reason it
  // needed "schedule" in front was that the rules were looking for a verb.
  if (intent === INTENTS.UNKNOWN && kindNoun && (dateOnly || timeOnly)) {
    intent = INTENTS.CREATE_EVENT;
  }

  // "I need an hour with Bob Thursday at 2." "Quick 15 with Priya."
  //
  // No booking verb anywhere in either, because people state what they need as
  // often as they command it. A length and a person together is a request for
  // a meeting whatever else is in the sentence; with a day attached it is a
  // complete one, and without a day the handler asks — which is a far better
  // answer than not understanding the sentence at all.
  //
  // Only reached when every rule above declined, so the verbs that mean
  // something else have already had their turn.
  if (intent === INTENTS.UNKNOWN && durationMins && (people.length || kindNoun || dateOnly || timeOnly)) {
    intent = INTENTS.CREATE_EVENT;
  }

  // "Put a debrief right after the board call." There is no clock in that
  // sentence at all, which is exactly why every phrasing like it fell through
  // — the booking rules are looking for a time and this names a position
  // instead. Something has to be being placed, though: a kind of meeting, a
  // person, or a placement verb. "After the board call" on its own is a
  // fragment and belongs to the follow-up machinery, not to a new booking.
  if (intent === INTENTS.UNKNOWN && anchor && (kindNoun || people.length || PLACE_VERB.test(s))) {
    intent = INTENTS.CREATE_EVENT;
  }

  const slots = {
    when: when?.at ?? null,
    hadTime: when?.hadTime ?? false,
    hadDate: when?.hadDate ?? false,
    durationMins,
    priority,
    person: toPerson ? toPerson[1] : null,
    // "Rename X to Y" carries its own subject, and it is not the whole line.
    subjectPhrase: renameSubject(body) || subjectPhrase,
    targetPhrase,
    // Title with verbs, temporal phrases, and priority wording removed.
    title: cleanTitle(said, people, subject),
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
    // "after the board call" — a position relative to something else on the
    // calendar. Null unless the sentence actually names one; resolving it to a
    // real event happens where the calendar is in hand.
    anchor,
    // "forward an hour" — a direction with no destination. Read only when the
    // sentence names no actual time: "move it back to Friday at 2" is a move to
    // Friday, and treating the word "back" there as a shift would send a
    // meeting into last week.
    // A named day is *scope* — "move everything on Wednesday an hour later"
    // says which meetings, not where they go. Only an actual clock time means
    // a destination was given, and only that cancels the nudge.
    nudge: when?.hadTime ? null : parseNudge(body),
    // Which side of the named time has to stay empty, if either.
    protect: parseProtect(body),
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
