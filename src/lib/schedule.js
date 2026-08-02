/**
 * Daily planning.
 *
 * `planDay` is deterministic and always available — the app is fully functional
 * with no API key and no network. `planDayWithAI` in ai.js is an optional
 * refinement layered on top, never a dependency.
 */

import { todayKey } from "./store";

/** Realistic focused hours in a day, not aspirational ones. */
export const DAILY_CAPACITY_MINS = 240;

/**
 * Hard cap on how many tasks reach the daily list.
 *
 * This is a feature, not a limitation. A twenty-item list is itself a reason to
 * avoid the list — the point is a day that can actually be finished, so the
 * overflow stays in the project and out of today.
 */
export const MAX_DAILY_TASKS = 6;

function dayDiff(due, now) {
  if (!due) return null;
  const d = new Date(due + "T00:00:00");
  return Math.round((d - new Date(todayKey(now) + "T00:00:00")) / 86400000);
}

/** Higher scores get scheduled first. */
function score(task, now) {
  let s = 0;
  const days = dayDiff(task.due, now);
  if (days !== null) {
    if (days < 0) s += 1000 + Math.min(100, -days * 10); // overdue
    else if (days === 0) s += 800;
    else if (days === 1) s += 500;
    else s += Math.max(0, 300 - days * 20);
  }
  // Nudge short tasks up. Starting is the hard part, and a small first win
  // makes the second task cheaper — so cheap work earns a real bonus here.
  if (task.estimateMins <= 15) s += 120;
  else if (task.estimateMins <= 30) s += 40;
  // Break ties by age so nothing sits forever.
  s += Math.min(60, (now - task.createdAt) / 86400000 * 6);
  return s;
}

/**
 * Build today's list across every project.
 * Returns ordered tasks plus the ones that didn't fit.
 */
export function planDay(tasks, { now = Date.now(), capacity = DAILY_CAPACITY_MINS } = {}) {
  const open = tasks.filter((t) => !t.done);
  const ranked = [...open].sort((a, b) => score(b, now) - score(a, now));

  const picked = [];
  let used = 0;
  for (const t of ranked) {
    if (picked.length >= MAX_DAILY_TASKS) break;
    if (used + t.estimateMins > capacity && picked.length > 0) continue;
    picked.push(t);
    used += t.estimateMins;
  }

  // Lead with the shortest task that made the cut. The first item decides
  // whether the list gets started at all, so it should be the cheapest one.
  if (picked.length > 1) {
    const quickest = picked.reduce((a, b) => (b.estimateMins < a.estimateMins ? b : a));
    if (quickest !== picked[0]) {
      picked.splice(picked.indexOf(quickest), 1);
      picked.unshift(quickest);
    }
  }

  return {
    tasks: picked,
    overflow: ranked.filter((t) => !picked.includes(t)),
    plannedMins: used,
  };
}

/** Tasks already pinned to today, in their saved order. */
export function todaysPlan(tasks, day = todayKey()) {
  return tasks
    .filter((t) => t.scheduledFor === day && !t.done)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
