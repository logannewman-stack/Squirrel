/**
 * The way out of a wall.
 *
 * Needs the dev server on :5173.
 *
 * Every limit in this app is a moment where somebody either pays or gives up,
 * and the difference between those two is almost entirely whether the way past
 * is in front of them. So this walks the walls rather than the components: hit
 * the project cap, press what is offered, and check that a real checkout is one
 * tap away and that nothing was quietly created in the meantime.
 *
 * The last block is the one that protects the product's manners. A paying
 * account must see none of this — an upgrade prompt shown to somebody who
 * already upgraded is how an interface loses the credibility it needs for the
 * one notice that matters.
 */
import { chromium } from "playwright";

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({
  viewport: { width: 1440, height: 900 },
  timezoneId: "America/New_York",
});
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));

const out = [];
const t = (name, ok, detail) => {
  out.push([name, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const store = (fn) => p.evaluate(async (src) => {
  const s = await import("/src/lib/store.js");
  return new Function("s", `return (${src})(s)`)(s);
}, fn.toString());

await p.goto("http://localhost:5173/", { waitUntil: "networkidle" });

await store((s) => {
  localStorage.removeItem("squirrel.v2");
  s.setSetting("identity", { style: "first", name: "Logan" });
  s.setSetting("onboarded", true);
  const a = s.addProject({ name: "Rebrand" });
  s.addProject({ name: "Q3 board deck" });
  for (let i = 0; i < 12; i++) s.addTask({ projectId: a.id, title: `Task ${i + 1}`, estimateMins: 45 });
});
await p.reload({ waitUntil: "networkidle" });

// Without Supabase configured the app deliberately unlocks everything — there
// is nothing to buy and nobody to bill — so the free tier has to be asked for
// explicitly, after the mount effect has had its say.
await store((s) => s.setPlanTier("free"));
await p.waitForTimeout(300);

// ------------------------------------------------------------- the wall
await p.getByRole("button", { name: "Projects", exact: true }).first().click();
await p.waitForTimeout(200);

const upgrade = p.getByRole("button", { name: "Upgrade", exact: true });
t("at the cap, Create becomes Upgrade", (await upgrade.count()) === 1);
// It used to wait for a project name before it would do anything, which made
// the exit from a wall depend on typing something that gets thrown away.
t("and it is pressable without typing a name first", await upgrade.isEnabled());

await upgrade.click();
await p.waitForTimeout(400);
const sheet = p.getByRole("dialog", { name: "Upgrade your plan" });
t("pressing it opens the upgrade sheet", (await sheet.count()) === 1);
t("which names the wall that was hit", /at 2 projects/i.test(await sheet.innerText()));
t("and offers a real checkout", await p.getByRole("button", { name: "Get Pro" }).isVisible());

await p.keyboard.press("Escape");
await p.waitForTimeout(300);
t("nothing was created on the way past",
  (await store((s) => s.getState().projects.length)) === 2);

// ------------------------------------------------------- the ambient card
const card = p.getByRole("button", { name: "Upgrade to Pro" });
t("the rail carries the plan too", (await card.count()) === 1);
await card.click();
await p.waitForTimeout(400);
t("and lands in the same place", (await p.getByRole("dialog", { name: "Upgrade your plan" }).count()) === 1);
await p.keyboard.press("Escape");
await p.waitForTimeout(300);

// ------------------------------------------------------- the assistant wall
//
// There is no free allowance any more: the assistant is a paid feature and
// free accounts meet a lock rather than a counter. She is still *drawn* behind
// it, which is the point — a feature nobody can see is a feature nobody
// upgrades for.
await p.getByRole("button", { name: "Ask Squirrel" }).first().click();
await p.waitForTimeout(400);
{
  const sheet = await p.getByRole("dialog").innerText();
  t("a free account meets the wall, not a counter",
    /Squirrel is on Pro/.test(sheet) && !/free turns left today/.test(sheet), sheet.slice(0, 120));
  t("  and is told the planner itself is still free",
    /planner itself stays free/i.test(sheet));
}
// Scoped to the sheet and matched on the price: the rail behind it carries
// a plain "Upgrade to Pro" too, and a loose match finds both.
await p.getByRole("dialog").getByRole("button", { name: /^Upgrade to Pro ·/ }).click();
await p.waitForTimeout(500);
t("and the lock is a way out, not a statement",
  (await p.getByRole("dialog", { name: "Upgrade your plan" }).count()) === 1);
await p.keyboard.press("Escape");
await p.waitForTimeout(300);

// -------------------------------------------------------------- the silence
await store((s) => s.setPlanTier("pro"));
await p.waitForTimeout(300);
t("a paying account is never sold to",
  (await p.getByRole("button", { name: "Upgrade to Pro" }).count()) === 0);
t("and the project wall is gone", (await p.getByRole("button", { name: "Create" }).count()) === 1);
await p.getByRole("button", { name: "Ask Squirrel" }).first().click();
await p.waitForTimeout(400);
{
  const sheet = await p.getByRole("dialog").innerText();
  t("and a paying account meets no wall at all",
    !/Squirrel is on Pro/.test(sheet) && !/free turns left today/.test(sheet), sheet.slice(0, 120));
}
await p.keyboard.press("Escape");

t("no page errors", errs.length === 0, errs.join(" · "));

await b.close();
const failed = out.filter(([, ok]) => !ok);
console.log(`\nUpgrade: ${out.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
