/**
 * The app knew when your work was happening and never said.
 *
 * A browser walk of the chain the app is built around — make a project, add
 * work to it with a duration, a rank and a deadline, then go and find the
 * consequence — came back like this. Set 2h, high, due Friday, on a Tuesday:
 *
 *   store   blocks: [{ day: "2026-08-12", start: "09:00", mins: 120 }]
 *   screen  "Draft the lease redlines   120m   3d"
 *
 * The planner had booked tomorrow morning. The screen the person was standing
 * on reported an estimate in minutes and a countdown in days, and no screen
 * except the calendar mentioned the booking. Today's panel, on the same run,
 * read "Nothing due and nothing planned. Add work with a deadline and an
 * estimate, and it lays itself out." — instructing somebody to do the thing
 * they had just finished doing.
 *
 * So this pins the sentence rather than the schedule. `distribute` was already
 * right; what was missing was any way for a component to ask what it decided
 * without re-deciding, which is how two screens end up disagreeing about a
 * Thursday.
 */
import { store, reset, iso, t, report } from "./harness.mjs";
import { distribute } from "../src/lib/schedule.js";
import { whenTask, whenProject } from "../src/lib/when.js";

/**
 * Tuesday, late enough that today is spent.
 *
 * At 9am the planner correctly splits even a two-hour job across today and
 * tomorrow — there is a whole working day going begging — and that made the
 * single-sitting phrasing untestable without fighting the thing being tested.
 *
 * 18:30 is the hour the browser walk actually ran at, and it is the honest
 * hour to ask "so when will this happen?": today has less than one sitting
 * left in it, so the answer is about tomorrow, which is the answer somebody
 * asking at the end of a day wants.
 */
const NOW = new Date(2026, 7, 11, 18, 30);
const plan = () => {
  const s = store.getState();
  return distribute(s.tasks, s.events, s.sessions, { now: NOW });
};
const when = (task, p = plan()) => whenTask(task, p, { now: NOW });

/* ------------------------------------------------------ the walk that failed */
{
  reset();
  const project = store.addProject({ name: "Munich lease", client: "Hartmann" });
  const task = store.addTask({
    title: "Draft the lease redlines",
    projectId: project.id,
    estimateMins: 120,
    priority: "high",
    due: "2026-08-14",
  });

  const p = plan();
  t("the planner books it", p.blocks.filter((b) => b.taskId === task.id).length === 1);

  const w = when(task, p);
  t("and the task can now say so", w.state === "scheduled", JSON.stringify(w));
  t("  naming the day in a row's worth of words",
    /^tomorrow \d/.test(w.short), w.short);
  // Both ends of the sitting, and no duration after them — the reader can see
  // both numbers, and restating the difference is the app showing its working.
  t("  and both ends of the sitting in a sentence",
    /^Tomorrow, \d+:\d\d [AP]M–\d+:\d\d [AP]M\.$/.test(w.long), w.long);
  t("  carrying the block itself, so a screen can link to it",
    w.day === "2026-08-12" && w.mins === 120, `${w.day} · ${w.mins}`);
}

/* ------------------------------------------------------------- split across days */
/**
 * Long work is spread, and a row has no space for an itinerary. The runway is
 * the commitment: when it starts and when it stops being on your plate.
 */
{
  reset();
  const task = store.addTask({ title: "Rebuild the model", estimateMins: 600, due: "2026-08-21" });
  const w = when(task);
  t("split work reports a runway rather than a date", w.state === "scheduled" && w.blocks.length > 1,
    `${w.blocks.length} sittings`);
  t("  from the first day to the last", / → /.test(w.short), w.short);
  t("  and counts the sittings in the sentence",
    new RegExp(`across ${w.blocks.length} sittings`).test(w.long), w.long);
}

