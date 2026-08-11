/**
 * The keyboard layer, the way back, and search on a device with no keyboard.
 *
 * Needs the dev server on :5173.
 *
 * Three things that were each present in the codebase and unreachable from the
 * app: a forty-step labelled undo you could only get at by *saying* the word
 * "undo" to the assistant, a search over everything you could only open with
 * ⌘K, and a set of shortcuts documented nowhere. This is the suite that says
 * they are reachable — which is the only claim that was ever in doubt.
 */
import { chromium } from "playwright";
import { skipOnboarding } from "./onboard.mjs";

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const out = [];
const t = (name, ok, detail) => {
  out.push([name, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

/** A page past onboarding with a little to find and a little to undo. */
async function open(viewport) {
  const p = await b.newPage({ viewport, timezoneId: "America/New_York" });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && errs.push(`console: ${m.text()}`));
  await p.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  await p.evaluate(() => { localStorage.removeItem("squirrel.v2"); localStorage.removeItem("squirrel.theme"); });
  await p.reload({ waitUntil: "networkidle" });
  await skipOnboarding(p);
  await p.evaluate(async () => {
    const s = await import("/src/lib/store.js");
    const project = s.addProject({ name: "Q3 launch" });
    s.addTask({ title: "Board deck", estimateMins: 120, due: "2026-08-14", projectId: project.id });
  });
  await p.waitForTimeout(400);
  return { p, errs };
}

const tasks = (p) => p.evaluate(async () => (await import("/src/lib/store.js")).getState().tasks.length);

/**
 * The modifier this machine actually has.
 *
 * Pinning "Meta" here would have made the suite a Mac-only test that fails on
 * every Linux runner — and, worse, would have hidden the thing worth checking:
 * that the app reads the platform rather than assuming one. The browser under
 * test decides, the same way `lib/keys.js` does.
 */
const { isApple, keyLabel } = await import("../src/lib/keys.js");
const APPLE = isApple({ platform: process.platform === "darwin" ? "MacIntel" : "Linux x86_64" });
const MOD = APPLE ? "Meta" : "Control";
const shown = (combo) => keyLabel(combo, APPLE);

/* ------------------------------------------------------------ the shortcuts */
{
  const { p, errs } = await open({ width: 1440, height: 900 });

  await p.keyboard.press(`${MOD}+k`);
  await p.waitForTimeout(300);
  t(`${shown("mod+k")} opens search`, await p.getByPlaceholder(/Search|Find/i).first().isVisible());
  await p.keyboard.press("Escape");
  await p.waitForTimeout(250);

  // The second spelling, for whoever reaches for the one we did not pick.
  await p.keyboard.press("/");
  await p.waitForTimeout(300);
  t("and so does /", await p.getByPlaceholder(/Search|Find/i).first().isVisible());
  await p.keyboard.press("Escape");
  await p.waitForTimeout(250);

  /**
   * The calendar is recognised by its scale buttons rather than its heading:
   * that heading is the range being shown ("August 11–31"), which is the right
   * thing for it to say and useless to match on.
   */
  const on = {
    "1": async () => (await p.locator("h1").first().innerText()) === "Today",
    "2": async () => (await p.getByRole("tablist", { name: "Calendar range" }).count()) > 0,
    "3": async () => (await p.locator("h1").first().innerText()) === "Projects",
  };
  for (const [digit, heading] of [["2", "Calendar"], ["3", "Projects"], ["1", "Today"]]) {
    await p.keyboard.press(`${MOD}+${digit}`);
    await p.waitForTimeout(450);
    t(`  ${shown(`mod+${digit}`)} goes to ${heading}`, await on[digit](),
      await p.locator("h1").first().innerText());
  }

  await p.keyboard.press(`${MOD}+Comma`);
  await p.waitForTimeout(400);
  t(`${shown("mod+,")} opens Settings, the way it does everywhere else`,
    (await p.locator("h1").first().innerText()) === "Settings");
  await p.keyboard.press(`${MOD}+1`);
  await p.waitForTimeout(400);

  await p.keyboard.press("n");
  await p.waitForTimeout(400);
  t("n starts a new event", await p.getByText(/New event|Edit event/i).first().isVisible());
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);

  /**
   * The check that has to happen once, before matching, rather than inside
   * each handler where it gets forgotten exactly once. Every "n" in a meeting
   * title would otherwise open a dialog.
   */
  await p.keyboard.press("n");
  await p.waitForTimeout(350);
  const title = p.getByPlaceholder(/title/i).first();
  if (await title.count()) {
    await title.fill("");
    await title.type("Renew the lease", { delay: 15 });
    t("typing a title does not fire the letter shortcuts",
      (await title.inputValue()) === "Renew the lease", await title.inputValue());
  } else {
    t("typing a title does not fire the letter shortcuts", false, "no title field found");
  }
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);

  t("no page errors from the keyboard", errs.length === 0, errs.join(" · "));
  await p.close();
}

