/**
 * Asking Squirrel from outside Squirrel.
 *
 * Needs the dev server on :5173.
 *
 * Siri, the Shortcuts app, a widget, Spotlight, the Action button, a bookmark —
 * every one of them can produce a URL, so a URL is the whole interface and this
 * is the test for all of them at once. The native App Intent does nothing more
 * than build one of these and hand it over.
 *
 * The reload check at the end is the one that matters most. A deep link left in
 * the address bar re-runs on every refresh, and for an assistant that changes a
 * calendar that is not a cosmetic bug — it is the same meeting booked twice,
 * discovered by somebody else when they turn up to it.
 */
import { chromium } from "playwright";
import { skipOnboarding } from "./onboard.mjs";

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1280, height: 900 }, timezoneId: "America/New_York" });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));

const out = [];
const t = (name, ok, detail) => {
  out.push([name, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};
const store = (fn) => p.evaluate(async (src) => {
  const s = await import("/src/lib/store.js");
  return new Function("s", `return (${src})(s)`)(s);
}, fn.toString());

await p.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await p.evaluate(() => { localStorage.removeItem("squirrel.v2"); localStorage.removeItem("squirrel.theme"); });
await p.reload({ waitUntil: "networkidle" });
await skipOnboarding(p);
await store((s) => s.setSetting("confirm", false));

// ------------------------------------------------------- a sentence arrives
const ask = (q, from) =>
  p.goto(`http://localhost:5173/?ask=${encodeURIComponent(q)}${from ? `&from=${from}` : ""}`,
    { waitUntil: "networkidle" });

await ask("book a call with priya thursday at 2", "siri");
await p.waitForTimeout(2500);

// The Thursday coming, worked out from the real clock. Pinned to a literal
// date this passed for five days a week and failed on the sixth — the one
// where today *is* Thursday, and a bare weekday deliberately means the next
// one rather than this one. What is under test here is that a sentence in the
// address bar reaches the calendar; which Thursday a Thursday is has its own
// suite, and should not be re-litigated by a string.
const nextThursday = (() => {
  const d = new Date();
  d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7 || 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();

const events = await store((s) => s.getState().events.map((e) => `${e.title}|${e.start}`));
t("a sentence in the URL actually books the meeting", events.length === 1, JSON.stringify(events));
t("on the day and at the hour asked for",
  (events[0] || "").startsWith(`Call with Priya|${nextThursday}T14:00`),
  `${events[0]} (wanted ${nextThursday})`);
t("and she is shown doing it, not silently changing a calendar",
  (await p.getByRole("dialog").count()) === 1);
t("with the exchange in the conversation", (await store((s) => s.getState().chat.length)) >= 2);

// -------------------------------------------------------------- consumed
t("the request is stripped from the address bar",
  !/ask=/.test(p.url()), p.url());

/**
 * The expensive one. Without the strip above, this reload books a second
 * identical meeting and nobody finds out until two people arrive for it.
 */
await p.reload({ waitUntil: "networkidle" });
await p.waitForTimeout(2000);
t("and a reload does not book it again",
  (await store((s) => s.getState().events.length)) === 1,
  await store((s) => s.getState().events.length));

// ------------------------------------------------------------ asked twice
/**
 * Deliberately the same words. "Move it back" is exactly the sentence somebody
 * says again ten seconds later, and anything keyed on the text would swallow
 * the second one.
 */
await ask("add a task to call the bank", "shortcut");
await p.waitForTimeout(2200);
await ask("add a task to call the bank", "shortcut");
await p.waitForTimeout(2200);
t("the same request asked twice runs twice",
  (await store((s) => s.getState().tasks.length)) === 2,
  await store((s) => s.getState().tasks.length));

// -------------------------------------------------------------- questions
await ask("what does thursday look like");
await p.waitForTimeout(2200);
const chat = await store((s) => s.getState().chat.slice(-1)[0]?.text ?? "");
t("a question is answered rather than acted on", /Priya/.test(chat), chat.slice(0, 90));
t("and nothing was created by asking one",
  (await store((s) => s.getState().events.length)) === 1);

t("no page errors", errs.length === 0, errs.join(" · "));

await b.close();
const failed = out.filter(([, ok]) => !ok);
console.log(`\nSiri and shortcuts: ${out.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
