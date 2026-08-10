/**
 * Light, dark, and the machine's own mind.
 *
 * Needs the dev server on :5173.
 *
 * A theme toggle is the classic thing that half-works: defining the dark values
 * only inside the media query makes it switch correctly on a light system and
 * silently do nothing on a dark one, and the bug is invisible to whoever built
 * it because they only ever tested on their own machine. So this runs the whole
 * matrix — both system settings, all three choices — and checks the pixels
 * rather than the attribute.
 */
import { chromium } from "playwright";
import { skipOnboarding } from "./onboard.mjs";

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const out = [];
const t = (name, ok, detail) => {
  out.push([name, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const LIGHT = "rgb(247, 247, 248)";
const DARK = "rgb(13, 13, 16)";

for (const system of ["light", "dark"]) {
  const p = await b.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: system });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  const bg = () => p.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await p.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  await p.evaluate(() => {
    localStorage.removeItem("squirrel.v2");
    localStorage.removeItem("squirrel.theme");
  });
  await p.reload({ waitUntil: "networkidle" });
  await skipOnboarding(p);

  const expected = system === "dark" ? DARK : LIGHT;
  t(`a ${system} machine gets a ${system} app without being asked`, (await bg()) === expected, await bg());

  await p.getByRole("button", { name: "Settings" }).first().click();
  await p.getByRole("button", { name: "You", exact: true }).click();
  await p.waitForTimeout(300);

  // The half that usually breaks: choosing the opposite of the system.
  await p.getByRole("button", { name: /^Light/ }).first().click();
  await p.waitForTimeout(250);
  t(`  and can still be told to be light on a ${system} machine`, (await bg()) === LIGHT, await bg());

  await p.getByRole("button", { name: /^Dark/ }).first().click();
  await p.waitForTimeout(250);
  t(`  or dark on a ${system} machine`, (await bg()) === DARK, await bg());

  // Choosing is not a door that closes.
  await p.getByRole("button", { name: /^System/ }).first().click();
  await p.waitForTimeout(250);
  t("  and handed back to the machine again", (await bg()) === expected, await bg());
  t("  which leaves nothing stamped on the page",
    (await p.evaluate(() => document.documentElement.getAttribute("data-theme"))) === null);

  // It has to survive a reload, and survive it *before* the first paint.
  await p.getByRole("button", { name: /^Dark/ }).first().click();
  await p.waitForTimeout(200);
  await p.reload({ waitUntil: "domcontentloaded" });
  t("  a choice is remembered", (await bg()) === DARK, await bg());
  t("  and is on the page before React renders, so nothing flashes",
    (await p.evaluate(() => document.documentElement.getAttribute("data-theme"))) === "dark");

  t(`  no page errors on a ${system} machine`, errs.length === 0, errs.join(" · "));
  await p.close();
}

/* ---------------------------------------------- the machine changing its mind
 * A Mac flips itself at sunset while the app is sitting open. "Follows the
 * system" has to mean following it *then*, not on the next reload — which is
 * all a theme built from a boot-time read can manage.
 */
{
  const p = await b.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  const bg = () => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const says = async () => (await p.locator("body").innerText()).match(/Currently \w+/)?.[0] ?? "nothing";

  await p.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  await p.evaluate(() => {
    localStorage.removeItem("squirrel.v2");
    localStorage.removeItem("squirrel.theme");
  });
  await p.reload({ waitUntil: "networkidle" });
  await skipOnboarding(p);
  await p.getByRole("button", { name: "Settings" }).first().click();
  await p.getByRole("button", { name: "You", exact: true }).click();
  await p.waitForTimeout(300);

  t("on System the app starts as the machine is", (await bg()) === LIGHT, await bg());
  t("and says so", (await says()) === "Currently light", await says());

  await p.emulateMedia({ colorScheme: "dark" });
  await p.waitForTimeout(300);
  t("the machine going dark takes the app with it, with no reload",
    (await bg()) === DARK, await bg());
  /**
   * The app itself was already right here; its description of itself was not.
   * The line went on reading "Currently light" after the machine had gone dark
   * around it, because only an explicit choice notified anything.
   */
  t("and what it says about itself changes with it", (await says()) === "Currently dark", await says());
  t("leaving nothing stamped on the page, so it can change again",
    (await p.evaluate(() => document.documentElement.getAttribute("data-theme"))) === null);
  t("with the native chrome given the resolved answer",
    (await p.evaluate(() => document.documentElement.style.colorScheme)) === "dark");

  await p.emulateMedia({ colorScheme: "light" });
  await p.waitForTimeout(300);
  t("and back again at dawn", (await bg()) === LIGHT, await bg());

  // Somebody who chose Light chose it on purpose, and sunset is not a reason
  // to overrule them.
  await p.getByRole("button", { name: /^Light/ }).first().click();
  await p.waitForTimeout(200);
  await p.emulateMedia({ colorScheme: "dark" });
  await p.waitForTimeout(300);
  t("a deliberate choice is not overruled when the machine changes",
    (await bg()) === LIGHT, await bg());
  t("and is still on the page as a choice",
    (await p.evaluate(() => document.documentElement.getAttribute("data-theme"))) === "light");

  await p.getByRole("button", { name: /^System/ }).first().click();
  await p.waitForTimeout(250);
  t("handing it back picks up wherever the machine got to", (await bg()) === DARK, await bg());

  t("no page errors while the machine changes", errs.length === 0, errs.join(" · "));
  await p.close();
}

await b.close();
const failed = out.filter(([, ok]) => !ok);
console.log(`\nTheme: ${out.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
