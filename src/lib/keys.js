/**
 * The keyboard, as one list.
 *
 * There was one global shortcut — ⌘K — bound inline in `App.jsx`, and a
 * separate set inside the calendar bound inline in `Calendar.jsx`. That is how
 * a keyboard layer usually exists: as a scattering of `keydown` handlers, each
 * correct, none aware of the others, and nowhere you can look to find out what
 * the app answers to. Which means the shortcuts are undiscoverable, two of them
 * eventually claim the same key, and the help screen — if one is ever written —
 * describes a set that has since drifted.
 *
 * So the bindings are data. One list, read by the handler that dispatches them
 * *and* by the sheet that documents them, which makes those two incapable of
 * disagreeing. The calendar's keys are generated from the calendar's own scale
 * table rather than retyped, for the same reason.
 *
 * ## Two rules that make the difference between a keyboard layer and a bug
 *
 * **Nothing fires while you are typing.** Every "w" in a meeting title would
 * otherwise change the view. `inField` is checked before anything is matched,
 * not inside individual handlers where it gets forgotten once.
 *
 * **The other modifier must be *absent*, not merely unrequired.** Matching ⌘K
 * by asking "is the platform modifier down" fires on Ctrl+K as well, which on a
 * Mac is a real and different key — it deletes to the end of the line in every
 * text field on the system.
 */

import { SCALES } from "./calendar.js";

/**
 * Which key means "the modifier" here.
 *
 * Read from the platform rather than stored, because it is a property of the
 * hardware in front of somebody and not a preference. A Mac app and a Windows
 * browser get ⌘ and Ctrl respectively without anybody choosing.
 */
export function isApple(nav = globalThis.navigator) {
  const s = `${nav?.platform ?? ""} ${nav?.userAgent ?? ""}`;
  return /mac|iphone|ipad|ipod/i.test(s);
}

/** Somewhere text goes. Nothing is dispatched from inside one. */
export const inField = (el) =>
  Boolean(el?.isContentEditable) ||
  ["INPUT", "TEXTAREA", "SELECT"].includes(el?.tagName ?? "");

/**
 * The bindings.
 *
 * `scope` is the view a shortcut belongs to; absent means everywhere. Grouping
 * is for the help sheet and is deliberately in the user's terms — "Getting
 * around", not "Navigation" — because that sheet is read by somebody looking
 * for a verb rather than browsing a taxonomy.
 */
export const SHORTCUTS = [
  { id: "search", keys: ["mod+k", "/"], label: "Search everything", group: "Getting around" },
  { id: "today", keys: ["mod+1"], label: "Today", group: "Getting around" },
  { id: "calendar", keys: ["mod+2"], label: "Calendar", group: "Getting around" },
  { id: "projects", keys: ["mod+3"], label: "Projects", group: "Getting around" },
  { id: "insights", keys: ["mod+4"], label: "Insights", group: "Getting around" },
  // The Mac convention, and one of about four shortcuts everybody knows without
  // being told.
  { id: "settings", keys: ["mod+,"], label: "Settings", group: "Getting around" },

  { id: "ask", keys: ["mod+j"], label: "Ask Squirrel", group: "Doing things" },
  // Plain letters are safe here only because nothing dispatches while a field
  // has focus. `n` is also checked against the calendar's own letters below.
  { id: "event", keys: ["n"], label: "New event", group: "Doing things" },

  /**
   * The one that matters most, and the one that was missing.
   *
   * The store has kept a labelled forty-step undo since it was written, and the
   * only way to reach it was to open the assistant and say the word "undo" —
   * which the event dialog actually told people to do. An app whose safety
   * story is "she can change your week because you can always take it back"
   * has to answer the shortcut everybody already has in their fingers.
   */
  { id: "undo", keys: ["mod+z"], label: "Undo the last change", group: "Taking it back" },

  { id: "help", keys: ["?"], label: "This list", group: "Taking it back" },

  // Generated, not retyped: the calendar owns its scales, and a hand-copied
  // list here would document a set that had since moved.
  ...SCALES.map((s) => ({
    id: `scale.${s.id}`,
    keys: [s.key],
    label: s.label,
    group: "In the calendar",
    scope: "calendar",
  })),
  { id: "cal.today", keys: ["t"], label: "Back to today", group: "In the calendar", scope: "calendar" },
  { id: "cal.prev", keys: ["ArrowLeft"], label: "Previous", group: "In the calendar", scope: "calendar" },
  { id: "cal.next", keys: ["ArrowRight"], label: "Next", group: "In the calendar", scope: "calendar" },
];