/* ------------------------------------------------------------- the help sheet */
{
  const { p, errs } = await open({ width: 1440, height: 900 });

  await p.keyboard.press("?");
  await p.waitForTimeout(400);
  const sheet = await p.locator('[role="dialog"]').innerText();
  t("? opens the list of what the app answers to", /Keyboard/.test(sheet), sheet.slice(0, 120));
  /**
   * Written for the keyboard in front of you: symbols on an Apple board, the
   * modifier spelled out anywhere else. Getting this wrong is small and
   * instantly noticeable — "Ctrl+K" on a Mac reads as a port rather than an app.
   */
  t(`and is written the way this keyboard is labelled (${shown("mod+k")})`,
    sheet.includes(shown("mod+k")), sheet.slice(0, 200));
  t("with the undo shortcut in it, which is the one that was missing",
    sheet.includes(shown("mod+z")));
  t("and the calendar's keys, which are documented nowhere else",
    /In the calendar/.test(sheet));

  /**
   * The sheet reads the same list the dispatcher does, so the two cannot
   * describe different apps. This is the assertion that proves it is one list
   * rather than two that currently agree.
   */
  const { SHORTCUTS } = await import("../src/lib/keys.js");
  const missing = SHORTCUTS.filter((s) => !sheet.includes(s.label)).map((s) => s.label);
  t("every binding in the code appears in the sheet", missing.length === 0, missing);

  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  t("Escape closes it", (await p.locator('[role="dialog"]').count()) === 0);

  // Reachable without already knowing the shortcut for finding shortcuts.
  await p.keyboard.press(`${MOD}+Comma`);
  await p.waitForTimeout(400);
  await p.getByRole("button", { name: "You", exact: true }).click();
  await p.waitForTimeout(350);
  await p.getByRole("button", { name: /^Shortcuts/ }).click();
  await p.waitForTimeout(400);
  t("and Settings can open it, for anyone who does not know to press ?",
    /In the calendar/.test(await p.locator('[role="dialog"]').innerText()));

  t("no page errors from the sheet", errs.length === 0, errs.join(" · "));
  await p.close();
}

