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
  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });

  const auth = await requireUser(req);
  if (!auth) return json(res, 401, { error: "unauthorized" });

  const { signedTransaction } = req.body || {};
  if (!signedTransaction) return json(res, 400, { error: "no_transaction" });

  const tx = verifyJws(signedTransaction);
  if (!tx) return json(res, 400, { error: "bad_signature" });

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
