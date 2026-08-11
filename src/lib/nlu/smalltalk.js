/**
 * The things a person says before they say what they want.
 *
 * "Hi." "What time is it?" "Who are you?" "Thanks." None of these are calendar
 * commands, and an assistant that answers all four with "I didn't catch that"
 * feels broken long before it is ever wrong about a meeting. They cost nothing
 * to handle and they are most of the first minute anyone spends with her.
 *
 * The line this module draws, and does not cross: she answers from what she
 * actually knows — the clock, the calendar, her own capabilities, the user's
 * own data. She does not know the capital of France, and saying so plainly is
 * better than a confident guess. That honesty is the whole reason the
 * deterministic design is defensible; the moment she bluffs, she is a bad
 * language model instead of a good scheduler.
 */

import { addressOf, greeting } from "./voice.js";

export const SMALL = {
  GREET: "greet",
  HOWAREYOU: "howareyou",
  THANKS: "thanks",
  BYE: "bye",
  TIME: "time",
  DATE: "date",
  WHOAMI: "whoami",
  WHATCANYOUDO: "whatcanyoudo",
  COUNT: "count",
  SORRY: "sorry",
  AFFIRM: "affirm",
  OUTSIDE: "outside",
  REPEAT: "repeat",
  PRESENCE: "presence",
  OVERWHELM: "overwhelm",
  HOLD: "hold",
};

/**
 * Ordered, because a greeting attached to a command is a command.
 * "Hi, what's on Tuesday?" must not be answered with "Good morning."
 */
/**
 * Filler that carries no request. Stripped before the anchors below are
 * applied, so "hi there", "hello again", "hey squirrel, thanks!" are all
 * still just courtesies — which is what broke first in real use: the anchors
 * were exact, and a single trailing word turned a greeting into an error.
 */
const FILLER = /\b(?:there|again|squirrel|buddy|friend|mate|my friend|to you|so much|a lot|very much|for that|for the help|man|dude|pal|please|then|now|though|too|as well)\b/gi;

const trim = (t) =>
  t.replace(FILLER, " ").replace(/[\s!.,?~-]+/g, " ").trim().toLowerCase();

