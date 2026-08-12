/**
 * Intent classification.
 *
 * Ordered rules, most specific first — "cancel the 3pm and book a 4pm" should
 * classify as cancel, not create, because the leading verb governs. Each intent
 * declares which slots it needs; missing slots become one targeted question
 * rather than a guess.
 */

import { parseDateTime, parseDuration, parseTime, parseDate, parseRange, atLocal, TERSE_CLOCK } from "./datetime.js";

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
  EDIT_ATTENDEES: "edit_attendees",
  SPREAD_TASK: "spread_task",
  PLAN_DAY: "plan_day",
  CREATE_PROJECT: "create_project",
  QUERY_PROJECTS: "query_projects",
  WHICH_PROJECT: "which_project",
  RENAME_PROJECT: "rename_project",
  ARCHIVE_PROJECT: "archive_project",
  REOPEN_PROJECT: "reopen_project",
  PROJECT_DUE: "project_due",
  FILE_TASK: "file_task",
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
// `deadline` was missing, so "push the board deck deadline to Friday" fell
// past EDIT_TASK to MOVE_EVENT two rules later and moved an actual meeting.
// The noun is how most people say it; the adjective "due" is the minority form.
const SAYS_DUE = /\b(?:is |isn'?t |is not )?(?:due|deadline|not due until|needed by|wanted by|has to be (?:done|in|ready) by)\b/i;
/**
 * The same statements with every word that makes them sentences taken out:
 * "board deck: 8h", "lease 45m", "term sheet critical", "deck due fri".
 *
 * This is how somebody who has typed it a hundred times types it, and none of
 * the rules above can see any of it — `SAYS_LENGTH` is built out of the
 * copula, and `SAYS_DUE` leans on an article that the terse register does not
 * have. A colon is optional, because half of these are written without one.
 *
 * Two guards, and both are load-bearing. The head may not open with a command
 * verb, or "block 2h" and "give me 30 mins" become estimates on tasks that do
 * not exist. And it must contain a letter and be followed by real whitespace,
 * or the head matches the digits of the value itself and "90m" reads as a task
 * called "9" that will take ten minutes. `isTaskEdit` adds the third: the line
 * may not name a kind of meeting.
 */
const TERSE_HEAD =
  "^(?!(?:book|schedule|add|create|make|move|shift|push|bump|cancel|delete|remove|drop|" +
  "clear|wipe|block|hold|pencil|slot|put|find|reserve|give|get|carve|squeeze|set|spread|split)\\b)" +
  "[\\w'’&.-]*[a-z][\\w'’&.-]*(?:\\s+[\\w'’&.-]+){0,3}\\s*[:,]?\\s+";
const SAYS_LENGTH_TERSE = new RegExp(
  `${TERSE_HEAD}(?:\\d{1,2}\\s*h(?:rs?|ours?)?\\s*\\d{1,2}\\s*(?:m|mins?|minutes?)?` +
  `|\\d+(?:\\.\\d+)?\\s*(?:h|hrs?|hours?|m|mins?|minutes?))\\s*[.!]*$`, "i");
const SAYS_PRIORITY_TERSE =
  new RegExp(`${TERSE_HEAD}(?:critical|urgent|high|low|normal)(?:\\s+priority)?\\s*[.!]*$`, "i");
/** "deck due fri", "term sheet: 2h, due friday" — a deadline with no article. */
const SAYS_DUE_TERSE = /^[\w'’&.-]*[a-z][\w'’&.-]*(?:[\s,:;]+[\w'’&.-]+){0,5}[\s,:;]+(?:due|deadline)\b/i;
/**
 * The office shorthand for a deadline, which contains the word "due" nowhere.
 *
 * "I need the letter by EOW" and "the review needs to be done by close" are
 * deadlines stated the way anyone in an office states them, and every one of
 * them fell through to "I didn't catch that". The preposition is required:
 * bare "close" and bare "first thing" are ordinary words, and only "by close"
 * and "for first thing" are unmistakably a date.
 */
const SAYS_DUE_IDIOM =
  /\b(?:by|for|before|due)\s+(?:the\s+)?(?:eod|e\.o\.d|cob|c\.o\.b|eow|e\.o\.w|eop|close of (?:business|play)|close|end of (?:play|business|day|week|month|the (?:day|week|month))|first thing|start of play)\b/i;
const SAYS_REOPEN = /\b(?:re-?open|un-?complete|un-?tick|un-?check|not done|isn'?t done|didn'?t (?:actually )?finish|still open|mark .* (?:as )?(?:not done|undone|open))\b/i;
const SAYS_TASK_DELETE = /\b(?:delete|remove|drop|bin|scrap|get rid of)\b[^.]*\btasks?\b|\btasks?\b[^.]*\b(?:delete|removed?)\b/i;
const SAYS_RENAME = /\b(?:rename|re-?title|call it|title it|name it)\b/i;
/**
 * Work put down rather than done. "Park the board deck." "Shelve it for now."
 *
 * Every one of these fell through to "I didn't catch that", which is a strange
 * answer to the commonest thing anyone says about a list that got too long. It
 * is an edit to a task and not a deletion of one — "kill the Monday sync" is
 * genuinely a cancellation and keeps its own rule; parking is reversible and
 * deleting is not, so the two must not share a verb list.
 *
 * The leading form is anchored on purpose. "Table" is a noun far more often
 * than it is a verb, and an unanchored one would read "book a table for
 * Friday" as a request to deprioritise something.
 */
const SAYS_PARKED =
  /^\s*(?:(?:let'?s|lets|we should|we can|maybe|just|please|can we|i'?ll)\s+)*(?:park|shelve|table|backlog|punt|de-?prioriti[sz]e)\b/i;
/** The same thing said mid-sentence, where the object pins the verb down. */
const SAYS_PARKED_OBJECT =
  /\b(?:park|shelve|backlog|punt|de-?prioriti[sz]e)(?:s|d|ed|ing)?\s+(?:it|that|this|them|the|my|our)\b/i;
/**
 * "Put the deck on the back burner." "Put it on hold."
 *
 * Opens with a creation verb and creates nothing, so it is settled ahead of
 * the guard below that would otherwise hand the sentence to CREATE_EVENT.
 * Safe to put there because the idiom is unmistakable — nothing else in a
 * calendar is on a back burner.
 */
const BACK_BURNER = /\bon (?:the )?back ?burner\b|\bput (?:it|that|this|them|the [\w'’ -]{2,30}?) on hold\b/i;
/**
 * All three shapes at once, so the priority level below is the same test that
 * routed the sentence rather than a second list that can drift from it. That
 * mattered immediately: a looser word list put "table" in the priority table
 * and "put the table in the boardroom" started reading as a fragment.
 */
const PARKED = new RegExp([SAYS_PARKED.source, SAYS_PARKED_OBJECT.source, BACK_BURNER.source].join("|"), "i");
/**
 * "The board call is about the term sheet."
 *
 * An agenda, stated. Kept separate from the location rule because "is on Zoom"
 * and "is about the raise" want different fields, and separate from creation
 * because the thing being described already exists.
 */
const SAYS_SUBJECT = /^(?:the|my|our)\s+.{2,40}?\s+(?:is|are|'s|will be)\s+(?:about|regarding|re:?|to (?:discuss|cover|go over))\s+.+$/i;
/** "Make the board call a video call." "The standup is in person now." */
const SAYS_FORMAT = /\b(?:make|makes?)\b[^.]*\ba (?:video call|phone call|zoom|call|voice call)\b|\b(?:is|are) (?:now )?(?:in person|remote|virtual|a video call|a phone call|on the phone|face to face)\b/i;

/**
 * "The Meridian call is on Zoom."
 *
 * A place, stated. The trap is that "the review is on Friday" has the same
 * shape, so the tail has to fail to parse as a date before this can be a
 * location — which is why it is a function rather than another alternation.
 */
const SAYS_PLACE = /\b(?:is|will be|happens|takes place|meets)\s+(?:at|on|in|over)\s+(.{2,40})$/i;

/**
 * "It's in the bag." An idiom, not a room.
 *
 * `SAYS_PLACE` reads anything after "is in"/"is on" as a location, and the
 * completion idioms have exactly that shape — so "the board deck is in the bag"
 * became a task held in a venue called "the bag", four rules before anything
 * could read it as the good news it is.
 */
const NOT_A_PLACE =
  /^(?:the\s+)?(?:bag|books?|can|way|works|clear|home stretch|home straight|good (?:shape|nick|hands))$/i;

export function placeIn(body, now) {
  const m = body.match(SAYS_PLACE);
  if (!m) return null;
  const tail = m[1].replace(/[.,!?]+$/, "").trim();
  if (!tail || NOT_A_PLACE.test(tail) || parseDate(tail, now) || parseTime(tail)) return null;
  if (/^(?:my|the)?\s*(?:calendar|schedule|diary|track|hold|time)$/i.test(tail)) return null;
  return tail;
}

/** Making something new carries the same words as changing something old. */
const IS_CREATION = /^\s*(?:add|create|new|make an?|remind me to|todo|i need to|i want to|put|book|schedule|set up)\b/i;

export function isTaskEdit(body) {
  const s = body.toLowerCase();
  // A clock time means a meeting is being talked about, not a task's length.
  if (hasClock(s)) return false;
  if (BACK_BURNER.test(s)) return true;
  // "Add a task to sign the lease, high priority, due Friday" names a priority
  // and a deadline and is nonetheless a creation. The leading verb governs.
  if (IS_CREATION.test(s)) return false;
  /**
   * The terse property forms, and the two things that disqualify a line from
   * being one.
   *
   * A kind of meeting, because "standup 15m" is a booking to make and "lease
   * 45m" is how long a job will take — the noun is the whole difference. And a
   * question word, because "what's most urgent" has the exact shape of "term
   * sheet critical" — a short phrase and a priority — so a request for triage
   * was setting a priority on a task called "What's most".
   */
  const terseProperty =
    !KIND_NOUN.test(s) &&
    !/\b(?:what|which|who|whom|how|why|when|where|is|are|am|do|does|did|can|could|should|would|will|any|anything|everything|something|most|more|less|too)\b/i.test(s) &&
    (SAYS_LENGTH_TERSE.test(s) || SAYS_PRIORITY_TERSE.test(s));
  return (
    SAYS_LENGTH.test(s) || terseProperty ||
    SAYS_PRIORITY.test(s) || SAYS_REOPEN.test(s) ||
    PARKED.test(s) ||
    SAYS_TASK_DELETE.test(s) || SAYS_RENAME.test(s) || Boolean(placeIn(body)) ||
    SAYS_SUBJECT.test(s) || SAYS_FORMAT.test(s) ||
    // The article is what usually says a specific task is being talked about.
    // People drop it in a hurry — "term sheet is due asap" — so a subject
    // sitting directly in front of "is due" counts as naming one too.
    // …and dropped entirely — "deck due fri" — in the telegraphic register.
    (SAYS_DUE.test(s) &&
      (/\b(?:the|my)\b/.test(s) || /^[\w'’ -]{2,40}\bis (?:due|overdue)\b/.test(s) ||
       SAYS_DUE_TERSE.test(s))) ||
    (SAYS_DUE_IDIOM.test(s) && /\b(?:the|my|our)\b/.test(s))
  );
}

/**
 * A time made of digits, as opposed to a part of the day.
 *
 * "Cancel my 4pm" names one meeting; "clear my afternoon" names a stretch.
 * `parseTime` answers both with an hour, so the distinction has to be drawn
 * here or every "cancel my 4pm" becomes a request to empty the afternoon.
 */
/**
 * `TERSE_CLOCK` is on this list for the same reason the rest of the pattern
 * exists. "Cancel Friday" empties a day; "cancel fri 3" names the meeting at
 * three o'clock, and without the terse form here the second read as the first
 * and cleared the day.
 */
const hasClock = (s) =>
  /\d\s*(?:am|pm|a\.m\.|p\.m\.|:\d{2})|\bat\s+\d|\b\d{1,2}\s*o'?\s*c?l[o0]?c?k\b/i.test(s) ||
  TERSE_CLOCK.test(s);

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
// `prepone` is a direction all by itself — it *means* earlier, which is why
// "can we prepone the standup by an hour" carries no "forward" anywhere.
const NUDGE_DIR = /\b(forwards?|earlier|sooner|ahead|back|backwards?|later|out|up|preponed?)\b/i;
const NUDGE_AMOUNT =
  /\b(?:by\s+)?(\d+|an?|one|two|three|four|five|six|half an?|a couple(?: of)?|a few)\s*(hours?|hrs?|h|minutes?|mins?|m|days?|weeks?|wks?|fortnights?)\b/i;
const NUDGE_UNIT = { h: 60, hr: 60, hrs: 60, hour: 60, hours: 60, m: 1, min: 1, mins: 1, minute: 1, minutes: 1,
  day: 1440, days: 1440, week: 10080, weeks: 10080, wk: 10080, wks: 10080, fortnight: 20160, fortnights: 20160 };

function parseNudge(text) {
  const dir = text.match(NUDGE_DIR);
  if (!dir) return null;

  // "up" and "out" are only directions next to a movement verb. Without this,
  // "set up a call" and "sort out Friday" both read as nudges.
  if (/^(?:up|out)$/i.test(dir[1]) && !/\b(?:mov|push|bump|shift|bring|pull|shuffl|slid|knock|kick)\w*\b/i.test(text)) {
    return null;
  }

  const earlier = /^(?:forwards?|earlier|sooner|ahead|up|preponed?)$/i.test(dir[1]);
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


/**
 * Who is in a meeting, as opposed to whether the meeting exists.
 *
 * This was the most expensive gap in the whole parser. "Drop Bob from the
 * standup" and "remove Priya from the board call" both reached the cancel
 * rule — `drop` and `remove` are cancel verbs — and cancelled the meeting.
 * The user asked to take one person off an invitation and lost the entire
 * appointment, silently, with a cheerful confirmation.
 *
 * So this sits ahead of cancel, and ahead of create for the same reason on the
 * other side: "add Tom to the board call" is not a new booking.
 *
 * The shape that distinguishes it is a person, a preposition, and a thing —
 * `<verb> <someone> to|from <something>`. Without all three it is an ordinary
 * add or an ordinary cancel, and stays one.
 */
const ATTENDEE_ADD =
  /\b(?:add|invite|include|bring|loop|cc|copy|put|get)\s+(?:in\s+)?([\w'’-]+(?:\s+[\w'’-]+)?)\s+(?:in\s?to|into|onto|to|on|in)\s+(.+)$/i;
const ATTENDEE_DROP =
  /\b(?:drop|remove|take|cut|kick|pull|uninvite|un-invite)\s+([\w'’-]+(?:\s+[\w'’-]+)?)\s+(?:from|off(?:\s+of)?|out\s+of)\s+(.+)$/i;
/** "Priya is joining the exec staff." "Bob can't make the board call." */
const ATTENDEE_SAYS_IN =
  /^([\w'’-]+(?:\s+[\w'’-]+)?)\s+(?:is|are|'s|will be)\s+(?:joining|coming to|sitting in on|jumping on|dialling in to|dialing in to|in on)\s+(.+)$/i;
const ATTENDEE_SAYS_OUT =
  /^([\w'’-]+(?:\s+[\w'’-]+)?)\s+(?:can'?t make|cannot make|can'?t do|is out of|isn'?t coming to|is not coming to|has dropped out of|dropped out of|is skipping|won'?t be at)\s+(.+)$/i;
/** "Who's coming to the board call?" */
const ATTENDEE_QUERY =
  /\bwho(?:'?s| is| are| else is)?\s+(?:coming|going|in|on|at|attending|joining|invited|dialling in|dialing in)\b|\bwho am i (?:meeting|seeing|talking to|speaking to|with)\b|\bwho'?s? on (?:my|the)\b/i;
/** "It's just me on the standup now." */
const ATTENDEE_CLEAR = /\bit'?s just me\b|\bjust me now\b|\bnobody else\b|\bno one else\b/i;

/** Things that follow "from"/"to" but are not meetings. */
const NOT_AN_EVENT = /^(?:my |the |our )?(?:calendar|schedule|diary|agenda|list|inbox|team|company|office)\b/i;

/**
 * "Get Bob to do the deck" hands work over. "Add Bob to the board call" puts
 * him on an invitation. Identical shape, and the tell is a bare verb with an
 * object where the meeting's name should be — `add bob to the review` keeps its
 * article and stays an invitation, `get bob to take the review` does not.
 *
 * Without this the attendee rule, which sits sixteen places earlier, was
 * inviting people to meetings named after the job they were being handed.
 */
const ASKED_TO_DO =
  /^(?:do|take|handle|sort|finish|write|draft|run|own|cover|chase|deal with|look at|pick up|sort out|take over|crack on)\s+(?:the|my|our|this|that|it|them|an?)\b/i;

export function parseAttendees(text) {
  if (ATTENDEE_QUERY.test(text)) return { op: "list", who: null, phrase: text };
  if (ATTENDEE_CLEAR.test(text)) return { op: "clear", who: null, phrase: text };

  for (const [re, op] of [
    [ATTENDEE_ADD, "add"], [ATTENDEE_DROP, "remove"],
    [ATTENDEE_SAYS_IN, "add"], [ATTENDEE_SAYS_OUT, "remove"],
  ]) {
    const m = text.match(re);
    if (!m) continue;
    const who = m[1].trim();
    const phrase = m[2].trim();
    /**
     * A number is not a person.
     *
     * "Add two hours to the board deck" has the exact shape of "add Priya to
     * the board call", and this rule sits thirteen places ahead of the one that
     * wanted it — so it added an attendee literally named "Two hours" to a
     * meeting. `handoffTarget` already applies a guard of this kind; this rule
     * simply never got one.
     */
    if (/^(?:\d|(?:an?|one|two|three|four|five|six|seven|eight|nine|ten|half|couple|few|some)\b)/i.test(who)) continue;
    if (/\b(?:h|hrs?|hours?|m|mins?|minutes?|days?|weeks?)\b/i.test(who)) continue;
    // "Take the standup off my calendar" has this exact shape and means delete
    // the standup. The tell is what sits on either side: a meeting where the
    // person should be, and a calendar where the meeting should be.
    if (NOT_AN_EVENT.test(phrase)) continue;
    // A job, not a meeting: "get bob to do the deck" is a hand-off.
    if (op === "add" && ASKED_TO_DO.test(phrase)) continue;
    if (!who || who.split(/\s+/).some((w) => NOT_A_NAME.has(w.toLowerCase()))) continue;
    return { op, who: who.replace(/^\w/, (c) => c.toUpperCase()), phrase };
  }
  return null;
}


/**
 * A booking stated rather than commanded.
 *
 * "I've got the dentist Friday at 9." "I'm seeing the lawyers Thursday at 11."
 * "Bob asked for time Thursday afternoon." None of these contain a verb any
 * booking rule was looking for, and all three are somebody telling their
 * calendar what is going to happen.
 *
 * The guard is that something has to be *when*: without a day or a clock in
 * the sentence, "I've got a lot on" and "there's a problem" match the same
 * words and mean nothing schedulable.
 */
const REPORTED =
  /\bi(?:'ve|ve| have) got\b|\bi'?m (?:seeing|meeting|visiting|taking|off to|due at|due in|flying|driving)\b|\b(?:run|running|pop|popping|nip|nipping|head|heading|dash|dashing|drive|driving|fly|flying)\s+(?:over\s+)?(?:to|round|down to|up to)\s+[\w'’-]|\bthere'?s an? [\w'’-]+\b|\bwe'?re (?:meeting|having|seeing)\b|\basked (?:me )?for (?:time|\d+\s*(?:mins?|minutes?|hours?)|an hour|half an hour)\b|\b(?:annual leave|bank holiday|on holiday|out of (?:station|office)|half[- ]day)\b|\b(?:on|taking|having|booking)\s+(?:a |the )?(?:annual )?(?:leave|day off|holiday)\b/i;

function isReportedBooking(body) {
  if (!REPORTED.test(body)) return false;
  return hasClock(body) || Boolean(parseDate(body, new Date())) || DAYPART.test(body);
}

/** Morning, afternoon, evening — a when, without a clock. */
const DAYPART = /\b(?:morning|afternoon|evening|tonight|midday|noon|lunchtime|all day)\b/i;


/**
 * Verbs that name an action rather than a calendar operation.
 *
 * Deliberately excludes book/schedule/move/cancel and friends: those mean
 * something specific here and have their own rules. What is left is work —
 * things a person does, which is exactly what a task is.
 */
const ACTION_VERB =
  // `finalis|finaliz` and `analys|analyz` are dead alternatives: this group
  // ends in `\b`, which the next letter of "finalise"/"finalize" never gives
  // them, so neither spelling has ever matched — in either dialect. Widening
  // `s|z` bought nothing without the `\w*` that lets the word finish. The rest
  // are British-spelled verbs the list never had, plus `sort` without its
  // particle, which is how "sort the lease out" splits, and "give Bob a bell",
  // which is a phone call.
  /^(?:go\s+)?(?:review|read|check|chase|follow up(?: on| with)?|draft|write|prepare|prep|send|sign|file|submit|pay|order|buy|print|update|fix|finish|finali[sz]\w*|look (?:at|into|over)|go (?:over|through)|sort(?:\s+out)?|deal with|handle|reply to|respond to|revert back|confirm|ask|tell|speak to|talk to|catch up (?:on|with)|research|analy[sz]\w*|re-?organi[sz]e\w*|organi[sz]e\w*|summari[sz]e\w*|apologi[sz]e\w*|recogni[sz]e\w*|give\s+(?:the\s+|my\s+|our\s+|his\s+|her\s+|their\s+)?[\w'’-]+(?:\s+[\w'’-]+)?\s+an?\s+(?:bell|ring|buzz|shout)|build|ship|test|deploy|renew|refactor|email|call|ring|phone|text|message|ping|nudge|circle back|touch base|put together|pull together|work on|start|kick off|wrap up|smash(?: out)?|bash out|bang out|knock out|hammer out|churn out|crank out|crack on(?: with)?|get on with|get (?:the|my|our|this|that|it)\b[^.]*\bdone)\b/i;

/**
 * An obligation in front of the verb: "I've got to sort out the lease."
 *
 * `POLITE_WRAPPER` peels "I need to" and stops there, so every other way of
 * saying the same thing kept its opener and hid the verb behind it from the
 * fallback that wanted it. Only ever applied once every rule in the table has
 * declined, so it cannot take a sentence away from a rule that wanted it.
 */
const OBLIGATION_PREFIX =
  /^(?:i|we)\s*(?:'ve|ve|'ll|ll|'d|d)\s*(?:still\s+)?(?:have to|need to|got to|gotta|have got to|going to|gonna|better)?\s+|^(?:i|we)\s+(?:still\s+)?(?:have to|need to|want to|would like to|like to|must|should|ought to|got to|gotta|will|am going to|am gonna)\s+/i;


/**
 * Handing work over, formally and otherwise.
 *
 * `give (?!me)`: "give me something to do" is somebody asking for work, not
 * handing it over, and it was being answered with "delegate it to whom?".
 *
 * The casual verbs are held separately because they are not verbs of handing
 * anything to a *person* on their own — "chuck a call in on Friday" is a
 * booking and "chuck the standup to 11" is a move. They only mean delegation
 * when a person is on the end of them, so the rule pairs them with the same
 * `handoffTarget` guard that already tells a colleague from a Friday.
 */
const HANDS_OVER =
  /\b(delegate|hand off|hand over|assign|pass (?:it |that |the |this )?(?:on |over )?to|(?:hand|give|pass)\s+(?!me\b|us\b)[^.]{2,30}?\s+to)\b|\bget\s+(?!me\b|us\b|it\b|that\b|this\b|the\b|an?\b|some\b|rid\b)[\w'’-]+\s+to\s+(?:do|take|handle|sort|finish|write|draft|run|own|cover|chase|deal with|look at|pick up|sort out|take over|crack on)\b/i;

const CHUCKS_IT_OVER =
  /\b(?:chuck|toss|lob|punt|palm|sling|bung|fob|fling)\s+(?!me\b|us\b)[^.]{2,30}?\s+(?:over\s+|off\s+)?(?:to|off on)\b/i;

/** "Sometime Thursday", "whenever suits", "at some point" — a when with no when in it. */
const VAGUE_WHEN =
  /\b(?:some ?time|some ?point|at some point|whenever|when ?ever suits|any ?time|at your convenience|when you can|when i can|if i can|somewhere in there|at some stage)\b/i;


/**
 * Asked of her, not of the day.
 *
 * "Write me a poem" shares its verb with "write the board memo", and only one
 * of them is a job to add to a list. The tell is the object: a poem is
 * something she is being asked to produce, and producing it is exactly what
 * she declines to pretend she can do.
 */
const ASKED_OF_HER =
  /\b(?:poem|story|joke|song|essay|haiku|limerick|rap|script|screenplay|novel|lyrics|recipe|summary of|translation)\b/i;


/**
 * A destructive verb that is not an instruction to be destructive.
 *
 * Two shapes, and both of them used to delete things. "Don't cancel the
 * standup" cancelled the standup. So did "why did you cancel the standup",
 * "did I cancel the board call", and "I don't want to cancel it" — the rules
 * saw a cancel verb and an object and never looked at the word in front.
 *
 * This is a guard rather than another rule on purpose. Patching each verb
 * would leave the next one exposed; one check in front of every destructive
 * intent cannot be forgotten when a verb is added.
 */
const DESTRUCTIVE_VERB =
  "cancel|delete|remove|drop|clear|wipe|scrap|bin|kill|axe|ditch|nix|mov(?:e|ed|ing)|reschedul|book|schedul|add|chang|shift|push|swap|undo|skip";

/** "Don't cancel it." "I didn't mean to move it." "No need to delete that." */
const NEGATED_COMMAND = new RegExp(
  "\\b(?:do\\s?n'?t|do not|dont|never|no need to|didn'?t|did not|won'?t|will not|" +
  "wouldn'?t|shouldn'?t|can'?t|cannot|stop)\\b" +
  "(?:\\s+(?:you|me|i|we|to|want|wanna|need|mean|meant|going|gonna|have|had|it|that))*" +
  "\\s+(?:" + DESTRUCTIVE_VERB + ")", "i");

/**
 * "Why did you cancel the standup?" A question about an action, not a request
 * for one. Tested after the polite wrapper is stripped, so "could you cancel
 * the standup" — which really is an instruction — has already lost its
 * question-shaped opener by the time it gets here.
 */
const ASKED_ABOUT_ACTION = new RegExp(
  "^\\s*(?:why|when|who|whom|what|did|do|does|have|has|had|was|were|should|shall|must|am|are|is)\\b" +
  "[^?]*\\b(?:" + DESTRUCTIVE_VERB + ")", "i");

/**
 * Why a destructive sentence must not be carried out, or null.
 *
 * "I don't need the exec staff any more" is a real cancellation and stays one:
 * the negation lands on the *thing*, not on the verb, and there is no
 * destructive verb after it to negate.
 */
function refusalIn(body, bare) {
  if (NEGATED_COMMAND.test(body)) return "negated";
  if (ASKED_ABOUT_ACTION.test(bare)) return "asked";
  return null;
}


/**
 * Words that survive title-cleaning without ever being part of a name.
 *
 * A title made entirely of these is not a title — it is what is left when a
 * sentence was all verb and pronoun, which is exactly what a follow-up is.
 */
const RESIDUE = new Set([
  "move", "moves", "moved", "moving", "make", "makes", "made", "making",
  "take", "takes", "taking", "took", "will", "would", "should", "could",
  "spread", "split", "add", "adds", "set", "sets", "change", "changes",
  "put", "puts", "give", "gives", "do", "does", "did", "go", "goes",
  "shift", "push", "pull", "bump", "book", "schedule", "cancel", "clear",
  "it", "that", "this", "them", "those", "these", "he", "she", "they",
  "over", "under", "up", "down", "out", "in", "on", "at", "to", "for",
  "and", "then", "also", "plus", "back", "now", "please", "just", "the",
  "a", "an", "my", "our", "its", "is", "are", "was", "were", "be", "been",
]);

/**
 * The project a sentence is about, as a phrase.
 *
 * Three shapes, and the order they are tried in is the whole trick. "a project
 * called Q3 Launch" names one being made, so the name follows the word. "new
 * project Marketing" is the same thing without the ceremony. "the Marketing
 * project" points at one that exists, so the name sits in front — and that
 * form has to be tried last, because it will happily match the "new" in "new
 * project Marketing" and name a project after the word new.
 *
 * Returns a phrase, never a project. Matching it against what somebody
 * actually has is the resolver's job; doing it here would put knowledge of the
 * data inside the parser.
 */

/** Words that are never the start of a project name. */
const NOT_A_PROJECT_WORD = /^(?:the|a|an|my|our|this|that|to|in|on|for|under|into|add|put|move|file|new|start|create|make|set|up|open|begin)\s+/i;

/**
 * Phrases that are grammar rather than a name.
 *
 * Tested against the *first* word, because these arrive as fragments — "show
 * me", "do i have", "project going" — and a whole-string match would let every
 * one of them through as a plausible-looking project name.
 */
const NOT_A_PROJECT_NAME =
  /^(?:do|does|did|are|is|was|have|has|list|show|tell|what|which|how|when|why|going|doing|coming|looking|progressing|tracking|start|create|new|make|add|put|file|move|open|begin|set|me|us|it|that|there)\b/i;

const trim = (name) => {
  let out = String(name ?? "").trim().replace(/["“”']/g, "");
  // Strip leading filler a word at a time — "to the Marketing" is "Marketing".
  let before;
  do { before = out; out = out.replace(NOT_A_PROJECT_WORD, ""); } while (out !== before);
  return out.trim();
};

export function projectPhrase(body) {
  const s = String(body ?? "");

  // 1. Explicitly named: everything after "called" / "named".
  const named = s.match(/\b(?:called|named|titled)\s+["“']?(.+?)["”']?\s*[?.!]*$/i);
  if (named) return trim(named[1]) || null;

  // 2. The name follows the word: "new project Marketing".
  const leading = s.match(/\bprojects?\s+([A-Za-z0-9][\w'’&.-]*(?:\s+[\w'’&.-]+){0,3})\s*[?.!]*$/i);
  if (leading) {
    const name = trim(leading[1]);
    // "projects do i have" is a question, not a project called "do i have",
    // and "project going" is the tail of "how is the X project going" — the
    // name is in front of the noun there, so fall through to the next shape.
    if (name && !NOT_A_PROJECT_NAME.test(name)) return name;
  }

  // 3. The name precedes the word: "the Marketing project".
  //
  // Everything before the noun, cut at the last preposition or article. A
  // regex that simply grabs the preceding few words reads "add the deck to the
  // Marketing project" as a project called "deck to the Marketing" — the name
  // is only ever the run of words after the last such boundary.
  const before = s.match(/^(.*?)\s+projects?\b/i);
  if (before) {
    const chunks = before[1]
      .split(/\b(?:to|under|into|in|on|for|the|a|an|my|our|this|that|about|with)\b/i)
      .map((c) => c.trim())
      .filter(Boolean);
    const last = trim(chunks[chunks.length - 1] || "");
    // A verb or a question word is not a name — "start a project" names
    // nothing yet, and "show me projects" is a request rather than a subject.
    if (last && !NOT_A_PROJECT_NAME.test(last)) return last;
  }

  // 4. Quoted after a filing preposition: put X under "Series B".
  const quoted = s.match(/\b(?:under|into|in|to|on)\s+["“']([^"”']+)["”']/i);
  return quoted ? trim(quoted[1]) || null : null;
}

/** Does this sentence talk about a project at all? A cheap guard for the rules. */
const MENTIONS_PROJECT = /\bprojects?\b/i;

/**
 * What a project is worth, and who it is for.
 *
 * `project.value` and `project.client` are stored on every project and printed
 * on two screens, and until now not one word of either appeared anywhere in
 * this file. Measured against the live table, that had two consequences and
 * both are worse than a miss: "how much money is in the Q3 launch project"
 * reached EDIT_TASK, where `placeIn` read "in the q3 launch project" as a
 * *location* and set it on a task; and "who is the client on Q3 launch" was
 * answered "that's outside what I know" — about data the app is holding.
 *
 * Narrow on purpose. "Budget 2 hours for the review" is an estimate and stays
 * one; "arrange a call with the client friday" is a booking and stays one. So
 * the money words are only believed inside an actual question, and only when
 * there is no duration in the sentence to say the noun meant time instead.
 */
const MONEY_WORD =
  /\bworth\b|\bvalue[ds]?\b|\bvaluable\b|\bvaluation\b|\brevenues?\b|\bbudgets?\b|\bmoney\b|\bfees?\b|\bbilling\b|\bdeal size\b|\bcontract value\b|\bpipeline\b|\briding on\b/i;

/** Who is paying for it. */
const CLIENT_WORD = /\bclients?\b|\bcustomers?\b|\bwho(?:'?s| is) paying\b|\bpaying for\b/i;

/** Asked rather than instructed — tested after the polite wrapper comes off. */
const ASKS_A_QUESTION =
  /^\s*(?:who|what|which|whose|how much|how many|how big|list|show|tell me|rank|sort)\b|\bwho(?:'?s| is| are| was)\b|\bwhat(?:'?s| is| are)\b|\bwhich\b|\bhow much\b|\bhow many\b/i;

/** "Total value of my projects" — a question with no question word in it. */
const BARE_VALUE_PHRASE =
  /^\s*(?:(?:the|my|our|total|overall|combined)\s+)*(?:value|worth|revenue|budget|clients?)\s+(?:of|on|for)\b/i;

/**
 * Is this a question about a project's money or its client?
 *
 * @returns {{money: boolean, client: boolean}|null}
 */
export function projectMoneyAsk(body) {
  const s = String(body ?? "").toLowerCase();
  const money = MONEY_WORD.test(s);
  const client = CLIENT_WORD.test(s);
  if (!money && !client) return null;
  if (!ASKS_A_QUESTION.test(s) && !BARE_VALUE_PHRASE.test(s)) return null;
  /**
   * A length is an estimate, not a price. "Budget 2 hours for the review" and
   * "what's the budget on Q3" share a noun and mean opposite things, and the
   * one that means time always says how much of it.
   */
  if (hasClock(s) || /\b\d+(?:\.\d+)?\s*(?:h|hrs?|hours?|m|mins?|minutes?)\b/i.test(s)) return null;
  // "Start a project called Series B" is a creation however it ends.
  if (MAKES_A_PROJECT.test(s)) return null;
  return { money, client };
}

/** The verb sits immediately before the noun: "start a project", "new project". */
const MAKES_A_PROJECT =
  /\b(?:new|start|create|set ?up|begin|open|make|add)\b(?:\s+(?:a|an|another|the))?\s+(?:new\s+)?projects?\b/i;

/** Filing something that already exists under one: "…to the Marketing project". */
const FILES_UNDER =
  /\b(?:to|under|into|in|on)\s+(?:the\s+)?[\w'’&.-]+(?:\s+[\w'’&.-]+){0,3}\s+projects?\b|\b(?:file|move|put|assign|link|attach)\b.*\b(?:under|into|to)\s+["“']/i;

/**
 * Said by someone who is stuck, rather than by someone giving an order.
 *
 * "I'm drowning" is a request with a real answer — it means *show me what to do
 * first* — and read literally it is not a command at all. That is precisely why
 * these were so badly handled: the verbs people reach for when they are sinking
 * (finish, drop, push, do, start) already belong to other rules and win on word
 * order alone. Measured against the live table, "I'll never finish the deck by
 * Friday" reached COMPLETE_TASK and ticked the board deck off; "I can't do all
 * this" reached CANCEL_EVENT; "I've done nothing all week" reached
 * COMPLETE_TASK. Someone at their worst moment was being told their work was
 * done, or having it deleted.
 *
 * So the whole family sits above every verb rule and routes to PLAN_DAY, which
 * already owns the question underneath all of it: what is on me, and what do I
 * start with. Nothing here is a new intent — there was a home for it already.
 */

/** A first-person report of being under it. "I'm swamped." "I'm so behind." */
const FEELS_UNDER =
  /^\s*(?:i'?m|im|i am|i feel|feeling|we'?re|were)\b[^.?!]{0,40}?\b(?:swamped|slammed|buried|drowning|underwater|overwhelmed|overloaded|stressed|frazzled|burnt? ?out|spread thin|losing it|in trouble|behind|snowed under|maxed out|out of time|in over my head|never going to (?:finish|get|make)|not going to (?:finish|get|make)|falling apart|falling behind|failing|sinking|stuck|at capacity|stretched|back[- ]to[- ]back|wall[- ]to[- ]wall|out of bandwidth|short on bandwidth)\b/i;

/** Nothing specific is named, because everything is the problem. */
const ALL_OF_IT =
  /\btoo much\b(?!\s+(?:time|of|for)\b)|\bway too much\b|\bso much to do\b|\beverything(?:'?s| is| has)?\s+(?:on fire|urgent|late|overdue|due|a mess|falling apart|slipping|important|critical)\b|\bcan'?t (?:keep up|cope|do all|do it all|manage it|face (?:it|this)|deal with (?:it|this|all this|all of (?:it|this)))\b|\bcannot keep up\b|\bcan'?t do all\b|\bnot enough (?:time|hours|days)\b|\bno time for anything\b|\bnothing (?:is )?getting done\b/i;

/** "My week is a mess." The shape of the week, described as a feeling. */
const WEEK_IS_A_MESS =
  /\b(?:this|the|my|our)\s+(?:week|day|month|schedule|calendar|diary|list|plate)\s+(?:is|looks?|feels?)\s+(?:a\s+|so\s+|really\s+|completely\s+|totally\s+|absolutely\s+)*(?:mess|disaster|insane|crazy|nuts|brutal|mental|chaos|chaotic|ridiculous|awful|terrible|rough|heavy|hell|packed|slammed|jammed|hopeless|impossible|too much|shot|wrecked|write ?off)\b/i;

/** "Where do I start?" — the single commonest thing this app exists to answer. */
const WHERE_TO_START =
  /\b(?:i (?:don'?t|do not|dont) know (?:where|what|how) to (?:start|begin|do)|where (?:do|should|would|shall) i (?:start|begin)|where to start|which (?:one|thing|task) (?:first|do i)|what'?s the one thing|what (?:do|should) i do (?:now|first)|what'?s first|no idea (?:what|where) to (?:do|start)|get something done)\b/i;

/**
 * Handing the decision over. "What should I focus on?" "You pick."
 *
 * `help me` is stripped by `unwrap` before any rule sees the sentence, so
 * "help me prioritise" arrives as the bare word — which is why the bare forms
 * are listed as well as the full ones.
 */
const ASKS_FOR_JUDGEMENT =
  /\bwhat'?s (?:the )?most important\b|\bthe most important thing\b|\bwhat (?:matters|counts)\b|\bwhat'?s worth doing\b|\bwhat needs (?:to happen|doing)\b|\bwhat should i (?:focus on|be doing|priorit\w+)\b|\bwhat would you do\b|\btell me what to (?:do|work on|start)\b|\b(?:pick|choose) (?:one|something|a task|for me)\b|\byou (?:pick|choose|decide)\b|\bdecide for me\b|\bshould i be worried\b|\bwhat'?s the (?:priority|big one)\b|^\s*(?:priorit\w+|decide|choose|pick)\b[^.?!]{0,20}$/i;

/**
 * "Am I behind?" "How bad is it?" — a question about state, not about a day.
 *
 * `am i going to miss …` is here rather than left to the PLAN_DAY rule at the
 * bottom of the table, which already has the pattern and never gets to use it:
 * "am I going to miss the deadline" contains the word deadline, EDIT_TASK owns
 * that word, and the sentence was coming back "I couldn't find a task matching
 * that". The question is about the whole week, not about one task's due date.
 */
const HOW_BAD =
  /\bam i (?:actually |really |badly |even |properly )?(?:behind|on track|keeping up|screwed|in trouble|going to be ok(?:ay)?)\b|\b(?:am|are) i (?:going to |gonna )?(?:make|hit|miss)\b|\bwill i (?:make|hit|miss)\b|\bhow (?:far |badly )?behind am i\b|\bhow bad (?:is|are)\b|\bhow much trouble am i in\b|\bis it as bad as\b|\bwhere am i (?:at|up to)\b|\bhow (?:screwed|cooked) am i\b/i;

/** "There's no way this fits." Arguing with the arithmetic. */
const WONT_FIT =
  /\b(?:there'?s|there is) no way\b|\bno way (?:this|that|i|it)\b|\b(?:this|that|it) (?:isn'?t|is not|won'?t|will not|ain'?t) (?:going to |gonna )?(?:fit|work|happen)\b|\b(?:i'?ll|i will|i'?m) never (?:finish|going to finish|get|make|be done)\b|\bsomething has to (?:give|go)\b|\bi (?:need|want) (?:more time|another (?:day|week|hour)|an extra (?:day|week|hour))\b|\bi (?:don'?t|do not|dont) have (?:the |enough )?time\b|\bis there any way (?:this|that|i)\b|\bcan i (?:actually |even |realistically |really )?finish\b|\bcan i get (?:it|this|everything|them) (?:all )?done\b|\bcan i buy (?:myself )?(?:some )?time\b/i;

/**
 * Weighing a change rather than asking for one. "What if I push the deck?"
 *
 * These already carried `refuses: "asked"`, so nothing was being destroyed —
 * but the reply was "I couldn't find that on your calendar", which answers a
 * question nobody asked. The permission forms are held to an indefinite object
 * on purpose: "can I move something" is deliberation, "can you move my 3pm" is
 * an instruction and keeps its own rule.
 */
const WEIGHING_A_CHANGE =
  /\bwhat if i\b|\bwhat happens if i\b|\bwhat would happen if\b|\bcan i (?:move|push|shift|drop|skip|delay|postpone|bump|lose)\s+(?:something|anything|some ?thing|stuff|one thing)\b|\bcan i (?:move|push|shift|drop|skip|delay|postpone)\b\s*[?.!]*$/i;

/**
 * "Give me a fresh start."
 *
 * Emphatically not a request to delete anything. Somebody asking to start over
 * at four in the afternoon wants the day laid out again, and answering it with
 * an emptied calendar would be the single worst thing in this file. Kept above
 * CLEAR_RANGE so the word "wipe" in "wipe the slate clean" can never reach it.
 */
const START_AGAIN =
  /\b(?:start (?:over|again|afresh|fresh|from scratch)|start me over|starting over|fresh start|clean slate|blank slate|wipe the slate clean|reset (?:everything|my day|my week|me|this)|begin again|from the top)\b/i;

/** Avoidance, said out loud. "I keep putting this off." */
const AVOIDING =
  /\bi (?:haven'?t|have not|havent) (?:even )?(?:started|touched|looked at|begun|opened|got to)\b|\bi keep (?:putting (?:this|it|them|that) off|procrastinating|avoiding|not doing)\b|\bi'?ve been (?:avoiding|putting (?:this|it|that|them) off|ignoring)\b|\bi can'?t (?:make myself|get myself to|bring myself to)\b|\bi'?m (?:procrastinating|avoiding it)\b/i;

/** Out of road for today. "I've got no focus left." */
const RUNNING_LOW =
  /\bi'?m (?:so |really |completely |totally |absolutely |utterly |dead |proper(?:ly)? |well |bloody |flat )?(?:tired|exhausted|knackered|shattered|wiped|fried|spent|beat|running on (?:empty|fumes))\b|\bi (?:have|'?ve got|got|have got) (?:no|zero|not much|very little) (?:energy|focus|brain|bandwidth|steam|left)\b|\bno (?:focus|energy|brain|bandwidth) left\b|\bno brain\b|\b(?:my )?brain is (?:fried|mush|gone|dead|melted|off)\b|\bi can'?t (?:think|focus|concentrate)\b|\bout of (?:energy|steam|gas|juice)\b|\blow (?:on )?energy\b/i;

/**
 * Asking for the *smallest* thing rather than the most important one.
 *
 * A different sort from everything else here, and worth keeping separate: at
 * 4pm on a bad day the top of the triage list is the wrong answer, because the
 * hardest job is the one they have already failed to start. Exported so the
 * handler can rank by what is shortest instead of by what is tightest.
 */
const WANTS_SOMETHING_SMALL =
  /\bsomething (?:small|easy|quick|simple|short|light|low[- ]effort|mindless|i can actually do|i can do)\b|\ban? (?:easy|quick|small|cheap) (?:win|one|thing|task|job)\b|\b(?:the )?(?:smallest|easiest|quickest|shortest|simplest) (?:thing|task|one|job)\b|\bnothing (?:hard|big|heavy|difficult|taxing)\b|\bwhat'?s something (?:quick|small|easy|short)\b|\bonly do something easy\b|\blow effort\b|\bquick win\b/i;

/**
 * Should the answer be the shortest job rather than the most urgent one?
 *
 * True both when it is asked for outright ("give me something small") and when
 * it is only implied ("I'm tired", "my brain is fried"). Someone with nothing
 * left does not need to be told the eight-hour job is the important one; they
 * already know, and that is why they are asking.
 */
export function wantsSomethingSmall(body) {
  const s = body.toLowerCase();
  return WANTS_SOMETHING_SMALL.test(s) || RUNNING_LOW.test(s);
}

/**
 * A complaint with an instruction bolted onto it is the instruction.
 *
 * "I'm swamped, clear my Wednesday" is a clearing; answering it with a triage
 * list loses the work. The calendar object is required, so the idiom in "wipe
 * the slate clean" is not mistaken for a request to wipe anything.
 *
 * Only the statements are held to this. A question is never an order, so the
 * interrogative families below skip the guard entirely.
 */
const ORDER_ATTACHED = new RegExp(
  "\\b(?:book|schedule|reschedul\\w*|cancel\\w*|delete|remove|clear|wipe|empty|scrub|purge|nuke|" +
  "mov(?:e|ing)|shift|bump|postpone|add|create|set up|delegate|assign|rename|remind me to|" +
  // A question bolted onto a complaint is still the question. "I'm so behind,
  // what's on Thursday" was being answered with a triage list of the whole
  // week — true, and not what was asked. Only the *statement* families are
  // held to this guard; the interrogative ones return before it, so asking
  // "what matters today" still gets judgement rather than Thursday's diary.
  "what'?s|what is|what do|what have|what'?ve|when'?s|when is|how many|show me|tell me)\\b" +
  "[^.?!]{0,30}?\\b(?:calendar|schedule|diary|meetings?|calls?|appointments?|events?|tasks?|to-?dos?|" +
  // The kinds of thing a meeting is usually called. "I'm drowning, cancel the
  // standup" is an instruction and was being answered with a triage list,
  // because the guard could only recognise an object it had a word for and
  // "standup" was not one. A meeting named something unguessable — "cancel the
  // Munich walkthrough" — still falls through, and fails in the safe
  // direction: she offers the list instead of deleting something.
  "stand-?ups?|syncs?|retros?|reviews?|demos?|kick-?offs?|off-?sites?|interviews?|" +
  "one-?on-?ones?|1:1s?|catch-?ups?|check-?ins?|debriefs?|lunch|dinner|coffee|" +
  "mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun|" +
  "monday|tuesday|wednesday|thursday|friday|saturday|sunday|" +
  "today|tomorrow|tonight|morning|afternoon|evening|weekend|\\d)\\b", "i");

/** Is this sentence a person asking to be told what to do, rather than telling? */
export function isOverwhelmed(body) {
  const s = body.toLowerCase();
  if (WHERE_TO_START.test(s) || ASKS_FOR_JUDGEMENT.test(s) || HOW_BAD.test(s) ||
      WONT_FIT.test(s) || WEIGHING_A_CHANGE.test(s) || WANTS_SOMETHING_SMALL.test(s)) return true;
  if (ORDER_ATTACHED.test(s)) return false;
  return FEELS_UNDER.test(s) || ALL_OF_IT.test(s) || WEEK_IS_A_MESS.test(s) ||
    RUNNING_LOW.test(s) || AVOIDING.test(s) || START_AGAIN.test(s);
}

/**
 * Every way of saying a piece of work is finished.
 *
 * Lifted out of the rules table so the hedge veto above can be written as a
 * predicate around it. The alternation is unchanged.
 */
const COMPLETES = /\b(?:complete|completed|finish\w*|tick(?:ed)? off|check(?:ed)? off|did the)\b|\bmark\b.*\bdone\b|\b(?:is|are|'s) (?:done|finished|complete|sorted|handled|out of the way)\b|\bi'?ve (?:done|finished|completed|sorted)\b|\ball done\b|\bwrapped up\b|\b(?:smashed|nailed|wrapped|sorted|aced|crushed|nuked|bagged|knocked out|knocked off|smashed out|bashed out|banged out|polished off|powered through)\s+(?:the|my|our|that|this|it|them)\b|\bknocked\s+(?:the|my|that|this|it)\b[^.]*\bout\b|\b(?:is|are|'s|was|were) (?:in the bag|off my plate|off the list|squared away|good to go)\b|^(?:that'?s\s+)?(?:the\s+|my\s+|our\s+)?(?!well\b|nicely\b|all\b|nothing\b|not\b|almost\b|nearly\b|half\b|hardly\b|barely\b)[\w'’-]+(?:\s+[\w'’-]+){0,2}\s+(?:is\s+)?(?:done|sorted|finished|dusted)\s*[.!]*$/;

/**
 * A day and a question mark, and nothing else at all.
 *
 * "friday?" is the shortest anyone asks what is on a day, and it was reaching
 * the follow-up machinery instead — where a bare date means "make it Friday",
 * which after "cancel the standup" is a very different sentence. The question
 * mark is the entire difference and it is required: bare "friday" stays a
 * fragment, because as a follow-up that is exactly what it is.
 */
const TERSE_DAY_QUESTION = new RegExp(
  "^\\s*(?:next\\s+|this\\s+|coming\\s+)?" +
  "(?:today|tonight|tomorrow|tmrw|weekend|week|month|morning|afternoon|evening|" +
  "mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun|" +
  "monday|tuesday|wednesday|thursday|friday|saturday|sunday)" +
  "(?:\\s+(?:morning|afternoon|evening))?\\s*\\?+\\s*$", "i");

/** The one-word questions. "Busy?" is a whole sentence to someone in a hurry. */
const TERSE_BUSY = /^\s*(?:busy|anything|how many|much left|what'?s on)\s*\?+\s*$/i;

/**
 * "standup?", "board call?" — a named thing with a question mark after it.
 *
 * A question about that thing, never an instruction to create one. Held to a
 * short line that names a kind of meeting and contains no question word and no
 * verb, so "what's on?" stays a question about the day and "book lunch?" never
 * reaches here.
 */
const NAMED_THING_QUESTION = (body) =>
  /^[^?]{2,30}\?+\s*$/.test(body.trim()) &&
  KIND_NOUN.test(body) &&
  !/\b(?:what|when|where|who|whom|how|why|which|is|are|do|does|did|can|could|should|book|add|move|cancel|delete|schedule)\b/i.test(body);

const RULES = [
  // First, and unmissable. Undo is the thing people reach for while something
  // is going wrong, and it must never be shadowed by a verb inside the same
  // sentence — "undo that meeting move" is an undo, not a move.
  /**
   * Two narrowings, both about words that mean something else abroad.
   *
   * "Revert" is undo in America and *reply* across South Asia — "kindly revert
   * back with the schedule" is a request to be got back to, and it reached the
   * one rule in the table that throws the user's last action away. The
   * lookahead lists what follows the reply sense and nothing that follows the
   * undo sense, so "revert that" and "revert back to the old time" are
   * untouched.
   *
   * "Put it back" is undo everywhere and *move it later* in British and Irish
   * English — but only when an amount or a destination follows. Bare "put it
   * back" stays an undo, which is what it is nine times in ten.
   */
  [INTENTS.UNDO, /\bundo\b|\bredo that\b|\bput (?:it|that|them) back\b(?!\s+(?:to|by|until|an?|one|two|three|four|five|half|\d)\b)|\brevert\b(?!\s+(?:back\s+)?(?:with|to me|to us|on\b|by\b|asap|soon|at the earliest))|\btake (?:that|it) back\b|\bnever ?mind that,? undo\b|\bi didn'?t mean (?:that|to)\b|\bthat was a mistake\b|\bchange (?:that|it) back\b|\brestore\b/],
  /**
   * Second only to undo, and for the same reason: this is what people say while
   * something is going wrong, and every verb in it belongs to a rule further
   * down that would act on it. Above HELP as well, so "help me prioritise"
   * comes back as a list of work rather than a list of capabilities.
   */
  [INTENTS.PLAN_DAY, isOverwhelmed],
  [INTENTS.HELP, /\b(help|what can you do|commands?)\b/],
  // Asking what to give up is a triage question, not a cancellation. It has to
  // come this early because "drop", "cut", and "lose" are all cancel verbs, and
  // CANCEL was answering "what should I drop?" with "I couldn't find that on
  // your calendar" — a question about the whole week, answered as a failed
  // lookup of a meeting called "I".
  [INTENTS.PLAN_DAY, /\bwhat should i (?:drop|cut|skip|postpone|shelve|lose|let go)\b|\bwhat (?:can|could) i (?:drop|cut|skip)\b|\bwhat (?:has to|needs to|should) (?:go|give)\b/],
  // Ahead of cancel, because "drop Bob from the standup" used to delete the
  // standup; ahead of create, because "add Tom to the board call" is not a new
  // booking; and ahead of invite, because "invite Bob to the standup" is a
  // request to put Bob on the invitation. Sending it is a separate thing, and
  // the one Squirrel cannot do.
  /**
   * `add|create|new` vetoes this the same way it vetoes COMPLETE_TASK below.
   *
   * "add talk to legal about the lease" reads as an attendee change — "to
   * legal" is exactly the shape of adding somebody to a meeting — and it went
   * looking for a meeting to put legal into, found none, and created nothing.
   * The sentence opened with the word for what was wanted.
   */
  [INTENTS.EDIT_ATTENDEES, (body) =>
    !/^\s*(?:please\s+)?(?:can you\s+|could you\s+)?(?:add|create|new)\s+(?!\w+\s+(?:to|into)\s+(?:the|my|our)\b)/i.test(body) &&
    Boolean(parseAttendees(body))],
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
  /**
   * Above EDIT_TASK because `placeIn` reads "…is in the Q3 launch project" as
   * a location and writes it to a task — a question answered by changing data,
   * which is the worst thing in this file. Above QUERY_DAY, twelve rules
   * further down, because "what's the value of the Atlas project" opens with
   * "what's" and that rule owns the word. Below PLAN_DAY, which keeps "what's
   * worth doing" as the triage question it is.
   *
   * QUERY_PROJECTS only ever reads, so a wrong match here costs an answer and
   * never a record.
   */
  [INTENTS.QUERY_PROJECTS, (body) => Boolean(projectMoneyAsk(body))],
  /**
   * The project verbs, all demanding the word "project" in the sentence.
   *
   * An audit ran the natural phrasings and found every one landing somewhere
   * destructive or dead: "rename the Munich lease project to X" renamed a
   * TASK — sometimes in a different project — while the project kept its
   * name; "set the Munich sale project deadline to Friday" wrote a task's
   * due date; and archiving, which the UI had just learned, was unreachable
   * by voice entirely. Ahead of EDIT_TASK because that is precisely the rule
   * that was swallowing them.
   */
  [INTENTS.WHICH_PROJECT, /\b(?:which|what) project\b/],
  [INTENTS.RENAME_PROJECT, /\brenam\w+[^.]*\bproject\b|\bproject\b[^.]*\brenam\w+/],
  [INTENTS.ARCHIVE_PROJECT, /\b(?:archiv\w+|shelve|mothball)\b[^.]*\bproject\b|\bproject\b[^.]*\b(?:archiv\w+|shelved|mothball\w*)\b/],
  [INTENTS.REOPEN_PROJECT, /\b(?:re-?open\w*|un-?archiv\w+)\b[^.]*\bproject\b|\bproject\b[^.]*\b(?:re-?open\w*|un-?archiv\w+)\b/],
  [INTENTS.PROJECT_DUE, /\bproject\b[^.]*\b(?:deadline|due)\b|\b(?:deadline|due)\b[^.]*\bproject\b/],
  [INTENTS.EDIT_TASK, isTaskEdit],
  // Two meetings changing places. Ahead of MOVE because "swap X and Y" has no
  // move verb in it at all, and a rule that merely tolerated it would move one
  // of the two and leave the other sitting on top of it.
  // Holding time open, said as a prohibition. Ahead of the clearing and
  // cancelling rules because "no meetings before 10" is a fence, not a
  // deletion, and either of those would have read it as one.
  [INTENTS.CREATE_EVENT, (body) => Boolean(parseProtect(body))],
  /**
   * The arrow forms, together and here.
   *
   * Above MOVE and CANCEL because the arrow is the more specific statement —
   * "move standup -> 10" is already a move and loses nothing, while
   * "lease → anders" contains no verb any rule below is looking for and was
   * falling through entirely. Below EDIT_ATTENDEES and EDIT_TASK because those
   * name a thing outright and an arrow is only ever punctuation.
   *
   * `parseArrow` returns null unless the right-hand side is unmistakably a
   * time or unmistakably a name, so a line with an arrow and anything else in
   * it is left to whatever it was already reaching.
   */
  [INTENTS.MOVE_EVENT, (body) => parseArrow(body)?.op === "move"],
  [INTENTS.DELEGATE_TASK, (body) => parseArrow(body)?.op === "delegate"],
  [INTENTS.SWAP_EVENTS, /\b(?:swap|switch|exchange|trade|flip)\b[^.]*\b(?:and|with|for|round|around)\b/],
  /**
   * `shove`, `shunt` and `scoot` are the spoken forms of `move`, and every one
   * of them used to fall out of the table entirely — down to the fallback at
   * the bottom of `parse` that reads "a meeting noun plus a day" as a booking.
   * So "shove the standup to tmrw" put a *second* standup on tomorrow and left
   * the first one where it was. A move verb this file does not know is not a
   * miss; it is a duplicate.
   *
   * `nudge` is held to a pointer at something that already exists, because it
   * is also how people say "chase" — "nudge legal about the lease" is a task.
   * `instead` earns its place only at the end of a sentence: "put it thursday
   * instead" is a move, "book it thursday instead of friday" is a booking.
   */
  /**
   * `prepon\w*` earns its place here above everything else: "prepone" is the
   * standard Indian English word for bringing a meeting forward, it has no
   * American equivalent at all, and with no rule owning it "prepone the board
   * call to Tuesday" fell through to the booking fallback and put a *second*
   * board call on Tuesday beside the one it was meant to move.
   *
   * The `back` forms are the British side of the same gap. "Put the standup
   * back an hour", "pop the board call back" — moves with the direction said
   * instead of the destination, and none of them contained a verb this rule
   * knew. They cannot swallow the undo above them, which is rule one, and what
   * follows "back" keeps "put the deck back on the list" out.
   */
  [INTENTS.MOVE_EVENT, /\b(mov(?:e|es|ed|ing)|reschedul\w*|prepon\w*|re-?arrang\w*|re-?organi[sz]\w*|push\w*|shift\w*|bump\w*|postpon\w*|shuffl\w*|shov(?:e|es|ed|ing)|shunt(?:s|ed|ing)?|scoot(?:s|ed|ing)?|nudg(?:e|es|ed|ing)\s+(?:it|that|them|the|my|our)|slid(?:e|ing)|switch\w*|put off|putting off|defer\w*|bring\w*\s+(?:it|that|them|the|my|forward)|pull\w*\s+(?:it|that|them|the|my)\b)\b|\binstead\s*[.?!]*$|\b(?:put|pop|knock|kick|nudge|shunt)\w*\s+(?:back\b|(?:it|that|them|the|my|our|his|her)\b[^.]{0,30}?\bback\b)(?!\s+(?:on|in|into|onto|at|with|from)\b)/],
  // Before cancel, after move: "move everything on Friday to Monday" is a bulk
  // move and stays a move; "cancel everything on Friday" is a bulk clear.
  [INTENTS.CLEAR_RANGE, isClearRange],
  // `cancel\w*` on purpose: "cancelled" and "cancelling" have no word boundary
  // after "cancel", so the strict form missed every past-tense report — and
  // people report as often as they command. "The exec staff is cancelled" is
  // not a request but it means exactly one thing.
  // `blow off` and `sack off` are how anybody under fifty says "cancel", and
  // neither shares a stem with a word already here.
  //
  // The lookahead on "off" is the important part: "the board call is off" is a
  // cancellation and "the term sheet is off my plate" is a task being *done* —
  // one alternation apart, and the second was deleting a meeting.
  [INTENTS.CANCEL_EVENT, /\b(cancel\w*|delete|remove|drop|call off|scrap|bin|kill|nix|axe|ditch|scratch|skip|get rid of|blow(?:ing)? off|sack(?:ing)? off)\b|\btake .* off (?:my|the) calendar\b|\b(?:is|are|has been|have been) (?:off(?!\s+(?:my|the|your|our)\s+(?:plate|list|books|desk|radar|hands))|cancelled|canceled)\b|\bno longer (?:need|needed|happening)\b|\b(?:don'?t|do not|dont|didn'?t) (?:need|want)\b.*\b(?:any ?more|any longer)?\b|\b(?:not|isn'?t|is not|aren'?t|are not) happening\b|\bfell through\b|\bwe'?re not doing\b|\b(?:can'?t|cannot|won'?t|will not|unable to|not able to) (?:make|do|attend|be at|get to)\b|\bchuck\w*\b[^.]{0,30}?\b(?:out|away)\b|\bbail(?:ing)? on\b|\b(?:back|backing|pull|pulling) out of\b|\bhave to (?:miss|skip)\b|\bgoing to (?:miss|skip)\b|\bgonna (?:miss|skip)\b/],
  // "mark ... as done" allows words in between — that is how people write it.
  // "Add a task to finish the board deck" is a task being *made*, and it was
  // being read as one being finished — "finish" is a completion verb, and it
  // won. An explicit "add a task to …" or "remind me to …" states the intent
  // before any verb inside it, so it is settled here rather than left to
  // whichever rule matched first.
  // "Stick reviewing the deck on my list" says which list it goes on, and the
  // word `list` belongs to QUERY_DAY eleven rules further down — so putting
  // something on a to-do list was answered with the day's diary. A placement
  // verb is required, so "what's on my list" stays a question.
  [INTENTS.CREATE_TASK,
    /^\s*(?:please\s+)?(?:can you\s+|could you\s+)?(?:add|create|make)\s+(?:a|an|another)?\s*(?:new\s+)?(?:task|todo|to-?do|reminder)\b|^\s*remind me to\b|\b(?:add|put|stick|chuck|throw|shove|bung|slap|whack|pop|jot)\b[^.?!]{0,48}?\bon(?:to)? (?:my|the) (?:to-?do |todo |task |work |job )?list\b/i],
  /**
   * "What did I finish this week?"
   *
   * Ahead of COMPLETE_TASK, which owns the word "finish" and was reading this
   * as an instruction — going off to look for an open task called "this week"
   * and reporting that it could not find one. A past-tense question about what
   * got done is the opposite of a command to get something done, and the two
   * are one auxiliary verb apart.
   */
  /**
   * "Did I get anything done?" is the same question asked by someone who
   * suspects the answer is no. It carried no "what", so it missed every branch
   * of the rule above and fell through — and "I've done nothing all week"
   * reached COMPLETE_TASK, which went looking for an open task called "nothing
   * all week". Both want the honest read of the logged sessions, which is very
   * often kinder than the guess they arrived with.
   */
  [INTENTS.QUERY_PROGRESS,
    /\bwhat (?:did|have|'?ve) (?:i|we) (?:do|done|finish|finished|complete|completed|get|got|accomplish\w*|achieve\w*)\b|\bhow much (?:did|have) (?:i|we)\b|\bwhat'?s (?:been )?(?:done|finished|completed)\b|\b(?:did|have) (?:i|we) (?:get |got )?(?:anything|much|any) (?:done|finished|sorted)\b|\bdid (?:i|we) do (?:anything|much)\b|\bhave (?:i|we) (?:been (?:productive|any use)|made any (?:progress|headway)|got(?:ten)? anywhere)\b|\b(?:i|we)(?:'?ve)? (?:did|done|got|have done|have got) (?:nothing|zero|not much|sod all)\b|\bnothing (?:got|has been) done\b|\bam i doing (?:ok|okay|alright|any good)\b/],
  /**
   * "I have to finish the board deck this week" is a task being created, and it
   * was being read as one being completed — she replied "Done" and ticked it
   * off. An obligation and a report of having met it are one auxiliary apart,
   * and the obligation is far commoner in a planner.
   *
   * Placed after QUERY_PROGRESS so "what did I finish" stays a question, and
   * before COMPLETE_TASK so it wins the word "finish".
   */
  [INTENTS.CREATE_TASK,
    /^\s*(?:i|we)\s*(?:'ve|ve|'d|d)?\s*(?:still\s+)?(?:have to|need to|want to|would like to|like to|must|should|got to|gotta|gonna|wanna|hafta|oughta|have got to|need ta)\s+(?:finish|complete|wrap up)\b/i],
  /**
   * Nobody says "mark the board deck as complete".
   *
   * They say they smashed it, knocked it out, nailed it, wrapped it; that it is
   * sorted, in the bag, off their plate, squared away, done and dusted. Twelve
   * of these fell straight through to "I didn't catch that", which is a strange
   * thing to be told by a planner at the one moment its user has good news.
   *
   * Three shapes are added. The past-tense verbs need a determiner after them,
   * so "sorted the data room" is a completion and a bare "sorted" stays the
   * acknowledgement it is. The stative idioms are listed literally, because
   * "in the bag" is not a place and "off my plate" is not a cancellation — both
   * were being read as one, and the second deleted meetings. And the bare
   * "<thing> done" form is anchored end to end and excludes the words that make
   * it something else, so "almost done" and "nearly done" are not completions
   * and "well done" is still a compliment.
   */
  /**
   * "Nearly finished the term sheet" was ticking the term sheet off.
   *
   * The bare `<thing> done` form already refused a hedge, but the *verb* forms
   * did not, so a sentence reporting that work is nearly finished closed it.
   * Reporting progress is the opposite of reporting completion, and the two are
   * one adverb apart — which is why this is a veto in front of the rule rather
   * than another alternative inside it.
   *
   * It falls through to whatever else the sentence looks like; a miss is the
   * honest answer for "nearly finished the deck", and closing the task is not.
   */
  /**
   * And a second veto: you cannot be asking to tick off the thing you are in
   * the same breath asking to create.
   *
   * "add finish the deck, 2 hours" reached here — the rule above it wants the
   * literal word "task" ("add a task to…"), and a bare "add" carries none —
   * so the sentence was read as a completion, went looking for an open task
   * called "the deck", found none, and answered "I couldn't find an open task
   * matching that." Nothing was created. Somebody dictating work into an empty
   * app got a refusal and an empty list, and the word they had used to say
   * what they wanted was the first one in the sentence.
   *
   * A leading create verb is about as explicit as intent gets, so it wins
   * outright. "make" is deliberately not in the list: "make it done" is a
   * completion, and it is the one of these that is genuinely ambiguous.
   */
  [INTENTS.COMPLETE_TASK, (body) =>
    !/^\s*(?:please\s+)?(?:can you\s+|could you\s+)?(?:add|create|new)\b/i.test(body) &&
    !/\b(?:almost|nearly|not quite|not fully|half|halfway|partly|partially|mostly|kind of|kinda|sort of|nowhere near|far from|still)\s+(?:done|finished|finish|complete|completed|there|wrapped)\b/i.test(body) &&
    COMPLETES.test(body)],
  // `give (?!me)`: "give me something to do" is someone asking for work, not
  // handing it over, and it was being answered with "delegate it to whom?".
  // "Take the deck off my plate" names no one, and DELEGATE_TASK's answer to
  // that — "delegate it to whom?" — is exactly the right question. `TAKE_OFF`
  // and CANCEL_EVENT both only know about a calendar, so neither claims it.
  // `chuck it over to Anders`, `toss the deck to Bob`, `palm the data room off
  // to Sarah` — handing work over is the thing people are least formal about,
  // and every one of these fell out of the table. The verbs are kept off the
  // MOVE rule above on purpose: they are ambiguous there ("chuck a call in on
  // Friday" is a booking), and a wrong move is worse than a missed hand-off.
  //
  // `get <someone> to <verb> <the thing>` is the other half of the fix in
  // `parseAttendees` — declining it there is only useful if it lands here.
  [INTENTS.DELEGATE_TASK, (body) =>
    HANDS_OVER.test(body) || (CHUCKS_IT_OVER.test(body) && Boolean(handoffTarget(body))) ||
    /\boff (?:my|his|her|their) plate\b/i.test(body) ||
    Boolean(ownerFirst(body))],
  // Before MOVE, because "shorten"/"extend" are edits to length rather than
  // to when — and "push the review out by an hour" is genuinely ambiguous, so
  // the explicit length verbs win.
  // `+2h` is "give it another two hours", written the short way. There is no
  // other reading of a plus sign in front of a length.
  [INTENTS.RESIZE_EVENT, /\+\s*\d+(?:\.\d+)?\s*(?:h\b|hrs?\b|hours?\b|m\b|mins?\b|minutes?\b)|\bknock\b[^.]*\boff\b|\badd\s+[^.]{0,16}?\b(?:\d+|an?|half an?)\s*(?:h|hrs?|hours?|m|mins?|minutes?)\b[^.]*\bto\b|\bgive (?:it|them|that|the [\w'’-]+(?:\s+[\w'’-]+)?)\s+another\b|\b(?:it|that|this|the\s+[\w'’-]+(?:\s+[\w'’-]+)?)\s+(?:only\s+)?needs?\s+(?:only\s+)?\d+\s*(?:h|hrs?|hours?|m|mins?|minutes?)\b|\b(shorten|lengthen|extend|trim|cut)\b.*\b(?:to|by|in half)\b|\bmake\b.*\b(?:\d+|one|two|three|four|five|half)\s*(?:h\b|hrs?\b|hours?\b|m\b|mins?\b|minutes?\b)/],
  // Questions about one specific thing on the calendar, which want a fact
  // rather than a day's worth of listing.
  // "When is my next meeting" is a question about the calendar, not about a
  // meeting called "next" — which is what QUERY_EVENT tried to look up, and it
  // answered "I couldn't find that on your calendar" to the single most
  // ordinary question anyone asks a diary. Placed ahead of it for that reason;
  // MOVE and CANCEL still win, so "move my next meeting" is a move.
  // "next?" — the whole question, asked by somebody who has asked it before.
  [INTENTS.QUERY_NEXT, /^\s*(?:what'?s\s+)?next\s*\?+\s*$/i],
  [INTENTS.QUERY_NEXT, /\b(?:what|when|which)(?:'s| is)?\s+(?:my |the )?next\b|\bwhat'?s (?:up )?next\b|\bnext (?:meeting|thing|one|up|appointment|call)\b|\bwhat'?s after (?:this|that)\b|\bhow long (?:until|till|til|to) (?:my |the )?next\b/],
  // Projects, ahead of the general question rules. "What projects do I have"
  // is caught by QUERY_DAY's "do i have" otherwise, and answered as an empty
  // calendar — a question about projects, answered about a day.
  [INTENTS.QUERY_PROJECTS, /\bprojects?\b/i.source && ((body) =>
    MENTIONS_PROJECT.test(body) &&
    /\b(?:what|which|list|show|how many|how are|how's|tell me about)\b/i.test(body) &&
    !MAKES_A_PROJECT.test(body))],
  // "standup?" — a question about one thing, in one word.
  [INTENTS.QUERY_EVENT, NAMED_THING_QUESTION],
  [INTENTS.QUERY_EVENT, /\b(?:where(?:'?s| is)|how long is|is .* still on|when(?:'?s| is) (?:my|the)|what time is (?:my|the))\b|^\s*how long\s*\?+\s*$/],
  // `how's my week` is progress; `how's my week looking` is the diary. The two
  // are one word apart and QUERY_DAY, four rules down, already owns the second
  // — it just never got the chance, so "how's my week looking" came back as
  // focus hours while "how's my day looking" listed the day.
  [INTENTS.QUERY_PROGRESS, /\bhow much (?:time|have i|did i)\b|\bhow am i doing\b|\bwhat did i (?:do|finish|get done)\b|\bhow many hours\b|\bhow'?s my (?:focus|week)\b(?![^.?!]*\blook)/],
  // A project named inside a "how is it going" question is a progress
  // question about that project. Without this it reached PLAN_DAY and came
  // back as triage for the whole week.
  [INTENTS.QUERY_PROGRESS, (body) =>
    MENTIONS_PROJECT.test(body) &&
    /\bhow(?:'?s| is| are| am i doing)\b|\bprogress\b|\bwhere (?:are|is) (?:we|it|that)\b/i.test(body) &&
    Boolean(projectPhrase(body))],
  [INTENTS.PLAN_DAY, /\b((?:plan|sort out|sort|organi[sz]e|map out|lay out) (?:my|the)? ?(?:day|week|month)|plan today|what should i (?:do|work on)|priorit\w+ (?:my|the) day|schedule (?:my|the) work|make (?:me )?(?:a |the )?schedule\b|sort(?:ing)? out (?:my|the) (?:diary|calendar|schedule|day|week)\b|spread .* out|when (?:will|can) i (?:do|finish)|will .* fit|fit .* deadline|most urgent|what'?s urgent|behind on|on track|how much .* left|what'?s?(?: is)? left (?:on|for|in|of)\b|how(?:'?s| is| are) .* (?:going|doing)|triage|give me something to (?:do|work on)|what can i (?:do|work on)|something to work on|what'?s? (?:first|next up)|what should i (?:drop|cut|skip|postpone|shelve|lose)|(?:am|are) i (?:going to |gonna )?(?:make|hit|miss)\b|will i (?:make|hit|miss)\b|what'?s (?:at risk|slipping|in trouble)|falling behind|realistic)\b/],
  [INTENTS.QUERY_FREE, /\b(free|available|open (?:time|slot)|gaps?|any time|when can i|spare (?:time|hour|minutes?)|(?:any|some|got any|got some) (?:space|room))\b/],
  // Casual load words. "How packed is Friday" already worked and "am I slammed
  // tomorrow" did not, which is arbitrary from the outside — it is the same
  // question. The `is <day> <adjective>` form is held to a list of actual days
  // so it cannot swallow "is the board prep still on".
  // "friday?", "busy?" — a whole question, in one word and a mark.
  [INTENTS.QUERY_DAY, TERSE_DAY_QUESTION],
  [INTENTS.QUERY_DAY, TERSE_BUSY],
  [INTENTS.QUERY_DAY, /\b(what(?:'?s| is| does)?|show|list|when|do i have|how many|agenda|(?:my|the) schedule|look like|going on|how (?:busy|full|packed|loaded|slammed|jammed|heavy|light|rammed|manic|hectic)|am i (?:busy|slammed|swamped|packed|booked|jammed|rammed)|is (?:it |my |the )?(?:today|tomorrow|tmrw|tonight|mon|tues?|weds?|thur?s?|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|day|week|morning|afternoon|evening) (?:going to be |gonna be )?(?:chill|light|quiet|busy|packed|slammed|jammed|manic|heavy|hectic|full|rammed)|on my plate|how'?s? (?:my |the |it )?(?:today|tomorrow|tmrw|tonight|mon|tues?|weds?|thur?s?|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|day|week|morning|afternoon|evening)\b|read me|read back|run ?down|run me through|walk me through|talk me through|anything (?:on|in|this|that|tomorrow|today|tonight|next|left|else|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|at|after|before|in the)|clash(?:es)? with|conflicts? with|double[- ]?booked|overbooked|over ?committed|over ?loaded|too (?:full|packed)|bandwidth|at capacity|back[- ]to[- ]back|wall[- ]?to[- ]?wall|(?:have i got|do i have|got|is there) (?:the |any |enough )?(?:room|space|capacity)\b)\b/],
  // A series, not a booking. Checked before create, or only the first one of
  // twelve ever reaches the calendar.
  [INTENTS.REPEAT_EVENT, /\bevery other (?:day|week|month|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\bevery (?:day|weekday|week|other week|month|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(?:daily|weekly|fortnightly|biweekly|monthly)\b|\brepeat(?:s|ing)?\b|\brecurring\b|\beach (?:day|week|monday|tuesday|wednesday|thursday|friday)\b/],
  // Booking verbs, which is most of them. Every one of these was a real
  // sentence that fell through to "I didn't catch that" — people reach for a
  // startling number of words for "put this on the calendar".
  // `hop on a call`, `jump on a zoom`, `swing by the office` — the spoken forms
  // of "schedule". Each was falling past every booking rule and landing on the
  // catch-all CREATE_TASK at the bottom of the table, so "need to jump on a
  // call with Dana asap" became a to-do rather than a meeting.
  /**
   * Three widenings, each of them the same word said somewhere else.
   *
   * `book\w*` — "make a booking for Thursday 2pm" is ordinary phrasing across
   * South Asia and much of Africa, and `\bbook\b` cannot see the noun.
   *
   * `diaris` — the verb behind the diary, which is what a calendar is called
   * everywhere outside America. It only ever reached CREATE_EVENT by accident,
   * when the sentence happened to also name a kind of meeting and a day.
   *
   * And the calendar phrase now takes the other two nouns and the other verbs:
   * "stick it in the diary for Tuesday" and "chuck it in the diary" contained
   * no word any booking rule knew, and landed as bare fragments.
   */
  [INTENTS.CREATE_EVENT, /\b((?:hop|jump|get|dial) on(?:to)? an? (?:call|zoom|meet|meeting|teams|sync|huddle|line)|swing by|schedule|book\w*|diaris\w*|diariz\w*|block|set up|pencil in|pencil|hold|reserve|pop in|stick in|slot in|line up|(?:put|stick|chuck|bung|shove|pop|whack|throw|get|slip) .* (?:on|in|into) (?:my|the) (?:calendar|diary|schedule)|(?:find|make|set aside|carve out|free up|squeeze in) .*(?:time|hours?|minutes?)|(?:give|get|book) me\b.*\b(?:hours?|minutes?|time|slot)|add (?!.*\b(?:task|todo|to-do|reminder)\b).* (?:meeting|call|event))\b/],
  // The reporting voice. "I've got the dentist Friday at 9" is a booking with
  // no booking verb in it — people say what is happening as often as they ask
  // for it to be arranged. Guarded on there being a day or a clock, so "I've
  // got a lot on" stays the remark it is.
  [INTENTS.CREATE_EVENT, isReportedBooking],
  // Both ahead of CREATE_TASK, which would otherwise take them: "new project
  // called Q3" contains "new" and "add the deck to the Marketing project"
  // contains "add", and both became tasks named after the sentence.
  //
  // Filing is tried first. "Add the deck to the Marketing project" satisfies
  // both readings, and the one that files an existing thing is nearly always
  // what was meant — creating a project called "deck" is not.
  [INTENTS.FILE_TASK, (body) =>
    MENTIONS_PROJECT.test(body) && FILES_UNDER.test(body) && Boolean(projectPhrase(body))],
  [INTENTS.CREATE_PROJECT, (body) =>
    MAKES_A_PROJECT.test(body) && Boolean(projectPhrase(body))],
  // "Do the needful" is South Asian English for "handle it", and in "kindly do
  // the needful regarding the lease" it is the whole instruction — there is no
  // other verb in the sentence. Last in the table, so anything that also says
  // *what* to do ("do the needful and clear my Friday") is claimed by the rule
  // for that instead.
  [INTENTS.CREATE_TASK, /\b(add|create|new|remind me to|need to|todo|do the needful)\b/],
];

const PRIORITY = [
  [/\b(critical|urgent|asap|drop everything)\b/, "critical"],
  [/\b(high priority|important|high)\b/, "high"],
  [/\b(low priority|whenever|low|someday)\b/, "low"],
  // Parking something is how anybody actually says "low priority", and the
  // rule that routes it to EDIT_TASK had no level to set — so the edit landed
  // with nothing in it and she answered "I'm not sure what to change".
  [PARKED, "low"],
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

/**
 * Two instructions with a comma between them: "book lunch fri, cancel the 4pm".
 *
 * The leading verb governs — that is the rule this whole table is ordered
 * around — and a comma was quietly breaking it, because CANCEL sits above
 * CREATE and took the sentence off the second clause. So she cancelled a
 * meeting when the first thing asked of her was to book one.
 *
 * Both halves must open with a command verb, which is what makes splitting on
 * a comma safe at all. "I'm swamped, clear my Wednesday" fails on the left —
 * a complaint is not a command — and "add sign the lease, high priority, due
 * friday" fails on the right, so the one sentence in the corpus carrying three
 * commas inside a single instruction is untouched.
 */
const COMMAND_VERB =
  "book|schedule|add|create|make|move|shift|push|bump|reschedul\\w*|cancel\\w*|delete|remove|drop|clear|wipe|block|hold|pencil|slot|put|find";
const TWO_COMMANDS = new RegExp(
  `^((?:${COMMAND_VERB})\\b[^,]{2,})\\s*,\\s*((?:${COMMAND_VERB})\\b[^]{2,})$`, "i");

/** "make it 3pm", "move it to Friday" — an edit to something already named. */
const AMEND = /^\s*(?:make|change|set|push|move|shift|bump)\s+(?:it|that|this|them)\b/i;

const PRONOUN = /\b(?:it|that one|that|this one|them|those|the meeting|the event|the task|the call)\b/i;

/** A reference to more than one thing already mentioned. */
const PLURAL_PRONOUN = /\b(?:them|those|these|they|both|all of (?:them|it|those)|the rest of (?:them|it)|everything)\b/i;

/** The noun that decides whether a bare booking is a "Call" or a "Meeting". */
/**
 * The office names for a meeting were missing from this list, so a sentence
 * with no booking verb in it — "let's touch base tomorrow at 3", "put the
 * retro in for Friday at 4" — had nothing to tell the parser a meeting was
 * being described, and fell through to the follow-up machinery.
 *
 * `kick-off` and `all-hands` are held to the hyphenated or joined spellings.
 * "Kick off" with a space is a verb, and it already belongs to ACTION_VERB.
 */
const KIND_NOUN = /\b(call|meeting|sync|standup|stand-up|interview|review|1:1|one on one|lunch|dinner|coffee|appointment|catch ?up|break|breather|debrief|prep|block|slot|session|walk|workout|gym|school run|commute|travel|drive|flight|train|touch ?base|touch-base|all[- ]hands|off-?site|kick-?off|retro(?:spective)?|huddle)\b/i;

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
  // First and third person. Without these, "I can't make the board call" was
  // read as removing an attendee named "I" instead of as a cancellation.
  "i", "we", "he", "she", "they", "nobody", "everybody",
  /**
   * Months, in the abbreviations people type. "board call sept 3" was booking
   * a meeting with somebody called Sept — `call` takes a person as its direct
   * object, and a month sitting where the person goes looked exactly like one.
   *
   * Only the short forms and the four long ones that are not also given names:
   * March, April, May, June, July and August belong to people as well as to
   * the calendar, and `handoffTarget` already lets a capital letter overrule
   * this list for exactly that reason.
   */
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "january", "february", "september", "october", "november", "december",
  /**
   * Prepositions, for the same reason as the months directly above.
   *
   * "Book a call on Friday at 2" put a person named **On** on the invitation,
   * and "schedule the board call for Friday" one named **For** — `call` takes
   * a person as its direct object, and what actually follows it is very often
   * a preposition. None of these is anybody's name in any dialect, so this
   * list is where they belong.
   */
  "on", "for", "at", "in", "into", "about", "from", "by", "with",
  "off", "out", "up", "over", "back", "around",
]);

/**
 * "Bob is taking point on Munich." "Let Sarah run with the term sheet."
 *
 * The person is the subject of the sentence rather than the object of a "to",
 * which is the only shape `handoffTarget` can see — so all of these fell
 * through to "I didn't catch that", and the ones that did route asked
 * "delegate it to whom?" of somebody who had just said whom.
 *
 * Held to an explicit hand-off verb directly after the name. Without that,
 * "Bob can't make the board call" is a cancellation with a name in front of
 * it, and reading the name as a hand-off target would quietly assign the work
 * to the one person who just said they were unavailable.
 */
const OWNER_FIRST =
  /^\s*(?:(?:let|get|have|can|could|maybe|perhaps|so)\s+)?([A-Za-z][\w'’-]{1,20})\s+(?:(?:can|could|will|would|should|is|are|'s|'ll|to|has)\s+)?(?:take point|takes point|taking point|take over|takes over|taking over|run with|runs with|running with|pick up|picks up|picking up|owns?|owning|covers?|covering|takes?|taking)\b/i;

function ownerFirst(body) {
  const text = String(body ?? "");
  /**
   * "Who owns the board deck?" has this shape exactly, and reading it as a
   * hand-off assigned the task to a person named "Who" — a question answered
   * by changing data, which is the worst thing this file can do. Asking who
   * has something is a different question from giving it to them, and this
   * parser has no intent that answers it; a miss is the honest outcome.
   */
  if (/^\s*(?:who|whom|whose|what|which|when|where|why|how)\b/i.test(text)) return null;
  /**
   * "I'm taking a half-day on Friday." "We're covering the Munich close."
   *
   * A first-person subject is never a hand-off — there is nobody on the other
   * end of it. `NOT_A_NAME` below knows "i" and "we", and the word this
   * pattern captures is "i'm", which is in no list at all; so a sentence about
   * the user's own leave was delegated to a person called "I'm", and the leave
   * itself never reached the calendar.
   */
  if (/^(?:i|we|you)(?:['’](?:m|re|ve|ll|d))?$/i.test(text.match(OWNER_FIRST)?.[1]?.trim() ?? "") ||
      /^(?:im|ive|weve|youre)$/i.test(text.match(OWNER_FIRST)?.[1]?.trim() ?? "")) return null;
  const m = text.match(OWNER_FIRST);
  if (!m) return null;
  const name = m[1].trim();
  if (NOT_A_NAME.has(name.toLowerCase())) return null;
  if (/^(?:whoever|somebody|anybody|everyone|people|person|noone)$/i.test(name)) return null;
  if (name.length < 2) return null;
  // A number is not a person, for the same reason it is not an attendee.
  if (/^(?:\d|(?:an?|one|two|three|four|five|six|seven|eight|nine|ten|half|couple|few|some)$)/i.test(name)) return null;
  if (parseDate(name, new Date()) || parseTime(name)) return null;
  return [m[0], name.replace(/^\w/, (c) => c.toUpperCase())];
}

/**
 * Who a task is being handed to: "delegate the deck to bob".
 *
 * The capital used to be required here, which quietly broke the whole feature
 * for anybody who *talks* to her. A speech recogniser returns "delegate the sow
 * to bob" in lower case, every time — so a dictated hand-off was classified
 * correctly, found no person, and asked "delegate it to whom?" of somebody who
 * had just said whom. Typing it on a phone with autocorrect off fails
 * identically, and neither failure looks like a bug from the outside; she just
 * seems not to be listening.
 *
 * A capital is evidence now rather than a requirement. Without one the word has
 * to survive two guards, and both exist because of what actually follows "to"
 * in a calendar app: `NOT_A_NAME` stops "move it to lunch" handing a task to
 * somebody called Lunch, and the date check stops "push it to Friday" doing the
 * same. A capitalised word skips the stop-list — somebody who wrote "Friday"
 * with a capital in the middle of a sentence about delegation is more likely to
 * have a colleague called Friday than to be naming the day.
 *
 * @returns {[string, string] | null} a match-shaped pair, so callers read [1]
 */
function handoffTarget(body) {
  // The surname may be lower case too — somebody dictating gets no capitals at
  // all, so requiring one on the second word only moved the failure along by a
  // word. "next friday" is caught by the date check below rather than here.
  /**
   * "Get Bob to do the deck" names the person in front of the job instead of
   * after it, which is the one place a tail-anchored pattern cannot look — so
   * the sentence routed to a hand-off and then asked "delegate it to whom?" of
   * somebody who had just said whom.
   */
  const upFront = body.match(
    /\bget\s+([A-Za-z][\w'’-]*)\s+to\s+(?:do|take|handle|sort|finish|write|draft|run|own|cover|chase|deal with|look at|pick up|sort out|take over|crack on)\b/i);
  if (upFront && !NOT_A_NAME.has(upFront[1].toLowerCase()) && upFront[1].length > 1) {
    return [upFront[0], upFront[1].replace(/^\w/, (c) => c.toUpperCase())];
  }

  // "Fob the diligence index off on Dana." The one hand-off preposition that
  // isn't "to", and only ever in that shape — nothing else in a calendar app
  // ends "off on <word>".
  //
  // An arrow stands in for the preposition too: "lease → anders" is the same
  // sentence as "give the lease to anders", typed by somebody who has typed it
  // a hundred times.
  const m = body.match(/(?:\b(?:to|with|for|off on)\s+|(?:-{1,2}>|=>|→|⟶)\s*)([A-Za-z][\w'’-]*(?:\s+[A-Za-z][\w'’-]+)?)\s*$/);
  if (!m) return ownerFirst(body);

  const name = m[1].trim();
  const capitalised = /^[A-Z]/.test(name);
  if (!capitalised) {
    const first = name.split(/\s+/)[0].toLowerCase();
    if (NOT_A_NAME.has(first)) return null;
    // A day, a month, "tomorrow", "noon" — the sentence is about when, not who.
    if (parseDate(name, new Date()) || parseTime(name)) return null;
    // A single letter is a typo or an initial, never a person to hand work to.
    if (first.length < 2) return null;
  }
  return [m[0], name.replace(/^\w/, (c) => c.toUpperCase())];
}

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
  // Correction markers. A typo here is expensive out of proportion to its
  // size: "actaully no, move that" reads as a brand new command about a
  // meeting called "Actaully no".
  "actually", "sorry", "nevermind", "instead", "meant",
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
/**
 * Homophones dictation gets wrong, corrected only where they cannot be right.
 *
 * "Remind me too sign the lease" is three characters from working and reads as
 * nonsense to every rule. Kept to positions where the wrong word is impossible
 * — "too" directly before a bare verb is always "to" — rather than a general
 * swap, which would break "two" and "too" everywhere they are correct.
 */
/**
 * Texting shorthand, expanded before anything else reads the sentence.
 *
 * "w/" is the commonest thing anybody types into a phone, and every rule and
 * every slot in this file looks for the word "with" — so "lets do 3pm thurs w/
 * bob" found no people, no attendee and no intent, while the spelled-out
 * version worked perfectly. Same for "&" between two names and "b4" in front of
 * a day. Held to forms that cannot mean anything else, and "w/o" is expanded
 * first so it is never turned into "with o".
 */
function expandShorthand(text) {
  return text
    .replace(/\bw\/o\b/gi, "without")
    .replace(/\bw\/\s*/gi, "with ")
    .replace(/\s+&\s+/g, " and ")
    .replace(/\bb4\b/gi, "before")
    .replace(/\bwks\b/gi, "weeks")
    .replace(/\bwk\b/gi, "week")
    // "@3pm", "fri @10". `parseTime` wants an "at" or a meridiem in front of a
    // bare hour and an "@" is neither as far as a regex is concerned, so the
    // commonest shorthand on a calendar carried no time at all. An "@" in
    // front of a digit is never an email address.
    .replace(/@\s*(?=\d)/g, "at ");
}

/**
 * A weekday, for the positions where a number word is really a preposition.
 */
const SPOKEN_DAY =
  "monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun|tomorrow|today|tonight|next week|next month";

/** Verbs that make a following number a destination rather than a count. */
const MOVES = /\b(?:mov(?:e|es|ed|ing)|reschedul\w*|push\w*|shift\w*|bump\w*|postpon\w*|switch\w*|chang\w*|put)\b/i;

/**
 * "3pm → 4", "lease → anders", "move standup -> 10".
 *
 * An arrow is the whole of the telegraphic register's syntax for "becomes",
 * and it means two different things depending only on what sits to the right
 * of it: a time is a move, a person is a hand-off. Read as one shape anchored
 * to the line rather than bolted onto the alternations of the move and
 * delegate rules, which would then each have to work out whether the other one
 * wanted it — and that is how "lease -> anders" ends up moving a meeting to a
 * colleague.
 *
 * Returns null for anything else on the right, including a second arrow: a
 * list is not an edit, and a phrase that is neither a time nor a name is not
 * something to guess about.
 */
const ARROW = /^\s*(\S[^]{0,60}?)\s*(?:-{1,2}>|=>|→|⟶|›|»)\s*([^]{1,40}?)\s*[.!]*$/;

export function parseArrow(text, now = new Date()) {
  const m = text.match(ARROW);
  if (!m) return null;
  const left = m[1].trim();
  const right = m[2].trim();
  if (!left || !right || /-{1,2}>|=>|→|⟶/.test(right)) return null;

  // A bare number on the right of an arrow is a clock time. There is nothing
  // else it can be: the thing on the left already exists.
  if (/^\d{1,2}(?::\d{2})?$/.test(right) || parseTime(right) || parseDate(right, now)) {
    return { op: "move", left, right };
  }
  const name = right.match(/^([A-Za-z][\w'’-]{1,19})(?:\s+[A-Za-z][\w'’-]{1,19})?$/);
  if (name && !NOT_A_NAME.has(name[1].toLowerCase())) return { op: "delegate", left, right };
  return null;
}

function fixHomophones(text) {
  let t = expandShorthand(text)
    .replace(/\b(remind(?:er)? (?:me |us )?)too\b/gi, "$1to")
    .replace(/\b(need|want|have|got|going|like|able|forget|remember|meant|try|trying)\s+too\s+(?=[a-z])/gi, "$1 to ")
    .replace(/\bi'?d like too\b/gi, "i'd like to")
    .replace(/\bhow long til\b/gi, "how long until");

  /**
   * What a recogniser hears when somebody says a time.
   *
   * "Move my meeting too for pm." Every word is a real English word and the
   * sentence is unreadable — which is the whole difficulty, because a spell
   * checker has nothing to flag and `despell` is a distance search over
   * correctly spelled input. Only position can tell these apart, so every one
   * of them is bound to a neighbour that makes the wrong reading impossible:
   * "for" in front of a meridiem is never the preposition, "at to" is not
   * English, "an our" is not a phrase.
   *
   * The alternative — teaching each of the twenty-odd rules in the table above
   * to also accept "ate" and "too thirty" — spreads one problem across the
   * whole file, and every widened alternation in a first-match-wins table is a
   * chance to steal a sentence from the intent below it. This is the same
   * doctrine as the four corrections above, applied to the times.
   */
  t = t
    // "four", heard as the preposition. Only ever directly in front of a
    // meridiem or a clock, where "for" cannot be what was said.
    .replace(/\bfor\s+(?=(?:a\.?m\.?|p\.?m\.?|o'?\s*clock|thirty|fifteen)\b)/gi, "four ")
    .replace(/\b(at|to|until|till)\s+for\b(?!\s*(?:a|an|the|me|us|him|her|them|you|it|my|our|your|his|its)\b)/gi, "$1 four")
    // "two", heard as a preposition. Bound to the minute word behind it, so
    // "two hours" and "book two calls" are untouched.
    .replace(/\b(?:too|to)\s+(?=(?:thirty|fifteen|forty[\s-]?five|forty|twenty|forty-five)\b)/gi, "two ")
    .replace(/\b(the|my|that|this|a)\s+too\b/gi, "$1 two")
    .replace(/\btoo\s*(?=(?:a\.?m\.?|p\.?m\.?|o'?\s*clock)\b)/gi, "two ")
    // "eight". "At ate" and "ate pm" are not sentences in any reading.
    .replace(/\b(at|to|until|till)\s+ate\b/gi, "$1 eight")
    .replace(/\bate\s*(?=(?:a\.?m\.?|p\.?m\.?|o'?\s*clock|thirty|fifteen|forty)\b)/gi, "eight ")
    // "three", "six", "one" — each fenced to a position that fixes the reading.
    .replace(/\btree\s*(?=(?:a\.?m\.?|p\.?m\.?|o'?\s*clock|thirty|fifteen)\b)/gi, "three ")
    .replace(/\b(at|to|until|till)\s+sicks\b/gi, "$1 six")
    .replace(/\b(at|to|until|till)\s+won\b/gi, "$1 one")
    .replace(/\bwon\s+(?=(?:hours?|minutes?|mins?|thirty|a\.?m\.?|p\.?m\.?|o'?\s*clock)\b)/gi, "one ")
    // "hour", heard as the possessive. "An our" is not English; "for hours"
    // after a booking verb is four of them.
    .replace(/\b(an|one|another)\s+ours?\b/gi, "$1 hour")
    .replace(/\b(\d+|two|three|four|five|six|couple of|few)\s+ours\b/gi, "$1 hours")
    .replace(/\b(block|book|schedul\w*|reserve|hold|need|want)\s+for\s+(?=hours?\b)/gi, "$1 four ")
    // "due", heard as the verb. "Is do Friday" is not a sentence.
    .replace(new RegExp(`\\bis\\s+do\\s+(?=(?:${SPOKEN_DAY}|next|the)\\b)`, "gi"), "is due ")
    // "week", heard as its homophone. Never an adjective after "next"/"this".
    .replace(/\b(next|this|last|coming)\s+weak\b/gi, "$1 week")
    // "meet", heard as the food. Bound to a following "with", which is what
    // makes the other reading impossible in a calendar.
    .replace(/\bmeat\s+(?=with\b)/gi, "meet ")
    .replace(/\bmeating\s+(?=with\b)/gi, "meeting ");

  /**
   * "Reschedule the board prep two Wednesday."
   *
   * Guarded on the sentence having a move verb in it, because "book two Friday
   * slots" is a count of meetings and the same replacement would turn it into a
   * destination. "Too" needs no guard — it is never a preposition.
   */
  t = t.replace(new RegExp(`\\btoo\\s+(?=(?:${SPOKEN_DAY})\\b)`, "gi"), "to ");
  if (MOVES.test(t)) {
    t = t.replace(new RegExp(`\\btwo\\s+(?=(?:${SPOKEN_DAY})\\b)`, "gi"), "to ");
  }
  return t;
}

function despell(text) {
  text = fixHomophones(text);
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
  /^\s*(?:please|kindly|just|quickly|go ahead and|do me a favou?r and|if you (?:could|can|would)|whenever you (?:get|have) a (?:chance|moment|sec|second)|when you (?:get|have) a (?:chance|moment|sec|second)|i was wondering if you (?:could|can)|any chance (?:you )?(?:could|can)|do you think you could|is it possible to|would it be possible to|are you able to|would you be able to|can you|could you|would you|will you|would you mind|do you mind|(?:i'?d like(?: you)? to|i want(?: you)? to|i need(?: you)? to|we need to)(?!\s+(?:finish|complete|wrap up)\b)|help me|(?:i\s+)?(?:gotta|got ?ta|gonna|wanna|hafta|oughta|needa|imma)(?!\s+(?:finish|complete|wrap up)\b))\b[\s,]*/i;

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
    const next = t.replace(COMPLAINT_PREFIX, "").replace(re, "").replace(POLITE_SOFT, "");
    if (next === t) break;
    t = next;
  }
  return t;
}

/**
 * A complaint said before the instruction, peeled off like a courtesy.
 *
 * "I'm drowning, book lunch Friday" routes correctly and then books a meeting
 * called "I'm drowning lunch"; "everything is on fire, cancel the standup"
 * comes back "Standup is at fire, cancel the standup" — the words "on fire"
 * read as a location. The routing was never the problem. Everything downstream
 * that reads the sentence for a title, an object or a place gets the venting
 * along with the request.
 *
 * So it is removed the same way "please" and "could you" are, and for the same
 * reason: it is how somebody speaks, not part of what they are asking for. A
 * comma and something substantial after it are both required, so a bare "I'm
 * drowning" keeps all of its words and still reaches the triage answer.
 */
const COMPLAINT_PREFIX =
  /^\s*(?:(?:i'?m|im|i am|we'?re|were|this|that|everything|it)\s+[^,]{0,40}?)?\b(?:swamped|slammed|buried|drowning|underwater|overwhelmed|overloaded|stressed|snowed under|maxed out|so behind|really behind|way behind|on fire|a mess|a disaster|insane|crazy|chaos|chaotic|too much|hopeless|impossible|exhausted|knackered|shattered|fried|dying|dead)\b[^,]{0,20},\s*/i;

/** Only the wrappers, for the classifier. */
export const unwrap = (text) => {
  let t = text;
  for (let i = 0; i < 6; i++) {
    const next = t.replace(COMPLAINT_PREFIX, "").replace(POLITE_WRAPPER, "");
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
      /^\s*(?:add|create|make|new|schedule|book|block(?: out| off)?|set up|set aside|carve out|pencil in|pencil|pop in|pop|put down|put|stick(?: in)?|slot in|slot|throw|chuck(?: in| out| away)?|bung(?: in)?|shove(?: in)?|whack(?: in)?|line up|arrange|organi[sz]e|diaris(?:e|ing)|diariz(?:e|ing)|prepon(?:e|ing)|do the needful(?:\s+(?:and|to|for))?|reserve|hold|open|squeeze in|find|get me|give me|find me|get|remind me to|need to|want to|i need(?: to)?|i'?ve got|ive got|i have got|i'?m (?:seeing|meeting|visiting|taking|off to|flying to|driving to|on|off on|away on|out of)|im (?:seeing|meeting|visiting)|there'?s an?|theres an?|there is an?|we'?re (?:meeting|having|seeing)|i want(?: to)?|i'?d like|we need(?: to)?|i have to|i've got to|i gotta|smash(?:ing)?(?: out)?|bash(?:ing)? out|bang(?:ing)? out|knock(?:ing)? out|hammer(?:ing)? out|crank(?:ing)? out|crack(?:ing)? on(?: with)?|get(?:ting)? on with|mov(?:e|ing)|spread(?:ing)?|split(?:ting)?|divid(?:e|ing)|lay(?:ing)?|stagger(?:ing)?|stretch(?:ing)?|reschedul(?:e|ing)|shift(?:ing)?|bump(?:ing)?|postpon(?:e|ing)|push(?:ing)?|cancel(?:l?ing)?|delet(?:e|ing)|remov(?:e|ing)|drop(?:ping)?|clear(?:ing)?|wip(?:e|ing))\s+/i,
      "",
    )
    .replace(/\b(?:a|an|the)\s+(?:task|meeting|call|event|reminder|appointment|sync|standup|stand-up|catch ?up|chat|block|slot|interview|review|1:1|one on one)\s+(?:to|for|called|named)?\s*/i, "")
    /**
     * "new task review the deck" — the noun with no article in front of it.
     *
     * Guarded against the word being a verb instead. "call the bank" opens
     * with the same five letters as "call with Priya", and stripping it left
     * "the bank", which the connector peel below then reduced to a task called
     * "Bank" — the verb silently deleted from something somebody dictated.
     * An article after it is what separates the two: nobody names a meeting
     * "the bank", and nobody rings a noun.
     */
    .replace(
      /^\s*(?:task|meeting|call|event|reminder)\s+(?:(?:to|for|called|named)\s+|(?!(?:a|an|the|my|our|his|her|their|this|that)\b))/i,
      "",
    )
    // "make time for the letter" — the object of the verb is the time itself.
    .replace(/^\s*(?:some\s+)?time\s+(?:for|on|to)\s+/i, "")
    // "Monday is a bank holiday" names the holiday, not the sentence.
    .replace(/^\s*(?:[\w'’-]+\s+)?(?:is|are)\s+(?:a|an|the)?\s*(?=(?:bank holiday|public holiday|annual leave|half[- ]day|a day off))/i, "")
    .trim();
}

/** Remove time/date/duration phrases so they don't end up inside a title. */
function stripTemporal(text) {
  return text
    // Recurrence wording. "Every Monday at 9 standup" was booking a series of
    // meetings all called "Every standup".
    .replace(/\b(?:every|each)\s+(?:other\s+)?(?:day|weekday|week|month|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/gi, " ")
    .replace(/\b(?:daily|weekly|fortnightly|bi-?weekly|monthly|recurring|repeat(?:s|ing|ed)?)\b/gi, " ")
    /**
     * "fri 10", "10 fri", "tues 3" — the day and the bare hour attached to it,
     * removed together and ahead of the day-only rule below. Taking the day
     * out first strands the number, and a stranded number is what put "Priya
     * 10" and "Bob 10" on the calendar as the names of meetings.
     */
    .replace(/\b(?:on|at)?\s*\b(?:next|this|coming)?\s*\b(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)(?:day|nesday|rsday|urday)?s?[ \t]*@?[ \t]*\d{1,2}(?::\d{2})?\b(?!\s*(?:st|nd|rd|th|[ap]\.?m|h\b|hrs?\b|hours?\b|m\b|mins?\b|minutes?\b))(?!\s*(?:-|–|—|to|until|till)\s*\d)(?![\d/:-])/gi, " ")
    .replace(/(?<![\d/:-])\b\d{1,2}(?::\d{2})?\s+(?:on\s+)?(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)(?:day|nesday|rsday|urday)?s?\b/gi, " ")
    .replace(/\b(?:today|tomorrow|tonight|tmrw)[ \t]*@?[ \t]*\d{1,2}(?::\d{2})?\b(?!\s*(?:st|nd|rd|th|[ap]\.?m|h\b|hrs?\b|hours?\b|m\b|mins?\b|minutes?\b))(?!\s*(?:-|–|—|to|until|till)\s*\d)(?![\d/:-])/gi, " ")
    // "A week on Tuesday", "Tuesday week", "Tues 14th" — dates whose weekday is
    // only half of them, so all three run *before* the plain weekday strip
    // below. That one would otherwise eat the day name and leave "a week on"
    // and a bare "14th" standing in the title.
    .replace(/\b(?:an?|one|1)\s+(?:week|fortnight)\s+(?:on|from)?\s*(?=\b(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)\w*\b)/gi, " ")
    .replace(/\b(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)(?:day|nesday|rsday|urday)?\s+(?:week|fortnight)\b/gi, " ")
    .replace(/\bin\s+(?:an?\s+)?fortnights?\b|\ba fortnight\b|\bfortnight\b/gi, " ")
    .replace(/\b(?:on|at|for|by|due)?\s*\b(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)(?:day|nesday|rsday|urday)?\s+(?:the\s+)?\d{1,2}(?:st|nd|rd|th)\b/gi, " ")
    .replace(/\b(?:on|at|for|by|due)?\s*\b(?:next|this|coming)?\s*\b(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)(?:day|nesday|rsday|urday)?\b/gi, " ")
    .replace(/\b(?:today|tomorrow|tonight|yesterday|tmrw)\b/gi, " ")
    // "2 to 4", "9 until 11:30" — a span written as two clock times. Left in,
    // it becomes the title: "hold thursday 2 to 4" booked a meeting called
    // "2 to 4".
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:to|until|till|–|—|-)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, " ")
    .replace(/\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)\b/gi, " ")
    // Bare "at 10" with no meridiem — otherwise it survives into a title or
    // subject as trailing noise.
    .replace(/\b\d{1,2}\s*o'?\s*c?l[o0]?c?k\b/gi, " ")
    .replace(/\bat\s+\d{1,2}(?::\d{2})?\b/gi, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ")
    // "1h30", "2h15m" — hours and minutes run together, removed before the
    // plain form below, which takes the "1h" and leaves "30" in the title.
    .replace(/\b\d{1,2}\s*h(?:rs?|ours?)?\s*\d{1,2}\s*(?:m|mins?|minutes?)?\b(?![\d:])/gi, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:h|hrs?|hours?|m|mins?|minutes?)\b/gi, " ")
    .replace(/\b(?:half an hour|an hour|a hour)\b/gi, " ")
    .replace(/\b(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple|few|several|half)\s+(?:of\s+)?(?:and a half\s+)?(?:hours?|hrs?|minutes?|mins?)\b/gi, " ")
    .replace(/\b(?:in\s+\d+\s+days?)\b/gi, " ")
    // "first thing" names an hour as plainly as "at nine" does — `DAYPARTS`
    // reads it as one — so it has to come out of a title for the same reason
    // the other parts of the day do. Left in, "first thing tomorrow" is a
    // complete when and a leftover noun, which reads as a booking called
    // "First thing".
    .replace(/\bfirst thing\b/gi, " ")
    .replace(/\b(?:morning|afternoon|evening|noon|midnight|night)\b/gi, " ")
    .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\w*\.?\s+(?:the\s+)?\d{1,2}(?:st|nd|rd|th)?\b/gi, " ")
    // "3rd of September", "14 Aug", "3/9" — the day-first forms, which the
    // month-first rule above cannot see, and the slash form, which nothing could.
    .replace(/\b(?:on\s+|for\s+)?(?:the\s+)?\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\w*\.?/gi, " ")
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\bdue\b/gi, " ")
    // "cancel tomorrow's lunch" loses its day above and keeps the possessive,
    // which then reads as a word: the title came out "'s lunch".
    .replace(/(^|\s)['’]s\b/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** "with bob and Sarah" → ["Bob", "Sarah"]. Case-insensitive by design. */
function extractPeople(text) {
  // "Bob asked for time Thursday afternoon." The person is the subject of the
  // sentence rather than the object of a "with", which is the only shape the
  // pattern below can see.
  const asked = text.match(/^([A-Z][\w'’-]+|[a-z][\w'’-]+)\s+asked\s+(?:me\s+)?for\b/);
  if (asked && !NOT_A_NAME.has(asked[1].toLowerCase())) {
    return [asked[1][0].toUpperCase() + asked[1].slice(1)];
  }

  const m = text.match(/\bwith\s+([\w'-]+(?:\s*(?:,|and)\s*[\w'-]+)*)/i);
  if (!m) {
    // "I need to see Tom at some point." Not every meeting is phrased with a
    // "with" in it, and these verbs take a person as their direct object.
    const direct = text.match(/\b(?:see|meet|catch up with|sit down with|speak to|talk to|call|ring|grab (?:coffee|lunch|a coffee) with)\s+([\w'’-]+)\b/i);
    if (direct && !NOT_A_NAME.has(direct[1].toLowerCase()) && !KIND_NOUN.test(direct[1])) {
      return [direct[1][0].toUpperCase() + direct[1].slice(1)];
    }
    return [];
  }
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
/**
 * Verbs that take "on" as part of the verb, not as a preposition.
 *
 * "A call on the term sheet" has a subject; "turn on the lights" does not, and
 * reading one as the other left a task called "Turn" with its object filed as
 * an agenda.
 */
const PHRASAL_ON = new Set([
  "turn", "focus", "focusing", "focussed", "work", "working", "check", "checking",
  "get", "getting", "move", "moving", "count", "counting", "rely", "relying",
  "hold", "holding", "carry", "carrying", "go", "going", "put", "putting",
  "press", "pressing", "switch", "switching", "log", "logged", "sign", "signing",
  "based", "up", "in", "back", "keep", "keeping", "catch", "catching", "follow",
  "following", "read", "reading", "sleep", "pass", "passing", "take", "taking",
  // "Crack on with the term sheet" is a job, not a call about cracking.
  "crack", "cracking", "crank", "cranking",
]);

/** The words that name an appointment rather than describe an action. */
const MEETING_NOUN =
  /^(?:meetings?|calls?|events?|syncs?|chats?|1:1|appointments?|catch-?ups?|blocks?|lunch|dinner|breakfast|coffee|drinks|standups?|stand-ups?|interviews?|reviews?)$/i;

function extractSubject(text, people = []) {
  const m = text.match(/\b(about|regarding|re:?|to discuss|to go over|covering|on)\s+(.+)$/i);
  if (!m) return null;
  // Bare "on" only marks a subject when the word in front of it isn't the rest
  // of a phrasal verb.
  if (/^on$/i.test(m[1])) {
    const before = text.slice(0, m.index).trim().split(/\s+/).pop() || "";
    if (PHRASAL_ON.has(before.toLowerCase().replace(/[^\w]/g, ""))) return null;
  }
  /**
   * "think about the rebrand" has no subject — it has an object.
   *
   * A subject is the topic of an appointment, and every real one has something
   * in front of it saying what the appointment is: "meeting about the merger",
   * "lunch with Sam about the raise". A lone verb in front of "about" is a
   * different grammar entirely, and treating it as a subject cut the object
   * out of the title — "think about the rebrand" became a task called "Think",
   * and "talk to legal about the lease" became no task at all. The app deleted
   * the thing being described and kept the word describing the shape of it.
   *
   * Meeting nouns are exempt, because a one-word "call about the lease" really
   * is the lease.
   *
   * Counted after the command verb is removed, or the word somebody opens with
   * does the hiding: "add think about the rebrand" leads with two words and
   * "think about the rebrand" with one, and they are the same request.
   */
  const lead = stripVerbs(text.slice(0, m.index)).trim().split(/\s+/).filter(Boolean);
  if (lead.length === 1 && !MEETING_NOUN.test(lead[0])) return null;
  const cleaned = stripTemporal(m[2])
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
    /**
     * Everything past an arrow, which is never part of the name.
     *
     * "lease → anders" is the lease, handed to Anders; the person belongs in
     * the hand-off slot and was ending up in the title instead. Same for
     * "3pm → 4pm", where cutting at the arrow leaves nothing at all — which is
     * correct, and lets the caller compose a name from whatever it resolved.
     */
    .replace(/\s*(?:-{1,2}>|=>|→|⟶|›|»)[^]*$/, " ")
    /**
     * "meeting about the merger" is the merger — the subject is the name, and
     * the wording in front of it is scaffolding.
     *
     * Unless the scaffolding is the whole verb. "think about the rebrand" is
     * not a task called "Think", and "talk to legal about the lease" is not a
     * task called nothing at all, which is what these produced: for a verb that
     * takes "about" as its object, cutting there deletes the object and leaves
     * the app holding the word somebody used to describe the *shape* of the
     * work rather than the work. One word in front of "about" is the tell —
     * there is no meeting whose entire name is a single verb.
     */
    .replace(/\b(?:about|regarding|re:?|to discuss|to go over|covering)\s+.+$/i, (m, off, whole) =>
      whole.slice(0, off).trim().split(/\s+/).filter(Boolean).length <= 1 ? m : " ")
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
  // "All day" is the shape of the booking, not its name — "the offsite is
  // Friday all day" was producing a meeting called "Offsite is all day".
  t = t.replace(/\b(?:is|are|runs?|goes)\s+(?:on\s+)?(?:all[- ]?day|the whole day|the entire day|the full day)\b/gi, " ");
  t = t.replace(/\ball[- ]?day\b|\bwhole day\b|\bentire day\b|\bfull day\b/gi, " ");
  // "Bob asked for time" says who and roughly how long. None of it is a name.
  t = t.replace(/^\s*[\w'’-]+\s+asked\s+(?:me\s+)?for\s+(?:time|\d+\s*\w+|an? \w+|half an hour)?/i, " ");
  t = t.replace(/\s{2,}/g, " ").trim();
  /**
   * Punctuation left standing where a phrase used to be.
   *
   * Everything above cuts from the middle of the sentence, and the peel at the
   * end of this function only tidies the two ends — so "sign the lease, 1 hour,
   * for Anders" lost its duration and kept both of the commas that had been
   * holding it, producing a task genuinely named "Sign the lease, , for
   * Anders". A stray comma reads as a typo the user made.
   */
  t = t.replace(/\s*,(?:\s*,)+/g, ",").replace(/\s+([,;:])/g, "$1");
  // Peel connectors, articles, and stranded pronouns off both ends until
  // nothing changes: "for the board deck" is a phrase from the command,
  // "Board deck" is the thing itself, and "it for" is nothing at all.
  // Whitespace is required after each word so "On-site review" survives.
  let prev;
  do {
    prev = t;
    t = t.replace(/^(?:for|about|on|in|at|to|with|re|called|named|and|it|that|this|them|those|a|an|the|my|our|me|us|you|from)\s+/i, "");
    // "before" joins the list because "b4" is expanded into it: "gotta sign the
    // lease b4 friday" left a task called "Sign the lease before" once the day
    // was cut out from behind it. Only "before" — "after" is left alone so
    // "the day after tomorrow" keeps the shape it already had.
    t = t.replace(/\s+(?:for|about|on|in|at|to|by|from|with|and|it|that|me|us|before)$/i, "");
    // The symbols a terse line is punctuated with, peeled off both ends the
    // same way the connectors are. "board deck +2h" is the board deck, not a
    // task called "Board deck +", and "@3pm" names nothing whatsoever.
    t = t.replace(/^[\s,;:.\-@+&/?<>=|"'’]+|[\s,;:.\-@+&/?<>=|"'’]+$/g, "").trim();
  } while (t !== prev);
  // A bare "meeting" is not a title. Returning null lets the caller compose one
  // from who it is with, which is what the user would have written anyway.
  if (!t || BARE_NOUN.test(t)) return null;
  /**
   * Nor is a pile of leftover verbs.
   *
   * "It will take 4 hours" left "Will take", "and move it to Friday" left
   * "Move", and both look like names to everything downstream. That mattered
   * more than it sounds: the follow-up test is "a pronoun and no title", so a
   * junk title stopped these being read as continuations at all, and "it"
   * pointed at nothing.
   */
  if (t.toLowerCase().split(/\s+/).every((w) => RESIDUE.has(w))) return null;
  return t[0].toUpperCase() + t.slice(1);
}

/**
 * @returns {{intent, slots, text, body, repair, amend, pronoun, fragment}}
 */
export function parse(text, now = new Date()) {
  const raw = text.trim();

  // Classify what is left after "no," / "actually," — the correction marker is
  // discourse, not content, and leaving it in poisons both intent and title.
  /**
   * Correction markers, spell-checked before they are looked for.
   *
   * "Actaully no reschedule that for 3" arrived misspelled, so the marker was
   * never stripped — and "Actaully no reschedule" became the meeting's name
   * and defeated the follow-up test behind it. Only the opening words are
   * corrected here, which is where discourse markers live and where a typo
   * costs the whole sentence.
   */
  const opener = raw.split(/\s+/).slice(0, 2).join(" ");
  const fixedOpener = despell(opener);
  const marked = fixedOpener === opener ? raw : raw.replace(opener, fixedOpener);

  const repair = REPAIR.test(marked);
  let body = raw;
  if (repair) {
    // "Actually no, reschedule that" stacks two markers. Peeling one left the
    // other in front, and "No reschedule" became the name of a meeting.
    body = marked;
    let prev;
    do { prev = body; body = body.replace(REPAIR, "").trim(); } while (body !== prev && body);
    if (!body) body = marked;
  }
  // "And move it to Friday at 2." A conjunction joining this turn to the last
  // one is discourse, and leaving it in put the word "And" at the front of
  // every title and defeated the follow-up test behind it.
  // The strip has to leave a word behind. "next?" is a whole question and the
  // word is on this list, so peeling it left a body of "?" — a sentence that
  // could never match anything.
  const unjoined = body.replace(/^\s*(?:and|then|also|plus|oh(?:,| and)?|next|after that|as well)\b[\s,]*/i, "").trim();
  body = /[a-z0-9]/i.test(unjoined) ? unjoined : body;
  /**
   * "call priya fri 10; deck 2h due fri" — two commands on one line.
   *
   * Only the first is read. A semicolon between two substantial clauses is
   * never anything else in a calendar sentence, and parsing the whole line
   * produced a meeting called "Priya 10; deck" at the wrong hour. The
   * remainder comes back untouched as `more`, so the caller can offer it
   * rather than silently dropping half of what was typed.
   */
  let more = null;
  const twoUp = body.match(/^([^;]{3,}?)\s*;\s*(\S[^]{2,})$/) || body.match(TWO_COMMANDS);
  if (twoUp) {
    body = twoUp[1].trim();
    more = twoUp[2].trim();
  }
  // Applied to every sentence rather than only on the spelling retry: the
  // corrections below are position-bound and cannot be wrong, and leaving them
  // to the retry meant "I need too call the bank" never reached the rule that
  // would have caught the fixed version.
  body = fixHomophones(body);
  // "w/" and "@" spelled out, for the same reason and in the same place: they
  // are position-bound, they cannot be wrong, and every rule below is looking
  // for the words rather than the symbols.
  body = expandShorthand(body);

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
    // "move standup -> 10" — an arrow splits the two halves as plainly as the
    // word does, and it is checked first because the word may not be there.
    const arrow = parseArrow(body, now);
    // "move X to Y" — the target time is what follows the first "to"/"until".
    const split = body.match(/^(.*?)\s+\b(?:to|until|till|for)\b\s+(.*)$/i);
    if (arrow) {
      subjectPhrase = arrow.left;
      targetPhrase = arrow.right;
    } else if (split) {
      subjectPhrase = split[1];
      // "move standup to 10 and cancel the 3pm" — a second instruction bolted
      // on with an "and". Left in the target half it supplies the time, so the
      // standup moved to three o'clock: the hour of the meeting the user was
      // asking her to get rid of. Only a following command verb cuts it, so
      // "move it to Friday and Saturday" keeps both words.
      const tail = split[2].match(new RegExp(`^([^]*?)\\s+\\b(?:and|then)\\s+(?:can you\\s+|please\\s+)?((?:${COMMAND_VERB})\\b[^]*)$`, "i"));
      targetPhrase = tail ? tail[1].trim() : split[2];
      if (tail && !more) more = tail[2].trim();
    }
  }

  let when = parseDateTime(targetPhrase, now);
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

  // "delegate X to Anders" / "assign X to priya" — see `handoffTarget`.
  const toPerson = handoffTarget(body);
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

  /**
   * The last two places a bare number can only be a clock time.
   *
   * `clockTail` is what has to come back out of the title afterwards: the
   * number was read as the time, so leaving it in produced meetings called
   * "Lunch 12" and "Standup 9".
   *
   * First: the destination of a move. With a "to" or an arrow in the sentence
   * the target half stands alone, so a clock elsewhere belongs to the meeting
   * being moved and cannot be confused with where it is going — "move 3pm -> 4"
   * goes to four. Without a separator the whole line is the target half, and a
   * clock in it is the subject: "move my 3pm" names a meeting and gives
   * nowhere to put it.
   *
   * Second: a kind of meeting and a trailing number — "lunch 12", "standup 9",
   * "1:1 bob 2", which is the whole grammar of a telegraphic booking. A unit
   * after the number rules it out, so "board deck 2h" is still a length, and
   * so does a month in front of it, because "board call sept 3" is the third
   * of September and was booking at three o'clock.
   */
  let clockTail = null;
  if (!timeOnly && intent === INTENTS.MOVE_EVENT && (targetPhrase !== body || !hasClock(s))) {
    const bare = targetPhrase.trim().match(/(?:^|\s)(\d{1,2})(?::(\d{2}))?\s*[.!?]*$/);
    if (bare) {
      let h = Number(bare[1]);
      if (h >= 1 && h <= 7) h += 12;
      if (h <= 23) {
        timeOnly = { h, m: Number(bare[2] || 0), source: "terse-target" };
        // Out of the title as well, when it is on the end of the line: "shift
        // the standup to 10" was leaving a meeting named "10" behind it.
        clockTail = body.match(/(?:^|\s)\d{1,2}(?::\d{2})?\s*[.!?]*$/)?.[0] ?? null;
      }
    }
  } else if (!timeOnly && kindNoun) {
    const bare = body.match(/(?:^|\s)(\d{1,2})(?::(\d{2}))?\s*[.!?]*$/);
    const isDayOfMonth =
      /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\w*\.?\s+\d{1,2}\s*[.!?]*$/i.test(body);
    if (bare && !isDayOfMonth && !/\b(?:quick|fast|short|brief|little)\s+\d{1,3}\s*$/i.test(body)) {
      let h = Number(bare[1]);
      if (h >= 1 && h <= 6) h += 12;
      if (h <= 23) {
        timeOnly = { h, m: Number(bare[2] || 0), source: "terse-noun" };
        clockTail = bare[0];
      }
    }
  }

  /**
   * A clock read by one of the terse rules above has to reach `when`, which
   * was built before they ran. A no-op whenever `parseDateTime` already found
   * the time itself, which is the ordinary case.
   */
  if (timeOnly && !when?.hadTime) {
    const day = when?.hadDate ? new Date(when.at) : (dateOnly ? new Date(dateOnly) : now);
    const at = atLocal(day, timeOnly.h, timeOnly.m);
    if (!when?.hadDate && !dateOnly && at <= now) at.setDate(at.getDate() + 1);
    when = { at, hadTime: true, hadDate: Boolean(when?.hadDate || dateOnly) };
  }
  // Whether this sentence merely *mentions* a destructive verb rather than
  // asking for one. Acted on in `ask`, before anything is allowed to run.
  const refuses = refusalIn(s, unwrap(body).toLowerCase().trim());
  const allDay = /\ball[- ]?day\b|\bwhole day\b|\bentire day\b|\bfull day\b/i.test(body);

  // The number that was read as the clock comes back out of the title, or
  // "lunch 12" lands on the calendar as a meeting called "Lunch 12".
  const title = cleanTitle(clockTail ? said.replace(clockTail, " ") : said, people, subject);

  // "lunch with priya friday at 12" — nobody writes a verb in front of that.
  // A meeting noun with a time attached is a booking, and the only reason it
  // needed "schedule" in front was that the rules were looking for a verb.
  if (intent === INTENTS.UNKNOWN && kindNoun && (dateOnly || timeOnly)) {
    intent = INTENTS.CREATE_EVENT;
  }

  /**
   * "call w/ priya", "1:1 w/ bob" — a kind of meeting and who it is with, and
   * not one word more.
   *
   * The "with" is load-bearing and required. "Call Priya" is a job to do and
   * belongs to the bare-imperative rule below; "a call with Priya" is a
   * meeting, and the preposition is the only thing separating them. Ahead of
   * that rule for exactly that reason — `call` is on its verb list too, and it
   * was winning both readings.
   */
  if (intent === INTENTS.UNKNOWN && kindNoun && people.length && /\bwith\b/i.test(s)) {
    intent = INTENTS.CREATE_EVENT;
  }

  /**
   * "dentist tues 3." "retro thurs 4." "walkthrough munich thurs 2."
   *
   * A name, a day and a clock, with no verb and no word for a meeting anywhere
   * in it — which is the whole of the telegraphic register, and every one of
   * these was reaching the follow-up machinery instead. Read as a fragment,
   * "dentist tues 3" means *change the last thing to Tuesday at three*, which
   * against the wrong previous turn moves a real meeting.
   *
   * Both halves of the when are required, and that is what makes it safe to
   * sit here. With only a day it is a deadline — "deck fri" — and with only a
   * clock it is a correction — "@3pm" — and both of those are still fragments.
   * A deadline word rules it out outright: "deck due fri 5" is a task.
   */
  if (intent === INTENTS.UNKNOWN && dateOnly && timeOnly && title &&
      !/\bdue\b|\bdeadline\b/i.test(s)) {
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

  // "Meet Priya Thursday at 3." A person and a time, with no booking verb
  // anywhere — which is a complete request and was falling through because
  // every rule wanted to be told what to do with it first.
  if (intent === INTENTS.UNKNOWN && people.length && (dateOnly || timeOnly)) {
    intent = INTENTS.CREATE_EVENT;
  }

  // Ahead of the bare-imperative rule below, which owns "prep" and "review"
  // and was reading "prep 30m before board call" as a job to do. A position
  // relative to a meeting is a position on the calendar.
  // "Put a debrief right after the board call." There is no clock in that
  // sentence at all, which is exactly why every phrasing like it fell through
  // — the booking rules are looking for a time and this names a position
  // instead. Something has to be being placed, though: a kind of meeting, a
  // person, or a placement verb. "After the board call" on its own is a
  // fragment and belongs to the follow-up machinery, not to a new booking.
  if (intent === INTENTS.UNKNOWN && anchor && (kindNoun || people.length || PLACE_VERB.test(s))) {
    intent = INTENTS.CREATE_EVENT;
  }

  // A bare imperative with no clock in it is a job to do. "Review the term
  // sheet." "Chase legal about the lease." This is also what is left after the
  // polite wrapper takes "I need to" off the front, which is most of how
  // anyone actually adds work — and every one of those was falling through.
  // `stripPolite` rather than `unwrap`: it peels "let's" and "we should" too,
  // and "we should circle back on the term sheet" is a job to do with a soft
  // opener in front of it, not a sentence with no verb in it.
  if (intent === INTENTS.UNKNOWN && !timeOnly && !ASKED_OF_HER.test(s) &&
      (ACTION_VERB.test(stripPolite(body).trim()) ||
       ACTION_VERB.test(stripPolite(body).trim().replace(OBLIGATION_PREFIX, "")))) {
    intent = INTENTS.CREATE_TASK;
  }

  // "Sometime Thursday." "I need to see Tom at some point."
  //
  // A booking whose whole content is that the time is not decided yet. There
  // is nothing to schedule from, which is why these fell through — but the
  // right answer is a question about what and when, not "I didn't catch that".
  if (intent === INTENTS.UNKNOWN && VAGUE_WHEN.test(s) && (dateOnly || people.length || kindNoun)) {
    intent = INTENTS.CREATE_EVENT;
  }

  // "The offsite is Friday, all day." A day with no clock in it is still a
  // booking, and the reason it never looked like one is that every rule wanted
  // a time it was never going to find.
  if (intent === INTENTS.UNKNOWN && allDay && dateOnly) {
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
    // The project a sentence names, as a phrase. Resolved where the data is.
    project: projectPhrase(body),
    // "…worth", "…the client on…" — which of a project's two commercial
    // fields was asked about, so the handler answers the question that was
    // asked instead of reciting the task load for everything.
    projectAsk: projectMoneyAsk(body),
    targetPhrase,
    // Title with verbs, temporal phrases, and priority wording removed.
    title,
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
    // "The offsite is Friday all day" — a span rather than a start time, and
    // measured against the working day rather than midnight to midnight.
    allDay,
    // Who goes on or comes off an invitation, and which one.
    attendees: parseAttendees(body),
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
    // "negated" | "asked" | null — a destructive verb that is not a command.
    refuses,
    repair,
    amend: AMEND.test(body),
    pronoun: PRONOUN.test(s),
    // "remove them" points at a set, "remove it" at one thing. Answering the
    // first as though it were the second cancels one meeting out of four and
    // reports success.
    plural: PLURAL_PRONOUN.test(s),
    compound: Boolean(compound),
    // "call priya fri 10; deck 2h due fri" — the half of the line that was not
    // acted on. Null for the overwhelming majority of sentences, which carry
    // one instruction.
    more,
    fragment,
    slots,
  };
}
