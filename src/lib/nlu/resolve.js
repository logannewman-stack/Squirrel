/**
 * Matching a phrase to an actual event or task.
 *
 * "My 3pm", "the board call", "the term sheet task" all have to land on one
 * row. Scoring combines a time reference with title overlap, because either
 * alone is ambiguous: two things can start at 3pm, and "call" appears in half
 * the calendar.
 *
 * Returns candidates rather than a single answer so the caller can ask which
 * one was meant instead of picking wrong.
 */

import { parseDate, parseTime, dayKey } from "./datetime.js";

const STOP = new Set([
  "the", "my", "a", "an", "to", "for", "on", "at", "in", "of", "and", "with",
  "move", "reschedule", "push", "shift", "change", "bump", "cancel", "delete",
  "remove", "complete", "done", "finish", "mark", "task", "meeting", "event",
  "call", "appointment", "please", "can", "you", "i", "me", "it", "that", "this",
]);

const words = (s) =>
  s.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));

/** Token overlap, normalised by the shorter side so short titles aren't punished. */
function titleScore(phrase, title) {
  const a = words(phrase);
  const b = words(title);
  if (!a.length || !b.length) return 0;
  const hits = a.filter((w) => b.some((t) => t === w || t.startsWith(w) || w.startsWith(t)));
  return hits.length / Math.min(a.length, b.length);
}

/**
 * @returns {{item: object, score: number}[]} sorted best first
 */
export function resolveEvent(phrase, events, now = new Date()) {
  const time = parseTime(phrase);
  const date = parseDate(phrase, now);

  const scored = events
    .map((e) => {
      const start = new Date(e.start ?? e.starts_at);
      let score = 0;

      if (time) {
        // An exact hour match is the strongest single signal available.
        if (start.getHours() === time.h && start.getMinutes() === time.m) score += 3;
        else if (start.getHours() === time.h) score += 2;
      }
      if (date && dayKey(start) === dayKey(date.date)) score += 2;

      score += titleScore(phrase, e.title) * 2.5;

      // Prefer upcoming over past: "my 3pm" means the next one, not last week's.
      if (start < now) score -= 1.5;
      const daysOut = Math.abs(start - now) / 86400000;
      score -= Math.min(0.8, daysOut / 30);

      return { item: e, score };
    })
    .filter((x) => x.score > 0.6)
    .sort((a, b) => b.score - a.score);

  return scored;
}

export function resolveTask(phrase, tasks) {
  return tasks
    .map((t) => ({ item: t, score: titleScore(phrase, t.title) * 3 + (t.done ? -2 : 0) }))
    .filter((x) => x.score > 0.6)
    .sort((a, b) => b.score - a.score);
}

export function resolveProject(phrase, projects) {
  return projects
    .map((p) => ({ item: p, score: titleScore(phrase, p.name) * 3 }))
    .filter((x) => x.score > 0.6)
    .sort((a, b) => b.score - a.score);
}

/**
 * Is the top candidate a clear winner?
 * A near-tie means asking, not guessing — picking wrong moves the wrong meeting.
 */
export const isConfident = (ranked) =>
  ranked.length === 1 || (ranked.length > 1 && ranked[0].score - ranked[1].score >= 0.8);
