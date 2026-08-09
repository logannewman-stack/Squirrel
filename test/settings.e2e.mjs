/**
 * Settings, on a phone and on a desktop.
 *
 * Needs the dev server on :5173.
 *
 * One list under two navigation models: a phone pushes a screen at a time the
 * way the platform does, a desktop keeps a rail because there are no levels to
 * push through. That is two code paths for one screen, which is exactly the
 * arrangement that rots — a setting gets added to the desktop branch, nobody
 * opens the app on a phone that week, and it is missing there for a month.
 *
 * So every group is opened on both, and the back button is walked on the phone,
 * where "back" means one level rather than out of settings entirely.
 */
import { chromium } from "playwright";
import { skipOnboarding } from "./onboard.mjs";

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const out = [];
const t = (name, ok, detail) => {
  out.push([name, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const GROUPS = ["Account", "You", "Assistant", "Connections", "Data"];

/* ------------------------------------------------------------------- phone */
{
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, timezoneId: "America/New_York" });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  await p.evaluate(() => { localStorage.removeItem("squirrel.v2"); localStorage.removeItem("squirrel.theme"); });
  await p.reload({ waitUntil: "networkidle" });
  await skipOnboarding(p);
  await p.getByRole("button", { name: "Settings" }).first().click();
  await p.waitForTimeout(400);

  const index = await p.locator("main, body").first().innerText();
  t("a phone opens on an index rather than everything at once",
    GROUPS.every((g) => index.includes(g)), index.slice(0, 120));
  t("and no group's contents are on it",
    !/Confirm before changing anything/.test(index), index.slice(0, 200));

  // The rows answer without being opened, which is the point of the shape.
  t("each row carries its own current value", /Mr\. Newman/.test(index), index.slice(0, 200));
  t("including the ones worth seeing at a glance",
    /9:00 AM – 5:00 PM/.test(index), index.slice(0, 400));

  for (const g of GROUPS) {
    await p.getByRole("button", { name: new RegExp(`^${g}`) }).first().click();
    await p.waitForTimeout(300);
    const heading = await p.locator("h1").first().innerText();
    t(`  ${g} pushes a screen of its own`, heading === g, heading);
    // Back is one level, not out of settings.
    await p.getByRole("button", { name: /^Settings$/ }).first().click();
    await p.waitForTimeout(300);
    t(`  and back returns to the index`, (await p.locator("h1").first().innerText()) === "Settings");
  }

  // The switch inside a group has to work, not just render.
  await p.getByRole("button", { name: /^Assistant/ }).first().click();
  await p.waitForTimeout(300);
  const sw = p.getByRole("switch", { name: /Confirm before changing anything/ });
  const before = await sw.getAttribute("aria-checked");
  await sw.click();
  await p.waitForTimeout(250);
  t("a switch in a group actually switches",
    (await sw.getAttribute("aria-checked")) !== before, await sw.getAttribute("aria-checked"));
  t("and is written to the store",
    (await p.evaluate(async () => (await import("/src/lib/store.js")).getState().settings.confirm)) === false);

  t("no page errors on a phone", errs.length === 0, errs.join(" · "));
  await p.close();
}

/* ----------------------------------------------------------------- desktop */
{
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: "America/New_York" });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  await p.evaluate(() => { localStorage.removeItem("squirrel.v2"); localStorage.removeItem("squirrel.theme"); });
  await p.reload({ waitUntil: "networkidle" });
  await skipOnboarding(p);
  await p.getByRole("button", { name: "Settings" }).first().click();
  await p.waitForTimeout(400);

  t("a desktop opens straight into a group, with the rail beside it",
    (await p.locator("h1").first().innerText()) === "Settings");
  t("and shows that group's contents immediately",
    /Sync is not set up|Signed in|Sign in/.test(await p.locator("main").first().innerText()));

  for (const g of GROUPS) {
    await p.getByRole("button", { name: g, exact: true }).click();
    await p.waitForTimeout(300);
    t(`  ${g} switches the panel without leaving the page`,
      (await p.locator("h1").first().innerText()) === "Settings");
    t(`  and the rail marks where you are`,
      (await p.getByRole("button", { name: g, exact: true }).getAttribute("aria-current")) === "true");
  }

  // Every group has to render something. An empty panel is the failure mode of
  // a five-way switch, and it is silent.
  for (const g of GROUPS) {
    await p.getByRole("button", { name: g, exact: true }).click();
    await p.waitForTimeout(250);
    const body = await p.locator("main").first().innerText();
    t(`  ${g} is not an empty panel`, body.replace(/\s+/g, " ").length > 260, body.length);
  }

  t("no page errors on a desktop", errs.length === 0, errs.join(" · "));
  await p.close();
}

await b.close();
const failed = out.filter(([, ok]) => !ok);
console.log(`\nSettings: ${out.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
