/**
 * The native shell, and what the web code is allowed to assume about it.
 *
 * Squirrel is one codebase. In a browser everything here is a no-op and the app
 * behaves exactly as it always has; inside the iOS or Mac app the same calls
 * reach real system APIs. Nothing outside this file imports a Capacitor plugin,
 * so the web build never pays for code it cannot run and there is one place to
 * read to know what "native" actually means here.
 *
 * ## What makes it feel native rather than hosted
 *
 * A web view in an app bundle gives itself away in about four seconds: text
 * selects when you press and hold, taps flash a grey box, scrolling rubber-bands
 * the whole page away from the header, the keyboard covers the field you are
 * typing into, and nothing ever vibrates. Every one of those is fixable, and
 * fixing them is most of the distance between "a website in a box" and an app.
 */

import { resolveTheme } from "./theme.js";

const cap = () => globalThis.Capacitor ?? null;

/** Is this the native shell rather than a browser tab? */
export const isNative = () => Boolean(cap()?.isNativePlatform?.());

/** iOS specifically — Mac Catalyst reports "ios" too, which is what we want. */
export const isIOS = () => isNative() && cap()?.getPlatform?.() === "ios";

/**
 * A short tap you feel.
 *
 * iOS users read haptics as confirmation — a switch that clicks under the thumb
 * is believed in a way a silent one is not. Used only where something actually
 * happened: a task completed, a meeting moved, a plan changed. Feedback on
 * every tap is noise, and noise gets the setting turned off.
 */
export async function tap(kind = "light") {
  if (!isNative()) return;
  try {
    const { Haptics, ImpactStyle, NotificationType } = await import("@capacitor/haptics");
    if (kind === "success" || kind === "warning" || kind === "error") {
      await Haptics.notification({
        type: { success: NotificationType.Success, warning: NotificationType.Warning, error: NotificationType.Error }[kind],
      });
      return;
    }
    await Haptics.impact({
      style: { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy }[kind] ?? ImpactStyle.Light,
    });
  } catch {
    // A device without a Taptic Engine, or a plugin that failed to load. The
    // action already happened; the buzz is the garnish.
  }
}

/**
 * Open a URL outside the app.
 *
 * The external checkout depends on this being a genuine departure. Since the
 * 2025 ruling a US app may send somebody to its own checkout, but only by
 * actually leaving — an in-app web view is still the app, and still a rejection
 * under 3.1.1. So this opens the system browser, never a webview.
 */
export async function openExternal(url) {
  if (!isNative()) {
    globalThis.open?.(url, "_blank", "noopener");
    return;
  }
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url, presentationStyle: "fullscreen" });
}

/**
 * Wire the shell to the app.
 *
 * Called once at startup. Everything it sets up is something the web code
 * already looks for — the flags billing.js reads to decide how to check out,
 * and the `squirrel:resumed` event App.jsx listens for to re-read the plan when
 * the app comes back from a purchase made in Safari.
 */
export async function startNative() {
  if (!isNative()) return;

  globalThis.__SQUIRREL_NATIVE__ = true;
  globalThis.__SQUIRREL_OPEN_EXTERNAL__ = openExternal;
  document.documentElement.classList.add("native", isIOS() ? "ios" : "desktop-native");

  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    // The web view runs under the status bar so the header can sit against the
    // top edge; the safe-area padding in the CSS is what keeps text clear of it.
    await StatusBar.setOverlaysWebView({ overlay: true });
    /**
     * Follow the *app*, not the phone.
     *
     * This read `prefers-color-scheme` directly, which is right in the ordinary
     * case and wrong in the one that matters: somebody on a dark phone who
     * chose Light got a light app with light status-bar glyphs on top of it,
     * which is invisible. The status bar sits on the app, so the app's resolved
     * appearance is the only thing it should follow.
     *
     * `Style.Dark` means light glyphs for a dark background, and vice versa.
     */
    const follow = () =>
      StatusBar.setStyle({ style: resolveTheme() === "dark" ? Style.Dark : Style.Light }).catch(() => {});
    follow();
    // Fires both for a choice made in Settings and for the system changing
    // under a "System" choice — theme.js works out which of those happened.
    addEventListener("squirrel:theme", follow);
  } catch { /* not available on this platform */ }

  try {
    const { Keyboard } = await import("@capacitor/keyboard");
    // The height goes into a custom property so any fixed element — the
    // assistant's composer, most importantly — can lift above the keyboard
    // instead of being covered by it.
    Keyboard.addListener("keyboardWillShow", (info) => {
      document.documentElement.style.setProperty("--keyboard", `${info.keyboardHeight}px`);
      document.documentElement.classList.add("keyboard-open");
    });
    Keyboard.addListener("keyboardWillHide", () => {
      document.documentElement.style.setProperty("--keyboard", "0px");
      document.documentElement.classList.remove("keyboard-open");
    });
  } catch { /* not available */ }

  try {
    const { App } = await import("@capacitor/app");
    // Coming back from anywhere — a checkout in Safari, the app switcher, a
    // phone call. The app was asleep and has been told nothing that happened
    // while it was.
    App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) dispatchEvent(new Event("squirrel:resumed"));
    });
    /**
     * The bridge the widget snapshot goes over.
     *
     * Installed as a global rather than imported, so `widget.js` stays a plain
     * module the tests can run under Node — and so its absence on the web is
     * the ordinary case rather than a missing dependency.
     */
    try {
      const { registerPlugin } = await import("@capacitor/core");
      const bridge = registerPlugin("SquirrelBridge");
      const { available } = await bridge.widgetAvailable();
      if (available) {
        globalThis.__SQUIRREL_WRITE_WIDGET__ = (snapshot) => bridge.writeWidget(snapshot);
      }
    } catch { /* no plugin in this build; the app is unaffected */ }

    // A universal link or a custom-scheme URL opened us. The plan is re-read
    // either way, because the commonest reason to arrive this way is having
    // just paid — and the URL is passed on, because the second commonest is
    // Siri handing over a sentence to run.
    //
    // The app is usually already running when this fires: iOS brings it
    // forward rather than reloading it, so anything that only reads the URL at
    // startup would never see it.
    App.addListener("appUrlOpen", async ({ url }) => {
      dispatchEvent(new Event("squirrel:resumed"));
      if (!url) return;

      /**
       * A returning magic link, before anything else looks at the URL.
       *
       * Supabase reads tokens off the address bar at load, which never happens
       * here — the app was already running and iOS simply brought it forward.
       * Without this the person taps the link, the app opens, and they are
       * still signed out with nothing said.
       */
      const { tokensFrom, errorFrom } = await import("./authlink.js");
      const tokens = tokensFrom(url);
      if (tokens) {
        try {
          const { client } = await import("./supabase.js");
          const supabase = await client();
          await supabase?.auth.setSession(tokens);
          dispatchEvent(new Event("squirrel:signedin"));
        } catch {
          // Offline at the moment of return. The link is spent either way, so
          // saying so beats a silent failure that looks like the old bug.
          dispatchEvent(new CustomEvent("squirrel:authfailed", {
            detail: { said: "Couldn't finish signing in. Check your connection and try again." },
          }));
        }
        return;
      }

      const failed = errorFrom(url);
      if (failed) {
        dispatchEvent(new CustomEvent("squirrel:authfailed", { detail: failed }));
        return;
      }

      dispatchEvent(new CustomEvent("squirrel:url", { detail: { url } }));
    });
  } catch { /* not available */ }

  await startStore();
  await startCalendar();
}

