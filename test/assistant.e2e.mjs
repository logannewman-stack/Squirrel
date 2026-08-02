/**
 * End-to-end assistant checks against the real store.
 *
 * Needs the dev server on :5173. Runs the actual UI path — type a command,
 * confirm the underlying data changed.
 */
import { chromium } from "playwright";

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));

await p.goto("http://localhost:5173/", { waitUntil: "networkidle" });

const results = await p.evaluate(async () => {
  const store = await import("/src/lib/store.js");
  const { ask } = await import("/src/lib/nlu/index.js");
  const out = [];
  const t = (name, ok, detail) => out.push([name, !!ok, detail || ""]);

  localStorage.removeItem("squirrel.v2");

  // Fixed clock so weekday maths is deterministic: Sunday 2 Aug 2026, 10:00.
  const NOW = new Date(2026, 7, 2, 10, 0, 0);
  const iso = (y, mo, d, h, mi = 0) =>
    `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00`;

  const proj = store.addProject({ name: "Series B raise" });
  store.addEvent({ title: "Meridian partner call", start: iso(2026, 8, 3, 15), end: iso(2026, 8, 3, 16) });
  store.addEvent({ title: "Exec staff", start: iso(2026, 8, 3, 9), end: iso(2026, 8, 3, 10) });
  store.addTask({ projectId: proj.id, title: "Review revised term sheet", estimateMins: 45 });

  const S = () => store.getState();

  // 1. The headline command.
  let r = ask("reschedule my 3pm Monday to Wednesday at 2", S(), { now: NOW });
  let ev = S().events.find((e) => e.title === "Meridian partner call");
  t("moves the right event to the right slot",
    ev.start === "2026-08-05T14:00:00", ev.start);
  t("preserves the hour-long duration",
    (new Date(ev.end) - new Date(ev.start)) / 60000 === 60);
  t("reports the move", /moved/i.test(r.text), r.text);

  // 2. Ambiguity must ask, not guess.
  store.addEvent({ title: "Investor sync", start: iso(2026, 8, 6, 14), end: iso(2026, 8, 6, 15) });
  r = ask("cancel my 2pm", S(), { now: NOW });
  t("ambiguous reference offers a choice", !!r.choices && r.choices.options.length >= 2,
    JSON.stringify(r.choices?.options?.length));
  t("and changes nothing until answered", S().events.length === 3);

  // 3. Create an event with a duration.
  r = ask("block 2 hours thursday morning for the board deck", S(), { now: NOW });
  const deck = S().events.find((e) => /board deck/i.test(e.title));
  t("creates the blocked event", !!deck, S().events.map((e) => e.title).join("|"));
  t("honours the 2h duration", deck && (new Date(deck.end) - new Date(deck.start)) / 60000 === 120);
  t("lands on Thursday morning", deck && deck.start === "2026-08-06T09:00:00", deck?.start);

  // 4. Task with priority and deadline.
  r = ask("add a task to sign the Munich lease, high priority, due friday", S(), { now: NOW });
  const lease = S().tasks.find((x) => /munich lease/i.test(x.title));
  t("creates the task", !!lease, S().tasks.map((x) => x.title).join("|"));
  t("captures priority", lease?.priority === "high", lease?.priority);
  t("captures the deadline", lease?.due === "2026-08-07", lease?.due);
  t("keeps the date out of the title", lease && !/friday/i.test(lease.title), lease?.title);

  // 5. Complete by fuzzy title.
  r = ask("mark the term sheet review as done", S(), { now: NOW });
  t("completes the matching task",
    S().tasks.find((x) => /term sheet/i.test(x.title))?.done === true, r.text);

  // 6. Delegation.
  r = ask("delegate the Munich lease to Priya", S(), { now: NOW });
  t("records the delegate",
    S().tasks.find((x) => /munich/i.test(x.title))?.delegatedTo === "Priya", r.text);

  // 7. Read-only query must not mutate.
  const before = JSON.stringify(S().events);
  r = ask("what does thursday look like", S(), { now: NOW });
  t("query answers with the day's meetings", /board deck/i.test(r.text), r.text);
  t("query changes nothing", JSON.stringify(S().events) === before);

  // 8. Free time respects existing bookings.
  r = ask("when am i free thursday", S(), { now: NOW });
  t("free-time answer excludes the booked block",
    r.text.includes("11:00") || /open time/i.test(r.text), r.text);

  // 9. Out of scope is declined, not attempted.
  r = ask("write me a poem about autumn", S(), { now: NOW });
  t("refuses off-topic requests", /didn't catch that|scheduling, tasks/i.test(r.text), r.text);

  // 10. Missing information asks rather than guesses.
  r = ask("move the exec staff meeting", S(), { now: NOW });
  t("asks when, instead of inventing a time", /when/i.test(r.text), r.text);

  localStorage.removeItem("squirrel.v2");
  return out;
});

let failed = 0;
for (const [name, ok, detail] of results) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  → ${detail}` : ""}`);
}
console.log(errs.length ? `page errors: ${errs.slice(0, 3).join(" | ")}` : "page errors: none");
await b.close();
process.exit(failed || errs.length ? 1 : 0);
