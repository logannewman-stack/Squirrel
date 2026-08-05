import { useState } from "react";
import { planDay, todaysPlan, findFreeSlots, fmtTime, MAX_DAILY_TASKS } from "../lib/agenda";
import { dayKey, toggleTask, applyPlan, eventsOn } from "../lib/store";
import { planOpts } from "../lib/hours";
import { duration } from "../lib/format";
import TaskRow from "./TaskRow";

export default function Today({ state, onFocus, onNewEvent }) {
  const [planned, setPlanned] = useState(false);
  const day = dayKey();
  const events = eventsOn(day, state.events);
  const pinned = todaysPlan(state.tasks, day);
  // The same working day the assistant and the planner use.
  const work = planOpts(state.settings);
  const plan = planDay(state.tasks, state.events, { ...work, day });
  const list = pinned.length ? pinned : plan.tasks;

  const free = findFreeSlots(day, state.events, {
    start: work.workStart, end: work.workEnd, breaks: work.breaks,
  }).reduce((s, x) => s + x.mins, 0);
  const meetingMins = events.reduce((s, e) => s + (new Date(e.end) - new Date(e.start)) / 60000, 0);
  const focusedToday = state.sessions
    .filter((s) => dayKey(new Date(s.endedAt)) === day)
    .reduce((sum, s) => sum + s.focusedMs, 0);
  const overdue = state.tasks.filter((t) => !t.done && t.due && t.due < day);

  const now = new Date();
  const next = events.find((e) => new Date(e.end) > now);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="label">
            {now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Today</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onNewEvent}
            className="rounded-md border border-[var(--line)] px-3.5 py-2 text-xs
                       transition-colors hover:border-[var(--ink)]"
          >
            New event
          </button>
          <button
            onClick={() => {
              applyPlan(plan.tasks.map((t) => t.id), day);
              setPlanned(true);
            }}
            className="rounded-md bg-[var(--ink)] px-4 py-2 text-xs font-medium text-[var(--paper)]"
          >
            Plan day
          </button>
        </div>
      </header>

      <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--line)]
                      bg-[var(--line)] sm:grid-cols-4">
        <Stat label="In meetings" value={duration(meetingMins * 60000)} sub={`${events.length} ${events.length === 1 ? "meeting" : "meetings"}`} />
        <Stat label="Open time" value={duration(free * 60000)} sub="inside work hours" />
        <Stat label="Focused" value={duration(focusedToday)} sub={(() => {
          const n = state.sessions.filter((s) => dayKey(new Date(s.endedAt)) === day).length;
          return `${n} ${n === 1 ? "session" : "sessions"}`;
        })()} />
        <Stat label="Overdue" value={String(overdue.length)} sub={overdue.length ? "needs a decision" : "nothing late"} />
      </div>

      {next && (
        <div className="mb-8 flex items-center justify-between rounded-lg border border-[var(--ink)] px-5 py-4">
          <div className="min-w-0">
            <p className="label">Next</p>
            <p className="mt-1 truncate font-medium">{next.title}</p>
            <p className="mt-0.5 text-xs tabular-nums text-[var(--muted)]">
              {fmtTime(next.start)} – {fmtTime(next.end)}
              {next.location && ` · ${next.location}`}
            </p>
          </div>
          <span className="shrink-0 text-sm tabular-nums text-[var(--muted)]">
            {new Date(next.start) > now
              ? `in ${duration(new Date(next.start) - now)}`
              : "now"}
          </span>
        </div>
      )}

      <div className="grid gap-10 md:grid-cols-[1fr_1fr]">
        <section>
          <h2 className="label mb-3">Schedule</h2>
          {events.length === 0 ? (
            <p className="py-4 text-sm text-[var(--muted)]">Nothing on the calendar.</p>
          ) : (
            <ul className="divide-y divide-[var(--hairline)]">
              {events.map((e) => {
                const past = new Date(e.end) < now;
                return (
                  <li key={e.id} className={`flex gap-4 py-3 ${past ? "opacity-40" : ""}`}>
                    <span className="w-16 shrink-0 pt-0.5 text-xs tabular-nums text-[var(--muted)]">
                      {fmtTime(e.start)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{e.title}</p>
                      <p className="mt-0.5 text-xs tabular-nums text-[var(--muted)]">
                        {duration(new Date(e.end) - new Date(e.start))}
                        {e.location && ` · ${e.location}`}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="label">Priorities</h2>
            {list.length > 0 && (
              <span className="text-xs tabular-nums text-[var(--muted)]">
                {duration(list.reduce((s, t) => s + t.estimateMins, 0) * 60000)}
              </span>
            )}
          </div>

          {list.length === 0 ? (
            <p className="py-4 text-sm text-[var(--muted)]">
              No open tasks. Add work to a project, then plan the day.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--hairline)]">
              {list.map((t) => (
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

          {planned && plan.blocks.length > 0 && (
            <div className="mt-5 rounded-md border border-[var(--line)] p-4">
              <p className="label mb-2">Where it fits</p>
              <ul className="space-y-1.5">
                {plan.blocks.map((b) => (
                  <li key={b.task.id} className="flex gap-3 text-xs">
                    <span className="w-24 shrink-0 tabular-nums text-[var(--muted)]">
                      {fmtTime(b.start)}–{fmtTime(b.end)}
                    </span>
                    <span className="truncate">{b.task.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {list.length >= MAX_DAILY_TASKS && (
            <p className="mt-4 text-xs text-[var(--muted)]">
              Capped at {MAX_DAILY_TASKS}. The rest stay in their projects — a day you can
              finish beats a list you abandon.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="bg-[var(--paper)] px-4 py-3">
      <p className="label">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="mt-0.5 text-[11px] text-[var(--faint)]">{sub}</p>
    </div>
  );
}
