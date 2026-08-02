import { useEffect, useMemo, useRef, useState } from "react";

/**
 * ⌘K palette. Jumps between views, opens any project, or starts a focus session
 * on any open task without leaving the keyboard.
 */
export default function CommandPalette({ state, onClose, onNavigate, onFocusTask, onNewEvent }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => inputRef.current?.focus(), []);

  const items = useMemo(() => {
    const base = [
      { id: "v-today", label: "Today", hint: "View", run: () => onNavigate({ name: "today" }) },
      { id: "v-cal", label: "Calendar", hint: "View", run: () => onNavigate({ name: "calendar" }) },
      { id: "v-proj", label: "Projects", hint: "View", run: () => onNavigate({ name: "projects" }) },
      { id: "v-ins", label: "Insights", hint: "View", run: () => onNavigate({ name: "insights" }) },
      { id: "v-ask", label: "Assistant", hint: "View", run: () => onNavigate({ name: "assistant" }) },
      { id: "a-event", label: "New event", hint: "Action", run: onNewEvent },
      ...state.projects.map((p) => ({
        id: `p-${p.id}`,
        label: p.name,
        hint: "Project",
        run: () => onNavigate({ name: "project", id: p.id }),
      })),
      ...state.tasks
        .filter((t) => !t.done && !t.delegatedTo)
        .slice(0, 40)
        .map((t) => ({
          id: `t-${t.id}`,
          label: t.title,
          hint: `Focus · ${t.estimateMins}m`,
          run: () => onFocusTask(t),
        })),
    ];
    const needle = q.trim().toLowerCase();
    if (!needle) return base.slice(0, 12);
    return base.filter((x) => x.label.toLowerCase().includes(needle)).slice(0, 12);
  }, [q, state, onNavigate, onFocusTask, onNewEvent]);

  useEffect(() => setI(0), [q]);

  function onKey(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setI((n) => Math.min(items.length - 1, n + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setI((n) => Math.max(0, n - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[i]?.run();
      onClose();
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 px-6 pt-[12vh]" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper)]"
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder="Jump to, or search tasks…"
          className="w-full border-b border-[var(--line)] bg-transparent px-4 py-3.5 text-sm outline-none
                     placeholder:text-[var(--faint)]"
        />
        <ul className="max-h-80 overflow-y-auto py-1">
          {items.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-[var(--muted)]">No matches.</li>
          )}
          {items.map((x, n) => (
            <li key={x.id}>
              <button
                onMouseEnter={() => setI(n)}
                onClick={() => {
                  x.run();
                  onClose();
                }}
                className={`flex w-full items-center justify-between gap-4 px-4 py-2.5 text-left text-sm ${
                  n === i ? "bg-[var(--hover)]" : ""
                }`}
              >
                <span className="truncate">{x.label}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-[var(--faint)]">
                  {x.hint}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