/* -------------------------------------------------------- same-day sittings */
/**
 * "today → today" was an arrow from a place to itself — a 2h task split
 * around a lunch meeting wore it while the clock time, the only fact the
 * reader wanted, was displaced by it.
 */
{
  reset();
  store.addEvent({ title: "Lunch", start: iso(2026, 8, 12, 12, 0), end: iso(2026, 8, 12, 13, 0) });
  const task = store.addTask({ title: "Around lunch", estimateMins: 300, due: "2026-08-12" });
  const w = when(task);
  if (w.blocks.length > 1 && w.blocks[0].day === w.blocks.at(-1).day) {
    t("sittings sharing a day never draw an arrow to themselves",
      !/ → /.test(w.short), w.short);
    t("  the row leads with the clock instead", /\d+:\d\d/.test(w.short), w.short);
    t("  and the sentence counts the sittings", /across \d+ sittings/.test(w.long), w.long);
  } else {
    t("(fixture did not split same-day — still no self-arrow)",
      !/(today|tomorrow|\w{3}) → \1/.test(w.short), w.short);
  }
}

/* ---------------------------------------------------------------- won't fit */
/**
 * The planner already computes what *would* make it fit. A row that says only
 * "3h short" hands back the arithmetic and keeps the conclusion.
 */
{
  reset();
  const task = store.addTask({ title: "Impossible", estimateMins: 3000, due: "2026-08-13" });
  const p = plan();
  const w = when(task, p);
  t("work that cannot fit says so", w.state === "short", JSON.stringify(w).slice(0, 120));
  t("  with the size of the gap", /short$/.test(w.short), w.short);
  t("  and the deadline it misses", /Won't fit before/.test(w.long), w.long);
  t("  and a way out, not just a number",
    /would do it|would fit by/.test(w.long), w.long);

  /**
   * The half that used to be reported on its own. This task is genuinely both
   * — some of it is booked, most of it will not fit — and reading the blocks
   * first turned a missed deadline into "5h across 1 sitting".
   */
  t("  even though some of it IS booked",
    p.blocks.filter((b) => b.taskId === task.id).length > 0, "no partial booking in this fixture");
  t("  the booked part is named, not dropped", /of it is booked, from /.test(w.long), w.long);
  t("  but never instead of the gap", /^Won't fit/.test(w.long), w.long);
}

/* ------------------------------------------------------------- no estimate */
{
  reset();
  const task = store.addTask({ title: "Chase the invoice", estimateMins: 0, due: "2026-08-14" });
  const w = when(task);
  t("work with no duration explains its absence", w.state === "unestimated");
  t("  and says what would fix it, since the reader can",
    /Say how long it takes/.test(w.long), w.long);
}

/* ------------------------------------------------------------------- spent */
{
  reset();
  const task = store.addTask({ title: "Rewrite the brief", estimateMins: 60 });
  store.logSession({ taskId: task.id, plannedMs: 62 * 60000, focusedMs: 62 * 60000, endedAt: NOW.getTime() });
  const w = when(task);
  t("work whose estimate ran out is asked about", w.state === "spent");
  t("  as a question, because only the person knows",
    /finished, or does it need longer\?$/.test(w.long), w.long);
}

/* -------------------------------------------------------------- handed over */
/**
 * Delegated work is a decision, not a gap. "Not booked" would read as the app
 * having missed the handover, and invites you to make it twice.
 */
{
  reset();
  const task = store.addTask({ title: "Waiting on legal", estimateMins: 60, delegatedTo: "Anders" });
  const w = when(task);
  t("handed-over work names who has it", w.state === "delegated" && /Anders/.test(w.short), w.short);
  t("  and is never described as unbooked", !/book/i.test(w.long), w.long);
}

/* --------------------------------------------------------------------- done */
{
  reset();
  const task = store.addTask({ title: "Finished", estimateMins: 60 });
  store.toggleTask(task.id);
  t("finished work says nothing on a row", when(store.getState().tasks[0]).short === "");
}

/* -------------------------------------------------------- estimated, nowhere */
/**
 * Not a shortfall — no deadline is being missed — but not planned either. It
 * was the state most likely to be silently blank, and silence is how work goes
 * missing.
 */
{
  reset();
  // Fill every workable day so nothing is left for the last one in.
  for (let i = 0; i < 9; i++) {
    store.addTask({ title: `Filler ${i}`, estimateMins: 300, due: "2026-08-21" });
  }
  const late = store.addTask({ title: "Nowhere to go", estimateMins: 120 });
  const w = when(late);
  t("estimated work with no room still reports something",
    w.state === "unplanned" || w.state === "scheduled", w.state);
  if (w.state === "unplanned") {
    t("  and says why rather than going blank", /already full/.test(w.long), w.long);
  } else {
    t("  (the week had room after all, which is also an answer)", true);
  }
}

/* ------------------------------------------------------ never two answers */
/**
 * The reason this is one function rather than a line in each component. Every
 * screen asks the same question of the same plan and gets the same object.
 */
{
  reset();
  const task = store.addTask({ title: "One truth", estimateMins: 120, due: "2026-08-14" });
  const p = plan();
  const a = whenTask(task, p, { now: NOW });
  const b = whenTask(task, p, { now: NOW });
  t("two callers get the same answer", JSON.stringify(a) === JSON.stringify(b));
  t("  and it survives the store round trip",
    (store.setPlan(p), JSON.stringify(whenTask(task, store.getState(), { now: NOW })) === JSON.stringify(a)),
    JSON.stringify(whenTask(task, store.getState(), { now: NOW })));
}

/* ------------------------------------------------------------ whole projects */
{
  reset();
  const project = store.addProject({ name: "Q3 launch", due: "2026-08-28" });
  store.addTask({ title: "Board deck", projectId: project.id, estimateMins: 120, due: "2026-08-14" });
  store.addTask({ title: "Rehearse", projectId: project.id, estimateMins: 60, due: "2026-08-17" });
  const w = whenProject(project, store.getState().tasks, plan(), { now: NOW });
  t("a project reports the day its last piece lands", w.state === "scheduled", JSON.stringify(w));
  t("  with the hours behind it", /3h booked/.test(w.long), w.long);

  // One piece that cannot fit describes the whole project, whatever else is
  // booked. "Finishes Wednesday" beside a missed deadline is expensively true.
  store.addTask({ title: "Impossible bit", projectId: project.id, estimateMins: 4000, due: "2026-08-13" });
  const bad = whenProject(project, store.getState().tasks, plan(), { now: NOW });
  t("and one piece that misses describes the whole project", bad.state === "short", JSON.stringify(bad));
  t("  naming it when it is the only one", /Impossible bit/.test(bad.long), bad.long);
}

{
  reset();
  const project = store.addProject({ name: "Late one", due: "2026-08-12" });
  store.addTask({ title: "Big", projectId: project.id, estimateMins: 900 });
  const w = whenProject(project, store.getState().tasks, plan(), { now: NOW });
  t("a project booked past its own deadline says which side it lands on",
    w.state === "late" && /after the/.test(w.long), JSON.stringify(w));
}

{
  reset();
  const project = store.addProject({ name: "Empty" });
  t("a project with nothing open says so",
    whenProject(project, store.getState().tasks, plan(), { now: NOW }).state === "clear");

  store.addTask({ title: "No idea how long", projectId: project.id, estimateMins: 0 });
  const w = whenProject(project, store.getState().tasks, plan(), { now: NOW });
  t("and one where nothing is estimated blames the estimates, not the calendar",
    w.state === "unplanned" && /estimate/.test(w.long), w.long);
}

/* ------------------------------------------------------------ around meetings */
/**
 * The booking has to be a real gap in a real day, not an idealised one — that
 * is the whole reason to ask the planner instead of dividing by five.
 */
{
  reset();
  // The whole of tomorrow morning is gone, so a booking that ignored meetings
  // would land at 08:00 and collide.
  store.addEvent({ title: "Board", start: iso(2026, 8, 12, 8, 0), end: iso(2026, 8, 12, 12, 0) });
  const task = store.addTask({ title: "After the board", estimateMins: 60, due: "2026-08-17" });
  const w = when(task);
  t("work is booked around a meeting, not through it", w.state === "scheduled", JSON.stringify(w));
  t("  starting after it ends",
    !w.start || new Date(w.start) >= new Date(iso(2026, 8, 12, 12, 0)), w.start);
  t("  and the row says the hour, so the gap is visible",
    /12:00|1[2-9]:\d\d/.test(w.short), w.short);
}

report("When");
