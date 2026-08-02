import { useState } from "react";
import Calendar from "./Calendar";
import TaskRow from "./TaskRow";
import { addTask, deleteProject, toggleTask, deleteTask, renameProject } from "../lib/store";
import { planDay } from "../lib/schedule";
import { duration } from "../lib/format";

const ESTIMATES = [5, 15, 25, 45, 90];

export default function ProjectDetail({ state, projectId, onBack, onFocus }) {
  const project = state.projects.find((p) => p.id === projectId);
  const tasks = state.tasks.filter((t) => t.projectId === projectId);

  const [title, setTitle] = useState("");
  const [estimate, setEstimate] = useState(25);
  const [due, setDue] = useState("");
  const [day, setDay] = useState(null);
  const [editing, setEditing] = useState(false);

  if (!project) return null;

  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  // Same planner as the cross-project view, scoped to this project — so the
  // project's own "what today looks like" matches how Today would order it.
  const suggested = planDay(tasks).tasks;
  const shown = day ? tasks.filter((t) => t.due === day) : open;

  function submit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    addTask({ projectId, title, estimateMins: estimate, due: due || null });
    setTitle("");
    setDue("");
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <header className="mb-8">
        <button
          onClick={onBack}
          className="text-sm text-[var(--muted)] underline-offset-4 hover:underline"
        >
          ← Projects
        </button>

        <div className="mt-4 flex items-start justify-between gap-4">
          {editing ? (
            <input
              autoFocus
              defaultValue={project.name}
              onBlur={(e) => {
                renameProject(project.id, e.target.value.trim() || project.name);
                setEditing(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              className="flex-1 border-b-2 border-[var(--ink)] bg-transparent pb-1
                         text-3xl font-semibold tracking-tight outline-none"
            />
          ) : (
            <h1
              onClick={() => setEditing(true)}
              className="flex-1 cursor-text text-3xl font-semibold tracking-tight"
            >
              {project.name}
            </h1>
          )}
          <button
            onClick={() => {
              if (confirm(`Delete "${project.name}" and its ${tasks.length} tasks?`)) {
                deleteProject(project.id);
                onBack();
              }
            }}
            className="shrink-0 pt-2 text-sm text-[var(--muted)] underline-offset-4 hover:underline"
          >
            Delete
          </button>
        </div>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {open.length} open · {done.length} done
        </p>
      </header>

      <section className="mb-10 rounded-2xl border border-[var(--line)] p-5">
        <Calendar tasks={tasks} selected={day} onPickDay={setDay} />
      </section>

      {!day && suggested.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-1 text-sm font-medium uppercase tracking-widest text-[var(--muted)]">
            Suggested for today
          </h2>
          <p className="mb-3 text-xs text-[var(--muted)]">
            About {duration(suggested.reduce((s, t) => s + t.estimateMins, 0) * 60000)}
          </p>
          <ul className="divide-y divide-[var(--line)]">
            {suggested.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                onToggle={() => toggleTask(t.id)}
                onFocus={() => onFocus(t)}
              />
            ))}
          </ul>
        </section>
      )}

      <form onSubmit={submit} className="mb-8 space-y-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task"
          className="w-full border-b-2 border-[var(--line)] bg-transparent pb-2 outline-none
                     transition-colors placeholder:text-[var(--muted)] focus:border-[var(--ink)]"
        />
        <div className="flex flex-wrap items-center gap-2">
          {ESTIMATES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setEstimate(m)}
              aria-pressed={estimate === m}
              className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                estimate === m
                  ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
                  : "border-[var(--line)] hover:border-[var(--ink)]"
              }`}
            >
              {m}m
            </button>
          ))}
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="rounded-full border border-[var(--line)] bg-transparent px-3 py-1.5 text-xs outline-none"
          />
          <button
            type="submit"
            className="ml-auto rounded-full bg-[var(--ink)] px-5 py-2 text-sm text-[var(--paper)]"
          >
            Add
          </button>
        </div>
      </form>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-widest text-[var(--muted)]">
            {day ? `Due ${day}` : "All open"}
          </h2>
          {day && (
            <button
              onClick={() => setDay(null)}
              className="text-xs text-[var(--muted)] underline-offset-4 hover:underline"
            >
              Clear
            </button>
          )}
        </div>

        {shown.length === 0 ? (
          <p className="py-6 text-[var(--muted)]">Nothing here.</p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
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

        {done.length > 0 && !day && (
          <details className="mt-8">
            <summary className="cursor-pointer text-sm text-[var(--muted)]">
              {done.length} done
            </summary>
            <ul className="mt-2 divide-y divide-[var(--line)]">
              {done.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  onToggle={() => toggleTask(t.id)}
                  onDelete={() => deleteTask(t.id)}
                />
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
