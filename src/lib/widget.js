import { dayKey } from "./store.js";
import { workOn, fmtTime } from "./agenda.js";

/**
 * What the Home Screen widget shows.
 *
 * Built here rather than in Swift, deliberately. The planner already exists and
 * has one answer to "what is on today"; a second one written in another
 * language would disagree with it inside a month, and this project has already
 * fixed that exact bug once — the Today screen used to run its own scheduler.
 *
 * So the app computes a small summary and hands it over, and the widget only
 * draws. Nothing in the native layer decides anything.
 */

/** The day, small enough to sit in a shared container. */
export function widgetSnapshot(state, now = new Date()) {
  const day = dayKey(now);
  const events = (state?.events ?? [])
    .filter((e) => dayKey(new Date(e.start)) === day)
    .map((e) => ({ at: new Date(e.start), time: fmtTime(new Date(e.start)), title: e.title, kind: "meeting" }));

  const work = workOn(state?.blocks ?? [], state?.tasks ?? [], day)
    .filter((b) => b.start)
    .map((b) => ({ at: new Date(b.start), time: fmtTime(new Date(b.start)), title: b.task.title, kind: "work" }));

  const items = [...events, ...work]
    .sort((a, b) => a.at - b.at)
    .map(({ time, title, kind }) => ({ time, title, kind }));

  const overdue = (state?.tasks ?? [])
    .filter((t) => !t.done && !t.delegatedTo && t.due && t.due < day).length;

  const meetings = events.length;
  const workMins = workOn(state?.blocks ?? [], state?.tasks ?? [], day)
    .reduce((n, b) => n + (b.mins || 0), 0);

  const parts = [];
  if (meetings) parts.push(`${meetings} ${meetings === 1 ? "meeting" : "meetings"}`);
  if (workMins) parts.push(`${Math.round((workMins / 60) * 10) / 10}h of work`);

  return {
    // A day with nothing on it says so plainly. "0 meetings, 0h of work" is a
    // readout; "Nothing scheduled" is an answer.
    headline: parts.length ? parts.join(", ") : "Nothing scheduled",
    items,
    overdue,
    writtenAt: new Date().toISOString(),
  };
}

/**
 * Hand it to the native layer, if there is one.
 *
 * A no-op on the web, which is most of where this runs. The bridge is expected
 * to be installed by the app shell; its absence is the ordinary case rather
 * than an error worth reporting.
 */
export function publishWidget(state, now = new Date()) {
  const write = globalThis.__SQUIRREL_WRITE_WIDGET__;
  if (typeof write !== "function") return false;
  try {
    write(widgetSnapshot(state, now));
    return true;
  } catch {
    // A widget that fails to update is a stale widget, never a broken app.
    return false;
  }
}
