/**
 * Work that had nowhere to be.
 *
 * Needs the dev server on :5173.
 *
 * `Projects` groups by project and `ProjectDetail` is keyed on one, so a task
 * with no `projectId` was visible on Today while it was due and invisible the
 * moment it stopped being urgent. An architecture audit confirmed the states in
 * a real browser: **done with no project — invisible on every screen**, at
 * every combination of due date and estimate. Delegated work past the sixth row
 * of Today's list, and unestimated work past the fifth, were equally gone
 * behind a "+N more" that was a plain `<li>` — a label naming a number of
 * things the screen was refusing to show, with no way to see them.
 *
 * Search could find these rows, and pressing enter on one navigated to Today:
 * the single screen that does not contain it. So even the escape hatch led
 * nowhere.
 *
 * The fix is a destination rather than four patches. Unfiled is a project
 * without a record — every part of the detail screen already does the right
 * thing for a set of tasks, and the only parts that do not apply are the ones
 * that edit the project itself.
 */
import { chromium } from "playwright";
import { skipOnboarding } from "./onboard.mjs";

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const out = [];
const t = (name, ok, detail) => {
  out.push([name, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const p = await b.newPage({ viewport: { width: 1440, height: 950 }, timezoneId: "America/New_York" });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => m.type() === "error" && errs.push(`console: ${m.text()}`));

await p.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: "networkidle" });
await skipOnboarding(p);

/** Exactly the states the audit found nowhere, plus one real project. */
await p.evaluate(async () => {
  const s = await import("/src/lib/store.js");
  const finished = s.addTask({ title: "Finished thing", estimateMins: 30 });
  s.toggleTask(finished.id);
  s.addTask({ title: "Chase the invoice", estimateMins: 0 });
  s.addTask({ title: "Waiting on legal", estimateMins: 30, delegatedTo: "Anders" });
  // Eight more delegated, so Today's six-row cap is exceeded and the "+N more"
  // row is on screen to be pressed.
  for (let i = 1; i <= 8; i++) {
    s.addTask({ title: `Delegated ${i}`, estimateMins: 30, delegatedTo: `Person ${i}` });
  }
  const q3 = s.addProject({ name: "Q3 launch" });
  s.addTask({ title: "Board deck", estimateMins: 120, due: "2026-12-01", projectId: q3.id });
});
await p.waitForTimeout(700);

/* ------------------------------------------------------------ from Projects */
await p.getByRole("button", { name: "Projects", exact: true }).first().click();
await p.waitForTimeout(600);
{
  const grid = await p.locator("body").innerText();
  // Matched case-insensitively: the heading is uppercased by the stylesheet,
  // and innerText returns what is rendered rather than what was written.
  t("Projects shows an Unfiled card", /unfiled/i.test(grid), grid.slice(0, 160));
  t("  counting the open work", /1 open/.test(grid), grid.match(/\d+ open[^\n]*/)?.[0]);
  t("  and the work sitting with somebody else",
    /with someone else/.test(grid), grid.match(/[^\n]*someone else[^\n]*/)?.[0]);
  t("  and real projects are still listed beside it", /Q3 launch/.test(grid));
}

await p.getByRole("button", { name: /unfiled/i }).first().click();
await p.waitForTimeout(600);
{
  const detail = await p.locator("body").innerText();
  t("it opens a real screen", /Work with no project on it/.test(detail), detail.slice(0, 140));
  /**
   * A pile with no record cannot be renamed, billed to a client, given a value
   * or deleted. Offering any of those would be offering to operate on something
   * that does not exist.
   */
  t("  with nothing to delete", (await p.getByRole("button", { name: "Delete", exact: true }).count()) === 0);
  t("  nothing to bill", (await p.getByPlaceholder("Client").count()) === 0);
  t("  and no value field", (await p.getByPlaceholder("Value ($)").count()) === 0);
  t("  but it says how to stop being unfiled",
    /file the lease under/i.test(detail), detail.match(/[^\n]*Say[^\n]*/)?.[0]);
}

/* -------------------------------------------- the states that were invisible */
{
  await p.getByRole("button", { name: /^Done/ }).first().click();
  await p.waitForTimeout(400);
  t("finished work with no project is reachable at last",
    /Finished thing/.test(await p.locator("body").innerText()));

  await p.getByRole("button", { name: /^Waiting/ }).first().click();
  await p.waitForTimeout(400);
  const waiting = await p.locator("body").innerText();
  t("so is everything sitting with somebody else",
    /Waiting on legal/.test(waiting) && /Delegated 8/.test(waiting),
    waiting.slice(0, 200));

  await p.getByRole("button", { name: /^Open/ }).first().click();
  await p.waitForTimeout(400);
  t("and the unestimated work", /Chase the invoice/.test(await p.locator("body").innerText()));
}

/* --------------------------------------------------- the rows that led nowhere */
/**
 * "+6 more" was a plain list item: a label naming a number of things the screen
 * was refusing to show, with nothing to press. It is the way in now.
 */
await p.getByRole("button", { name: "Today", exact: true }).first().click();
await p.waitForTimeout(700);
{
  const today = await p.locator("body").innerText();
  t("Today still caps its waiting list", /\+\d+ more/.test(today), today.match(/\+\d+ more/)?.[0]);

  await p.getByRole("button", { name: /^\+\d+ more$/ }).first().click();
  await p.waitForTimeout(700);
  t("  and the cap is now a door rather than a label",
    /Work with no project on it/.test(await p.locator("body").innerText()));
}

/* ------------------------------------------------------- and it can be emptied */
/**
 * A holding pen nobody can empty is a worse holding pen. Filing a task from
 * here has to remove it from here.
 */
{
  const before = await p.evaluate(async () =>
    (await import("/src/lib/store.js")).getState().tasks.filter((x) => !x.projectId).length);
  await p.evaluate(async () => {
    const s = await import("/src/lib/store.js");
    const q3 = s.getState().projects.find((x) => x.name === "Q3 launch");
    const loose = s.getState().tasks.find((x) => !x.projectId && x.title === "Chase the invoice");
    s.updateTask(loose.id, { projectId: q3.id });
  });
  await p.waitForTimeout(600);
  const after = await p.evaluate(async () =>
    (await import("/src/lib/store.js")).getState().tasks.filter((x) => !x.projectId).length);
  t("filing something takes it out of Unfiled", after === before - 1, `${before} → ${after}`);
  t("  and the screen followed",
    !/Chase the invoice/.test(await p.locator("body").innerText()));
}

t("no page errors", errs.length === 0, errs.join(" · "));

await b.close();
const failed = out.filter(([, ok]) => !ok);
console.log(`\nUnfiled: ${out.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
