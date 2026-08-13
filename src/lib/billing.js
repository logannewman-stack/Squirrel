/**
 * Talking to the billing endpoints.
 *
 * Both of these end in a redirect to a page Stripe hosts, which is the point:
 * no card number ever touches this app, and the flows that would otherwise
 * need building — 3-D Secure, a new card, an invoice PDF, cancelling — are
 * already built by somebody whose job that is.
 */

import { client } from "./supabase";

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
 * Start a subscription.
 *
 * Two routes to the same Stripe session. From the web it is an ordinary
 * redirect. From the native app it must open in the *system browser* and come
 * back through a universal link: since the 2025 Epic ruling a US app may send
 * someone out to an external checkout, but only by genuinely leaving the app —
 * an in-app webview is still the app, and still a rejection under 3.1.1.
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

/** Manage an existing subscription: card, invoices, upgrade, cancel. */
export async function openPortal() {
  const { url } = await post("/api/portal");
  if (!url) throw new Error("no portal url");
  location.assign(url);
}

/** Current plan and this month's consumption. */
export async function fetchUsage() {
  const supabase = await client();
  const { data } = (await supabase?.auth.getSession()) ?? {};
  const token = data?.session?.access_token;
  if (!token) return null;

  const res = await fetch("/api/usage", { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}
