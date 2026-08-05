import { useMemo, useState } from "react";
import { setSetting } from "../lib/store";
import {
  hoursOf, toClock, sayHour, sayMins, DAY_NAMES, usableMinsOn, weeklyMins, breaksOn,
} from "../lib/hours";

/**
 * The shape of your working day.
 *
 * Everything the planner does rests on these four numbers, and until now they
 * were constants — 08:00, 19:00, five hours, weekdays — applied to everyone.
 * The arithmetic that says "this does not fit before Friday" is only worth
 * anything if the days it measures are the days you actually work, so this
 * panel exists to make that arithmetic yours.
 *
 * The band across the top is the point of the screen. Two numbers that sound
 * alike — an eleven-hour window and five hours of focus — mean quite different
 * things, and no amount of label copy explains the difference as fast as
 * seeing the window drawn with the breaks cut out of it.
 */

const uid = () => globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2);

/** Ready-made commitments, because typing "Lunch, 12:00, 13:00" is a chore. */
const PRESETS = [
  { label: "Lunch", start: "12:00", end: "13:00", days: [1, 2, 3, 4, 5] },
  { label: "Gym", start: "07:00", end: "08:00", days: [1, 3, 5] },
  { label: "School run", start: "15:00", end: "16:00", days: [1, 2, 3, 4, 5] },
  { label: "Deep work", start: "09:00", end: "11:00", days: [1, 2, 3, 4, 5] },
];

