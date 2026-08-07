import Stripe from "stripe";
import { asUser, requireUser, json } from "./_lib/db.js";

/**
 * The Stripe billing portal — where a subscription is actually managed.
 *
 * Checkout takes the first payment. Everything after it happens here: a new
 * card when the old one expires, an invoice a customer's finance team asks
 * for, an upgrade, and cancelling. Without it, every one of those becomes an
 * email to support, and the card expiry becomes an involuntary churn nobody
 * finds out about until the customer has already gone.
 *
 * Stripe hosts the pages, so no card details reach this server and none of the
 * flows above need building.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });

  const auth = await requireUser(req);
  if (!auth) return json(res, 401, { error: "unauthorized" });

  const db = asUser(auth.jwt);
  const { data: profile } = await db
    .from("profiles").select("stripe_customer_id").eq("id", auth.user.id).maybeSingle();

  // No customer means nothing has ever been paid. Sending them to the portal
  // would show an empty page; the honest answer is that there is nothing to
  // manage yet.
  if (!profile?.stripe_customer_id) return json(res, 409, { error: "no_subscription" });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const session = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${process.env.PUBLIC_URL}/?billing=done`,
  });

  return json(res, 200, { url: session.url });
}
