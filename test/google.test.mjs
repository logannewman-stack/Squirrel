/**
 * Calendar sync, in the parts that decide whether somebody's meetings survive.
 *
 * Sync bugs are quiet. Nothing throws — a meeting is simply on the calendar
 * twice, or an edit made on a phone is gone with no record it happened, and the
 * first report comes from a customer who no longer trusts the app with their
 * day. So the two failures that cause that are pinned here: the echo (our own
 * write coming home and being created again) and the overwrite (both sides
 * changed and one is silently discarded).
 */

import {
  toGoogle, fromGoogle, instantOf, isEcho, resolve,
  needsRefresh, expiryFrom, isPermanentAuthFailure, consentUrl,
} from "../api/_lib/google.js";

let pass = 0, fail = 0;
const failures = [];
const t = (name, ok, detail) => {
  if (ok) pass++; else { fail++; failures.push(name); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

// The database layer is absolute instants — `starts_at`/`ends_at` are
// timestamptz. The browser's wall-clock shape is merge.js's business, not this
// file's, and doing that conversion twice is how the two copies drift apart.
const START = "2026-08-12T18:00:00.000Z";
const END = "2026-08-12T19:00:00.000Z";

// ------------------------------------------------------------------ mapping
{
  const row = {
    title: "Board call", starts_at: START, ends_at: END,
    location: "Zoom", notes: "Q3 numbers",
    attendees: [{ name: "Bob", email: "bob@x.com" }, { name: "NoEmail" }],
  };
  const g = toGoogle(row);

  t("the instant goes out as an instant", g.start.dateTime === START, g.start.dateTime);
  t("the title becomes the summary", g.summary === "Board call");
  // An attendee with no email cannot be invited; sending one makes Google 400
  // the whole write, which would take the rest of the event with it.
  t("attendees without an address are dropped", g.attendees.length === 1, JSON.stringify(g.attendees));

  // The round trip is what actually matters: a meeting that drifts by the UTC
  // offset every sync is the classic failure here. Google answers in whatever
  // zone the calendar uses, so the offset form must land on the same instant.
  const back = fromGoogle({
    summary: "Board call",
    start: { dateTime: "2026-08-12T14:00:00-04:00" },
    end: { dateTime: "2026-08-12T15:00:00-04:00" },
  });
  t("an offset time comes back as the same instant", back.starts_at === START, back.starts_at);
  t("with the end intact", back.ends_at === END, back.ends_at);

  t("an all-day event anchors to midnight UTC",
    instantOf({ date: "2026-08-12" }) === "2026-08-12T00:00:00.000Z");
  t("a cancelled row maps to nothing", fromGoogle({ status: "cancelled" }) === null);
  t("a row with no start maps to nothing", fromGoogle({ summary: "x" }) === null);
  t("garbage maps to nothing, not an exception", fromGoogle(undefined) === null);
  t("an unparseable time maps to nothing", instantOf({ dateTime: "soon" }) === null);
  // The schema requires ends_at > starts_at, so a zero-length remote event has
  // to be dropped here or it fails the insert and takes the page with it.
  t("a zero-length event is refused", fromGoogle({
    summary: "x", start: { dateTime: START }, end: { dateTime: START },
  }) === null);
  t("an untitled event still has a title", fromGoogle({
    start: { dateTime: START }, end: { dateTime: END },
  }).title === "(no title)");
  // Our own copy is on every Google event as `self`; keeping it would add the
  // user to their own meeting on every sync.
  t("the user is not an attendee of their own meeting", fromGoogle({
    summary: "x", start: { dateTime: START }, end: { dateTime: END },
    attendees: [{ email: "me@x.com", self: true }, { email: "bob@x.com" }],
  }).attendees.length === 1);
}

// --------------------------------------------------------------------- echo
{
  t("a matching etag is our own write", isEcho({ etag: "abc" }, { etag: "abc" }));
  t("a different etag is real news", isEcho({ etag: "abc" }, { etag: "xyz" }) === false);
  t("no link at all is not an echo", isEcho({ etag: "abc" }, null) === false);

  // The push we made but never saw the etag for.
  const pushed = "2026-08-12T10:00:00.000Z";
  t("a write we just made is an echo", isEcho({ updated: pushed }, { pushed_at: pushed }));
  t("a change an hour later is not", isEcho(
    { updated: "2026-08-12T11:00:00.000Z" }, { pushed_at: pushed }) === false);
  t("never pushed means never an echo", isEcho({ updated: pushed }, { etag: null }) === false);
}

// ---------------------------------------------------------------- conflicts
{
  const link = { pulled_at: "2026-08-12T10:00:00Z", pushed_at: "2026-08-12T10:00:00Z" };
  const later = "2026-08-12T12:00:00Z";
  const earlier = "2026-08-12T09:00:00Z";

  t("only local moved → push", resolve({ localUpdatedAt: later, remoteUpdatedAt: earlier, link }) === "push");
  t("only remote moved → pull", resolve({ localUpdatedAt: earlier, remoteUpdatedAt: later, link }) === "pull");
  t("neither moved → nothing", resolve({ localUpdatedAt: earlier, remoteUpdatedAt: earlier, link }) === "none");
  // The one that decides whose edit survives. Google is shared: other people
  // have already seen that time.
  t("both moved → the shared copy wins",
    resolve({ localUpdatedAt: later, remoteUpdatedAt: later, link }) === "pull");
  t("no link yet and a local edit → push",
    resolve({ localUpdatedAt: later, remoteUpdatedAt: null, link: null }) === "push");
}

// ------------------------------------------------------------------- tokens
{
  const now = Date.parse("2026-08-12T10:00:00Z");
  t("an expired token needs refreshing", needsRefresh("2026-08-12T09:00:00Z", now));
  t("one expiring in seconds needs refreshing too", needsRefresh("2026-08-12T10:00:30Z", now));
  t("one with an hour left does not", needsRefresh("2026-08-12T11:00:00Z", now) === false);
  t("a missing expiry always refreshes", needsRefresh(null, now));

  t("expiry is computed from expires_in", expiryFrom(3600, now) === "2026-08-12T11:00:00.000Z");
  t("a missing expires_in falls back to an hour", expiryFrom(undefined, now) === "2026-08-12T11:00:00.000Z");

  // Retrying a revoked grant forever is how one broken link becomes a job that
  // never stops failing.
  t("a revoked grant is permanent", isPermanentAuthFailure(400, { error: "invalid_grant" }));
  t("a bad token is permanent", isPermanentAuthFailure(401, { error: "invalid_token" }));
  t("a rate limit is not", isPermanentAuthFailure(429, { error: "rateLimitExceeded" }) === false);
  t("a backend error is not", isPermanentAuthFailure(503, "backendError") === false);
}

// ------------------------------------------------------------------ consent
{
  const url = consentUrl({ clientId: "cid", redirectUri: "https://x/cb", state: "s1" });
  // Without both of these Google returns an access token and no refresh token:
  // the link works for an hour and then dies silently.
  t("consent asks for offline access", url.includes("access_type=offline"));
  t("and forces the prompt, or there is no refresh token", url.includes("prompt=consent"));
  t("the state is carried", url.includes("state=s1"));
  t("the redirect is exact", url.includes(encodeURIComponent("https://x/cb")));
}

console.log(`\nGoogle sync: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
