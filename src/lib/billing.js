/**
 * Talking to the billing endpoints.
 *
 * Both of these end in a redirect to a page Stripe hosts, which is the point:
 * no card number ever touches this app, and the flows that would otherwise
 * need building — 3-D Secure, a new card, an invoice PDF, cancelling — are
 * already built by somebody whose job that is.
 */

import { client } from "./supabase";
import { api } from "./api.js";

async function post(path, body) {
  const supabase = await client();
  const { data } = (await supabase?.auth.getSession()) ?? {};
  const token = data?.session?.access_token;
  if (!token) throw new Error("not signed in");

  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body ?? {}),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `request failed (${res.status})`);
  return out;
}

/**
 * Is this the native shell rather than a browser tab?
 *
 * Set by the app at startup. It decides which way an upgrade goes, and it has
 * to be explicit rather than sniffed: a user agent cannot reliably tell a Mac
 * Catalyst build from Safari, and getting it wrong means either a rejected app
 * or a checkout that never returns.
 */
export const inNativeApp = () => globalThis.__SQUIRREL_NATIVE__ === true;

/**
 * Start a subscription, by whichever route this build is allowed to use.
 *
 * The one function every buy button calls, and the only place the rule lives:
 *
 *   in the iOS app  → In-App Purchase, because Guideline 3.1.1 requires it
 *   on the web      → Stripe, because it is permitted and costs 2.9%, not 15%
 *
 * A fork rather than a preference. Sending an in-app upgrade to Stripe
 * Checkout is a rejection, not a grey area, and it has to be impossible to do
 * by accident from a component — which is why no screen calls `startCheckout`
 * directly any more.
 *
 * @returns {{ok: boolean, plan?: string, reason?: string, redirected?: boolean}}
 *   `redirected: true` means the browser is already leaving and there is
 *   nothing left for the caller to render.
 */
export async function upgrade(plan) {
  if (inNativeApp()) {
    const { buy, appStoreAvailable } = await import("./appstore.js");
    // A native build whose StoreKit plugin failed to register cannot sell
    // anything — and must not quietly fall back to Stripe, because that
    // fallback *is* the rejection. Better to say so than to ship the offence.
    if (!appStoreAvailable()) return { ok: false, reason: "unavailable" };
    return buy(plan);
  }
  await startCheckout(plan);
  return { ok: true, redirected: true };
}

/**
 * Start a Stripe subscription.
 *
 * Two routes to the same Stripe session. From the web it is an ordinary
 * redirect. From the native app it must open in the *system browser* and come
 * back through a universal link: since the 2025 Epic ruling a US app may send
 * someone out to an external checkout, but only by genuinely leaving the app —
 * an in-app webview is still the app, and still a rejection under 3.1.1.
 *
 * Note that this is the *link-out*, not the in-app upgrade. `upgrade()` above
 * is what a buy button calls; this is only reached on the web, or from a
 * deliberate "subscribe on the web instead" affordance whose wording and
 * placement have their own rules worth re-reading before they change.
 *
 * The native shell is expected to expose `__SQUIRREL_OPEN_EXTERNAL__`. Falling
 * back to `location.assign` would quietly turn a compliant link-out into a
 * webview purchase, so the absence of it is an error rather than a default.
 */
export async function startCheckout(plan, { seats } = {}) {
  const native = inNativeApp();
  // `seats` turns this into a company's quantity-based subscription, billed to
  // the organisation rather than to the administrator who happens to be
  // holding the card. The server checks they administer one.
  const { url } = await post("/api/checkout", {
    plan,
    return: native ? "app" : "web",
    ...(seats ? { seats } : {}),
  });
  if (!url) throw new Error("no checkout url");

  if (!native) return location.assign(url);

  const open = globalThis.__SQUIRREL_OPEN_EXTERNAL__;
  if (typeof open !== "function") throw new Error("cannot open the browser from here");
  open(url);
}

/**
 * Manage an existing subscription: card, invoices, upgrade, cancel.
 *
 * Where that happens depends on who is taking the money, and getting it wrong
 * is a dead end rather than a rejection: an App Store subscriber sent to the
 * Stripe portal arrives at a page with no subscription on it and no way to
 * cancel the one they have. Apple owns the cancel button for anything bought
 * through StoreKit, and the deep link below is the one it wants used.
 */
export async function openPortal() {
  if (inNativeApp()) {
    const open = globalThis.__SQUIRREL_OPEN_EXTERNAL__;
    if (typeof open === "function") {
      await open("https://apps.apple.com/account/subscriptions");
      return;
    }
  }
  const { url } = await post("/api/portal");
  if (!url) throw new Error("no checkout url");
  location.assign(url);
}

/** Current plan and this month's consumption. */
export async function fetchUsage() {
  const supabase = await client();
  const { data } = (await supabase?.auth.getSession()) ?? {};
  const token = data?.session?.access_token;
  if (!token) return null;

  const res = await api("/api/usage", { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}
