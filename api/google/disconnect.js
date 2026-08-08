import { asService, requireUser, json } from "../_lib/db.js";

/**
 * Disconnect a calendar.
 *
 * The grant is revoked at Google as well as forgotten here. Deleting our row
 * alone would leave the app listed in the user's Google account forever, which
 * is both alarming to find and a live grant nobody is watching.
 *
 * Local events are kept. They are the user's own data and were often created
 * here in the first place; deleting somebody's calendar because they unplugged
 * a sync is not a reasonable reading of "disconnect".
 */
export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });

  const auth = await requireUser(req);
  if (!auth) return json(res, 401, { error: "unauthorized" });

  const { id } = req.body || {};
  if (!id) return json(res, 400, { error: "no link id" });

  const db = asService();
  const { data: link } = await db
    .from("calendar_links").select("id, user_id, refresh_token")
    .eq("id", id).maybeSingle();

  // Scoped to the caller. Service role bypasses RLS, so this check is the only
  // thing standing between a guessed id and someone else's calendar.
  if (!link || link.user_id !== auth.user.id) return json(res, 404, { error: "not found" });

  if (link.refresh_token) {
    // Best effort: an already-revoked token 400s, which is the state we wanted.
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(link.refresh_token)}`,
      { method: "POST" }).catch(() => {});
  }

  await db.from("calendar_links").delete().eq("id", id);
  return json(res, 200, { disconnected: true });
}
