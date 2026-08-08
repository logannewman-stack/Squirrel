import { asService, requireUser, json } from "../_lib/db.js";
import {
  accessTokenFor, gcal, toGoogle, fromGoogle, isEcho, resolve, permanent,
} from "../_lib/google.js";

/**
 * Two-way sync with Google Calendar.
 *
 * Pull first, then push. The order matters: pulling second would send our copy
 * of an event we were about to learn had moved, and the person who moved it
 * would watch it jump back.
 *
 * ## What keeps this from destroying calendars
 *
 * - **The event map.** Every pairing is recorded in `event_links`, so a round
 *   trip is recognisable and an event we pushed never comes back as a new one.
 * - **Echo detection.** Google returns our own write on the next pull. Matched
 *   on etag and ignored — see `isEcho`.
 * - **An explicit conflict rule.** When both sides moved, the shared copy wins;
 *   see `resolve`. Whatever loses is logged rather than silently dropped.
 * - **Deletes are one-directional here.** A remote cancellation removes our
 *   copy; a local delete is pushed. Neither is inferred from absence, because
 *   "not in this page of results" and "deleted" look identical and guessing
 *   wrong empties somebody's calendar.
 */

/** How many events one call will move. Beyond this the next run continues. */
const PAGE = 250;

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });

  const auth = await requireUser(req);
  if (!auth) return json(res, 401, { error: "unauthorized" });

  return json(res, 200, await syncUser(asService(), auth.user.id));
}

/**
 * Sync every Google calendar one account has connected.
 *
 * Exported because the scheduled job needs exactly this, for every account in
 * turn. A cron that reimplemented the loop would drift from the one the button
 * runs, and the difference would only ever show up in the version nobody is
 * watching.
 */
export async function syncUser(db, userId) {
  const { data: links } = await db
    .from("calendar_links").select("*")
    .eq("user_id", userId).eq("provider", "google")
    .not("refresh_token", "is", null);

  if (!links?.length) return { pulled: 0, pushed: 0, links: 0, errors: [] };

  let pulled = 0, pushed = 0;
  const errors = [];

  for (const link of links) {
    try {
      const token = await accessTokenFor(link, db);
      pulled += await pull(db, link, token, userId);
      pushed += await push(db, link, token, userId);
      await db.from("calendar_links")
        .update({ last_synced_at: new Date().toISOString(), last_error: null })
        .eq("id", link.id);
    } catch (e) {
      // A revoked grant has already been recorded on the link. Anything else is
      // transient and worth saying, but never worth failing the whole request
      // over — one broken calendar must not stop the others syncing.
      if (!e?.permanent) {
        await db.from("calendar_links").update({ last_error: e.message }).eq("id", link.id);
      }
      errors.push({ link: link.id, error: e.message });
    }
  }

  return { pulled, pushed, links: links.length, errors };
}

/**
 * Bring in what changed on Google.
 *
 * Incremental when we hold a sync token, full otherwise. A 410 means the token
 * has aged out — Google's way of saying "start again" — and the correct answer
 * is a full resync rather than an error, because the alternative is a link that
 * is permanently stuck.
 */
