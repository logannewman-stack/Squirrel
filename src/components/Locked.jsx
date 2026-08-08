import { PLANS, unlocks } from "../lib/plans";
import { Button } from "./ui";

/**
 * A feature you can see but not yet use.
 *
 * Hiding paid features from free accounts is the intuitive design and the wrong
 * one: nobody upgrades for something they have never seen. So the real screen
 * renders underneath — real controls, real layout, the actual thing — and this
 * lays a lock over it. What is being sold is legible at a glance, which is the
 * entire job.
 *
 * The content underneath is inert rather than merely dimmed: `inert` takes it
 * out of the tab order and stops clicks reaching it, so a locked panel cannot
 * be operated with a keyboard or a devtools console poke. The real enforcement
 * for anything that costs money still lives on the server.
 */
export default function Locked({ feature, children, title, blurb, onUpgrade, compact = false }) {
  const tier = PLANS[unlocks(feature)] ?? PLANS.pro;

  return (
    <div className="relative">
      {/* Shown, not operable. */}
      <div inert="" aria-hidden="true" className="pointer-events-none select-none opacity-40 blur-[1.5px]">
        {children}
      </div>

      <div className="absolute inset-0 grid place-items-center p-4">
        <div
          className={`card w-full text-center ${compact ? "max-w-xs px-5 py-5" : "max-w-sm px-6 py-7"}`}
          style={{ boxShadow: "var(--float)" }}
        >
          <span className="mx-auto grid h-9 w-9 place-items-center rounded-full bg-[var(--ink)]">
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-none stroke-[var(--paper)] stroke-[1.8]">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 018 0v3" strokeLinecap="round" />
            </svg>
          </span>

          <h3 className="mt-3 text-base font-semibold tracking-tight">{title}</h3>
          {blurb && <p className="mt-1.5 text-sm text-[var(--muted)]">{blurb}</p>}

          <Button variant="primary" onClick={onUpgrade} className="mt-4 w-full">
            Upgrade to {tier.name} · ${tier.price}/mo
          </Button>
          <p className="mt-2 text-xs text-[var(--faint)]">Cancel any time</p>
        </div>
      </div>
    </div>
  );
}
