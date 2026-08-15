/**
 * The system, flowing as one thing.
 *
 * Needs the dev server on :5173.
 *
 * The planner computes; the screens show; the advice acts. This drives the
 * loop end to end: an overloaded week surfaces on the Purpose dock, its
 * footer walks to Today, Today's banner names the fix and applying it is one
 * tap, and the same fix lives on the acorn's own card — every step against
 * the one real store, with the plan reflowing in between.
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

await p.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: "networkidle" });
await skipOnboarding(p, { coach: true });

/* ------------------------------------------------ the first three acorns */
{
  const card = p.getByText("What needs doing this week?");
  t("a fresh app opens asking for the first three", (await card.count()) === 1);
  await p.getByLabel("Name the first thing").fill("Call the bank");
  await p.getByRole("button", { name: "1h", exact: true }).click();
  await p.getByRole("button", { name: "Tomorrow", exact: true }).click();
  await p.getByRole("button", { name: "Plant it", exact: true }).click();
  await p.waitForTimeout(700);
  const made = await p.evaluate(async () => {
    const s = await import("/src/lib/store.js");
    return s.getState().tasks.find((x) => x.title === "Call the bank");
  });
  t("  planting writes a real task — size and date included",
    Boolean(made) && made.estimateMins === 60 && Boolean(made.due), JSON.stringify(made));
  t("  and the guide talks the plan forward",
    /Two more/i.test(await p.locator("body").innerText()));
  await p.getByRole("button", { name: /my own way/i }).click();
  await p.waitForTimeout(300);
  t("  stepping out is one tap, and it stays out", (await card.count()) === 0);
}

/* ------------------------------------------------- an overloaded week */
await p.evaluate(async () => {
  const s = await import("/src/lib/store.js");
  const day = (off) => { const d = new Date(); d.setDate(d.getDate() + off); return d.toISOString().slice(0, 10); };
  const q = s.addProject({ name: "Q3 launch" });
  s.addTask({ title: "Everything at once", projectId: q.id, estimateMins: 1200, due: day(2) });
  s.addTask({ title: "Also enormous", projectId: q.id, estimateMins: 900, due: day(2) });
  s.addTask({ title: "Small and fine", projectId: q.id, estimateMins: 30, due: day(6) });
});
await p.waitForTimeout(900);
{
  const shorts = await p.evaluate(async () =>
    (await import("/src/lib/store.js")).getState().shortfalls.length);
  t("an overloaded week produces shortfalls, automatically", shorts >= 1, shorts);
}

/* --------------------------- the dock's warning walks to Today's details */
await p.getByRole("button", { name: "Purpose", exact: true }).first().click();
await p.waitForTimeout(900);
{
  await p.getByRole("button", { name: /today — /i }).click();
  await p.waitForTimeout(400);
  const card = p.getByRole("complementary", { name: / routed$/i });
  t("the day card carries the warning", /don't fit|doesn't fit/.test(await card.innerText().catch(() => "")));
  await card.getByRole("button", { name: "Today has the details" }).click();
  await p.waitForTimeout(600);
  const body = await p.locator("body").innerText();
  t("  and its footer walks straight to Today", /THE DAY|The day/i.test(body) && /do(es)? not fit/i.test(body),
    body.slice(0, 160));
}

/* ------------------------------------ the banner's advice is one tap */
{
  const before = await p.evaluate(async () =>
    (await import("/src/lib/store.js")).getState().tasks.find((x) => x.title === "Everything at once")?.due);
  const fix = p.getByRole("button", { name: /Move the deadline to .* it fits/ }).first();
  t("the banner offers the computed fix as a button", (await fix.count()) >= 1);
  await fix.click();
  await p.waitForTimeout(900);
  const after = await p.evaluate(async () =>
    (await import("/src/lib/store.js")).getState().tasks.find((x) => x.title === "Everything at once")?.due);
  t("  one tap moves the deadline to the date it fits", after && after !== before, `${before} → ${after}`);
  const still = await p.evaluate(async () => {
    const s = await import("/src/lib/store.js");
    const id = s.getState().tasks.find((x) => x.title === "Everything at once")?.id;
    return s.getState().shortfalls.some((x) => x.taskId === id);
  });
  t("  and the plan reflows — that task is no longer short", still === false);
}