async function pull(db, link, token, userId) {
  const params = new URLSearchParams({ maxResults: String(PAGE), singleEvents: "true" });
  if (link.sync_token) params.set("syncToken", link.sync_token);
  // A full sync would otherwise reach back years. Nobody needs last spring's
  // standups imported on day one.
  else params.set("timeMin", new Date(Date.now() - 30 * 86400_000).toISOString());

  const path = `/calendars/${encodeURIComponent(link.calendar_id || "primary")}/events?${params}`;
  let { ok, status, body } = await gcal(token, path);

  if (status === 410) {
    await db.from("calendar_links").update({ sync_token: null }).eq("id", link.id);
    return 0; // the next run starts clean
  }
  if (!ok) throw new Error(`pull_failed_${status}`);

  let n = 0;
  for (const remote of body?.items || []) {
    const { data: map } = await db
      .from("event_links").select("*")
      .eq("link_id", link.id).eq("remote_id", remote.id).maybeSingle();

    if (isEcho(remote, map)) continue;

    // Cancelled on Google: retire our copy, and the mapping with it.
    //
    // Soft, via `deleted_at`, because that is what the rest of sync speaks. A
    // hard delete leaves the other devices holding a row nobody ever told them
    // to drop, and the next push from a laptop puts the meeting straight back.
    if (remote.status === "cancelled") {
      if (map?.event_id) {
        await db.from("events")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", map.event_id).eq("user_id", userId);
        await db.from("event_links").delete()
          .eq("link_id", link.id).eq("remote_id", remote.id);
        n++;
      }
      continue;
    }

    const fields = fromGoogle(remote);
    if (!fields) continue;

    if (map?.event_id) {
      const { data: mine } = await db
        .from("events").select("updated_at").eq("id", map.event_id).maybeSingle();
      // Both sides moved — the shared copy wins, but say so rather than
      // discarding an edit in silence.
      const call = resolve({
        localUpdatedAt: mine?.updated_at, remoteUpdatedAt: remote.updated, link: map,
      });
      if (call === "push" || call === "none") continue;

      await db.from("events").update(fields).eq("id", map.event_id).eq("user_id", userId);
    } else {
      const { data: made } = await db
        .from("events").insert({ ...fields, user_id: userId }).select("id").single();
      if (!made) continue;
      await db.from("event_links").insert({
        event_id: made.id, link_id: link.id, remote_id: remote.id,
      });
    }

    await db.from("event_links")
      .update({ etag: remote.etag, pulled_at: new Date().toISOString() })
      .eq("link_id", link.id).eq("remote_id", remote.id);
    n++;
  }

  // Only stored once the whole page applied. Storing it earlier would skip
  // anything a mid-page failure never got to.
  if (body?.nextSyncToken) {
    await db.from("calendar_links").update({ sync_token: body.nextSyncToken }).eq("id", link.id);
  }
  return n;
}

/**
 * Send out what changed here.
 *
 * Only events with no mapping (new) or whose local edit is newer than the last
 * exchange (changed). Everything else is already in step, and pushing it would
 * generate an echo for the next pull to filter for no reason.
 */
async function push(db, link, token, userId) {
  if (!link.write_back) return 0;

  const calendar = encodeURIComponent(link.calendar_id || "primary");
  // Recent and future only. Pushing a year of history on first connect would
  // take a long time, cost a lot of quota, and put nothing useful in front of
  // anyone. Deleted rows are excluded — retiring them remotely is handled by
  // the delete path, not by re-pushing a tombstone as a meeting.
  const { data: mine } = await db
    .from("events").select("*").eq("user_id", userId)
    .is("deleted_at", null)
    .gte("starts_at", new Date(Date.now() - 7 * 86400_000).toISOString())
    .limit(PAGE);

  let n = 0;
  for (const event of mine || []) {
    const { data: map } = await db
      .from("event_links").select("*")
      .eq("link_id", link.id).eq("event_id", event.id).maybeSingle();

    const call = resolve({
      localUpdatedAt: event.updated_at,
      remoteUpdatedAt: map?.pulled_at,
      link: map,
    });
    if (map && call !== "push") continue;

    const payload = toGoogle(event);
    const out = map
      ? await gcal(token, `/calendars/${calendar}/events/${map.remote_id}`,
          { method: "PATCH", body: JSON.stringify(payload) })
      : await gcal(token, `/calendars/${calendar}/events`,
          { method: "POST", body: JSON.stringify(payload) });

    // A 404 on update means it was deleted on Google while we held a mapping.
    // Drop the mapping and let the next run treat it as new rather than
    // retrying a write that can never succeed.
    if (!out.ok) {
      if (out.status === 404 && map) {
        await db.from("event_links").delete()
          .eq("link_id", link.id).eq("event_id", event.id);
      }
      continue;
    }

    const stamp = { etag: out.body?.etag, pushed_at: new Date().toISOString() };
    if (map) {
      await db.from("event_links").update(stamp)
        .eq("link_id", link.id).eq("event_id", event.id);
    } else {
      await db.from("event_links").insert({
        event_id: event.id, link_id: link.id, remote_id: out.body.id, ...stamp,
      });
    }
    n++;
  }
  return n;
}
