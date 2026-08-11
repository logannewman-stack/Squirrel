/**
 * The keyboard layer.
 *
 * Three failure modes, all quiet. Two shortcuts claiming one key, where the
 * loser simply never fires and nobody knows which was supposed to win. A
 * shortcut firing while somebody is typing, which turns every "w" in a meeting
 * title into a change of view. And a modifier compared loosely, so ⌘K's action
 * also runs on Ctrl+K — which on a Mac is the system's "delete to end of line"
 * and is being pressed for that reason.
 */
import {
  SHORTCUTS, matches, shortcutFor, keyLabel, primary, byGroup, inField, isApple,
} from "../src/lib/keys.js";
import { SCALES } from "../src/lib/calendar.js";

let pass = 0, fail = 0;
const failures = [];
const t = (name, ok, detail) => {
  if (ok) pass++; else { fail++; failures.push(name); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

/** A keyboard event, as the browser would hand one over. */
const press = (key, { meta, ctrl, shift, alt, target } = {}) => ({
  key,
  metaKey: Boolean(meta),
  ctrlKey: Boolean(ctrl),
  shiftKey: Boolean(shift),
  altKey: Boolean(alt),
  target: target ?? { tagName: "BODY" },
});

// ---------------------------------------------------------------- the list
{
  t("there are bindings", SHORTCUTS.length > 8, SHORTCUTS.length);
  t("each has an id, a key and a label",
    SHORTCUTS.every((s) => s.id && s.keys?.length && s.label && s.group));
  t("ids are unique", new Set(SHORTCUTS.map((s) => s.id)).size === SHORTCUTS.length);

  /**
   * The expensive one. Two shortcuts on one key means the second never fires,
   * silently, and which of them wins is an accident of declaration order.
   */
  const claims = new Map();
  const clashes = [];
  for (const s of SHORTCUTS) {
    for (const k of s.keys) {
      const at = `${s.scope ?? "*"}:${k.toLowerCase()}`;
      if (claims.has(at)) clashes.push(`${k} → ${claims.get(at)} and ${s.id}`);
      claims.set(at, s.id);
    }
  }
  t("no key is claimed twice in the same scope", clashes.length === 0, clashes);

  /**
   * A global plain letter and a calendar plain letter are a clash too, and a
   * nastier one: it only shows up on the calendar, so it survives every test
   * of the shortcut that "works fine".
   */
  const globalPlain = SHORTCUTS
    .filter((s) => !s.scope)
    .flatMap((s) => s.keys)
    .filter((k) => /^[a-z]$/i.test(k))
    .map((k) => k.toLowerCase());
  const scoped = SHORTCUTS
    .filter((s) => s.scope)
    .flatMap((s) => s.keys)
    .map((k) => k.toLowerCase());
  const shadowed = globalPlain.filter((k) => scoped.includes(k));
  t("no unmodified global letter is also a calendar letter", shadowed.length === 0, shadowed);

  // The calendar's scales are generated from the calendar's own table, so they
  // cannot drift — this is what proves the generation actually happened.
  for (const s of SCALES) {
    t(`  the calendar's ${s.label} key is documented`,
      SHORTCUTS.some((x) => x.scope === "calendar" && x.keys.includes(s.key) && x.label === s.label));
  }

  t("undo is one of them, since it was the missing one",
    SHORTCUTS.some((s) => s.id === "undo" && s.keys.includes("mod+z")));
}

// -------------------------------------------------------------- matching
{
  t("the platform modifier matches", matches(press("k", { meta: true }), "mod+k", true));
  t("and on a PC it is control", matches(press("k", { ctrl: true }), "mod+k", false));
  t("a bare key is not the modified one", !matches(press("k"), "mod+k", true));

  /**
   * Ctrl+K on a Mac is "delete to end of line" in every text field on the
   * system. Somebody pressing it is not reaching for ⌘K.
   */
  t("the other modifier is refused, not ignored",
    !matches(press("k", { ctrl: true }), "mod+k", true));
  t("and the same the other way", !matches(press("k", { meta: true }), "mod+k", false));

  t("holding both is neither", !matches(press("k", { meta: true, ctrl: true }), "mod+k", true));
  t("alt is not along for the ride", !matches(press("k", { meta: true, alt: true }), "mod+k", true));

  t("case does not matter", matches(press("K", { meta: true }), "mod+k", true));
  t("a digit works", matches(press("1", { meta: true }), "mod+1", true));
  t("so does punctuation", matches(press(",", { meta: true }), "mod+,", true));
  t("and a named key", matches(press("ArrowLeft"), "ArrowLeft", true));

  /**
   * "?" is typed with shift held, and is still "?". Requiring shift to be up
   * would make it impossible to press.
   */
  t("a character that needs shift can still be pressed", matches(press("?", { shift: true }), "?", true));
  t("and shift on a letter is the same letter", matches(press("N", { shift: true }), "n", true));
}

// ------------------------------------------------------------ dispatching
{
  t("a global shortcut answers anywhere", shortcutFor(press("k", { meta: true }), { apple: true })?.id === "search");
  t("and so does its second spelling", shortcutFor(press("/"), { apple: true })?.id === "search");
  t("an unbound key is nothing", shortcutFor(press("q", { meta: true }), { apple: true }) === null);

  /**
   * Every "w" in a meeting title would otherwise change the view. This is the
   * check that has to happen once, before matching, rather than inside each
   * handler where it gets forgotten exactly once.
   */
  for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) {
    t(`  nothing fires while typing in a ${tag.toLowerCase()}`,
      shortcutFor(press("n", { target: { tagName: tag } }), { apple: true }) === null);
  }
  t("  nor in anything editable",
    shortcutFor(press("n", { target: { tagName: "DIV", isContentEditable: true } }), { apple: true }) === null);
  t("  not even a modified one, because ⌘Z belongs to the field",
    shortcutFor(press("z", { meta: true, target: { tagName: "INPUT" } }), { apple: true }) === null);
  t("inField knows a field from a page",
    inField({ tagName: "INPUT" }) && !inField({ tagName: "BODY" }) && !inField(null));

  // Scoped bindings answer only where they belong.
  t("a calendar key does nothing on Today",
    shortcutFor(press("w"), { apple: true, scope: "today" }) === null);
  t("and works on the calendar",
    shortcutFor(press("w"), { apple: true, scope: "calendar" })?.id === "scale.week");
  t("while a global one still works there",
    shortcutFor(press("k", { meta: true }), { apple: true, scope: "calendar" })?.id === "search");
}

// -------------------------------------------------------------- labelling
/**
 * Small and instantly noticeable. "Ctrl+K" on a Mac reads as an app that was
 * ported rather than built.
 */
{
  t("an Apple keyboard is written in symbols", keyLabel("mod+k", true) === "⌘K", keyLabel("mod+k", true));
  t("and everything else is spelled out", keyLabel("mod+k", false) === "Ctrl+K", keyLabel("mod+k", false));
  t("with the modifiers in the printed order",
    keyLabel("mod+shift+z", true) === "⌘⇧Z", keyLabel("mod+shift+z", true));
  t("and joined the other way on a PC",
    keyLabel("mod+shift+z", false) === "Ctrl+Shift+Z", keyLabel("mod+shift+z", false));
  t("arrows are drawn, not named", keyLabel("ArrowLeft", true) === "←", keyLabel("ArrowLeft", true));
  t("a comma survives being a separator", keyLabel("mod+,", true) === "⌘,", keyLabel("mod+,", true));
  t("a letter is capitalised", keyLabel("n", true) === "N");

  const undo = SHORTCUTS.find((s) => s.id === "undo");
  t("the first spelling is the one shown", primary(undo, true) === "⌘Z", primary(undo, true));
}

// ------------------------------------------------------------- the sheet
{
  const groups = byGroup();
  t("the help sheet has groups", groups.length >= 3, groups.length);
  t("every binding appears in exactly one",
    groups.reduce((n, g) => n + g.items.length, 0) === SHORTCUTS.length);
  t("groups keep the order they were declared in",
    groups[0].name === "Getting around", groups[0].name);
  /**
   * Including the ones scoped to a view that is not open. Filtering the sheet
   * to the current screen would hide the calendar's keys from everybody who
   * has not already found the calendar's keys.
   */
  t("and the calendar's are listed from anywhere, since that is what the sheet is for",
    byGroup().some((g) => g.name === "In the calendar"));
  t("with the group saying where they work",
    byGroup().find((g) => g.name === "In the calendar").items.every((s) => s.scope === "calendar"));
}

// -------------------------------------------------------------- platform
{
  t("a Mac is an Apple keyboard", isApple({ platform: "MacIntel" }));
  t("so is an iPhone", isApple({ platform: "", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)" }));
  t("Windows is not", !isApple({ platform: "Win32", userAgent: "Windows NT" }));
  t("and nothing at all does not throw", isApple(undefined) === false);
}

console.log(`\nKeys: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
