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

let failed = 0;
for (const [n, ok, d] of out) { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && d ? `  → ${d}` : ""}`); }
console.log(errs.length ? `page errors: ${errs.slice(0,3).join(" | ")}` : "page errors: none");
await b.close();
process.exit(failed || errs.length ? 1 : 0);
