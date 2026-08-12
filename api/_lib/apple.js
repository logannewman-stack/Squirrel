import { createVerify, X509Certificate } from "node:crypto";

/**
 * App Store subscriptions, in the parts that decide what somebody is entitled to.
 *
 * Apple is the payment processor for anything bought inside the iOS or Mac app
 * — Guideline 3.1.1 is not negotiable, and sending an in-app upgrade to Stripe
 * is a rejection rather than a debate. So entitlement has two sources, and this
 * file is the Apple half of it.
 *
 * ## Everything here is signed, and the signature is the whole point
 *
 * StoreKit 2 hands the app a `JWSTransaction`: a JSON Web Signature whose
 * header carries the certificate chain that signed it. Apple's server
 * notifications arrive the same way. The payload is base64 and trivially
 * forgeable — a client that posts `{"productId":"studio_monthly"}` and is
 * believed has just given itself a free subscription — so nothing in here
 * trusts a payload until the chain behind it has been verified up to Apple's
 * own root.
 *
 * ## The identity that survives a renewal
 *
 * `transactionId` changes every single renewal. `originalTransactionId` does
 * not: it is the subscription itself, from first purchase to final lapse.
 * Keying off the wrong one produces an account that appears to buy a brand-new
 * subscription every month and never cancels the old one.
 */

/**
 * Apple Root CA — G3.
 *
 * The trust anchor for every receipt and notification Apple signs. Pinned here
 * rather than read from the system store: the system store is a moving target
 * across runtimes, and "which roots does this container happen to trust" is not
 * a question that should decide whether somebody's subscription works.
 */
export const APPLE_ROOT_G3_CN = "Apple Root CA - G3";

/** Which plan a product id grants. Configured, because product ids are per-app. */
export function planForProduct(productId, products = {}) {
  if (!productId) return null;
  for (const [plan, id] of Object.entries(products)) {
    if (id && id === productId) return plan;
  }
  return null;
}

/** Split a JWS into its three parts without trusting any of them yet. */
export function partsOf(jws) {
  if (typeof jws !== "string") return null;
  const bits = jws.split(".");
  if (bits.length !== 3) return null;
  return { header: bits[0], payload: bits[1], signature: bits[2], signed: `${bits[0]}.${bits[1]}` };
}

