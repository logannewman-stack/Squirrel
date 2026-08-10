/**
 * The three-part shape a themed rule has to have, checked in the stylesheet.
 *
 * Following the system is one line of CSS. Following the system *and* letting
 * somebody override it is three, and the two that get forgotten are silent in
 * exactly the way that keeps them forgotten:
 *
 *   1. `@media (prefers-color-scheme: dark)` — the machine's own answer.
 *   2. `:root:not([data-theme="light"])` on it — so choosing Light on a dark
 *      phone actually gets a light app, instead of one light page with a dark
 *      date picker and an inverted logo on it.
 *   3. `:root[data-theme="dark"]` — so choosing Dark on a *light* machine does
 *      anything at all. This is the classic one: it works perfectly for whoever
 *      wrote it, because they were on a dark machine, and does nothing for half
 *      the people who try it.
 *
 * theme.e2e.mjs drives the matrix in a real browser and would catch a missing
 * palette. It cannot reasonably catch one straggling rule about a date picker,
 * which is how two of them survived. This reads the stylesheet instead.
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const failures = [];
const t = (name, ok, detail) => {
  if (ok) pass++; else { fail++; failures.push(name); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8")
  // Comments talk about the selectors they sit above, so they have to go or
  // every mention of a guard reads as a guard.
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** The balanced body of the block whose header ends at `open`. */
function bodyAt(open) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  return "";
}

/** Every `@media (prefers-color-scheme: dark)` block body in the file. */
const darkMedia = [];
for (const m of css.matchAll(/@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)\s*\{/g)) {
  darkMedia.push(bodyAt(m.index + m[0].length - 1));
}

t("the stylesheet has dark-mode blocks to check", darkMedia.length >= 2, darkMedia.length);

// ------------------------------------------------------------- the guard
/**
 * Every selector inside a dark media block has to yield to an explicit Light,
 * or the app half-obeys the person who chose it.
 */
{
  const unguarded = [];
  for (const body of darkMedia) {
    // Top-level selectors within the block: text before each `{` at depth 0.
    let depth = 0, start = 0;
    for (let i = 0; i < body.length; i++) {
      if (body[i] === "{") {
        if (depth === 0) {
          const sel = body.slice(start, i).trim();
          if (sel && !sel.startsWith("@") && !/\[data-theme="light"\]/.test(sel)) {
            unguarded.push(sel.replace(/\s+/g, " "));
          }
        }
        depth++;
      } else if (body[i] === "}") {
        if (--depth === 0) start = i + 1;
      }
    }
  }
  t("every dark rule yields to somebody who chose Light", unguarded.length === 0, unguarded);
}

// ------------------------------------------- and the choice that has to exist
/**
 * The expensive half. A token defined only inside the media query is invisible
 * to anybody on a light machine who chooses Dark — and it fails silently,
 * because the *rest* of the palette switches around it.
 */
{
  const tokensIn = (text) => new Set([...text.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));

  const fromMedia = new Set();
  for (const body of darkMedia) for (const tok of tokensIn(body)) fromMedia.add(tok);

  const chosen = new Set();
  for (const m of css.matchAll(/:root\[data-theme="dark"\][^{]*\{/g)) {
    for (const tok of tokensIn(bodyAt(m.index + m[0].length - 1))) chosen.add(tok);
  }

  t("choosing Dark is a real option, not an empty attribute", chosen.size > 5, chosen.size);

  const onlyAutomatic = [...fromMedia].filter((tok) => !chosen.has(tok));
  t("every colour the machine can pick, a person can pick too",
    onlyAutomatic.length === 0, onlyAutomatic);

  // The reverse is not a bug — a dark-only token with no automatic counterpart
  // would simply never apply — but it is always a mistake, so it is worth
  // saying out loud.
  const onlyChosen = [...chosen].filter((tok) => !fromMedia.has(tok));
  t("and nothing is reachable only by choosing", onlyChosen.length === 0, onlyChosen);
}

// ------------------------------------------------------------- the light side
/**
 * Bare `:root` has to carry the complete light palette. Defining a colour only
 * in the dark blocks leaves it inheriting from nothing on a light machine,
 * which renders as black-on-black or the browser's own default.
 */
{
  const bare = css.match(/(^|\n):root\s*\{/);
  t("there is a bare :root holding the light palette", Boolean(bare));
  if (bare) {
    const light = new Set(
      [...bodyAt(bare.index + bare[0].length - 1).matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]),
    );
    const darkOnly = [];
    for (const body of darkMedia) {
      for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:/gi)) {
        if (!light.has(m[1]) && !darkOnly.includes(m[1])) darkOnly.push(m[1]);
      }
    }
    t("and every dark colour has a light one to fall back to", darkOnly.length === 0, darkOnly);
  }
}

