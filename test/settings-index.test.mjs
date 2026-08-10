/**
 * Searching Settings, and the index staying honest.
 *
 * Two separate risks. The first is that the search is bad — somebody types the
 * word they have for a thing and gets nothing. The second is quieter and
 * worse: somebody adds a section to Settings months from now, does not add it
 * here, and the search silently cannot find the newest setting in the app.
 * That is the failure mode of every hand-maintained index, and the only cure
 * is a test that reads the screen it claims to describe.
 */
import { readFileSync } from "node:fs";
import { INDEX, SECTION, NOT_A_DESTINATION, findSettings, titleOf } from "../src/lib/settingsIndex.js";

let pass = 0, fail = 0;
const failures = [];
const t = (name, ok, detail) => {
  if (ok) pass++; else { fail++; failures.push(name); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const jsx = readFileSync(new URL("../src/components/Settings.jsx", import.meta.url), "utf8");

// --------------------------------------------------------------- no drift
/**
 * Every `<Group header="…">` on the real screen, taken from the real file.
 * The template-literal form is deliberately not matched: there is none today,
 * and a header computed at runtime is not something a static index can cover,
 * so it should be a visible failure rather than a silent gap.
 */
const headers = [...jsx.matchAll(/<Group[^>]*?\bheader="([^"]+)"/gs)].map((m) => m[1]);

t("the screen was found and has groups on it", headers.length > 5, headers.length);
t("no header is built at runtime, which an index could not follow",
  !/header=\{`/.test(jsx));

{
  const indexed = new Map();
  for (const e of INDEX) indexed.set(`${e.group}:${e.header}`, e);

  const missing = headers
    .filter((h) => !NOT_A_DESTINATION.includes(h))
    .filter((h) => !INDEX.some((e) => e.header === h));
  t("every group on the screen can be searched for", missing.length === 0, missing);

  const invented = INDEX.filter((e) => !headers.includes(e.header)).map((e) => e.header);
  t("and nothing is indexed that is not on the screen", invented.length === 0, invented);

  t("no two entries describe the same group",
    indexed.size === INDEX.length, INDEX.length - indexed.size);

  /**
   * "At a glance" is a summary of rows that live elsewhere, so it is not
   * somewhere to go — searching for one of its rows should land on the real
   * one. It is exempted by name rather than merely left out, so that the next
   * un-indexed group is still a failure.
   */
  t("the glance summary is exempted on purpose, not by omission",
    NOT_A_DESTINATION.includes("At a glance") && !INDEX.some((e) => e.header === "At a glance"));
  t("and every exemption is a group that really is on the screen",
    NOT_A_DESTINATION.every((h) => headers.includes(h)),
    NOT_A_DESTINATION.filter((h) => !headers.includes(h)));
}

// ------------------------------------------------------------- the entries
{
  t("every entry belongs to a real section",
    INDEX.every((e) => SECTION[e.group]), INDEX.filter((e) => !SECTION[e.group]).map((e) => e.group));
  t("every entry has words attached", INDEX.every((e) => e.keywords.split(" ").length >= 4));

  /**
   * Two groups are genuinely called Account. A search result reading "Account"
   * twice with nothing to choose between them is a worse answer than one
   * result, so the duplicate carries its own title.
   */
  const titles = INDEX.map(titleOf);
  const dupes = titles.filter((x, i) => titles.indexOf(x) !== i);
  t("no two results are indistinguishable", dupes.length === 0, dupes);
}

// ------------------------------------------------------------ the searching
const first = (q) => findSettings(q)[0];
const groups = (q) => findSettings(q).map((r) => r.group);

{
  t("the name on the screen finds the group", first("appearance")?.header === "Appearance");
  t("and so does part of it", first("working")?.header === "Your working day");
  t("case doesn't matter", first("VOICE")?.header === "Voice");
}

/**
 * The point of the whole file. The word somebody has is almost never the word
 * on the screen, and each of these is a real thing a person types.
 */
{
  const wrongName = [
    ["dark mode", "Appearance"],
    ["night", "Appearance"],
    ["notifications", "Reminders"],
    ["push", "Reminders"],
    ["cancel my subscription", "Plan"],
    ["billing", "Plan"],
    ["password", "Account"],
    ["delete my account", "Delete your account"],
    ["export", "A copy of everything"],
    ["backup", "A copy of everything"],
    ["new phone", "A copy of everything"],
    ["hey siri", "Siri & Shortcuts"],
    ["action button", "Siri & Shortcuts"],
    ["widget", "Siri & Shortcuts"],
    ["onboarding", "The introduction"],
    ["timezone", "Your working day"],
    ["lunch", "Your working day"],
    ["mute", "Voice"],
    ["read aloud", "Voice"],
    ["gdpr", "Delete your account"],
    ["version", "This build"],
    ["undo", "Before she acts"],
  ];
  for (const [typed, wanted] of wrongName) {
    const got = findSettings(typed);
    t(`"${typed}" → ${wanted}`,
      got.some((r) => r.title === wanted),
      got.map((r) => r.title).join(", ") || "nothing");
  }
}

{
  // Ranked, not just matched. "account" appears in the keywords of several
  // groups; the one actually called Account has to come first.
  t("the group with the name wins over one that merely mentions it",
    first("account")?.group === "account", JSON.stringify(findSettings("account").slice(0, 2)));

  // Every token has to land, or a two-word query returns half the screen.
  t("both words have to match", findSettings("dark subscription").length === 0,
    findSettings("dark subscription").map((r) => r.title));

  t("a word nobody used finds nothing", findSettings("zzzz").length === 0);
  t("an empty query is not a search", findSettings("").length === 0);
  t("nor is whitespace", findSettings("   ").length === 0);
  t("nor is punctuation on its own", findSettings("???").length === 0);
  t("a missing query does not throw", findSettings(undefined).length === 0);

  /**
   * People type sentences at a settings search box. Every token still has to
   * match, so a filler word nobody indexed would otherwise disqualify every
   * row — which is how "cancel my subscription" used to return nothing.
   */
  t("filler words don't disqualify a real query",
    first("how do i turn on dark mode")?.header === "Appearance",
    findSettings("how do i turn on dark mode").map((r) => r.title).join(", ") || "nothing");
  t("but a query made only of filler is not a search", findSettings("how do i").length === 0);
  t("and a filler word on its own finds nothing", findSettings("the").length === 0);

  t("results are capped", findSettings("a", { limit: 3 }).length <= 3);
  t("each result says which section it is in",
    findSettings("dark").every((r) => r.section && r.group), JSON.stringify(findSettings("dark")));
  t("and the section name is one a person would see",
    first("dark")?.section === "You", first("dark")?.section);
}

console.log(`\nSettings index: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
