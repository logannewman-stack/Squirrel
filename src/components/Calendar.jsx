import { useState } from "react";
import { todayKey } from "../lib/store";

const DAYS = ["M", "T", "W", "T", "F", "S", "S"];

function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  // Monday-first: JS getDay() is Sunday-first, so rotate.
  const lead = (first.getDay() + 6) % 7;
  const count = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= count; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7) cells.push(null);
  return cells;
}

/** Month view marking days that have tasks due. */
export default function Calendar({ tasks, onPickDay, selected }) {
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  });

  const byDay = tasks.reduce((acc, t) => {
    if (!t.due) return acc;
    (acc[t.due] ||= []).push(t);
    return acc;
  }, {});

  const cells = monthGrid(cursor.y, cursor.m);
  const label = new Date(cursor.y, cursor.m).toLocaleDateString([], {
    month: "long",
    year: "numeric",
  });
  const shift = (n) => {
    const d = new Date(cursor.y, cursor.m + n);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => shift(-1)} className="px-2 text-[var(--muted)] hover:text-[var(--ink)]">
          ←
        </button>
        <span className="text-sm font-medium">{label}</span>
        <button onClick={() => shift(1)} className="px-2 text-[var(--muted)] hover:text-[var(--ink)]">
          →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-[var(--muted)]">
        {DAYS.map((d, i) => (
          <div key={i} className="pb-2">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const key = todayKey(date);
          const due = byDay[key] || [];
          const isToday = key === todayKey();
          const isSelected = key === selected;
          const allDone = due.length > 0 && due.every((t) => t.done);
          return (
            <button
              key={i}
              onClick={() => onPickDay?.(isSelected ? null : key)}
              className={`relative aspect-square rounded-lg text-sm transition-colors ${
                isSelected
                  ? "bg-[var(--ink)] text-[var(--paper)]"
                  : isToday
                    ? "border border-[var(--ink)]"
                    : "hover:bg-[var(--hover)]"
              }`}
            >
              {date.getDate()}
              {due.length > 0 && (
                <span
                  className={`absolute bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${
                    isSelected ? "bg-[var(--paper)]" : "bg-[var(--ink)]"
                  } ${allDone ? "opacity-30" : ""}`}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
