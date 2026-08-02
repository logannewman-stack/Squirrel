import { useState } from "react";
import { addProject } from "../lib/store";
import { duration } from "../lib/format";

export default function Projects({ state, onOpen }) {
  const { projects, tasks, sessions } = state;
  const [name, setName] = useState("");

  function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    onOpen(addProject(name).id);
    setName("");
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="mb-8 text-3xl font-semibold tracking-tight">Projects</h1>

      <form onSubmit={submit} className="mb-8 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New project"
          className="flex-1 border-b-2 border-[var(--line)] bg-transparent pb-2 outline-none
                     transition-colors placeholder:text-[var(--muted)] focus:border-[var(--ink)]"
        />
        <button
          type="submit"
          className="rounded-full border border-[var(--line)] px-5 py-2 text-sm
                     transition-colors hover:border-[var(--ink)]"
        >
          Add
        </button>
      </form>

      {projects.length === 0 ? (
        <p className="text-[var(--muted)]">
          No projects yet. A project is just a bucket — "Thesis", "Move house", "Work".
        </p>
      ) : (
        <ul className="space-y-2">
          {projects.map((p) => {
            const mine = tasks.filter((t) => t.projectId === p.id);
            const open = mine.filter((t) => !t.done);
            const focused = sessions
              .filter((s) => s.projectId === p.id)
              .reduce((sum, s) => sum + s.focusedMs, 0);
            const pct = mine.length ? Math.round(((mine.length - open.length) / mine.length) * 100) : 0;

            return (
              <li key={p.id}>
                <button
                  onClick={() => onOpen(p.id)}
                  className="w-full rounded-2xl border border-[var(--line)] px-5 py-4 text-left
                             transition-colors hover:border-[var(--ink)]"
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="truncate font-medium">{p.name}</span>
                    <span className="shrink-0 text-sm text-[var(--muted)]">
                      {open.length} open
                    </span>
                  </div>
                  <div className="mt-3 h-1 overflow-hidden rounded-full bg-[var(--line)]">
                    <div className="h-full bg-[var(--ink)]" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    {mine.length - open.length}/{mine.length} done
                    {focused > 0 && ` · ${duration(focused)} focused`}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
