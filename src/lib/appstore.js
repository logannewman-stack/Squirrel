/**
 * Buying a subscription inside the app, where Stripe is not allowed.
 *
 * Guideline 3.1.1: a digital subscription bought inside an iOS app goes
 * through In-App Purchase. The web app keeps selling the same two plans
 * through Stripe — cheaper, and unaffected by any of this — but the same
 * screens running in an app bundle have to come here instead. `billing.js`
 * owns that fork; this file is only the App Store half of it.
 *
 * ## The order of operations, which is the whole file
 *
 * StoreKit hands the device a signed transaction. The device is not allowed to
 * believe it: a JWS payload is base64, not encryption, so anything that grants
 * a plan by reading a receipt locally is a free subscription for anybody with
 * a debugger. So:
 *
 *   1. StoreKit takes the payment and returns a signed transaction
 *   2. it is posted to /api/apple/verify, which checks Apple's certificate
 *      chain, pins the bundle id, refuses sandbox receipts in production, and
 *      writes the plan
 *   3. only then is the transaction *finished*
 *
 * Step 3 last is deliberate and is the difference between a recoverable
 * failure and a support ticket. An unfinished transaction is replayed by
 * StoreKit at every launch, so a customer whose app was killed between paying
 * and being granted — or whose network dropped, or who paid while the server
 * was down — is put on their plan the next time they open the app, with
 * nobody doing anything. Finishing at step 1 loses that, permanently.
 *
 * ## What is deliberately not here
 *
 * No entitlement decisions, no plan arithmetic, no prices. Prices come from
 * StoreKit because the person holding the phone may be charged in euros or at
 * a regional price Apple set, and printing `plans.js`'s dollar figure next to
 * a sheet charging something else is both a rejection and a complaint.
 */

import { client } from "./supabase.js";

/** The native plugin, installed by `startNative()`. Absent in a browser. */
const store = () => globalThis.__SQUIRREL_STORE__ ?? null;

/** Can this build buy anything at all? False everywhere except the iOS app. */
export const appStoreAvailable = () => Boolean(store());

async function token() {
  const supabase = await client();
  const { data } = (await supabase?.auth.getSession()) ?? {};
  return data?.session?.access_token || null;
}

/**
 * Which product id is which plan, as the server has them configured.
 *
 * Asked for rather than hardcoded, because the ids live in `APPLE_PRODUCT_PRO`
 * and `APPLE_PRODUCT_STUDIO` on the server and are what `/api/apple/verify`
 * matches a receipt against. A second copy in the bundle is a copy that goes
 * stale, and the failure it produces is the worst kind: the purchase succeeds,
 * Apple charges the card, and the server does not recognise what was bought.
 *
 * Cached for the session. They cannot change without a deploy.
 */
let catalogue = null;
export async function products(deps = {}) {
  if (deps.catalogue) return deps.catalogue;
  if (catalogue) return catalogue;
  const res = await fetch("/api/apple/verify");
  if (!res.ok) throw new Error("the App Store is not configured on this deployment");
  const { products: ids } = await res.json();
  if (!ids || (!ids.pro && !ids.studio)) throw new Error("no App Store products are configured");
  catalogue = ids;
  return catalogue;
}

/**
 * The plans as the App Store will actually charge for them.
 *
 * Returns `{ pro: { id, title, price, amount }, … }` — `price` already
 * formatted by StoreKit in the storefront's own currency and conventions.
 */
export async function offers() {
  const plugin = store();
  if (!plugin) return {};
  const ids = await products();
  const wanted = Object.entries(ids).filter(([, id]) => id);
  const { products: found } = await plugin.products({ ids: wanted.map(([, id]) => id) });

  const byId = Object.fromEntries((found || []).map((p) => [p.id, p]));
  return Object.fromEntries(
    wanted.map(([plan, id]) => [plan, byId[id]]).filter(([, p]) => p),
  );
}

/**
 * Post one signed transaction to the server for verification.
 *
 * Separated from `land` below so the ordering that matters can be tested
 * without a network: `land` is the rule, this is the errand.
 */
