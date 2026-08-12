import { useEffect, useMemo, useState } from "react";
import { fmtTime, workOn } from "../lib/agenda";
import { dayKey, setSetting } from "../lib/store";
import { hoursOf, breaksOn, sayMins } from "../lib/hours";
import { UNFILED } from "./ProjectDetail";
import {
  SCALES, isScale, rangeOf, shiftBy, titleOf, subtitleOf,
  monthMatrix, monthsIn, loadIndex, loadOf,
} from "../lib/calendar";

const HOUR_PX = 52;

/**
 * The calendar, at five zoom levels.
 *
 * The scale picker is a segmented control rather than a dropdown for one
 * reason: switching zoom is the most frequent thing anyone does on a calendar,
 * and a dropdown costs two clicks and a menu every time. Five labels sitting
 * in the header cost one, and the keyboard shortcuts underneath cost none.
 */
export default function Calendar({ state, onNewEvent, onOpenEvent, onOpenProject }) {
  const stored = state.settings?.calendarScale;
  // Agenda by default: it is the one scale that is legible the instant the
  // calendar opens, on the screen most people open it on. A returning user's
  // chosen scale still wins.
  const [scale, setScale] = useState(isScale(stored) ? stored : "agenda");
  const [anchor, setAnchor] = useState(() => new Date());

  const hours = useMemo(() => hoursOf(state.settings), [state.settings]);
  const index = useMemo(
    () => loadIndex(state.events, state.blocks, state.tasks),
    [state.events, state.blocks, state.tasks],
  );

  const choose = (id) => {
    setScale(id);
    // Remembered, because the scale someone works at is a preference, not a
    // per-visit decision. Opening on Week when you live in Month is a small
    // insult repeated every single time.
    setSetting("calendarScale", id);
  };

  const go = (n) => setAnchor(shiftBy(scale, anchor, n));
  const zoomTo = (date, next) => {
    setAnchor(date);
    choose(next);
  };

  // ←/→ page, D W M Q Y jump, T returns to today. Typing in a field is
  // excluded, or every "w" in a meeting title would change the view.
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target;
      if (el?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el?.tagName)) return;
      if (e.key === "ArrowLeft") return go(-1);
      if (e.key === "ArrowRight") return go(1);
      if (e.key.toLowerCase() === "t") return setAnchor(new Date());
      const hit = SCALES.find((s) => s.key === e.key.toLowerCase());
      if (hit) {
        e.preventDefault();
        choose(hit.id);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
    // Re-bound when either changes: the handler pages relative to both, and a
    // stale closure would step from wherever the view was when it mounted.
  }, [scale, anchor]);

  const range = rangeOf(scale, anchor);
  const now = new Date();
  const showingNow = now >= range.from && now < range.to;

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-[var(--line)] px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">{titleOf(scale, anchor)}</h1>
            <p className="num mt-0.5 text-xs text-[var(--muted)]">
              {[
                subtitleOf(scale, anchor),
                `${countIn(state.events, range)} ${countIn(state.events, range) === 1 ? "meeting" : "meetings"}`,
                plannedIn(state.blocks, range) ? `${sayMins(plannedIn(state.blocks, range))} of work planned` : "",
              ].filter(Boolean).join(" · ")}
            </p>
          </div>

          <div className="flex items-center gap-1">
            <Arrow dir="prev" onClick={() => go(-1)} scale={scale} />
            <button
              onClick={() => setAnchor(new Date())}
              disabled={showingNow}
              className="rounded px-3 py-1.5 text-xs transition-colors enabled:hover:bg-[var(--hover)]
                         disabled:text-[var(--faint)]"
            >
              Today
            </button>
            <Arrow dir="next" onClick={() => go(1)} scale={scale} />
            <button
              onClick={onNewEvent}
              className="ml-2 rounded-md bg-[var(--ink)] px-3.5 py-1.5 text-xs font-medium text-[var(--paper)]"
            >
              New event
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-4">
          <ScalePicker value={scale} onChange={choose} />
          {(scale === "quarter" || scale === "year" || scale === "month") && <LoadKey />}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {scale === "agenda" ? (
          <AgendaList
            range={range}
            state={state}
            now={now}
            onOpenEvent={onOpenEvent}
            onNewEvent={onNewEvent}
            onOpenProject={onOpenProject}
          />
        ) : scale === "day" || scale === "week" ? (
          <TimeGrid
            days={daysOf(range)}
            state={state}
            hours={hours}
            now={now}
            single={scale === "day"}
            onOpenEvent={onOpenEvent}
          />
        ) : scale === "month" ? (
          <MonthGrid
            year={anchor.getFullYear()}
            month={anchor.getMonth()}
            state={state}
            hours={hours}
            index={index}
            onOpenDay={(d) => zoomTo(d, "day")}
          />
        ) : (
          <MonthsOverview
            months={monthsIn(scale, anchor)}
            index={index}
            hours={hours}
            compact={scale === "year"}
            onOpenDay={(d) => zoomTo(d, "day")}
            onOpenMonth={(d) => zoomTo(d, "month")}
          />
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- the picker */

/**
 * Five scales, one row, always visible.
 *
 * The sliding indicator is a transform on a single element rather than a class
 * on the active button — it makes the change of zoom feel like a movement
 * along one axis, which is what it is.
 */
function ScalePicker({ value, onChange }) {
  const i = SCALES.findIndex((s) => s.id === value);
  return (
    <div
      role="tablist"
      aria-label="Calendar range"
      className="relative flex rounded-lg bg-[var(--sunken)] p-0.5"
    >
      <span
        aria-hidden
        className="absolute inset-y-0.5 rounded-[6px] bg-[var(--paper)] shadow-[var(--lift)]
                   transition-transform duration-200 ease-out"
        style={{ width: `calc((100% - 4px) / ${SCALES.length})`, transform: `translateX(${i * 100}%)`, left: 2 }}
      />
      {SCALES.map((s) => (
        <button
          key={s.id}
          role="tab"
          aria-selected={s.id === value}
          onClick={() => onChange(s.id)}
          title={`${s.label} — press ${s.key.toUpperCase()}`}
          className={`relative z-10 flex-1 whitespace-nowrap rounded-[6px] px-2.5 py-1.5 text-xs
                      font-medium transition-colors sm:px-4 ${
                        s.id === value ? "text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]"
                      }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

const Arrow = ({ dir, onClick, scale }) => (
  <button
    onClick={onClick}
    aria-label={`${dir === "prev" ? "Previous" : "Next"} ${scale}`}
    className="rounded px-2 py-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--ink)]"
  >
    <svg viewBox="0 0 16 16" className="h-4 w-4 fill-none stroke-current stroke-[1.7]">
      <path d={dir === "prev" ? "M10 3L5 8l5 5" : "M6 3l5 5-5 5"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </button>
);

const LoadKey = () => (
  <div className="hidden items-center gap-1.5 text-[10px] text-[var(--faint)] sm:flex">
    <span>Open</span>
    {[0.08, 0.3, 0.55, 0.8, 1].map((r) => (
      <span key={r} className="h-2.5 w-2.5 rounded-[3px]" style={{ background: shade(r) }} />
    ))}
    <span>Full</span>
  </div>
);

/* ---------------------------------------------------------------- agenda */

/**
 * What's coming, as a list you can actually read on a phone.
 *
 * The week grid is seven columns, and seven columns on a 400-pixel screen
 * either overflow sideways — hiding half your week off the edge, which is how
 * you open the calendar and see nothing — or squeeze to a width no event title
 * survives. A schedule reads top to bottom instead: each day that has
 * something on it, its meetings and its planned work in order, and empty days
 * simply left out. It is the default because it is the one view that answers
 * "what's next" without a single sideways scroll.
 */
/**
 * One block of planned focus time on the agenda.
 *
 * Named rather than inlined because it now sits inside a ternary over the
 * merged day, and a thirty-line JSX branch inside a `.map` callback inside a
 * ternary is where this file would start becoming unreadable.
 */
function WorkRow({ block, state, onOpenProject }) {
  const task = state.tasks.find((t) => t.id === block.taskId);
  const project = state.projects.find((x) => x.id === task?.projectId);
  return (
    <li>
      <button
        onClick={() => onOpenProject?.(project?.id ?? UNFILED)}
        className="flex w-full items-baseline gap-3 rounded-lg px-2 py-2 text-left
                   transition-colors hover:bg-[var(--hairline)]"
      >
        <span className="num w-16 shrink-0 text-xs text-[var(--faint)]">
          {block.start ? fmtTime(block.start) : "\u2014"}
        </span>
        <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full border border-dashed border-[var(--muted)]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-[var(--muted)]">{task?.title || "Focus"}</span>
          <span className="mt-0.5 block truncate text-xs text-[var(--faint)]">
            {sayMins(block.mins)} of focus
            {/* Which deal this hour is actually for. A week of bare task
                titles hides the only grouping anybody reports on. */}
            {project ? ` \u00b7 ${project.name}` : ""}
          </span>
        </span>
      </button>
    </li>
  );
}

function AgendaList({ range, state, now, onOpenEvent, onNewEvent, onOpenProject }) {
  const today = dayKey(now);
  const from = range.from.getTime();
  const to = range.to.getTime();

  // One pass, grouped by day: meetings, planned focus work, and anything due.
  const days = useMemo(() => {
    const byDay = new Map();
    const bucket = (key) => {
      if (!byDay.has(key)) byDay.set(key, { key, events: [], work: [], due: [] });
      return byDay.get(key);
    };

    for (const e of state.events) {
      const at = new Date(e.start).getTime();
      if (at >= from && at < to) bucket(dayKey(new Date(e.start))).events.push(e);
    }
    // Planned work is time already spoken for, so it belongs on the schedule —
    // shown lighter than a meeting, the same as it is on the grid.
    const spanDays = Math.round((to - from) / 86400000);
    for (let i = 0; i < spanDays; i++) {
      const d = new Date(from);
      d.setDate(d.getDate() + i);
      const k = dayKey(d);
      const w = workOn(state.blocks, state.tasks, k);
      if (w.length) bucket(k).work.push(...w);
    }
    for (const t of state.tasks) {
      if (!t.done && t.due && t.due >= dayKey(new Date(from)) && t.due < dayKey(new Date(to))) {
        bucket(t.due).due.push(t);
      }
    }

    return [...byDay.values()]
      .filter((d) => d.events.length || d.work.length || d.due.length)
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((d) => {
        d.events.sort((a, b) => new Date(a.start) - new Date(b.start));
        d.work.sort((a, b) => new Date(a.start) - new Date(b.start));
        /**
         * Meetings and planned work in one column, in the order they happen.
         *
         * They were two lists rendered one after the other, each sorted only
         * within itself — so a day with a ten o'clock meeting and nine o'clock
         * focus work listed the meeting first. A day's agenda that is not in
         * time order is worse than no agenda: it is read top to bottom as a
         * sequence, and this one silently was not one.
         *
         * Blocks the planner could not give a clock time to sort last rather
         * than to NaN, which would have scattered them through the day.
         */
        d.timed = [
          ...d.events.map((e) => ({ kind: "event", at: new Date(e.start).getTime(), e })),
          ...d.work.map((b) => ({ kind: "work", at: b.start ? new Date(b.start).getTime() : Infinity, b })),
        ].sort((a, b) => a.at - b.at);
        return d;
      });
  }, [state.events, state.blocks, state.tasks, from, to]);

  if (!days.length) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-6 py-20 text-center">
        <p className="text-sm text-[var(--muted)]">Nothing scheduled in the next three weeks.</p>
        <button
          onClick={onNewEvent}
          className="mt-4 rounded-full border border-[var(--line)] px-5 py-2 text-sm
                     transition-colors hover:border-[var(--ink)]"
        >
          New event
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-8 sm:px-6">
      {days.map(({ key, timed, due }) => {
        const d = new Date(`${key}T00:00:00`);
        const isToday = key === today;
        const rel = relativeDay(d, now);

        return (
          <section key={key} className="border-b border-[var(--hairline)] py-4 last:border-0">
            {/* The date header is sticky so you always know which day you are
                looking at while the events scroll under it. */}
            <div className="sticky top-0 z-10 -mx-4 mb-2 flex items-baseline gap-2 bg-[var(--paper)]/95
                            px-4 py-1 backdrop-blur-sm sm:-mx-6 sm:px-6">
              <span
                className={`num grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm ${
                  isToday ? "bg-[var(--ink)] font-semibold text-[var(--paper)]" : "text-[var(--ink)]"
                }`}
              >
                {d.getDate()}
              </span>
              <span className="text-sm font-medium">{rel}</span>
              <span className="label">{d.toLocaleDateString([], { month: "short" })}</span>
              {due.length > 0 && (
                <span className="alert-chip ml-auto">{due.length} due</span>
              )}
            </div>

            <ul className="space-y-0.5">
              {timed.map((row) =>
                row.kind === "event" ? (
                  <li key={row.e.id}>
                    <button
                      onClick={() => onOpenEvent(row.e)}
                      className="row-hover flex w-full items-baseline gap-3 rounded-lg px-2 py-2 text-left"
                    >
                      <span className="num w-16 shrink-0 text-xs text-[var(--muted)]">{fmtTime(row.e.start)}</span>
                      <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ink)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{row.e.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">
                          {sayMins((new Date(row.e.end) - new Date(row.e.start)) / 60000)}
                          {row.e.attendees?.length ? ` \u00b7 ${row.e.attendees.map((a) => a.name).join(", ")}` : ""}
                          {row.e.location ? ` \u00b7 ${row.e.location}` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                ) : (
                  /**
                   * Planned work, which is now a way back to what it is for.
                   *
                   * These were inert `<div>`s: a browser walk found twenty
                   * elements mentioning the task and not one of them pressable.
                   * The calendar could say two hours of Thursday belong to
                   * "Draft the lease redlines" and had no way to say it belongs
                   * to the Munich lease, or to take you there — so the screen
                   * showing where the week went was the one you could not act
                   * from.
                   */
                  <WorkRow key={`${row.b.taskId}-${row.b.start}`} block={row.b} state={state}
                           onOpenProject={onOpenProject} />
                ),
              )}

              {/**
                * The deadlines the day was counted for.
                *
                * The chip above says "2 due" and the list under it drew only
                * meetings and planned work — so a day whose whole content is
                * deadlines rendered as a date, a red count, and blank space.
                * The app told you twice that something was due on Friday and
                * would not say what. Drawn last because a deadline is a fact
                * about the day rather than an appointment inside it, and given
                * no clock time for the same reason.
                */}
              {due.map((t) => (
                <li key={`due-${t.id}`}>
                  <div className="flex items-baseline gap-3 rounded-lg px-2 py-2">
                    <span className="num w-16 shrink-0 text-xs text-[var(--muted)]">due</span>
                    <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rotate-45 border border-[var(--alert)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{t.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-[var(--faint)]">
                        {t.estimateMins > 0
                          ? `${sayMins(t.estimateMins)} of work`
                          : "no estimate yet, so it isn't in the plan"}
                      </span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** "Today", "Tomorrow", then the weekday — the label people actually think in. */
function relativeDay(d, now) {
  const key = dayKey(d);
  const t = new Date(now);
  if (key === dayKey(t)) return "Today";
  t.setDate(t.getDate() + 1);
  if (key === dayKey(t)) return "Tomorrow";
  return d.toLocaleDateString([], { weekday: "long" });
}

/* ------------------------------------------------------------ day and week */

/**
 * The hour grid.
 *
 * The visible span starts from the user's working hours and then stretches to
 * cover anything outside them. The previous version clipped instead, so a 7am
 * flight or an 8pm dinner simply was not on the calendar — a meeting hidden by
 * the view is worse than no view.
 */
function TimeGrid({ days, state, hours, now, single, onOpenEvent }) {
  const keys = days.map(dayKey);
  const events = state.events.filter((e) => keys.includes(dayKey(new Date(e.start))));
  const blocks = (state.blocks || []).filter((b) => keys.includes(b.day) && b.start);

  let from = Math.floor(hours.start);
  let to = Math.ceil(hours.end);
  for (const e of [...events, ...blocks]) {
    const s = new Date(e.start);
    const en = new Date(e.end);
    from = Math.min(from, s.getHours());
    to = Math.max(to, en.getHours() + (en.getMinutes() ? 1 : 0));
  }
  to = Math.max(to, from + 1);

  const rows = Array.from({ length: to - from }, (_, i) => from + i);
  const y = (d) => (d.getHours() + d.getMinutes() / 60 - from) * HOUR_PX;
  const today = dayKey();
  const cols = single ? "grid-cols-[52px_1fr]" : "grid-cols-[52px_repeat(7,minmax(0,1fr))]";

  return (
    <div className={single ? "mx-auto max-w-3xl" : "min-w-[760px]"}>
      <div className={`sticky top-0 z-20 grid ${cols} border-b border-[var(--line)] bg-[var(--paper)]`}>
        <div />
        {days.map((d) => {
          const k = dayKey(d);
          const off = !hours.days.includes(d.getDay());
          return (
            <div key={k} className="border-l border-[var(--hairline)] px-2 py-2 text-center">
              <div className={`label ${off ? "opacity-50" : ""}`}>
                {d.toLocaleDateString([], { weekday: single ? "long" : "short" })}
              </div>
              <div className="mt-1 flex justify-center">
                <span
                  className={`num grid h-7 w-7 place-items-center rounded-full text-sm ${
                    k === today ? "bg-[var(--ink)] font-semibold text-[var(--paper)]" : off ? "text-[var(--faint)]" : ""
                  }`}
                >
                  {d.getDate()}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className={`relative grid ${cols} pt-3`}>
        <div>
          {rows.map((h) => (
            <div key={h} style={{ height: HOUR_PX }} className="relative">
              <span className="num absolute -top-1.5 right-2 text-[10px] text-[var(--faint)]">
                {h % 12 === 0 ? 12 : h % 12}
                {h < 12 ? "a" : "p"}
              </span>
            </div>
          ))}
        </div>

        {days.map((d) => {
          const k = dayKey(d);
          const off = !hours.days.includes(d.getDay());
          const evs = state.events
            .filter((e) => dayKey(new Date(e.start)) === k)
            .sort((a, b) => new Date(a.start) - new Date(b.start));
          const work = blocks.filter((b) => b.day === k);
          const rest = breaksOn(hours, d.getDay());

          return (
            <div key={k} className={`relative border-l border-[var(--hairline)] ${off ? "bg-[var(--sunken)]" : ""}`}>
              {rows.map((h) => (
                <div
                  key={h}
                  style={{ height: HOUR_PX }}
                  className={`border-b border-[var(--hairline)] ${
                    h < hours.start || h >= hours.end ? "bg-[var(--sunken)]" : ""
                  }`}
                />
              ))}

              {/* Standing commitments: the day's shape, behind everything. */}
              {rest.map((b) => (
                <div
                  key={b.id}
                  title={b.label}
                  style={{ top: (b.start - from) * HOUR_PX, height: (b.end - b.start) * HOUR_PX }}
                  className="pointer-events-none absolute inset-x-0 bg-[var(--hover)]"
                />
              ))}

              {/* Planned work — yours, so it is outlined rather than filled. */}
              {work.map((b) => {
                const s = new Date(b.start);
                const en = new Date(b.end);
                const task = state.tasks.find((t) => t.id === b.taskId);
                return (
                  <div
                    key={`${b.taskId}-${b.start}`}
                    title={`${task?.title || "Work"} · ${sayMins(b.mins)}`}
                    style={{ top: y(s), height: Math.max(6, y(en) - y(s) - 2) }}
                    className="pointer-events-none absolute inset-x-1 overflow-hidden rounded border border-dashed
                               border-[var(--muted)] px-1.5 text-[11px] leading-tight text-[var(--muted)]"
                  >
                    {/* Under twenty minutes there is no room for a name without
                        it colliding with the block below. The band still shows
                        the time is spoken for; the title lives in the tooltip. */}
                    {b.mins >= 20 && <span className="block truncate py-0.5">{task?.title || "Focus"}</span>}
                  </div>
                );
              })}

              {evs.map((e) => {
                const s = new Date(e.start);
                const en = new Date(e.end);
                return (
                  <button
                    key={e.id}
                    onClick={() => onOpenEvent(e)}
                    title={`${e.title} · ${fmtTime(e.start)}–${fmtTime(e.end)} — tap to edit`}
                    style={{ top: y(s), height: Math.max(20, y(en) - y(s) - 2) }}
                    className="absolute inset-x-1 overflow-hidden rounded border border-[var(--ink)]
                               bg-[var(--ink)] px-1.5 py-1 text-left text-[11px] leading-tight
                               text-[var(--paper)] transition-opacity hover:opacity-80"
                  >
                    <span className="block truncate font-medium">{e.title}</span>
                    <span className="num block truncate opacity-70">{fmtTime(e.start)}</span>
                  </button>
                );
              })}

              {k === today && now.getHours() >= from && now.getHours() < to && (
                <div
                  aria-hidden
                  style={{ top: y(now) }}
                  className="pointer-events-none absolute inset-x-0 z-10 border-t border-[var(--alert)]"
                >
                  <span className="absolute -left-1 -top-[3px] h-1.5 w-1.5 rounded-full bg-[var(--alert)]" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- a month */

function MonthGrid({ year, month, state, hours, index, onOpenDay }) {
  const cells = monthMatrix(year, month);
  const today = dayKey();

  return (
    <div className="grid h-full grid-rows-[auto_repeat(6,minmax(84px,1fr))]">
      <div className="grid grid-cols-7 border-b border-[var(--line)]">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="label px-2 py-2 text-center">{d}</div>
        ))}
      </div>

      {[0, 1, 2, 3, 4, 5].map((row) => (
        <div key={row} className="grid grid-cols-7">
          {cells.slice(row * 7, row * 7 + 7).map((d) => {
            const k = dayKey(d);
            const outside = d.getMonth() !== month;
            const load = loadOf(d, index, hours);
            const evs = state.events
              .filter((e) => dayKey(new Date(e.start)) === k)
              .sort((a, b) => new Date(a.start) - new Date(b.start));
            const due = index.due.get(k) || 0;

            return (
              <button
                key={k}
                onClick={() => onOpenDay(d)}
                className={`flex min-w-0 flex-col items-stretch gap-1 border-b border-l border-[var(--hairline)]
                            p-1.5 text-left transition-colors hover:bg-[var(--hover)] ${
                              outside ? "opacity-40" : load.off ? "bg-[var(--sunken)]" : ""
                            }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={`num grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] ${
                      k === today ? "bg-[var(--ink)] font-semibold text-[var(--paper)]" : "text-[var(--muted)]"
                    }`}
                  >
                    {d.getDate()}
                  </span>
                  {due > 0 && (
                    <span
                      title={`${due} due`}
                      className="num rounded-full bg-[var(--alert-bg)] px-1.5 text-[10px] font-medium text-[var(--alert)]"
                    >
                      {due}
                    </span>
                  )}
                </div>

                <div className="min-h-0 flex-1 space-y-0.5 overflow-hidden">
                  {evs.slice(0, 3).map((e) => (
                    <span key={e.id} className="flex items-center gap-1 text-[10px] leading-tight">
                      <span className="h-1 w-1 shrink-0 rounded-full bg-[var(--ink)]" />
                      <span className="num shrink-0 text-[var(--faint)]">{shortHour(e.start)}</span>
                      <span className="truncate">{e.title}</span>
                    </span>
                  ))}
                  {evs.length > 3 && (
                    <span className="block text-[10px] text-[var(--faint)]">+{evs.length - 3} more</span>
                  )}
                </div>

                {load.ratio > 0 && (
                  <span className="h-[3px] w-full overflow-hidden rounded-full bg-[var(--hairline)]">
                    <span className="block h-full rounded-full" style={{ width: `${load.ratio * 100}%`, background: shade(load.ratio) }} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------- quarter and year */

/**
 * Months as density.
 *
 * At three months and at twelve, no event title survives being drawn. What
 * does survive — and is the reason to look at a quarter at all — is where the
 * pressure is: which weeks are already committed, where the deadlines bunch
 * up, which fortnight still has room for the thing being planned.
 */
function MonthsOverview({ months, index, hours, compact, onOpenDay, onOpenMonth }) {
  const today = dayKey();
  const cell = compact ? "h-[13px] w-[13px]" : "h-5 w-5";

  return (
    <div
      className={`grid gap-x-8 gap-y-8 p-5 sm:p-6 ${
        compact
          ? "grid-cols-[repeat(auto-fill,minmax(150px,1fr))]"
          : "mx-auto w-full max-w-4xl grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
      }`}
    >
      {months.map(([year, month]) => {
        const first = new Date(year, month, 1);
        const cells = monthMatrix(year, month);
        const busy = cells
          .filter((d) => d.getMonth() === month)
          .reduce((n, d) => n + (index.meetings.get(dayKey(d)) || 0), 0);

        return (
          <section key={`${year}-${month}`}>
            <button
              onClick={() => onOpenMonth(first)}
              className="mb-1.5 flex w-full items-baseline justify-between gap-2 rounded px-0.5 text-left
                         transition-colors hover:text-[var(--ink)]"
            >
              <h2 className="text-sm font-medium">{first.toLocaleDateString([], { month: "long" })}</h2>
              {busy > 0 && <span className="num text-[10px] text-[var(--faint)]">{sayMins(busy)}</span>}
            </button>

            <div className="grid grid-cols-7 gap-[3px]">
              {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                <span key={i} className={`${cell} grid place-items-center text-[9px] text-[var(--faint)]`}>{d}</span>
              ))}
              {cells.map((d) => {
                const k = dayKey(d);
                if (d.getMonth() !== month) return <span key={k} className={cell} />;
                const load = loadOf(d, index, hours);
                const due = index.due.get(k) || 0;
                return (
                  <button
                    key={k}
                    onClick={() => onOpenDay(d)}
                    title={`${d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}${
                      load.mins ? ` · ${sayMins(load.mins)} committed` : " · clear"
                    }${due ? ` · ${due} due` : ""}`}
                    style={{ background: load.off && !load.mins ? "transparent" : shade(load.ratio) }}
                    className={`${cell} num relative grid place-items-center rounded-[3px] text-[9px]
                                transition-transform hover:scale-125 ${
                                  load.off && !load.mins ? "border border-dashed border-[var(--hairline)]" : ""
                                } ${load.ratio > 0.62 ? "text-[var(--paper)]" : "text-[var(--muted)]"} ${
                                  k === today ? "ring-1 ring-[var(--ink)] ring-offset-1 ring-offset-[var(--paper)]" : ""
                                }`}
                  >
                    {compact ? "" : d.getDate()}
                    {due > 0 && (
                      <span className="absolute -right-px -top-px h-1 w-1 rounded-full bg-[var(--alert)]" />
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ shared */

/**
 * Load as a shade of the ink, not as a hue.
 *
 * The palette holds exactly one colour and it is spent on things that cost
 * money if missed. A busy Tuesday is not one of them, so density is carried by
 * weight — which also means it survives a monochrome print and colour-blind
 * vision without a second thought.
 */
function shade(ratio) {
  if (ratio <= 0) return "var(--hairline)";
  const step = Math.min(4, Math.floor(ratio * 5));
  return `color-mix(in srgb, var(--ink) ${[12, 28, 46, 68, 92][step]}%, var(--paper))`;
}

const daysOf = ({ from, to }) => {
  const out = [];
  for (let d = new Date(from); d < to; d.setDate(d.getDate() + 1)) out.push(new Date(d));
  return out;
};

/** "9a", "12p" — an hour nobody can misread, in three characters. */
const shortHour = (iso) => {
  const h = new Date(iso).getHours();
  return `${h % 12 || 12}${h < 12 ? "a" : "p"}`;
};

const plannedIn = (blocks = [], range) =>
  blocks
    .filter((b) => {
      const at = new Date(`${b.day}T12:00:00`);
      return at >= range.from && at < range.to;
    })
    .reduce((n, b) => n + (b.mins || 0), 0);

const countIn = (events, range) =>
  events.filter((e) => {
    const at = new Date(e.start);
    return at >= range.from && at < range.to;
  }).length;
