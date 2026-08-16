#!/usr/bin/env node
/**
 * Connect Squirrel to Stripe, from the code that knows what the prices are.
 *
 *     STRIPE_SECRET_KEY=sk_test_… PUBLIC_URL=https://your-domain \
 *       node scripts/stripe-setup.mjs
 *
 *     …                                node scripts/stripe-setup.mjs --check
 *
 * ## Two shapes of price, and why one of them is a script
 *
 * Pro is bought one at a time — a personal subscription, flat monthly. Studio
 * is the tier a company buys, so it is per-seat and uses *graduated* tiered
 * pricing: the first four seats at list,
 * the next twenty at 15% off, and so on, each band charged at its own rate.
 * That is what `quote()` computes and what the button in the app promises.
 * Stripe's dashboard offers "volume" pricing immediately next to it, which
 * charges every seat at the rate the last one unlocked — a different, much
 * lower number.
 *
 * Pick the wrong radio button and nothing fails. Checkout works, the invoice
 * is produced, and it disagrees with the price the customer was shown. It is
 * found by a customer, not by a test, and it is a refund and an apology. The
 * same is true of typing sixteen tier amounts by hand.
 *
 * So the tiers come from `src/lib/seats.js` — the same `BANDS` the app quotes
 * from — and there is exactly one copy of the pricing in this project.
 *
 * ## What it does
 *
 * Idempotent. Everything is looked up by a `squirrel_plan` metadata key before
 * being created, so running it twice makes nothing twice, and running it after
 * a price change adds a new price and leaves the old one alone (Stripe prices
 * are immutable, and existing subscriptions must keep the price they signed
 * up on).
 *
 * `--check` writes nothing and exits non-zero on any mismatch, which is what
 * to run after changing a number in `plans.js`.
 */

import Stripe from "stripe";
import { PLANS, PAID } from "../src/lib/plans.js";
import { tiers } from "../src/lib/seats.js";

const check = process.argv.includes("--check");
const KEY = process.env.STRIPE_SECRET_KEY;
const SITE = (process.env.PUBLIC_URL || "").replace(/\/+$/, "");

if (!KEY) {
  console.error("STRIPE_SECRET_KEY is not set.\n");
  console.error("  Stripe dashboard → Developers → API keys → Secret key");
  console.error("  Use the test key first: it starts sk_test_ and cannot charge anybody.");
  process.exit(1);
}

const stripe = new Stripe(KEY);
const live = KEY.startsWith("sk_live");
const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const problems = [];
const notes = [];

console.log(`\nStripe: ${live ? "LIVE — real cards" : "test mode"}\n`);

/* ------------------------------------------------------------------ account */
try {
  const account = await stripe.accounts.retrieve();
  console.log(`  account   ${account.settings?.dashboard?.display_name || account.id}`);
} catch (e) {
  console.error(`\nThat key did not work: ${e.message}`);
  process.exit(1);
}

/* ----------------------------------------------------------------- products */
/**
 * One product per paid tier, found by metadata rather than by name.
 *
 * A name is something a person edits in the dashboard on a Tuesday. Metadata
 * is not, which makes it the only stable way to ask "is my Pro product already
 * here" — and getting that wrong means a second Squirrel Pro appearing every
 * time this runs.
 */
async function productFor(plan) {
  const tier = PLANS[plan];
  const found = await stripe.products.search({
    query: `metadata['squirrel_plan']:'${plan}' AND active:'true'`,
  });
  if (found.data.length) return found.data[0];
  if (check) {
    problems.push(`no product for ${tier.name}`);
    return null;
  }
  const made = await stripe.products.create({
    name: `Squirrel ${tier.name}`,
    description: tier.blurb,
    metadata: { squirrel_plan: plan },
  });
  notes.push(`created product  Squirrel ${tier.name}`);
  return made;
}

/**
 * A flat monthly price, for the tiers a person buys for themselves.
 *
 * Matched on the amount rather than merely on the plan: a price that no longer
 * says $24.99 is not the price this app quotes, whatever it is labelled, and
 * reusing it would charge last quarter's number for ever.
 */
async function flatPriceFor(plan, product) {
  const cents = Math.round(PLANS[plan].price * 100);
  const existing = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  const already = existing.data.find(
    (p) => p.recurring?.interval === "month"
      && p.billing_scheme === "per_unit"
      && p.unit_amount === cents
      && p.currency === "usd",
  );
  if (already) return already;

  if (check) {
    problems.push(`no monthly ${money(cents)} price for ${PLANS[plan].name}`);
    return null;
  }
  const made = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: cents,
    recurring: { interval: "month" },
    metadata: { squirrel_plan: plan },
  });
  notes.push(`created price    ${PLANS[plan].name} — ${money(cents)}/month`);
  return made;
}

/**
 * A monthly, per-seat, graduated price — and the same one if it already exists.
 *
 * Matched on the tier amounts themselves, not just on the plan, because that
 * is the thing that has to be right. A price whose bands no longer match
 * `seats.js` is not the price this app quotes, however it is labelled, and it
 * has to be replaced rather than reused.
 */
