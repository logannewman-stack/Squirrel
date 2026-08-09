import { useEffect, useMemo, useRef, useState } from "react";
import { search, whenLabel } from "../lib/search";

/**
 * ⌘K: the way to anything.
 *
 * It was a jump list — the first forty *open* tasks, matched by substring —
 * which looks like search and is not. It could not find a finished task, a past
 * meeting, a note or anybody's name, and those are most of what somebody is
 * looking for when they go looking: the thing you half-remember doing is by
 * definition already done. A planner people leave is usually one where they
 * could not find something they knew was in there.
 *
 * The destinations and actions stay, because with an empty box this is still
 * the fastest way around the app. The moment anything is typed it becomes
 * search over everything.
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
    const needle = q.trim();
    if (!needle) return base.slice(0, 12);

    // Anything typed searches everything — done work, past meetings, notes,
    // attendees — rather than filtering the jump list. The commands stay
    // reachable by name because "new event" is a thing people type here.
    const commands = base
      .filter((x) => x.label.toLowerCase().includes(needle.toLowerCase()))
      .slice(0, 4);
    const found = search(needle, state, { limit: 12 }).map((r) => ({
      id: `s-${r.kind}-${r.id}`,
      label: r.title,
      hint: [r.hint, whenLabel(r.when)].filter(Boolean).join(" · "),
      dim: r.done,
      run: () =>
        r.kind === "project" ? onNavigate({ name: "project", id: r.id })
        : r.kind === "event" ? onNavigate({ name: "calendar" })
        : r.projectId ? onNavigate({ name: "project", id: r.projectId })
        : onNavigate({ name: "today" }),
    }));
    // Commands first when they matched the words outright; results otherwise.
    const seen = new Set(commands.map((x) => x.label.toLowerCase()));
    return [...commands, ...found.filter((x) => !seen.has(x.label.toLowerCase()))].slice(0, 12);
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
          placeholder="Search everything, or jump to…"
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
                {/* Finished work and past meetings are dimmed rather than
                    hidden: worth finding, rarely what was meant. */}
                <span className={`truncate ${x.dim ? "text-[var(--muted)] line-through" : ""}`}>
                  {x.label}
                </span>
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
