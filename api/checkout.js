import Stripe from "stripe";
import { asUser, asService, requireUser, json } from "./_lib/db.js";

const PRICE = {
  plus: process.env.STRIPE_PRICE_PLUS,
  pro: process.env.STRIPE_PRICE_PRO,
  studio: process.env.STRIPE_PRICE_STUDIO,
};

/**
 * Stripe checkout for WEB signups only.
 *
 * Apple requires In-App Purchase for digital subscriptions bought inside an iOS
 * or Mac app (App Store Guideline 3.1.1) — routing an in-app upgrade here is a
 * rejection. The native client must use StoreKit and verify the receipt via
 * api/apple-webhook.js instead.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });

  const auth = await requireUser(req);
  if (!auth) return json(res, 401, { error: "unauthorized" });

  const { plan } = req.body || {};
  if (!PRICE[plan]) return json(res, 400, { error: "unknown_plan" });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const db = asUser(auth.jwt);
  const { data: profile } = await db.from("profiles")
    .select("stripe_customer_id,email").eq("id", auth.user.id).maybeSingle();

  let customerId = profile?.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: profile?.email || auth.user.email,
      metadata: { supabase_user_id: auth.user.id },
    });
    customerId = customer.id;
    // Service role: the user must not be able to point their profile at
    // someone else's Stripe customer.
    await asService().from("profiles")
      .update({ stripe_customer_id: customerId }).eq("id", auth.user.id);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: PRICE[plan], quantity: 1 }],
    success_url: `${process.env.PUBLIC_URL}/?upgraded=1`,
    cancel_url: `${process.env.PUBLIC_URL}/?upgrade=cancelled`,
    // Carried onto the subscription so the webhook can attribute it without a
    // second lookup.
    subscription_data: { metadata: { supabase_user_id: auth.user.id, plan } },
  });

  return json(res, 200, { url: session.url });
}