// ------------------------------------------------------------ the OS chrome
/**
 * The bar above the page and the card in the task switcher. These sit right
 * against the app, so a value that is merely close reads as a seam.
 */
{
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const themeColors = [...html.matchAll(/<meta name="theme-color"[^>]*>/g)].map((m) => m[0]);
  t("the chrome is told a colour for each scheme", themeColors.length === 2, themeColors.length);
  t("one for light and one for dark, not one for both",
    themeColors.some((m) => /prefers-color-scheme:\s*light/.test(m)) &&
    themeColors.some((m) => /prefers-color-scheme:\s*dark/.test(m)));

  // The page ground, in each scheme, taken from the stylesheet rather than
  // typed twice — a hardcoded pair drifts the moment the palette is touched.
  const groundOf = (text) => text.match(/--sunken:\s*(#[0-9a-f]{3,8})/i)?.[1]?.toLowerCase();
  const lightGround = groundOf(css.slice(css.search(/(^|\n):root\s*\{/)));
  const darkGround = groundOf(darkMedia[0]);
  const contentOf = (scheme) =>
    themeColors.find((m) => new RegExp(`prefers-color-scheme:\\s*${scheme}`).test(m))
      ?.match(/content="(#[0-9a-f]{3,8})"/i)?.[1]?.toLowerCase();

  t("and the light one is the colour the page actually is",
    contentOf("light") === lightGround, `${contentOf("light")} vs ${lightGround}`);
  t("as is the dark one", contentOf("dark") === darkGround, `${contentOf("dark")} vs ${darkGround}`);

  const manifest = JSON.parse(readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  /**
   * The splash the OS paints before a line of the app has run. A manifest
   * cannot hold two colours, so it holds the light one — but it must at least
   * be the light ground rather than plain white, which showed as a step from
   * the splash into the app on every cold start.
   */
  t("the installed splash starts on the colour the app starts on",
    manifest.background_color?.toLowerCase() === lightGround,
    `${manifest.background_color} vs ${lightGround}`);
}

// ------------------------------------------------------------ the native shell
{
  const cap = JSON.parse(readFileSync(new URL("../capacitor.config.json", import.meta.url), "utf8"));
  /**
   * A fixed colour here is painted behind the web view by the shell, under an
   * app that may be dark — and it overrides the launch storyboard's adaptive
   * `systemBackgroundColor`, which already does the right thing on its own.
   */
  t("the iOS shell does not paint a fixed colour behind a themed app",
    cap.ios?.backgroundColor === undefined, cap.ios?.backgroundColor);

  const native = readFileSync(new URL("../src/lib/native.js", import.meta.url), "utf8");
  /**
   * The status bar sits on top of the *app*, so it follows the app's resolved
   * appearance. Reading the media query directly gives light glyphs on a light
   * app for anybody on a dark phone who chose Light.
   */
  t("the status bar follows the app rather than the phone",
    /resolveTheme\(\)\s*===\s*"dark"/.test(native));
  t("and is told again whenever the appearance changes",
    /addEventListener\("squirrel:theme"/.test(native));
}

console.log(`\nTheme rules: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
