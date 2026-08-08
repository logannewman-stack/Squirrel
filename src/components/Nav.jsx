import Squirrel from "./Squirrel";
import PlanCard from "./PlanCard";

/**
 * The navigation, in the two shapes the app wears.
 *
 * One set of destinations, rendered either as the phone's bottom bar or the
 * desktop's side rail. Squirrel is deliberately not in the destination list —
 * she is a thing you ask, not a place you go — so each layout gives her her own
 * prominent button rather than a tab lost among tabs. Both shapes expose the
 * same accessible names ("Ask Squirrel", "Calendar", "Settings", …) so the
 * whole app can switch chrome under the tests without moving their targets.
 */

// [name, label, icon path]
const ITEMS = [
  ["today", "Today", "M4 7h16M4 12h16M4 17h10"],
  ["calendar", "Calendar", "M4 8h16M4 8a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V8zM9 4v4M15 4v4"],
  ["projects", "Projects", "M4 7a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2V7z"],
  ["insights", "Insights", "M5 19V11M10 19V5M15 19v-6M20 19v-9"],
];

const SETTINGS_ICON = (
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" strokeLinecap="round" />
  </>
);

function LineIcon({ d, className = "h-[18px] w-[18px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} fill-none stroke-current stroke-[1.6]`}>
      {typeof d === "string" ? <path d={d} strokeLinecap="round" strokeLinejoin="round" /> : d}
    </svg>
  );
}

/* --------------------------------------------------------------- phone: bar
   Five destinations flanking one action. Squirrel takes the middle, raised
   onto her own disc, because the assistant is the thing you *do* here. The side
   tabs stay flexible — six fixed 64px targets overflow a 390px phone and scroll
   the page sideways. */
export function BottomNav({ isActive, settingsActive, onNavigate, onAskSquirrel, attention }) {
  const tab = ([name, label, d]) => (
    <button
      key={name}
      onClick={() => onNavigate(name)}
      aria-current={isActive(name)}
      className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-md px-1 py-1.5 transition-colors sm:max-w-[76px] sm:px-3 ${
        isActive(name) ? "text-[var(--ink)]" : "text-[var(--faint)] hover:text-[var(--muted)]"
      }`}
    >
      <LineIcon d={d} />
      <span className="w-full truncate text-center text-[10px] font-medium">{label}</span>
    </button>
  );

  return (
    <nav className="flex shrink-0 items-end justify-center gap-0.5 border-t border-[var(--line)] bg-[var(--paper)] px-2 pb-2 pt-1.5 sm:gap-1 sm:px-4">
      {ITEMS.slice(0, 2).map(tab)}

      <button
        onClick={onAskSquirrel}
        aria-label="Ask Squirrel"
        title="Ask Squirrel"
        className="group flex w-16 shrink-0 flex-col items-center gap-1 pb-1.5"
      >
        <span className="sq-fab relative -mt-5 grid h-14 w-14 place-items-center rounded-full bg-[var(--ink)] shadow-[var(--float)] ring-1 ring-black/5 transition-transform group-active:scale-95 group-hover:shadow-[0_16px_40px_-8px_rgba(9,9,11,0.28)]">
          {attention && <span aria-hidden className="sq-fab-ring absolute inset-0 rounded-full border-2 border-[var(--alert)]" />}
          <Squirrel size={30} className="sq-fab" title="Squirrel" />
          {/* The quiet half of the same signal: a solid dot when there is
              something to see. */}
          {attention && <span aria-hidden className="absolute right-0 top-0 h-3.5 w-3.5 rounded-full border-2 border-[var(--paper)] bg-[var(--alert)]" />}
        </span>
        <span className="text-[10px] font-medium text-[var(--ink)]">Squirrel</span>
      </button>

      {ITEMS.slice(2).map(tab)}

      <span className="mx-1 h-6 w-px self-center bg-[var(--line)]" />
      <button
        onClick={() => onNavigate("settings")}
        aria-current={settingsActive}
        className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-md px-1 py-1.5 sm:max-w-[76px] sm:px-3 ${
          settingsActive ? "text-[var(--ink)]" : "text-[var(--faint)] hover:text-[var(--muted)]"
        }`}
      >
        <LineIcon d={SETTINGS_ICON} />
        <span className="w-full truncate text-center text-[10px] font-medium">Settings</span>
      </button>
    </nav>
  );
}

/* ------------------------------------------------------------- desktop: rail
   A fixed left column. The bottom bar is right for a thumb; a mouse and a wide
   screen want a persistent rail and the width back for the work. Squirrel is
   the first thing in it — a full "Ask Squirrel" button, not an icon to decode —
   because on desktop there is room to name the action, not just draw it. */
export function SidebarNav({ isActive, settingsActive, onNavigate, onAskSquirrel, attention, state, onUpgrade }) {
  const item = ([name, label, d]) => (
    <button
      key={name}
      onClick={() => onNavigate(name)}
      aria-current={isActive(name)}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
        isActive(name)
          ? "bg-[var(--hover)] font-medium text-[var(--ink)]"
          : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
      }`}
    >
      <LineIcon d={d} className="h-[18px] w-[18px] shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );

  return (
    <aside className="flex h-dvh w-60 shrink-0 flex-col border-r border-[var(--line)] bg-[var(--paper)] px-3 py-4">
      <div className="flex items-center gap-2 px-2 pb-4">
        <Squirrel size={24} className="sq-tab" title="Squirrel" />
        <span className="text-[15px] font-semibold tracking-tight">Squirrel</span>
      </div>

      <button
        onClick={onAskSquirrel}
        aria-label="Ask Squirrel"
        title="Ask Squirrel"
        className="group relative mb-5 flex items-center gap-2.5 rounded-xl bg-[var(--ink)] px-2.5 py-2 text-left text-[var(--paper)] shadow-[var(--lift)] transition-transform active:scale-[0.98]"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full ring-1 ring-white/10">
          <Squirrel size={22} className="sq-fab" title="Squirrel" />
        </span>
        <span className="text-sm font-medium">Ask Squirrel</span>
        {attention && (
          <span aria-hidden className="absolute right-2.5 top-2.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--ink)] bg-[var(--alert)]" />
        )}
      </button>

      <nav className="flex flex-1 flex-col gap-0.5">{ITEMS.map(item)}</nav>

      {/* The plan, where it can be seen without being looked for. It used to
          live below eight sections of Settings, which meant somebody hit a wall
          on Tuesday, worked around it, and never heard about the way past it
          again. */}
      {state && (
        <div className="mb-2 mt-4">
          <PlanCard state={state} onUpgrade={onUpgrade} onManage={() => onNavigate("settings")} />
        </div>
      )}

      <button
        onClick={() => onNavigate("settings")}
        aria-current={settingsActive}
        className={`mt-2 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
          settingsActive ? "bg-[var(--hover)] font-medium text-[var(--ink)]" : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
        }`}
      >
        <LineIcon d={SETTINGS_ICON} className="h-[18px] w-[18px] shrink-0" />
        <span>Settings</span>
      </button>
    </aside>
  );
}
