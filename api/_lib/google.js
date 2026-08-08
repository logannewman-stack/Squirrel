/**
 * Google Calendar, in the parts that can be reasoned about without a network.
 *
 * The shape-handling is separated from the calling for the same reason billing
 * is: a sync bug does not throw in development, it quietly duplicates somebody's
 * meetings or deletes one it should have kept, and the first report comes from a
 * customer. So the mapping, the echo detection, and the token arithmetic live
 * here as pure functions with tests, and the I/O around them stays thin enough
 * to read.
 *
 * ## The two failures this file exists to prevent
 *
 * **The loop.** We push an event to Google. The next pull sees an event we do
 * not recognise and creates it locally. The local write is then pushed back.
 * One meeting becomes four. `event_links` is the map that stops this, and
 * `isEcho` is the test: a remote copy whose etag we already recorded is our own
 * write coming home, not news.
 *
 * **The overwrite.** Both sides changed since the last sync. Whoever is applied
 * second wins and the other edit is gone with no record it existed. `resolve`
 * makes that choice explicit and, where the two are genuinely concurrent,
 * prefers the remote — Google is shared with other people, so its copy is the
 * one others have already seen and planned around.
 */

/** Scopes: read and write events, plus the account's address to label the link. */
export const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const API = "https://www.googleapis.com/calendar/v3";

/**
 * The consent URL.
 *
 * `access_type=offline` with `prompt=consent` is what actually returns a
 * refresh token. Without the prompt, a user who has authorised before gets an
 * access token and nothing else — the link then works for an hour and dies
 * silently, which is the single most common way this integration breaks.
 */
