import { dayKey } from "./store.js";

/**
 * Finding something you wrote three weeks ago.
 *
 * The ⌘K palette had a jump list — the first forty *open* tasks, matched by
 * substring — which is a different feature wearing the same shape. It could
 * not find a finished task, a past meeting, a note, or anybody's name, and
 * those are most of what somebody is looking for when they go looking: the
 * thing you half-remember doing is by definition already done.
 *
 * A planner people leave is usually one where they could not find something
 * they knew was in there. This exists to make that not the reason.
 *
 * ## How matching works
 *
 * Tokens, not substrings. "deck board" finds "Board deck" and "sow draft"
 * finds "Draft the SOW", because nobody remembers word order — they remember
 * two words out of five. Every token has to appear somewhere in the row, which
 * keeps a two-word query from returning half the database.
 *
 * The ranking is deliberately simple and deliberately explained: a title match
 * beats a note match, a whole-word match beats a prefix, a prefix beats a
 * substring, and recency breaks ties. Anything cleverer than that is
 * unpredictable, and an unpredictable search is one people stop trusting after
 * the second time it hides something they can see with their own eyes.
 */

const WORD = /[a-z0-9]+/gi;
const tokens = (s) => String(s ?? "").toLowerCase().match(WORD) ?? [];

/**
 * How well one token matches one field. Zero means not at all, and one zero
 * anywhere in the query disqualifies the row.
 */
function tokenScore(token, haystack) {
  const i = haystack.indexOf(token);
  if (i < 0) return 0;
  const before = i === 0 ? " " : haystack[i - 1];
  const after = haystack[i + token.length] ?? " ";
  const startsWord = !/[a-z0-9]/.test(before);
  const endsWord = !/[a-z0-9]/.test(after);
  if (startsWord && endsWord) return 10;  // the whole word
  if (startsWord) return 6;               // the start of one
  return 2;                               // buried inside one
}

/** A row's score for the whole query, or 0 if any token is missing. */
function score(query, fields) {
  let total = 0;
  for (const token of query) {
    let best = 0;
    for (const [text, weight] of fields) {
      if (!text) continue;
      best = Math.max(best, tokenScore(token, text) * weight);
    }
    if (!best) return 0;
    total += best;
  }
  return total;
}

const lower = (s) => String(s ?? "").toLowerCase();
const namesOf = (list) =>
  (list || []).map((a) => (typeof a === "string" ? a : a?.name)).filter(Boolean).join(" ");

/**
 * Everything matching, best first.
 *
 * @param {string} q
 * @param {object} state
 * @param {{limit?: number, now?: Date}} [opts]
 * @returns {{kind: string, id: string, title: string, hint: string, when: string|null, sort: number}[]}
 */
export function search(q, state, { limit = 30, now = new Date() } = {}) {
  const query = tokens(q);
  if (!query.length) return [];

  const today = dayKey(now);
  const projectName = new Map((state?.projects ?? []).map((p) => [p.id, p.name]));
  const out = [];

  for (const t of state?.tasks ?? []) {
    const n = score(query, [
      [lower(t.title), 3],
      [lower(projectName.get(t.projectId)), 1],
      [lower(t.notes), 1],
      [lower(t.delegatedTo), 1],
    ]);
    if (!n) continue;
    const late = !t.done && t.due && t.due < today;
    out.push({
      kind: "task",
      id: t.id,
      title: t.title,
      hint: [
        t.done ? "Done" : late ? "Overdue" : t.delegatedTo ? `With ${t.delegatedTo}` : "Open",
        projectName.get(t.projectId),
      ].filter(Boolean).join(" · "),
      when: t.due ?? null,
      done: Boolean(t.done),
      projectId: t.projectId ?? null,
      // Finished work ranks below live work at the same relevance. It is worth
      // finding and it is rarely what you meant.
      sort: n - (t.done ? 4 : 0),
    });
  }

  for (const e of state?.events ?? []) {
    const n = score(query, [
      [lower(e.title), 3],
      [lower(namesOf(e.attendees)), 2],
      [lower(e.notes), 1],
      [lower(e.location), 1],
    ]);
    if (!n) continue;
    const day = dayKey(new Date(e.start));
    out.push({
      kind: "event",
      id: e.id,
      title: e.title,
      hint: ["Meeting", namesOf(e.attendees) || null].filter(Boolean).join(" · "),
      when: day,
      done: day < today,
      sort: n - (day < today ? 4 : 0),
    });
  }

  for (const p of state?.projects ?? []) {
    const n = score(query, [[lower(p.name), 3], [lower(p.client), 2], [lower(p.notes), 1]]);
    if (!n) continue;
    const open = (state?.tasks ?? []).filter((t) => t.projectId === p.id && !t.done).length;
    out.push({
      kind: "project",
      id: p.id,
      title: p.name,
      hint: ["Project", p.client, open ? `${open} open` : null].filter(Boolean).join(" · "),
      when: null,
      done: Boolean(p.archived),
      sort: n + 2 - (p.archived ? 6 : 0), // a project is a place; places rank up
    });
  }

  return out
    .sort((a, b) => b.sort - a.sort || (b.when ?? "").localeCompare(a.when ?? ""))
    .slice(0, limit);
}

/** A short human date for a result row: "today", "Fri", "12 Aug". */
export function whenLabel(key, now = new Date()) {
  if (!key) return "";
  const d = new Date(`${key}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.round((d - new Date(`${dayKey(now)}T12:00:00`)) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 1 && days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}
