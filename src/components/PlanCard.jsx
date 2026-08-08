import { PLANS, FREE_ASSISTS_PER_DAY, can } from "../lib/plans";
import { assistsToday } from "../lib/store";

/**
 * What plan you are on, what you have left of it, and the way up.
 *
 * The upgrade lived in one place: Settings, below eight other sections, behind
 * a tab nobody opens twice. A person hits a wall on Tuesday, shrugs, and works
 * around it — and the app never mentions it again. So the plan sits in the rail
 * where it is visible without being asked for, and the limits that actually
 * bind are shown as they are consumed rather than announced when they run out.
 *
 * Deliberately quiet when it has nothing to say. A paid account gets one line
 * confirming what it pays for; it does not get a banner. Nagging somebody who
 * has already bought the thing is how an interface loses its credibility for
 * the one moment it genuinely needs to ask.
 */
export default function PlanCard({ state, onUpgrade, onManage, compact = false }) {
  const plan = state.plan ?? "free";
  const paid = plan !== "free";
  const tier = PLANS[plan] ?? PLANS.free;

  const projects = (state.projects || []).filter((p) => !p.archived).length;
  const openTasks = (state.tasks || []).filter((t) => !t.done).length;
  const assists = assistsToday();

  // Only limits that actually bind on this plan. On Pro every one of these is
  // unlimited, and a row reading "unlimited" three times is furniture.
  const meters = paid
    ? []
    : [
        { label: "Projects", used: projects, cap: tier.projects },
        { label: "Open tasks", used: openTasks, cap: tier.tasks },
        ...(can(plan, "assistant")
          ? []
          : [{ label: "Squirrel today", used: assists, cap: FREE_ASSISTS_PER_DAY }]),
      ].filter((m) => m.cap != null);

  // The nearest wall, which is the only one worth leading with.
  const tightest = meters.reduce(
    (worst, m) => (m.used / m.cap > (worst?.used ?? 0) / (worst?.cap ?? 1) ? m : worst),
    null,
  );
  const pressing = tightest && tightest.used / tightest.cap >= 0.6;

  if (paid) {
    return (
      <div className={compact ? "px-2" : "card px-4 py-3"}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{tier.name}</span>
          <button
            onClick={onManage}
            className="text-xs text-[var(--muted)] underline-offset-4 hover:text-[var(--ink)] hover:underline"
          >
            Manage
          </button>
        </div>
        <p className="mt-0.5 text-[11px] text-[var(--muted)]">Everything unlimited.</p>
      </div>
    );
  }

  return (
    <div className={compact ? "" : "card p-4"}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="label">Free plan</span>
        {pressing && (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--alert)]">
            Nearly full
          </span>
        )}
      </div>

      {meters.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2.5">
          {meters.map((m) => {
            const pct = Math.min(100, Math.round((m.used / m.cap) * 100));
            const full = m.used >= m.cap;
            return (
              <li key={m.label}>
                <div className="flex items-baseline justify-between gap-2 text-[11px]">
                  <span className="text-[var(--muted)]">{m.label}</span>
                  <span className={`num ${full ? "alert font-semibold" : "text-[var(--faint)]"}`}>
                    {m.used}/{m.cap}
                  </span>
                </div>
                <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-[var(--hairline)]">
                  <span
                    className="block h-full rounded-full transition-[width] duration-500"
                    style={{
                      width: `${pct}%`,
                      background: full ? "var(--alert)" : "var(--ink)",
                    }}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <button
        onClick={onUpgrade}
        className="mt-4 w-full rounded-lg bg-[var(--ink)] px-3 py-2.5 text-xs font-semibold
                   text-[var(--paper)] transition-opacity hover:opacity-90"
      >
        Upgrade to Pro
      </button>
      <p className="mt-2 text-center text-[10px] leading-relaxed text-[var(--muted)]">
        Unlimited everything, calendar sync, and Squirrel without a daily cap.
      </p>
    </div>
  );
}