async function verifyOnServer(tx) {
  const t = await token();
  if (!t) throw new Error("sign in first, so we know whose subscription this is");

  const res = await fetch("/api/apple/verify", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${t}` },
    body: JSON.stringify({ signedTransaction: tx.signedTransaction }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(SAYS[out.error] || "we couldn't confirm that purchase");
  return out;
}

/**
 * Hand one signed transaction to the server, and only then finish it.
 *
 * The single path every route into this file converges on — a fresh purchase,
 * a restore, a renewal that arrived while the app was closed, and a payment
 * that never reached the server on its first attempt. One implementation,
 * because four copies of "verify then finish" are four chances to get the
 * order wrong in the one place where the order is the entire point.
 *
 * If verification throws, the transaction is deliberately left unfinished:
 * StoreKit re-offers it at the next launch, and the customer who paid while
 * the server was down ends up on their plan without doing anything. Finishing
 * first would turn that into a permanent loss recoverable only by a human.
 *
 * `deps` exists so the sequence above can be asserted in a test rather than
 * hoped about. Production passes nothing.
 */
async function land(tx, deps = {}) {
  const verify = deps.verify ?? verifyOnServer;
  const out = await verify(tx);
  if (tx.transactionId) {
    await (deps.finish ?? ((id) => store()?.finish({ transactionId: id })))(tx.transactionId);
  }
  return out;
}

/**
 * Buy a plan.
 *
 * Never throws for a cancelled sheet. Somebody closing a payment sheet has
 * done an ordinary thing and should not meet an error for it.
 */
export async function buy(plan, deps = {}) {
  const plugin = store();
  if (!plugin) throw new Error("this build cannot buy from the App Store");

  const { available } = await plugin.available();
  if (!available) return { ok: false, reason: "cannot_pay" };

  const ids = await products(deps);
  const id = ids[plan];
  if (!id) throw new Error(`no App Store product for ${plan}`);

  const result = await plugin.purchase({ id });
  if (result.state === "cancelled") return { ok: false, reason: "cancelled" };
  // Ask-to-Buy: a child has asked a parent and the answer may be hours away.
  // It arrives through the transaction listener, so this is a real outcome
  // rather than a failure, and the copy upstream says so.
  if (result.state === "pending") return { ok: false, reason: "pending" };
  if (result.state !== "purchased") return { ok: false, reason: "unknown" };

  const out = await land(result, deps);
  return { ok: true, plan: out.plan ?? plan };
}

/**
 * Restore purchases. Required by 3.1.1, and the first thing review looks for.
 *
 * The case it exists for is a new phone: the App Store knows this Apple ID is
 * paying, and nothing else does. Without it, a customer who reinstalls is
 * looking at a paywall for something they are already being charged for, and
 * their only recourse is to pay twice.
 */
export async function restore(deps = {}) {
  const plugin = store();
  if (!plugin) throw new Error("this build cannot buy from the App Store");

  const { entitlements } = await plugin.restore();
  if (!entitlements?.length) return { ok: false, reason: "nothing_to_restore" };

  let plan = null;
  for (const tx of entitlements) {
    const out = await land(tx, deps);
    if (out.plan && out.plan !== "free") plan = out.plan;
  }
  return plan ? { ok: true, plan } : { ok: false, reason: "nothing_to_restore" };
}

/**
 * Everything StoreKit is still holding, put through the same path.
 *
 * Called at launch and whenever the app comes back. This is what closes the
 * loop on a renewal that happened overnight, a refund granted by Apple, and
 * the killed-mid-purchase case described at the top of the file. It asks for
 * nothing and prompts for nothing, so it is safe to run unattended — unlike
 * `restore()`, which asks for the App Store password and must only ever run
 * when somebody taps a button.
 */
export async function reconcile(deps = {}) {
  const plugin = store();
  if (!plugin) return { ok: false, reason: "unavailable" };
  // Nothing to reconcile against without an account: the plan is written to a
  // profile, and there is no profile until somebody signs in.
  if (!(await (deps.session ?? token)())) return { ok: false, reason: "signed_out" };

  try {
    const { entitlements } = await plugin.current();
    for (const tx of entitlements || []) await land(tx, deps);
    return { ok: true, count: entitlements?.length ?? 0 };
  } catch {
    // Offline, or the server is down. StoreKit keeps the transaction; the next
    // resume tries again. Nothing to show the customer for a retry they did
    // not ask for.
    return { ok: false, reason: "deferred" };
  }
}

/** Server errors, said the way a person would say them. */
const SAYS = {
  bad_signature: "that receipt didn't check out — try again, or contact support",
  wrong_bundle: "that receipt belongs to a different app",
  sandbox_not_allowed: "that's a test purchase, and this is the live app",
  already_claimed: "that subscription is already on another account",
  no_transaction: "the App Store didn't give us anything to check",
  unauthorized: "sign in first, so we know whose subscription this is",
};

/**
 * What to say when a purchase did not complete. Never blames the customer.
 *
 * `cancelled` maps to null deliberately: somebody who closed the payment sheet
 * did a considered thing, and telling them about it is noise at best and an
 * accusation at worst.
 *
 * Read with `in` rather than `??`, and that is the whole reason this is a
 * named table instead of an inline object. `??` treats the considered silence
 * as a missing entry and helpfully substitutes the default — so the one
 * sentence this table exists to keep away from somebody who simply changed
 * their mind ("that didn't go through") was the sentence they got.
 */
const OUTCOMES = {
  cancelled: null,
  pending: "Asked for approval. The plan starts the moment it's approved — nothing more to do.",
  cannot_pay: "This device can't make App Store purchases. Check Screen Time restrictions, or subscribe on the web.",
  nothing_to_restore: "No subscription found on this Apple ID.",
  unavailable: "Not available in this build.",
  signed_out: "Sign in first.",
};

export const sayOutcome = (reason) =>
  reason in OUTCOMES ? OUTCOMES[reason] : "That didn't go through. Nothing has been charged.";
