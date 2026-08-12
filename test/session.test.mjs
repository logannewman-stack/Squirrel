/**
 * The focus session, under everything that actually happens to one.
 *
 * An audit drove the session loop the way a person does — start, pause, quit,
 * come back tomorrow, delete things out from under it — and found the app
 * destroying the very minutes it exists to protect:
 *
 *   · Pause wrote "NaN:NaN" on the clock and ended the session with NaN
 *     focused minutes. React hands a click handler its event, and
 *     `pauseFocus(event)` put a SyntheticEvent where a timestamp belonged.
 *   · Quitting one minute into a 25-minute block logged the FULL 25 minutes,
 *     stamped at whatever moment the app was next opened — fiction, dated the
 *     wrong day.
 *   · Deleting the focused task left the timer counting down against a ghost:
 *     the dead task's title on screen, minutes eventually logged against an id
 *     nothing could resolve.
 *
 * A tracker that invents time is worse than no tracker, because its numbers
 * get believed.
 */
import { store, reset, t, report } from "./harness.mjs";

const MIN = 60000;

/* --------------------------------------------------- the event-argument trap */
{
  reset();
  const task = store.addTask({ title: "Draft the roof quote", estimateMins: 60 });
  store.startFocus({ taskId: task.id, label: task.title, plannedMs: 25 * MIN });

  // Exactly what React passes a click handler. If this ever reaches the
  // arithmetic, the countdown is NaN and the log is poisoned.
  store.pauseFocus({ nativeEvent: {}, type: "click" });
  const paused = store.getState().active;
  t("pausing with an event where a timestamp belonged still pauses", paused.endsAt === null);
  t("  and the remainder is a real number", Number.isFinite(paused.remainingMs), paused.remainingMs);
  t("  close to the full block", Math.abs(paused.remainingMs - 25 * MIN) < 5000, paused.remainingMs);

  store.resumeFocus({ type: "click" });
  const resumed = store.getState().active;
  t("resuming with an event still resumes", Number.isFinite(resumed.endsAt));

  const done = store.endFocus({ type: "click" });
  t("ending with an event logs real minutes, never NaN",
    Number.isFinite(store.getState().sessions[0].focusedMs),
    JSON.stringify(store.getState().sessions[0]));
  t("  and the session is over", store.getState().active === null && done !== null);
}

/* ------------------------------------------------ an already-poisoned pause */
/**
 * Users who hit the old bug have `remainingMs: null` persisted. Resuming used
 * to set `endsAt = now + null = now`, which ended instantly and logged the
 * whole planned block as done work. The safe direction to be wrong in is
 * under-crediting.
 */
{
  reset();
  const task = store.addTask({ title: "Poisoned", estimateMins: 60 });
  store.startFocus({ taskId: task.id, label: task.title, plannedMs: 25 * MIN });
  store.pauseFocus();
  // Simulate the damage the old code left behind.
  store.getState().active.remainingMs = null;
  store.resumeFocus();
  const a = store.getState().active;
  t("a corrupted remainder restores the full block rather than credit",
    a.remainingMs === 25 * MIN && a.endsAt - Date.now() > 24 * MIN, JSON.stringify(a));
}

/* ----------------------------------------------------- pause holds the clock */
{
  reset();
  const task = store.addTask({ title: "Held", estimateMins: 60 });
  const t0 = Date.now();
  store.startFocus({ taskId: task.id, label: task.title, plannedMs: 25 * MIN });
  store.pauseFocus(t0 + 5 * MIN);
  const heldAt = store.getState().active.remainingMs;
  store.resumeFocus(t0 + 60 * MIN);
  const after = store.getState().active;
  t("a paused hour costs nothing", Math.abs(after.endsAt - (t0 + 60 * MIN) - heldAt) < 1000,
    `${after.endsAt - (t0 + 60 * MIN)} vs ${heldAt}`);
  t("  with twenty minutes still to run", Math.abs(heldAt - 20 * MIN) < 1000, heldAt);
}

/* ------------------------------------------------------- the overnight quit */
{
  reset();
  const task = store.addTask({ title: "Abandoned", estimateMins: 60 });
  const t0 = Date.now() - 20 * 3600000; // yesterday morning
  store.startFocus({ taskId: task.id, label: task.title, plannedMs: 25 * MIN });
  // Rewind the whole session to yesterday, one minute of heartbeat in.
  store.getState().active.startedAt = t0;
  store.getState().active.endsAt = t0 + 25 * MIN;
  store.getState().active.seenAt = t0 + 1 * MIN;

  const settled = store.reconcileFocus();
  const logged = store.getState().sessions[0];
  t("a session the app slept through is reconciled, not invented", settled?.reconciled === true);
  t("  crediting the minute that really happened, not the block",
    Math.abs(logged.focusedMs - 1 * MIN) < 1000, logged.focusedMs);
  t("  stamped when the person was last there, not at relaunch",
    Math.abs(logged.endedAt - (t0 + 1 * MIN)) < 1000,
    new Date(logged.endedAt).toISOString());
  t("  and the session is cleared", store.getState().active === null);
}

/* --------------------------------------------- a fresh expiry is not touched */
{
  reset();
  const task = store.addTask({ title: "Ran its course", estimateMins: 60 });
  store.startFocus({ taskId: task.id, label: task.title, plannedMs: 25 * MIN });
  store.getState().active.startedAt = Date.now() - 25 * MIN - 5000;
  store.getState().active.endsAt = Date.now() - 5000;
  t("a timer that just ran out is not reconciled — the live path owns it",
    store.reconcileFocus() === null);
  const done = store.endFocus();
  t("  and ends with the full block credited, as designed",
    Math.abs(done.focusedMs - 25 * MIN) < 10000, done.focusedMs);
}

/* -------------------------------------------- deleting the focused task */
{
  reset();
  const task = store.addTask({ title: "Doomed", estimateMins: 60 });
  store.startFocus({ taskId: task.id, label: task.title, plannedMs: 25 * MIN });
  store.deleteTask(task.id);
  const s = store.getState();
  t("deleting the focused task ends the session first", s.active === null);
  t("  banking the time already spent", s.sessions.length === 1 && Number.isFinite(s.sessions[0].focusedMs));
  t("  under the task's name", s.sessions[0].label === "Doomed");
  t("  and the task is gone", s.tasks.length === 0);

  reset();
  const other = store.addTask({ title: "Bystander", estimateMins: 30 });
  const focused = store.addTask({ title: "Kept", estimateMins: 60 });
  store.startFocus({ taskId: focused.id, label: "Kept", plannedMs: 25 * MIN });
  store.deleteTask(other.id);
  t("deleting some other task leaves the session alone",
    store.getState().active?.taskId === focused.id);
}

/* ------------------------------------------------------------- the heartbeat */
{
  reset();
  const task = store.addTask({ title: "Pulsed", estimateMins: 60 });
  store.startFocus({ taskId: task.id, label: task.title, plannedMs: 25 * MIN });
  const before = store.getState().active.seenAt;
  store.heartbeatFocus();
  const a = store.getState().active;
  t("the heartbeat stamps presence", Number.isFinite(a.seenAt) && a.seenAt !== before);
  t("  without touching the clock", Number.isFinite(a.endsAt));
  t("  and beats on nothing quietly", (reset(), store.heartbeatFocus(), store.getState().active === null));
}

report("Sessions");
