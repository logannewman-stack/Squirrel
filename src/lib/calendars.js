/**
 * The browser's half of calendar sync.
 *
 * Thin on purpose: every decision that matters — which copy wins, what is an
 * echo, when a grant is dead — is made on the server, where the refresh token
 * lives and where the answer cannot be argued with. This file starts things and
 * reports what came back.
 */

import { client, configured } from "./supabase";

async function authed(path, init = {}) {
  const supabase = await client();
  const { data } = (await supabase?.auth.getSession()) ?? {};
  const token = data?.session?.access_token;
  if (!token) throw new Error("not signed in");

  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `request failed (${res.status})`);
  return out;
}

/**
 * The calendars this account has connected.
 *
 * Read straight from the table rather than through an endpoint, because the
 * column grants already decide what is visible: the browser can see that a
 * calendar is linked and never the token behind it. One fewer endpoint to keep
 * in step with the schema.
 */
export async function listCalendars() {
  if (!configured) return [];
  const supabase = await client();
  if (!supabase) return [];
  const { data } = await supabase
    .from("calendar_links")
    .select("id, provider, account, calendar_name, write_back, last_synced_at, last_error")
    .order("created_at");
  return data ?? [];
}

/** Send the browser to Google's consent screen. */
export async function connectGoogle() {
  const { url } = await authed("/api/google/connect", { method: "POST" });
  if (!url) throw new Error("no consent url");
  location.assign(url);
}

/** Run a sync now. Returns {pulled, pushed, errors}. */
export const syncNow = () => authed("/api/google/sync", { method: "POST" });

/** Disconnect, revoking the grant at Google as well as here. */
export const disconnect = (id) =>
  authed("/api/google/disconnect", { method: "POST", body: JSON.stringify({ id }) });

/** Whether a redirect just came back from Google, and how it went. */
export function connectResult(search = location.search) {
  const q = new URLSearchParams(search);
  const state = q.get("calendar");
  if (!state) return null;
  return { ok: state === "connected", reason: q.get("reason") };
}
