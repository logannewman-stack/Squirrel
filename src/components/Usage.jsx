import { usage, wallReason } from "../lib/plans";
import { Button } from "./ui";

/**
 * The wide form of the same numbers: what is being used, across the page.
 *
 * The rail card is a narrow column and the phone strip is one line; a settings
 * page is neither, and squeezing a 240px card into a 672px section is how a
 * product starts looking assembled. All three read `usage()` so they cannot
 * disagree about which limit is closest — only about how much room they have
 * to say it.
 *
 * Shown on every plan, unlike the card. Here it is a fact somebody came
 * looking for rather than a notice pushed at them, and "everything unlimited"
 * is a perfectly good answer to a question you asked.
 */
export default function Usage({ state, onUpgrade }) {
  const u = usage(state);

  if (u.plan !== "free" || !u.meters.length) {
    return (
      <p className="text-sm text-[var(--muted)]">
        Projects, tasks, and Squirrel are all unlimited on {u.tier.name}.
      </p>
    );
  }

  return (
    <div>
      <ul className="grid gap-4 sm:grid-cols-3">
        {u.meters.map((m) => {
          const pct = Math.min(100, Math.round((m.used / m.cap) * 100));
          const full = m.used >= m.cap;
          return (
            <li key={m.key}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-[var(--muted)]">{m.label}</span>
                <span className={`num text-xs ${full ? "alert font-semibold" : "text-[var(--faint)]"}`}>
                  {m.used}/{m.cap}
                </span>
              </div>
              <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-[var(--hairline)]">
                <span
                  className="block h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${pct}%`, background: full ? "var(--alert)" : "var(--ink)" }}
                />
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => onUpgrade?.(u.pressing ? wallReason(u.tightest) : null)}>
          Upgrade to Pro
        </Button>
        <p className="min-w-[14rem] flex-1 text-xs text-[var(--muted)]">
          Unlimited projects and tasks, calendar sync, Insights, and Squirrel without a daily cap.
        </p>
      </div>
    </div>
  );
}
