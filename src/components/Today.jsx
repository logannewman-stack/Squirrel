import { useState } from "react";
import TaskRow from "./TaskRow";
import { planDay, todaysPlan, MAX_DAILY_TASKS } from "../lib/schedule";
import { planDayWithAI } from "../lib/ai";
import { applyPlan, toggleTask, todayKey } from "../lib/store";
import { duration } from "../lib/format";

export default function Today({ state, onFocus, onOpenSettings }) {
  const { tasks, projects, settings, sessions } = state;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [reasons, setReasons] = useState({});

  const pinned = todaysPlan(tasks);
  const list = pinned.length ? pinned : planDay(tasks).tasks;
  const projectOf = (id) => projects.find((p) => p.id === id);
  const mins = list.reduce((s, t) => s + t.estimateMins, 0);

  const doneToday = tasks.filter(
    (t) => t.done && t.doneAt && todayKey(new Date(t.doneAt)) === todayKey(),
  );
  const focusedToday = sessions
    .filter((s) => todayKey(new Date(s.endedAt)) === todayKey())
    .reduce((sum, s) => sum + s.focusedMs, 0);

  async function build() {
    setBusy(true);
    setNote("");
    setReasons({});
    const open = tasks.filter((t) => !t.done);

    const ai = await planDayWithAI(open, projects, settings.apiKey);
    if (ai) {
      applyPlan(ai.plan.map((p) => p.taskId));
      setReasons(Object.fromEntries(ai.plan.map((p) => [p.taskId, p.reason])));
      setNote(ai.note);
    } else {
      // No key, offline, or the model declined — the deterministic planner is
      // the default path, not an error state.
      applyPlan(planDay(tasks).tasks.map((t) => t.id));
      if (!settings.apiKey) setNote("Planned by rules. Add a key in settings for AI ordering.");
    }
    setBusy(false);
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Today</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {list.length
              ? `${list.length} ${list.length === 1 ? "task" : "tasks"} · about ${duration(mins * 60000)}`
              : "Nothing planned."}
          </p>
        </div>
        <button
          onClick={build}
          disabled={busy}
          className="shrink-0 rounded-full bg-[var(--ink)] px-5 py-2.5 text-sm font-medium
                     text-[var(--paper)] transition-opacity disabled:opacity-40"
        >
          {busy ? "Planning…" : "Plan my day"}
        </button>
      </header>

      {note && <p className="mb-6 text-sm text-[var(--muted)]">{note}</p>}

      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--line)] px-6 py-12 text-center">
          <p className="text-[var(--muted)]">
            No open tasks. Add some to a project, then plan your day.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {list.map((t) => (
            <div key={t.id}>
              <TaskRow
                task={t}
                project={projectOf(t.projectId)}
                showProject
                onToggle={() => toggleTask(t.id)}
                onFocus={() => onFocus(t)}
              />
              {reasons[t.id] && (
                <p className="-mt-1 pb-3 pl-8 text-xs text-[var(--muted)]">{reasons[t.id]}</p>
              )}
            </div>
          ))}
        </ul>
      )}

      {list.length >= MAX_DAILY_TASKS && (
        <p className="mt-6 text-xs text-[var(--muted)]">
          Capped at {MAX_DAILY_TASKS}. The rest are still in their projects — a list you can
          finish beats a list you avoid.
        </p>
      )}

      {(doneToday.length > 0 || focusedToday > 0) && (
        <footer className="mt-10 border-t border-[var(--line)] pt-6 text-sm text-[var(--muted)]">
          {doneToday.length > 0 && (
            <span>
              {doneToday.length} done{focusedToday > 0 ? " · " : ""}
            </span>
          )}
          {focusedToday > 0 && <span>{duration(focusedToday)} focused</span>}
        </footer>
      )}

      {!settings.apiKey && (
        <button
          onClick={onOpenSettings}
          className="mt-8 text-xs text-[var(--muted)] underline-offset-4 hover:underline"
        >
          Set up AI scheduling
        </button>
      )}
    </div>
  );
}
