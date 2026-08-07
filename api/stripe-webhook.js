import Stripe from "stripe";
import { asService, json } from "./_lib/db.js";
import { profileFromSubscription, isStale } from "./_lib/billing.js";

// Signature verification needs the raw body, which Vercel would otherwise parse.
export const config = { api: { bodyParser: false } };

const PRICES = { plus: process.env.STRIPE_PRICE_PLUS, pro: process.env.STRIPE_PRICE_PRO };

const readRaw = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

/**
 * Billing state is written here and nowhere else — never from the client.
 *
 * Everything below assumes Stripe will deliver each event more than once, out
 * of order, and sometimes long after the fact. That is not pessimism; it is
 * documented behaviour, and a subscription system that assumes otherwise
 * downgrades paying customers occasionally and inexplicably.
 */
export default async function handler(req, res) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      await readRaw(req),
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    // An unverified body is not a Stripe event — never act on it.
    return json(res, 400, { error: "bad_signature" });
  }

  const db = asService();

  try {
    if (event.type.startsWith("customer.subscription.")) {
      await applySubscription(stripe, db, event);
    } else if (event.type === "checkout.session.completed") {
      // The subscription events carry everything needed, but they can arrive
      // before this one — and only this one is guaranteed to know which user
      // the customer belongs to on a first purchase.
      await linkCustomer(db, event.data.object);
    } else if (event.type === "invoice.payment_failed") {
      await flagPaymentFailure(stripe, db, event);
    } else if (event.type === "invoice.payment_succeeded") {
      // A card that failed and then worked. Clearing the alert here rather
      // than waiting for the next subscription event means the warning goes
      // away when the problem does.
      await clearAlert(stripe, db, event);
    }
  } catch (e) {
    // A 500 makes Stripe retry, which is right for a transient fault and wrong
    // for a permanent one — it retries for days. Anything we cannot attribute
    // to a user is accepted and logged rather than retried forever.
    if (e?.permanent) return json(res, 200, { ignored: e.message });
    return json(res, 500, { error: "apply_failed" });
  }

  return json(res, 200, { received: true });
}

const permanent = (message) => Object.assign(new Error(message), { permanent: true });

/** The user a Stripe customer belongs to, by metadata first and mapping second. */
async function userFor(db, sub, customerId) {
  const fromMeta = sub?.metadata?.supabase_user_id;
  if (fromMeta) return fromMeta;

  const id = customerId ?? (typeof sub?.customer === "string" ? sub.customer : sub?.customer?.id);
  if (!id) throw permanent("no_customer");

  const { data } = await db.from("profiles").select("id").eq("stripe_customer_id", id).maybeSingle();
  if (!data?.id) throw permanent("unknown_customer");
  return data.id;
}

async function applySubscription(stripe, db, event) {
  let sub = event.data.object;

  // Items carry the period end now, and a thin event payload may not include
  // them. Re-fetching is one call and removes the guesswork.
  if (!sub?.items?.data?.length) {
    sub = await stripe.subscriptions.retrieve(sub.id);
  }

  const userId = await userFor(db, sub);
  const { data: before } = await db
    .from("profiles").select("billing_event_at").eq("id", userId).maybeSingle();

  if (isStale(event.created, before?.billing_event_at)) return;

  await db.from("profiles").update({
    ...profileFromSubscription(sub, PRICES),
    billing_event_at: new Date(event.created * 1000).toISOString(),
  }).eq("id", userId);
}

/**
 * First purchase: bind the Stripe customer to the account.
 *
 * Checkout already sets this on the way in, but only for a session this server
 * created. Doing it here as well means a subscription started from the Stripe
 * dashboard — or by a support agent — still finds its way home.
 */
async function linkCustomer(db, session) {
  const userId = session?.metadata?.supabase_user_id
    ?? session?.subscription_data?.metadata?.supabase_user_id;
  const customerId = typeof session?.customer === "string" ? session.customer : session?.customer?.id;
  if (!userId || !customerId) throw permanent("no_link");

  await db.from("profiles").update({ stripe_customer_id: customerId }).eq("id", userId);
}

async function flagPaymentFailure(stripe, db, event) {
  const invoice = event.data.object;
  const customerId = typeof invoice?.customer === "string" ? invoice.customer : invoice?.customer?.id;
  const userId = await userFor(db, null, customerId);

  // The plan is deliberately not touched. Stripe retries a failed card for
  // days before giving up, and the subscription event that follows is what
  // decides entitlement. Cutting access on the first decline loses customers
  // over an expired card.
  await db.from("profiles").update({ billing_alert: "payment_failed" }).eq("id", userId);
}

async function clearAlert(stripe, db, event) {
  const invoice = event.data.object;
  const customerId = typeof invoice?.customer === "string" ? invoice.customer : invoice?.customer?.id;
  const userId = await userFor(db, null, customerId);
  await db.from("profiles").update({ billing_alert: null }).eq("id", userId);
}
