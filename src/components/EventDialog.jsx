import { useEffect, useRef, useState } from "react";
import { addEvent, updateEvent, deleteEvent, dayKey } from "../lib/store";
import { toLocalIso } from "../lib/nlu/datetime";

/**
 * One form for making an event and for changing one.
 *
 * Deliberately not two components. An edit sheet that started as a copy of the
 * create sheet drifts within a release — a field gets added to one, a default
 * changes in the other — and the difference is invisible until somebody's
 * meeting loses its attendees by being edited. Passing an event switches the
 * mode; everything else is shared by construction.
 *
 * "With" and "About" are what let the assistant answer "you're meeting with Bob
 * about the Q3 pipeline" instead of reading the title back. Both optional; the
 * phrasing degrades to whatever is present.
 */
export default function EventDialog({ event = null, onClose }) {
  const editing = Boolean(event);
  const now = new Date();
  const start = editing ? new Date(event.start) : null;

  const [title, setTitle] = useState(event?.title ?? "");
  const [day, setDay] = useState(editing ? dayKey(start) : dayKey());
  const [time, setTime] = useState(
    // Top of the next hour, but never past 23:00 — at 11pm "+1" is 24, which is
    // not a real time: it parses as midnight the next day, so the event lands on
    // tomorrow while the date field still says today, and "what's on today"
    // can't see it.
    editing ? clock(start) : `${String(Math.min(now.getHours() + 1, 23)).padStart(2, "0")}:00`,
  );
  const [mins, setMins] = useState(
    editing ? Math.max(5, Math.round((new Date(event.end) - start) / 60000)) : 60,
  );
  const [location, setLocation] = useState(event?.location ?? "");
  const [people, setPeople] = useState((event?.attendees || []).map((a) => a.name).join(", "));
  const [about, setAbout] = useState(event?.notes ?? "");
  // Deleting a meeting is one tap away from here, so it asks — but in the
  // sheet rather than in a browser dialog, which on a phone appears somewhere
  // else entirely and reads as if the page has broken.
  const [confirming, setConfirming] = useState(false);

  const box = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  function submit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    const at = new Date(`${day}T${time}:00`);
    const patch = {
      title: title.trim(),
      start: `${day}T${time}:00`,
      // Local, not toISOString — that would shift the end by the UTC offset and
      // leave a 60-minute event ending hours away from where it started.
      end: toLocalIso(new Date(at.getTime() + mins * 60000)),
      location,
      attendees: people
        .split(/\s*,\s*|\s+and\s+/)
        .map((n) => n.trim())
        .filter(Boolean)
        .map((name) => ({ name })),
      notes: about.trim(),
    };
    if (editing) updateEvent(event.id, patch);
    else addEvent(patch);
    onClose();
  }

  /** Move by whole days without opening the date picker. */
  const shiftDays = (n) => {
    const d = new Date(`${day}T00:00:00`);
    d.setDate(d.getDate() + n);
    setDay(dayKey(d));
  };

  /** Move by half-hours, which is how a meeting actually slips. */
  const shiftMins = (n) => {
    const d = new Date(`${day}T${time}:00`);
    d.setMinutes(d.getMinutes() + n);
    setDay(dayKey(d));
    setTime(clock(d));
  };

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/40 px-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={editing ? `Edit ${event.title}` : "New event"}
    >
      <form
        ref={box}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-xl border border-[var(--line)]
                   bg-[var(--paper)] p-5"
      >
        <p className="label mb-3">{editing ? "Edit event" : "New event"}</p>
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
            aria-label="Date"
            className="rounded border border-[var(--line)] bg-transparent px-2.5 py-1.5 text-xs outline-none"
          />
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            aria-label="Start time"
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
          {/* A length that came from the assistant or a drag will not be one of
              the three presets, and it must not vanish because it is unlisted. */}
          {![30, 60, 90].includes(mins) && (
            <span className="rounded border border-[var(--ink)] bg-[var(--ink)] px-2.5 py-1.5 text-xs text-[var(--paper)]">
              {mins >= 60 ? `${+(mins / 60).toFixed(mins % 60 ? 1 : 0)}h` : `${mins}m`}
            </span>
          )}
        </div>

        {/* Rescheduling is most of what anyone opens this for, and it is nearly
            always a nudge rather than a date. Four taps that cover the common
            cases beat a date picker every time. */}
        {editing && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="label mr-1">Shift</span>
            {[
              ["−30m", () => shiftMins(-30)],
              ["+30m", () => shiftMins(30)],
              ["+1h", () => shiftMins(60)],
              ["+1 day", () => shiftDays(1)],
              ["+1 week", () => shiftDays(7)],
            ].map(([label, fn]) => (
              <button
                key={label}
                type="button"
                onClick={fn}
                className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs
                           transition-colors hover:border-[var(--ink)]"
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <input
          value={people}
          onChange={(e) => setPeople(e.target.value)}
          placeholder="With — Bob, John"
          className="mt-4 w-full border-b border-[var(--line)] bg-transparent pb-2 text-sm outline-none
                     transition-colors placeholder:text-[var(--faint)] focus:border-[var(--ink)]"
        />

        <input
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          placeholder="About — the Q3 pipeline"
          className="mt-4 w-full border-b border-[var(--line)] bg-transparent pb-2 text-sm outline-none
                     transition-colors placeholder:text-[var(--faint)] focus:border-[var(--ink)]"
        />

        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Location or link"
          className="mt-4 w-full border-b border-[var(--line)] bg-transparent pb-2 text-sm outline-none
                     transition-colors placeholder:text-[var(--faint)] focus:border-[var(--ink)]"
        />

        <div className="mt-6 flex items-center justify-between gap-2">
          {editing ? (
            confirming ? (
              <span className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => { deleteEvent(event.id); onClose(); }}
                  className="rounded-md border border-[var(--alert)] px-3 py-2 font-medium text-[var(--alert)]"
                >
                  Delete it
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="text-[var(--muted)]"
                >
                  Keep it
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="px-1 py-2 text-xs text-[var(--muted)] underline-offset-4 hover:underline"
              >
                Delete
              </button>
            )
          ) : (
            <span />
          )}

          <span className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-3 py-2 text-xs text-[var(--muted)]">
              Cancel
            </button>
            <button className="rounded-md bg-[var(--ink)] px-4 py-2 text-xs font-medium text-[var(--paper)]">
              {editing ? "Save" : "Add"}
            </button>
          </span>
        </div>

        {editing && (
          <p className="mt-3 text-xs text-[var(--muted)]">
            Anything changed here can be taken back — say “undo” to the assistant.
          </p>
        )}
      </form>
    </div>
  );
}

const clock = (d) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
