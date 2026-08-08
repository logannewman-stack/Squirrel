import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

/**
 * The OAuth `state` parameter, signed.
 *
 * Google's redirect comes back as an ordinary browser navigation: no
 * Authorization header, no cookie we can rely on across a third-party
 * redirect. The only thing that survives the round trip is `state`, so the
 * user's identity has to travel in it — which means it has to be unforgeable.
 *
 * Unsigned, the attack is trivial and total: call the callback with somebody
 * else's user id in the URL and their account is now synced to a calendar the
 * attacker controls, reading every meeting they own. So this is an HMAC over
 * the payload, compared in constant time, with an expiry — a consent screen
 * left open for a day is not a valid login.
 *
 * The secret defaults to the service-role key, which every deployment that has
 * a backend already has, so there is one fewer thing to forget to set. It is
 * never sent anywhere: only the digest goes out.
 */

const TTL_MS = 15 * 60 * 1000;

const secret = () =>
  process.env.OAUTH_STATE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const b64 = (buf) => Buffer.from(buf).toString("base64url");

const digest = (body) => b64(createHmac("sha256", secret()).update(body).digest());

/** Sign a payload for the round trip through Google. */
export function sign(payload) {
  if (!secret()) throw new Error("no signing secret");
  const body = b64(JSON.stringify({ ...payload, n: randomBytes(6).toString("hex") }));
  return `${body}.${digest(body)}`;
}

/**
 * Verify and unpack, or null.
 *
 * Every failure returns the same null rather than saying which check failed:
 * "bad signature" and "expired" are useful to an attacker and identical to
 * everyone else.
 */
export function verify(token, now = Date.now()) {
  if (!secret() || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;

  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(digest(body));
  // Lengths must match before timingSafeEqual, which throws otherwise — and the
  // length itself is not a secret.
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload?.at || now - payload.at > TTL_MS) return null;
  return payload;
}
