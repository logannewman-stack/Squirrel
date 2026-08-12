import { useState } from "react";
import Sheet from "./Sheet";
import { Button } from "./ui";
import { PLANS, PAID } from "../lib/plans";
import { startCheckout } from "../lib/billing";

/**
 * The one place an upgrade happens.
 *
 * Every "Upgrade" in this app used to land you at the top of Settings, above
 * eight sections, and leave you to find the plan yourself. That is not a call
 * to action; it is a signpost pointing at a corridor. Somebody who has just
 * hit a wall and *decided* to pay will not scroll to prove it.
 *
 * So there is now a single sheet, reachable from every wall, that shows what
 * the money buys and takes one tap to Stripe. It carries a `reason` — the wall
 * you actually hit — because "Upgrade to Pro" answers a question nobody asked,
 * while "You've used today's free turns" answers the one they are holding.
 */
export default function Upgrade({ open, onClose, reason, plan = "free", email, onAccount }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  // Studio is only an upsell from Pro if Pro is already yours; from free, two
  // columns of features is a decision, and a decision is a delay.
  const offered = plan === "free" ? PAID : PAID.filter((id) => id !== plan);

  async function go(id) {
    setBusy(id);
    setError(null);
    try {
      await startCheckout(id);
    } catch (e) {
      /**
       * "Failed to fetch" is a browser talking to a developer. The person who
       * pressed Pay while offline needs the two facts that matter: nothing was
       * charged, and the rest of the app has not stopped working.
       */
      setError(
        e.message === "not signed in"
          ? "Create an account first — a subscription needs somewhere to live."
          : /fetch|network/i.test(e.message || "")
            ? "You're offline, so the checkout can't open — nothing was charged. Everything else keeps working; try again when you're connected."
            : e.message,
      );
      setBusy(null);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} label="Upgrade your plan" className="max-h-[92dvh]">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-3 sm:px-8">
        <div className="mx-auto w-full max-w-xl">
          {reason && <p className="label">{reason}</p>}
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">
            {reason ? "Pro lifts it" : "Go unlimited"}
          </h2>
          <p className="mt-1.5 text-sm text-[var(--muted)]">
            Billed monthly. Cancel any time, and the free tier keeps working underneath.
          </p>

          <div className="mt-6 flex flex-col gap-3">
            {offered.map((id) => {
              const tier = PLANS[id];
              const lead = id === "pro";
              return (
                <div
                  key={id}
                  className={`card px-5 py-5 ${lead ? "border-[var(--ink)]" : ""}`}
                  style={lead ? { boxShadow: "var(--lift)" } : undefined}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex items-baseline gap-2">
                      <h3 className="text-lg font-semibold tracking-tight">{tier.name}</h3>
                      {tier.popular && (
                        <span className="rounded-full bg-[var(--ink)] px-2 py-0.5 text-[10px]
                                         font-semibold uppercase tracking-wider text-[var(--paper)]">
                          Most people
                        </span>
                      )}
                    </div>
                    <span className="num text-sm text-[var(--muted)]">${tier.price}/month</span>
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted)]">{tier.blurb}</p>

                  <ul className="mt-4 flex flex-col gap-1.5">
                    {tier.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm">
                        <svg viewBox="0 0 24 24" aria-hidden
                             className="mt-[3px] h-3.5 w-3.5 shrink-0 fill-none stroke-current stroke-[2.2]">
                          <path d="M4 12.5l5 5L20 6.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  <Button
                    variant={lead ? "primary" : "secondary"}
                    onClick={() => go(id)}
                    disabled={busy !== null}
                    className="mt-5 w-full"
                  >
                    {busy === id ? "Opening checkout…" : `Get ${tier.name}`}
                  </Button>
                </div>
              );
            })}
          </div>

          {error && (
            <p className="mt-4 rounded-md border border-[var(--alert)] px-4 py-3 text-sm">
              {error}
              {!email && onAccount && (
                <>
                  {" "}
                  <button
                    onClick={() => { onClose(); onAccount(); }}
                    className="font-semibold underline underline-offset-2"
                  >
                    Create one
                  </button>
                </>
              )}
            </p>
          )}

          <p className="mt-5 text-center text-xs text-[var(--faint)]">
            Payment is handled by Stripe — no card details reach this app.
          </p>
        </div>
      </div>
    </Sheet>
  );
}
