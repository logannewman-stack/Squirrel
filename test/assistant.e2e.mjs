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
  // These check what the actions do. The confirmation gate in front of them
  // gets its own block below.
  store.setSetting("confirm", false);

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
 * Conversational memory, on a fresh page.
 *
 * The store keeps a module-level cache, so clearing localStorage mid-run does
 * not empty it — only a reload does. Sharing a page with the block above would
 * leave its events lying around and turn half of these into accidental
 * ambiguity tests.
 */
await p.evaluate(() => localStorage.removeItem("squirrel.v2"));
await p.reload({ waitUntil: "networkidle" });

const convo = await p.evaluate(async () => {
  const store = await import("/src/lib/store.js");
  const { ask } = await import("/src/lib/nlu/index.js");
  const out = [];
  const t = (name, ok, detail) => out.push([name, !!ok, detail || ""]);

  const NOW = new Date(2026, 7, 2, 10, 0, 0);
  const iso = (y, mo, d, h, mi = 0) =>
    `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00`;

  let r;
  store.setSetting("identity", { style: "formal", honorific: "Mr.", lastName: "Newman" });
  store.setSetting("confirm", false);

  const M = () => store.getState();
  const eventCount = () => M().events.length;

  // Logan's transcript, verbatim. Every line of it went wrong before the
  // assistant remembered anything.
  ask("what does friday look like", M(), { now: NOW });
  r = ask("can you schedule a 2 pm meeting for 30 minutes with bob", M(), { now: NOW });
  let bob = M().events[M().events.length - 1];
  t("the title is a title, not the sentence", bob.title === "Meeting with Bob", bob.title);
  t("a lowercase name still becomes an attendee",
    bob.attendees?.[0]?.name === "Bob", JSON.stringify(bob.attendees));
  t("a bare time lands on the day being discussed",
    bob.start === "2026-08-07T14:00:00", bob.start);
  t("the stated duration is honoured",
    (new Date(bob.end) - new Date(bob.start)) / 60000 === 30);

  // "no for friday" — a correction with nothing but a day in it.
  let n = eventCount();
  r = ask("no make it monday", M(), { now: NOW });
  bob = M().events.find((e) => e.id === bob.id);
  t("a correction edits, it does not add", eventCount() === n, `${eventCount()} vs ${n}`);
  t("the corrected day is applied", bob.start.startsWith("2026-08-03"), bob.start);
  t("and the time it never restated is kept", bob.start.endsWith("T14:00:00"), bob.start);
  t("as is the duration", (new Date(bob.end) - new Date(bob.start)) / 60000 === 30);
  t("and the attendee", bob.attendees?.[0]?.name === "Bob");

  // "no schedule it for friday" — the exact line that created "No schedule it".
  n = eventCount();
  r = ask("no schedule it for friday", M(), { now: NOW });
  t("a pronoun command edits too", eventCount() === n, `${eventCount()} vs ${n}`);
  t("no event is ever named after the correction",
    !M().events.some((e) => /^no\b/i.test(e.title)), M().events.map((e) => e.title).join("|"));
  bob = M().events.find((e) => e.id === bob.id);
  t("and it moved to Friday", bob.start === "2026-08-07T14:00:00", bob.start);

  // Fragments amend the length without repeating anything else.
  r = ask("actually make it an hour", M(), { now: NOW });
  bob = M().events.find((e) => e.id === bob.id);
  t("a fragment can change just the length",
    (new Date(bob.end) - new Date(bob.start)) / 60000 === 60);
  t("without moving it", bob.start === "2026-08-07T14:00:00", bob.start);

  // A missing slot gets asked for, then supplied on its own.
  store.addEvent({ title: "Ops review", start: iso(2026, 8, 10, 9), end: iso(2026, 8, 10, 10) });
  r = ask("move the ops review", M(), { now: NOW });
  t("an incomplete command still asks", /when/i.test(r.text), r.text);
  r = ask("wednesday at 2", M(), { now: NOW });
  const ops = M().events.find((e) => e.title === "Ops review");
  t("and the answer alone completes it", ops.start === "2026-08-05T14:00:00", ops.start);

  // A real new command after all that must not be swallowed as a follow-up.
  n = eventCount();
  ask("schedule a call with priya tuesday at 11", M(), { now: NOW });
  t("a fresh command still creates", eventCount() === n + 1, `${eventCount()} vs ${n + 1}`);
  const priya = M().events[M().events.length - 1];
  t("and names itself after the noun used", priya.title === "Call with Priya", priya.title);

  // "no, cancel it" is the natural undo.
  n = eventCount();
  r = ask("no cancel it", M(), { now: NOW });
  t("a correction can undo the thing it just made", eventCount() === n - 1, `${eventCount()} vs ${n - 1}`);
  t("and it removed the right one",
    !M().events.some((e) => e.title === "Call with Priya"), M().events.map((e) => e.title).join("|"));

  // Memory has to be forgettable, or a cleared thread still steers replies.
  store.clearChat();
  t("clearing the chat clears the memory", store.getState().memory.turns.length === 0);

  // ---- sync bookkeeping ----
  // None of this is visible in the UI, and all of it decides whether a change
  // reaches the other device.
  const ev = store.addEvent({ title: "Sync check", start: iso(2026, 8, 12, 9), end: iso(2026, 8, 12, 10) });
  t("a new record gets a server-shaped id",
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ev.id), ev.id);
  t("and is stamped as unsent", ev.dirty === true && ev.updatedAt > 0, JSON.stringify(ev.updatedAt));

  const before = M().events.find((e) => e.id === ev.id).updatedAt;
  await new Promise((r) => setTimeout(r, 5));
  store.updateEvent(ev.id, { title: "Sync check 2" });
  t("an edit moves the stamp forward",
    M().events.find((e) => e.id === ev.id).updatedAt > before);

  store.markSynced([{ kind: "events", id: ev.id }]);
  t("acknowledging clears the flag", M().events.find((e) => e.id === ev.id).dirty === false);

  await new Promise((r) => setTimeout(r, 5));
  store.updateEvent(ev.id, { title: "Edited mid-flight" });
  store.markSynced([{ kind: "events", id: ev.id }], Date.now() - 1000);
  t("an edit made during a push stays unsent",
    M().events.find((e) => e.id === ev.id).dirty === true);

  store.deleteEvent(ev.id);
  t("a delete removes it from view", !M().events.some((e) => e.id === ev.id));
  t("and leaves a tombstone",
    M().tombstones.some((x) => x.kind === "events" && x.id === ev.id),
    JSON.stringify(M().tombstones));

  // A project taking its tasks with it has to mark each one, or the other
  // device's next push brings them all back.
  const proj = store.addProject({ name: "Doomed" });
  const kid = store.addTask({ projectId: proj.id, title: "Goes with it" });
  store.deleteProject(proj.id);
  t("cascaded tasks get their own tombstones",
    M().tombstones.some((x) => x.kind === "tasks" && x.id === kid.id),
    JSON.stringify(M().tombstones.map((x) => x.kind)));

  return out;
});

