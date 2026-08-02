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
  OUTSIDE: "outside",
};

/**
 * Ordered, because a greeting attached to a command is a command.
 * "Hi, what's on Tuesday?" must not be answered with "Good morning."
 */
const RULES = [
  // Bare courtesies only — anchored, so anything with a request in it falls
  // through to the real parser.
  [SMALL.GREET, /^\s*(?:hi|hey+|hello|yo|howdy|hiya|sup|good (?:morning|afternoon|evening)|morning|evening)\b[\s!.,?]*$/i],
  [SMALL.HOWAREYOU, /^\s*(?:how(?:'s| is| are)?\s*(?:it going|you|things|your day)|you (?:ok|okay|good|alright)|what'?s up)\b[\s!.,?]*$/i],
  [SMALL.THANKS, /^\s*(?:thanks?|thank you|ty|cheers|nice|great|perfect|awesome|appreciate it|good (?:job|work))\b[\s!.,?]*$/i],
  [SMALL.BYE, /^\s*(?:bye|goodbye|see ya|see you|later|goodnight|good night|night)\b[\s!.,?]*$/i],

  [SMALL.TIME, /\b(?:what(?:'s| is)? the )?time is it\b|\bwhat time is it\b|\bcurrent time\b|\bwhat'?s the time\b/i],
  [SMALL.DATE, /\bwhat(?:'s| is)? (?:the )?(?:date|day)(?: is it)?\b|\bwhat day is (?:it|today)\b|\btoday'?s date\b|\bwhat'?s today\b/i],

  [SMALL.WHOAMI, /\b(?:who are you|what are you|what'?s your name|your name)\b/i],
  [SMALL.WHATCANYOUDO, /\b(?:what can you do|what do you do|how do you work|what are you for|are you (?:an? )?(?:ai|robot|bot|human|real))\b/i],

  [SMALL.COUNT, /\bhow many (?:tasks?|projects?|meetings?|events?)\b|\bwhat do i have (?:left|open|outstanding)\b/i],

  // General knowledge, which she genuinely does not have. Detected on purpose
  // so she can say so instead of falling through to "I didn't catch that",
  // which reads as a failure rather than a boundary.
  [SMALL.OUTSIDE, /\b(?:capital of|weather|who (?:is|was|invented|won)|what is the (?:capital|population|meaning)|how tall|how far|translate|define|recipe|news|score|stock price|joke|poem|story|write me)\b/i],
];

export function classify(text) {
  for (const [kind, re] of RULES) if (re.test(text)) return kind;
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
