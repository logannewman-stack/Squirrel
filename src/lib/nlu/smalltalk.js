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
  [SMALL.HOWAREYOU, /^(?:how'?s\b|how (?:is|are|do you|goes|have you)\b|you(?: ok| okay| good| alright| doing| around| about)?\b|what'?s (?:up|new|good)\b)/],
  [SMALL.THANKS, /^(?:thanks?|thank you|thx|ty|cheers|nice|great|perfect|awesome|amazing|excellent|lovely|brilliant|superb|fantastic|appreciate|much appreciated|good (?:job|work|stuff)|well done|nicely done|you'?re the best)\b/],
  [SMALL.BYE, /^(?:bye+|goodbye|see ya|see you|catch you|goodnight|good night|night|later|i'?m off|signing off|that'?s (?:all|it)|that'?ll be all|that will be all|talk (?:soon|to you)|done for (?:today|now))\b/],
  [SMALL.SORRY, /^(?:sorry|my bad|oops|whoops|my mistake|apologies|nevermind|never mind)\b/],
  [SMALL.AFFIRM, /^(?:ok(?:ay)? )?(?:cool|got it|gotcha|understood|makes sense|sounds good|fair enough|alright|indeed|of course|sure thing|no worries|right on)\b/],

  [SMALL.TIME, /^\s*time\s*\??\s*$|\b(?:what(?:'s| is)? the )?time is it\b|\bwhat time is it\b|\bcurrent time\b|\bwhat'?s the time\b|\bgot the time\b/i],
  [SMALL.DATE, /\bwhat(?:'s| is)? (?:the )?(?:date|day)(?: is it)?\b|\bwhat day is (?:it|today)\b|\btoday'?s date\b|\bwhat'?s today\b/i],

  [SMALL.WHOAMI, /\b(?:who are you|what are you|what'?s your name|your name)\b/i],
  [SMALL.WHATCANYOUDO, /\b(?:what can you do|what do you do|how do you work|what are you for|are you (?:an? )?(?:ai|robot|bot|human|real))\b/i],

  [SMALL.COUNT, /\bhow many (?:tasks?|projects?|meetings?|events?)\b|\bwhat do i have (?:left|open|outstanding)\b/i],

  // General knowledge, which she genuinely does not have. Detected on purpose
  // so she can say so instead of falling through to "I didn't catch that",
  // which reads as a failure rather than a boundary.
  [SMALL.OUTSIDE, /\b(?:capital of|weather|who (?:is|was|invented|won)|what is the (?:capital|population|meaning)|how tall|how far|translate|define|recipe|news|score|stock price|joke|poem|story|write me)\b/i],
];

const COURTESY = new Set([
  SMALL.GREET, SMALL.HOWAREYOU, SMALL.THANKS, SMALL.BYE, SMALL.SORRY, SMALL.AFFIRM,
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
  /\d|\b(?:schedule|book|block|move|cancel|delete|reschedul\w*|push|remind|plan|add|create|task|tasks|meeting|meetings|call|project|projects|deadline|due|calendar|free|busy|today|tomorrow|tonight|yesterday|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|am|pm|hour|hours|minute|minutes)\b/i;

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

  for (const [kind, re] of RULES) {
    if (!COURTESY.has(kind) && re.test(text)) return kind;
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

const pad = (n) => String(n).padStart(2, "0");
const dayStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
