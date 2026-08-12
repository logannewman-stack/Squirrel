/**
 * Purpose, driven the way a person drives it.
 *
 * Needs the dev server on :5173.
 *
 * The oak itself is judged by eye and pinned by the math suite; what this
 * checks is the screen around it — that the tab exists and opens, that the
 * room renders without a single page error at desktop and phone size, that
 * the keyboard can walk the branches and read one, that the squirrel finds
 * what it is asked to and carries you there, that writing a meaning survives
 * a reload, and that the light/dark toggle actually flips the app's theme
 * rather than merely repainting the canvas.
 */
import { chromium } from "playwright";
import { skipOnboarding } from "./onboard.mjs";

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
/** The reading panel, by its accessible name — the nav is an <aside> too. */
const panel = (page) => page.getByRole("complementary", { name: / branch$/ });
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

/* -------------------------------------------------------------- a bare oak */
await p.getByRole("button", { name: "Purpose", exact: true }).first().click();
await p.waitForTimeout(700);
{
  const body = await p.locator("body").innerText();
  t("the tab opens a room, not a report", (await p.locator("canvas").count()) >= 1);
  t("  and a bare oak says so", /Your oak is bare/.test(body), body.slice(0, 200));
  t("  with a way to start", (await p.getByRole("button", { name: /Plant the first acorn/ }).count()) === 1);
}

/* --------------------------------------------------------------- a real one */
await p.evaluate(async () => {
  const s = await import("/src/lib/store.js");
  const a = s.addProject({ name: "Munich lease", client: "Hartmann", value: 48000 });
  s.addTask({ title: "Sign the lease", projectId: a.id, estimateMins: 60, due: "2026-12-01" });
  const done = s.addTask({ title: "Survey", projectId: a.id, estimateMins: 30 });
  s.toggleTask(done.id);
  const q = s.addProject({ name: "Q3 launch" });
  s.addTask({ title: "Board deck", projectId: q.id, estimateMins: 120 });
  s.addTask({ title: "Loose end", estimateMins: 15 });
});
await p.waitForTimeout(700);
{
  const body = await p.locator("body").innerText();
  t("the header counts the branches", /2 branches/.test(body), body.match(/\d+ branch[^\n]*/)?.[0]);
  t("  and the acorns stored away", /1 of 4 acorns stored away/.test(body),
    body.match(/\d+ of \d+ acorns[^\n]*/)?.[0]);
}

/* -------------------------------------------------- the keyboard walks it */
{
  await p.locator("canvas").first().focus();
  await p.keyboard.press("ArrowRight");
  await p.waitForTimeout(500);
  const read = await panel(p).innerText().catch(() => "");
  t("an arrow key selects the first branch and opens its reading",
    /Munich lease/.test(read), read.slice(0, 120));
  t("  showing what it has stored", /1 of 2 stored away/.test(read), read.match(/\d+ of \d+[^\n]*/)?.[0]);
  t("  the client and the money", /Hartmann/.test(read) && /\$48k/.test(read));
  t("  and each acorn by name", /Sign the lease/.test(read) && /Survey/.test(read));

  await p.keyboard.press("ArrowRight");
  await p.waitForTimeout(500);
  t("the next arrow steps up the trunk",
    /Q3 launch/.test(await panel(p).innerText()));

  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
  t("Escape lets go", (await panel(p).count()) === 0);
}

/* ------------------------------------------------- the squirrel finds it */
{
  /**
   * Tap the squirrel itself — its thought bubble is the visible offer. The
   * perch is recomputed from the same exported geometry the app draws with,
   * after a beat for the squirrel to ease back to its crown lookout.
   */
  await p.waitForTimeout(900);
  const spot = await p.evaluate(async () => {
    const { layoutOak, perchFor, geometryFor } = await import("/src/lib/oak.js");
    const s = await import("/src/lib/store.js");
    const cv = document.querySelector("canvas");
    const r = cv.getBoundingClientRect();
    const st = s.getState();
    const perch = perchFor(null, layoutOak(st.projects, st.tasks, {}), geometryFor(r.width, r.height));
    return { x: r.left + perch.x, y: r.top + perch.y - 14 };
  });
  await p.mouse.click(spot.x, spot.y);
  await p.waitForTimeout(400);
  t("tapping the squirrel under its thought bubble opens the finder",
    (await p.getByLabel("Ask the squirrel to find something").count()) === 1);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);

  await p.locator("canvas").first().focus();
  await p.keyboard.press("/");
  await p.waitForTimeout(400);
  const ask = p.getByLabel("Ask the squirrel to find something");
  t("\"/\" summons the squirrel", (await ask.count()) === 1);
  t("  ready to listen", await ask.evaluate((el) => el === document.activeElement));

  await ask.fill("deck");
  await p.waitForTimeout(400);
  const row = p.getByRole("button", { name: /Board deck/ });
  t("  it finds the acorn by a word", (await row.count()) === 1);
  t("  and names its branch", /Q3 launch/.test(await row.innerText().catch(() => "")));

  await p.keyboard.press("Enter");
  await p.waitForTimeout(500);
  t("  Enter carries you to that branch",
    /Q3 launch/.test(await panel(p).innerText().catch(() => "")));

  // Fallen acorns answer too — the squirrel knows the ground as well as the tree.
  await p.keyboard.press("/");
  await p.waitForTimeout(300);
  await p.getByLabel("Ask the squirrel to find something").fill("loose");
  await p.waitForTimeout(300);
  await p.keyboard.press("Enter");
  await p.waitForTimeout(500);
  const ground = await panel(p).innerText().catch(() => "");
  t("  even for what has fallen", /Unfiled/.test(ground) && /fallen — not on a branch yet/.test(ground),
    ground.slice(0, 120));

  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
}

