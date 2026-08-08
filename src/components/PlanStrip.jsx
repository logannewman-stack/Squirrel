import { usage, wallReason } from "../lib/plans";
import { assistsToday } from "../lib/store";

/**
 * The phone's version of the rail's plan card: one line, above the bar.
 *
 * A phone has no room for a persistent panel, so the desktop card cannot simply
 * be moved here — and a plan advert pinned over every screen, every day, is the
 * fastest way to teach somebody to stop reading the top of the app.
 *
 * So this appears only when a limit is genuinely close: it is a notice about
 * the state of the account rather than a pitch, and it disappears again on its
 * own once there is room. Free accounts with plenty left see nothing at all,
 * and paid accounts never see it.
 */
export default function PlanStrip({ state, onUpgrade }) {
  const u = usage(state, assistsToday());
  if (u.plan !== "free" || !u.pressing || !u.tightest) return null;

  const m = u.tightest;
  const pct = Math.min(100, Math.round((m.used / m.cap) * 100));

  return (
    // The raised Squirrel button overhangs the bar by 20px and lands in the
    // middle of this row, so the padding lifts the content clear of it rather
    // than running the sentence under a black disc.
    <button
      onClick={() => onUpgrade?.(wallReason(m))}
      className="flex w-full shrink-0 items-center gap-3 border-t border-[var(--hairline)]
                 bg-[var(--sunken)] px-4 pb-6 pt-2 text-left"
    >
      <span className="h-1 w-10 shrink-0 overflow-hidden rounded-full bg-[var(--hairline)]">
        <span
          className="block h-full rounded-full"
          style={{ width: `${pct}%`, background: u.full ? "var(--alert)" : "var(--ink)" }}
        />
      </span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--muted)]">
        <span className={`num font-semibold ${u.full ? "alert" : "text-[var(--ink)]"}`}>
          {m.used}/{m.cap}
        </span>{" "}
        {m.label.toLowerCase()} on the free plan
      </span>
      <span className="shrink-0 text-[11px] font-semibold text-[var(--ink)] underline underline-offset-2">
        Upgrade
      </span>
    </button>
  );
}
