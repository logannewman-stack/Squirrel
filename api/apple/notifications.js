import { asService, json } from "../_lib/db.js";
import {
  verifyJws, entitlementFrom, profileFrom, isStale, INFORMATIONAL,
} from "../_lib/apple.js";
import { TIERS } from "../_lib/billing.js";

/**
 * App Store Server Notifications V2.
 *
 * Everything that happens to a subscription after the first purchase arrives
 * here: renewals, cancellations, billing failures, refunds, and the grace
 * periods between them. Without it a subscription is granted once and then
 * believed forever — a customer who refunded in March would still be Pro in
 * December.
 *
 * Apple retries for days and does not guarantee order, so this assumes every
 * notification may arrive twice, late, and out of sequence. That is documented
 * behaviour rather than pessimism, and a handler that assumes otherwise drops
 * paying customers to free occasionally and inexplicably.
 */

const PRODUCTS = {
  pro: process.env.APPLE_PRODUCT_PRO,
  studio: process.env.APPLE_PRODUCT_STUDIO,
};

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });

  const { signedPayload } = req.body || {};
  const note = signedPayload ? verifyJws(signedPayload) : null;
  // Unsigned, or not signed by Apple. Answered 400 and never acted on — this
  // endpoint is public, so the signature is the only thing separating Apple
  // from anyone who found the URL.
  if (!note) return json(res, 400, { error: "bad_signature" });

  if (INFORMATIONAL.has(note.notificationType)) return json(res, 200, { ignored: note.notificationType });

  // The transaction is nested and signed separately; the outer signature says
  // Apple sent this, the inner one says what it is about.
  const tx = note.data?.signedTransactionInfo
    ? verifyJws(note.data.signedTransactionInfo)
    : null;
  if (!tx?.originalTransactionId) return json(res, 200, { ignored: "no_transaction" });

  const db = asService();
  const { data: profile } = await db
    .from("profiles").select("id, billing_event_at")
    .eq("apple_transaction_id", tx.originalTransactionId).maybeSingle();

  // A notification for a subscription no account has claimed yet. Accepted
  // rather than retried: the verify endpoint will attach it moments later, and
  // a 500 here would have Apple redelivering for days over a race.
  if (!profile) return json(res, 200, { ignored: "unknown_subscription" });

  if (isStale(note.signedDate, profile.billing_event_at)) {
    return json(res, 200, { ignored: "stale" });
  }

  const entitlement = entitlementFrom(tx, { products: PRODUCTS });

  await db.from("profiles").update({
    ...profileFrom(entitlement, TIERS),
    billing_event_at: new Date(Number(note.signedDate) || Date.now()).toISOString(),
  }).eq("id", profile.id);

  return json(res, 200, { received: true });
}