/**
 * The App Store, and the one listener that must exist before anything is sold.
 *
 * `Transaction.updates` on the native side delivers renewals, refunds,
 * Ask-to-Buy approvals, and — the case that matters most — any purchase that
 * never reached the server on its first attempt. Subscribing here rather than
 * from a screen is deliberate: the customer who was killed mid-purchase is
 * exactly the customer who will not think to open the plan screen, and the
 * transaction is replayed at every launch until somebody listens.
 */
async function startStore() {
  try {
    const { registerPlugin } = await import("@capacitor/core");
    const plugin = registerPlugin("SquirrelStore");
    const { available } = await plugin.available();
    globalThis.__SQUIRREL_STORE__ = plugin;

    // A transaction arriving on its own. Put through the same verify-then-
    // finish path as a fresh purchase, and announced so the plan on screen
    // catches up without a reload.
    plugin.addListener?.("transaction", async () => {
      try {
        const { reconcile } = await import("./appstore.js");
        await reconcile();
        dispatchEvent(new Event("squirrel:plan"));
      } catch { /* offline; StoreKit will offer it again */ }
    });

    // What is already outstanding — everything above, from before this launch.
    // Silent and prompt-free by design; `restore()` is the one that asks for a
    // password, and it only ever runs from a button.
    if (available) {
      const { reconcile } = await import("./appstore.js");
      reconcile().then((r) => { if (r.ok && r.count) dispatchEvent(new Event("squirrel:plan")); });
      addEventListener("squirrel:resumed", () => { reconcile().catch(() => {}); });
    }
  } catch { /* no plugin in this build; the web checkout still works */ }
}

/**
 * Apple Calendar.
 *
 * The plugin speaks Capacitor's shape — every method resolves an object — and
 * `apple-calendar.js` was written against EventKit's, where `calendars()`
 * returns calendars. Adapting here keeps that module a plain one the tests can
 * run under Node, and keeps the unwrapping in one place instead of at six call
 * sites.
 */
async function startCalendar() {
  try {
    const { registerPlugin } = await import("@capacitor/core");
    const kit = registerPlugin("SquirrelCalendar");
    const { available } = await kit.available();
    if (!available) return;

    globalThis.__SQUIRREL_EVENTKIT__ = {
      available: () => true,
      requestAccess: () => kit.requestAccess().then((r) => r.status),
      calendars: () => kit.calendars().then((r) => r.calendars),
      // Dates cross the bridge as ISO strings; sending them as Date objects
      // relies on an implicit `toJSON` that a future serialiser is free to
      // change, and the failure would be a silently empty calendar.
      events: ({ calendarId, from, to }) =>
        kit.events({
          calendarId,
          from: new Date(from).toISOString(),
          to: new Date(to).toISOString(),
        }).then((r) => r.events),
      save: ({ calendarId, event }) =>
        kit.save({
          calendarId,
          event: {
            ...event,
            startDate: new Date(event.startDate).toISOString(),
            endDate: new Date(event.endDate).toISOString(),
          },
        }),
      remove: ({ id }) => kit.remove({ id }).then((r) => r.removed),
    };
  } catch { /* no plugin in this build; the settings screen says so plainly */ }
}
