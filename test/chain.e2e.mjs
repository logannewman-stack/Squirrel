/**
 * Project → task → calendar, walked the way a person walks it.
 *
 * Needs the dev server on :5173.
 *
 * The app was asked to do one thing above all others: take a piece of work
 * with a duration, a rank and a deadline, decide when it will actually get
 * done, and put that on the calendar. It did. A browser walk of the chain
 * found the decision reaching the store and no screen at all:
 *
 *   store   blocks: [{ day: "2026-08-12", start: "09:00", mins: 120 }]
 *   screen  "Draft the lease redlines   120m   3d"
 *
 * Two numbers, neither of them the answer, on the screen where the person had
 * just made the decision that triggered it. Today's panel, on the same run,
 * read "Nothing due and nothing planned. Add work with a deadline and an
 * estimate, and it lays itself out." — instructing somebody to do the thing
 * they had that second finished doing. And the calendar, which did draw the
 * block, drew it as an inert `<div>`: twenty elements mentioning the task and
 * not one of them pressable, so the screen showing where the week went was the
 * one screen you could not act from.
 *
 * None of that was a planning bug. `distribute` was right every time. What was
 * missing was any way for a screen to ask what it had decided — so this walks
 * the whole chain and checks the app says so at every step.
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

await p.evaluate(async () => {
  const s = await import("/src/lib/store.js");
  s.addProject({ name: "Munich lease", client: "Hartmann", value: 48000 });
  /**
   * An afternoon meeting, so the ordering check further down has teeth.
   *
   * The planner fills mornings first, so a two o'clock meeting has to sort
   * *below* the focus work booked before it. Under the old two-list render —
   * every meeting, then every block — it sorted above, which is the regression
   * this fixture exists to catch. Without it the day holds one time and any
   * ordering is trivially correct.
   *
   * On the *next full working day*, not today, and that is the point rather
   * than a detail. The planner only places work in the hours that are left, so
   * a suite run at half past two finds the morning already gone: the day holds
   * the two o'clock meeting and nothing else, the ordering it is checking
   * becomes trivially true, and the guard below is what notices. Run at ten in
   * the morning the same fixture passes. A test that depends on when it is run
   * is a test that will fail on somebody else's afternoon and be called flaky.
   */
  const d = new Date();
  do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
  const at = (h) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getDate()).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00`;
  s.addEvent({ title: "Partners sync", start: at(14), end: at(15) });
});
await p.waitForTimeout(500);
await p.getByRole("button", { name: "Projects", exact: true }).first().click();
await p.waitForTimeout(600);
await p.getByRole("button", { name: /Munich lease/i }).first().click();
await p.waitForTimeout(600);

/* -------------------------------------------------- the decision, and the answer */
/** Exactly the form the app offers: how long, how much it matters, by when. */
await p.getByPlaceholder("Add work…").fill("Draft the lease redlines");
await p.getByRole("button", { name: "2h", exact: true }).first().click();
await p.getByRole("button", { name: "high", exact: true }).first().click();
await p.getByRole("button", { name: "Next week", exact: true }).first().click();
await p.getByPlaceholder("Add work…").press("Enter");
await p.waitForTimeout(900);

const booked = await p.evaluate(async () => {
  const s = await import("/src/lib/store.js");
  const st = s.getState();
  const task = st.tasks.find((x) => x.title === "Draft the lease redlines");
  return {
    filed: task?.projectId === st.projects[0]?.id,
    blocks: (st.blocks || []).filter((x) => x.taskId === task?.id),
  };
});
t("work added inside a project is filed to it", booked.filed);
t("  and the planner books it without being asked", booked.blocks.length > 0,
  JSON.stringify(booked.blocks));

{
  const screen = await p.locator("body").innerText();
  /**
   * The sentence that was missing. It has to name the task: by the time it is
   * read the field is empty and the row is one of twelve.
   */
  t("the screen says when the work will happen",
    /Draft the lease redlines\s*—\s*\w+/.test(screen),
    screen.match(/Draft the lease redlines[^\n]*\n[^\n]*/)?.[0]);
  t("  naming a real day and a real time",
    /(Today|Tomorrow|Mon|Tue|Wed|Thu|Fri|Sat|Sun|\d+ \w+)[^\n]*\d+:\d\d/.test(screen),
    screen.match(/—[^\n]*/)?.[0]);

  // "120m" was the app's own arithmetic read back at somebody, on the one
  // surface where every other number is already in hours.
  t("  and the row speaks in hours, not raw minutes",
    /\b2h\b/.test(screen) && !/\b120m\b/.test(screen),
    screen.match(/\b(?:2h|120m)\b/g)?.join(" · "));

  t("  the project says when the whole thing lands",
    /booked, finishing/.test(screen), screen.match(/[^\n]*finishing[^\n]*/)?.[0]);
}

/* --------------------------------------------------------- and on every screen */
await p.getByRole("button", { name: "Calendar", exact: true }).first().click();
await p.waitForTimeout(900);
{
  const cal = await p.locator("body").innerText();
  t("the calendar draws the block", /Draft the lease redlines/.test(cal));
  /**
   * A week of bare task titles hides the only grouping anybody reports on.
   * "Which deal ate Thursday" is the question a calendar of work is for.
   */
  t("  and names the deal the hour belongs to",
    /of focus · Munich lease/.test(cal), cal.match(/[^\n]*of focus[^\n]*/)?.[0]);

  /**
   * And in time order. Meetings and planned work were two lists rendered one
   * after the other, each sorted only within itself — so a day with a ten
   * o'clock meeting and nine o'clock focus work put the meeting on top. An
   * agenda is read top to bottom as a sequence, and this one silently was not
   * one.
   */
  // Scoped to the day the fixture built, found by the meeting on it rather
  // than by position. The agenda stacks a section per day, so reading every
  // `.num` on the page walks into the next day's nine o'clock — which is not
  // out of order, it is a different day — and counting sections from the top
  // assumes which day the planner started on.
  const times = (await p.locator("section").filter({ hasText: "Partners sync" })
    .first().locator("li .num").allInnerTexts())
    .map((x) => x.trim())
    .filter((x) => /^\d+:\d\d\s*(AM|PM)$/i.test(x))
    .map((x) => {
      const [, h, m, ap] = x.match(/^(\d+):(\d\d)\s*(AM|PM)$/i);
      return ((Number(h) % 12) + (/pm/i.test(ap) ? 12 : 0)) * 60 + Number(m);
    });
  t("  the fixture puts more than one hour on the day", new Set(times).size > 1, times.join(" "));
  t("  and the day runs in time order", times.every((v, i) => i === 0 || times[i - 1] <= v),
    times.join(" "));

  const pressable = await p.locator("button", { hasText: /redlines/i }).count();
  t("  and the block is pressable, not an inert div", pressable > 0, `${pressable} buttons`);

  await p.locator("button", { hasText: /redlines/i }).first().click();
  await p.waitForTimeout(800);
  /**
   * Checked through the field rather than the page text: the project's name is
   * an editable `<input>` on this screen, and `innerText` never returns the
   * value of an input — so matching the body would fail on a screen that is
   * plainly showing the right project.
   */
  t("  pressing it goes to the project the work is for",
    (await p.locator("header input").first().inputValue()) === "Munich lease",
    await p.locator("header input").first().inputValue());
}

/* ----------------------------------------------- the sentence that told you to */
/**
 * The plate is empty when the work is booked for a later day, and that is not
 * the same as an empty plan. It used to say "Add work with a deadline and an
 * estimate, and it lays itself out" — to somebody who just had.
 */
await p.getByRole("button", { name: "Today", exact: true }).first().click();
await p.waitForTimeout(900);
{
  const today = await p.locator("body").innerText();
  const emptyPlate = /Nothing due and nothing planned/.test(today);
  const plannedAhead = await p.evaluate(async () =>
    (await import("/src/lib/store.js")).getState().blocks.length > 0);

  t("Today never claims an empty plan while work is booked",
    !(emptyPlate && plannedAhead),
    today.match(/[^\n]*Nothing[^\n]*/)?.[0]);

  if (/Nothing left today/.test(today)) {
    t("  it says what is next instead", /Next is[^\n]*\d+:\d\d/.test(today),
      today.match(/Nothing left today[^\n]*/)?.[0]);
  } else {
    t("  (there was work on the plate today, which is also an answer)",
      /Draft the lease redlines/.test(today));
  }
}

/* ------------------------------------------------------- and when it cannot fit */
/**
 * The other half of the same promise. A task both partly booked and short was
 * the dangerous case: reading the bookings first, fifty hours due Thursday
 * reported "10h across 2 sittings" — true, reassuring, and missing the only
 * part that mattered.
 */
{
  await p.evaluate(async () => {
    const s = await import("/src/lib/store.js");
    const q = s.getState().projects[0];
    const due = new Date();
    due.setDate(due.getDate() + 2);
    s.addTask({
      title: "Impossible redline review", projectId: q.id, estimateMins: 3000,
      due: due.toISOString().slice(0, 10), priority: "critical",
    });
  });
  await p.waitForTimeout(900);
  await p.getByRole("button", { name: "Projects", exact: true }).first().click();
  await p.waitForTimeout(500);
  await p.getByRole("button", { name: /Munich lease/i }).first().click();
  await p.waitForTimeout(800);

  const screen = await p.locator("body").innerText();
  t("work that cannot fit says so rather than reporting the part that does",
    /short/.test(screen), screen.match(/[^\n]*short[^\n]*/)?.[0]);
  t("  and the project reports it over its own finish date",
    /won't fit|short/i.test(screen), screen.match(/[^\n]*(?:fit|short)[^\n]*/)?.[0]);
}

t("no page errors", errs.length === 0, errs.join(" · "));

await b.close();
const failed = out.filter(([, ok]) => !ok);
console.log(`\nChain: ${out.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
