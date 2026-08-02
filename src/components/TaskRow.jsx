import { todayKey } from "../lib/store";

function dueLabel(due) {
  if (!due) return null;
  const days = Math.round(
    (new Date(due + "T00:00:00") - new Date(todayKey() + "T00:00:00")) / 86400000,
  );
  if (days < 0) return `${-days}d late`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return `${days}d`;
  return new Date(due + "T00:00:00").toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function TaskRow({ task, project, onToggle, onFocus, onDelete, showProject }) {
  const late = task.due && task.due < todayKey() && !task.done;

  return (
    <li className="group flex items-center gap-3 py-3">
      <button
        onClick={onToggle}
        aria-label={task.done ? "Mark not done" : "Mark done"}
        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors ${
          task.done ? "border-[var(--ink)] bg-[var(--ink)]" : "border-[var(--line)] hover:border-[var(--ink)]"
        }`}
      >
        {task.done && (
          <svg viewBox="0 0 12 12" className="h-3 w-3 fill-none stroke-[var(--paper)] stroke-2">
            <path d="M2.5 6.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <p className={`truncate ${task.done ? "text-[var(--muted)] line-through" : ""}`}>
          {task.title}
        </p>
        <p className="mt-0.5 flex gap-2 text-xs text-[var(--muted)]">
          {showProject && project && <span className="truncate">{project.name}</span>}
          <span>{task.estimateMins}m</span>
          {/* Overdue is stated plainly and never coloured red — the point is
              information, not alarm. */}
          {task.due && <span className={late ? "font-medium text-[var(--ink)]" : ""}>{dueLabel(task.due)}</span>}
        </p>
      </div>

      {!task.done && onFocus && (
        <button
          onClick={onFocus}
          className="shrink-0 rounded-full border border-[var(--line)] px-4 py-1.5 text-xs
                     transition-colors hover:border-[var(--ink)]"
        >
          Focus
        </button>
      )}

      {onDelete && (
        <button
          onClick={onDelete}
          aria-label="Delete task"
          className="shrink-0 px-1 text-[var(--muted)] opacity-0 transition-opacity
                     hover:text-[var(--ink)] group-hover:opacity-100"
        >
          ×
        </button>
      )}
    </li>
  );
}