/* ------------------------------------------------------- meaning is written */
{
  await p.locator("canvas").first().focus();
  await p.keyboard.press("ArrowRight");
  await p.waitForTimeout(400);
  const field = p.getByPlaceholder(/Why does this branch exist/);
  t("a branch asks what it is for", (await field.count()) === 1);
  await field.fill("Our first office of our own.");
  await p.keyboard.press("Tab");
  await p.waitForTimeout(500);

  const kept = await p.evaluate(async () =>
    (await import("/src/lib/store.js")).getState().projects.find((x) => x.name === "Munich lease")?.meaning);
  t("  and the answer reaches the store", kept === "Our first office of our own.", kept);

  await p.reload({ waitUntil: "networkidle" });
  await p.waitForTimeout(600);
  const still = await p.evaluate(async () =>
    (await import("/src/lib/store.js")).getState().projects.find((x) => x.name === "Munich lease")?.meaning);
  t("  and survives a reload", still === "Our first office of our own.", still);
}

/* ------------------------------------------------- the toggle is the theme */
await p.getByRole("button", { name: "Purpose", exact: true }).first().click();
await p.waitForTimeout(600);
{
  const before = await p.evaluate(() => document.documentElement.getAttribute("data-theme"));
  await p.getByRole("button", { name: "Toggle appearance" }).click();
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => document.documentElement.getAttribute("data-theme"));
  t("the room's toggle flips the whole app's theme", before !== after, `${before} → ${after}`);
  await p.getByRole("button", { name: "Toggle appearance" }).click();
  await p.waitForTimeout(300);
}

/* -------------------------------------------------------- the open door */
{
  await p.locator("canvas").first().focus();
  await p.keyboard.press("ArrowRight");
  await p.waitForTimeout(400);
  await p.getByRole("button", { name: /Open the whole branch/ }).click();
  await p.waitForTimeout(600);
  t("the branch opens into the real project",
    (await p.locator("header input").first().inputValue().catch(() => "")) === "Munich lease");
}

t("no page errors on desktop", errs.length === 0, errs.join(" · "));

/* ---------------------------------------------------------------- the phone */
const ph = await b.newPage({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  timezoneId: "America/New_York",
});
const perrs = [];
ph.on("pageerror", (e) => perrs.push(e.message));
await ph.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await ph.waitForTimeout(600);
// A new page is a new context: fresh storage, so onboarding is waiting and
// the store is empty. The phone walk needs both handled, like any first run.
await skipOnboarding(ph);
await ph.evaluate(async () => {
  const s = await import("/src/lib/store.js");
  const a = s.addProject({ name: "Munich lease" });
  s.addTask({ title: "Sign the lease", projectId: a.id, estimateMins: 60 });
});
await ph.waitForTimeout(500);
await ph.getByRole("button", { name: "Purpose", exact: true }).first().click();
await ph.waitForTimeout(800);
{
  const scroll = await ph.evaluate(() => {
    const el = document.scrollingElement;
    return { w: el.scrollWidth, c: el.clientWidth };
  });
  t("the phone never scrolls sideways", scroll.w <= scroll.c, JSON.stringify(scroll));
  t("  and draws the same room", (await ph.locator("canvas").count()) >= 1);

  await ph.locator("canvas").first().focus();
  await ph.keyboard.press("ArrowRight");
  await ph.waitForTimeout(500);
  t("  the reading panel rises from the bottom on a phone",
    (await panel(ph).count()) === 1);
  /**
   * Seven columns now share the bar with the fixed disc, and adding the tab
   * is exactly what clipped "Calendar" the first time — measured, not
   * eyeballed, because an ellipsis in a tab bar is invisible in a quick look
   * and screams native-quality failure on a real phone.
   */
  const clipped = await ph.evaluate(() =>
    [...document.querySelectorAll("nav span")]
      .filter((e) => e.textContent.trim() && e.offsetWidth && !e.querySelector("*"))
      .filter((e) => e.scrollWidth > e.offsetWidth + 1)
      .map((e) => e.textContent.trim()));
  t("  every tab label fits without clipping", clipped.length === 0, clipped.join(", "));
  t("no page errors on the phone", perrs.length === 0, perrs.join(" · "));
}

await b.close();
const failed = out.filter(([, ok]) => !ok);
console.log(`\nPurpose: ${out.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
