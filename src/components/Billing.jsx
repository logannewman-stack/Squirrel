import { useEffect, useState } from "react";
import { PLANS } from "../lib/plans";
import { startCheckout, openPortal, fetchUsage } from "../lib/billing";

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
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {["plus", "pro"].map((id) => (
            <button
              key={id}
              disabled={busy !== null}
              onClick={() => go(() => startCheckout(id), id)}
              className="rounded-md border border-[var(--line)] px-4 py-3 text-left
                         transition-colors hover:border-[var(--ink)] disabled:opacity-50"
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{PLANS[id].name}</span>
                <span className="text-sm text-[var(--muted)]">${PLANS[id].price}/mo</span>
              </span>
              <span className="mt-1 block text-sm text-[var(--muted)]">{PLANS[id].blurb}</span>
              <span className="mt-2 block text-xs">
                {busy === id ? "Opening checkout…" : "Subscribe"}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <button
          disabled={busy !== null}
          onClick={() => go(openPortal, "portal")}
          className="mt-4 rounded-full border border-[var(--line)] px-5 py-2 text-sm
                     transition-colors hover:border-[var(--ink)] disabled:opacity-50"
        >
          {busy === "portal" ? "Opening…" : "Manage billing"}
        </button>
      )}

      {error && <p className="mt-3 text-sm text-[var(--alert)]">{error}</p>}

      <p className="mt-3 text-xs text-[var(--muted)]">
        Payment is handled by Stripe — card details never reach this app. Cancel any time from
        Manage billing; you keep the plan until the period you've paid for ends.
      </p>
    </div>
  );
}
