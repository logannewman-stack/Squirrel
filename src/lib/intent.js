/**
 * Asking Squirrel from outside Squirrel.
 *
 * One entry point, deliberately: a sentence arrives from somewhere that is not
 * this app, and she runs it. Everything that wants to talk to her from the
 * outside — Siri, the Shortcuts app, a Home Screen widget, Spotlight, a
 * browser bookmark, a keyboard launcher on a Mac — can produce a URL, so a URL
 * is the whole interface.
 *
 *     squirrel://ask?q=move%20my%203pm%20to%204
 *     https://squirelll.com/?ask=move%20my%203pm%20to%204
 *
 * The custom scheme is what the native app registers; the query parameter is
 * what works in a browser and on a Mac. They resolve to the same thing, and
 * neither needs anything built on the other side — a Shortcut with one "Open
 * URL" action is a working Siri phrase today, before a line of Swift exists.
 *
 * ## Why the URL is consumed
 *
 * A deep link that stays in the address bar re-runs on every reload, which for
 * an assistant that *changes your calendar* is not a cosmetic bug: refresh the
 * page and the meeting is booked twice. So the parameter is stripped the
 * moment it is read, before the sentence is handed on.
 */

/** Where a request came from, so the UI can say so and the log can tell. */
export const SOURCES = ["url", "siri", "shortcut", "widget"];

/**
 * Places an outside link is allowed to land.
 *
 * A closed list rather than "whatever the path says". These arrive from Siri,
 * a widget and anything anybody builds in Shortcuts, and a view name taken on
 * trust is a way for an outside caller to steer the app somewhere it has no
 * business being.
 */
const ROUTES = { today: "today", calendar: "calendar", projects: "projects", insights: "insights" };

/**
 * Where a URL says to go, if it says anywhere.
 *
 * `squirrel://today` from the Action button, and the widget's tap target. The
 * app opens either way; without this it opens on whatever screen it was left
 * on, which for somebody who just asked for their day is the wrong one.
 */
export function takeRoute(loc = globalThis.location) {
  // The path alone. In `squirrel://today` the word is the URL's *host*, but the
  // scheme swap in `onRequest` moves it into the path before this sees it — and
  // on the web the host is the domain, which must never be read as a route.
  const raw = String(loc?.pathname || "").replace(/\//g, "").toLowerCase();
  return ROUTES[raw] ?? null;
}

/**
 * Read a pending request out of the current URL, and remove it.
 *
 * @returns {{text: string, source: string, speak: boolean} | null}
 */
export function takeRequest(loc = globalThis.location, history = globalThis.history) {
  if (!loc?.search && !loc?.hash) return null;

  let params;
  try {
    params = new URLSearchParams(loc.search || "");
  } catch {
    return null;
  }

  // `ask` is the documented one. `q` is accepted because the custom scheme
  // reads more naturally as `squirrel://ask?q=…`, and somebody hand-writing a
  // Shortcut will try both.
  const raw = params.get("ask") ?? params.get("q");
  if (!raw) return null;

  const text = String(raw).trim().slice(0, 500);
  const source = SOURCES.includes(params.get("from")) ? params.get("from") : "url";
  // Spoken back by default when it came from a voice assistant, because
  // somebody who asked out loud is not looking at the screen.
  const speak = params.get("speak") === "1" || source === "siri";

  // Consumed. Anything left in the address bar runs again on the next reload,
  // and "book a meeting" running twice is a real meeting booked twice.
  try {
    params.delete("ask");
    params.delete("q");
    params.delete("from");
    params.delete("speak");
    const rest = params.toString();
    history?.replaceState?.({}, "", `${loc.pathname}${rest ? `?${rest}` : ""}${loc.hash || ""}`);
  } catch { /* a browser that will not rewrite its own bar is still usable */ }

  return text ? { text, source, speak } : null;
}

/**
 * Listen for requests that arrive while the app is already open.
 *
 * On the web this is a page load and nothing else. In the native app it is the
 * ordinary case: the app is in the background, Siri hands it a URL, and it is
 * brought forward without ever reloading — so `takeRequest` at startup would
 * never see it. `native.js` re-dispatches Capacitor's `appUrlOpen` as this
 * event with the URL attached.
 *
 * @param {(req: {text: string, source: string, speak: boolean}) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onRequest(fn) {
  const handler = (e) => {
    const url = e?.detail?.url;
    if (!url) return;
    let parsed;
    try {
      // `squirrel://ask?q=…` has no host a URL parser will keep, so the
      // scheme is swapped for one it will. Only the query matters either way.
      parsed = new URL(String(url).replace(/^squirrel:\/\//, "https://squirrel.invalid/"));
    } catch {
      return;
    }
    const req = takeRequest(
      { search: parsed.search, hash: "", pathname: parsed.pathname },
      // Nothing to rewrite: this URL was never in the address bar.
      null,
    );
    const route = takeRoute({ pathname: parsed.pathname });
    // A sentence to run, a screen to open, or both. "squirrel://today" carries
    // no words and still means something.
    if (req || route) fn({ ...(req ?? { text: "", source: "url", speak: false }), route });
  };
  addEventListener("squirrel:url", handler);
  return () => removeEventListener("squirrel:url", handler);
}

/** Build a link that asks her something. Used by the docs and the share sheet. */
export const askUrl = (text, { origin = globalThis.location?.origin ?? "", from } = {}) =>
  `${origin}/?ask=${encodeURIComponent(text)}${from ? `&from=${from}` : ""}`;
