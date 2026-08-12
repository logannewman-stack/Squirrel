import { dayKey } from "../lib/store";
import { sayMins } from "../lib/hours";

const PRIORITY_MARK = { critical: "▲▲", high: "▲", normal: "", low: "▽" };

/**
 * How the schedule line reads.
 *
 * `scheduled` is the ordinary answer and deliberately looks like the rest of
 * the row — a fact, not an alert. The two states that need somebody to act
 * are the two that get the ink: work that will not fit, and work the planner
 * cannot place because nobody said how long it takes.
 */
const WHEN_TONE = {
  short: "font-semibold text-[var(--ink)]",
  unestimated: "text-[var(--muted)]",
  spent: "text-[var(--muted)]",
};

function dueLabel(due) {
  if (!due) return null;
  const days = Math.round(
    (new Date(due + "T00:00:00") - new Date(dayKey() + "T00:00:00")) / 86400000,
  );
  if (days < 0) return `${-days}d late`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return `${days}d`;
  return new Date(due + "T00:00:00").toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * `note` is a word in the top-right corner saying why this row is on the screen
 * it is on — "Overdue", "Due today". It belongs in here rather than in a
 * wrapper around it: Today used to wrap this in a second `<li>` to position the
 * badge, which put a list item inside a list item. Invalid HTML, and assistive
 * technology announces the nesting.
 *
 * `when` is the answer from `lib/when.js` — passed in rather than computed
 * here, because a row that plans for itself is planning against a slightly
 * different `now` than the screen around it, and two answers about the same
 * Thursday is the failure that module exists to end.
 */
export default function TaskRow({ task, project, when, onToggle, onFocus, onDelete, showProject, note }) {
  const late = task.due && task.due < dayKey() && !task.done;

  return (
    <li className="group relative flex items-center gap-3 py-2.5">
      {note}
      <button
        onClick={onToggle}
        aria-label={task.done ? "Mark not done" : "Mark done"}
        className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border transition-colors ${
          task.done ? "border-[var(--ink)] bg-[var(--ink)]" : "border-[var(--line)] hover:border-[var(--ink)]"
        }`}
      >
        {task.done && (
          <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 fill-none stroke-[var(--paper)] stroke-2">
            <path d="M2.5 6.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm ${task.done ? "text-[var(--muted)] line-through" : ""}`}>
          {/* Priority is a glyph, not a colour — the palette carries no signal
              and red would read as alarm rather than rank. */}
          {PRIORITY_MARK[task.priority] && (
            <span className="mr-1.5 text-[10px] text-[var(--muted)]">{PRIORITY_MARK[task.priority]}</span>
          )}
          {task.title}
        </p>
        <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-[var(--faint)]">
          {showProject && project && <span className="truncate">{project.name}</span>}
          {/* "120m" was the app's own arithmetic read back at somebody. Every
              other surface says "2h", and a row is the last place to make a
              reader divide by sixty. */}
          {task.estimateMins > 0 && <span className="tabular-nums">{sayMins(task.estimateMins)}</span>}
          {task.due && (
            <span className={`tabular-nums ${late ? "font-semibold text-[var(--ink)]" : ""}`}>
              {dueLabel(task.due)}
            </span>
          )}
          {task.delegatedTo && <span>→ {task.delegatedTo}</span>}
          {/* The answer the app already had and never gave: an estimate and a
              deadline are what you told it, and this is what it decided. The
              separator marks it as the app talking back rather than a fourth
              thing you typed. */}
          {when?.short && !task.delegatedTo && (
            <span className={WHEN_TONE[when.state] || "text-[var(--muted)]"} title={when.long}>
              · {when.short}
            </span>
          )}
        </p>
      </div>

      {/**
        * `sq-hover-reveal` — visible wherever hover does not exist.
        *
        * These controls are revealed by :hover, and a phone has no hover: on
        * touch they were opacity-0 but still armed, so a blind tap at the end
        * of a row deleted the task it landed on — an invisible button is the
        * one kind that can never be pressed on purpose. On touch they simply
        * show; the quiet-until-hovered trick stays a desktop refinement.
        */}
      {!task.done && !task.delegatedTo && onFocus && (
        <button
          onClick={onFocus}
          className="sq-hover-reveal shrink-0 rounded border border-[var(--line)] px-2.5 py-1 text-[11px]
                     opacity-0 transition-all hover:border-[var(--ink)] group-hover:opacity-100
                     focus:opacity-100"
        >
          Focus
        </button>
      )}

      {onDelete && (
        <button
          onClick={onDelete}
          aria-label="Delete task"
          className="sq-hover-reveal shrink-0 px-1 text-[var(--faint)] opacity-0 transition-opacity
                     hover:text-[var(--ink)] group-hover:opacity-100"
        >
          ×
        </button>
      )}
    </li>
  );
}
