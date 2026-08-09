import { findFreeSlots, fmtTime, workOn } from "../lib/agenda";
import { dayKey, toggleTask, eventsOn } from "../lib/store";
import { planOpts, sayMins } from "../lib/hours";
import { projectLoad } from "../lib/schedule";
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
export default function Today({ state, onFocus, onNewEvent, onOpenEvent }) {
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

  /**
   * The room between the commitments, which is the part of a day people
   * actually make decisions about.
   *
   * A list of two meetings says almost nothing: the useful fact is that there
   * are five clear hours between them. Measured against planned work as well
   * as meetings, or it would offer time the planner has already spent — and
   * half-hours and under are left out, because a gap you cannot do anything
   * with is not worth a row.
   */
  const gaps = findFreeSlots(
    day,
    [...state.events, ...blocks.filter((b) => b.start).map((b) => ({ start: b.start, end: b.end }))],
    { start: work.workStart, end: work.workEnd, breaks: work.breaks, after: now, minMins: 45 },
  );
  const meetingMins = events.reduce((s, e) => s + (new Date(e.end) - new Date(e.start)) / 60000, 0);
  const focusedToday = state.sessions
    .filter((s) => dayKey(new Date(s.endedAt)) === day)
    .reduce((sum, s) => sum + s.focusedMs, 0);
  const overdue = state.tasks.filter((t) => !t.done && t.due && t.due < day);
  const next = events.find((e) => new Date(e.end) > now);

  // What is actually on this person today, rather than only what the planner
  // laid out. Those are not the same thing and treating them as the same hid
  // the most important row on the screen: on a day the planner skips — a
  // weekend, a day off, a day with no estimates — an overdue task disappeared
  // from the one place that exists to say what needs doing, while the tile
  // directly above it counted it.
  const plannedTasks = [...new Map(blocks.map((b) => [b.taskId, b.task])).values()];
  const dueToday = state.tasks.filter(
    (t) => !t.done && !t.delegatedTo && t.due === day && !plannedTasks.some((x) => x.id === t.id),
  );
  const waiting = state.tasks.filter((t) => !t.done && t.delegatedTo);

  // One list, in the order a person would triage it. Deduplicated, because a
  // task that is overdue *and* planned should appear once, at its worst.
  // How each live project is actually going, for the third column.
  const liveProjects = (state.projects || [])
    .filter((x) => !x.archived)
    .map((project) => ({
      project,
      load: projectLoad(project, state.tasks, state.sessions, state.events, { now }),
    }))
    .filter(({ load }) => load.openCount > 0)
    .sort((a, b) => (a.load.due || "9999").localeCompare(b.load.due || "9999"));

  const seen = new Set();
  const plate = [
    ...overdue.map((task) => ({ task, why: "overdue" })),
    ...dueToday.map((task) => ({ task, why: "today" })),
    ...plannedTasks.map((task) => ({ task, why: "planned" })),
  ].filter(({ task }) => (seen.has(task.id) ? false : seen.add(task.id)));

  /**
   * The next thing, for a day with nothing on it.
   *
   * "Nothing on the calendar and nothing to work on" is true and useless — the
   * same sentence on a genuinely free Tuesday as on the first morning of a new
   * account, and in both cases what a person wants is what *is* coming. It
   * matters most on day one: somebody who has just watched her book a meeting
   * for Thursday should not then land on a screen telling them there is
   * nothing.
   */
  const upcoming =
    [
      ...state.events
        .filter((e) => new Date(e.start) > now)
        .map((e) => ({ at: new Date(e.start), title: e.title, kind: "meeting" })),
      ...state.tasks
        .filter((t) => !t.done && !t.delegatedTo && t.due && t.due > day)
        .map((t) => ({ at: new Date(`${t.due}T23:59:59`), title: t.title, kind: "due" })),
    ].sort((a, b) => a.at - b.at)[0] ?? null;

  // Meetings and planned work in one column, in the order they happen. Two
  // lists side by side made the day look emptier than it is and hid every
  // collision between the two kinds of commitment.
  const timeline = [
    ...events.map((e) => ({
      kind: "meeting", at: new Date(e.start), end: new Date(e.end), title: e.title, event: e,
      note: e.location || "", id: e.id,
    })),
    ...blocks.filter((b) => b.start).map((b) => ({
      kind: "work", at: new Date(b.start), end: new Date(b.end), title: b.task.title,
      note: b.task.due ? `due ${b.task.due}` : "", id: `${b.taskId}-${b.start}`, task: b.task,
    })),
    ...gaps.map((g) => ({
      kind: "gap", at: g.start, end: g.end, mins: g.mins, id: `gap-${g.start.getTime()}`,
    })),
  ].sort((a, b) => a.at - b.at);

  // The gaps are context, not commitments — a day of nothing but free time is
  // still an empty day and should say so rather than list its own emptiness.
  const committed = timeline.filter((x) => x.kind !== "gap");

  return (
    /* Fills the frame rather than floating at the top of it. On a desktop this
       screen was about 500px of content in a 1050px window, and because the
       page and the panels were both white the remaining half read as a page
       that had failed to load rather than as a quiet day. The ground is
       `--sunken` now and the columns below are cards on it, so the space
       between them is canvas and the space inside them belongs to something. */
    <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col px-5 py-7 sm:px-6 sm:py-8">
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

      {/* `items-start` rather than stretch. Making three panels fill a tall
          window drew a large box around each piece of emptiness, which is a
          worse answer than the emptiness was — the page ground carries the
          space now, and each card is only as tall as it has something to say. */}
      <div className="grid flex-1 items-start gap-4 lg:grid-cols-2 xl:grid-cols-[1.15fr_1fr_0.8fr]">
        <section className="card flex flex-col px-5 py-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="label">The day</h2>
            {committed.length > 0 && (
              <span className="num text-xs text-[var(--muted)]">
                {duration((meetingMins + plannedMins) * 60000)} committed
              </span>
            )}
          </div>
          {committed.length === 0 ? (
            <div className="py-4">
              <p className="text-sm text-[var(--muted)]">
                Nothing on the calendar and nothing to work on.
              </p>
              {upcoming && (
                <p className="mt-2 text-sm text-[var(--muted)]">
                  Next up —{" "}
                  <span className="font-medium text-[var(--ink)]">{upcoming.title}</span>
                  {upcoming.kind === "due"
                    ? `, due ${sayWhen(upcoming.at, now)}.`
                    : `, ${sayWhen(upcoming.at, now)} at ${fmtTime(upcoming.at)}.`}
                </p>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-[var(--hairline)]">
              {timeline.map((item) => {
                const past = item.end < now;
                // The room between the commitments. Drawn as a rule with the
                // length written on it rather than as another row, so it reads
                // as the space it is instead of a third kind of appointment.
                if (item.kind === "gap") {
                  return (
                    <li key={item.id} className="flex items-center gap-3 py-2.5 pl-16">
                      <span aria-hidden className="h-px flex-1 bg-[var(--hairline)]" />
                      <span className="num shrink-0 text-[11px] text-[var(--faint)]">
                        {duration(item.mins * 60000)} free
                      </span>
                      <span aria-hidden className="h-px flex-1 bg-[var(--hairline)]" />
                    </li>
                  );
                }
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
                    {/* Meetings open where they can be changed. The timeline
                        is where anyone looks when a meeting moves, so it is
                        where the edit belongs. */}
                    {item.kind === "meeting" && onOpenEvent && (
                      <button
                        onClick={() => onOpenEvent(item.event)}
                        className="shrink-0 self-center rounded-full border border-[var(--line)] px-3 py-1
                                   text-[11px] text-[var(--muted)] transition-colors
                                   hover:border-[var(--ink)] hover:text-[var(--ink)]"
                      >
                        Edit
                      </button>
                    )}
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

        <section className="card flex flex-col px-5 py-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="label">On your plate</h2>
            {focusedToday > 0 && (
              <span className="num text-xs text-[var(--muted)]">{duration(focusedToday)} focused</span>
            )}
          </div>

          {plate.length === 0 && unestimated.length === 0 && waiting.length === 0 ? (
            <p className="py-4 text-sm text-[var(--muted)]">
              Nothing due and nothing planned. Add work with a deadline and an estimate,
              and it lays itself out.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--hairline)]">
              {plate.map(({ task, why }) => (
                <li key={task.id} className="relative">
                  {/* The reason it is here, said once and quietly. Without it a
                      list of five tasks is five equal things, and the overdue
                      one reads the same as the one merely planned. */}
                  {why !== "planned" && (
                    <span
                      className={`absolute right-0 top-3 text-[10px] font-semibold uppercase tracking-wider ${
                        why === "overdue" ? "alert" : "text-[var(--faint)]"
                      }`}
                    >
                      {why === "overdue" ? "Overdue" : "Due today"}
                    </span>
                  )}
                  <TaskRow
                    task={task}
                    project={state.projects.find((x) => x.id === task.projectId)}
                    showProject
                    onToggle={() => toggleTask(task.id)}
                    onFocus={() => onFocus(task)}
                  />
                </li>
              ))}
            </ul>
          )}

          {unestimated.length > 0 && <NoEstimate list={unestimated} />}

        </section>

        {/* The third column is what is true about the week rather than about
            this hour: work that is somebody else's move, and how each project
            is actually going. Both were visible nowhere on the screen people
            open every morning. */}
        <section className="card flex flex-col px-5 py-4 lg:col-span-2 xl:col-span-1">
          {waiting.length > 0 && (
            <div className="mb-8">
              <h2 className="label mb-3">Waiting on</h2>
              <ul className="divide-y divide-[var(--hairline)]">
                {waiting.slice(0, 6).map((task) => (
                  <li key={task.id} className="flex items-baseline justify-between gap-3 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--muted)]">
                      {task.title}
                    </span>
                    <span className="shrink-0 text-xs font-medium">{task.delegatedTo}</span>
                  </li>
                ))}
                {waiting.length > 6 && (
                  <li className="pt-2 text-xs text-[var(--faint)]">+{waiting.length - 6} more</li>
                )}
              </ul>
            </div>
          )}

          {liveProjects.length > 0 && (
            <div>
              <h2 className="label mb-3">Projects</h2>
              <ul className="flex flex-col gap-3">
                {liveProjects.slice(0, 5).map(({ project, load }) => (
                  <li key={project.id} className="card px-4 py-3">
                    <p className="truncate text-sm font-medium">{project.name}</p>
                    <p className="num mt-1 text-xs text-[var(--muted)]">
                      {load.openCount} open · {sayMins(load.remainingMins)} left
                    </p>
                    {/* A bar rather than a percentage. "62%" of a project is a
                        number nobody can act on; a bar that is nearly full is
                        read without being calculated. */}
                    <span className="mt-2 block h-1 w-full overflow-hidden rounded-full bg-[var(--line)]">
                      <span
                        className="block h-full rounded-full bg-[var(--ink)]"
                        style={{
                          width: `${Math.round(
                            (load.doneCount / Math.max(1, load.doneCount + load.openCount)) * 100,
                          )}%`,
                        }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
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

/**
 * When something is, said the way a person would say it.
 *
 * Near days get words and far ones get a date: "in 47 days" is arithmetic
 * nobody asked for, and "tomorrow" is the answer to a question "Aug 14" only
 * implies.
 */
function sayWhen(at, now) {
  const days = Math.round(
    (new Date(at.getFullYear(), at.getMonth(), at.getDate()) -
      new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000,
  );
  if (days <= 0) return "later today";
  if (days === 1) return "tomorrow";
  if (days <= 6) return at.toLocaleDateString([], { weekday: "long" });
  return at.toLocaleDateString([], { month: "short", day: "numeric" });
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
