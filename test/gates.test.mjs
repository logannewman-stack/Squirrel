/**
 * Every gate in the price list is a gate in the product, and vice versa.
 *
 * This file exists because of a real and expensive kind of bug: `FEATURES`
 * listed six capabilities as paid, and three of them — auto-scheduling,
 * delegation, client projects — were checked in exactly no code anywhere. The
 * pricing page sold them, the upgrade sheet named them, and every free account
 * had them. Studio's entire differentiator over Pro was working for nothing,
 * and nothing in the suite noticed, because a gate that is never called is
 * indistinguishable from a gate that always passes.
 *
 * It is not a bug a reviewer catches either: the declaration reads correctly,
 * the enforcement is somewhere else by definition, and "somewhere else" is
 * where an absence hides. The only reliable check is mechanical — read the
 * table, read the source, and insist they agree.
 *
 * Two directions, both worth the same:
 *
 *   declared, not enforced  — revenue given away, quietly
 *   enforced, not declared  — a customer locked out of something the price
 *                             list never said was locked, which is worse: the
 *                             first costs money, the second costs trust
 *
 * A typo counts as the second. `can(plan, "clientwork")` compiles, runs, and
 * returns true forever, because `can` is deliberately open on unknown keys.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { FEATURES, ALWAYS_FREE, PLANS, PAID, can, unlocks } from "../src/lib/plans.js";

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const SRC = new URL("../src", import.meta.url).pathname;
const DECLARATION = "lib/plans.js";

/** Every source file under src/, so a new component cannot be missed. */
function sources(dir = SRC, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.jsx?$/.test(path)) out.push(path);
  }
  return out;
}

const files = sources().map((path) => ({
  path: path.slice(SRC.length + 1),
  text: readFileSync(path, "utf8"),
}));
// The table declares; it does not enforce. A `can()` call inside plans.js is
// the definition of the gate quoting itself, and counting it would let the
// original bug pass this very test.
const consumers = files.filter((f) => f.path !== DECLARATION);

t(`there are source files to check (${files.length})`, files.length > 20, files.length);

/* ------------------------------------------------- declared, and enforced */
// `can(anything, "key")` — the plan expression varies (state.plan, plan,
// org.plan), the key is what matters.
const asks = (key) => new RegExp(`can\\([^)]*["']${key}["']`);

for (const key of Object.keys(FEATURES)) {
  const where = consumers.filter((f) => asks(key).test(f.text));
  t(`"${key}" is actually enforced somewhere`, where.length > 0,
    "declared in plans.js and checked in no component — every plan has it");
}

/* ------------------------------------------------- enforced, and declared */
const CALL = /can\([^)]*["']([A-Za-z][A-Za-z0-9_]*)["']/g;
const asked = new Set();
for (const f of consumers) for (const m of f.text.matchAll(CALL)) asked.add(m[1]);

for (const key of asked) {
  t(`"${key}" is checked against a feature that exists`, key in FEATURES,
    "a key `can` does not know is a key `can` says yes to, forever");
}

/* ------------------------------------------------------------ the table */
for (const [key, f] of Object.entries(FEATURES)) {
  t(`"${key}" names real tiers`, f.tiers.every((tier) => tier in PLANS), f.tiers.join(","));
  t(`"${key}" is not free on every tier`, !f.tiers.includes("free"),
    "a gate open to free is not a gate");
  t(`"${key}" has something to sell`, Boolean(f.name), key);
  const to = unlocks(key);
  t(`"${key}" upgrades to a tier that can be bought`, PAID.includes(to), to);
}

// Free must be able to reach every paid tier's promise by paying: a feature
// nobody can unlock is a lock with no key behind it.
t("every paid tier unlocks at least one gated feature",
  PAID.every((tier) => Object.keys(FEATURES).some((k) => can(tier, k))),
  PAID.join(","));

t("free is gated out of all of them",
  Object.keys(FEATURES).every((k) => !can("free", k)));

// `plus` is the old paid tier's name, aliased to Pro. Any account still
// carrying it must keep everything Pro has, or a rename becomes a downgrade
// for the customers who were here longest.
t("the legacy 'plus' tier keeps every Pro entitlement",
  Object.keys(FEATURES).every((k) => can("plus", k) === can("pro", k)));

/* ----------------------------------------------------------- always free */
for (const key of ALWAYS_FREE) {
  t(`"${key}" is free, and the table agrees`, !(key in FEATURES),
    "listed as always-free and gated at the same time");
  t(`"${key}" is free on the free plan`, can("free", key));
}

// The deliberate fail-open. Asserted rather than assumed, because the two
// directions above rely on it: an unknown key must be permissive, so that a
// typo is a missing lock (caught here) rather than a customer locked out of
// something they paid for (caught by an angry email).
t("an unknown feature is open, never accidentally locked", can("free", "nonesuch"));
t("and unlocks nothing, rather than pointing at a tier", unlocks("nonesuch") === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
