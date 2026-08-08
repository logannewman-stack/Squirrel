import { useSyncExternalStore } from "react";

/**
 * Which chrome the app wears: the phone's bottom bar, or the desktop's rail.
 *
 * Keyed off the viewport, not the user agent. A user-agent string tells you
 * what the device *is*; the viewport tells you what the layout actually has to
 * fit — and it is the thing that changes when someone resizes a window, splits
 * the screen, or turns a tablet, none of which sniffing "Mac" would catch.
 * 1024px is the width below which a bottom bar reads as a stretched phone
 * rather than a desktop app.
 */
const DESKTOP = "(min-width: 1024px)";

function subscribe(onChange) {
  const mql = matchMedia(DESKTOP);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

export function useIsDesktop() {
  return useSyncExternalStore(
    subscribe,
    () => matchMedia(DESKTOP).matches,
    // No SSR here, so this is only a first-paint guess; the real value is read
    // synchronously on mount before anything is shown.
    () => false,
  );
}
