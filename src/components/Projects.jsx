import { useState } from "react";
import { addProject, dayKey } from "../lib/store";
import { Button, Input } from "./ui";
import { duration, money } from "../lib/format";

/**
 * Every project, and how each is actually going.
 *
 * This was a table, and a table was the wrong instrument. Stretched across a
 * desktop it put a project's name at one edge of the window and the number 2 at
 * the other, with eleven hundred pixels of nothing between them — the eye has
 * to travel the whole width to read one row, and five columns of mostly em
 * dashes said less than a sentence would have.
 *
 * Cards instead, because each project is a thing with a state rather than a row
 * in a ledger. They fill the frame at any width, they carry a progress bar that
 * is read rather than calculated, and the one number that means "act now" — how
 * many are late — is the only thing allowed to use the reserved colour.
 */
/**
 * A deadline, said the way a person would say it.
 *
 * "2026-08-13" is a date only a database enjoys. What anybody actually wants
 * from this line is how much room is left, and near dates carry that in words
 * while far ones are better as a date than as "in 47 days".
 */
function sayDue(due, today) {
  if (!due) return null;
  const days = Math.round((new Date(`${due}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000);
  if (days < 0) return `${Math.abs(days)}d late`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  if (days <= 6) return `due in ${days} days`;
  return `due ${new Date(`${due}T00:00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

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
        // The nearest deadline is what tells you which project is next, and it
        // was nowhere in the table.
        due: open.map((t) => t.due).filter(Boolean).sort()[0] ?? null,
        remaining: open.reduce((n, t) => n + (t.estimateMins || 0), 0),
        focused: sessions.filter((s) => s.projectId === p.id).reduce((a, s) => a + s.focusedMs, 0),
        pct: mine.length ? Math.round(((mine.length - open.length) / mine.length) * 100) : 0,
      };
    })
    // Late first, then whatever is due soonest — the order somebody would
    // triage them in, rather than the order they were created.
    .sort((a, b) =>
      b.overdue - a.overdue ||
      (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
      b.open - a.open);

  const live = rows.filter((r) => !r.p.archived);

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">
            {live.length} active
            {live.some((r) => r.overdue > 0) && (
              <span className="alert"> · {live.reduce((n, r) => n + r.overdue, 0)} late</span>
            )}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Projects</h1>
        </div>

        {/* Bounded rather than full-bleed. A project name is a few words, and a
            field eleven hundred pixels wide invites a sentence. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            onOpen(addProject({ name }).id);
            setName("");
          }}
          className="flex w-full gap-2 sm:w-auto"
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New project"
            className="w-full sm:w-64"
          />
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            Create
          </Button>
        </form>
      </header>

      {live.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No projects yet. A project groups work — a deal, a launch, a function.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {live.map(({ p, open, overdue, focused, pct, total, due, remaining }) => (
            <li key={p.id}>
              <button
                onClick={() => onOpen(p.id)}
                className="card flex h-full w-full flex-col px-5 py-4 text-left transition-colors hover:border-[var(--ink)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.name}</p>
                    {(p.client || p.value) && (
                      <p className="mt-0.5 truncate text-[11px] text-[var(--faint)]">
                        {p.client}
                        {p.client && p.value ? " · " : ""}
                        {money(p.value)}
                      </p>
                    )}
                  </div>
                  {/* The only place the reserved colour is spent here: work
                      that is already late is the one state that costs money. */}
                  {overdue > 0 && <span className="alert-chip shrink-0">{overdue} late</span>}
                </div>

                <div className="mt-4 flex items-baseline gap-4">
                  <span>
                    <span className="num text-lg font-semibold">{open}</span>
                    <span className="ml-1 text-xs text-[var(--muted)]">open</span>
                  </span>
                  {remaining > 0 && (
                    <span className="num text-xs text-[var(--muted)]">
                      {duration(remaining * 60000)} left
                    </span>
                  )}
                  {focused > 0 && (
                    <span className="num text-xs text-[var(--faint)]">
                      {duration(focused)} done
                    </span>
                  )}
                </div>

                <div className="mt-3 flex flex-1 items-end gap-3">
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--hairline)]">
                    <span className="block h-full rounded-full bg-[var(--ink)]" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="num w-9 shrink-0 text-right text-[11px] text-[var(--faint)]">
                    {total ? `${pct}%` : "—"}
                  </span>
                </div>

                {due && (
                  <p className={`num mt-2 text-[11px] ${
                    due < today ? "alert" : "text-[var(--muted)]"
                  }`}>
                    {sayDue(due, today)}
                  </p>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
