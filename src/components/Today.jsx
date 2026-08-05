import { findFreeSlots, fmtTime, workOn } from "../lib/agenda";
import { dayKey, toggleTask, eventsOn } from "../lib/store";
import { planOpts, sayMins } from "../lib/hours";
import { duration } from "../lib/format";
import TaskRow from "./TaskRow";

/**
 * The day, from the one plan.
 *
 * This screen used to run its own planner — its own scoring, its own capacity
 * arithmetic, its own idea of what deserved the day — while the calendar, the
 * reminders and the assistant all read `distribute`. Two answers to "what
 * should I work on today", with no way to tell which one you were looking at.
 * Everything here is now a view of `state.blocks`: the same blocks the
 * calendar draws and the same ones the reminders fire from.
 *
 * The other change is the banner. Work that does not fit before its deadline
 * was being computed, stored, and shown nowhere — the single most valuable
 * thing the planner produces, discoverable only by asking. It is the first
 * thing on the page now, because it is the only thing here that costs money
 * to find out late.
 */
export default function Today({ state, onFocus, onNewEvent }) {
  const day = dayKey();
  const now = new Date();
  const events = eventsOn(day, state.events);
  const work = planOpts(state.settings);

  const blocks = workOn(state.blocks, state.tasks, day);
  const plannedMins = blocks.reduce((n, b) => n + b.mins, 0);
  const shortfalls = state.shortfalls || [];
  const unestimated = (state.tasks || []).filter(
    (t) => !t.done && !t.delegatedTo && !(t.estimateMins > 0),
  );

  const free = findFreeSlots(day, state.events, {
    start: work.workStart, end: work.workEnd, breaks: work.breaks, after: now,
  }).reduce((s, x) => s + x.mins, 0);
  const meetingMins = events.reduce((s, e) => s + (new Date(e.end) - new Date(e.start)) / 60000, 0);
  const focusedToday = state.sessions
    .filter((s) => dayKey(new Date(s.endedAt)) === day)
    .reduce((sum, s) => sum + s.focusedMs, 0);
  const overdue = state.tasks.filter((t) => !t.done && t.due && t.due < day);
  const next = events.find((e) => new Date(e.end) > now);

  // Meetings and planned work in one column, in the order they happen. Two
  // lists side by side made the day look emptier than it is and hid every
  // collision between the two kinds of commitment.
  const timeline = [
    ...events.map((e) => ({
      kind: "meeting", at: new Date(e.start), end: new Date(e.end), title: e.title,
      note: e.location || "", id: e.id,
    })),
    ...blocks.filter((b) => b.start).map((b) => ({
      kind: "work", at: new Date(b.start), end: new Date(b.end), title: b.task.title,
      note: b.task.due ? `due ${b.task.due}` : "", id: `${b.taskId}-${b.start}`, task: b.task,
    })),
  ].sort((a, b) => a.at - b.at);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="label">
            {now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Today</h1>
        </div>
        <button
          onClick={onNewEvent}
          className="rounded-md border border-[var(--line)] px-3.5 py-2 text-xs
                     transition-colors hover:border-[var(--ink)]"
        >
          New event
        </button>
      </header>

      {shortfalls.length > 0 && <Shortfalls list={shortfalls} tasks={state.tasks} />}

      <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--line)]
                      bg-[var(--line)] sm:grid-cols-4">
        <Stat
          label="In meetings"
          value={duration(meetingMins * 60000)}
          sub={`${events.length} ${events.length === 1 ? "meeting" : "meetings"}`}
        />
        <Stat label="Work planned" value={duration(plannedMins * 60000)} sub={
          blocks.length ? `${new Set(blocks.map((b) => b.taskId)).size} tasks` : "nothing scheduled"
        } />
        <Stat label="Still open" value={duration(free * 60000)} sub="left in the day" />
        <Stat
          label="Overdue"
          value={String(overdue.length)}
          sub={overdue.length ? "needs a decision" : "nothing late"}
          alert={overdue.length > 0}
        />
      </div>

      {next && (
        <div className="mb-8 flex items-center justify-between rounded-lg border border-[var(--ink)] px-5 py-4">
          <div className="min-w-0">
            <p className="label">Next</p>
            <p className="mt-1 truncate font-medium">{next.title}</p>
            <p className="num mt-0.5 text-xs text-[var(--muted)]">
              {fmtTime(next.start)} – {fmtTime(next.end)}
              {next.location && ` · ${next.location}`}
            </p>
          </div>
          <span className="num shrink-0 text-sm text-[var(--muted)]">
            {new Date(next.start) > now ? `in ${duration(new Date(next.start) - now)}` : "now"}
          </span>
        </div>
      )}

      <div className="grid gap-10 md:grid-cols-[1fr_1fr]">
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="label">The day</h2>
            {timeline.length > 0 && (
              <span className="num text-xs text-[var(--muted)]">
                {duration((meetingMins + plannedMins) * 60000)} committed
              </span>
            )}
          </div>
          {timeline.length === 0 ? (
            <p className="py-4 text-sm text-[var(--muted)]">
              Nothing on the calendar and nothing to work on.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--hairline)]">
              {timeline.map((item) => {
                const past = item.end < now;
                return (
                  <li key={item.id} className={`flex gap-4 py-3 ${past ? "opacity-40" : ""}`}>
                    <span className="num w-16 shrink-0 pt-0.5 text-xs text-[var(--muted)]">
                      {fmtTime(item.at)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        {/* Work is yours, meetings are owed to someone else.
                            The outline says which without a legend. */}
                        <span
                          aria-hidden
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            item.kind === "meeting"
                              ? "bg-[var(--ink)]"
                              : "border border-dashed border-[var(--muted)]"
                          }`}
                        />
                        <span className="truncate">{item.title}</span>
                      </p>
                      <p className="num mt-0.5 pl-4 text-xs text-[var(--muted)]">
                        {duration(item.end - item.at)}
                        {item.note && ` · ${item.note}`}
                      </p>
                    </div>
                    {item.kind === "work" && !past && (
                      <button
                        onClick={() => onFocus(item.task)}
                        className="shrink-0 self-center rounded-full border border-[var(--line)] px-3 py-1
                                   text-[11px] transition-colors hover:border-[var(--ink)]"
                      >
                        Focus
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="label">On your plate</h2>
            {focusedToday > 0 && (
              <span className="num text-xs text-[var(--muted)]">{duration(focusedToday)} focused</span>
            )}
          </div>

          {blocks.length === 0 && unestimated.length === 0 ? (
            <p className="py-4 text-sm text-[var(--muted)]">
              Nothing scheduled for today. Add work with a deadline and an estimate, and it
              lays itself out.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--hairline)]">
              {[...new Map(blocks.map((b) => [b.taskId, b.task])).values()].map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  project={state.projects.find((p) => p.id === t.projectId)}
                  showProject
                  onToggle={() => toggleTask(t.id)}
                  onFocus={() => onFocus(t)}
                />
              ))}
            </ul>
          )}

          {unestimated.length > 0 && <NoEstimate list={unestimated} />}
        </section>
      </div>
    </div>
  );
}

/**
 * What does not fit, and what would make it.
 *
 * The gap alone is a complaint. The gap with the arithmetic beside it — two
 * more hours a day, or a deadline of Tuesday — is a decision that can be made
 * this morning, while there is still time for it to matter.
 */
function Shortfalls({ list, tasks }) {
  const total = list.reduce((n, s) => n + s.shortMins, 0);
  return (
    <div className="mb-8 overflow-hidden rounded-lg border" style={{ borderColor: "var(--alert)" }}>
      <div className="flex items-baseline justify-between gap-4 px-5 py-3"
           style={{ background: "var(--alert-bg)", color: "var(--alert)" }}>
        <p className="text-sm font-medium">
          {list.length === 1 ? "One task does not fit" : `${list.length} tasks do not fit`}
        </p>
        <span className="num text-xs">{sayMins(total)} short in total</span>
      </div>
      <ul className="divide-y divide-[var(--hairline)]">
        {list.map((s) => {
          const task = tasks.find((t) => t.id === s.taskId);
          return (
            <li key={s.taskId} className="px-5 py-3">
              <p className="text-sm font-medium">{task?.title || s.title}</p>
              <p className="num mt-1 text-xs text-[var(--muted)]">
                {sayMins(s.needMins)} of work,{" "}
                {s.availableMins > 0 ? `${sayMins(s.availableMins)} fits` : "none of it fits"} before{" "}
                {s.due || "the deadline"} — <span style={{ color: "var(--alert)" }}>{sayMins(s.shortMins)} short</span>
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {[
                  // Only offered when a person could actually do it. "Ten more
                  // hours a day" is arithmetic, not an option.
                  s.catchUpIsPossible && s.extraPerDayMins
                    ? `${sayMins(s.extraPerDayMins)} more a day would close it`
                    : null,
                  s.fitsBy && s.fitsBy !== s.due ? `it fits by ${s.fitsBy}` : null,
                  "or cut the scope",
                ].filter(Boolean).join(", ")}.
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Work with no duration on it.
 *
 * These used to vanish: the planner needs minutes and quietly skipped anything
 * that had none, so a week could look comfortable while a third of the work
 * had never been counted. Silence was the worst available answer.
 */
function NoEstimate({ list }) {
  return (
    <div className="mt-5 rounded-md border border-dashed border-[var(--line)] p-4">
      <p className="label mb-1">Needs an estimate</p>
      <p className="mb-3 text-xs leading-relaxed text-[var(--muted)]">
        I can't fit what I can't measure, so {list.length === 1 ? "this is" : "these are"} sitting
        outside the plan. Tell me how long — “the lease is about 45 minutes”.
      </p>
      <ul className="space-y-1">
        {list.slice(0, 5).map((t) => (
          <li key={t.id} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{t.title}</span>
            {t.due && <span className="num shrink-0 text-xs text-[var(--muted)]">due {t.due}</span>}
          </li>
        ))}
        {list.length > 5 && (
          <li className="text-xs text-[var(--faint)]">+{list.length - 5} more</li>
        )}
      </ul>
    </div>
  );
}

function Stat({ label, value, sub, alert }) {
  return (
    <div className="bg-[var(--paper)] px-4 py-3">
      <p className="label">{label}</p>
      <p
        className="num mt-1 text-xl font-semibold tracking-tight"
        style={alert ? { color: "var(--alert)" } : undefined}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-[var(--faint)]">{sub}</p>
    </div>
  );
}