/** Confirm-before-acting, on its own page so the setting starts at its default. */
await p.evaluate(() => localStorage.removeItem("squirrel.v2"));
await p.reload({ waitUntil: "networkidle" });

const confirms = await p.evaluate(async () => {
  const store = await import("/src/lib/store.js");
  const { ask, resolveChoice } = await import("/src/lib/nlu/index.js");
  const out = [];
  const t = (name, ok, detail) => out.push([name, !!ok, detail || ""]);

  const NOW = new Date(2026, 7, 2, 10, 0, 0);
  store.setSetting("identity", { style: "formal", honorific: "Mr.", lastName: "Newman" });
  const M = () => store.getState();

  // On by default — nobody has to find a setting to get this.
  let r = ask("schedule a 2 pm meeting for 30 minutes with bob friday", M(), { now: NOW });
  t("nothing is written before it asks", M().events.length === 0, M().events.length);
  t("it addresses you and states the intent",
    /^Okay, Mr\. Newman — just to confirm:/.test(r.text), r.text);
  t("the read-back names the length", /30m/.test(r.text), r.text);
  t("names who it is with", /with Bob/.test(r.text), r.text);
  t("names the day and time", /Friday at 2:00 PM/.test(r.text), r.text);
  t("and the title it intends to use", /titled “Meeting with Bob”/.test(r.text), r.text);
  t("with a yes and a no", r.choices?.kind === "confirm" && r.choices.options.length === 2);

  // Revising a proposal keeps everything already agreed.
  r = ask("no make it monday at 3", M(), { now: NOW });
  t("a revision still writes nothing", M().events.length === 0, M().events.length);
  // Monday is tomorrow from the fixed Sunday clock, and it says so.
  t("the revised day and time show up", /tomorrow at 3:00 PM/.test(r.text), r.text);
  t("the length survives the revision", /30m/.test(r.text), r.text);
  t("so does the attendee", /with Bob/.test(r.text), r.text);

  // Yes acts, exactly once.
  r = ask("yes", M(), { now: NOW });
  t("yes writes it", M().events.length === 1, M().events.length);
  const ev = M().events[0];
  t("with everything from the revised proposal",
    ev.start === "2026-08-03T15:00:00" && (new Date(ev.end) - new Date(ev.start)) / 60000 === 30,
    `${ev.start} ${ev.end}`);
  t("and the agreed title", ev.title === "Meeting with Bob", ev.title);
  t("the proposal is spent", !M().memory.pending, JSON.stringify(M().memory.pending));

  // No declines and changes nothing.
  ask("cancel the meeting with bob", M(), { now: NOW });
  r = ask("no", M(), { now: NOW });
  t("no leaves it alone", M().events.length === 1, M().events.length);
  t("and says so", /left it as it was/i.test(r.text), r.text);

  // The buttons take the same path as typing.
  r = ask("mark the lease done", M(), { now: NOW });
  store.addTask({ title: "Sign the Munich lease" });
  r = ask("delete the meeting with bob", M(), { now: NOW });
  const after = resolveChoice(r.choices, "yes", M(), NOW);
  t("tapping yes acts too", M().events.length === 0, after.text);

  // Turning it off restores one-shot behaviour.
  store.setSetting("confirm", false);
  ask("schedule a call with priya tuesday at 11", M(), { now: NOW });
  t("with confirmations off it just does it", M().events.length === 1, M().events.length);
  t("and titles it sensibly", M().events[0].title === "Call with Priya", M().events[0].title);

  // Common-sense titles: the subject leads when there is one.
  store.setSetting("confirm", false);
  ask("book 45 minutes with anders about the munich lease thursday at 9", M(), { now: NOW });
  const titled = M().events.find((e) => /munich/i.test(e.title));
  t("a subject makes the better title",
    titled?.title === "Munich lease with Anders", M().events.map((e) => e.title).join("|"));
  ask("lunch with priya friday at 12", M(), { now: NOW });
  t("and the noun used is the noun kept",
    M().events.some((e) => e.title === "Lunch with Priya"), M().events.map((e) => e.title).join("|"));

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
for (const [name, ok, detail] of [...results, ...convo, ...confirms, ...ui]) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  → ${detail}` : ""}`);
}
console.log(errs.length ? `page errors: ${errs.slice(0, 3).join(" | ")}` : "page errors: none");
await b.close();
process.exit(failed || errs.length ? 1 : 0);
