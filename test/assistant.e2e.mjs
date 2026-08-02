/**
 * End-to-end assistant checks against the real store.
 *
 * Needs the dev server on :5173. Runs the actual UI path — type a command,
 * confirm the underlying data changed.
 */
import { chromium } from "playwright";

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
// Deliberately not UTC. Every date the app stores is a local wall-clock string,
// so a UTC test box would let a toISOString() slip through unnoticed — the
// offset is zero and the bug has nothing to show.
const p = await b.newPage({
  viewport: { width: 1100, height: 900 },
  deviceScaleFactor: 2,
  timezoneId: "America/New_York",
});
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));

await p.goto("http://localhost:5173/", { waitUntil: "networkidle" });

const results = await p.evaluate(async () => {
  const store = await import("/src/lib/store.js");
  const { ask } = await import("/src/lib/nlu/index.js");
  const out = [];
  const t = (name, ok, detail) => out.push([name, !!ok, detail || ""]);

  localStorage.removeItem("squirrel.v2");
  store.setSetting("identity", { style: "formal", honorific: "Mr.", lastName: "Newman" });

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

  // ---- voice ----
  store.addEvent({
    title: "Meeting with Bob", start: iso(2026, 8, 4, 10), end: iso(2026, 8, 4, 11),
    attendees: [{ name: "Bob" }], notes: "the Q3 pipeline",
  });
  store.addEvent({
    title: "Meeting with John", start: iso(2026, 8, 4, 14), end: iso(2026, 8, 4, 15),
    attendees: [{ name: "John" }], notes: "the Series B financials",
  });
  r = ask("what do i have this tuesday", S(), { now: NOW });
  t("acknowledgement greets by honorific and surname",
    /Good (morning|afternoon|evening), Mr\. Newman/.test(r.ack), r.ack);
  t("answer counts the meetings in words", /two meetings/i.test(r.text), r.text);
  t("answer names who each meeting is with",
    /with Bob/.test(r.text) && /with John/.test(r.text), r.text);
  t("answer states what each is about",
    /about the Q3 pipeline/.test(r.text) && /about the Series B financials/.test(r.text), r.text);
  t("answer does not repeat the greeting", !/Good morning/i.test(r.text), r.text);
  t("lookups use the calendar animation", r.variant === "calendar", r.variant);

  r = ask("schedule a call with Sarah about the term sheet friday at 10", S(), { now: NOW });
  const made = S().events.find((e) => /Sarah/.test(e.title) || (e.attendees || []).some((a) => a.name === "Sarah"));
  t("attendee captured on create", !!made, S().events.map((e) => e.title).join("|"));
  t("subject captured on create", made?.notes === "the term sheet", made?.notes);
  t("changes use the pen animation", r.variant === "pen", r.variant);

  localStorage.removeItem("squirrel.v2");
  return out;
});

/**
 * Second pass, through the actual UI rather than the store: first-run identity,
 * an event captured in the dialog, then the assistant describing it. This is
 * the path that broke silently before — the assistant could say "with Bob about
 * X" but nothing in the UI could record either fact.
 */
await p.evaluate(() => localStorage.removeItem("squirrel.v2"));
await p.reload({ waitUntil: "networkidle" });

await p.getByRole("button", { name: "Mr." }).click();
await p.getByPlaceholder("Surname").fill("Newman");
await p.getByRole("button", { name: "Continue" }).click();

await p.getByRole("button", { name: "New event" }).click();
await p.getByPlaceholder("Title").fill("Partner sync");
await p.getByPlaceholder(/^With/).fill("Bob, John");
await p.getByPlaceholder(/^About/).fill("the Q3 pipeline");
await p.getByRole("button", { name: "Add" }).click();

await p.getByRole("button", { name: "Assistant" }).click();
await p.getByPlaceholder("What do I have Tuesday?").fill("what do i have today");
await p.getByRole("button", { name: "Send" }).click();

const ui = [];
ui.push(["thinking beat is visible before the answer",
  await p.locator("svg .sq-cell").first().isVisible().catch(() => false)]);

await p.waitForTimeout(1400);
const answer = await p.locator("p.whitespace-pre-line").last().textContent();
ui.push(["dialog attendees reach the answer", /with Bob and John/.test(answer), answer]);
ui.push(["dialog subject reaches the answer", /about the Q3 pipeline/.test(answer), answer]);

// A 60-minute event must not end hours away from where it started.
const span = await p.evaluate(async () => {
  const { getState } = await import("/src/lib/store.js");
  const e = getState().events.find((x) => x.title === "Partner sync");
  return (new Date(e.end) - new Date(e.start)) / 60000;
});
ui.push(["derived end time stays in local time", span === 60, `${span} mins`]);

await p.evaluate(() => localStorage.removeItem("squirrel.v2"));

let failed = 0;
for (const [name, ok, detail] of [...results, ...ui]) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  → ${detail}` : ""}`);
}
console.log(errs.length ? `page errors: ${errs.slice(0, 3).join(" | ")}` : "page errors: none");
await b.close();
process.exit(failed || errs.length ? 1 : 0);