async function priceFor(plan, product) {
  if (!product) return null;
  const want = tiers(plan);
  // Pro is bought one at a time, so it is a flat monthly price. Studio is the
  // tier a company buys, so it is per-seat and graduated. Giving Pro a tiered
  // price would advertise a volume discount on a plan that cannot have volume.
  if (!want.length) return flatPriceFor(plan, product);
  const existing = await stripe.prices.list({ product: product.id, active: true, limit: 100 });

  const matches = (price) => {
    if (price.recurring?.interval !== "month") return false;
    if (price.billing_scheme !== "tiered" || price.tiers_mode !== "graduated") return false;
    const got = price.tiers || [];
    if (got.length !== want.length) return false;
    return want.every((tier, i) => {
      const up = got[i].up_to === null ? "inf" : got[i].up_to;
      return up === tier.up_to && got[i].unit_amount === tier.unit_amount;
    });
  };

  // `tiers` only comes back when asked for, and without it every price looks
  // like a mismatch and this script creates a duplicate on every run.
  const withTiers = await Promise.all(
    existing.data.map((p) => stripe.prices.retrieve(p.id, { expand: ["tiers"] })),
  );

  const already = withTiers.find(matches);
  if (already) return already;

  const stale = withTiers.filter((p) => p.recurring?.interval === "month");
  if (check) {
    problems.push(
      stale.length
        ? `${PLANS[plan].name} has a monthly price whose tiers no longer match seats.js`
        : `no graduated monthly price for ${PLANS[plan].name}`,
    );
    return null;
  }

  const made = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    recurring: { interval: "month", usage_type: "licensed" },
    billing_scheme: "tiered",
    // Graduated, never volume. See the note at the top of this file.
    tiers_mode: "graduated",
    tiers: want,
    metadata: { squirrel_plan: plan },
  });
  notes.push(`created price    ${PLANS[plan].name} — ${want.map((t) => money(t.unit_amount)).join(" / ")}`);
  if (stale.length) {
    notes.push(`  (${stale.length} older ${PLANS[plan].name} price${stale.length === 1 ? "" : "s"} left active — existing subscribers keep them, which is correct)`);
  }
  return made;
}

const ids = {};
for (const plan of PAID) {
  const product = await productFor(plan);
  const price = await priceFor(plan, product);
  ids[plan] = price?.id ?? null;

  const want = tiers(plan);
  console.log(`\n  ${PLANS[plan].name}  ${price ? price.id : "— missing —"}`);
  if (!want.length) {
    console.log(`      one person`.padEnd(22) + `${money(Math.round(PLANS[plan].price * 100))}/month`);
  }
  for (const [i, tier] of want.entries()) {
    const from = i === 0 ? 1 : Number(want[i - 1].up_to) + 1;
    const to = tier.up_to === "inf" ? "and up" : `–${tier.up_to}`;
    console.log(`      seats ${from}${to}`.padEnd(22) + `${money(tier.unit_amount)} each`);
  }
}

/* ------------------------------------------------------------------ webhook */
/**
 * The six events, and only the six.
 *
 * Subscribing to everything is not harmless: Stripe retries failures for days,
 * and an endpoint that 500s on an event it was never written to handle looks,
 * on the dashboard, exactly like an endpoint that is broken.
 */
const EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
  "invoice.payment_succeeded",
];

let webhookSecret = null;
if (!SITE) {
  problems.push("PUBLIC_URL is not set, so the webhook cannot be created");
} else {
  const url = `${SITE}/api/stripe-webhook`;
  const hooks = await stripe.webhookEndpoints.list({ limit: 100 });
  const mine = hooks.data.find((h) => h.url === url);

  if (mine) {
    const missing = EVENTS.filter((e) => !mine.enabled_events.includes(e) && !mine.enabled_events.includes("*"));
    if (missing.length) {
      if (check) problems.push(`webhook is missing: ${missing.join(", ")}`);
      else {
        await stripe.webhookEndpoints.update(mine.id, { enabled_events: EVENTS });
        notes.push(`updated webhook  added ${missing.length} missing event${missing.length === 1 ? "" : "s"}`);
      }
    }
    console.log(`\n  webhook   ${url}  ✓`);
  } else if (check) {
    problems.push(`no webhook pointing at ${url}`);
  } else {
    const made = await stripe.webhookEndpoints.create({
      url,
      enabled_events: EVENTS,
      description: "Squirrel — subscription state",
    });
    // The signing secret is returned exactly once, at creation. Stripe will
    // never show it again, and without it every delivery is rejected as
    // unsigned — so it is printed here or it is lost.
    webhookSecret = made.secret;
    notes.push(`created webhook  ${url}`);
    console.log(`\n  webhook   ${url}  ✓ created`);
  }
}

/* ------------------------------------------------------------------ the end */
if (notes.length) {
  console.log("");
  for (const n of notes) console.log(`  ${n}`);
}

if (check) {
  console.log("");
  if (problems.length) {
    console.error("Stripe does not match the app:");
    for (const p of problems) console.error(`  ✗  ${p}`);
    console.error("\nRun without --check to create what is missing.");
    process.exit(1);
  }
  console.log("Stripe matches the app.\n");
  process.exit(0);
}

if (problems.length) {
  console.error("");
  for (const p of problems) console.error(`  ✗  ${p}`);
  process.exit(1);
}

console.log(`
──────────────────────────────────────────────────────────────
Put these in Vercel (Project → Settings → Environment Variables),
then redeploy:

  STRIPE_SECRET_KEY       ${KEY.slice(0, 12)}…
  STRIPE_PRICE_PRO        ${ids.pro ?? "—"}
  STRIPE_PRICE_STUDIO     ${ids.studio ?? "—"}${webhookSecret ? `
  STRIPE_WEBHOOK_SECRET   ${webhookSecret}` : `
  STRIPE_WEBHOOK_SECRET   (unchanged — the existing endpoint keeps its secret)`}
  PUBLIC_URL              ${SITE || "— set this —"}

STRIPE_PRICE_PLUS is the retired tier. Leave it unset.
${live ? "" : `
This was test mode. Nothing here can charge anybody. Re-run with the
live key when you are ready, and paste the live ids instead.`}
──────────────────────────────────────────────────────────────
`);
