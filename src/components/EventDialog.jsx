import { useState } from "react";
import { addEvent, dayKey } from "../lib/store";

/** Quick event capture. Duration is chosen, not typed — end time is derived. */
export default function EventDialog({ onClose }) {
  const now = new Date();
  const [title, setTitle] = useState("");
  const [day, setDay] = useState(dayKey());
  const [time, setTime] = useState(
    `${String(now.getHours() + 1).padStart(2, "0")}:00`,
  );
  const [mins, setMins] = useState(60);
  const [location, setLocation] = useState("");

  function submit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    const start = new Date(`${day}T${time}:00`);
    addEvent({
      title,
      start: `${day}T${time}:00`,
      end: new Date(start.getTime() + mins * 60000).toISOString().slice(0, 19),
      location,
    });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/40 px-6"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md rounded-xl border border-[var(--line)] bg-[var(--paper)] p-5"
      >
        <p className="label mb-3">New event</p>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="w-full border-b border-[var(--line)] bg-transparent pb-2 text-base outline-none
                     transition-colors placeholder:text-[var(--faint)] focus:border-[var(--ink)]"
        />

        <div className="mt-4 flex flex-wrap gap-2">
          <input
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="rounded border border-[var(--line)] bg-transparent px-2.5 py-1.5 text-xs outline-none"
          />
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="rounded border border-[var(--line)] bg-transparent px-2.5 py-1.5 text-xs tabular-nums outline-none"
          />
          {[30, 60, 90].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMins(m)}
              aria-pressed={mins === m}
              className={`rounded border px-2.5 py-1.5 text-xs transition-colors ${
                mins === m
                  ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
                  : "border-[var(--line)] hover:border-[var(--ink)]"
              }`}
            >
              {m >= 60 ? `${m / 60}h` : `${m}m`}
            </button>
          ))}
        </div>

        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Location or link"
          className="mt-4 w-full border-b border-[var(--line)] bg-transparent pb-2 text-sm outline-none
                     transition-colors placeholder:text-[var(--faint)] focus:border-[var(--ink)]"
        />

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-xs text-[var(--muted)]">
            Cancel
          </button>
          <button className="rounded-md bg-[var(--ink)] px-4 py-2 text-xs font-medium text-[var(--paper)]">
            Add
          </button>
        </div>
      </form>
    </div>
  );
}
