import { useState } from "react";
import TaskRow from "./TaskRow";
import {
  addTask, deleteProject, toggleTask, deleteTask, updateProject, dayKey,
} from "../lib/store";
import { PRIORITIES } from "../lib/store";
import { duration } from "../lib/format";

const ESTIMATES = [15, 30, 60, 120];

export default function ProjectDetail({ state, projectId, onBack, onFocus }) {
  const project = state.projects.find((p) => p.id === projectId);
  const tasks = state.tasks.filter((t) => t.projectId === projectId);

  const [title, setTitle] = useState("");
  const [estimate, setEstimate] = useState(30);
  const [priority, setPriority] = useState("normal");
  const [due, setDue] = useState("");
  const [delegate, setDelegate] = useState("");
  const [tab, setTab] = useState("open");

  if (!project) return null;

  const open = tasks.filter((t) => !t.done && !t.delegatedTo);
  const waiting = tasks.filter((t) => !t.done && t.delegatedTo);
  const done = tasks.filter((t) => t.done);
  const focused = state.sessions
    .filter((s) => s.projectId === project.id)
    .reduce((a, s) => a + s.focusedMs, 0);
  const overdue = open.filter((t) => t.due && t.due < dayKey()).length;

  const shown = tab === "open" ? open : tab === "waiting" ? waiting : done;

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <button onClick={onBack} className="text-xs text-[var(--muted)] hover:text-[var(--ink)]">
        ← Projects
      </button>

      <header className="mb-6 mt-3 flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <input
            defaultValue={project.name}
            onBlur={(e) => updateProject(project.id, { name: e.target.value.trim() || project.name })}
            className="w-full bg-transparent text-2xl font-semibold tracking-tight outline-none"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              defaultValue={project.client}
              onBlur={(e) => updateProject(project.id, { client: e.target.value })}
              placeholder="Client"
              className="rounded border border-[var(--line)] bg-transparent px-2.5 py-1 text-xs
                         outline-none placeholder:text-[var(--faint)] focus:border-[var(--ink)]"
            />
            <input
              type="number"
              defaultValue={project.value ?? ""}
              onBlur={(e) => updateProject(project.id, { value: e.target.value ? Number(e.target.value) : null })}
              placeholder="Value ($)"
              className="w-28 rounded border border-[var(--line)] bg-transparent px-2.5 py-1 text-xs
                         tabular-nums outline-none placeholder:text-[var(--faint)] focus:border-[var(--ink)]"
            />
          </div>
        </div>
        <button
          onClick={() => {
            if (confirm(`Delete "${project.name}" and its ${tasks.length} tasks?`)) {
              deleteProject(project.id);
              onBack();
            }
          }}
          className="shrink-0 text-xs text-[var(--muted)] hover:text-[var(--ink)]"
        >
          Delete
        </button>
      </header>

      <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--line)]
                      bg-[var(--line)] sm:grid-cols-4">
        <Stat label="Open" value={String(open.length)} />
        <Stat label="Overdue" value={String(overdue)} />
        <Stat label="Waiting on" value={String(waiting.length)} />
        <Stat label="Focused" value={duration(focused)} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          addTask({
            projectId, title, estimateMins: estimate, priority,
            due: due || null, delegatedTo: delegate.trim(),
          });
          setTitle("");
          setDue("");
          setDelegate("");
        }}
        className="mb-8 rounded-lg border border-[var(--line)] p-4"
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add work…"
          className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--faint)]"
        />
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--hairline)] pt-3">
          {ESTIMATES.map((m) => (
            <Chip key={m} on={estimate === m} onClick={() => setEstimate(m)}>
              {m >= 60 ? `${m / 60}h` : `${m}m`}
            </Chip>
          ))}
          <span className="mx-1 h-4 w-px bg-[var(--line)]" />
          {PRIORITIES.map((p) => (
            <Chip key={p} on={priority === p} onClick={() => setPriority(p)}>
              {p}
            </Chip>
          ))}
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="rounded border border-[var(--line)] bg-transparent px-2 py-1 text-[11px] outline-none"
          />
          <input
            value={delegate}
            onChange={(e) => setDelegate(e.target.value)}
            placeholder="Delegate to…"
            className="w-28 rounded border border-[var(--line)] bg-transparent px-2 py-1 text-[11px]
                       outline-none placeholder:text-[var(--faint)]"
          />
          <button className="ml-auto rounded-md bg-[var(--ink)] px-4 py-1.5 text-xs font-medium text-[var(--paper)]">
            Add
          </button>
        </div>
      </form>

      <div className="mb-3 flex gap-4 border-b border-[var(--line)]">
        {[
          ["open", `Open ${open.length}`],
          ["waiting", `Waiting ${waiting.length}`],
          ["done", `Done ${done.length}`],
        ].map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 pb-2 text-xs transition-colors ${
              tab === k ? "border-[var(--ink)] font-medium" : "border-transparent text-[var(--muted)]"
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="py-6 text-sm text-[var(--muted)]">Nothing here.</p>
      ) : (
        <ul className="divide-y divide-[var(--hairline)]">
          {shown.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              onToggle={() => toggleTask(t.id)}
              onFocus={() => onFocus(t)}
              onDelete={() => deleteTask(t.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Chip({ on, children, ...rest }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={`rounded border px-2.5 py-1 text-[11px] capitalize transition-colors ${
        on ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]" : "border-[var(--line)] hover:border-[var(--ink)]"
      }`}
      {...rest}
    >
      {children}
    </button>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-[var(--paper)] px-4 py-3">
      <p className="label">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight">{value}</p>
    </div>
  );
}
