/**
 * The things Settings *does*, as opposed to the places it goes.
 *
 * Needs the dev server on :5173.
 *
 * settings.e2e.mjs walks the navigation — five groups, two layouts, nothing
 * empty. This walks the controls inside them, and they are the ones with
 * consequences: a file that downloads empty, a restore that takes a file it
 * should have refused, a deletion control that renders nothing, an
 * introduction you cannot get back to. Every one of those is invisible from
 * the outside, and three of them are things Apple checks for.
 */
import { chromium } from "playwright";
import { skipOnboarding } from "./onboard.mjs";

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const out = [];
const t = (name, ok, detail) => {
  out.push([name, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

/** A fresh phone-sized page sitting in Settings, with something in the store. */
async function open(viewport = { width: 390, height: 844 }) {
  const p = await b.newPage({ viewport, timezoneId: "America/New_York", acceptDownloads: true });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && errs.push(`console: ${m.text()}`));
  await p.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  await p.evaluate(() => { localStorage.removeItem("squirrel.v2"); localStorage.removeItem("squirrel.theme"); });
  await p.reload({ waitUntil: "networkidle" });
  await skipOnboarding(p);
  await p.evaluate(async () => {
    const s = await import("/src/lib/store.js");
    s.addProject({ name: "Q3 launch" });
    s.addTask({ title: "Board deck", estimateMins: 120, due: "2026-08-14" });
    s.addEvent({
      title: "Call with Priya",
      start: "2026-08-13T15:00:00.000Z",
      end: "2026-08-13T15:30:00.000Z",
    });
  });
  await p.waitForTimeout(300);
  await p.getByRole("button", { name: "Settings" }).first().click();
  await p.waitForTimeout(400);
  return { p, errs };
}

const section = async (p, name) => {
  await p.getByRole("button", { name: new RegExp(`^${name}`) }).first().click();
  await p.waitForTimeout(400);
};
const backToIndex = async (p) => {
  await p.getByRole("button", { name: "Settings" }).first().click();
  await p.waitForTimeout(350);
};

/* ------------------------------------------------------------------ search */
/**
 * The word somebody has is almost never the word on the screen. Everything
 * here is a real thing a person types at a settings search box.
 */
{
  const { p, errs } = await open();
  const field = p.getByPlaceholder("Search settings");

  t("there is somewhere to type", (await field.count()) === 1);

  await field.fill("dark mode");
  await p.waitForTimeout(250);
  t("a name we never used finds the group that has it",
    await p.getByRole("button", { name: /^Appearance/ }).isVisible());
  t("and says which section it is in",
    /You/.test(await p.getByRole("button", { name: /^Appearance/ }).innerText()));
  t("the untouched settings are not still listed underneath",
    (await p.getByRole("button", { name: /^Assistant/ }).count()) === 0);

  await p.getByRole("button", { name: /^Appearance/ }).click();
  await p.waitForTimeout(700);
  t("tapping a result opens the section it lives in",
    /System follows your Mac or phone/.test(await p.locator("body").innerText()));
  t("and lands on the group rather than the top of the section",
    (await p.locator("#g-appearance").count()) === 1);

  await backToIndex(p);
  // People type sentences at a search box, and every word used to have to
  // match — which is how this returned nothing.
  await p.getByPlaceholder("Search settings").fill("cancel my subscription");
  await p.waitForTimeout(250);
  t("a whole sentence still finds the setting",
    await p.getByRole("button", { name: /^Plan/ }).isVisible());

  await p.getByPlaceholder("Search settings").fill("how do i delete my account");
  await p.waitForTimeout(250);
  t("and so does a question",
    await p.getByRole("button", { name: /Delete your account/ }).isVisible());

  await p.getByPlaceholder("Search settings").fill("zzzq");
  await p.waitForTimeout(250);
  t("nothing matching says so rather than showing an empty list",
    /Nothing here matches/.test(await p.locator("body").innerText()));

  await p.getByPlaceholder("Search settings").fill("");
  await p.waitForTimeout(250);
  t("clearing it puts the index back",
    await p.getByRole("button", { name: /^Assistant/ }).isVisible());

  await section(p, "Data");
  t("on a phone the field goes away once you are inside a section",
    (await p.getByPlaceholder("Search settings").count()) === 0);

  t("no page errors while searching", errs.length === 0, errs.join(" · "));
  await p.close();
}

/* ------------------------------------------------------------------ backup */
{
  const { p, errs } = await open();
  await section(p, "Data");

  t("there is a way to take a copy",
    await p.getByRole("button", { name: "Save a copy" }).isVisible());

  const dl = p.waitForEvent("download", { timeout: 5000 });
  await p.getByRole("button", { name: "Save a copy" }).click();
  const file = await dl;
  t("saving produces a file", Boolean(file), file);
  t("with a dated name, because there will be more than one",
    /^squirrel-\d{4}-\d{2}-\d{2}\.json$/.test(file.suggestedFilename()), file.suggestedFilename());

  const body = await (await import("node:fs/promises")).readFile(await file.path(), "utf8");
  const parsed = JSON.parse(body);
  t("and the file has the work in it, not just a header",
    parsed.tasks.length === 1 && parsed.projects.length === 1 && parsed.events.length === 1,
    JSON.stringify(parsed.counts));
  t("the paid tier is not something a file can grant", parsed.plan === undefined);

  // Refusing the wrong file matters more than accepting the right one: a
  // restore replaces everything, so a bad file taken on trust erases the lot.
  const input = p.locator('input[type="file"]');
  await input.setInputFiles({
    name: "holiday.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ app: "notion", pages: [] })),
  });
  await p.waitForTimeout(400);
  t("somebody else's file is refused, by name",
    /didn't come from Squirrel/.test(await p.locator("body").innerText()));

  await input.setInputFiles({
    name: "empty.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ app: "squirrel", format: 1, tasks: [] })),
  });
  await p.waitForTimeout(400);
  t("an empty backup is refused rather than obeyed",
    /nothing to restore/.test(await p.locator("body").innerText()));

  await input.setInputFiles({ name: file.suggestedFilename(), mimeType: "application/json", buffer: Buffer.from(body) });
  await p.waitForTimeout(400);
  const panel = await p.locator("body").innerText();
  t("a real backup is not restored on sight — it asks",
    /Replace everything with this file\?/.test(panel));
  /**
   * The two lines that catch the realistic mistake. Almost every bad restore
   * is somebody picking the wrong file, and seeing what is in it beside what
   * is here now catches that before it happens rather than after.
   */
  t("showing what is in the file", /In it\s*\n?\s*1 project, 1 task and 1 meeting/.test(panel), panel.slice(0, 400));
  t("beside what is here now", /Here now/.test(panel));
  t("and saying plainly that it cannot be undone", /can't be undone/.test(panel));
  t("with a way out that is not the destructive one",
    await p.getByRole("button", { name: "Cancel" }).isVisible());

  await p.getByRole("button", { name: "Cancel" }).click();
  await p.waitForTimeout(250);
  t("cancelling changes nothing",
    (await p.evaluate(async () => (await import("/src/lib/store.js")).getState().tasks.length)) === 1);

  t("no page errors around backup", errs.length === 0, errs.join(" · "));
  await p.close();
}

/* -------------------------------------------------------- restoring for real */
/**
 * The round trip, which is the only proof the file is worth keeping. Wipe the
 * device, hand it the file, and the week comes back.
 */
{
  const { p, errs } = await open();
  await section(p, "Data");
  const dl = p.waitForEvent("download", { timeout: 5000 });
  await p.getByRole("button", { name: "Save a copy" }).click();
  const file = await dl;
  const body = await (await import("node:fs/promises")).readFile(await file.path(), "utf8");

  // A new phone, properly: nothing in the store and the introduction in front
  // of you, which is exactly where somebody holding a backup file arrives.
  await p.evaluate(async () => (await import("/src/lib/store.js")).resetAll());
  await p.reload({ waitUntil: "networkidle" });
  await skipOnboarding(p);
  await p.waitForTimeout(300);
  t("the device is empty before restoring",
    (await p.evaluate(async () => (await import("/src/lib/store.js")).getState().tasks.length)) === 0);

  await p.getByRole("button", { name: "Settings" }).first().click();
  await p.waitForTimeout(400);
  await section(p, "Data");
  await p.locator('input[type="file"]').setInputFiles({
    name: file.suggestedFilename(), mimeType: "application/json", buffer: Buffer.from(body),
  });
  await p.waitForTimeout(400);
  await p.getByRole("button", { name: "Replace everything" }).click();
  await p.waitForTimeout(1400);

  const back = await p.evaluate(async () => {
    const s = await import("/src/lib/store.js");
    const st = s.getState();
    return {
      tasks: st.tasks.map((x) => x.title),
      projects: st.projects.map((x) => x.name),
      events: st.events.map((x) => x.title),
      plan: st.plan,
      onboarded: st.settings?.onboarded,
    };
  });
  t("the tasks come back", back.tasks.includes("Board deck"), JSON.stringify(back.tasks));
  t("and the projects", back.projects.includes("Q3 launch"), JSON.stringify(back.projects));
  t("and the meetings", back.events.includes("Call with Priya"), JSON.stringify(back.events));
  t("a restore does not put you back through the introduction", back.onboarded === true);
  t("the app is on a real screen afterwards, not a blank one",
    /Board deck/.test(await p.locator("body").innerText()));

  /**
   * The tier is a server fact, so a restore has to keep the device's and
   * ignore anything the file claims — otherwise upgrading is a text editor
   * away. Checked against the store directly: this build has no backend, and
   * App.jsx unlocks everything when there is none, which would mask it.
   */
  const tier = await p.evaluate(async () => {
    const s = await import("/src/lib/store.js");
    s.setPlanTier("free");
    s.restoreAll({ tasks: [{ id: "x", title: "smuggled" }], settings: {}, plan: "studio" });
    return s.getState().plan;
  });
  t("and a file cannot hand itself a paid tier", tier === "free", tier);

  t("no page errors around restore", errs.length === 0, errs.join(" · "));
  await p.close();
}

/* ------------------------------------------------------ deletion and the law */
{
  const { p, errs } = await open();
  await section(p, "Data");
  const data = await p.locator("body").innerText();

  /**
   * This used to render nothing at all when signed out — which in a build with
   * no backend is always. A reviewer who cannot find the control records that
   * it is not there.
   */
  t("the deletion section says something even with no account",
    /nothing on a server to delete/.test(data), data.slice(-500));
  t("and points at what does clear this device",
    /Erase everything/.test(data));
  t("the version is on screen, because it is the first question of any bug report",
    /Version/.test(data) && /\d+\.\d+\.\d+/.test(data));

  t("no page errors", errs.length === 0, errs.join(" · "));
  await p.close();
}

/* ------------------------------------------------------------- the introduction */
{
  const { p, errs } = await open();
  await section(p, "You");
  t("the introduction can be asked for again",
    await p.getByRole("button", { name: /Play it again/ }).isVisible());

  await p.getByRole("button", { name: /Play it again/ }).click();
  await p.waitForTimeout(700);
  t("and it actually plays",
    await p.getByText("How should I address you?").isVisible());

  /**
   * "Show me that again" is not a destructive request, and an introduction
   * that wiped the week to replay itself would be the single most surprising
   * thing in the app.
   */
  const kept = await p.evaluate(async () => {
    const st = (await import("/src/lib/store.js")).getState();
    return { tasks: st.tasks.length, projects: st.projects.length };
  });
  t("without destroying anything you made", kept.tasks === 1 && kept.projects === 1, JSON.stringify(kept));

  t("no page errors", errs.length === 0, errs.join(" · "));
  await p.close();
}

/* ------------------------------------------------------------ siri phrases */
{
  const { p, errs } = await open();
  await section(p, "Connections");
  const conn = await p.locator("body").innerText();

  t("the shortcuts have a home in Settings", /Siri & Shortcuts/.test(conn));

  // Every phrase from the catalogue is on the screen. iOS registers these at
  // install and mentions them nowhere, so if this screen does not say them,
  // nothing does.
  const { SHORTCUTS } = await import("../src/lib/shortcuts.js");
  for (const s of SHORTCUTS) {
    t(`  ${s.title} is listed`, conn.includes(s.title));
    for (const ex of s.examples) {
      t(`  “${ex}”`, conn.includes(ex), conn.slice(0, 300));
    }
  }
  t("and the one that answers without opening the app says so",
    /without opening the app/.test(conn));

  // On the web there is no App Intent to register, and saying nothing would
  // read as the feature being absent rather than being elsewhere.
  t("a browser is told where these live and what works here instead",
    /iPhone and Mac apps/.test(conn) && /ask=/.test(conn), conn.slice(0, 200));

  t("no page errors", errs.length === 0, errs.join(" · "));
  await p.close();
}

await b.close();
const failed = out.filter(([, ok]) => !ok);
console.log(`\nSettings actions: ${out.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