const decodeJson = (b64) => {
  try {
    return JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
};

/** The payload, with no verification at all. Never use this to grant anything. */
export const unsafeDecode = (jws) => {
  const p = partsOf(jws);
  return p ? decodeJson(p.payload) : null;
};

/**
 * Verify a JWS the way Apple signs them, and return the payload.
 *
 * The header's `x5c` is the chain: leaf first, then intermediate, then root.
 * Three things have to hold, and all three are checked — skipping any one of
 * them makes the other two decorative:
 *
 *   1. Each certificate is actually signed by the next one up.
 *   2. The chain ends at Apple's root, not at something the caller supplied.
 *   3. The leaf signs this exact payload.
 *
 * Returns null on any failure, without saying which: the difference between
 * "bad signature" and "expired certificate" is useful only to somebody
 * attacking it.
 */
export function verifyJws(jws, { now = Date.now(), rootCN = APPLE_ROOT_G3_CN } = {}) {
  const parts = partsOf(jws);
  if (!parts) return null;

  const header = decodeJson(parts.header);
  const chain = header?.x5c;
  if (!Array.isArray(chain) || chain.length < 2) return null;
  // ES256 is what Apple uses. Accepting `alg: none` — or anything the header
  // asks for — is the classic JWT forgery, so the algorithm is pinned here
  // rather than read from attacker-controlled input.
  if (header.alg !== "ES256") return null;

  let certs;
  try {
    certs = chain.map((der) => new X509Certificate(Buffer.from(der, "base64")));
  } catch {
    return null;
  }

  // The chain must terminate at Apple's root. Without this check the caller
  // could send a chain they generated themselves, entirely self-consistent,
  // and every signature in it would verify.
  const root = certs[certs.length - 1];
  if (!root.subject.includes(rootCN)) return null;

  for (let i = 0; i < certs.length; i++) {
    const cert = certs[i];
    if (now < Date.parse(cert.validFrom) || now > Date.parse(cert.validTo)) return null;
    const issuer = certs[i + 1];
    if (issuer && !cert.verify(issuer.publicKey)) return null;
  }
  // A root that does not sign itself is not the root it claims to be.
  if (!root.verify(root.publicKey)) return null;

  // Apple signs with raw r||s (JWS), not DER, so the verifier is told so.
  const ok = createVerify("SHA256")
    .update(parts.signed)
    .verify(
      { key: certs[0].publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(parts.signature, "base64url"),
    );

  return ok ? decodeJson(parts.payload) : null;
}

/**
 * Statuses in which the customer may use what they paid for.
 *
 * A refund revokes immediately — that is a decision Apple has already made and
 * money that has already gone back. Everything else runs to the paid-for date,
 * including a cancellation: they bought the month.
 */
export function entitlementFrom(tx, { products = {}, now = Date.now() } = {}) {
  if (!tx) return null;

  const expires = Number(tx.expiresDate) || null;
  const grace = Number(tx.gracePeriodExpiresDate) || null;
  const revoked = Number(tx.revocationDate) || null;

  // A refund or a family-sharing revoke ends access now, whatever the dates say.
  const entitled = revoked
    ? false
    : Boolean((expires && now < expires) || (grace && now < grace));

  return {
    /**
     * An unknown product grants nothing — never a default upgrade. This read
     * `?? "pro"`, so any Apple-signed subscription whose productId this app
     * did not recognise (a subscription to some *other* app on the same Apple
     * account) mapped straight to the paid tier. With verify.js not checking
     * the bundle either, that was a free Pro for anyone holding any App Store
     * receipt. An entitled transaction we cannot place is treated as free;
     * verify.js separately rejects a foreign bundle before we get here.
     */
    plan: entitled ? (planForProduct(tx.productId, products) ?? "free") : "free",
    // The subscription's identity across every renewal it will ever have.
    originalTransactionId: tx.originalTransactionId ?? null,
    transactionId: tx.transactionId ?? null,
    expiresAt: expires ? new Date(expires).toISOString() : null,
    environment: tx.environment ?? null,
    revoked: Boolean(revoked),
  };
}

/**
 * What a server notification means for entitlement.
 *
 * Apple sends the transaction with every notification, so the dates are the
 * real answer and the type is mostly context. Two types are exceptions worth
 * naming, because they revoke rather than expire: a refund and a revoke both
 * end access before the date the customer paid through.
 */
export const REVOKING = new Set(["REFUND", "REVOKE"]);

/** Types that carry no entitlement change and should not be acted on. */
export const INFORMATIONAL = new Set([
  "CONSUMPTION_REQUEST", "PRICE_INCREASE", "RENEWAL_EXTENDED", "TEST",
]);

/**
 * Is this notification older than what has already been applied?
 *
 * Apple retries for days and does not guarantee order, so a late DID_RENEW can
 * arrive after the EXPIRED that followed it. Applying that pair in the order
 * they land leaves a paying customer on the free tier.
 */
export function isStale(signedDate, appliedAtIso) {
  if (!appliedAtIso) return false;
  const applied = Date.parse(appliedAtIso);
  if (Number.isNaN(applied)) return false;
  return Number(signedDate) < applied;
}

/**
 * The profile columns a verified transaction implies.
 *
 * Only what billing owns, so a caller holding service-role credentials cannot
 * accidentally write anything else.
 */
export function profileFrom(entitlement, tiers = []) {
  const plan = entitlement?.plan ?? "free";
  return {
    plan: tiers.includes(plan) ? plan : "free",
    apple_transaction_id: entitlement?.originalTransactionId ?? null,
    plan_renews_at: entitlement?.expiresAt ?? null,
    billing_status: entitlement?.revoked
      ? "refunded"
      : entitlement?.plan === "free" ? "expired" : "active",
    billing_alert: entitlement?.revoked ? "refunded" : null,
  };
}
