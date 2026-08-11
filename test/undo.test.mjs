/**
 * The undo history, and what is allowed onto it.
 *
 * Undo is the app's whole safety argument — she can change your week because
 * you can always take it back. Which makes the history itself load-bearing, and
 * two ways of corrupting it are silent:
 *
 * **Junk steps.** A form that saves on blur writes whether or not anything was
 * edited. Three untouched fields meant three history entries, so ⌘Z had to be
 * pressed three times before anything visibly moved — which reads as an undo
 * that does not work, and is worse than not having one.
 *
 * **Noise.** Every write being announced is how people learn to ignore the
 * announcement, and then the one that mattered goes past unread.
 */
import { store, reset, iso } from "./harness.mjs";

let pass = 0, fail = 0;
const failures = [];
const t = (name, ok, detail) => {
  if (ok) pass++; else { fail++; failures.push(name); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const {
  addProject, updateProject, deleteProject, addTask, updateTask, toggleTask, deleteTask,
  addEvent, updateEvent, deleteEvent, batch, undo, undoDepth, lastChange, lastChangeLoud, getState,
} = store;

/** Depth before and after, so a claim about "did this record a step" is exact. */
const steps = (fn) => {
  const before = undoDepth();
  fn();
  return undoDepth() - before;
};

// ------------------------------------------------------- writes that changed nothing
{
  reset();
  const p = addProject({ name: "Q3 launch", client: "Acme", value: 12000 });

  t("a real edit is recorded", steps(() => updateProject(p.id, { name: "Q3 relaunch" })) === 1);

  /**
   * The one that was wrong. `onBlur` fires on a field nobody touched, so
   * tabbing through the three inputs on a project wrote three times.
   */
  t("saving the same name again records nothing",
    steps(() => updateProject(p.id, { name: "Q3 relaunch" })) === 0);
  t("nor does re-saving several unchanged fields at once",
    steps(() => updateProject(p.id, { name: "Q3 relaunch", client: "Acme", value: 12000 })) === 0);
  t("and the row is not re-marked dirty for an upload that would change nothing",
    getState().projects[0].dirty === false || (() => {
      // A fresh add is legitimately dirty; clear it and re-check the no-op path.
      store.markSynced([{ kind: "projects", id: p.id }]);
      updateProject(p.id, { name: "Q3 relaunch" });
      return getState().projects[0].dirty === false;
    })());

  t("a changed field among unchanged ones still counts",
    steps(() => updateProject(p.id, { name: "Q3 relaunch", client: "Globex" })) === 1);

  const task = addTask({ title: "Board deck", estimateMins: 120 });
  t("the same holds for tasks", steps(() => updateTask(task.id, { estimateMins: 120 })) === 0);
  t("and a real change to one is still recorded",
    steps(() => updateTask(task.id, { estimateMins: 90 })) === 1);

  const ev = addEvent({ title: "Call with Priya", start: iso(2026, 8, 13, 15), end: iso(2026, 8, 13, 15, 30) });
  t("and for meetings", steps(() => updateEvent(ev.id, { title: "Call with Priya" })) === 0);

  /**
   * Arrays are the trap: comparing by reference calls every save a change, so
   * a meeting with attendees would have been exempt from all of the above.
   */
  const withPeople = addEvent({
    title: "Standup", start: iso(2026, 8, 13, 9), end: iso(2026, 8, 13, 9, 15),
    attendees: [{ name: "Priya" }, { name: "Sam" }],
  });
  t("an unchanged list of attendees is unchanged",
    steps(() => updateEvent(withPeople.id, { attendees: [{ name: "Priya" }, { name: "Sam" }] })) === 0);
  t("but adding somebody to it is a change",
    steps(() => updateEvent(withPeople.id, { attendees: [{ name: "Priya" }, { name: "Sam" }, { name: "Lee" }] })) === 1);

  t("updating something that does not exist does not throw or record",
    steps(() => updateTask("no-such-id", { title: "x" })) === 0);
}

// ------------------------------------------------------------------ loud and quiet
/**
 * Every write is undoable and ⌘Z reaches all of them. The bar is only for the
 * changes you can make without seeing the whole of what happened.
 */
{
  reset();
  const p = addProject({ name: "Q3 launch" });
  t("creating a project is quiet — you are looking at it", !lastChangeLoud());

  const task = addTask({ title: "Board deck", estimateMins: 60, projectId: p.id });
  t("adding a task is quiet", !lastChangeLoud());

  updateTask(task.id, { estimateMins: 90 });
  t("editing one is quiet", !lastChangeLoud());

  toggleTask(task.id);
  t("ticking one off is quiet — the row visibly changes under your finger", !lastChangeLoud());

  const ev = addEvent({ title: "Call with Priya", start: iso(2026, 8, 13, 15), end: iso(2026, 8, 13, 15, 30) });
  t("booking a meeting is loud", lastChangeLoud());

  updateEvent(ev.id, { start: iso(2026, 8, 13, 16), end: iso(2026, 8, 13, 16, 30) });
  t("moving one is loud — a day is not a thing you can see all of", lastChangeLoud());

  deleteEvent(ev.id);
  t("cancelling one is loud", lastChangeLoud());

  deleteTask(task.id);
  t("deleting a task is loud", lastChangeLoud());

  batch("clearing Thursday", () => {
    addEvent({ title: "a", start: iso(2026, 8, 13, 9), end: iso(2026, 8, 13, 10) });
    addEvent({ title: "b", start: iso(2026, 8, 13, 11), end: iso(2026, 8, 13, 12) });
  });
  t("anything plural is loud, whatever it was made of", lastChangeLoud());

  reset();
  const doomed = addProject({ name: "Doomed" });
  addTask({ title: "one", projectId: doomed.id });
  addTask({ title: "two", projectId: doomed.id });
  deleteProject(doomed.id);
  t("deleting a project is loud — it takes its tasks with it", lastChangeLoud());
  t("and it really did take them", getState().tasks.length === 0);
}

// -------------------------------------------------------------- stepping back
{
  reset();
  const task = addTask({ title: "Board deck", estimateMins: 60 });
  addEvent({ title: "Call with Priya", start: iso(2026, 8, 13, 15), end: iso(2026, 8, 13, 15, 30) });
  deleteTask(task.id);
  t("the task is gone", getState().tasks.length === 0);

  const what = undo();
  t("undo says what it took back", /Board deck/.test(what ?? ""), what);
  t("and the task is back", getState().tasks.length === 1);

  /**
   * One step per change, in order. This is what the junk-step fix protects:
   * with no-ops recorded, the counts below drift and undo appears to stall.
   */
  t("the meeting is still there — undo went back exactly one step",
    getState().events.length === 1);
  undo();
  t("a second step takes the meeting", getState().events.length === 0);
  undo();
  t("and a third takes the task", getState().tasks.length === 0);

  t("undoing past the beginning returns nothing rather than throwing", undo() === null);
  t("and the depth cannot go negative", undoDepth() === 0);
  t("with nothing left to name", lastChange() === null);
  t("and nothing left to announce", lastChangeLoud() === false);
}

// ------------------------------------------------------------------- batching
/**
 * Six cancellations under one label. Without this, undo puts back one meeting
 * and leaves five gone — which is worse than no undo, because it looks like it
 * worked.
 */
{
  reset();
  for (let d = 10; d < 16; d++) {
    addEvent({ title: `day ${d}`, start: iso(2026, 8, d, 9), end: iso(2026, 8, d, 10) });
  }
  const before = undoDepth();
  batch("clearing the week", () => {
    for (const e of [...getState().events]) deleteEvent(e.id);
  });
  t("six deletions record one step", undoDepth() - before === 1, undoDepth() - before);
  t("and the week is clear", getState().events.length === 0);
  undo();
  t("one undo puts all six back", getState().events.length === 6, getState().events.length);
}

console.log(`\nUndo: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
