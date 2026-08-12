/**
 * Estimates that learn — pure arithmetic over what already happened.
 */
import { typicalMins, estimateHint, actualMins } from "../src/lib/estimates.js";

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const done = (id, projectId) => ({ id, projectId, title: id, done: true, estimateMins: 30 });
const spent = (taskId, mins) => ({ taskId, focusedMs: mins * 60000 });

{
  t("two finished tasks are an anecdote, not a pattern",
    typicalMins([done("a", "p"), done("b", "p")], [spent("a", 50), spent("b", 55)], "p") === null);

  const tasks = [done("a", "p"), done("b", "p"), done("c", "p")];
  const sessions = [spent("a", 50), spent("b", 62), spent("c", 41)];
  t("three finished tasks speak — the median, in quarter hours",
    typicalMins(tasks, sessions, "p") === 45, typicalMins(tasks, sessions, "p"));

  const outlier = [...sessions.filter((s) => s.taskId !== "c"), spent("c", 400)];
  t("  one all-nighter cannot poison it (median, not mean)",
    typicalMins(tasks, outlier, "p") === 60, typicalMins(tasks, outlier, "p"));

  t("  a minute's touch is not a data point",
    typicalMins(tasks, [spent("a", 2), spent("b", 50), spent("c", 50)], "p") === null);

  const elsewhere = [done("x", "q"), done("y", "q"), done("z", "q")];
  const theirTime = [spent("x", 90), spent("y", 95), spent("z", 85)];
  t("a project with no history borrows the global pattern",
    typicalMins(elsewhere, theirTime, "brand-new") === 90);
}

{
  const tasks = [done("a", "p"), done("b", "p"), done("c", "p")];
  const sessions = [spent("a", 60), spent("b", 60), spent("c", 60)];
  const fresh = { id: "n", projectId: "p", done: false, estimateMins: 30 };
  const hint = estimateHint(fresh, tasks, sessions);
  t("history that disagrees speaks up", hint?.usual === 60 && hint.over === true, JSON.stringify(hint));

  t("  but 30 versus 32 stays quiet",
    estimateHint({ ...fresh, estimateMins: 50 }, tasks, sessions) === null);
  t("  finished work is never nagged",
    estimateHint({ ...fresh, done: true }, tasks, sessions) === null);
  t("  and no estimate means nothing to compare",
    estimateHint({ ...fresh, estimateMins: 0 }, tasks, sessions) === null);

  t("actual minutes sum every session on the task",
    actualMins("a", [spent("a", 20), spent("a", 15), spent("b", 99)]) === 35);
}

console.log(`\nEstimates: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