export function consentUrl({ clientId, redirectUri, state }) {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${q}`;
}

/**
 * Our event row, as Google wants it.
 *
 * This works on the *database* row — `starts_at` / `ends_at`, which are
 * `timestamptz` and therefore absolute instants — not on the local wall-clock
 * shape the browser holds. That conversion already exists in exactly one place
 * (src/lib/merge.js) and doing it a second time here is how the two copies
 * drift apart by an offset.
 *
 * Sending an instant also removes the ambiguity entirely: an RFC3339 timestamp
 * with a zone means one moment everywhere, so there is no zone to guess at and
 * no round trip that can shift a meeting by an hour.
 */
export function toGoogle(row) {
  return {
    summary: row.title,
    location: row.location || undefined,
    description: row.notes || undefined,
    start: { dateTime: new Date(row.starts_at).toISOString() },
    end: { dateTime: new Date(row.ends_at).toISOString() },
    attendees: (row.attendees || [])
      .map((a) => (typeof a === "string" ? { name: a } : a))
      .filter((a) => a?.email)
      .map((a) => ({ email: a.email, displayName: a.name || undefined })),
  };
}

/**
 * A Google timestamp as an absolute instant.
 *
 * `dateTime` carries its own offset, so parsing it is exact. An all-day event
 * has `date` alone and genuinely has no instant — it is a whole day in the
 * viewer's own zone — so it is anchored at UTC midnight and allowed to be
 * approximate rather than dropped, which would hide birthdays and holidays.
 */
export function instantOf(when) {
  if (!when) return null;
  const raw = when.dateTime || (when.date ? `${when.date}T00:00:00Z` : null);
  if (!raw) return null;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/**
 * A Google event, as a database row.
 *
 * Returns null for anything that cannot become one — a cancelled row, or one
 * with no usable start — so callers can filter rather than branch.
 */
export function fromGoogle(g) {
  if (!g || g.status === "cancelled") return null;
  const starts_at = instantOf(g.start);
  const ends_at = instantOf(g.end);
  if (!starts_at || !ends_at) return null;
  // The schema requires ends_at > starts_at; a zero-length remote event would
  // otherwise fail the insert and take the rest of the page with it.
  if (new Date(ends_at) <= new Date(starts_at)) return null;

  return {
    title: g.summary?.trim() || "(no title)",
    starts_at,
    ends_at,
    location: g.location || "",
    notes: g.description || "",
    attendees: (g.attendees || [])
      .filter((a) => !a.self)
      .map((a) => ({ name: a.displayName || a.email, email: a.email })),
  };
}

/**
 * Is this remote row our own write echoing back?
 *
 * Google returns the event we just created on the very next incremental pull.
 * Without this it reads as something new and gets created a second time.
 * Matching on etag rather than on time is what makes it reliable: clocks are
 * not comparable across machines, but an etag is the exact version we wrote.
 */
export function isEcho(remote, link) {
  if (!link) return false;
  if (link.etag && remote?.etag && link.etag === remote.etag) return true;
  // A push we recorded but whose etag we never saw. Anything within the window
  // is ours; beyond it, treat it as a real change and let `resolve` decide.
  if (!link.pushed_at) return false;
  const pushed = new Date(link.pushed_at).getTime();
  const updated = new Date(remote?.updated ?? 0).getTime();
  return Number.isFinite(pushed) && Number.isFinite(updated) && Math.abs(updated - pushed) < 5000;
}

/**
 * Which copy wins when both sides moved.
 *
 * Remote wins a genuine tie. Google is the shared calendar — other people have
 * already been sent that time and planned around it — so silently preferring
 * our own copy would put the user in a meeting nobody else thinks is happening.
 */
export function resolve({ localUpdatedAt, remoteUpdatedAt, link }) {
  const local = new Date(localUpdatedAt ?? 0).getTime() || 0;
  const remote = new Date(remoteUpdatedAt ?? 0).getTime() || 0;
  const pulled = new Date(link?.pulled_at ?? 0).getTime() || 0;
  const pushed = new Date(link?.pushed_at ?? 0).getTime() || 0;

  const localMoved = local > Math.max(pulled, pushed);
  const remoteMoved = remote > Math.max(pulled, pushed);

  if (localMoved && !remoteMoved) return "push";
  if (remoteMoved && !localMoved) return "pull";
  if (!localMoved && !remoteMoved) return "none";
  return "pull"; // both moved — the shared copy is the one others can see
}

/**
 * Does this access token need replacing?
 *
 * Early by a minute, because a token that expires between the check and the
 * call fails the request and looks like a permission problem.
 */
export const needsRefresh = (expiresAt, now = Date.now()) =>
  !expiresAt || new Date(expiresAt).getTime() - now < 60_000;

/** When a token issued now with `expires_in` seconds runs out, in ISO. */
export const expiryFrom = (expiresIn, now = Date.now()) =>
  new Date(now + (Number(expiresIn) || 3600) * 1000).toISOString();

/**
 * Is this Google error worth retrying, or is the grant gone?
 *
 * A revoked or expired refresh token is permanent: retrying it forever turns
 * one broken link into a background job that never stops failing. Everything
 * else — rate limits, backend errors — is transient and should be left alone
 * to be tried again.
 */
export function isPermanentAuthFailure(status, body) {
  if (status !== 400 && status !== 401) return false;
  const err = typeof body === "string" ? body : JSON.stringify(body ?? {});
  return /invalid_grant|invalid_token|unauthorized_client/i.test(err);
}

/* ==========================================================================
   Everything below talks to the network. Kept apart from the pure functions
   above so the tests can cover the decisions without mocking a single fetch.
   ========================================================================== */

/** A permanent failure, marked so callers stop retrying it. */
export const permanent = (message) => Object.assign(new Error(message), { permanent: true });

/**
 * A usable access token for a link, refreshing if needed.
 *
 * Access tokens last an hour and are not worth storing; the refresh token is
 * the durable grant and never leaves the server. A refresh that comes back
 * `invalid_grant` means the user revoked us in their Google account — that is
 * permanent, and the link is marked so rather than retried forever.
 */
export async function accessTokenFor(link, db) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: link.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (isPermanentAuthFailure(res.status, body)) {
      await db.from("calendar_links")
        .update({ refresh_token: null, last_error: "disconnected_by_user" })
        .eq("id", link.id);
      throw permanent("revoked");
    }
    throw new Error("refresh_failed");
  }
  return body.access_token;
}

/** One authenticated Calendar API call. Returns {ok, status, body}. */
export async function gcal(token, path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}
