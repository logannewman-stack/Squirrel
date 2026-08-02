import { useEffect, useState, useSyncExternalStore } from "react";
import Today from "./components/Today";
import Projects from "./components/Projects";
import ProjectDetail from "./components/ProjectDetail";
import Settings from "./components/Settings";
import FocusScreen from "./components/FocusScreen";
import {
  subscribe, getState, startFocus, pauseFocus, resumeFocus, endFocus,
  remainingOf, toggleTask,
} from "./lib/store";
import { duration } from "./lib/format";

/**
 * Closing copy. Every branch is neutral or warm — nothing implies the session
 * should have been longer. A short session is a success: the product's job is
 * to make starting cheap, and punishing a two-minute attempt is the fastest way
 * to make the next one not happen.
 */
function closingLine(focusedMs, plannedMs) {
  if (focusedMs >= plannedMs) return "You did the whole thing.";
  if (focusedMs >= plannedMs * 0.6) return "That's a solid stretch.";
  if (focusedMs >= plannedMs * 0.25) return "That counts.";
  if (focusedMs >= 60000) return "Short one. Still counts.";
  return "Starting was the hard part.";
}

const LENGTHS = [
  { ms: 5 * 60000, label: "Just 5" },
  { ms: 15 * 60000, label: "15m" },
  { ms: 25 * 60000, label: "25m" },
  { ms: 45 * 60000, label: "45m" },
];

export default function App() {
  const state = useSyncExternalStore(subscribe, getState);
  const [view, setView] = useState({ name: "today" });
  const [pending, setPending] = useState(null); // task awaiting a length choice
  const [done, setDone] = useState(null);
  const [, force] = useState(0);

  const active = state.active;

  // Re-render on a fixed cadence so the countdown moves. The timestamp in the
  // store is the source of truth — this only drives repaints, so a throttled
  // background tab loses frames, never time.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [active]);

  // Auto-finish when the clock runs out.
  const remaining = remainingOf(active);
  useEffect(() => {
    if (active && active.endsAt != null && remaining <= 0) {
      const finished = endFocus();
      if (finished) setDone(finished);
    }
  }, [active, remaining]);

  function finish() {
    const finished = endFocus();
    if (finished) setDone(finished);
  }

  // ------------------------------------------------------------- overlays
  if (active) {
    return (
      <FocusScreen
        label={active.label}
        remainingMs={remaining}
        paused={active.endsAt == null}
        onPause={pauseFocus}
        onResume={resumeFocus}
        onUnfocus={finish}
      />
    );
  }

  if (done) {
    const task = state.tasks.find((t) => t.id === done.taskId);
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6 text-center">
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            {closingLine(done.focusedMs, done.plannedMs)}
          </h1>
          <p className="text-lg text-[var(--muted)]">
            {duration(done.focusedMs)} focused{done.label ? ` on ${done.label}` : ""}.
          </p>
        </div>
        <div className="flex w-full max-w-sm flex-col gap-3">
          {task && !task.done && (
            <button
              onClick={() => {
                toggleTask(task.id);
                setDone(null);
              }}
              className="w-full rounded-full bg-[var(--ink)] py-4 text-base font-medium text-[var(--paper)]"
            >
              Mark it done
            </button>
          )}
          <button
            onClick={() => {
              setPending(task || { title: done.label });
              setDone(null);
            }}
            className="w-full rounded-full border border-[var(--line)] py-4 text-base
                       transition-colors hover:border-[var(--ink)]"
          >
            Go again
          </button>
          <button
            onClick={() => setDone(null)}
            className="py-2 text-sm text-[var(--muted)] underline-offset-4 hover:underline"
          >
            Done for now
          </button>
        </div>
      </div>
    );
  }

  if (pending) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
        <p className="max-w-md text-center text-xl">{pending.title}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {LENGTHS.map((l) => (
            <button
              key={l.ms}
              onClick={() => {
                startFocus({ taskId: pending.id ?? null, label: pending.title, plannedMs: l.ms });
                setPending(null);
              }}
              className="rounded-full border border-[var(--line)] px-6 py-3
                         transition-colors hover:border-[var(--ink)]"
            >
              {l.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setPending(null)}
          className="text-sm text-[var(--muted)] underline-offset-4 hover:underline"
        >
          Cancel
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------- views
  const body =
    view.name === "today" ? (
      <Today state={state} onFocus={setPending} onOpenSettings={() => setView({ name: "settings" })} />
    ) : view.name === "projects" ? (
      <Projects state={state} onOpen={(id) => setView({ name: "project", id })} />
    ) : view.name === "project" ? (
      <ProjectDetail
        state={state}
        projectId={view.id}
        onBack={() => setView({ name: "projects" })}
        onFocus={setPending}
      />
    ) : (
      <Settings state={state} onBack={() => setView({ name: "today" })} />
    );

  const tab = (name, label) => (
    <button
      onClick={() => setView({ name })}
      aria-current={view.name === name || (name === "projects" && view.name === "project")}
      className={`px-4 py-2 text-sm transition-colors ${
        view.name === name || (name === "projects" && view.name === "project")
          ? "text-[var(--ink)]"
          : "text-[var(--muted)] hover:text-[var(--ink)]"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-dvh pb-24">
      {body}
      <nav
        className="fixed inset-x-0 bottom-0 flex items-center justify-center gap-2 border-t
                   border-[var(--line)] bg-[var(--paper)] py-3"
      >
        {tab("today", "Today")}
        {tab("projects", "Projects")}
        {tab("settings", "Settings")}
      </nav>
    </div>
  );
}
