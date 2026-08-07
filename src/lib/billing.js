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
 * Start a subscription.
 *
 * Web only. Apple requires In-App Purchase for digital subscriptions bought
 * inside an iOS or Mac app, and routing an in-app upgrade through Stripe is a
 * rejection — see the note in api/checkout.js.
 */
export async function startCheckout(plan) {
  const { url } = await post("/api/checkout", { plan });
  if (!url) throw new Error("no checkout url");
  location.assign(url);
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
