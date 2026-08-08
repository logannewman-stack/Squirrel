/**
 * Editing the calendar by touching it.
 *
 * Tapping an event used to raise a browser `confirm()` and delete the meeting
 * — one tap, one lost appointment, and no way back except asking the
 * assistant to undo it. These checks exist because that behaviour looked
 * deliberate in the code and was only obviously wrong from the outside.
 *
 * Needs the dev server on :5173.
 */
import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1200, height: 900 }, timezoneId: "America/New_York" });
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: "networkidle" });

await p.getByRole("button", { name: "Mr." }).click();
await p.getByPlaceholder("Surname").fill("Newman");
await p.getByRole("button", { name: "Continue" }).click();
// Onboarding is three steps now: name, working hours, then a send-off.
await p.getByRole("button", { name: "Continue" }).click();
await p.getByRole("button", { name: "Open Squirrel" }).click();

// Seed a meeting today so the day grid has something to tap.
await p.evaluate(async () => {
  const s = await import("/src/lib/store.js");
  const d = new Date(); d.setHours(14, 0, 0, 0);
  const e = new Date(d); e.setHours(15);
  const iso = (x) => `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}T${String(x.getHours()).padStart(2,"0")}:00:00`;
  s.addEvent({ title: "Board call", start: iso(d), end: iso(e), attendees: [{ name: "Priya" }] });
});
await p.reload({ waitUntil: "networkidle" });

const out = [];
const t = (n, ok, d) => out.push([n, !!ok, d || ""]);

await p.getByRole("navigation").getByRole("button", { name: "Calendar" }).click();
await p.getByRole("tab", { name: "Day" }).click();
await p.waitForTimeout(300);

await p.getByRole("button", { name: /Board call/ }).first().click();
const dlg = p.getByRole("dialog");
await dlg.waitFor({ state: "visible", timeout: 4000 });
t("tapping an event opens the editor", await dlg.isVisible());
t("and it did NOT delete it", (await p.evaluate(async () => (await import("/src/lib/store.js")).getState().events.length)) === 1);
t("prefilled with the title", (await dlg.locator('input[placeholder="Title"]').inputValue()) === "Board call");
t("and the attendees", (await dlg.locator('input[placeholder^="With"]').inputValue()) === "Priya");

// Reschedule with the shift buttons, then save.
await dlg.getByRole("button", { name: "+1h" }).click();
await dlg.getByRole("button", { name: "Save" }).click();
await p.waitForTimeout(300);
const moved = await p.evaluate(async () => (await import("/src/lib/store.js")).getState().events[0].start);
t("shifting an hour moves it", /T15:00/.test(moved), moved);
t("and still only one event", (await p.evaluate(async () => (await import("/src/lib/store.js")).getState().events.length)) === 1);

// Delete needs two taps.
await p.getByRole("button", { name: /Board call/ }).first().click();
await p.getByRole("dialog").waitFor({ state: "visible" });
await p.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
t("delete asks first", (await p.evaluate(async () => (await import("/src/lib/store.js")).getState().events.length)) === 1);
await p.getByRole("dialog").getByRole("button", { name: "Delete it" }).click();
await p.waitForTimeout(300);
t("and then removes it", (await p.evaluate(async () => (await import("/src/lib/store.js")).getState().events.length)) === 0);

// ---- the agenda, on a phone-width screen ----
// The reason the view exists: a week grid pushes half the week off the side of
// a phone, so the default scale has to be one that fits. Cleared to a fresh
// install so no earlier scale choice is remembered — the default is the thing
// being tested.
await p.setViewportSize({ width: 390, height: 844 });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: "networkidle" });
await p.getByRole("button", { name: "Mr." }).click();
await p.getByPlaceholder("Surname").fill("Newman");
await p.getByRole("button", { name: "Continue" }).click();
// Onboarding is three steps now: name, working hours, then a send-off.
await p.getByRole("button", { name: "Continue" }).click();
await p.getByRole("button", { name: "Open Squirrel" }).click();
await p.evaluate(async () => {
  const s = await import("/src/lib/store.js");
  const base = new Date(); base.setHours(0, 0, 0, 0);
  const iso = (x) => `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}T${String(x.getHours()).padStart(2,"0")}:00:00`;
  const mk = (off, h, title) => { const st = new Date(base); st.setDate(st.getDate()+off); st.setHours(h);
    const en = new Date(st); en.setHours(h+1); s.addEvent({ title, start: iso(st), end: iso(en) }); };
  mk(0, 9, "Exec staff"); mk(2, 11, "Design review"); mk(4, 15, "Late week sync");
});
await p.reload({ waitUntil: "networkidle" });
await p.getByRole("navigation").getByRole("button", { name: "Calendar" }).click();
await p.waitForTimeout(400);

t("the calendar opens on Agenda by default",
  await p.getByRole("tab", { name: "Agenda" }).getAttribute("aria-selected") === "true");

// Every meeting is on the list, including the one four days out that a week
// grid would have hidden off the right edge.
for (const title of ["Exec staff", "Design review", "Late week sync"]) {
  t(`${title} is on the agenda`, await p.getByText(title, { exact: true }).first().isVisible());
}

// The page itself must not scroll sideways — that is the whole failure mode.
const noSideScroll = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
t("the page does not scroll sideways", noSideScroll,
  await p.evaluate(() => `${document.documentElement.scrollWidth} vs ${window.innerWidth}`));

// And a meeting on the agenda opens the same editor a grid tap does.
await p.getByText("Design review", { exact: true }).first().click();
const agDlg = p.getByRole("dialog");
await agDlg.waitFor({ state: "visible", timeout: 4000 });
t("tapping an agenda row opens the editor",
  (await agDlg.locator('input[placeholder="Title"]').inputValue()) === "Design review");
await p.keyboard.press("Escape");

let failed = 0;
for (const [n, ok, d] of out) { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && d ? `  → ${d}` : ""}`); }
console.log(errs.length ? `page errors: ${errs.slice(0,3).join(" | ")}` : "page errors: none");
await b.close();
process.exit(failed || errs.length ? 1 : 0);
