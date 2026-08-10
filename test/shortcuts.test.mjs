/**
 * The phrases Settings teaches, against the phrases iOS was actually given.
 *
 * These live in two languages in two files, and they drift the way every
 * duplicated list drifts — somebody adds a phrase to the Swift months from now
 * and the settings screen carries on teaching the old one. Which is the worst
 * kind of documentation bug for a voice feature: the person says the phrase,
 * Siri does not know it, and they conclude the feature is broken rather than
 * that the list is stale.
 *
 * So this parses the real `AppShortcutsProvider` and compares.
 */
import { readFileSync } from "node:fs";
import { SHORTCUTS, allTemplates } from "../src/lib/shortcuts.js";

let pass = 0, fail = 0;
const failures = [];
const t = (name, ok, detail) => {
  if (ok) pass++; else { fail++; failures.push(name); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const swift = readFileSync(new URL("../ios/App/App/SquirrelIntents.swift", import.meta.url), "utf8");

/**
 * Pull the registered phrases out of the Swift.
 *
 * Only from inside `appShortcuts`, so a phrase in a comment or a doc block
 * upstairs is not mistaken for a registration.
 */
function registered() {
  const body = swift.slice(swift.indexOf("var appShortcuts"));
  const out = [];
  for (const m of body.matchAll(/"((?:[^"\\]|\\[^(]|\\\([^)]*\))*)"/g)) {
    const raw = m[1];
    // A phrase is the only string in there containing an interpolation.
    if (!raw.includes("\\(")) continue;
    out.push(
      raw
        .replace(/\\\(\.applicationName\)/g, "{app}")
        .replace(/\\\(\\\.\$request\)/g, "{request}"),
    );
  }
  return out;
}

const swiftPhrases = registered();

t("the Swift file was found and has phrases in it", swiftPhrases.length > 0, swiftPhrases.length);
t("and nothing was left un-normalised",
  swiftPhrases.every((p) => !p.includes("\\(")), swiftPhrases.filter((p) => p.includes("\\(")));

// --------------------------------------------------------------- both ways
{
  const ours = new Set(allTemplates());
  const theirs = new Set(swiftPhrases);

  const missing = [...theirs].filter((p) => !ours.has(p));
  t("every phrase iOS knows is one we document", missing.length === 0, missing);

  /**
   * The direction that actually hurts. A phrase in this list that iOS was never
   * given is a phrase somebody will say, watch fail, and take as proof the
   * feature does not work.
   */
  const invented = [...ours].filter((p) => !theirs.has(p));
  t("and we document no phrase iOS was never given", invented.length === 0, invented);
}

// -------------------------------------------------------------- the entries
{
  t("there is one entry per intent", SHORTCUTS.length === 3, SHORTCUTS.length);
  t("each has a title", SHORTCUTS.every((s) => s.title?.length > 2));
  t("each says what it does", SHORTCUTS.every((s) => s.what?.length > 10));
  t("each has at least one phrase to try", SHORTCUTS.every((s) => s.examples.length > 0));
  t("and ids are unique", new Set(SHORTCUTS.map((s) => s.id)).size === SHORTCUTS.length);

  /**
   * The examples are what a person reads and repeats out loud, so each one has
   * to be a phrase the system will match — not a paraphrase of one. Checked by
   * shape rather than by string, since the templates carry a free parameter.
   */
  const shapes = allTemplates().map((p) => new RegExp(
    `^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace("\\{app\\}", "Squirrel")
        .replace("\\{request\\}", ".+")}$`,
    "i",
  ));
  for (const s of SHORTCUTS) {
    for (const ex of s.examples) {
      t(`"${ex}" is a phrase Siri will match`, shapes.some((r) => r.test(ex)));
    }
  }
}

// -------------------------------------------------------------- the one gap
/**
 * Two intents claiming one phrase is ambiguous and iOS resolves it by silently
 * picking one. "What's my day" belongs to the intent that answers it out loud,
 * not to the one that opens the app — a distinction the Swift makes in a
 * comment and which nothing was checking.
 */
{
  const dupes = allTemplates().filter((p, i, a) => a.indexOf(p) !== i);
  t("no phrase is registered by two intents", dupes.length === 0, dupes);

  const answering = SHORTCUTS.find((s) => s.id === "whats-on").templates;
  const opening = SHORTCUTS.find((s) => s.id === "open-today").templates;
  t("asking what your day is gets an answer, not a launch",
    answering.some((p) => /what's my day/i.test(p)) && !opening.some((p) => /what's my day/i.test(p)));
}

console.log(`\nShortcuts: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
