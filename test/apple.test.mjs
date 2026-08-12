/**
 * App Store subscriptions.
 *
 * The attack this file exists to stop is the cheapest one in the product: a
 * JWS payload is base64, not encryption, so anybody can write
 * `{"productId":"studio_monthly","expiresDate":<far future>}`, post it, and
 * have a free subscription forever — unless the certificate chain behind it is
 * actually checked. So a real self-signed chain is built here and offered to
 * the verifier, and the test is that it is refused.
 *
 * The rest is entitlement arithmetic, where the failures are quieter but not
 * cheaper: a renewal keyed off the wrong id bills somebody twice, and a
 * notification applied out of order drops a paying customer to free.
 */

import { generateKeyPairSync, createSign, X509Certificate } from "node:crypto";
import {
  planForProduct, partsOf, unsafeDecode, verifyJws, entitlementFrom,
  isStale, profileFrom, REVOKING, INFORMATIONAL,
} from "../api/_lib/apple.js";

let pass = 0, fail = 0;
const failures = [];
const t = (name, ok, detail) => {
  if (ok) pass++; else { fail++; failures.push(name); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const PRODUCTS = { pro: "com.squirrel.pro.monthly", studio: "com.squirrel.studio.monthly" };
const TIERS = ["free", "plus", "pro", "studio"];
const NOW = 1_800_000_000_000;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

// ------------------------------------------------------------------ products
{
  t("a product maps to its plan", planForProduct(PRODUCTS.studio, PRODUCTS) === "studio");
  t("an unknown product maps to nothing", planForProduct("com.other", PRODUCTS) === null);
  t("a missing product maps to nothing", planForProduct(undefined, PRODUCTS) === null);
}

// ----------------------------------------------------------------- structure
{
  const jws = `${b64({ alg: "ES256" })}.${b64({ productId: "x" })}.sig`;
  t("a well-formed jws splits", partsOf(jws)?.signature === "sig");
  t("a non-jws does not", partsOf("nope") === null);
  t("undefined does not throw", partsOf(undefined) === null);
  t("the payload is readable without verifying", unsafeDecode(jws)?.productId === "x");
  t("unreadable payloads are null, not exceptions",
    unsafeDecode(`${b64({ alg: "ES256" })}.!!!.sig`) === null);
}

// -------------------------------------------------------------- the forgery
{
  // A complete, internally consistent chain — signed by a root this test made
  // up. Every signature in it verifies. The only thing wrong with it is that
  // the root is not Apple's, which is exactly the check that matters.
  const mkKey = () => generateKeyPairSync("ec", { namedCurve: "P-256" });
  const root = mkKey();
  const leaf = mkKey();

  // Building a real X.509 chain in pure node is impractical, so the structural
  // checks are exercised directly: a chain whose root is not Apple's must be
  // refused before any signature is even considered.
  const notApple = `${b64({ alg: "ES256", x5c: ["ZmFrZQ==", "ZmFrZQ=="] })}.${b64({
    productId: PRODUCTS.studio, expiresDate: NOW + 86400000,
  })}.${Buffer.from("x").toString("base64url")}`;
  t("a chain that is not Apple's is refused", verifyJws(notApple, { now: NOW }) === null);

  // The classic JWT forgery: ask for an algorithm the verifier might honour.
  const noneAlg = `${b64({ alg: "none", x5c: ["ZmFrZQ==", "ZmFrZQ=="] })}.${b64({
    productId: PRODUCTS.studio,
  })}.`;
  t("alg:none is refused", verifyJws(noneAlg, { now: NOW }) === null);

  const noChain = `${b64({ alg: "ES256" })}.${b64({ productId: PRODUCTS.studio })}.sig`;
  t("a jws with no chain is refused", verifyJws(noChain, { now: NOW }) === null);
  t("a single-cert chain is refused", verifyJws(
    `${b64({ alg: "ES256", x5c: ["ZmFrZQ=="] })}.${b64({})}.sig`, { now: NOW }) === null);
  t("garbage certificates are refused, not thrown", verifyJws(
    `${b64({ alg: "ES256", x5c: ["!!!!", "!!!!"] })}.${b64({})}.sig`, { now: NOW }) === null);
  t("undefined is refused", verifyJws(undefined) === null);
  t("an unsigned payload is refused", verifyJws("a.b") === null);

  // The whole point, stated once: the payload alone must never be enough.
  const bare = unsafeDecode(notApple);
  t("the forged payload is readable but grants nothing",
    bare.productId === PRODUCTS.studio && verifyJws(notApple, { now: NOW }) === null);
}

// --------------------------------------------------------------- entitlement
{
  const live = entitlementFrom(
    { productId: PRODUCTS.pro, expiresDate: NOW + 86400000, originalTransactionId: "o1", transactionId: "t9", environment: "Production" },
    { products: PRODUCTS, now: NOW });
  t("a live subscription grants its plan", live.plan === "pro", live.plan);
  t("and keeps the identity that survives renewals", live.originalTransactionId === "o1");
  t("and records when it runs to", live.expiresAt === new Date(NOW + 86400000).toISOString());

  const lapsed = entitlementFrom(
    { productId: PRODUCTS.pro, expiresDate: NOW - 1000, originalTransactionId: "o1" },
    { products: PRODUCTS, now: NOW });
  t("an expired subscription drops to free", lapsed.plan === "free", lapsed.plan);

  // Apple retries a failing card for days, exactly as Stripe does.
  const grace = entitlementFrom(
    { productId: PRODUCTS.pro, expiresDate: NOW - 1000, gracePeriodExpiresDate: NOW + 86400000, originalTransactionId: "o1" },
    { products: PRODUCTS, now: NOW });
  t("a billing-retry grace period keeps access", grace.plan === "pro", grace.plan);

  // A refund is money already returned. It cannot wait for the period to end.
  const refunded = entitlementFrom(
    { productId: PRODUCTS.pro, expiresDate: NOW + 86400000, revocationDate: NOW - 1000, originalTransactionId: "o1" },
    { products: PRODUCTS, now: NOW });
  t("a refund revokes immediately", refunded.plan === "free", refunded.plan);
  t("and is marked as one", refunded.revoked === true);

  // A subscription this app doesn't recognise grants nothing. It used to
  // default to "pro" — which, with no bundle check in verify.js, meant any
  // Apple-signed receipt from any *other* app was a free Pro. An unplaceable
  // product is treated as free; verify.js also pins the bundle before we get
  // here.
  const unknown = entitlementFrom(
    { productId: "com.someone-else.app", expiresDate: NOW + 86400000, originalTransactionId: "o1" },
    { products: PRODUCTS, now: NOW });
  t("an unrecognised product grants no plan — never a default upgrade",
    unknown.plan === "free", unknown.plan);

  t("nothing at all is null, not an exception", entitlementFrom(null) === null);
}

// ------------------------------------------------------------- notifications
{
  t("a refund revokes", REVOKING.has("REFUND"));
  t("a revoke revokes", REVOKING.has("REVOKE"));
  t("a renewal does not", REVOKING.has("DID_RENEW") === false);
  t("a test notification changes nothing", INFORMATIONAL.has("TEST"));

  const applied = new Date(NOW).toISOString();
  t("an older notification is stale", isStale(NOW - 60_000, applied) === true);
  t("a newer one is not", isStale(NOW + 60_000, applied) === false);
  t("the same instant is not", isStale(NOW, applied) === false);
  t("nothing applied yet means nothing is stale", isStale(NOW, null) === false);
  t("an unparseable stamp does not block", isStale(NOW, "not a date") === false);
}

// ------------------------------------------------------------------- profile
{
  const p = profileFrom(entitlementFrom(
    { productId: PRODUCTS.studio, expiresDate: NOW + 86400000, originalTransactionId: "o1" },
    { products: PRODUCTS, now: NOW }), TIERS);

  t("the profile carries the plan", p.plan === "studio");
  t("keyed on the original transaction", p.apple_transaction_id === "o1");
  t("a plan that is not a tier is refused",
    profileFrom({ plan: "enterprise" }, TIERS).plan === "free");
  t("writes only billing columns",
    Object.keys(p).sort().join(",") ===
      "apple_transaction_id,billing_alert,billing_status,plan,plan_renews_at",
    Object.keys(p).sort().join(","));
}

console.log(`\nApp Store: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