const RULES = [
  // Courtesies. Matched against the filler-stripped text, so the anchors stay
  // strict — anything with an actual request in it still falls through to the
  // real parser — without being brittle about the words people pad them with.
  [SMALL.GREET, /^(?:hi+|hey+|hello+|yo+|howdy|hiya+|heya+|sup|greetings|gm|gday|g'day|good (?:morning|afternoon|evening|day)|morning|afternoon|evening)\b/],
  // The suffix after "you" is required, not optional. Left optional, a bare
  // "you" matched — and since courtesies are checked first, "you still there?"
  // was answered "Ready when you are" instead of "Still here".
  [SMALL.HOWAREYOU, /^(?:how'?s\b|how (?:is|are|do you|goes|have you)\b|you(?: ok| okay| good| alright| doing| about)\b|what'?s (?:up|new|good)\b)/],
  [SMALL.THANKS, /^(?:thanks?|thank you|thx|ty|cheers|nice|great|perfect|awesome|amazing|excellent|lovely|brilliant|superb|fantastic|appreciate|much appreciated|good (?:job|work|stuff)|well done|nicely done|you'?re the best)\b/],
  [SMALL.BYE, /^(?:bye+|goodbye|see ya|see you|catch you|goodnight|good night|night|later|i'?m off|signing off|that'?s (?:all|it)|that'?ll be all|that will be all|talk (?:soon|to you)|done for (?:today|now))\b/],
  [SMALL.SORRY, /^(?:sorry|my bad|oops|whoops|my mistake|apologies|nevermind|never mind)\b/],
  // "ok" on its own reaches here only when no proposal is open — the
  // confirmation branch in `ask` runs first and claims it. Without this it fell
  // through to "I didn't catch that", which is a strange thing to be told after
  // agreeing with someone.
  [SMALL.AFFIRM, /^(?:ok(?:ay)?|k|kk|sure|right|fine|good|great|nice|yep|yeah|mhm|mm ?hm)\s*$/],
  [SMALL.AFFIRM, /^(?:ok(?:ay)? )?(?:cool|got it|gotcha|understood|makes sense|sounds good|fair enough|alright|indeed|of course|sure thing|no worries|right on)\b/],

  // "Wait" and "hold on" are not commands and not courtesies — they are a
  // request for a pause. Answering them with a calendar lookup is worse than
  // answering them with nothing.
  [SMALL.HOLD, /^(?:wait|hold on|hold up|hang on|one sec(?:ond)?|just a sec(?:ond)?|gimme a sec|give me a (?:sec(?:ond)?|minute|moment)|stand by|not yet)\b/],

  // Asked to say it again. Anchored hard: "what?" is a request to repeat and
  // "what's Friday?" very much is not, so anything with a request in it must
  // fall through.
  [SMALL.REPEAT, /^(?:huh|eh|what|wha|sorry what|come again|say (?:that )?again|repeat(?: that| it)?|pardon(?: me)?|once more|i missed that|didn'?t (?:catch|hear|get) that|read (?:that|it) (?:back|again))\s*[?.!]*$/],

  // Checking she is still there. People do this to software that has been
  // quiet, and silence in response confirms exactly the fear.
  [SMALL.PRESENCE, /^(?:(?:are|r) ?you (?:there|awake|alive|listening|still there|around)|you (?:there|up|awake|around|still there)|did you (?:get|catch|hear) (?:that|me)|you (?:get|catch) that|anyone there|still (?:there|with me)|hello\?+)\s*[?.!]*$/],

  [SMALL.TIME, /^\s*time\s*\??\s*$|\b(?:what(?:'s| is)? the )?time is it\b|\bwhat time is it\b|\bcurrent time\b|\bwhat'?s the time\b|\bgot the time\b/i],
  [SMALL.DATE, /\bwhat(?:'s| is)? (?:the )?(?:date|day)(?: is it)?\b|\bwhat day is (?:it|today)\b|\btoday'?s date\b|\bwhat'?s today\b/i],

  [SMALL.WHOAMI, /\b(?:who are you|what are you|what'?s your name|your name)\b/i],
  [SMALL.WHATCANYOUDO, /\b(?:what can you do|what do you do|how do you work|what are you for|are you (?:an? )?(?:ai|robot|bot|human|real))\b/i],

  [SMALL.COUNT, /\bhow many (?:tasks?|projects?|meetings?|events?)\b|\bwhat do i have (?:left|open|outstanding)\b/i],

  /**
   * Overwhelm used to be answered here, and it is not small talk.
   *
   * The arithmetic reply this layer gave — "3 meetings, 4h of them, 3 open
   * tasks; say 'plan my week' and I'll lay the work into the gaps" — was honest
   * and better than sympathy, but it stopped one sentence short of the thing
   * being asked for. "I'm drowning" means *show me what to do first*, and
   * answering it with a total and a homework assignment makes somebody who is
   * already stuck type a second message to get the list. Starting is the
   * feature; requiring a second turn to start is the bug.
   *
   * So the whole family now falls through to `isOverwhelmed` in parse.js and
   * lands on PLAN_DAY, which keeps the arithmetic and adds the ranked list
   * underneath it. Nothing was lost; a step was removed.
   */

  // General knowledge, which she genuinely does not have. Detected on purpose
  // so she can say so instead of falling through to "I didn't catch that",
  // which reads as a failure rather than a boundary.
  // "Who is …" is general knowledge unless it is about who is in the room.
  // Without the exception, "who is on the board call" was answered "that's
  // outside what I know" — about the user's own calendar.
  //
  // `how far` needs its object. Bare, it caught "how far behind am I" — a
  // question about the user's own backlog, answered "that's outside what I
  // know". Distance takes a preposition; being behind does not.
  [SMALL.OUTSIDE, /\b(?:capital of|weather|who (?:is|was)(?!\s+(?:coming|going|in|on|at|attending|joining|invited|dial|else|with|my|i|the (?:client|customer)|paying))|who (?:invented|won)|what is the (?:capital|population|meaning)|how tall|how far (?:is|are|to|from|away|apart)|translate|define|recipe|news|score|stock price|joke|poem|story|write me)\b/i],
];

const COURTESY = new Set([
  SMALL.GREET, SMALL.HOWAREYOU, SMALL.THANKS, SMALL.BYE, SMALL.SORRY, SMALL.AFFIRM,
  // "Wait" is in here rather than with the anchored rules because its pattern
  // is open-ended by necessity — "hold on a moment" — and open-ended plus
  // ungated would make "wait, cancel my 3pm" a request for a pause.
  SMALL.HOLD,
]);

/**
 * Anything that makes a sentence a request rather than a pleasantry.
 *
 * This is the guard that lets the courtesy patterns stop being anchored at the
 * end. Anchoring was the first thing to break in real use — "hi there" is a
 * greeting and it produced an error page — but simply unanchoring would turn
 * "hi, what does Friday look like?" into a greeting too. A courtesy is short
 * and mentions nothing schedulable; that is the actual distinction.
 */
const HAS_REQUEST =
  /\d|\b(?:schedule|book|block|move|cancel|delete|reschedul\w*|push|remind|plan|add|create|task|tasks|meeting|meetings|call|project|projects|deadline|due|calendar|free|busy|today|tomorrow|tonight|yesterday|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|am|pm|hour|hours|minute|minutes|undo|revert|restore|back)\b/i;

export function classify(text) {
  const bare = trim(text);

  // Padding with nothing left in it — "hey there", "hi squirrel" — is a
  // greeting, which is the friendliest reading and always the right one.
  if (!bare) return SMALL.GREET;

  // Courtesies: short, and about nothing on the calendar. Both conditions
  // matter. Without the length cap a long complaint that happens to open with
  // "sorry" becomes an apology; without the request check, "hi, what's Friday
  // look like" never reaches the parser.
  if (bare.split(/\s+/).length <= 5 && !HAS_REQUEST.test(bare)) {
    for (const [kind, re] of RULES) {
      if (COURTESY.has(kind) && re.test(bare)) return kind;
    }
  }

  // Tested against the original text rather than the stripped version: these
  // are anchored end to end, so they cannot swallow a longer sentence, and
  // stripping would break them — FILLER eats "there", which is the entire
  // difference between "are you there" and "are you".
  for (const [kind, re] of RULES) {
    if (COURTESY.has(kind)) continue;
    if (re.test(text)) return kind;
  }
  return null;
}

const clock = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const longDate = (d) =>
  d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });

/** Rotate so a greeting twice in a row is not word-for-word identical. */
const pick = (list, seed) => list[Math.abs(seed) % list.length];

/**
 * @param {string} kind    from classify()
 * @param {object} state   full app state — she answers from real data
 * @param {Date}   now
 * @param {number} seed    something that varies per turn, for phrasing variety
 * @returns {{text: string, variant: string}|null}
 */
export function answer(kind, state, now = new Date(), seed = 0) {
  const identity = state.settings?.identity || {};
  const who = addressOf(identity);
  const comma = who ? `, ${who}` : "";
  const events = state.events || [];
  const tasks = (state.tasks || []).filter((t) => !t.done);

  const today = events
    .filter((e) => e.start.slice(0, 10) === dayStr(now))
    .sort((a, b) => a.start.localeCompare(b.start));
  const next = today.find((e) => new Date(e.start) > now);

  switch (kind) {
    case SMALL.GREET: {
      // A greeting is a good moment to say the one thing she knows that the
      // user does not yet: what is coming. It is the difference between a
      // chatbot and an assistant.
      const lead = `${greeting(now)}${comma}.`;
      if (next) {
        return { text: `${lead} Next up is ${next.title} at ${clock(new Date(next.start))}.`, variant: "calendar" };
      }
      if (today.length) return { text: `${lead} Nothing else on the calendar today.`, variant: "calendar" };
      if (tasks.length) {
        return { text: `${lead} Your calendar is clear — ${tasks.length} ${tasks.length === 1 ? "task is" : "tasks are"} open.`, variant: "calendar" };
      }
      return { text: `${lead} What can I get started for you?`, variant: "calendar" };
    }

    case SMALL.HOWAREYOU:
      return {
        text: pick([
          `Ready when you are${comma}.`,
          `All in order here${comma}. What do you need?`,
          `Well, thank you${comma}. What's first?`,
        ], seed),
        variant: "calendar",
      };

    case SMALL.THANKS:
      return { text: pick([`Of course${comma}.`, `Any time${comma}.`, `My pleasure${comma}.`], seed), variant: "calendar" };

    case SMALL.SORRY:
      return {
        text: pick([`No harm done${comma}.`, `Nothing to apologise for${comma}.`, `All fine${comma} — what did you mean?`], seed),
        variant: "calendar",
      };

    case SMALL.AFFIRM:
      return {
        text: pick([`Anything else${comma}?`, `What's next${comma}?`, `Ready when you are${comma}.`], seed),
        variant: "calendar",
      };

    case SMALL.BYE:
      return {
        text: next
          ? `Until later${comma}. ${next.title} is at ${clock(new Date(next.start))}.`
          : `Until later${comma}.`,
        variant: "calendar",
      };

    case SMALL.TIME: {
      const line = `It's ${clock(now)}${comma}.`;
      if (!next) return { text: `${line} Nothing else scheduled today.`, variant: "calendar" };
      const mins = Math.round((new Date(next.start) - now) / 60000);
      const away =
        mins < 1 ? "now" : mins < 60 ? `in ${mins} minutes` : `in ${(mins / 60).toFixed(mins % 60 ? 1 : 0)} hours`;
      return { text: `${line} ${next.title} is ${away}.`, variant: "calendar" };
    }

    case SMALL.DATE:
      return { text: `It's ${longDate(now)}${comma}.`, variant: "calendar" };

    case SMALL.WHOAMI:
      return {
        text:
          `I'm Squirrel — your planner${comma}. I keep your calendar, your tasks, and your projects, ` +
          `and I work entirely on this device.`,
        variant: "calendar",
      };

    case SMALL.WHATCANYOUDO:
      return {
        text:
          "I book, move, and cancel meetings; add, finish, and hand off tasks; tell you what a day looks like " +
          "and where you're free; and lay long work out across the days before its deadline.\n\n" +
          "I'm ordinary code, not a language model — so I'm quick, I work offline, and I cost nothing to talk to. " +
          "The trade is that I only know your calendar. Ask me about anything else and I'll tell you I can't.",
        variant: "calendar",
      };

    case SMALL.COUNT: {
      const projects = (state.projects || []).filter((p) => !p.archived).length;
      const overdue = tasks.filter((t) => t.due && t.due < dayStr(now)).length;
      const bits = [
        `${tasks.length} open ${tasks.length === 1 ? "task" : "tasks"}`,
        `${projects} ${projects === 1 ? "project" : "projects"}`,
        `${today.length} ${today.length === 1 ? "meeting" : "meetings"} today`,
      ];
      return {
        text: bits.join(", ") + (overdue ? `. ${overdue} overdue.` : "."),
        variant: "calendar",
      };
    }

    case SMALL.HOLD:
      return { text: pick([`Take your time${comma}.`, `No rush${comma}.`, `Standing by${comma}.`], seed), variant: "calendar" };

    case SMALL.PRESENCE: {
      // "Did you get that?" is asking whether the last instruction landed, and
      // the honest answer is the receipt for it. "Still here" is only the right
      // answer when there is nothing to point at.
      const last = [...(state.chat || [])].reverse().find((m) => m.role === "assistant");
      const did = last?.actions?.[0]?.summary;
      if (did) return { text: `Got it${comma} — ${did}.`, variant: "calendar" };
      return {
        text: pick([
          `Still here${comma}.`,
          `Here${comma} — go ahead.`,
          `Right here${comma}. What do you need?`,
        ], seed),
        variant: "calendar",
      };
    }

    case SMALL.REPEAT: {
      // The last thing she actually said, verbatim. Paraphrasing it would be
      // answering a different question than the one asked.
      const said = [...(state.chat || [])].reverse().find((m) => m.role === "assistant" && m.text);
      if (!said) return { text: `I haven't said anything yet${comma}.`, variant: "calendar" };
      return { text: said.text, variant: "calendar", repeated: true };
    }

    /**
     * Frustration, answered with arithmetic.
     *
     * Sympathy is the one thing she is badly placed to offer and the first
     * thing a language model would reach for. What she has instead is the real
     * shape of the week — hours committed, work that will not fit, the single
     * biggest thing on the list — and one concrete offer. That is worth more
     * at 7pm on a Tuesday than "that sounds tough".
     */
    case SMALL.OVERWHELM: {
      const from = new Date(now);
      const to = new Date(now);
      to.setDate(to.getDate() + 7);
      const week = events.filter((e) => {
        const at = new Date(e.start);
        return at >= from && at < to;
      });
      const meetingMins = week.reduce((n, e) => n + (new Date(e.end) - new Date(e.start)) / 60000, 0);
      const late = tasks.filter((t) => t.due && t.due < dayStr(now));
      const short = (state.shortfalls || []).length;

      const bits = [];
      if (week.length) {
        bits.push(`${week.length} ${week.length === 1 ? "meeting" : "meetings"} in the next seven days, ${hours(meetingMins)} of them`);
      }
      if (tasks.length) bits.push(`${tasks.length} open ${tasks.length === 1 ? "task" : "tasks"}`);
      if (late.length) bits.push(`${late.length} already past due`);

      const head = bits.length
        ? `Here's the actual shape of it${comma}: ${bits.join(", ")}.`
        : `Nothing on the calendar and nothing open${comma} — whatever this is, it isn't in here.`;

      const offer =
        short > 0
          ? ` ${short} ${short === 1 ? "thing doesn't" : "things don't"} fit as scheduled. Say “what should I drop” and I'll tell you which.`
          : tasks.length
            ? ` Say “plan my week” and I'll lay the work into the gaps.`
            : "";

      return { text: head + offer, variant: "calendar" };
    }

    case SMALL.OUTSIDE:
      return {
        text:
          `That's outside what I know${comma} — I only see your calendar, tasks, and projects. ` +
          `I'd rather say so than guess.`,
        variant: "calendar",
      };

    default:
      return null;
  }
}

/** "3h 30m" — the same shape the scheduler uses, so the app speaks one dialect. */
function hours(mins) {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

const pad = (n) => String(n).padStart(2, "0");
const dayStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