const parse = (combo) => {
  const parts = String(combo).split("+");
  // A lone "+" would otherwise parse to an empty key.
  const key = (parts.pop() || "+").toLowerCase();
  const has = (n) => parts.some((p) => p.toLowerCase() === n);
  return { mod: has("mod"), shift: has("shift"), alt: has("alt"), key };
};

/**
 * Does this event mean this combo?
 *
 * @param {KeyboardEvent} e
 * @param {string} combo  e.g. "mod+k", "shift+/", "ArrowLeft"
 * @param {boolean} [apple] which physical key "mod" means
 */
export function matches(e, combo, apple = isApple()) {
  const want = parse(combo);
  const mod = apple ? e.metaKey : e.ctrlKey;
  const other = apple ? e.ctrlKey : e.metaKey;
  if (want.mod !== Boolean(mod)) return false;
  // Ctrl+K on a Mac is "delete to end of line" in every text field on the
  // system, and is not a second way to spell ⌘K.
  if (other) return false;
  if (want.alt !== Boolean(e.altKey)) return false;

  const key = String(e.key ?? "").toLowerCase();
  if (key !== want.key) return false;

  if (want.shift && !e.shiftKey) return false;
  /**
   * Shift is only *forbidden* where it would produce a different character.
   * "?" is typed with shift held and is still "?", so demanding shift be up
   * would make it unmatchable; "N" and "n" are the same intent, so shift is
   * ignored there too. It is only compared when a combo asks for it.
   */
  return true;
}

/**
 * The shortcut this event means, or null.
 *
 * @param {KeyboardEvent} e
 * @param {{apple?: boolean, scope?: string|null}} [opts] `scope` is the view on
 *   screen; scoped shortcuts only answer when their view is the one showing.
 */
export function shortcutFor(e, { apple = isApple(), scope = null } = {}) {
  if (inField(e?.target)) return null;
  for (const s of SHORTCUTS) {
    if (s.scope && s.scope !== scope) continue;
    if (s.keys.some((k) => matches(e, k, apple))) return s;
  }
  return null;
}

const GLYPH = {
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  escape: "Esc",
  enter: "↵",
  " ": "Space",
};

/**
 * A combo, written the way the keyboard in front of somebody is labelled.
 *
 * Apple keyboards print the symbol and no separator; everything else spells the
 * modifier and joins with a plus. Getting this wrong is small and instantly
 * noticeable — "Ctrl+K" on a Mac reads as an app that was ported rather than
 * built.
 */
export function keyLabel(combo, apple = isApple()) {
  const { mod, shift, alt, key } = parse(combo);
  const name = GLYPH[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  const parts = [
    mod && (apple ? "⌘" : "Ctrl"),
    alt && (apple ? "⌥" : "Alt"),
    shift && (apple ? "⇧" : "Shift"),
    name,
  ].filter(Boolean);
  return apple ? parts.join("") : parts.join("+");
}

/** The first way to press a shortcut — what the help sheet and hints show. */
export const primary = (shortcut, apple = isApple()) => keyLabel(shortcut.keys[0], apple);

/**
 * The bindings arranged for the help sheet, in the order they are declared.
 *
 * Everything, including bindings scoped to a view that is not open. The sheet
 * is where somebody goes to find out what exists — filtering it to the current
 * screen would hide the calendar's keys from everybody who has not already
 * discovered the calendar's keys. Which group they are in says where they work.
 */
export function byGroup() {
  const out = [];
  for (const s of SHORTCUTS) {
    const group = out.find((g) => g.name === s.group) ?? (out.push({ name: s.group, items: [] }), out.at(-1));
    group.items.push(s);
  }
  return out;
}
