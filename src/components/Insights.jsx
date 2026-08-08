import { dayKey } from "../lib/store";
import { duration, money } from "../lib/format";

const DAYS_BACK = 14;

export default function Insights({ state }) {
  const { sessions, tasks, projects, events } = state;

  const days = Array.from({ length: DAYS_BACK }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (DAYS_BACK - 1 - i));
    return d;
  });

  const focusByDay = days.map((d) => {
    const k = dayKey(d);
    return {
      date: d,
      key: k,
      ms: sessions.filter((s) => dayKey(new Date(s.endedAt)) === k).reduce((a, s) => a + s.focusedMs, 0),
      meetingMs: events
        .filter((e) => dayKey(new Date(e.start)) === k)
        .reduce((a, e) => a + (new Date(e.end) - new Date(e.start)), 0),
    };
  });

  const peakFocus = Math.max(1, ...focusByDay.map((d) => d.ms));
  const peakAny = Math.max(1, ...focusByDay.map((d) => Math.max(d.ms, d.meetingMs)));

  const byProject = projects
    .map((p) => ({
      project: p,
      ms: sessions.filter((s) => s.projectId === p.id).reduce((a, s) => a + s.focusedMs, 0),
      open: tasks.filter((t) => t.projectId === p.id && !t.done).length,
      done: tasks.filter((t) => t.projectId === p.id && t.done).length,
    }))
    .sort((a, b) => b.ms - a.ms);
  const peakProject = Math.max(1, ...byProject.map((p) => p.ms));

  const totalFocus = sessions.reduce((a, s) => a + s.focusedMs, 0);
  const totalMeeting = focusByDay.reduce((a, d) => a + d.meetingMs, 0);
  const completed = tasks.filter((t) => t.done).length;
  const delegated = tasks.filter((t) => t.delegatedTo && !t.done);
  // A session ended well short of its plan. Reported as a fact for tuning
  // estimates — never as a failure, and never with a target attached.
  const shortRuns = sessions.filter((s) => s.focusedMs < s.plannedMs * 0.5).length;

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8">
      <header className="mb-6">
        <p className="label">Last {DAYS_BACK} days</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Insights</h1>
      </header>

      <div className="mb-10 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--line)]
                      bg-[var(--line)] sm:grid-cols-4">
        <Stat label="Focused" value={duration(totalFocus)} sub={`${sessions.length} sessions`} />
        <Stat label="In meetings" value={duration(totalMeeting)} sub="scheduled time" />
        <Stat
          label="Focus ratio"
          value={
            totalFocus + totalMeeting > 0
              ? `${Math.round((totalFocus / (totalFocus + totalMeeting)) * 100)}%`
              : "—"
          }
          sub="deep work vs meetings"
        />
        <Stat label="Delegated" value={String(delegated.length)} sub="open, with someone else" />
      </div>

      <section className="mb-12">
        <h2 className="label mb-4">Focus vs meetings</h2>
        {/* Columns need an explicit full height: the row is `items-end`, so an
            auto-height column gives its percentage-sized children nothing to
            resolve against and the bars collapse to zero. Each bar caps at 48%
            so a stacked pair still fits the track. */}
        <div className="flex gap-1.5" style={{ height: 132 }}>
          {focusByDay.map((d) => (
            <div key={d.key} className="flex h-full flex-1 flex-col justify-end gap-0.5">
              <div
                title={`Meetings ${duration(d.meetingMs)}`}
                style={{ height: `${(d.meetingMs / peakAny) * 48}%` }}
                className="w-full rounded-t-sm bg-[var(--line)]"
              />
              <div
                title={`Focused ${duration(d.ms)}`}
                style={{ height: `${(d.ms / peakAny) * 48}%` }}
                className="w-full rounded-t-sm bg-[var(--ink)]"
              />
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-1.5">
          {focusByDay.map((d) => (
            <div key={d.key} className="flex-1 text-center text-[10px] tabular-nums text-[var(--faint)]">
              {d.date.getDate()}
            </div>
          ))}
        </div>
        <p className="mt-4 flex gap-4 text-[11px] text-[var(--muted)]">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-[var(--ink)]" /> Focused
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-[var(--line)]" /> Meetings
          </span>
          <span className="ml-auto tabular-nums">Peak day {duration(peakFocus)}</span>
        </p>
      </section>

      <section className="mb-12">
        <h2 className="label mb-4">Where the hours went</h2>
        {byProject.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No projects yet.</p>
        ) : (
          <ul className="space-y-3">
            {byProject.map(({ project, ms, open, done }) => (
              <li key={project.id}>
                <div className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="truncate font-medium">{project.name}</span>
                  <span className="shrink-0 tabular-nums text-[var(--muted)]">{duration(ms)}</span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--hairline)]">
                  <div className="h-full bg-[var(--ink)]" style={{ width: `${(ms / peakProject) * 100}%` }} />
                </div>
                <p className="mt-1 text-[11px] tabular-nums text-[var(--faint)]">
                  {done} done · {open} open
                  {project.value ? ` · ${money(project.value)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="label mb-4">Signals</h2>
        <dl className="divide-y divide-[var(--hairline)] text-sm">
          <Row term="Tasks completed" value={String(completed)} />
          <Row
            term="Average session"
            value={sessions.length ? duration(totalFocus / sessions.length) : "—"}
          />
          <Row
            term="Sessions cut short"
            value={`${shortRuns}`}
            note="ended under half the planned time — usually a sign the estimate was wrong, not the day"
          />
          {delegated.length > 0 && (
            <Row
              term="Waiting on others"
              value={delegated.map((t) => t.delegatedTo).filter((v, i, a) => a.indexOf(v) === i).join(", ")}
            />
          )}
        </dl>
      </section>
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

function Row({ term, value, note }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-3">
      <div className="min-w-0">
        <dt>{term}</dt>
        {note && <p className="mt-0.5 text-[11px] text-[var(--faint)]">{note}</p>}
      </div>
      <dd className="shrink-0 tabular-nums text-[var(--muted)]">{value}</dd>
    </div>
  );
}
