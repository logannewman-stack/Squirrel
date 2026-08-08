/**
 * Reading a Stripe subscription, without guessing at its shape.
 *
 * These are pure functions on purpose. Billing is the one part of the app that
 * cannot be checked by using it — a wrong field here does not throw in
 * development, it charges somebody and then fails to give them what they paid
 * for. So the parts that can be tested without Stripe are separated out and
 * tested, and the parts that cannot are kept small enough to read.
 *
 * ## The field that moved
 *
 * `current_period_end` used to live on the subscription. It does not any more:
 * the SDK's own changelog records it being removed from `Subscription` and
 * added to `SubscriptionItem`, and this project pins an API version well past
 * that. Reading the old field yielded `undefined`, and
 * `new Date(undefined * 1000).toISOString()` throws — so the webhook returned
 * 500 on every subscription event, Stripe retried it forever, and no
 * subscription could ever activate. Nobody would have noticed until the first
 * customer paid and got nothing.
 */

/** Plan tiers, worst to best. Mirrors the `plan_tier` enum in the schema. */
export const TIERS = ["free", "plus", "pro", "studio"];

/**
 * Which plan a price buys.
 *
 * Derived from the price rather than from subscription metadata, because
 * metadata is written once at checkout and never changes: a customer who
 * upgrades in the billing portal keeps the old tier in metadata forever, and
 * would go on paying for Pro while holding Plus.
 */
export function planForPrice(priceId, prices = {}) {
  if (!priceId) return null;
  for (const [plan, id] of Object.entries(prices)) {
    if (id && id === priceId) return plan;
  }
  return null;
}

/** Every price id on a subscription, in order. */
export function priceIdsOf(sub) {
  return (sub?.items?.data || [])
    .map((item) => item?.price?.id ?? item?.pricing?.price_details?.price ?? null)
    .filter(Boolean);
}

/**
 * When the paid period ends, in ISO, or null.
 *
 * Read from the subscription items, where it lives now. The highest of them:
 * a subscription with several items is one billing relationship, and access
 * should last as long as the longest thing paid for.
 *
 * Falls back to the subscription's own field so that an older API version —
 * or a replayed historical event — still works rather than throwing.
 */
export function periodEndOf(sub) {
  const stamps = (sub?.items?.data || [])
    .map((item) => item?.current_period_end)
    .filter((n) => Number.isFinite(n));

  if (!stamps.length && Number.isFinite(sub?.current_period_end)) {
    stamps.push(sub.current_period_end);
  }
  if (!stamps.length) return null;

  const at = new Date(Math.max(...stamps) * 1000);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/**
 * Statuses that mean the customer may use what they paid for.
 *
 * `past_due` is deliberately included. Stripe keeps retrying a failed card for
 * days before giving up, and locking someone out on the first failure — often
 * an expired card, not a decision — loses the customer over an inconvenience.
 * `unpaid` and `canceled` are where it actually ends.
 */
const ENTITLED = new Set(["active", "trialing", "past_due"]);

/** Statuses worth telling the customer about. */
const TROUBLED = new Set(["past_due", "incomplete", "unpaid"]);

/**
 * The profile columns a subscription event implies.
 *
 * Returns only what billing owns, so the caller cannot accidentally write
 * anything else with service-role credentials.
 */
export function profileFromSubscription(sub, prices = {}) {
  const entitled = ENTITLED.has(sub?.status);
  const plan = entitled
    ? (priceIdsOf(sub).map((id) => planForPrice(id, prices)).find(Boolean)
       ?? sub?.metadata?.plan
       ?? "plus")
    : "free";

  return {
    plan: TIERS.includes(plan) ? plan : "free",
    stripe_subscription_id: sub?.id ?? null,
    // Access runs to the end of the period already paid for, rather than
    // stopping the moment someone cancels. They bought the month.
    plan_renews_at: periodEndOf(sub),
    billing_status: sub?.status ?? null,
    // Surfaced in the UI so a failing card is visible before it becomes a
    // cancellation the customer did not choose.
    billing_alert: TROUBLED.has(sub?.status) ? sub.status : null,
  };
}

/**
 * Is this event older than what has already been applied?
 *
 * Stripe does not guarantee delivery order, and retries mean an event can
 * arrive long after a later one. Applying them out of order downgrades a
 * customer who just upgraded — so anything not newer than the last applied
 * event is dropped.
 */
export function isStale(eventCreatedAt, appliedAtIso) {
  if (!appliedAtIso) return false;
  const applied = new Date(appliedAtIso).getTime();
  if (Number.isNaN(applied)) return false;
  return eventCreatedAt * 1000 < applied;
}
