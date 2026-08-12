import { useEffect, useState, useSyncExternalStore } from "react";
import Today from "./components/Today";
import Calendar from "./components/Calendar";
import Projects from "./components/Projects";
import Purpose from "./components/Purpose";
import ProjectDetail, { UNFILED } from "./components/ProjectDetail";
import Insights from "./components/Insights";
import AssistantSheet from "./components/AssistantSheet";
import Upgrade from "./components/Upgrade";
import Settings from "./components/Settings";
import FocusScreen from "./components/FocusScreen";
import EventDialog from "./components/EventDialog";
import Identity from "./components/Identity";
import Welcome from "./components/Welcome";
import Legal from "./components/Legal";
import CommandPalette from "./components/CommandPalette";
import KeyboardHelp from "./components/KeyboardHelp";
import Undo from "./components/Undo";
import Squirrel from "./components/Squirrel";
import { SidebarNav, BottomNav } from "./components/Nav";
import PlanStrip from "./components/PlanStrip";
import Locked from "./components/Locked";
import { can } from "./lib/plans";
import { fetchUsage } from "./lib/billing";
import {
  subscribe, getState, startFocus, pauseFocus, resumeFocus, endFocus,
  heartbeatFocus, reconcileFocus,
  remainingOf, toggleTask, setSetting, setPlan, setPlanTier, dayKey, undo, activeTasks,
} from "./lib/store";
import { shortcutFor } from "./lib/keys";
import { tap } from "./lib/native";
import { client, configured } from "./lib/supabase";
import { startSync, stopSync, nudge } from "./lib/sync";
import { clearResolver } from "./lib/nlu/fallback";
import { takeRequest, onRequest } from "./lib/intent";
import { publishWidget } from "./lib/widget";
import { distribute } from "./lib/schedule";
import { planOpts } from "./lib/hours";
// Aliased: `pending` is already the task waiting for a focus length in this
// component, and shadowing it silently turns this into a call on null.
import { pending as dueReminders } from "./lib/reminders";
import { sync as syncReminders } from "./lib/notify";
import { duration } from "./lib/format";
import { useIsDesktop } from "./hooks/useMediaQuery";

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
  const [keyHelp, setKeyHelp] = useState(false);
  // The upgrade sheet, and the wall that opened it. `null` is closed; a string
  // is the reason to lead with, because "Upgrade to Pro" answers a question
  // nobody asked and "You've used today's free turns" answers the one they hold.
  const [upgrade, setUpgrade] = useState(null);
  // A sentence handed over from outside — Siri, a Shortcut, a widget, a link.
  const [request, setRequest] = useState(null);
  const [, force] = useState(0);
  const desktop = useIsDesktop();

  const active = state.active;
  const remaining = remainingOf(active);

  /**
   * Sentences handed over from outside the app.
   *
   * Two arrivals, one handler. On the web it is in the URL at load — a
   * bookmark, a Shortcut's "Open URL", a link somebody sent themselves. In the
   * native app it is an event: iOS brings the app forward rather than reloading
   * it, so a URL read only at startup would be read exactly once and never
   * again.
   *
   * Each gets an id, because the sheet must run the same words twice if they
   * are asked twice. "Move it back" is precisely the sentence somebody says
   * again ten seconds later.
   */
  useEffect(() => {
    let n = 0;
    const accept = (req) => {
      if (!req) return;
      // A screen to open, a sentence to run, or both. "squirrel://today" from
      // the Action button carries no words and still means something.
      if (req.route) setView({ name: req.route });
      if (!req.text) return;
      setRequest({ ...req, id: `${Date.now()}-${n++}` });
      setAssistantOpen(true);
    };
    accept(takeRequest());
    return onRequest(accept);
  }, []);

  // Re-render on a fixed cadence so the countdown moves. The timestamp in the
  // store is the source of truth — this only drives repaints, so a throttled
  // background tab loses frames, never time.
  useEffect(() => {
    if (!active) return;
    let lastBeat = 0;
    const id = setInterval(() => {
      force((n) => n + 1);
      // The session's pulse — see reconcileFocus. Every few seconds, not every
      // repaint: it is a localStorage write, and 4Hz would be vandalism.
      const now = Date.now();
      if (now - lastBeat > 5000) {
        lastBeat = now;
        heartbeatFocus(now);
      }
    }, 250);
    return () => clearInterval(id);
  }, [active]);

  useEffect(() => {
    if (active && active.endsAt != null && remaining <= 0) {
      /**
       * Expired long ago means the app was closed when the timer ran out, and
       * crediting the full block stamped "now" wrote fiction into the log —
       * one real minute became 25, dated the next morning. Reconcile settles
       * it at the last heartbeat instead; the fresh expiry a second ago still
       * takes the ordinary path and the ordinary completion screen.
       */
      const f = reconcileFocus() || endFocus();
      if (f && !f.reconciled) setDone(f);
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

  // Anyone who already answered the naming question has been through the old
  // first run and must not be shown the new one.
  //
  // On mount only, and that is the whole point rather than an optimisation:
  // watching `identity` would fire the moment the first step of onboarding
  // saves a name, mark the flow complete, and unmount the two steps after it —
  // which is precisely the bug the `onboarded` flag exists to fix. Only someone
  // who already had a name when the app started is an existing user.
  useEffect(() => {
    const s = getState().settings;
    if (s?.identity && !s?.onboarded) setSetting("onboarded", true);
  }, []);

  // Any local write is worth sending; nudge coalesces the burst from typing.
  useEffect(() => nudge(), [state.projects, state.tasks, state.events]);

  /**
   * Keep the Home Screen and Siri honest.
   *
   * Both read a snapshot the web layer writes, because the planner lives here
   * and a second one in Swift would disagree with it inside a month. Published
   * whenever the plan or the day changes — which is also what makes "hey Siri,
   * what's on today" answerable without launching anything.
   *
   * A no-op in a browser, where the bridge was never installed.
   */
  useEffect(() => {
    publishWidget(state);
  }, [state.blocks, state.events, state.tasks]);

  // Which tier this account is on, from the server rather than from anything
  // the browser could talk itself into. Re-read whenever the session changes,
  // so an upgrade takes effect on return from Stripe without a reload. Signed
  // out reports nothing, which is free — the correct answer.
  useEffect(() => {
    // No backend on this build at all — a local-only or self-hosted copy. There
    // is nothing to buy and nobody to bill, so gating the assistant behind a
    // subscription that cannot be purchased would lock the best part of the app
    // behind a door with no handle. Everything is unlocked instead.
    if (!configured) { setPlanTier("studio"); return; }

    let live = true;
    const load = () =>
      fetchUsage()
        .then((u) => {
          // Only an actual answer changes the tier. A response with no plan in
          // it is a server mid-deploy, not a customer mid-cancel.
          if (live && u?.plan) setPlanTier(u.plan);
        })
        /**
         * A failed fetch keeps the cached tier — it must never downgrade.
         *
         * This catch used to write "free", which turned every network wobble
         * into a repossession: a paying subscriber on a plane was locked out
         * of creating projects and shown an upgrade screen for the plan they
         * already pay for, in an app whose promise is that it works offline.
         * The tier is cached in the store precisely so the last real answer
         * outlives the connection; the server stays the only thing that can
         * genuinely revoke it.
         */
        .catch(() => {});
    load();

    // Coming back from a checkout that happened somewhere else.
    //
    // On the web the redirect reloads the page and this effect runs anyway. In
    // the native app it does not: the purchase happened in Safari, and the app
    // was in the background the whole time. It is only told anything when it is
    // brought forward again — so the return from a universal link, and any
    // return to the foreground, re-reads the plan. Without this the customer
    // pays and comes back to an app that still says Free.
    const onWake = () => { if (!document.hidden) load(); };
    addEventListener("visibilitychange", onWake);
    addEventListener("squirrel:resumed", load);
    return () => {
      live = false;
      removeEventListener("visibilitychange", onWake);
      removeEventListener("squirrel:resumed", load);
    };
  }, [state.settings?.email]);

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
    // activeTasks: an archived project's work is parked, not planned.
    const plan = distribute(activeTasks(state), state.events, state.sessions, planOpts(state.settings));
    const same =
      JSON.stringify(plan.blocks) === JSON.stringify(state.blocks) &&
      JSON.stringify(plan.shortfalls) === JSON.stringify(state.shortfalls) &&
      // Compared too, or a task whose estimate runs out changes nothing the
      // other two can see and the panel that asks about it never appears.
      JSON.stringify(plan.spent) === JSON.stringify(state.spent);
    if (!same) setPlan(plan);
  }, [state.tasks, state.events, state.sessions, state.settings?.hours, state.settings?.workWeekend]);

  // And the device's queue follows the plan. Diffed rather than rebuilt, since
  // a phone holds a limited number of pending notifications.
  useEffect(() => {
    syncReminders(dueReminders(state, state.settings?.reminders));
  }, [state.blocks, state.events, state.tasks, state.shortfalls, state.settings?.reminders]);

  /**
   * The keyboard, dispatched from one place.
   *
   * This was a single inline binding for ⌘K, with the calendar's keys bound
   * separately inside the calendar — which is how a keyboard layer usually
   * exists, and why it is usually undocumented and eventually self-conflicting.
   * `lib/keys.js` holds the bindings as data and the help sheet reads the same
   * list, so the two cannot disagree about what the app answers to.
   *
   * The calendar keeps its own handler, because its keys need its own state:
   * which day is anchored, which scale is showing. What it gains from this is
   * a guarantee that nothing global has quietly claimed one of its letters —
   * test/keys.test.mjs fails if one ever does.
   */
  useEffect(() => {
    const onKey = (e) => {
      /**
       * Nothing global fires during a focus session. The session screen covers
       * the app, but the listeners underneath it stayed live — so Ctrl+Z,
       * reflex of the hand, deleted the very task being worked on, and "n"
       * opened a booking dialog behind a screen that exists to remove exactly
       * that kind of thing.
       */
      if (getState().active) return;
      /**
       * A key a component already consumed is not ours to dispatch again —
       * "/" on the Purpose canvas summons the squirrel there, and must not
       * also open the palette underneath it.
       */
      if (e.defaultPrevented) return;
      // Scope stays null: calendar-scoped bindings are dispatched by the
      // calendar, and matching them here would run them twice.
      const hit = shortcutFor(e, { scope: null });
      if (!hit) return;

      const go = (name) => () => setView({ name });
      const run = {
        search: () => setPalette((p) => !p),
        today: go("today"),
        calendar: go("calendar"),
        projects: go("projects"),
        insights: go("insights"),
        purpose: go("purpose"),
        settings: go("settings"),
        ask: () => setAssistantOpen(true),
        event: () => setNewEvent(true),
        help: () => setKeyHelp((v) => !v),
        undo: () => {
          // Nothing to take back is not an error and not worth saying — the
          // shortcut does nothing, the way it does in every other app.
          if (undo()) tap("success");
        },
      }[hit.id];
      if (!run) return;
      e.preventDefault();
      run();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  /**
   * The one way into search, wherever it is reached from.
   *
   * A screen header on a phone, ⌘K or / on a keyboard, the palette's own
   * button. One handler rather than each screen owning a copy, because the
   * moment there are two entry points there are two behaviours to keep in step.
   */
  const openSearch = () => setPalette(true);

  function finish() {
    const f = endFocus();
    if (f) setDone(f);
  }

  // ------------------------------------------------------------- overlays
  // The first run, which is also the only screen a brand-new user has seen —
  // so it says what the app is while it asks.
  //
  // Gated on an explicit flag rather than on `identity`. Naming was the first
  // question, and answering it used to satisfy this condition immediately:
  // Welcome unmounted the moment the name was saved and the two steps after it
  // never appeared. The flag is set by the last step, so the flow owns when it
  // is finished.
  // Reachable without an account and before the first run: /privacy and /terms
  // are linked from Stripe and the App Store listing, and a policy you can only
  // read after signing up is one nobody can consent to.
  const path = typeof location !== "undefined" ? location.pathname : "/";
  if (path === "/privacy" || path === "/terms") {
    return <Legal page={path.slice(1)} onBack={() => location.assign("/")} />;
  }

  if (!state.settings?.onboarded) {
    return <Welcome onDone={() => setView({ name: "today" })} />;
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
          {duration(done.focusedMs, "under a minute")}
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
        onSearch={openSearch}
        onOpenUnfiled={() => setView({ name: "project", id: UNFILED })}
      />
    ) : view.name === "calendar" ? (
      <Calendar
        state={state}
        onNewEvent={() => setNewEvent(true)}
        onOpenEvent={setEditingEvent}
        onOpenProject={(id) => setView({ name: "project", id })}
        onSearch={openSearch}
      />
    ) : view.name === "projects" ? (
      <Projects
        state={state}
        onOpen={(id) => setView({ name: "project", id })}
        onUpgrade={(reason) => setUpgrade(reason ?? null)}
        onSearch={openSearch}
      />
    ) : view.name === "project" ? (
      <ProjectDetail
        state={state}
        projectId={view.id}
        onBack={() => setView({ name: "projects" })}
        onFocus={setPending}
      />
    ) : view.name === "purpose" ? (
      <Purpose
        state={state}
        onOpenProject={(id) => setView({ name: "project", id })}
        onStart={() => setView({ name: "projects" })}
      />
    ) : view.name === "insights" ? (
      can(state.plan, "insights") ? (
        <Insights state={state} onSearch={openSearch} />
      ) : (
        // The real screen renders underneath, with this over it. Seeing your own
        // week measured — and being one tap from it — sells the upgrade in a way
        // an empty state never could.
        <Locked
          feature="insights"
          title="See where your time actually goes"
          blurb="Insights measures your meetings, focus, and what you finish — the week you planned against the week you had."
          onUpgrade={() => setUpgrade("Insights is on Pro")}
        >
          <Insights state={state} onSearch={openSearch} />
        </Locked>
      )
    ) : view.name === "legal" ? (
      <Legal page={view.page} onBack={() => setView({ name: "settings" })} />
    ) : (
      <Settings
        state={state}
        onBack={() => setView({ name: "today" })}
        onLegal={(page) => setView({ name: "legal", page })}
        onUpgrade={(reason) => setUpgrade(reason ?? null)}
        onKeyboard={() => setKeyHelp(true)}
      />
    );

  // The alert ring on her button means one thing, the same way the colour
  // does: something is overdue or will not fit. Nothing else lights it.
  const todayKey = dayKey();
  const overdue = state.tasks.filter((t) => !t.done && t.due && t.due < todayKey).length;
  const attention = overdue > 0 || (state.shortfalls?.length ?? 0) > 0;

  const isActive = (n) => view.name === n || (n === "projects" && view.name === "project");
  const fullHeight = view.name === "calendar";

  const nav = {
    isActive,
    settingsActive: view.name === "settings",
    onNavigate: (name) => setView({ name }),
    onAskSquirrel: () => setAssistantOpen(true),
    attention,
    state,
    onUpgrade: (reason) => setUpgrade(reason ?? null),
  };

  return (
    <>
      {desktop ? (
        // Desktop: a persistent left rail, the work taking the rest of the
        // frame at full height.
        <div className="flex h-dvh">
          <SidebarNav {...nav} />
          <main className={`sq-safe-top min-w-0 flex-1 ${fullHeight ? "overflow-hidden" : "overflow-y-auto"}`}>
            {body}
          </main>
        </div>
      ) : (
        // Phone: the work fills the height, the bar sits under the thumb.
        <div className="flex h-dvh flex-col">
          <div
            className={`sq-safe-top flex-1 ${fullHeight ? "min-h-0 overflow-hidden" : "overflow-y-auto"}`}
            // A little room at the bottom so the last row clears the raised
            // Squirrel button rather than tucking under it. Full-height views
            // manage their own scroll.
            style={fullHeight ? undefined : { paddingBottom: "3.25rem" }}
          >
            {body}
          </div>
          {/* Only when a limit is genuinely close, and never on Settings —
              where the whole plan is already on the screen below. */}
          {view.name !== "settings" && (
            <PlanStrip state={state} onUpgrade={(reason) => setUpgrade(reason ?? null)} />
          )}
          <BottomNav {...nav} />
        </div>
      )}

      {/* Overlays sit above either chrome; being fixed-positioned, they do not
          care which layout is underneath. */}
      <AssistantSheet
        open={assistantOpen}
        onClose={() => { setAssistantOpen(false); setRequest(null); }}
        request={request}
        state={state}
        onUpgrade={(reason) => setUpgrade(reason ?? null)}
      />

      {/* One destination for every wall in the app. It opens over whatever you
          were doing, so paying does not cost you your place. */}
      <Upgrade
        open={upgrade !== null}
        onClose={() => setUpgrade(null)}
        reason={upgrade || null}
        plan={state.plan}
        email={state.settings?.email || null}
        onAccount={() => setView({ name: "settings" })}
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

      <KeyboardHelp open={keyHelp} onClose={() => setKeyHelp(false)} />

      {/* The way back from whatever just happened. Above everything except the
          sheets, because it is an offer rather than a place — and it has to be
          reachable from the screen the change landed on. */}
      <Undo />
    </>
  );
}

function Centered({ children }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      {children}
    </div>
  );
}
