import { asService, requireUser, json } from "../_lib/db.js";
import { verifyJws, entitlementFrom, profileFrom } from "../_lib/apple.js";
import { TIERS } from "../_lib/billing.js";

/**
 * The native app has bought a subscription; grant it.
 *
 * StoreKit 2 hands the app a signed transaction. The app posts it here, and
 * this is the moment the account actually becomes paid — the notification
 * webhook keeps it that way afterwards, but a customer who has just paid should
 * not have to wait for a webhook to see what they bought.
 *
 * The transaction is verified against Apple's certificate chain before anything
 * is written. It arrives from a client, and a client-supplied payload that is
 * believed on sight is a free subscription for anyone who can read base64.
 */

const PRODUCTS = {
  pro: process.env.APPLE_PRODUCT_PRO,
  studio: process.env.APPLE_PRODUCT_STUDIO,
};

export default async function handler(req, res) {
  /**
   * GET: which product id is which plan.
   *
   * The app has to know what to ask StoreKit for, and the ids live here in
   * `APPLE_PRODUCT_*` because this is the endpoint that matches a receipt
   * against them. A second copy compiled into the bundle is a copy that goes
   * stale on the next rename, and the failure it produces is the worst
   * available: the purchase succeeds, Apple charges the card, and the server
   * does not recognise what was bought.
   *
   * Unauthenticated, because there is nothing here to protect — an App Store
   * product id is printed in App Store Connect, visible in any receipt, and
   * readable from the binary by anybody who cares. Requiring a session would
   * only stop the paywall from drawing prices before sign-in.
   */
  if (req.method === "GET") {
    return json(res, 200, {
      products: { pro: PRODUCTS.pro ?? null, studio: PRODUCTS.studio ?? null },
      configured: Boolean(PRODUCTS.pro || PRODUCTS.studio),
    });
  }

  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });

  const auth = await requireUser(req);
  if (!auth) return json(res, 401, { error: "unauthorized" });

  const { signedTransaction } = req.body || {};
  if (!signedTransaction) return json(res, 400, { error: "no_transaction" });

  const tx = verifyJws(signedTransaction);
  if (!tx) return json(res, 400, { error: "bad_signature" });

  /**
   * A valid Apple signature proves the receipt is real — not that it is *this
   * app's* receipt. Every App Store subscription is signed by the same Apple
   * chain, so without a bundle check a genuine receipt from another app on
   * the customer's account would verify here and (with the old default-to-pro)
   * grant Pro. Pin it to our bundle. APPLE_BUNDLE_ID unset skips the check
   * with the receipt still verified — set it in production so a foreign
   * bundle is refused outright.
   */
  const bundle = process.env.APPLE_BUNDLE_ID?.trim();
  if (bundle && tx.bundleId && tx.bundleId !== bundle) {
    return json(res, 400, { error: "wrong_bundle" });
  }

  // Sandbox transactions must not grant a paid plan in production, or every
  // TestFlight build is a free subscription generator.
  const wantSandbox = process.env.APPLE_ALLOW_SANDBOX === "true";
  if (tx.environment === "Sandbox" && !wantSandbox) {
    return json(res, 400, { error: "sandbox_not_allowed" });
  }

  const entitlement = entitlementFrom(tx, { products: PRODUCTS });
  const db = asService();

  // One subscription, one account. Without this, a single purchase could be
  // replayed against any number of accounts — buy once, hand the transaction
  // to a friend, and both are Pro forever.
  const original = entitlement.originalTransactionId;
  if (original) {
    const { data: taken } = await db
      .from("profiles").select("id").eq("apple_transaction_id", original).maybeSingle();
    if (taken && taken.id !== auth.user.id) {
      return json(res, 409, { error: "already_redeemed" });
    }
  }

  await db.from("profiles").update({
    ...profileFrom(entitlement, TIERS),
    billing_event_at: new Date().toISOString(),
  }).eq("id", auth.user.id);

  return json(res, 200, { plan: entitlement.plan, renewsAt: entitlement.expiresAt });
}
