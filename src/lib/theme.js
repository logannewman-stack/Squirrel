/**
 * Light, dark, or whatever the machine is doing.
 *
 * The app followed `prefers-color-scheme` and nothing else, which is the right
 * default and the wrong only option: plenty of people run a dark system and
 * want one bright app, or the reverse, and on a Mac the system flips itself at
 * sunset whether or not that suits what you are doing at the time.
 *
 * Three states rather than a switch. A switch has to be *set* to something,
 * which means the moment somebody touches it they have opted out of their
 * system for ever — including the automatic change at dusk they probably
 * wanted to keep. "System" stays a real, returnable choice.
 *
 * Applied by stamping the root element, which is what the stylesheet reads.
 * Kept out of the main store on purpose: this has to be on the page before
 * React renders or the app paints in the wrong colours and corrects itself a
 * frame later, which is the flash everybody notices and nobody can describe.
 */

const KEY = "squirrel.theme";
export const THEMES = ["system", "light", "dark"];

const root = () => globalThis.document?.documentElement ?? null;

export function readTheme() {
  try {
    const saved = globalThis.localStorage?.getItem(KEY);
    return THEMES.includes(saved) ? saved : "system";
  } catch {
    // Private mode, or storage disabled. Following the system is a perfectly
    // good answer and a great deal better than throwing on boot.
    return "system";
  }
}

/** What the page will actually look like, once "system" is resolved. */
export const resolveTheme = (choice = readTheme()) =>
  choice === "system"
    ? (globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : choice;

/**
 * Put it on the page.
 *
 * "system" removes the attribute rather than setting it to the resolved value,
 * so the stylesheet's media query stays in charge and the page keeps following
 * the machine when it changes at dusk. Writing the resolved value would freeze
 * it at whatever it was when the app last started.
 */
export function applyTheme(choice = readTheme()) {
  const el = root();
  if (!el) return choice;
  if (choice === "system") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", choice);

  // Native chrome — the status bar, the form controls, the scrollbars — reads
  // this rather than the CSS, and gets the resolved answer because it cannot
  // resolve "system" itself.
  el.style.colorScheme = resolveTheme(choice);
  return choice;
}

export function setTheme(choice) {
  const next = THEMES.includes(choice) ? choice : "system";
  try {
    globalThis.localStorage?.setItem(KEY, next);
  } catch { /* nothing to do; the page still changes for this session */ }
  applyTheme(next);
  announce(next);
  return next;
}

const watchers = new Set();

/**
 * Told whenever the *appearance* changes — which is not the same as whenever
 * the choice changes.
 *
 * On "system", a Mac flipping itself at sunset changes how the app looks
 * without anybody choosing anything, and everything drawing itself from the
 * resolved value has to hear about it. Before this, the panel that reads
 * "Currently light, because that's what this device is set to" went on saying
 * light after the machine had gone dark around it — the app was right and its
 * own description of itself was wrong.
 *
 * The listener gets the choice; ask `resolveTheme()` for what that came out as.
 */
export function onThemeChange(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

function announce(choice) {
  for (const fn of watchers) fn(choice);
  // A DOM event as well as the callbacks, because the native shell needs this
  // too and `native.js` is loaded for its own reasons rather than subscribed
  // from a component. See the status bar in `startNative`.
  globalThis.dispatchEvent?.(
    new CustomEvent("squirrel:theme", { detail: { choice, resolved: resolveTheme(choice) } }),
  );
}

/**
 * Start following. Call once, as early as possible.
 *
 * The media listener matters for the "system" case: without it a Mac that
 * switches itself at sunset would only change the app on the next reload,
 * because `colorScheme` above was stamped with the resolved value at boot.
 */
export function startTheme() {
  applyTheme();
  const media = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener?.("change", () => {
    // Only when the system is the one being followed. Somebody who chose Light
    // chose it on purpose, and sunset is not a reason to overrule them.
    if (readTheme() !== "system") return;
    applyTheme("system");
    announce("system");
  });
}
