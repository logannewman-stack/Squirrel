/**
 * Work the app was losing.
 *
 * An architecture audit drove a real browser through every combination of task
 * state and recorded which screens showed each one. The worst result was not a
 * gap in coverage — it was a state the app *manufactures with its own core
 * loop* and then hides:
 *
 *   Start a focus session. Let the timer run out. Don't tick the box.
 *
 * `remainingMins` reaches zero once logged sessions cover the estimate, so the
 * planner had nothing left to schedule and dropped the task — no block, no
 * shortfall, and not counted as needing an estimate either. It appeared on no
 * screen at all, while Today's panel read "1h 2m focused" directly above
 * "Nothing due and nothing planned."
 *
 * For an app built around *starting* things, working through the timer and
 * forgetting the checkbox is the commonest way a session ends. That is the
 * moment the work left the plan.
 *
 * It is not a scheduling question — there is nothing left to schedule — which
 * is exactly why the planner cannot answer it. Either the thing is finished or
 * it needed longer than expected, and only the person knows which.
 */
import { store, reset, iso } from "./harness.mjs";
import { distribute } from "../src/lib/schedule.js";

let pass = 0, fail = 0;
const failures = [];
const t = (name, ok, detail) => {
  if (ok) pass++; else { fail++; failures.push(name); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const NOW = new Date(2026, 7, 3, 9, 0);
const plan = () => {
  const s = store.getState();
  return distribute(s.tasks, s.events, s.sessions, { now: NOW });
};

/** Work on a task for a while without finishing it. */
const focusFor = (taskId, mins) =>
  store.logSession({ taskId, plannedMs: mins * 60000, focusedMs: mins * 60000, endedAt: NOW.getTime() });

/* ------------------------------------------------- the state the app makes */
{
  reset();
  const task = store.addTask({ title: "Rewrite the brief", estimateMins: 60, due: null });
  focusFor(task.id, 62);

  const p = plan();
  t("the task is still open", store.getState().tasks[0].done === false);
  t("and it is on no screen the planner drives", p.blocks.length === 0 && p.shortfalls.length === 0);
  t("so it comes back in its own bucket rather than vanishing", p.spent.length === 1, JSON.stringify(p.spent));
  t("  named", p.spent[0]?.title === "Rewrite the brief");
  t("  with what was spent against what was estimated",
    p.spent[0]?.spentMins === 62 && p.spent[0]?.estimateMins === 60, JSON.stringify(p.spent[0]));
  t("  and counted, so a screen can decide whether the day is empty",
    p.totals.spentCount === 1, p.totals.spentCount);
}

/* ------------------------------------------- and the states it must not claim */
/**
 * The bucket is only for work whose estimate is genuinely used up and which is
 * genuinely still open. Every neighbour below has somewhere else to be, and
 * putting it here would move the bug rather than fix it.
 */
{
  reset();
  const half = store.addTask({ title: "Half done", estimateMins: 120, due: "2026-08-14" });
  focusFor(half.id, 30);
  t("work with time left on it is still planned",
    plan().spent.length === 0 && plan().blocks.length > 0, JSON.stringify(plan().spent));

  reset();
  const done = store.addTask({ title: "Finished", estimateMins: 60 });
  focusFor(done.id, 70);
  store.toggleTask(done.id);
  t("a task that was ticked off is not asked about", plan().spent.length === 0);

  reset();
  const none = store.addTask({ title: "No estimate", estimateMins: 0 });
  focusFor(none.id, 30);
  t("work with no estimate belongs to the other bucket",
    plan().spent.length === 0 && plan().unestimated.length === 1);

  reset();
  const fresh = store.addTask({ title: "Untouched", estimateMins: 60, due: "2026-08-14" });
  t("and work nobody has started is simply planned",
    plan().spent.length === 0 && plan().blocks.length > 0);
  t("  with no sessions against it", store.getState().sessions.length === 0, fresh.id && "");

  reset();
  const given = store.addTask({ title: "Handed over", estimateMins: 60, delegatedTo: "Anders" });
  focusFor(given.id, 70);
  t("delegated work is tracked rather than asked about", plan().spent.length === 0);
}

/* --------------------------------------------------------------- exactly at */
/**
 * The boundary. Spending precisely the estimate is the ordinary case — a timer
 * that ran to zero — and it is the one this was written for.
 */
{
  reset();
  const exact = store.addTask({ title: "Exactly an hour", estimateMins: 60 });
  focusFor(exact.id, 60);
  t("spending exactly the estimate counts", plan().spent.length === 1, JSON.stringify(plan().spent));

  reset();
  const under = store.addTask({ title: "A minute left", estimateMins: 60, due: "2026-08-14" });
  focusFor(under.id, 59);
  t("and a minute short of it does not", plan().spent.length === 0);
}

/* ----------------------------------------------------- several, and the total */
{
  reset();
  for (const [title, mins] of [["One", 30], ["Two", 45], ["Three", 90]]) {
    const x = store.addTask({ title, estimateMins: mins });
    focusFor(x.id, mins + 5);
  }
  const p = plan();
  t("several are all reported", p.spent.length === 3, p.spent.length);
  t("and the count matches", p.totals.spentCount === 3);
  t("each carrying its own numbers",
    p.spent.every((x) => x.spentMins > x.estimateMins), JSON.stringify(p.spent));
}

/* ------------------------------------------------- the day is not empty then */
/**
 * The specific lie this fixes. Today decided whether to say "nothing due and
 * nothing planned" from three lists, and this work was in none of them — so the
 * screen claimed an empty day directly beneath a panel counting the hour that
 * had just been spent on it.
 */
{
  reset();
  const only = store.addTask({ title: "The only thing", estimateMins: 60 });
  focusFor(only.id, 65);
  const p = plan();
  const looksEmpty = p.blocks.length === 0 && p.unestimated.length === 0 && p.shortfalls.length === 0;
  t("a day whose only work is spent looks empty to the old three lists", looksEmpty);
  t("and is not empty once this one is counted", p.totals.spentCount > 0);
}

/* ------------------------------------------------------ it survives the store */
{
  reset();
  const task = store.addTask({ title: "Round trip", estimateMins: 60 });
  focusFor(task.id, 61);
  store.setPlan(plan());
  t("the bucket is persisted with the rest of the plan",
    store.getState().spent?.length === 1, JSON.stringify(store.getState().spent));
  t("and clearing the plan clears it too",
    (store.setPlan({ blocks: [], shortfalls: [], spent: [] }), store.getState().spent.length === 0));
}

/* ------------------------------------------------------------ both answers */
/**
 * The two things the panel offers. Ticking it off ends the matter; giving it
 * more time has to put it back into the plan, or the question was rhetorical.
 */
{
  reset();
  const task = store.addTask({ title: "Needed longer", estimateMins: 60, due: "2026-08-14" });
  focusFor(task.id, 62);
  t("before answering, it is in the bucket", plan().spent.length === 1);

  store.updateTask(task.id, { estimateMins: 180 });
  const after = plan();
  t("raising the estimate puts it back into the plan",
    after.spent.length === 0 && after.blocks.length > 0,
    `spent ${after.spent.length}, blocks ${after.blocks.length}`);

  reset();
  const other = store.addTask({ title: "Actually finished", estimateMins: 60 });
  focusFor(other.id, 62);
  store.toggleTask(other.id);
  t("and ticking it off ends the matter", plan().spent.length === 0);
}

console.log(`\nLost work: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
