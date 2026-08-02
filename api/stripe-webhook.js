import Stripe from "stripe";
import { asService, json } from "./_lib/db.js";

// Signature verification needs the raw body, which Vercel would otherwise parse.
export const config = { api: { bodyParser: false } };

const readRaw = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

/** Billing state is written here and nowhere else — never from the client. */
export default async function handler(req, res) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      await readRaw(req),
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (e) {
    // An unverified body is not a Stripe event — never act on it.
    return json(res, 400, { error: "bad_signature" });
  }

  const db = asService();

  if (event.type.startsWith("customer.subscription.")) {
    const sub = event.data.object;
    const userId = sub.metadata?.supabase_user_id;
    if (!userId) return json(res, 200, { ignored: "no_user_metadata" });

    const active = ["active", "trialing"].includes(sub.status);
    await db.from("profiles").update({
      plan: active ? (sub.metadata?.plan ?? "plus") : "free",
      stripe_subscription_id: sub.id,
      // Keep access until the paid period actually ends, rather than cutting
      // off the moment someone cancels.
      plan_renews_at: new Date(sub.current_period_end * 1000).toISOString(),
    }).eq("id", userId);
  }

  return json(res, 200, { received: true });
}
