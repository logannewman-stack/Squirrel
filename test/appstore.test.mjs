/**
 * In-App Purchase, and the one ordering that decides whether a payment is lost.
 *
 * A StoreKit transaction stays outstanding until it is *finished*, and that is
 * the only safety net in the whole flow. Verify, then finish: a customer whose
 * app was killed between paying and being granted — or whose network dropped,
 * or who paid while the server was down — has their transaction replayed at
 * the next launch and lands on their plan with nobody doing anything.
 *
 * Finish first and that net is gone. Apple has taken the money, the server
 * never heard, StoreKit considers it delivered and never mentions it again,
 * and the only route back is a human reading a support email. The failure is
 * invisible in every happy-path test and in every simulator run, because it
 * only appears when something else goes wrong first.
 *
 * So the assertions here are mostly about *what did not happen*: what was not
 * finished, what was not charged, what the server was not asked.
 */
import { buy, restore, reconcile, sayOutcome, appStoreAvailable } from "../src/lib/appstore.js";

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const CATALOGUE = { catalogue: { pro: "com.squirrelll.pro.monthly", studio: "com.squirrelll.studio.monthly" } };

/** A StoreKit plugin that records what it was asked to do, in order. */
function fakeStore({ state = "purchased", canPay = true, entitlements = [] } = {}) {
  const log = [];
  return {
    log,
    available: async () => { log.push("available"); return { available: canPay }; },
    products: async ({ ids }) => ({ products: ids.map((id) => ({ id, price: "$24.99" })) }),
    purchase: async ({ id }) => {
      log.push(`purchase:${id}`);
      return { state, signedTransaction: "jws.for." + id, transactionId: "tx1", productId: id };
    },
    restore: async () => { log.push("restore"); return { entitlements }; },
    current: async () => { log.push("current"); return { entitlements }; },
    finish: async ({ transactionId }) => { log.push(`finish:${transactionId}`); return { finished: true }; },
  };
}

/** Deps that record the same order the plugin does, so the sequence is one list. */
const spy = (plugin, { fails = false, plan = "pro" } = {}) => ({
  ...CATALOGUE,
  session: async () => "a-signed-in-token",
  verify: async (tx) => {
    plugin.log.push(`verify:${tx.transactionId}`);
    if (fails) throw new Error("the server said no");
    return { plan };
  },
  finish: async (id) => { plugin.log.push(`finish:${id}`); },
});

const withStore = (plugin, fn) => {
  globalThis.__SQUIRREL_STORE__ = plugin;
  return fn().finally(() => { delete globalThis.__SQUIRREL_STORE__; });
};

/* ------------------------------------------------------ the happy path */
{
  const plugin = fakeStore();
  const out = await withStore(plugin, () => buy("pro", spy(plugin)));
  t("a purchase resolves with the plan the server granted", out.ok && out.plan === "pro", JSON.stringify(out));
  t("it buys the product id the server has configured",
    plugin.log.includes("purchase:com.squirrelll.pro.monthly"), plugin.log.join(" → "));
  t("and the server is asked before the transaction is finished",
    plugin.log.indexOf("verify:tx1") < plugin.log.indexOf("finish:tx1"), plugin.log.join(" → "));
  t("both of them happen", plugin.log.includes("verify:tx1") && plugin.log.includes("finish:tx1"),
    plugin.log.join(" → "));
}

/* ------------------------------------------- the failure that must survive */
{
  const plugin = fakeStore();
  let threw = null;
  await withStore(plugin, async () => {
    try { await buy("pro", spy(plugin, { fails: true })); } catch (e) { threw = e; }
  });
  t("a server that refuses the receipt is an error, not a silent success", Boolean(threw));
  // The assertion this whole file exists for.
  t("and the transaction is LEFT UNFINISHED so StoreKit replays it",
    !plugin.log.some((l) => l.startsWith("finish:")), plugin.log.join(" → "));
}

/* --------------------------------------------------- cancelling is not an error */
{
  const plugin = fakeStore({ state: "cancelled" });
  const out = await withStore(plugin, () => buy("pro", spy(plugin)));
  t("closing the payment sheet is a normal outcome", out.ok === false && out.reason === "cancelled");
  t("nothing is sent to the server for a purchase that never happened",
    !plugin.log.some((l) => l.startsWith("verify")), plugin.log.join(" → "));
  t("and it is said with silence, not a red banner", sayOutcome("cancelled") === null);
}

