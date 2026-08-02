import { useMemo, useState } from "react";
import { weekOf, WORK_START, WORK_END, fmtTime } from "../lib/agenda";
import { dayKey, deleteEvent } from "../lib/store";

const HOUR_PX = 52;

export default function WeekCalendar({ state, onNewEvent }) {
  const [anchor, setAnchor] = useState(() => new Date());
  const days = useMemo(() => weekOf(anchor), [anchor]);
  const today = dayKey();

  const shift = (n) => {
    const d = new Date(anchor);
    d.setDate(d.getDate() + n * 7);
    setAnchor(d);
  };

  const hours = Array.from({ length: WORK_END - WORK_START }, (_, i) => WORK_START + i);
  const label = `${days[0].toLocaleDateString([], { month: "short", day: "numeric" })} – ${days[6].toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Calendar</h1>
          <p className="mt-0.5 text-xs tabular-nums text-[var(--muted)]">{label}</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => shift(-1)} className="rounded px-2.5 py-1.5 text-sm text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]">←</button>
          <button onClick={() => setAnchor(new Date())} className="rounded px-3 py-1.5 text-xs hover:bg-[var(--hover)]">Today</button>
          <button onClick={() => shift(1)} className="rounded px-2.5 py-1.5 text-sm text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]">→</button>
          <button
            onClick={onNewEvent}
            className="ml-2 rounded-md bg-[var(--ink)] px-3.5 py-1.5 text-xs font-medium text-[var(--paper)]"
          >
            New event
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="min-w-[820px]">
          {/* Day headers */}
          <div className="sticky top-0 z-10 grid grid-cols-[56px_repeat(7,1fr)] border-b border-[var(--line)] bg-[var(--paper)]">
            <div />
            {days.map((d) => {
              const k = dayKey(d);
              return (
                <div key={k} className="border-l border-[var(--hairline)] px-2 py-2 text-center">
                  <div className="label">{d.toLocaleDateString([], { weekday: "short" })}</div>
                  <div
                    className={`mx-auto mt-1 grid h-7 w-7 place-items-center rounded-full text-sm tabular-nums ${
                      k === today ? "bg-[var(--ink)] font-semibold text-[var(--paper)]" : ""
                    }`}
                  >
                    {d.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Hour grid */}
          <div className="relative grid grid-cols-[56px_repeat(7,1fr)]">
            <div>
              {hours.map((h) => (
                <div key={h} style={{ height: HOUR_PX }} className="relative">
                  <span className="absolute -top-1.5 right-2 text-[10px] tabular-nums text-[var(--faint)]">
                    {h % 12 === 0 ? 12 : h % 12}
                    {h < 12 ? "a" : "p"}
                  </span>
                </div>
              ))}
            </div>

            {days.map((d) => {
              const k = dayKey(d);
              const evs = state.events
                .filter((e) => dayKey(new Date(e.start)) === k)
                .sort((a, b) => new Date(a.start) - new Date(b.start));
              return (
                <div key={k} className="relative border-l border-[var(--hairline)]">
                  {hours.map((h) => (
                    <div key={h} style={{ height: HOUR_PX }} className="border-b border-[var(--hairline)]" />
                  ))}

                  {evs.map((e) => {
                    const s = new Date(e.start);
                    const en = new Date(e.end);
                    const top = ((s.getHours() + s.getMinutes() / 60) - WORK_START) * HOUR_PX;
                    const height = Math.max(20, ((en - s) / 3600000) * HOUR_PX - 2);
                    if (top + height < 0 || top > (WORK_END - WORK_START) * HOUR_PX) return null;
                    return (
                      <button
                        key={e.id}
                        onClick={() => {
                          if (confirm(`Cancel "${e.title}"?`)) deleteEvent(e.id);
                        }}
                        title={`${e.title} · ${fmtTime(e.start)}–${fmtTime(e.end)}`}
                        style={{ top: Math.max(0, top), height }}
                        className="absolute inset-x-1 overflow-hidden rounded border border-[var(--ink)]
                                   bg-[var(--ink)] px-1.5 py-1 text-left text-[11px] leading-tight
                                   text-[var(--paper)] transition-opacity hover:opacity-80"
                      >
                        <span className="block truncate font-medium">{e.title}</span>
                        <span className="block truncate tabular-nums opacity-70">{fmtTime(e.start)}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
