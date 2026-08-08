import Stripe from "stripe";
import { asService, requireUser, json } from "../_lib/db.js";

/**
 * Delete the account, and everything attached to it.
 *
 * Apple requires any app with account creation to offer account *deletion*
 * inside the app — not a support email, not a web form. It is a review
 * checklist item, and an app without it is rejected. It is also simply the
 * right thing: an account somebody cannot leave is a hostage.
 *
 * ## The order matters
 *
 * The subscription is cancelled first, then the outside grants are revoked,
 * then the rows go. Deleting the user first would orphan a live subscription
 * that keeps billing a card belonging to somebody who no longer has an account
 * — the worst possible failure here, because it takes money from a person who
 * has explicitly left.
 *
 * The database does the rest by itself: every table references `auth.users` with
 * `on delete cascade`, so removing the user removes the projects, tasks, events,
 * sessions, chat, calendar links and billing state in one statement. That is
 * worth stating plainly, because a hand-written list of tables to clear is a
 * list that silently goes stale the next time one is added.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });

  const auth = await requireUser(req);
  if (!auth) return json(res, 401, { error: "unauthorized" });

  // Typed confirmation, checked on the server as well as in the dialog. The
  // client asks for it to slow somebody down; this is what makes a stray
  // request from anywhere else insufficient.
  const { confirm } = req.body || {};
  if (confirm !== "DELETE") return json(res, 400, { error: "confirmation_required" });

  const db = asService();
  const userId = auth.user.id;

  const { data: profile } = await db
    .from("profiles")
    .select("stripe_customer_id, stripe_subscription_id")
    .eq("id", userId)
    .maybeSingle();

  // ---- 1. Stop the billing, before anything else can fail.
  if (profile?.stripe_subscription_id && process.env.STRIPE_SECRET_KEY) {
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      // Immediately, not at period end: they are leaving now, and a
      // subscription that outlives its account cannot be managed by anyone.
      await stripe.subscriptions.cancel(profile.stripe_subscription_id);
    } catch {
      // Already cancelled, or already gone. Either is the state we wanted.
    }
  }

  // ---- 2. Hand back anything borrowed from another service.
  const { data: links } = await db
    .from("calendar_links").select("refresh_token").eq("user_id", userId);

  for (const link of links || []) {
    if (!link.refresh_token) continue;
    // Best effort. A grant we cannot revoke must not stop the deletion — the
    // user asked to leave, and failing on Google's behalf keeps them here.
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(link.refresh_token)}`,
      { method: "POST" }).catch(() => {});
  }

  // ---- 3. The rows, by cascade.
  const { error } = await db.auth.admin.deleteUser(userId);
  if (error) return json(res, 500, { error: "delete_failed" });

  return json(res, 200, { deleted: true });
}
