/**
 * Finding a setting by the word you have for it.
 *
 * Settings is five sections and about twenty groups, which is small enough to
 * read and far too big to guess. The word somebody has in their head is almost
 * never the word on the screen: they look for "dark mode" and the group is
 * called Appearance, for "notifications" and it is called Reminders, for
 * "cancel my subscription" and it is called Plan. That gap is the whole reason
 * iOS put a search field at the top of its own Settings.
 *
 * So each group carries the words people actually use for it. The keywords are
 * not synonyms in a thesaurus sense — they are the *wrong* names, collected on
 * purpose, because the wrong name is what gets typed.
 *
 * Matching is the app's one search implementation, imported rather than
 * reimplemented: two search fields that disagree about what "voice" matches is
 * an inconsistency nobody can name and everybody notices.
 *
 * `header` is the literal group heading in Settings.jsx, and
 * test/settings-index.test.mjs fails if a group exists there without an entry
 * here. Otherwise this drifts the moment somebody adds a section — and a search
 * that silently cannot find the newest setting is worse than no search, because
 * it is trusted.
 */

import { tokens, score } from "./search.js";

/** What each section is called, for the line under a result. */
export const SECTION = {
  account: "Account",
  you: "You",
  assistant: "Assistant",
  connections: "Connections",
  data: "Data",
};

export const INDEX = [
  {
    group: "account", header: "Account",
    keywords: "sign in log in login sign up register email address password sync devices account",
  },
  {
    group: "account", header: "Plan",
    keywords: "upgrade pro paid free tier billing subscription payment card invoice cancel refund price cost money usage limit",
  },

  {
    group: "you", header: "How she addresses you",
    keywords: "name first name surname title honorific sir boss greeting call me identity",
  },
  {
    group: "you", header: "Your working day",
    keywords: "hours working hours schedule start end finish weekend days off breaks lunch capacity timezone",
  },
  {
    group: "you", header: "Appearance",
    keywords: "dark mode light mode theme colour color night display contrast system",
  },
  {
    group: "you", header: "Keyboard",
    keywords: "keyboard shortcut shortcuts hotkey keys command cmd ctrl undo search palette",
  },
  {
    group: "you", header: "The introduction",
    keywords: "onboarding welcome tour intro walkthrough first run setup again replay demo",
  },

  {
    group: "assistant", header: "Before she acts",
    keywords: "confirm confirmation ask first check double check undo safety approve",
  },
  {
    group: "assistant", header: "Voice",
    keywords: "voice speak speech talk read aloud sound audio mute silent accent samantha persona rate speed pitch offline",
  },
  {
    group: "assistant", header: "Boost",
    keywords: "boost fallback stuck understand parse ai smarter cloud",
  },
  {
    group: "assistant", header: "End of the day",
    keywords: "review look back evening recap summary end of day wrap up reflection",
  },
  {
    group: "assistant", header: "What she missed",
    keywords: "missed misses failed didn't understand log history gaps",
  },

  {
    group: "connections", header: "Siri & Shortcuts",
    keywords: "siri shortcut shortcuts hey siri voice control action button spotlight widget home screen automation phrases",
  },
  {
    group: "connections", header: "Calendars",
    keywords: "calendar google calendar apple calendar icloud outlook sync import two way",
  },
  {
    group: "connections", header: "Reminders",
    keywords: "reminders notifications alerts push nudge notify badge sound before meetings morning",
  },

  {
    group: "data", header: "Stored here",
    keywords: "erase delete everything reset clear wipe storage local offline data",
  },
  {
    group: "data", header: "A copy of everything",
    keywords: "export backup download save copy restore import json file new phone transfer move migrate portability",
  },
  {
    // Two groups are both called Account. The heading is right in each place —
    // and a search result reading "Account" twice with no way to tell them
    // apart is not, so this one says what it is for.
    group: "data", header: "Account", title: "Delete your account",
    keywords: "delete account close account remove account leave quit cancel account gdpr erasure",
  },
  {
    // Indexed for everyone, rendered only on a company account — somebody
    // searching "who can see my tasks" should find the answer whether or not
    // this particular account has one.
    group: "data", header: "Your company",
    keywords: "company organisation organization employer enterprise admin administrator managed work account who can see my tasks visibility privacy team seat",
  },
  {
    // Indexed for everyone, rendered for owners only — the group exists on the
    // screen whether or not the server lets this account see anything in it,
    // and an index that lied about that would drift the first time either side
    // changed.
    group: "data", header: "Your people",
    keywords: "users customers accounts roster subscribers members signups revenue mrr paying plans overview who owner admin console",
  },
  {
    group: "data", header: "This build",
    keywords: "version build number diagnostics setup keys configuration environment about support",
  },
  {
    group: "data", header: "Legal",
    keywords: "privacy policy terms of service legal gdpr licence agreement",
  },
];

/** What a result row is called. Defaults to the group's own heading. */
export const titleOf = (entry) => entry.title ?? entry.header;

/**
 * Groups that are summaries of rows living elsewhere rather than places to go.
 *
 * Named here rather than simply left out of the index, so that a *new*
 * un-indexed group is still a test failure. An exemption list you have to add
 * to on purpose is the difference between "this one is deliberate" and "nobody
 * noticed".
 */
export const NOT_A_DESTINATION = ["At a glance"];

/**
 * Words that carry no meaning in a two-word query but disqualify a row.
 *
 * Every token has to match, which is what keeps "dark subscription" from
 * returning half the screen — and which also means "cancel my subscription"
 * matched nothing, because no group lists the word "my". People type sentences
 * at a search box in Settings far more than they do at one over their own data,
 * so this trimming lives here rather than in `search.js`.
 *
 * A query made entirely of these still returns nothing: "the" is not a search.
 */
const STOP = new Set(
  ("a an and the my your our their his her its it is are was be to for of in on off at from with " +
   "how do i can what where when please me we you they this that " +
   // The verbs of a settings sentence. "Turn on dark mode", "change my hours",
   // "set the voice" — the verb is always filler here, because every row on
   // this screen is something you turn on, change, or set.
   "turn change set make get use enable disable want need find show adjust edit").split(" "),
);

/**
 * Settings matching a query, best first.
 *
 * @param {string} q
 * @param {{limit?: number}} [opts]
 * @returns {{group: string, header: string, title: string, section: string}[]}
 */
export function findSettings(q, { limit = 8 } = {}) {
  const all = tokens(q);
  const query = all.filter((w) => !STOP.has(w));
  if (!query.length) return [];

  return INDEX.map((entry) => ({
    entry,
    // The heading outranks the keywords: somebody typing the name printed on
    // the screen wants that group, not one that merely lists the word.
    n: score(query, [
      [titleOf(entry).toLowerCase(), 3],
      [entry.header.toLowerCase(), 3],
      [SECTION[entry.group].toLowerCase(), 2],
      [entry.keywords, 1],
    ]),
  }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map(({ entry }) => ({
      group: entry.group,
      header: entry.header,
      title: titleOf(entry),
      section: SECTION[entry.group],
    }));
}
