import { setSetting, updateTask, dayKey } from "../lib/store";
import { reviewOf } from "../lib/review";
import { duration } from "../lib/format";

/**
 * The end of the day, said once.
 *
 * The only moment in this app that speaks first. Everything else is a thing you
 * fill in — which is exactly why planners get abandoned: every visit is another
 * chore and nothing ever visits you.
 *
 * Three rules keep it from becoming the thing people close on sight. It appears
 * on a screen somebody already opened rather than as a notification. It appears
 * once, after their working day, and never again that day. And it carries one
 * action rather than three, because "move what I didn't get to into tomorrow"
 * is the decision actually being made at six o'clock, and a menu turns a moment
 * of closure into an admin task.
 */
export default function Review({ state, onDone }) {
  const now = new Date();
  const r = reviewOf(state, now);
  const dismiss = () => {
    setSetting("reviewSeen", dayKey(now));
    onDone?.();
  };

  const tomorrow = () => {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    const key = dayKey(d);
    // Only the due date moves. Re-planning is the planner's job and it will
    // run on the next change anyway — writing blocks here would be a second
    // scheduler, which is the bug this app already fixed once.
    for (const task of r.missed) updateTask(task.id, { due: key });
    dismiss();
  };

  return (
    <div className="card mb-6 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="label">Today, in short</p>
          <p className="mt-1 text-[17px] font-semibold tracking-tight">{r.headline}</p>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-[var(--faint)] transition-colors
                     hover:bg-[var(--hover)] hover:text-[var(--ink)]"
        >
          <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4 fill-none stroke-current stroke-[2]">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Named, not counted. The whole point of looking back is recognising
          the work, and a number does not do that. */}
      {r.finished.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {r.finished.slice(0, 4).map((t) => (
            <li key={t.id} className="flex items-start gap-2 text-sm text-[var(--muted)]">
              <svg viewBox="0 0 24 24" aria-hidden
                   className="mt-[3px] h-3.5 w-3.5 shrink-0 fill-none stroke-current stroke-[2.4]">
                <path d="M4 12.5l5 5L20 6.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="min-w-0 flex-1">{t.title}</span>
            </li>
          ))}
          {r.finished.length > 4 && (
            <li className="pl-[22px] text-xs text-[var(--faint)]">
              and {r.finished.length - 4} more
            </li>
          )}
        </ul>
      )}

      {(r.focusedMs > 0 || r.meetings > 0) && (
        <p className="mt-3 text-xs text-[var(--muted)]">
          {[
            r.focusedMs > 0 ? `${duration(r.focusedMs)} focused` : null,
            r.meetings > 0 ? `${r.meetings} ${r.meetings === 1 ? "meeting" : "meetings"}` : null,
          ].filter(Boolean).join(" · ")}
        </p>
      )}

      {r.missed.length > 0 && (
        <div className="mt-4 border-t border-[var(--hairline)] pt-4">
          <p className="text-sm text-[var(--muted)]">
            {r.missed.length === 1 ? "Still open:" : `Still open (${r.missed.length}):`}{" "}
            <span className="text-[var(--ink)]">
              {r.missed.slice(0, 3).map((t) => t.title).join(", ")}
              {r.missed.length > 3 ? `, and ${r.missed.length - 3} more` : ""}
            </span>
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={tomorrow}
              className="rounded-lg bg-[var(--ink)] px-4 py-2 text-xs font-semibold text-[var(--paper)]
                         transition-opacity hover:opacity-90"
            >
              Move {r.missed.length === 1 ? "it" : "them"} to tomorrow
            </button>
            <button
              onClick={dismiss}
              className="rounded-lg border border-[var(--line)] px-4 py-2 text-xs
                         transition-colors hover:border-[var(--ink)]"
            >
              Leave it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
