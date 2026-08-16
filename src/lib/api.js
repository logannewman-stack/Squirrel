/**
 * Where the server is, which is not the same question on the web and in the app.
 *
 * On the web the answer is "here": the site and its API are the same origin, so
 * `fetch("/api/usage")` is right and always has been.
 *
 * In the native app it is not. Capacitor serves the bundle from the device at
 * `https://localhost`, so the same relative path resolves to
 * `https://localhost/api/usage` — an address that does not exist, on a server
 * that does not exist. Every request fails, and it fails in the one build
 * nobody can open a network tab on.
 *
 * That was true of all ten call sites in this app: sign-in, the plan, the
 * company roster, the assistant's boost, and the App Store receipt check that
 * decides whether somebody who has just paid gets what they bought. All of it
 * worked in a browser and none of it could ever have worked on a phone.
 *
 * So the base is a build-time setting. `VITE_API_URL` is empty for the Vercel
 * build — relative is correct there — and the deployment's own origin for the
 * iOS build, where it has to be absolute.
 *
 * ## Why this refuses rather than falls back
 *
 * An iOS build with no base configured would go back to relative paths and
 * fail exactly as before: silently, on device, with a screen that says nothing
 * worked. The whole point of this module is that such a build is a loud error
 * at the first request instead of a mystery in TestFlight.
 */

const RAW = import.meta.env?.VITE_API_URL ?? "";
/** Trailing slashes are the classic way to end up requesting `//api/usage`. */
const BASE = String(RAW).trim().replace(/\/+$/, "");

/** Is this the native shell? Set by `startNative()` before anything asks. */
const native = () => globalThis.__SQUIRREL_NATIVE__ === true;

/** Configured base, for the setup screen to report honestly. */
export const apiBase = () => BASE;

/**
 * The absolute address of an API path.
 *
 * Anything that is already absolute is passed straight through, so a caller
 * that has its own full URL — an OAuth redirect, a webhook echo — is not
 * mangled by having a base glued to the front of it.
 */
export function apiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  if (BASE) return `${BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  if (native()) {
    throw new Error(
      "This build has no VITE_API_URL, so it cannot reach the server. " +
      "Set it to the deployment's origin and rebuild.",
    );
  }
  return path;
}

/** `fetch`, addressed correctly on both platforms. Same signature, same result. */
export const api = (path, init) => fetch(apiUrl(path), init);
