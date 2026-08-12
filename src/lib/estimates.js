/**
 * Estimates that learn from the person's own history.
 *
 * Nobody is good at guessing how long their work takes; the app doesn't have
 * to guess, because every focus session already logged the truth. This reads
 * finished tasks — what was estimated, what was actually spent — and answers
 * one question: "around here, how long does a task really take?"
 *
 * The answer is a *suggestion*, never an override. It shows up as a quiet
 * hint beside an estimate that history disagrees with, and as a smarter
 * default when a new acorn is planted. The person's number always wins —
 * the planner's honesty depends on the estimate being theirs.
 *
 * Median, not mean: one all-nighter would poison an average forever, and the
 * question is "what usually happens", which is precisely the median.
 */

/** Minutes actually spent on one task, across every session logged to it. */
export function actualMins(taskId, sessions = []) {
  return Math.round(
    sessions
      .filter((s) => s.taskId === taskId)
      .reduce((n, s) => n + (s.focusedMs || 0), 0) / 60000,
  );
}

/**
 * What a task typically takes here — in this project first, anywhere second.
 *
 * Only finished tasks with real logged time count: an estimate proven by
 * completion. Fewer than three data points is an anecdote, not a pattern,
 * and returns null rather than a confident-sounding coincidence.
 */
export function typicalMins(tasks = [], sessions = [], projectId = null) {
  const sample = (scope) => {
    const done = tasks.filter(
      (t) => t.done && (scope === "project" ? t.projectId === projectId : true),
    );
    const spans = done
      .map((t) => actualMins(t.id, sessions))
      .filter((m) => m >= 5); // touched for a minute is not a data point
    if (spans.length < 3) return null;
    spans.sort((a, b) => a - b);
    const mid = Math.floor(spans.length / 2);
    const median = spans.length % 2 ? spans[mid] : Math.round((spans[mid - 1] + spans[mid]) / 2);
    // Said in the app's own units: quarter hours.
    return Math.max(15, Math.round(median / 15) * 15);
  };
  return (projectId ? sample("project") : null) ?? sample("all");
}

/**
 * The hint, if history earns one: this task's estimate vs what usually
 * happens. Quiet unless they disagree by at least 40% and 15 minutes —
 * "you said 30, it's usually 32" is noise wearing a badge.
 */
export function estimateHint(task, tasks = [], sessions = []) {
  if (!task || task.done || !(task.estimateMins > 0)) return null;
  const usual = typicalMins(tasks, sessions, task.projectId ?? null);
  if (!usual) return null;
  const gap = Math.abs(usual - task.estimateMins);
  if (gap < 15 || gap / task.estimateMins < 0.4) return null;
  return { usual, over: usual > task.estimateMins };
}
