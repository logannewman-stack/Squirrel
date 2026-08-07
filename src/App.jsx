import { useEffect, useState, useSyncExternalStore } from "react";
import Today from "./components/Today";
import Calendar from "./components/Calendar";
import Projects from "./components/Projects";
import ProjectDetail from "./components/ProjectDetail";
import Insights from "./components/Insights";
import AssistantFab from "./components/AssistantFab";
import AssistantSheet from "./components/AssistantSheet";
import Settings from "./components/Settings";
import FocusScreen from "./components/FocusScreen";
import EventDialog from "./components/EventDialog";
import Identity from "./components/Identity";
import CommandPalette from "./components/CommandPalette";
import Squirrel from "./components/Squirrel";
import {
  subscribe, getState, startFocus, pauseFocus, resumeFocus, endFocus,
  remainingOf, toggleTask, setSetting, setPlan, dayKey,
} from "./lib/store";
import { client, configured } from "./lib/supabase";
import { startSync, stopSync, nudge } from "./lib/sync";
import { clearResolver } from "./lib/nlu/fallback";
import { distribute } from "./lib/schedule";
import { planOpts } from "./lib/hours";
// Aliased: `pending` is already the task waiting for a focus length in this
// component, and shadowing it silently turns this into a call on null.
import { pending as dueReminders } from "./lib/reminders";
import { sync as syncReminders } from "./lib/notify";
import { duration } from "./lib/format";

/**
 * Closing copy. Every branch is neutral — nothing implies the session should
 * have been longer. Punishing a short session is the fastest way to make the
 * next one not happen.
 */
function closingLine(focusedMs, plannedMs) {
  if (focusedMs >= plannedMs) return "Session complete.";
  if (focusedMs >= plannedMs * 0.6) return "Solid stretch.";
  if (focusedMs >= plannedMs * 0.25) return "That counts.";
  return "Logged.";
}

const LENGTHS = [15, 25, 45, 90];

const TABS = [
  ["today", "Today", "M4 7h16M4 12h16M4 17h10"],
  ["calendar", "Calendar", "M4 8h16M4 8a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V8zM9 4v4M15 4v4"],
  ["projects", "Projects", "M4 7a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2V7z"],
  ["insights", "Insights", "M5 19V11M10 19V5M15 19v-6M20 19v-9"],
];

