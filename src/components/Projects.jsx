import { useState } from "react";
import { addProject, dayKey } from "../lib/store";
import { duration } from "../lib/format";

export default function Projects({ state, onOpen }) {
  const { projects, tasks, sessions } = state;
  const [name, setName] = useState("");
  const today = dayKey();

  const rows = projects
    .map((p) => {
      const mine = tasks.filter((t) => t.projectId === p.id);
      const open = mine.filter((t) => !t.done);
      return {
        p,
        total: mine.length,
        open: open.length,
        overdue: open.filter((t) => t.due && t.due < today).length,
        focused: sessions.filter((s) => s.projectId === p.id).reduce((a, s) => a + s.focusedMs, 0),
        pct: mine.length ? Math.round(((mine.length - open.length) / mine.length) * 100) : 0,
      };
    })
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="label">{projects.length} active</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Projects</h1>
        </div>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          onOpen(addProject({ name }).id);
          setName("");
        }}
        className="mb-8 flex gap-2"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New project"
          className="flex-1 rounded-md border border-[var(--line)] bg-transparent px-3.5 py-2 text-sm
                     outline-none transition-colors placeholder:text-[var(--faint)] focus:border-[var(--ink)]"
        />
        <button className="rounded-md bg-[var(--ink)] px-4 py-2 text-xs font-medium text-[var(--paper)]">
          Create
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No projects yet. A project groups work — a deal, a launch, a function.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--line)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] bg-[var(--raised)]">
                <th className="label px-4 py-2.5 text-left font-semibold">Project</th>
                <th className="label px-4 py-2.5 text-right font-semibold">Open</th>
                <th className="label hidden px-4 py-2.5 text-right font-semibold sm:table-cell">Late</th>
                <th className="label hidden px-4 py-2.5 text-right font-semibold sm:table-cell">Focused</th>
                <th className="label px-4 py-2.5 text-right font-semibold">Done</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, open, overdue, focused, pct, total }) => (
                <tr
                  key={p.id}
                  onClick={() => onOpen(p.id)}
                  className="cursor-pointer border-b border-[var(--hairline)] last:border-0 hover:bg-[var(--hover)]"
                >
                  <td className="px-4 py-3">
                    <p className="font-medium">{p.name}</p>
                    {(p.client || p.value) && (
                      <p className="mt-0.5 text-[11px] text-[var(--faint)]">
                        {p.client}
                        {p.client && p.value ? " · " : ""}
                        {p.value ? `$${(p.value / 1000).toFixed(0)}k` : ""}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{open}</td>
                  <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">
                    {/* Late count is stated, never coloured — rank, not alarm. */}
                    {overdue > 0 ? <span className="font-semibold">{overdue}</span> : <span className="text-[var(--faint)]">—</span>}
                  </td>
                  <td className="hidden px-4 py-3 text-right tabular-nums text-[var(--muted)] sm:table-cell">
                    {focused ? duration(focused) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1 w-14 overflow-hidden rounded-full bg-[var(--hairline)]">
                        <div className="h-full bg-[var(--ink)]" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-10 text-right text-[11px] tabular-nums text-[var(--faint)]">
                        {total ? `${pct}%` : "—"}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
