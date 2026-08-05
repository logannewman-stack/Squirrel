/**
 * Run the real store and the real assistant under Node.
 *
 * The store is a browser module — it reads and writes `localStorage`. Shimming
 * that is the whole trick, and it buys something the Playwright suite cannot:
 * assistant behaviour tested at the speed of a unit test, so a corpus of a
 * hundred destructive phrasings can be *executed* rather than merely classified.
 *
 * That distinction is the reason this file exists. Coverage measured at the
 * classifier says "cancel all my meetings tomorrow" is understood. Executing it
 * says whether anything was actually cancelled, and those were different
 * answers for longer than they should have been.
 */

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
};

if (!globalThis.crypto?.randomUUID) {
  const { webcrypto } = await import("node:crypto");
  globalThis.crypto = webcrypto;
}

export const store = await import("../src/lib/store.js");
export const { ask, resolveChoice } = await import("../src/lib/nlu/index.js");

/** Local wall-clock ISO, the only format the store holds. */
export const iso = (y, mo, d, h, mi = 0) =>
  `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` +
  `T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00`;

/** Fresh state, with the identity answered so the assistant has a name to use. */
export function reset({ confirm = false } = {}) {
  store.resetAll();
  store.setSetting("identity", { style: "formal", honorific: "Mr.", lastName: "Newman" });
  store.setSetting("confirm", confirm);
  return store.getState;
}

let pass = 0;
let fail = 0;
const failures = [];

export function t(name, ok, detail) {
  if (ok) pass++;
  else {
    fail++;
    failures.push(name);
  }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
}

export function report(title) {
  console.log(`\n${title}: ${pass} passed, ${fail} failed`);
  if (fail) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
}
