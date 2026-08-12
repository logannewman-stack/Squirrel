/**
 * Finishing a project, as opposed to deleting one.
 *
 * `archived` was read in eight places across the app — the projects grid
 * filtered on it, Today filtered on it, the plan quota counted against it,
 * search ranked it down, the assistant's project counts excluded it — and a
 * grep of `src/` found it written in exactly none. Nothing in the app could
 * set the flag. Every one of those readers was branching on a value that was
 * permanently false.
 *
 * Which meant a finished deal had two fates: sit on the grid forever beside
 * live work, or be deleted — and delete takes every task and every logged hour
 * with it, unrecoverably. The ordinary end of a piece of work, finishing it,
 * was served only by the irreversible button.
 *
 * So this pins the flag against the readers that were already waiting for it,
 * rather than against the setter alone: an archive that the grid still shows,
 * or that the quota still counts, is not an archive.
 */
import { store, reset, t, report } from "./harness.mjs";
import { usage } from "../src/lib/plans.js";
import { whenProject } from "../src/lib/when.js";

/* -------------------------------------------------------------- the round trip */
{
  reset();
  const p = store.addProject({ name: "Munich lease" });
  t("a new project is not archived", !store.getState().projects[0].archived);

  store.setProjectArchived(p.id);
  t("it can be put away", store.getState().projects[0].archived === true);

  store.setProjectArchived(p.id, false);
  t("and brought back", store.getState().projects[0].archived === false);
}

/* --------------------------------------------------- nothing else is disturbed */
/**
 * The whole reason to archive rather than delete. Deleting drops the tasks,
 * re-parents the events and loses the sessions; archiving must keep all three
 * or it is a delete that lies about being reversible.
 */
{
  reset();
  const p = store.addProject({ name: "Q3 launch" });
  const task = store.addTask({ title: "Board deck", projectId: p.id, estimateMins: 60 });
  store.logSession({ taskId: task.id, plannedMs: 3600000, focusedMs: 3600000, endedAt: Date.now() });

  store.setProjectArchived(p.id);
  const s = store.getState();
  t("the work is still there", s.tasks.length === 1 && s.tasks[0].projectId === p.id);
  t("and so are the hours logged against it", s.sessions.length === 1);
  t("  which is the entire difference from deleting it",
    (store.deleteProject(p.id), store.getState().tasks.length === 0));
}

/* -------------------------------------------------- the readers that were waiting */
{
  reset();
  const live = store.addProject({ name: "Live one" });
  const old = store.addProject({ name: "Old one" });
  store.setProjectArchived(old.id);

  const s = store.getState();
  t("the grid's filter now has something to filter",
    s.projects.filter((x) => !x.archived).length === 1);

  /**
   * The quota is the one that costs money. It counts live projects, so an
   * archived project has to stop counting — otherwise finishing work moves
   * somebody towards a paywall.
   */
  const meter = usage({ ...s, plan: "free" }).meters.find((m) => m.key === "projects");
  t("and the plan quota stops counting a finished project", meter.used === 1, JSON.stringify(meter));
}

/* ------------------------------------------------------------ no accidental writes */
/**
 * Archiving something already archived must not push an undo step. The undo
 * stack is a list of things a person did, and a no-op in it is a press of the
 * undo key that appears to do nothing.
 */
{
  reset();
  const p = store.addProject({ name: "Steady" });
  store.setProjectArchived(p.id);
  const depth = store.undoDepth();
  store.setProjectArchived(p.id);
  store.setProjectArchived(p.id, true);
  t("archiving twice is not two undo steps", store.undoDepth() === depth, `${depth} → ${store.undoDepth()}`);

  store.setProjectArchived("no-such-project");
  t("and an unknown project changes nothing", store.getState().projects.length === 1);
}

/* ----------------------------------------------------------------- and undo works */
{
  reset();
  const p = store.addProject({ name: "Reversible" });
  store.setProjectArchived(p.id);
  t("archiving is undoable", store.getState().projects[0].archived === true);
  store.undo();
  /**
   * Falsy rather than `=== false`: undo restores the project to the shape it
   * had before, in which the key had never been written at all. Every reader
   * in the app tests `!p.archived`, so that is the contract worth pinning —
   * asserting the literal `false` would be pinning an implementation detail
   * of how the flag first got there.
   */
  t("  and undoing it brings the project back to the grid",
    !store.getState().projects[0].archived, JSON.stringify(store.getState().projects[0]));
}

/* ------------------------------------------------- an archived project still reads */
/**
 * Archived is a shelf, not a tomb: opening one has to work, because that is
 * where the way back lives.
 */
{
  reset();
  const p = store.addProject({ name: "Shelved" });
  store.addTask({ title: "Leftover", projectId: p.id, estimateMins: 60, due: "2026-12-01" });
  store.setProjectArchived(p.id);
  const w = whenProject(store.getState().projects[0], store.getState().tasks, store.getState());
  t("an archived project still answers about its own work", w && w.state !== undefined, JSON.stringify(w));
}

report("Archive");