/* ------------------------------------------------------------ ask-to-buy */
{
  const plugin = fakeStore({ state: "pending" });
  const out = await withStore(plugin, () => buy("pro", spy(plugin)));
  t("Ask-to-Buy is reported as pending, not as a failure", out.reason === "pending");
  t("nothing is verified until a parent has actually approved it",
    !plugin.log.some((l) => l.startsWith("verify")), plugin.log.join(" → "));
  t("and the copy tells them there is nothing more to do",
    /nothing more to do/i.test(sayOutcome("pending")), sayOutcome("pending"));
}

/* ------------------------------------------------------- cannot pay at all */
{
  const plugin = fakeStore({ canPay: false });
  const out = await withStore(plugin, () => buy("pro", spy(plugin)));
  t("a device that cannot make payments says so before opening a sheet",
    out.reason === "cannot_pay" && !plugin.log.some((l) => l.startsWith("purchase")),
    plugin.log.join(" → "));
}

/* ---------------------------------------------------------------- restore */
{
  const plugin = fakeStore({
    entitlements: [{ signedTransaction: "jws.a", transactionId: "txA", productId: "com.squirrelll.studio.monthly" }],
  });
  const out = await withStore(plugin, () => restore(spy(plugin, { plan: "studio" })));
  t("restoring puts the account back on the plan Apple is charging for",
    out.ok && out.plan === "studio", JSON.stringify(out));
  t("and it too verifies before finishing",
    plugin.log.indexOf("verify:txA") < plugin.log.indexOf("finish:txA"), plugin.log.join(" → "));
}

{
  const plugin = fakeStore({ entitlements: [] });
  const out = await withStore(plugin, () => restore(spy(plugin)));
  t("an Apple ID with no subscription is told plainly", out.reason === "nothing_to_restore");
  t("and is not told something went wrong",
    /No subscription found/i.test(sayOutcome("nothing_to_restore")), sayOutcome("nothing_to_restore"));
}

/* -------------------------------------------------------------- reconcile */
{
  const plugin = fakeStore({
    entitlements: [
      { signedTransaction: "jws.a", transactionId: "txA" },
      { signedTransaction: "jws.b", transactionId: "txB" },
    ],
  });
  const out = await withStore(plugin, () => reconcile(spy(plugin)));
  t("resuming settles everything StoreKit is still holding", out.ok && out.count === 2, JSON.stringify(out));
  t("each one verified before it is finished",
    plugin.log.indexOf("verify:txA") < plugin.log.indexOf("finish:txA")
      && plugin.log.indexOf("verify:txB") < plugin.log.indexOf("finish:txB"),
    plugin.log.join(" → "));
  t("and it never asks the App Store for a password",
    !plugin.log.includes("restore"), plugin.log.join(" → "));
}

{
  // Offline at launch. This runs unattended on every resume, so it must not
  // surface anything: the customer did not ask, and StoreKit will offer the
  // transaction again in a minute.
  const plugin = fakeStore({ entitlements: [{ signedTransaction: "j", transactionId: "txZ" }] });
  const out = await withStore(plugin, () => reconcile({
    ...CATALOGUE,
    session: async () => "a-signed-in-token",
    verify: async () => { throw new Error("offline"); },
    finish: async (id) => { plugin.log.push(`finish:${id}`); },
  }));
  t("an unattended reconcile that fails is deferred, not thrown", out.ok === false && out.reason === "deferred");
  t("and still finishes nothing", !plugin.log.some((l) => l.startsWith("finish:")), plugin.log.join(" → "));
}

/* ------------------------------------------------------------- the browser */
t("a browser has no store at all", appStoreAvailable() === false);
{
  let threw = null;
  try { await buy("pro", CATALOGUE); } catch (e) { threw = e; }
  t("and buying from one is refused rather than half-attempted", Boolean(threw), threw?.message);
}

/* ----------------------------------------------------------------- the copy */
t("an unknown failure never blames the customer, and says nothing was charged",
  /Nothing has been charged/i.test(sayOutcome("who_knows")), sayOutcome("who_knows"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