export default function WorkingHours({ state }) {
  const hours = useMemo(() => hoursOf(state.settings), [state.settings]);
  const [preview, setPreview] = useState(new Date().getDay());

  const save = (patch) =>
    setSetting("hours", {
      start: toClock(hours.start),
      end: toClock(hours.end),
      capacityMins: hours.capacityMins,
      days: hours.days,
      breaks: hours.breaks.map((b) => ({
        id: b.id, label: b.label, start: toClock(b.start), end: toClock(b.end), days: b.days,
      })),
      ...patch,
    });

  const toggleDay = (d) =>
    save({ days: hours.days.includes(d) ? hours.days.filter((x) => x !== d) : [...hours.days, d].sort() });

  const editBreak = (id, patch) =>
    save({
      breaks: hours.breaks.map((b) =>
        b.id === id
          ? { id: b.id, label: b.label, start: toClock(b.start), end: toClock(b.end), days: b.days, ...patch }
          : { id: b.id, label: b.label, start: toClock(b.start), end: toClock(b.end), days: b.days },
      ),
    });

  const addBreak = (p) =>
    save({
      breaks: [
        ...hours.breaks.map((b) => ({
          id: b.id, label: b.label, start: toClock(b.start), end: toClock(b.end), days: b.days,
        })),
        { id: uid(), ...p },
      ],
    });

  const removeBreak = (id) =>
    save({
      breaks: hours.breaks
        .filter((b) => b.id !== id)
        .map((b) => ({ id: b.id, label: b.label, start: toClock(b.start), end: toClock(b.end), days: b.days })),
    });

  const worksPreview = hours.days.includes(preview);
  const usable = usableMinsOn(hours, preview);
  const week = weeklyMins(hours);
  const dayBreaks = breaksOn(hours, preview);
  const breakMins = dayBreaks.reduce((n, b) => n + b.mins, 0);
  const spare = Math.max(0, hours.windowMins - breakMins - usable);

  return (
    <div className="space-y-8">
      {/* ---------------------------------------------------------- the band */}
      <div className="rounded-lg border border-[var(--line)] bg-[var(--raised)] p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="flex gap-1">
            {DAY_NAMES.map((name, d) => (
              <button
                key={name}
                onClick={() => setPreview(d)}
                aria-pressed={preview === d}
                title={name}
                className={`h-7 w-7 rounded-md text-[11px] font-medium tabular-nums transition-colors ${
                  preview === d
                    ? "bg-[var(--ink)] text-[var(--paper)]"
                    : hours.days.includes(d)
                      ? "text-[var(--ink)] hover:bg-[var(--hover)]"
                      : "text-[var(--faint)] hover:bg-[var(--hover)]"
                }`}
              >
                {name[0]}
              </button>
            ))}
          </div>
          <p className="num text-sm text-[var(--muted)]">
            {worksPreview
              ? `${sayMins(usable)} of focus · ${sayHour(hours.start)}–${sayHour(hours.end)}`
              : `${DAY_NAMES[preview]} is off`}
          </p>
        </div>

        {worksPreview ? (
          <>
            <DayBand hours={hours} weekday={preview} focusMins={usable} />
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--muted)]">
              <Key className="bg-[var(--ink)]" label={`Focus ${sayMins(usable)}`} />
              {breakMins > 0 && <Key className="bg-[var(--faint)]" label={`Committed ${sayMins(breakMins)}`} />}
              {spare > 0 && <Key className="bg-[var(--line)]" label={`Meetings & slack ${sayMins(spare)}`} />}
            </div>
          </>
        ) : (
          <div className="h-3 rounded-full border border-dashed border-[var(--line)]" />
        )}

        <p className="mt-3 border-t border-[var(--hairline)] pt-3 text-xs text-[var(--muted)]">
          {week > 0 ? (
            <>
              <span className="num font-medium text-[var(--ink)]">{sayMins(week)}</span> of focused
              work a week is what everything else is measured against — whether a deadline fits,
              how thin a project is spread, what gets called urgent.
            </>
          ) : (
            "No working days selected, so nothing can be planned."
          )}
        </p>
      </div>

      {/* --------------------------------------------------------- the days */}
      <Section
        title="Days you work"
        note="Nothing is ever planned onto a day that is off. Meetings you book yourself still land wherever you put them."
      >
        <div className="flex flex-wrap gap-2">
          {DAY_NAMES.map((name, d) => {
            const on = hours.days.includes(d);
            return (
              <button
                key={name}
                onClick={() => toggleDay(d)}
                role="switch"
                aria-checked={on}
                className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
                  on
                    ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
                    : "border-[var(--line)] text-[var(--muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
                }`}
              >
                {name.slice(0, 3)}
              </button>
            );
          })}
        </div>
      </Section>

      {/* -------------------------------------------------------- the window */}
      <Section
        title="Start and finish"
        note="The window a meeting or a work block may be placed in. Not a claim about how long you work — that is the next one."
      >
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Start">
            <input
              type="time"
              value={toClock(hours.start)}
              step={900}
              onChange={(e) => save({ start: e.target.value })}
              className="num w-32 rounded-md border border-[var(--line)] bg-[var(--paper)] px-3 py-2
                         text-sm text-[var(--ink)] transition-colors focus:border-[var(--ink)] focus:outline-none"
            />
          </Field>
          <Field label="Finish">
            <input
              type="time"
              value={toClock(hours.end)}
              step={900}
              onChange={(e) => save({ end: e.target.value })}
              className="num w-32 rounded-md border border-[var(--line)] bg-[var(--paper)] px-3 py-2
                         text-sm text-[var(--ink)] transition-colors focus:border-[var(--ink)] focus:outline-none"
            />
          </Field>
          <p className="num pb-2 text-sm text-[var(--muted)]">
            {sayMins(hours.windowMins)} long
          </p>
        </div>
      </Section>

      {/* ------------------------------------------------------ the capacity */}
      <Section
        title="Focused work a day"
        note="Deliberately smaller than the window. A day filled to its edges is a day that gets abandoned by ten past three, and a planner that assumes otherwise hands back schedules nobody keeps."
      >
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={30}
            max={Math.max(60, hours.windowMins)}
            step={30}
            value={hours.capacityMins}
            onChange={(e) => save({ capacityMins: Number(e.target.value) })}
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--line)]
                       accent-[var(--ink)]"
            aria-label="Focused work a day"
          />
          <span className="num w-20 shrink-0 text-right text-lg font-medium">
            {sayMins(hours.capacityMins)}
          </span>
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">
          {hours.capacityMins >= hours.windowMins - 30
            ? "That is the whole window. Every meeting you take comes straight out of it."
            : `Leaves ${sayMins(hours.windowMins - hours.capacityMins)} for meetings and everything unplanned.`}
        </p>
      </Section>

      {/* -------------------------------------------------------- the breaks */}
      <Section
        title="Standing commitments"
        note="Lunch, the gym, the school run — time that is gone whether or not it is on the calendar. Entering it here means the planner stops booking work into it."
      >
        <div className="space-y-2">
          {hours.breaks.map((b) => (
            <div
              key={b.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--line)] px-3 py-2"
            >
              <input
                value={b.label}
                onChange={(e) => editBreak(b.id, { label: e.target.value })}
                className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ink)] outline-none
                           placeholder:text-[var(--faint)]"
                placeholder="Lunch"
              />
              <input
                type="time"
                value={toClock(b.start)}
                step={900}
                onChange={(e) => editBreak(b.id, { start: e.target.value })}
                className="num rounded border border-[var(--line)] bg-[var(--paper)] px-2 py-1 text-xs
                           text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none"
              />
              <span className="text-xs text-[var(--faint)]">to</span>
              <input
                type="time"
                value={toClock(b.end)}
                step={900}
                onChange={(e) => editBreak(b.id, { end: e.target.value })}
                className="num rounded border border-[var(--line)] bg-[var(--paper)] px-2 py-1 text-xs
                           text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none"
              />
              <div className="flex gap-0.5">
                {DAY_NAMES.map((name, d) => (
                  <button
                    key={name}
                    title={name}
                    aria-pressed={b.days.includes(d)}
                    onClick={() =>
                      editBreak(b.id, {
                        days: b.days.includes(d) ? b.days.filter((x) => x !== d) : [...b.days, d].sort(),
                      })
                    }
                    className={`h-6 w-6 rounded text-[10px] font-medium transition-colors ${
                      b.days.includes(d)
                        ? "bg-[var(--ink)] text-[var(--paper)]"
                        : "text-[var(--faint)] hover:bg-[var(--hover)]"
                    }`}
                  >
                    {name[0]}
                  </button>
                ))}
              </div>
              <button
                onClick={() => removeBreak(b.id)}
                aria-label={`Remove ${b.label}`}
                className="rounded p-1 text-[var(--faint)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--ink)]"
              >
                <svg viewBox="0 0 16 16" className="h-4 w-4 fill-none stroke-current stroke-[1.6]">
                  <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {PRESETS.filter((p) => !hours.breaks.some((b) => b.label.toLowerCase() === p.label.toLowerCase())).map(
            (p) => (
              <button
                key={p.label}
                onClick={() => addBreak(p)}
                className="rounded-full border border-[var(--line)] px-3 py-1 text-xs text-[var(--muted)]
                           transition-colors hover:border-[var(--ink)] hover:text-[var(--ink)]"
              >
                + {p.label}
              </button>
            ),
          )}
          <button
            onClick={() => addBreak({ label: "", start: "12:00", end: "13:00", days: hours.days })}
            className="rounded-full border border-dashed border-[var(--line)] px-3 py-1 text-xs
                       text-[var(--muted)] transition-colors hover:border-[var(--ink)] hover:text-[var(--ink)]"
          >
            + Something else
          </button>
        </div>
      </Section>
    </div>
  );
}

/**
 * One day drawn to scale.
 *
 * Committed time sits where it actually falls; focus and slack fill what is
 * left. The focus band is not placed at a real hour because it is not a real
 * hour — it is a budget, and drawing it as a fixed block would promise a
 * certainty the planner does not have.
 */
function DayBand({ hours, weekday, focusMins }) {
  const total = hours.windowMins || 1;
  const pieces = [];
  let cursor = hours.start;
  const committed = breaksOn(hours, weekday).slice().sort((a, b) => a.start - b.start);

  for (const b of committed) {
    const from = Math.max(b.start, hours.start);
    const to = Math.min(b.end, hours.end);
    if (to <= from) continue;
    if (from > cursor) pieces.push({ kind: "open", mins: (from - cursor) * 60 });
    pieces.push({ kind: "busy", mins: (to - from) * 60, label: b.label });
    cursor = to;
  }
  if (cursor < hours.end) pieces.push({ kind: "open", mins: (hours.end - cursor) * 60 });

  // Focus is spent against open time, front to back, purely so the proportions
  // read at a glance.
  let left = focusMins;
  const drawn = [];
  for (const p of pieces) {
    if (p.kind !== "open") {
      drawn.push(p);
      continue;
    }
    const take = Math.min(left, p.mins);
    if (take > 0) drawn.push({ kind: "focus", mins: take });
    if (p.mins - take > 0) drawn.push({ kind: "open", mins: p.mins - take });
    left -= take;
  }

  const fill = { focus: "bg-[var(--ink)]", busy: "bg-[var(--faint)]", open: "bg-[var(--line)]" };

  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full" role="img"
         aria-label={`${sayMins(focusMins)} focus inside a ${sayMins(total)} day`}>
      {drawn.map((p, i) => (
        <div
          key={i}
          title={p.label || (p.kind === "focus" ? "Focused work" : "Open")}
          className={fill[p.kind]}
          style={{ width: `${(p.mins / total) * 100}%` }}
        />
      ))}
    </div>
  );
}

const Key = ({ className, label }) => (
  <span className="flex items-center gap-1.5">
    <span className={`h-2 w-2 rounded-full ${className}`} />
    {label}
  </span>
);

const Field = ({ label, children }) => (
  <label className="flex flex-col gap-1.5">
    <span className="label">{label}</span>
    {children}
  </label>
);

const Section = ({ title, note, children }) => (
  <section>
    <h3 className="text-sm font-medium">{title}</h3>
    <p className="mb-3 mt-1 max-w-prose text-xs leading-relaxed text-[var(--muted)]">{note}</p>
    {children}
  </section>
);
