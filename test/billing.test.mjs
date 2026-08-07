/**
 * Reading a Stripe subscription correctly.
 *
 * Billing is the one part of the app that cannot be checked by using it. A
 * wrong field does not throw in development — it takes somebody's money and
 * then fails to give them what they paid for, and the first report comes from
 * a customer rather than a test.
 *
 * So the shape of a Stripe object is pinned here against fixtures built from
 * the API version this project actually pins (`2026-07-29.dahlia`), where
 * `current_period_end` lives on the subscription *items* and not on the
 * subscription. The old field is gone: reading it produced `undefined`,
 * `new Date(undefined * 1000).toISOString()` throws, the webhook answered 500
 * to every subscription event, Stripe retried it for days, and no subscription
 * could ever activate.
 */

import {
  planForPrice, priceIdsOf, periodEndOf, profileFromSubscription, isStale, TIERS,
} from "../api/_lib/billing.js";

let pass = 0, fail = 0;
const failures = [];
const t = (name, ok, detail) => {
  if (ok) pass++; else { fail++; failures.push(name); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const PRICES = { plus: "price_plus_123", pro: "price_pro_456" };
const AT = 1_800_000_000; // a fixed epoch second

/** A subscription as the pinned API version actually returns it. */
const sub = ({ status = "active", price = PRICES.plus, end = AT, meta = {}, id = "sub_1" } = {}) => ({
  id,
  status,
  customer: "cus_1",
  metadata: meta,
  items: { data: [{ id: "si_1", price: { id: price }, current_period_end: end }] },
});

// ------------------------------------------------------------- period end
{
  t("the period end comes off the item", periodEndOf(sub()) === new Date(AT * 1000).toISOString(),
    periodEndOf(sub()));

  // The exact shape that used to throw.
  const old = { id: "sub_1", status: "active", items: { data: [] } };
  t("a subscription with no items does not throw", periodEndOf(old) === null, periodEndOf(old));

  // An older API version, or a replayed historical event.
  const legacy = { id: "sub_1", status: "active", current_period_end: AT, items: { data: [] } };
  t("the legacy field is still honoured",
    periodEndOf(legacy) === new Date(AT * 1000).toISOString(), periodEndOf(legacy));

  // Several items is one billing relationship; access lasts as long as the
  // longest thing paid for.
  const many = {
    items: { data: [{ current_period_end: AT }, { current_period_end: AT + 86400 }] },
  };
  t("several items take the latest",
    periodEndOf(many) === new Date((AT + 86400) * 1000).toISOString(), periodEndOf(many));

  t("garbage is null, not an exception", periodEndOf({ items: { data: [{ current_period_end: "soon" }] } }) === null);
  t("undefined is null, not an exception", periodEndOf(undefined) === null);
}

// ------------------------------------------------------------ plan by price
{
  t("a price maps to its plan", planForPrice(PRICES.pro, PRICES) === "pro");
  t("an unknown price maps to nothing", planForPrice("price_other", PRICES) === null);
  t("a missing price maps to nothing", planForPrice(undefined, PRICES) === null);
  t("price ids are read off the items", JSON.stringify(priceIdsOf(sub({ price: PRICES.pro }))) === '["price_pro_456"]');
  t("no items, no prices", JSON.stringify(priceIdsOf({})) === "[]");
}

// --------------------------------------------------------------- the profile
{
  const active = profileFromSubscription(sub({ price: PRICES.pro }), PRICES);
  t("an active subscription grants its plan", active.plan === "pro", active.plan);
  t("and records when it runs to", active.plan_renews_at === new Date(AT * 1000).toISOString());
  t("and keeps the subscription id", active.stripe_subscription_id === "sub_1");
  t("and raises no alert", active.billing_alert === null);

  // The reason plan is read from the price and not from metadata: metadata is
  // written once at checkout and never changes, so somebody who upgrades in
  // the portal would go on paying for Pro while holding Plus.
  const upgraded = profileFromSubscription(
    sub({ price: PRICES.pro, meta: { plan: "plus" } }), PRICES);
  t("the price wins over stale metadata", upgraded.plan === "pro", upgraded.plan);

  const cancelled = profileFromSubscription(sub({ status: "canceled" }), PRICES);
  t("a cancelled subscription drops to free", cancelled.plan === "free");
  // They bought the month. Access runs to the end of it.
  t("but keeps the paid period", cancelled.plan_renews_at === new Date(AT * 1000).toISOString());

  const trial = profileFromSubscription(sub({ status: "trialing" }), PRICES);
  t("a trial is entitled", trial.plan === "plus");

  // Stripe retries a failing card for days. Locking someone out on the first
  // decline loses a customer over an expired card.
  const late = profileFromSubscription(sub({ status: "past_due" }), PRICES);
  t("past due keeps access", late.plan === "plus", late.plan);
  t("and says so", late.billing_alert === "past_due", late.billing_alert);

  const unpaid = profileFromSubscription(sub({ status: "unpaid" }), PRICES);
  t("unpaid does not keep access", unpaid.plan === "free");

  const unknown = profileFromSubscription(sub({ price: "price_mystery" }), PRICES);
  t("an unrecognised price falls back rather than granting nothing",
    unknown.plan === "plus", unknown.plan);

  const bogus = profileFromSubscription(sub({ meta: { plan: "enterprise" }, price: "price_x" }), PRICES);
  t("a plan that is not a tier is refused", TIERS.includes(bogus.plan), bogus.plan);

  t("writes only billing columns",
    Object.keys(active).sort().join(",") ===
      "billing_alert,billing_status,plan,plan_renews_at,stripe_subscription_id",
    Object.keys(active).sort().join(","));
}

// ------------------------------------------------------------- out of order
{
  const applied = new Date(AT * 1000).toISOString();
  t("an older event is stale", isStale(AT - 60, applied) === true);
  t("a newer event is not", isStale(AT + 60, applied) === false);
  t("the same instant is not", isStale(AT, applied) === false);
  t("nothing applied yet means nothing is stale", isStale(AT, null) === false);
  t("an unparseable stamp does not block", isStale(AT, "not a date") === false);
}

console.log(`\nBilling: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
