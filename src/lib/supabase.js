/**
 * The Supabase client, if there is one.
 *
 * Everything here is optional by design. With no `VITE_SUPABASE_URL` set, this
 * exports null and the app behaves exactly as it did before accounts existed —
 * local, instant, offline. That is not a fallback for development; it is the
 * free tier, and it has to keep working when the network, the service, or the
 * user's willingness to sign up does not.
 */
const URL = import.meta.env?.VITE_SUPABASE_URL;
const ANON = import.meta.env?.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(URL && ANON);

/**
 * Loaded on demand, not at startup.
 *
 * The Supabase client is around 230 kB — more than the entire rest of the app.
 * Someone on the free tier who never signs in should never pay to download it,
 * and someone who does can afford one extra request at the moment they ask for
 * an account. Resolves to null when sync is not configured at all.
 */
let pending = null;

export function client() {
  if (!configured) return Promise.resolve(null);
  if (!pending) {
    pending = import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(URL, ANON, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // The magic-link redirect returns the session in the URL fragment.
          detectSessionInUrl: true,
        },
      }));
  }
  return pending;
}

/**
 * A stable id for this browser or app install.
 *
 * Sync cursors are per-device: two devices must not share a high-water mark,
 * or whichever pulls first hides the changes from the other.
 */
const DEVICE_KEY = "squirrel.device";

export function deviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

/** Something recognisable in the account's device list. */
export function deviceName() {
  const ua = navigator.userAgent || "";
  const os = /iPhone/.test(ua) ? "iPhone"
    : /iPad/.test(ua) ? "iPad"
    : /Mac/.test(ua) ? "Mac"
    : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows"
    : "Browser";
  return os;
}