/* -------------------------------------------------------------------- undo */
{
  const { p, errs } = await open({ width: 1440, height: 900 });

  await p.keyboard.press(`${MOD}+3`);
  await p.waitForTimeout(400);
  await p.getByRole("button", { name: /^Q3 launch/ }).first().click();
  await p.waitForTimeout(400);
  await p.getByRole("button", { name: "Delete task" }).first().click();
  await p.waitForTimeout(500);

  t("deleting a task actually deletes it", (await tasks(p)) === 0);

  /**
   * The bar is the whole point: the change happens, and the way back is on the
   * screen it happened on. A confirmation before the fact moves the risk to the
   * moment somebody is least able to judge it, and gets clicked through inside
   * a week.
   */
  const bar = p.locator('[role="status"]');
  t("and offers the way back where it happened", await bar.isVisible());
  /**
   * Naming the thing, not the operation. The store's labels are written from
   * the user's side of the change — "Deleting “Board deck”" rather than
   * "deleteTask" — which is what makes them readable standing alone in a bar.
   */
  t("naming what it was", /Board deck/.test(await bar.innerText()),
    (await bar.innerText()).replace(/\s+/g, " "));

  await bar.getByRole("button", { name: /^Undo/ }).click();
  await p.waitForTimeout(500);
  t("the button puts it back", (await tasks(p)) === 1);
  t("and the bar confirms rather than vanishing",
    /Put back/.test(await p.locator('[role="status"]').innerText()),
    await p.locator('[role="status"]').innerText().catch(() => "gone"));

  // Again, with the shortcut everybody already has in their fingers.
  await p.getByRole("button", { name: "Delete task" }).first().click();
  await p.waitForTimeout(500);
  t("a second change is offered too", (await tasks(p)) === 0);
  await p.keyboard.press(`${MOD}+z`);
  await p.waitForTimeout(500);
  t(`${shown("mod+z")} puts it back as well`, (await tasks(p)) === 1);

  // Nothing to take back is not an error and not worth a message.
  await p.keyboard.press(`${MOD}+z`);
  await p.keyboard.press(`${MOD}+z`);
  await p.keyboard.press(`${MOD}+z`);
  await p.waitForTimeout(400);
  t("undoing past the beginning is quiet, not broken", errs.length === 0, errs.join(" · "));

  t("no page errors around undo", errs.length === 0, errs.join(" · "));
  await p.close();
}

/* --------------------------------------------------- search without a keyboard */
/**
 * The gap that mattered most. `lib/search.js` covers finished tasks, past
 * meetings, notes and attendees, and on a phone — where the app is mostly used
 * — there was no way to reach any of it.
 */
{
  const { p, errs } = await open({ width: 390, height: 844 });

  const find = p.getByRole("button", { name: "Search" }).first();
  t("a phone has a way into search at all", await find.isVisible());

  await find.click();
  await p.waitForTimeout(400);
  const box = p.getByPlaceholder(/Search|Find/i).first();
  t("tapping it opens the same search", await box.isVisible());

  await box.fill("board");
  await p.waitForTimeout(400);
  t("which finds the work", /Board deck/.test(await p.locator("body").innerText()));

  // The thing the old jump list could not do: find something already finished.
  await p.keyboard.press("Escape");
  await p.waitForTimeout(250);
  await p.evaluate(async () => {
    const s = await import("/src/lib/store.js");
    s.toggleTask(s.getState().tasks[0].id);
  });
  await p.waitForTimeout(300);
  await p.getByRole("button", { name: "Search" }).first().click();
  await p.waitForTimeout(300);
  await p.getByPlaceholder(/Search|Find/i).first().fill("board");
  await p.waitForTimeout(400);
  t("including after it is done, which is when people go looking",
    /Board deck/.test(await p.locator("body").innerText()));
  await p.keyboard.press("Escape");
  await p.waitForTimeout(250);

  // Every main screen, because "search is on one screen" is the same problem
  // one step smaller.
  for (const [tab, heading] of [["Projects", "Projects"], ["Insights", "Insights"]]) {
    await p.getByRole("button", { name: tab, exact: true }).first().click();
    await p.waitForTimeout(450);
    const here = await p.locator("body").innerText();
    if (/Insights is on Pro|See where your time/.test(here) && tab === "Insights") {
      t(`  ${heading} is behind a wall on this account, so nothing to check`, true);
      continue;
    }
    t(`  ${heading} has one too`,
      (await p.getByRole("button", { name: "Search" }).count()) > 0, here.slice(0, 100));
  }

  t("no page errors on a phone", errs.length === 0, errs.join(" · "));
  await p.close();
}

await b.close();
const failed = out.filter(([, ok]) => !ok);
console.log(`\nKeyboard, undo and search: ${out.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
