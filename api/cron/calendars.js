import { timingSafeEqual } from "node:crypto";
import { asService, json } from "../_lib/db.js";
import { syncUser } from "../google/sync.js";

/**
 * Sync every connected calendar, on a schedule.
 *
 * Without this, "sync" means a button somebody has to remember to press, which
 * is not sync — it is an import tool with good manners. A meeting moved on a
 * laptop should be on the phone before the phone's owner notices, and that
 * requires something running when nobody is looking.
 *
 * Runs on Vercel Cron (see vercel.json). Cron reaches it over ordinary HTTPS
 * with no user session, so the only thing separating the scheduler from anyone
 * who finds the URL is the shared secret below.
 */

/** How many accounts one run will touch, so a single invocation cannot time out. */
const BATCH = 40;

/** Constant-time compare — a string `===` leaks the secret one character at a time. */
function sameSecret(given, want) {
  if (!given || !want) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(want));
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  const want = process.env.CRON_SECRET;
  // No secret configured means this endpoint is wide open, and it holds the
  // service role. Refusing is the only safe reading of a missing setting.
  if (!want) return json(res, 501, { error: "cron not configured" });

  const header = req.headers.authorization || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : req.query?.key;
  if (!sameSecret(given, want)) return json(res, 401, { error: "unauthorized" });

  const db = asService();

  // Least-recently-synced first, nulls before everything. A link that has never
  // synced is somebody who just connected and is watching an empty calendar
  // wondering whether it worked; a link synced ten minutes ago can wait.
  const { data: due } = await db
    .from("calendar_links")
    .select("user_id, last_synced_at")
    .eq("provider", "google")
    .not("refresh_token", "is", null)
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(BATCH);

  const users = [...new Set((due || []).map((l) => l.user_id))];

  let pulled = 0, pushed = 0;
  const failed = [];

  // Sequential rather than parallel. Google rate-limits per project, not per
  // user, so forty concurrent accounts share one budget and hit 429s that look
  // exactly like a broken integration to everyone in the batch.
  for (const userId of users) {
    try {
      const out = await syncUser(db, userId);
      pulled += out.pulled;
      pushed += out.pushed;
      if (out.errors.length) failed.push({ userId, errors: out.errors });
    } catch (e) {
      // One account's failure is not the batch's. The next run picks it up
      // first, since its last_synced_at is now the oldest.
      failed.push({ userId, errors: [{ error: e.message }] });
    }
  }

  return json(res, 200, { accounts: users.length, pulled, pushed, failed: failed.length });
}
