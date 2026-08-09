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
    // Follow the system rather than pinning one. A light status bar over a dark
    // app is the single most common giveaway that a shell was an afterthought.
    const dark = matchMedia("(prefers-color-scheme: dark)");
    const follow = () => StatusBar.setStyle({ style: dark.matches ? Style.Dark : Style.Light }).catch(() => {});
    follow();
    dark.addEventListener("change", follow);
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
    // A universal link or a custom-scheme URL opened us. The plan is re-read
    // either way, because the commonest reason to arrive this way is having
    // just paid — and the URL is passed on, because the second commonest is
    // Siri handing over a sentence to run.
    //
    // The app is usually already running when this fires: iOS brings it
    // forward rather than reloading it, so anything that only reads the URL at
    // startup would never see it.
    App.addListener("appUrlOpen", ({ url }) => {
      dispatchEvent(new Event("squirrel:resumed"));
      if (url) dispatchEvent(new CustomEvent("squirrel:url", { detail: { url } }));
    });
  } catch { /* not available */ }
}
