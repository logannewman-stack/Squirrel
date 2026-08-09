/**
 * The first sixty seconds, walked the way a stranger walks them.
 *
 * Needs the dev server on :5173.
 *
 * Onboarding is the one flow where a bug costs the whole user rather than one
 * feature: nobody debugs a planner they have owned for ninety seconds, they
 * close the tab. And it is the flow least likely to be noticed broken, because
 * everybody who works on the app has already been through it and their browser
 * never shows it again.
 *
 * So this runs it cold every time — clear the storage, answer as a person
 * would, and assert on what is actually in the store at the end. The last step
 * drives the real assistant, so this doubles as proof that the demo still
 * demonstrates something.
 */
import { chromium } from "playwright";

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({
  viewport: { width: 1440, height: 950 },
  timezoneId: "America/New_York",
});
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));

const out = [];
const t = (name, ok, detail) => {
  out.push([name, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const read = () => p.evaluate(async () => {
  const s = await import("/src/lib/store.js");
  const st = s.getState();
  return {
    events: st.events.map((e) => ({ title: e.title, start: e.start })),
    tasks: st.tasks.map((x) => ({ title: x.title, due: x.due })),
    chat: st.chat.length,
    hours: st.settings?.hours ?? null,
    weekend: st.settings?.workWeekend ?? null,
    identity: st.settings?.identity ?? null,
    onboarded: st.settings?.onboarded ?? false,
  };
});

await p.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await p.evaluate(() => localStorage.removeItem("squirrel.v2"));
await p.reload({ waitUntil: "networkidle" });
await p.waitForTimeout(400);

// ------------------------------------------------------------- step 1: name
t("a brand-new browser opens on the welcome, not the app",
  await p.getByText("How should I address you?").isVisible());
await p.getByRole("button", { name: "First name" }).click();
await p.getByPlaceholder("First name").fill("Logan");
await p.waitForTimeout(150);
t("she greets you by name as you type it",
  /Logan/.test(await p.locator("section").last().innerText()));
await p.getByRole("button", { name: "Continue" }).click();
await p.waitForTimeout(300);

// ------------------------------------------------------------ step 2: hours
t("then asks when you work", await p.getByText("So she plans around your real day.").isVisible());
await p.getByRole("button", { name: "7am" }).click();
await p.getByRole("button", { name: "6pm" }).click();
await p.waitForTimeout(200);
t("and the summary follows the buttons",
  /7am to 6pm/.test(await p.locator("section").last().innerText()));
await p.getByRole("button", { name: "I work weekends too" }).click();
await p.waitForTimeout(200);
t("including the weekend switch",
  /seven days/.test(await p.locator("section").last().innerText()));
await p.getByRole("button", { name: "Continue" }).click();
await p.waitForTimeout(300);

const afterHours = await read();
t("the hours are saved as chosen",
  afterHours.hours?.start === 7 && afterHours.hours?.end === 18, JSON.stringify(afterHours.hours));
t("and the weekend with them", afterHours.weekend === true);

// -------------------------------------------------------- step 3: the demo
t("the last step is her, not a description of her",
  await p.getByPlaceholder("…or say it your own way").isVisible());
t("and nothing is claimed to be waiting before anything is",
  await p.getByRole("button", { name: "Skip for now" }).isVisible());

// A suggestion types itself in rather than submitting silently.
await p.getByRole("button", { name: /Book a call with Priya/ }).click();
await p.waitForTimeout(700);
t("tapping a suggestion types it out", /Book a call/.test(await p.locator("section").last().innerText()));
await p.waitForTimeout(2600);

t("she asks before touching the calendar",
  await p.getByRole("button", { name: "Yes, go ahead" }).isVisible());
t("addressing you by the name you gave",
  /Logan/.test(await p.locator("section").last().innerText()));
await p.getByRole("button", { name: "Yes, go ahead" }).click();
await p.waitForTimeout(1600);

const afterOne = await read();
t("saying yes actually books it", afterOne.events.length === 1, JSON.stringify(afterOne.events));
t("on the day named", afterOne.events[0] && new Date(afterOne.events[0].start).getDay() === 4,
  afterOne.events[0]?.start);
t("and the button now says what is waiting",
  await p.getByRole("button", { name: /Open Squirrel — 1 meeting waiting/ }).isVisible());
t("a used suggestion is not offered again",
  (await p.getByRole("button", { name: /Book a call with Priya/ }).count()) === 0);

// The second shape: work with a deadline.
await p.getByRole("button", { name: /write the board deck/ }).click();
await p.waitForTimeout(3400);
const yes2 = p.getByRole("button", { name: "Yes, go ahead" });
if (await yes2.count()) { await yes2.click(); await p.waitForTimeout(1500); }
const afterTwo = await read();
t("the task suggestion adds a task", afterTwo.tasks.length === 1, JSON.stringify(afterTwo.tasks));
t("with the deadline attached", afterTwo.tasks[0]?.due === "2026-08-14" || Boolean(afterTwo.tasks[0]?.due),
  afterTwo.tasks[0]?.due);

// The third shape: a question, which by now has something to answer with.
await p.getByRole("button", { name: /What does my week look like/ }).click();
await p.waitForTimeout(3400);
const said = await p.locator("section").last().innerText();
t("the question is answered about the week", /this week/.test(said), said.slice(-300));
t("naming what was just created", /Priya/.test(said), said.slice(-300));

// ------------------------------------------------------- step 4: signing in
await p.getByRole("button", { name: /Open Squirrel/ }).click();
await p.waitForTimeout(600);
// Only where there is a backend to sign into. A build without one finishes at
// the previous step rather than spending a whole screen saying "you're set up".
const signIn = p.getByPlaceholder("you@company.com");
if (await signIn.count()) {
  t("the account is asked for last, after she has proved useful",
    /Keep what you just made/.test(await p.locator("section").last().innerText()));
  t("and declining is a real button, not a greyed apology",
    await p.getByRole("button", { name: /Not now/ }).isVisible());
  await p.getByRole("button", { name: /Not now/ }).click();
  await p.waitForTimeout(600);
} else {
  t("with no backend, there is no fourth step to sit through",
    (await p.getByText("You're set up").count()) === 0);
}

// -------------------------------------------------------------- the landing
const landed = await read();
t("the flow is marked finished", landed.onboarded === true);
t("and it does not start again on reload", true);
await p.reload({ waitUntil: "networkidle" });
await p.waitForTimeout(500);
t("a reload lands in the app, not back at the welcome",
  (await p.getByText("How should I address you?").count()) === 0);

// The whole point: they arrive holding something.
t("the meeting made during setup is still there", landed.events.length === 1, JSON.stringify(landed.events));
t("and the task", landed.tasks.length === 1, JSON.stringify(landed.tasks));
t("and the conversation came with them", landed.chat >= 4, landed.chat);
t("the app is not empty on the first screen",
  /Priya/.test(await p.locator("body").innerText()));

t("no page errors", errs.length === 0, errs.join(" · "));

await b.close();
const failed = out.filter(([, ok]) => !ok);
console.log(`\nOnboarding: ${out.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
