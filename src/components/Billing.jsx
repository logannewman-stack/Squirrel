import { useEffect, useState } from "react";
import { PLANS, PAID } from "../lib/plans";
import { upgrade, openPortal, fetchUsage, inNativeApp } from "../lib/billing";
import { restore, sayOutcome } from "../lib/appstore";
import { Button } from "./ui";

/**
 * The subscription, from the customer's side.
 *
 * Two jobs and no more: start paying, and manage what you already pay for.
 * Everything else — cards, invoices, tax, cancelling — happens on Stripe's own
 * pages, which is why there is no form here.
 *
 * The panel only appears for signed-in accounts. Signed out is the free tier
 * and works completely; asking someone to subscribe before they have an
 * account is asking twice.
 */
export default function Billing({ email }) {
  const [usage, setUsage] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    fetchUsage().then((u) => { if (live) setUsage(u); });
    return () => { live = false; };
  }, [email]);

  if (!email) {
    return (
      <p className="text-sm text-[var(--muted)]">
        Sign in above to subscribe. Everything works without an account — that's the free tier,
        not a trial.
      </p>
    );
  }

  const plan = usage?.plan ?? "free";
  const current = PLANS[plan] ?? PLANS.free;
  const renews = usage?.renewsAt ? new Date(usage.renewsAt) : null;
  const alert = usage?.billingAlert ?? null;

  /**
   * Buy a plan, by whichever route this build is allowed to use.
   *
   * In the app that is In-App Purchase and it resolves in place; on the web it
   * is a redirect that never comes back. The `redirected` flag is what saves
   * this from having to know which of the two just happened.
   */
  async function buy(id) {
    const out = await upgrade(id);
    if (out.redirected) return;
    if (out.ok) {
      dispatchEvent(new Event("squirrel:plan"));
      fetchUsage().then(setUsage);
      setBusy(null);
      return;
    }
    // A closed payment sheet says nothing — cancelling is not an error.
    const said = sayOutcome(out.reason);
    setBusy(null);
    if (said) throw new Error(said);
  }

  /**
   * Restore purchases — required by Guideline 3.1.1 anywhere a subscription is
   * sold in-app, and the reason somebody setting up a new phone is not shown a
   * paywall for what they are already being charged for.
   */
  async function bringBack() {
    const out = await restore();
    if (out.ok) {
      dispatchEvent(new Event("squirrel:plan"));
      fetchUsage().then(setUsage);
      setBusy(null);
      return;
    }
    throw new Error(sayOutcome(out.reason));
  }

  async function go(fn, key) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      // A redirect never returns, so anything caught here is a real failure.
      setError(
        e.message === "no_subscription"
          ? "Nothing to manage yet — start a plan first."
          : e.message === "not signed in"
            ? "Sign in again to change your plan."
            : e.message,
      );
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="rounded-md border border-[var(--line)] px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-medium">{current.name}</span>
          <span className="text-sm text-[var(--muted)]">
            {current.price ? `$${current.price}/month` : "Free"}
          </span>
        </div>
        <p className="mt-1 text-sm text-[var(--muted)]">{current.blurb}</p>
        {renews && (
          <p className="mt-2 text-xs text-[var(--muted)]">
            {/* "Renews" and "ends" are the same date and opposite news. */}
            {plan === "free" || alert === "canceled"
              ? `Access until ${renews.toLocaleDateString()}`
              : `Renews ${renews.toLocaleDateString()}`}
          </p>
        )}
      </div>

      {/* A failing card is worth saying loudly. It is the commonest way a
          paying customer stops being one without ever deciding to. */}
      {alert && (
        <p className="mt-3 rounded-md border border-[var(--alert)] px-4 py-3 text-sm">
          {alert === "payment_failed" || alert === "past_due"
            ? "Your last payment didn't go through. Stripe will try again — update your card to avoid losing access."
            : `Billing needs attention: ${alert}.`}
        </p>
      )}

      {plan === "free" ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {PAID.map((id) => {
            const tier = PLANS[id];
            return (
              <div
                key={id}
                className={`relative flex flex-col rounded-xl border p-5 ${
                  tier.popular ? "border-[var(--ink)]" : "border-[var(--line)]"
                }`}
              >
                {tier.popular && (
                  <span className="absolute -top-2.5 left-5 rounded-full bg-[var(--ink)] px-2.5 py-0.5
                                   text-[10px] font-semibold uppercase tracking-wider text-[var(--paper)]">
                    Most popular
                  </span>
                )}
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{tier.name}</span>
                  <span>
                    <span className="figure">${tier.price}</span>
                    <span className="text-sm text-[var(--muted)]"> /mo</span>
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted)]">{tier.tagline}</p>
                <ul className="mt-4 flex-1 space-y-1.5">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 fill-none stroke-[var(--ink)] stroke-[2]">
                        <path d="M5 12l5 5L20 6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  variant={tier.popular ? "primary" : "secondary"}
                  disabled={busy !== null}
                  onClick={() => go(() => buy(id), id)}
                  className="mt-5 w-full"
                >
                  {busy === id
                    ? inNativeApp() ? "Asking the App Store…" : "Opening checkout…"
                    : `Choose ${tier.name}`}
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
        <button
          disabled={busy !== null}
          onClick={() => go(openPortal, "portal")}
          className="mt-4 rounded-full border border-[var(--line)] px-5 py-2 text-sm
                     transition-colors hover:border-[var(--ink)] disabled:opacity-50"
        >
          {busy === "portal"
            ? "Opening…"
            : inNativeApp() ? "Manage subscription" : "Manage billing"}
        </button>
      )}

      {/* Required wherever a subscription is sold in-app, and offered on every
          plan rather than only on free: the person who needs it most is
          somebody whose new phone shows them as free while Apple is still
          charging them, and that account looks paid to nobody but Apple. */}
      {inNativeApp() && (
        <button
          disabled={busy !== null}
          onClick={() => go(bringBack, "restore")}
          className="mt-3 block rounded-full border border-[var(--line)] px-5 py-2 text-sm
                     transition-colors hover:border-[var(--ink)] disabled:opacity-50"
        >
          {busy === "restore" ? "Checking with the App Store…" : "Restore purchases"}
        </button>
      )}

      {error && <p className="mt-3 text-sm text-[var(--alert)]">{error}</p>}

      <p className="mt-3 text-xs text-[var(--muted)]">
        {inNativeApp()
          ? "Payment is handled by the App Store — card details never reach this app. Cancel any time from Manage subscription; you keep the plan until the period you've paid for ends."
          : "Payment is handled by Stripe — card details never reach this app. Cancel any time from Manage billing; you keep the plan until the period you've paid for ends."}
      </p>
    </div>
  );
}
