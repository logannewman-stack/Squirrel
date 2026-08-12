/**
 * Purpose, driven the way a person drives it.
 *
 * Needs the dev server on :5173.
 *
 * The strand itself is judged by eye and pinned by the math suite; what this
 * checks is the screen around it — that the tab exists and opens, that the
 * room renders without a single page error at desktop and phone size, that
 * the keyboard can walk the strand and read a gene, that writing a meaning
 * survives a reload, and that the light/dark toggle actually flips the app's
 * theme rather than merely repainting the canvas.
 */
import { chromium } from "playwright";
import { skipOnboarding } from "./onboard.mjs";

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
/** The reading panel, by its accessible name — the nav is an <aside> too. */
const strand = (page) => page.getByRole("complementary", { name: / strand$/ });
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

/* ------------------------------------------------------------ an empty helix */
await p.getByRole("button", { name: "Purpose", exact: true }).first().click();
await p.waitForTimeout(700);
{
  const body = await p.locator("body").innerText();
  t("the tab opens a room, not a report", (await p.locator("canvas").count()) >= 1);
  t("  and an unwritten helix says so", /unwritten/.test(body), body.slice(0, 200));
  t("  with a way to start", (await p.getByRole("button", { name: /Start the first strand/ }).count()) === 1);
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
  t("the header counts the strand", /2 strands|3 strands/.test(body), body.match(/\d+ strands?[^\n]*/)?.[0]);
  t("  in base pairs woven", /base pairs woven in/.test(body));
}

/* -------------------------------------------------- the keyboard walks it */
{
  await p.locator("canvas").first().focus();
  await p.keyboard.press("ArrowRight");
  await p.waitForTimeout(500);
  const panel = await strand(p).innerText().catch(() => "");
  t("an arrow key selects the first gene and opens its reading",
    /Munich lease/.test(panel), panel.slice(0, 120));
  t("  showing the weave count", /1 of 2 woven in/.test(panel), panel.match(/\d+ of \d+[^\n]*/)?.[0]);
  t("  the client and the money", /Hartmann/.test(panel) && /\$48k/.test(panel));
  t("  and each base pair by name", /Sign the lease/.test(panel) && /Survey/.test(panel));

  await p.keyboard.press("ArrowRight");
  await p.waitForTimeout(500);
  t("the next arrow steps along the strand",
    /Q3 launch/.test(await strand(p).innerText()));

  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
  t("Escape lets go", (await strand(p).count()) === 0);
}

/* ------------------------------------------------------- meaning is written */
{
  await p.locator("canvas").first().focus();
  await p.keyboard.press("ArrowRight");
  await p.waitForTimeout(400);
  const field = p.getByPlaceholder(/Why does this strand exist/);
  t("a gene asks what it is for", (await field.count()) === 1);
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
  await p.getByRole("button", { name: /Open the whole strand/ }).click();
  await p.waitForTimeout(600);
  t("the strand opens into the real project",
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
    (await strand(ph).count()) === 1);
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
