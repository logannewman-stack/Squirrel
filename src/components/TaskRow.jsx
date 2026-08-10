import { dayKey } from "../lib/store";

const PRIORITY_MARK = { critical: "▲▲", high: "▲", normal: "", low: "▽" };

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
 */
export default function TaskRow({ task, project, onToggle, onFocus, onDelete, showProject, note }) {
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
          <span className="tabular-nums">{task.estimateMins}m</span>
          {task.due && (
            <span className={`tabular-nums ${late ? "font-semibold text-[var(--ink)]" : ""}`}>
              {dueLabel(task.due)}
            </span>
          )}
          {task.delegatedTo && <span>→ {task.delegatedTo}</span>}
        </p>
      </div>

      {!task.done && !task.delegatedTo && onFocus && (
        <button
          onClick={onFocus}
          className="shrink-0 rounded border border-[var(--line)] px-2.5 py-1 text-[11px]
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
          className="shrink-0 px-1 text-[var(--faint)] opacity-0 transition-opacity
                     hover:text-[var(--ink)] group-hover:opacity-100"
        >
          ×
        </button>
      )}
    </li>
  );
}