export default function App() {
  const state = useSyncExternalStore(subscribe, getState);
  const [view, setView] = useState({ name: "today" });
  const [pending, setPending] = useState(null);
  const [done, setDone] = useState(null);
  const [newEvent, setNewEvent] = useState(false);
  // The event being edited, if any. One dialog does both jobs.
  const [editingEvent, setEditingEvent] = useState(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [, force] = useState(0);

  const active = state.active;
  const remaining = remainingOf(active);

  // Re-render on a fixed cadence so the countdown moves. The timestamp in the
  // store is the source of truth — this only drives repaints, so a throttled
  // background tab loses frames, never time.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [active]);

  useEffect(() => {
    if (active && active.endsAt != null && remaining <= 0) {
      const f = endFocus();
      if (f) setDone(f);
    }
  }, [active, remaining]);

  // Sync follows the session: nothing runs signed out, and signing out stops
  // it immediately rather than at the next poll.
  useEffect(() => {
    if (!configured) return;
    const apply = (session) => {
      setSetting("email", session?.user?.email || null);
      if (session) startSync();
      else stopSync();
    };
    let unsubscribe = () => {};
    client().then(async (supabase) => {
      const { data } = await supabase.auth.getSession();
      apply(data.session);
      const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => apply(session));
      unsubscribe = () => sub.subscription.unsubscribe();
    });
    return () => {
      unsubscribe();
      stopSync();
    };
  }, []);

  // Any local write is worth sending; nudge coalesces the burst from typing.
  useEffect(() => nudge(), [state.projects, state.tasks, state.events]);

  // The fallback is a socket in the assistant, and this is the only thing that
  // ever plugs anything into it. Off unless asked for, so the default build
  // makes no network call and costs nothing per message.
  useEffect(() => {
    if (state.settings?.fallback !== true) {
      clearResolver();
      return;
    }
    let live = true;
    import("./lib/nlu/remote").then((m) => {
      if (live) m.enableRemote();
    });
    return () => {
      live = false;
      clearResolver();
    };
  }, [state.settings?.fallback]);

  // The plan is derived, so it is recomputed rather than stored by hand:
  // whenever the work, the meetings, or the working day itself moves, the
  // distribution moves with them. `settings.hours` is in the dependency list
  // for exactly that reason — changing your finish time has to re-plan the
  // week, or the panel is decoration.
  useEffect(() => {
    const plan = distribute(state.tasks, state.events, state.sessions, planOpts(state.settings));
    const same =
      JSON.stringify(plan.blocks) === JSON.stringify(state.blocks) &&
      JSON.stringify(plan.shortfalls) === JSON.stringify(state.shortfalls);
    if (!same) setPlan(plan);
  }, [state.tasks, state.events, state.sessions, state.settings?.hours, state.settings?.workWeekend]);

  // And the device's queue follows the plan. Diffed rather than rebuilt, since
  // a phone holds a limited number of pending notifications.
  useEffect(() => {
    syncReminders(dueReminders(state, state.settings?.reminders));
  }, [state.blocks, state.events, state.tasks, state.shortfalls, state.settings?.reminders]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  function finish() {
    const f = endFocus();
    if (f) setDone(f);
  }

  // ------------------------------------------------------------- overlays
  // Asked once, before anything else — the assistant greets by name and has
  // nothing to greet with until this is answered.
  if (!state.settings?.identity) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6">
        <Identity value={{}} onDone={() => setView({ name: "today" })} />
      </div>
    );
  }

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
      <Centered>
        <Squirrel size={56} className="mb-4" />
        <p className="label">{closingLine(done.focusedMs, done.plannedMs)}</p>
        <h1 className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">
          {duration(done.focusedMs)}
        </h1>
        {done.label && <p className="mt-1 text-sm text-[var(--muted)]">{done.label}</p>}
        <div className="mt-8 flex w-full max-w-xs flex-col gap-2">
          {task && !task.done && (
            <button
              onClick={() => {
                toggleTask(task.id);
                setDone(null);
              }}
              className="rounded-md bg-[var(--ink)] py-3 text-sm font-medium text-[var(--paper)]"
            >
              Mark done
            </button>
          )}
          <button
            onClick={() => {
              setPending(task || { title: done.label });
              setDone(null);
            }}
            className="rounded-md border border-[var(--line)] py-3 text-sm transition-colors hover:border-[var(--ink)]"
          >
            Another session
          </button>
          <button onClick={() => setDone(null)} className="py-2 text-xs text-[var(--muted)]">
            Back to work
          </button>
        </div>
      </Centered>
    );
  }

  if (pending) {
    return (
      <Centered>
        <p className="label">Focus on</p>
        <p className="mt-2 max-w-md text-center text-xl">{pending.title}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {LENGTHS.map((m) => (
            <button
              key={m}
              onClick={() => {
                startFocus({ taskId: pending.id ?? null, label: pending.title, plannedMs: m * 60000 });
                setPending(null);
              }}
              className="rounded-md border border-[var(--line)] px-6 py-3 text-sm tabular-nums
                         transition-colors hover:border-[var(--ink)]"
            >
              {m >= 60 ? `${m / 60}h` : `${m}m`}
            </button>
          ))}
        </div>
        <button onClick={() => setPending(null)} className="mt-8 text-xs text-[var(--muted)]">
          Cancel
        </button>
      </Centered>
    );
  }

  // ---------------------------------------------------------------- views
  const body =
    view.name === "today" ? (
      <Today
        state={state}
        onFocus={setPending}
        onNewEvent={() => setNewEvent(true)}
        onOpenEvent={setEditingEvent}
      />
    ) : view.name === "calendar" ? (
      <Calendar
        state={state}
        onNewEvent={() => setNewEvent(true)}
        onOpenEvent={setEditingEvent}
      />
    ) : view.name === "projects" ? (
      <Projects state={state} onOpen={(id) => setView({ name: "project", id })} />
    ) : view.name === "project" ? (
      <ProjectDetail
        state={state}
        projectId={view.id}
        onBack={() => setView({ name: "projects" })}
        onFocus={setPending}
      />
    ) : view.name === "insights" ? (
      <Insights state={state} />
    ) : (
      <Settings state={state} onBack={() => setView({ name: "today" })} />
    );

  // The alert ring on her button means one thing, the same way the colour
  // does: something is overdue or will not fit. Nothing else lights it.
  const todayKey = dayKey();
  const overdue = state.tasks.filter((t) => !t.done && t.due && t.due < todayKey).length;
  const attention = overdue > 0 || (state.shortfalls?.length ?? 0) > 0;
  const anyModal = assistantOpen || newEvent || Boolean(editingEvent) || palette;

  const isActive = (n) => view.name === n || (n === "projects" && view.name === "project");
  const fullHeight = view.name === "calendar";

  return (
    <div className="flex h-dvh flex-col">
      <div className={`flex-1 ${fullHeight ? "min-h-0 overflow-hidden" : "overflow-y-auto"}`}>
        {body}
      </div>

      {/* Flexible rather than fixed-width tabs: six at a 64px minimum overflow a
          390px phone, which scrolls the whole page sideways. */}
      <nav className="flex shrink-0 items-center justify-center gap-0.5 border-t border-[var(--line)]
                      bg-[var(--paper)] px-2 py-2 sm:gap-1 sm:px-4">
        {TABS.map(([name, label, d]) => (
          <button
            key={name}
            onClick={() => setView({ name })}
            aria-current={isActive(name)}
            className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-md px-1 py-1.5
                        transition-colors sm:max-w-[76px] sm:px-3 ${
                          isActive(name) ? "text-[var(--ink)]" : "text-[var(--faint)] hover:text-[var(--muted)]"
                        }`}
          >
            {d ? (
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-none stroke-current stroke-[1.6]">
                <path d={d} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <Squirrel size={19} className="sq-tab" />
            )}
            <span className="w-full truncate text-center text-[10px] font-medium">{label}</span>
          </button>
        ))}
        <span className="mx-1 h-6 w-px bg-[var(--line)]" />
        <button
          onClick={() => setView({ name: "settings" })}
          aria-current={view.name === "settings"}
          className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-md px-1 py-1.5 sm:max-w-[76px] sm:px-3 ${
            view.name === "settings" ? "text-[var(--ink)]" : "text-[var(--faint)] hover:text-[var(--muted)]"
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-none stroke-current stroke-[1.6]">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" strokeLinecap="round" />
          </svg>
          <span className="w-full truncate text-center text-[10px] font-medium">Settings</span>
        </button>
      </nav>

      <AssistantFab
        onClick={() => setAssistantOpen(true)}
        hidden={anyModal}
        attention={attention}
      />
      <AssistantSheet
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        state={state}
      />

      {(newEvent || editingEvent) && (
        <EventDialog
          event={editingEvent}
          onClose={() => { setNewEvent(false); setEditingEvent(null); }}
        />
      )}
      {palette && (
        <CommandPalette
          state={state}
          onClose={() => setPalette(false)}
          onNavigate={setView}
          onFocusTask={setPending}
          onNewEvent={() => setNewEvent(true)}
        />
      )}
    </div>
  );
}

function Centered({ children }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      {children}
    </div>
  );
}
