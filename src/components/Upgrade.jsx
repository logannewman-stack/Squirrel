import { useState } from "react";
import Sheet from "./Sheet";
import { Button } from "./ui";
import { PLANS, PAID } from "../lib/plans";
import { upgrade, inNativeApp } from "../lib/billing";
import { restore, sayOutcome } from "../lib/appstore";

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
  const native = inNativeApp();

  /**
   * Put back a subscription this Apple ID already pays for.
   *
   * Separate from `go` because it is a different promise: nothing is bought,
   * nothing is charged, and the only two outcomes are "you already have this"
   * and "you don't". It does prompt for the App Store password, which is why
   * it lives behind a button and never runs on its own.
   */
  async function bringBack() {
    setBusy("restore");
    setError(null);
    try {
      const out = await restore();
      if (out.ok) {
        dispatchEvent(new Event("squirrel:plan"));
        onClose?.();
        return;
      }
      setError(sayOutcome(out.reason));
    } catch (e) {
      setError(e.message);
    }
    setBusy(null);
  }

  async function go(id) {
    setBusy(id);
    setError(null);
    try {
      // One call, two worlds: In-App Purchase inside the app because Apple
      // requires it, Stripe on the web because it is allowed and cheaper.
      const out = await upgrade(id);
      // On the web the browser is already leaving; there is nothing to render
      // and nothing to reset, and clearing `busy` would flash the old label.
      if (out.redirected) return;
      if (out.ok) {
        // The server wrote the plan before this resolved, so the app only has
        // to be told to re-read it.
        dispatchEvent(new Event("squirrel:plan"));
        onClose?.();
        return;
      }
      // A closed payment sheet says nothing. Somebody who cancelled on purpose
      // does not need to be told what they just did.
      setError(sayOutcome(out.reason));
      setBusy(null);
      return;
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
                    {busy === id
                      ? native ? "Asking the App Store…" : "Opening checkout…"
                      : `Get ${tier.name}`}
                  </Button>
                </div>
              );
            })}
          </div>

          {/* Required by Guideline 3.1.1, and the first thing review looks for
              on a subscription app. It is not a nicety: somebody who reinstalls
              on a new phone is looking at a paywall for a subscription they are
              already being charged for, and without this their only recourse is
              to pay twice. Shown only where it means something — there is
              nothing to restore in a browser. */}
          {native && (
            <button
              onClick={bringBack}
              disabled={busy !== null}
              className="mt-4 w-full rounded-md border border-[var(--line)] px-4 py-2.5 text-sm
                         transition-colors hover:border-[var(--ink)] disabled:opacity-50"
            >
              {busy === "restore" ? "Checking with the App Store…" : "Restore purchases"}
            </button>
          )}

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