/* ------------------------------- the same fix lives on the acorn card */
await p.getByRole("button", { name: "Purpose", exact: true }).first().click();
await p.waitForTimeout(700);
{
  await p.locator("canvas").first().focus();
  await p.keyboard.press("/");
  await p.waitForTimeout(300);
  await p.getByLabel("Ask the squirrel to find something").fill("enormous");
  await p.waitForTimeout(300);
  await p.keyboard.press("Enter");
  await p.waitForTimeout(500);
  const acorn = p.getByRole("complementary", { name: / acorn$/ });
  t("the overloaded acorn admits it on its card",
    /doesn't fit/.test(await acorn.innerText().catch(() => "")));
  await acorn.getByRole("button", { name: /move the deadline to/i }).click();
  await p.waitForTimeout(900);
  const done = await acorn.innerText().catch(() => "");
  t("  one tap later it is routed instead",
    /routed /i.test(done) && !/doesn't fit/.test(done), done.slice(0, 160));
}

/* ------------------------------------ drag a block, and the plan follows */
{
  /**
   * The overload above has done its job; leaving it in place makes this
   * section depend on how much of the working day happens to be left when
   * the suite runs — twenty hours of work will eat every hour it can reach,
   * and the small task this drags may or may not get one. So the week is
   * cleared to a single block first. A drag test should fail when dragging
   * breaks, not when it runs after lunch.
   */
  await p.evaluate(async () => {
    const s = await import("/src/lib/store.js");
    for (const task of s.getState().tasks) s.deleteTask(task.id);
    const day = (off) => { const d = new Date(); d.setDate(d.getDate() + off); return d.toISOString().slice(0, 10); };
    s.addTask({ title: "Draft the agenda", estimateMins: 30, due: day(4) });
  });
  await p.waitForTimeout(900);
}

await p.getByRole("button", { name: "Calendar", exact: true }).first().click();
await p.waitForTimeout(500);
{
  await p.getByRole("tab", { name: "Week" }).click();
  await p.waitForTimeout(700);
  const block = p.locator('button[title*="Draft the agenda"]').first();

  /**
   * Walk forward to the week the work actually landed on.
   *
   * The grid opens on the week containing today, and the planner only uses
   * working days that have not happened yet — so run this on a Saturday and
   * every hour it could possibly use is in *next* week's grid. The block is
   * correctly scheduled and correctly not on screen, and a test that assumes
   * those are the same week fails every weekend for no reason at all.
   *
   * Two hops covers any day of the week and stays bounded, so work that never
   * got scheduled at all still fails here instead of looping.
   */
  for (let hop = 0; hop < 2 && (await block.count()) === 0; hop++) {
    await p.getByRole("button", { name: "Next week" }).click();
    await p.waitForTimeout(500);
  }
  t("the routed block stands on the week grid", (await block.count()) === 1);

  await block.scrollIntoViewIfNeeded();
  const box = await block.boundingBox();
  const col = await block.evaluate((el) => {
    const r = el.parentElement.getBoundingClientRect();
    return { x: r.x, w: r.width };
  });
  // Drag one column to the right and two hours down.
  await p.mouse.move(box.x + box.width / 2, box.y + 6);
  await p.mouse.down();
  await p.mouse.move(col.x + col.w * 1.5, box.y + 6 + 104, { steps: 10 });
  await p.mouse.up();
  await p.waitForTimeout(900);

  const pinned = await p.evaluate(async () => {
    const s = await import("/src/lib/store.js");
    const me = s.getState().tasks.find((x) => x.title === "Draft the agenda");
    const mine = s.getState().blocks.filter((b) => b.taskId === me.id);
    return {
      pinDay: me.pinDay, pinTime: me.pinTime,
      onDay: mine.length > 0 && mine.every((b) => b.day === me.pinDay),
      atTime: mine.some((b) => (b.start || "").includes(`T${me.pinTime}`)),
    };
  });
  t("dropping a block pins it to that day and minute",
    Boolean(pinned.pinDay) && /^\d{2}:\d{2}$/.test(pinned.pinTime || ""), JSON.stringify(pinned));
  t("  and the router re-plans it exactly there",
    pinned.onDay && pinned.atTime, JSON.stringify(pinned));
}

t("no page errors through the whole loop", errs.length === 0, errs.join(" · "));

await b.close();
const failed = out.filter(([, ok]) => !ok);
console.log(`\nFlow: ${out.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
