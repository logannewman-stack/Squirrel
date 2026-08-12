import { useState } from "react";
import { findFreeSlots, fmtTime, workOn } from "../lib/agenda";
import { dayKey, toggleTask, updateTask, eventsOn, activeTasks } from "../lib/store";
import { planOpts, sayMins } from "../lib/hours";
import { projectLoad } from "../lib/schedule";
import { whenTask } from "../lib/when";
import { whenLabel } from "../lib/search";
import { duration } from "../lib/format";
import TaskRow from "./TaskRow";
import Review from "./Review";
import { shouldReview } from "../lib/review";
import { Find } from "./ui";

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
export default function Today({ state, onFocus, onNewEvent, onOpenEvent, onSearch, onOpenUnfiled }) {
  const [projectsAll, setProjectsAll] = useState(false);
  const day = dayKey();
  const now = new Date();
  const events = eventsOn(day, state.events);
  const work = planOpts(state.settings);

  const blocks = workOn(state.blocks, state.tasks, day);
  const plannedMins = blocks.reduce((n, b) => n + b.mins, 0);
  const shortfalls = state.shortfalls || [];
  // Estimate used up, still open. See the Spent panel below for why this is
  // its own bucket rather than something the planner can decide.
  const spent = state.spent || [];
  // Parked work does not nag: an archived project's tasks are out of the plan
  // (see activeTasks), so the side panels read the same filtered world.
  const live = activeTasks(state);
  const unestimated = live.filter(
    (t) => !t.done && !t.delegatedTo && !(t.estimateMins > 0),
  );

  /**
   * Room the day genuinely still has: after meetings AND after the work the
   * planner has already booked into it. Measured against meetings alone, the
   * tile read "4h 30m left in the day" on a day the header called fully
   * committed — the same 4h30m the "Work planned" tile beside it was counting.
   * Two tiles double-counting the same minutes is a dashboard arguing with
   * itself.
   */
  const free = findFreeSlots(day, [
    ...state.events,
    ...(state.blocks || []).filter((b) => b.day === day && b.start).map((b) => ({ start: b.start, end: b.end })),
  ], {
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
  const overdue = live.filter((t) => !t.done && t.due && t.due < day);
  const next = events.find((e) => new Date(e.end) > now);

  // What is actually on this person today, rather than only what the planner
  // laid out. Those are not the same thing and treating them as the same hid
  // the most important row on the screen: on a day the planner skips — a
  // weekend, a day off, a day with no estimates — an overdue task disappeared
  // from the one place that exists to say what needs doing, while the tile
  // directly above it counted it.
  const plannedTasks = [...new Map(blocks.map((b) => [b.taskId, b.task])).values()];
  const dueToday = live.filter(
    (t) => !t.done && !t.delegatedTo && t.due === day && !plannedTasks.some((x) => x.id === t.id),
  );
  const waiting = live.filter((t) => !t.done && t.delegatedTo);

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
   * The first thing booked after today.
   *
   * An empty plate is not the same as an empty plan, and this screen used to
   * report both with "Nothing due and nothing planned. Add work with a
   * deadline and an estimate, and it lays itself out." Add work at six in the
   * evening — a deadline, an estimate, exactly as instructed — and the planner
   * books it for tomorrow morning, correctly, and then that sentence appears:
   * the app telling somebody to do the thing they have just done, on the
   * screen that exists to show them it worked.
   */
  const ahead = (state.blocks || [])
    .filter((b) => b.day > day)
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))[0];
  const aheadTask = ahead && state.tasks.find((t) => t.id === ahead.taskId);
  const aheadWhen = aheadTask && whenTask(aheadTask, state, { now });

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
      // "due 2026-08-18" was the only date on this screen written as the store
      // holds it rather than as anybody says it, sitting two inches from a row
      // reading "Aug 19". A pinned task says so — the one row the router
      // didn't choose deserves to explain itself.
      note: [
        b.task.pinDay === day ? "pinned" : null,
        b.task.due ? `due ${whenLabel(b.task.due, now)}` : null,
      ].filter(Boolean).join(" · "),
      id: `${b.taskId}-${b.start}`, task: b.task,
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
      <header className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          {/* One line each, whatever the width: the date truncates before it
              wraps, and a two-word button never breaks mid-word. "WEDNESDAY,
              AUGUST / 12" over two lines read like a layout accident on the
              first screen of every phone morning. */}
          <p className="label truncate">
            {now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Today</h1>
        </div>
        {/* The bar drops to its own full row on a phone — iOS's search-under-
            large-title — and rides beside "New event" where there is room. */}
        <Find onOpen={onSearch} className="order-last sm:order-none sm:ml-auto" />
        <button
          onClick={onNewEvent}
          className="shrink-0 whitespace-nowrap rounded-md border border-[var(--line)] px-3.5 py-2
                     text-xs transition-colors hover:border-[var(--ink)]"
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
      {/* The one moment the app speaks first, on a screen already open, once
          the working day is over — and once. */}
      {shouldReview(state, now) && <Review state={state} onDone={() => {}} />}

      {/* min-w-0 on every column: a grid item's default min-width is `auto`,
          which lets one long task title push the track — and the whole phone
          screen — 216px past the right edge. The truncation inside the rows
          only works once the column itself is allowed to shrink. */}
      <div className="grid min-w-0 flex-1 items-start gap-4 lg:grid-cols-2 xl:grid-cols-[1.15fr_1fr_0.8fr]">
        <section className="card flex min-w-0 flex-col px-5 py-4">
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

        <section className="card flex min-w-0 flex-col px-5 py-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="label">On your plate</h2>
            {focusedToday > 0 && (
              <span className="num text-xs text-[var(--muted)]">{duration(focusedToday)} focused</span>
            )}
          </div>

          {plate.length === 0 && unestimated.length === 0 && waiting.length === 0 && spent.length === 0 ? (
            <p className="py-4 text-sm text-[var(--muted)]">
              {aheadWhen ? (
                <>
                  Nothing left today. Next is{" "}
                  <span className="text-[var(--ink)]">{aheadTask.title}</span> — {aheadWhen.long}
                </>
              ) : (
                <>
                  Nothing due and nothing planned. Add work with a deadline and an estimate,
                  and it lays itself out.
                </>
              )}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--hairline)]">
              {plate.map(({ task, why }) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  project={state.projects.find((x) => x.id === task.projectId)}
                  when={whenTask(task, state, { now })}
                  showProject
                  onToggle={() => toggleTask(task.id)}
                  onFocus={() => onFocus(task)}
                  /* The reason it is here, said once and quietly. Without it a
                     list of five tasks is five equal things, and the overdue
                     one reads the same as the one merely planned. */
                  note={why !== "planned" && (
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-wider ${
                        why === "overdue" ? "alert" : "text-[var(--faint)]"
                      }`}
                    >
                      {why === "overdue" ? "Overdue" : "Due today"}
                    </span>
                  )}
                />
              ))}
            </ul>
          )}

          {spent.length > 0 && <Spent list={spent} tasks={state.tasks} onFocus={onFocus} />}
          {unestimated.length > 0 && <NoEstimate list={unestimated} />}

        </section>

        {/* The third column is what is true about the week rather than about
            this hour: work that is somebody else's move, and how each project
            is actually going. Both were visible nowhere on the screen people
            open every morning. */}
        <section className="card flex min-w-0 flex-col px-5 py-4 lg:col-span-2 xl:col-span-1">
          {waiting.length > 0 && (
            <div className="mb-8">
              <h2 className="label mb-3">Waiting on</h2>
              <ul className="divide-y divide-[var(--hairline)]">
                <WaitingRows waiting={waiting} />
              </ul>
            </div>
          )}

          {liveProjects.length > 0 && (
            <div>
              <h2 className="label mb-3">Projects</h2>
              <ul className="flex flex-col gap-3">
                {liveProjects.slice(0, projectsAll ? liveProjects.length : 5).map(({ project, load }) => (
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
                {/* The sixth project used to simply not exist here — a hard
                    cap with no indication anything was missing, on a column
                    whose job is the honest state of every live commitment. */}
                {!projectsAll && liveProjects.length > 5 && (
                  <li>
                    <button
                      onClick={() => setProjectsAll(true)}
                      className="text-xs text-[var(--muted)] underline-offset-4 hover:text-[var(--ink)] hover:underline"
                    >
                      +{liveProjects.length - 5} more
                    </button>
                  </li>
                )}
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
                {/* Store dates stay in the store. "2026-08-14" on the most
                    prominent card of the first screen, one row above a line
                    reading "tomorrow", is the app speaking two languages. */}
                {s.due ? whenLabel(s.due) : "the deadline"} — <span style={{ color: "var(--alert)" }}>{sayMins(s.shortMins)} short</span>
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {[
                  // Only offered when a person could actually do it. "Ten more
                  // hours a day" is arithmetic, not an option.
                  s.catchUpIsPossible && s.extraPerDayMins
                    ? `${sayMins(s.extraPerDayMins)} more a day would close it`
                    : null,
                  s.fitsBy && s.fitsBy !== s.due ? `it fits by ${whenLabel(s.fitsBy)}` : null,
                  "or cut the scope",
                ].filter(Boolean).join(", ")}.
              </p>
              {/* The advice is a button, not homework: the planner already
                  computed the date this fits by, so applying it is one tap —
                  undoable like every other change, and the plan reflows the
                  moment the deadline moves. */}
              {s.fitsBy && s.fitsBy !== s.due && (
                <button
                  onClick={() => updateTask(s.taskId, { due: s.fitsBy })}
                  className="mt-2 rounded-md border px-2.5 py-1 text-xs transition-colors"
                  style={{ borderColor: "var(--alert)", color: "var(--alert)" }}
                >
                  Move the deadline to {whenLabel(s.fitsBy)} — it fits
                </button>
              )}
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
/**
 * Work whose estimate is used up but which nobody ticked off.
 *
 * The app manufactures this state with its own core loop: start a focus
 * session, let the timer run out, forget the checkbox. The planner then has
 * nothing left to schedule, so the task fell out of the plan entirely — no
 * block, no shortfall, not even counted as needing an estimate — and Today
 * said "Nothing due and nothing planned" directly beneath a panel reading
 * "1h 2m focused". For an app whose feature is *starting* things, that is the
 * commonest way a session ends and the worst possible moment to lose the work.
 *
 * It is not a scheduling question, which is why the planner cannot answer it:
 * either the thing is finished, or it needed longer than expected. Both are one
 * tap, and neither is a guess the app is entitled to make on somebody's behalf.
 */
function Spent({ list, tasks, onFocus }) {
  return (
    <div className="mt-5 rounded-md border border-dashed border-[var(--line)] p-4">
      <p className="label mb-1">Time's up on {list.length === 1 ? "this" : "these"}</p>
      <p className="mb-3 text-xs leading-relaxed text-[var(--muted)]">
        You've spent the estimate and {list.length === 1 ? "it's" : "they're"} still open, so
        {list.length === 1 ? " it's" : " they're"} outside the plan. Finished, or did
        {list.length === 1 ? " it" : " they"} need longer?
      </p>
      <ul className="space-y-2">
        {list.map((x) => {
          const task = tasks.find((t) => t.id === x.taskId);
          return (
            <li key={x.taskId} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="min-w-0 flex-1 truncate text-sm">{x.title}</span>
              <span className="num shrink-0 text-xs text-[var(--muted)]">
                {duration(x.spentMins * 60000)} spent of {duration(x.estimateMins * 60000)}
              </span>
              <span className="flex shrink-0 gap-1.5">
                <button
                  onClick={() => toggleTask(x.taskId)}
                  className="rounded border border-[var(--line)] px-2 py-1 text-[11px]
                             transition-colors hover:border-[var(--ink)]"
                >
                  Finished
                </button>
                {task && (
                  <button
                    /**
                      * Grants what it says. This used to reopen the focus
                      * timer, which changed no estimate — so the task stayed
                      * outside the plan and the same question came back the
                      * next morning, a loop wearing the costume of an answer.
                      * Growing the estimate past what was spent is the actual
                      * answer, and the planner re-books it before the panel
                      * has closed.
                      */
                    onClick={() => updateTask(x.taskId, { estimateMins: x.spentMins + 30 })}
                    className="rounded border border-[var(--line)] px-2 py-1 text-[11px]
                               transition-colors hover:border-[var(--ink)]"
                  >
                    Needs 30m more
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Delegated work, capped at six with the rest a press away — in place.
 *
 * The "+N more" here used to open the Unfiled screen, whose own Waiting tab
 * read zero: all eight hidden rows were filed under projects, so the only way
 * in led to the one place they were not. A cap's affordance has to contain
 * the capped.
 */
function WaitingRows({ waiting }) {
  const [all, setAll] = useState(false);
  const shown = all ? waiting : waiting.slice(0, 6);
  return (
    <>
      {shown.map((task) => (
        <li key={task.id} className="flex items-baseline justify-between gap-3 py-2.5">
          <span className="min-w-0 flex-1 truncate text-sm text-[var(--muted)]">
            {task.title}
          </span>
          <span className="shrink-0 text-xs font-medium">{task.delegatedTo}</span>
        </li>
      ))}
      {!all && waiting.length > 6 && (
        <li className="pt-2">
          <button
            onClick={() => setAll(true)}
            className="text-xs text-[var(--muted)] underline-offset-4 hover:text-[var(--ink)] hover:underline"
          >
            +{waiting.length - 6} more
          </button>
        </li>
      )}
    </>
  );
}

function NoEstimate({ list }) {
  /**
   * "+N more" expands here, in place. It used to open the Unfiled screen —
   * a destination that contained none of the hidden rows, since work needing
   * an estimate is usually filed under a project already. A truncation's only
   * affordance pointing somewhere its items are not is worse than no
   * affordance: it teaches that the door lies.
   */
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, 5);
  return (
    <div className="mt-5 rounded-md border border-dashed border-[var(--line)] p-4">
      <p className="label mb-1">Needs an estimate</p>
      <p className="mb-3 text-xs leading-relaxed text-[var(--muted)]">
        I can't fit what I can't measure, so {list.length === 1 ? "this is" : "these are"} sitting
        outside the plan. Tell me how long — “the lease is about 45 minutes”.
      </p>
      <ul className="space-y-1">
        {shown.map((t) => (
          <li key={t.id} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{t.title}</span>
            {t.due && <span className="num shrink-0 text-xs text-[var(--muted)]">due {whenLabel(t.due)}</span>}
          </li>
        ))}
        {!all && list.length > 5 && (
          <li>
            <button
              onClick={() => setAll(true)}
              className="text-xs text-[var(--muted)] underline-offset-4 hover:text-[var(--ink)] hover:underline"
            >
              +{list.length - 5} more
            </button>
          </li>
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
