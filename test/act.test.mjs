/**
 * Coverage measured at the point of action, not at the classifier.
 *
 * `coverage.test.mjs` reported 100% while the assistant was answering "I
 * couldn't find that on your calendar" to "can you clear my calendar". Both
 * statements were true: the sentence was classified, and then the handler
 * behind the classification could only ever cancel one event, so it went
 * looking for a single meeting called "calendar" and failed to find it.
 *
 * A classifier check cannot see that. This suite runs the real store and the
 * real handlers and asserts on what changed — how many rows are gone, what the
 * confirmation actually said, whether the thing that was supposed to move
 * moved. Every phrasing here that can destroy data is checked at that level,
 * because the difference between "understood" and "did the right thing" is
 * precisely where the three failures the user reported were living.
 */
import { store, ask, resolveChoice, iso, reset, t, report } from "./harness.mjs";

// Wednesday 5 August 2026, 10:00. Fixed so weekday arithmetic is stable.
const NOW = new Date(2026, 7, 5, 10, 0);
const S = () => store.getState();

/** A week with something on most days, rebuilt before each block. */
function seed({ confirm = false } = {}) {
  reset({ confirm });
  return {
    wedAM: store.addEvent({ title: "Standup", start: iso(2026, 8, 5, 9), end: iso(2026, 8, 5, 9, 30) }),
    wedPM: store.addEvent({ title: "1:1 with Dana", start: iso(2026, 8, 5, 14), end: iso(2026, 8, 5, 15) }),
    thu: store.addEvent({ title: "Board prep", start: iso(2026, 8, 6, 11), end: iso(2026, 8, 6, 12) }),
    friAM: store.addEvent({
      title: "Exec staff", start: iso(2026, 8, 7, 9), end: iso(2026, 8, 7, 10),
      attendees: [{ name: "Bob" }],
    }),
    friNoon: store.addEvent({ title: "Lunch with Priya", start: iso(2026, 8, 7, 12), end: iso(2026, 8, 7, 13) }),
    friPM: store.addEvent({ title: "Meridian partner call", start: iso(2026, 8, 7, 15), end: iso(2026, 8, 7, 16) }),
    sat: store.addEvent({ title: "Site visit", start: iso(2026, 8, 8, 10), end: iso(2026, 8, 8, 11) }),
    nextWeek: store.addEvent({ title: "QBR", start: iso(2026, 8, 12, 10), end: iso(2026, 8, 11, 11) }),
  };
}

const say = (q, opts = {}) => ask(q, S(), { now: NOW, ...opts });
const count = () => S().events.length;
const titles = () => S().events.map((e) => e.title).sort();

// ------------------------------------------------------- the reported failures
/**
 * Three transcripts, verbatim from a user who had just given up on the thing.
 * Each one classified perfectly and then did nothing.
 */
{
  seed();
  const r = say("can you clear my calendar");
  t("“clear my calendar” is not a mystery",
    !/didn't catch/i.test(r.text), r.text);
  t("with no scope named, it asks rather than guessing",
    r.choices?.kind === "range" && count() === 8, `${r.choices?.kind} / ${count()}`);
  t("and the choices are stretches, not meetings",
    r.choices.options.map((o) => o.id).join(",") === "today,tomorrow,this week,cancel",
    JSON.stringify(r.choices.options.map((o) => o.id)));
}

{
  seed();
  const first = say("can you clear my calendar");
  const r = resolveChoice(first.choices, "tomorrow", S(), NOW);
  t("answering the scope question clears that stretch",
    count() === 7 && !titles().includes("Board prep"), titles().join(" · "));
  t("and says what it did", /clear/i.test(r.text), r.text);
}

{
  seed();
  say("remove my appointments for this wek");
  t("a typo in the range still lands — “this wek”",
    count() === 2, `${count()} left: ${titles().join(" · ")}`);
  t("stopping at the end of the week, not the end of time",
    titles().includes("QBR"), titles().join(","));
  t("and leaving this morning's standup, which already happened",
    titles().includes("Standup"), titles().join(","));
}

{
  seed();
  say("what does friday look like");
  const r = say("remove them");
  t("“remove them” resolves against the set just listed",
    count() === 5 && !titles().includes("Exec staff"), titles().join(" · "));
  t("and names the count", /3/.test(r.text) || /three/i.test(r.text), r.text);
}

/**
 * A second reported transcript, verbatim. Four distinct failures in four turns,
 * all of the same family: politeness in front of a request, and a pronoun
 * pointing back at it.
 */
{
  seed({ confirm: true });
  say("are you able to schedule an appointment for me this thursday at 4:00pm with john");
  say("yes");
  const ev = S().events.find((e) => e.start.startsWith("2026-08-06T16:00"));
  t("a request wrapped in politeness is still a request", !!ev, S().events.length);
  t("and is not titled with the question that asked for it",
    ev?.title === "Appointment with John", ev?.title);

  const r = say("actually can you go ahead and move that appointment from tomorrow at 4:00 to saturday at 2:00");
  t("“move it from X to Y” reads the second time, not the first",
    !/already/i.test(r.text), r.text);
  say("yes");
  const moved = S().events.find((e) => e.title === "Appointment with John");
  t("so the appointment actually moves", moved?.start === "2026-08-08T14:00:00", moved?.start);
}
{
  seed({ confirm: false });
  store.addEvent({ title: "Appointment with John", start: iso(2026, 8, 6, 16), end: iso(2026, 8, 6, 17) });
  say("what time is my appointment with john");
  say("can you move it to saturday at 2:00");
  const moved = S().events.find((e) => e.title === "Appointment with John");
  t("“can you move it” points at what was just discussed",
    moved?.start === "2026-08-08T14:00:00", moved?.start);
}
{
  seed({ confirm: false });
  store.addEvent({ title: "Ops review", start: iso(2026, 8, 6, 9), end: iso(2026, 8, 6, 9, 30) });
  say("would you mind moving the ops review to friday");
  const moved = S().events.find((e) => e.title === "Ops review");
  t("a gerund is still the verb — “moving” contains no “move”",
    moved?.start.startsWith("2026-08-07"), moved?.start);
}
{
  seed({ confirm: false });
  say("when you get a chance book lunch with priya friday at 12");
  const ev = S().events.find((e) => e.title.includes("Priya"));
  t("“when you get a chance” is courtesy, not a question about when", !!ev, S().events.length);
  t("and the booking is named for what it is", ev?.title === "Lunch with Priya", ev?.title);
}

// ------------------------------------------------------------------- undo
/**
 * The other half of acting without asking.
 *
 * An assistant that cancels six meetings on one sentence needs a way back, and
 * a confirmation is not one — it puts the decision at the moment you are least
 * able to weigh it.
 */
{
  seed();
  say("cancel my 3pm");
  t("something was cancelled", count() === 7 && !titles().includes("Meridian partner call"), titles().join(" · "));
  const r = say("undo that");
  t("and comes back", count() === 8 && titles().includes("Meridian partner call"), titles().join(" · "));
  t("named, so it is clear what returned", /Meridian partner call/.test(r.text), r.text);
}
{
  seed();
  say("clear my calendar friday");
  t("three went", count() === 5, count());
  say("undo");
  t("three come back — a bulk change undoes as one step", count() === 8, titles().join(" · "));
}
{
  seed();
  say("move everything on friday to monday");
  say("put it back");
  t("a bulk move undoes as one step too",
    S().events.filter((e) => e.start.startsWith("2026-08-07")).length === 3,
    S().events.map((e) => e.start).join(" "));
}
{
  reset({ confirm: false });
  const r = say("undo");
  t("with nothing done, it says so", /nothing to undo/i.test(r.text), r.text);
}
{
  seed();
  say("book a call with bob thursday at 2");
  say("cancel my 3pm");
  say("undo");
  t("undo walks back one step, not all of them",
    count() === 9 && titles().includes("Meridian partner call"), titles().join(" · "));
  say("undo");
  t("and again", count() === 8 && !titles().some((x) => x.includes("Bob")), titles().join(" · "));
}
{
  seed();
  say("cancel my 3pm");
  const r = say("never mind, undo it");
  t("politeness in front of undo is still undo",
    count() === 8 && /Meridian/.test(r.text), r.text);
}

// -------------------------------------------------------- changing a task
/**
 * Setting a property on a task named rather than pointed at.
 *
 * The estimate case is the one that mattered: people *state* how long
 * something takes rather than commanding it, and every phrasing of that
 * failed. The number the entire planner runs on could only be entered by hand.
 */
function withTasks() {
  seed();
  return {
    lease: store.addTask({ title: "Sign the Munich lease", estimateMins: 45, due: "2026-08-14" }),
    deck: store.addTask({ title: "Board deck", estimateMins: 240, due: "2026-08-12", priority: "high" }),
    sheet: store.addTask({ title: "Revised term sheet", estimateMins: 90, due: "2026-08-10" }),
  };
}
const task = (title) => S().tasks.find((x) => x.title === title);

{
  withTasks();
  say("the munich lease is about 2 hours");
  t("an estimate stated is an estimate set", task("Sign the Munich lease")?.estimateMins === 120,
    task("Sign the Munich lease")?.estimateMins);
}
{
  withTasks();
  say("the board deck will take 8 hours");
  t("“will take” works too", task("Board deck")?.estimateMins === 480, task("Board deck")?.estimateMins);
}
{
  withTasks();
  say("make the term sheet critical");
  t("priority by name", task("Revised term sheet")?.priority === "critical", task("Revised term sheet")?.priority);
}
{
  withTasks();
  say("bump the term sheet to critical");
  t("“bump” is a priority here, not a reschedule",
    task("Revised term sheet")?.priority === "critical", task("Revised term sheet")?.priority);
}
{
  withTasks();
  say("mark the board deck as low priority");
  t("and downwards", task("Board deck")?.priority === "low", task("Board deck")?.priority);
}
{
  withTasks();
  say("the board deck is due friday");
  t("a deadline stated is a deadline set", task("Board deck")?.due === "2026-08-07", task("Board deck")?.due);
}
{
  withTasks();
  say("rename the board deck to Q3 board deck");
  t("rename takes the second half, not the whole phrase",
    !!task("Q3 board deck") && !task("Board deck"), S().tasks.map((x) => x.title).join(" · "));
}
{
  withTasks();
  say("delete the term sheet task");
  t("“delete the X task” is not a cancellation",
    !task("Revised term sheet") && count() === 8, `${S().tasks.length} tasks, ${count()} events`);
}
{
  const { deck } = withTasks();
  store.toggleTask(deck.id);
  t("it starts done", task("Board deck")?.done === true);
  say("reopen the board deck");
  t("and reopens", task("Board deck")?.done === false, task("Board deck")?.done);
}
{
  const { deck } = withTasks();
  store.toggleTask(deck.id);
  say("i didn't actually finish the board deck");
  t("said the way people say it", task("Board deck")?.done === false, task("Board deck")?.done);
}
{
  withTasks();
  const r = say("the exec staff is 30 minutes");
  t("a length on a meeting still resizes the meeting",
    (new Date(S().events.find((e) => e.title === "Exec staff").end) -
     new Date(S().events.find((e) => e.title === "Exec staff").start)) / 60000 === 30, r.text);
}

// ------------------------------------------------------------- a series
{
  seed();
  const before = count();
  say("every monday at 9 standup");
  const made = S().events.filter(
    (e) => e.title === "Standup" && e.start.slice(11, 16) === "09:00" && new Date(e.start).getDay() === 1);
  t("a series is written out, not stored as a rule", made.length === 12, made.length);
  t("named for the thing, not the cadence", made.every((e) => e.title === "Standup"));
  t("all on the same weekday",
    new Set(made.map((e) => new Date(e.start).getDay())).size === 1,
    [...new Set(made.map((e) => new Date(e.start).getDay()))].join());
  say("undo");
  t("and the whole series undoes as one step", count() === before, `${count()} vs ${before}`);
}
{
  seed();
  say("book a 1:1 with sarah every tuesday at 3");
  const made = S().events.filter((e) => e.title === "1:1 with Sarah");
  t("attendees survive a series", made.length > 0 && made[0].attendees?.[0]?.name === "Sarah",
    JSON.stringify(made[0]?.attendees));
}
{
  seed();
  say("a daily standup at 9");
  const made = S().events.filter((e) => e.title === "Standup");
  t("a daily series skips the weekend",
    made.every((e) => ![0, 6].includes(new Date(e.start).getDay())),
    [...new Set(made.map((e) => new Date(e.start).getDay()))].join());
}

// -------------------------------------------------------- place and load
{
  seed();
  say("the meridian partner call is on zoom");
  t("a place, stated", S().events.find((e) => e.title.includes("Meridian"))?.location === "zoom",
    S().events.find((e) => e.title.includes("Meridian"))?.location);
}
{
  seed();
  say("the exec staff is on friday");
  t("but a date is not a place — that is still a date",
    !S().events.find((e) => e.title === "Exec staff")?.location,
    S().events.find((e) => e.title === "Exec staff")?.location);
}
{
  seed();
  const r = say("how busy am i friday");
  t("“how busy” gets the arithmetic, not just a list",
    /focus time/.test(r.text) && /meetings/.test(r.text), r.text);
}
{
  seed();
  const r = say("give me something to do");
  t("asking for work is not delegating it", !/to whom/i.test(r.text), r.text);
}

// --------------------------------------------------------------- every phrasing
/**
 * The clearing vocabulary, executed.
 *
 * Each entry states the exact events that should survive. A phrasing that
 * classifies as a clear and then removes nothing fails here, which is the
 * whole point — that combination is invisible to a coverage percentage.
 */
const CLEARS = [
  ["clear my calendar friday", 5],
  ["wipe friday", 5],
  ["cancel everything tomorrow", 7],
  ["delete everything friday", 5],
  ["cancel all my meetings tomorrow", 7],
  ["clear the rest of today", 7],
  ["wipe out friday afternoon", 6],
  ["empty out friday", 5],
  ["free up my whole friday", 5],
  ["clear my calendar for the rest of this week", 2],
  ["take friday off my calendar", 5],
  ["cancel my meetings this week", 2],
  ["get rid of everything on friday", 5],
  ["scrap everything tomorrow", 7],
  ["clear friday morning", 7],
  ["please clear my calendar on friday", 5],
  ["do me a favour and clear friday", 5],
  ["nuke friday", 5],
  ["clear next week", 7],
  ["cancel everything saturday", 7],
  ["empty my friday", 5],
  ["blank out friday", 5],
  ["scrub friday afternoon", 6],
  ["purge friday", 5],
  ["nuke my friday morning", 7],
  ["clear from thursday to friday", 4],
  ["cancel the next 3 days", 3],
  ["wipe my calendar for tomorrow", 7],
  ["clear my whole week", 2],
];
for (const [q, want] of CLEARS) {
  seed();
  const r = say(q);
  t(`clears something: “${q}”`, count() === want, `${count()} left, wanted ${want} — ${r.text}`);
}

/**
 * A scope is never inherited from an unrelated turn.
 *
 * Booking something tomorrow and then saying "clear my calendar" produced
 * "clearing tomorrow — 1 meeting": a confident answer to a question nobody
 * asked, on the one operation where guessing the scope costs the most.
 */
{
  seed();
  say("put a meeting with ronnie at 11 tomorrow");
  const r = say("can you clear my calendar");
  t("a fresh clear with no scope still asks",
    r.choices?.kind === "range" && count() === 9, `${r.choices?.kind} / ${count()}`);
}
{
  seed();
  say("what does friday look like");
  say("clear it");
  t("but an explicit back-reference inherits the day",
    count() === 5 && !titles().includes("Exec staff"), titles().join(" · "));
}

// ------------------------------------------------------------ nothing to clear
{
  seed();
  const r = say("clear my calendar sunday");
  t("an empty stretch says so instead of confirming a deletion of nothing",
    count() === 8 && /already clear/i.test(r.text), r.text);
}

// ------------------------------------------------------------- narrowed by who
{
  seed();
  say("cancel my meetings with bob this week");
  t("a name narrows the set", count() === 7 && !titles().includes("Exec staff"), titles().join(" · "));
}

// ------------------------------------------------ one thing is still one thing
/**
 * The risk of teaching an assistant to delete in bulk is that it starts doing
 * it when asked to delete one thing. Every case here must remove exactly one.
 */
const SINGLES = [
  "cancel my 3pm",
  "delete the board prep",
  "cancel the exec staff",
  "drop the lunch with priya",
  "take the standup off my calendar",
  "i don't need the 3pm anymore",
  "the site visit is cancelled",
];
for (const q of SINGLES) {
  seed();
  say(q);
  t(`removes exactly one: “${q}”`, count() === 7, `${count()} left — ${titles().join(" · ")}`);
}

// ------------------------------------------------------------------ confirming
{
  seed({ confirm: true });
  const r = say("clear my calendar friday");
  t("a destructive bulk change is read back first", count() === 8 && !!r.choices, r.text);
  t("and the count is in the sentence", /3 meetings/.test(r.text), r.text);
  t("and so is the stretch", /friday/i.test(r.text), r.text);
  say("yes");
  t("saying yes carries it out", count() === 5, titles().join(" · "));
}
{
  seed({ confirm: true });
  say("clear my calendar friday");
  const r = say("no");
  t("saying no leaves everything alone", count() === 8, `${count()}`);
  t("and says so plainly", /left it/i.test(r.text), r.text);
}
// A bare "ok" is a yes when something is pending and agreement when nothing
// is. `ask` claims it before small talk is ever consulted, and this pair is
// the guard on that ordering — the classifier itself now reads "ok" as a
// courtesy, so the proxy assertion that used to stand here no longer holds.
{
  seed({ confirm: true });
  say("clear my calendar friday");
  say("ok");
  t("ok confirms an open proposal", count() === 5, titles().join(" · "));
}
{
  seed({ confirm: true });
  const r = say("ok");
  t("ok with nothing pending is answered, not queried",
    !r.miss && r.intent === "small:affirm", `${r.intent} | ${r.text}`);
  t("and it changes nothing", count() === 8, `${count()}`);
}
{
  seed({ confirm: true });
  say("clear my calendar friday");
  say("no, thursday");
  t("a revision re-aims the same request", count() === 8, "still pending, nothing gone yet");
  say("yes");
  t("and clears the day actually meant",
    count() === 7 && !titles().includes("Board prep"), titles().join(" · "));
}

// ------------------------------------------------------------------- bulk move
{
  seed();
  const r = say("move everything on friday to monday");
  const moved = S().events.filter((e) => e.start.startsWith("2026-08-10"));
  t("a whole day can be picked up and set down", moved.length === 3, `${moved.length} on Monday`);
  t("and each meeting keeps its own hour",
    moved.map((e) => e.start.slice(11, 16)).sort().join(",") === "09:00,12:00,15:00",
    moved.map((e) => e.start).join(" "));
  t("nothing is lost in the move", count() === 8, `${count()}`);
  t("and it says how many", /3/.test(r.text), r.text);
}

// ------------------------------------------------------- cancel-and-rebook
/**
 * "Cancel my meeting for Friday at 1 and reschedule it for Saturday at 2" —
 * two verbs, one intention. Handled as a cancel followed by a booking it would
 * lose the title, the attendees, and the length.
 */
{
  seed();
  store.addEvent({ title: "Ronnie sync", start: iso(2026, 8, 7, 13), end: iso(2026, 8, 7, 14) });
  say("cancel my meeting for friday at 1 and reschedule it for saturday at 2");
  const ev = S().events.find((e) => e.title === "Ronnie sync");
  t("a cancel-and-rebook is one move", !!ev && S().events.length === 9, `${S().events.length} events`);
  t("landing on the day asked for", ev?.start === "2026-08-08T14:00:00", ev?.start);
  t("keeping its length", (new Date(ev.end) - new Date(ev.start)) / 60000 === 60,
    `${(new Date(ev.end) - new Date(ev.start)) / 60000}m`);
}

/** Every way people write a cancel-and-rebook, executed. */
const COMPOUNDS = [
  "cancel the 3pm and rebook it for tuesday at 10",
  "delete friday's 3pm and move it to tuesday at 10",
  "drop the 3pm and put it at 11 on tuesday",
  "scrap the 3pm and rearrange it for tuesday at 10",
  "cancel my 3pm and reschedule for tuesday at 10",
];
for (const q of COMPOUNDS) {
  seed();
  say(q);
  const ev = S().events.find((e) => e.title === "Meridian partner call");
  t(`one move, not a delete and a new booking: “${q}”`,
    S().events.length === 8 && ev?.start.startsWith("2026-08-11"),
    `${S().events.length} events, call at ${ev?.start}`);
}

// ------------------------------------------------------------------- booking
{
  seed();
  const r = say("put a meeting with ronnie at 11");
  const ev = S().events.find((e) => e.title.includes("Ronnie"));
  t("a bare booking verb still books", !!ev, r.text);
  t("and is named the way a person would name it",
    ev?.title === "Meeting with Ronnie", ev?.title);
  t("at the hour asked for", ev?.start.slice(11, 16) === "11:00", ev?.start);
}
{
  seed();
  say("cancel my meeting for friday at 1 and reschedule it for saturday at 2");
  // Nothing at 1pm Friday — the assistant should say so, not invent a booking.
  t("with nothing to move, nothing is created", count() === 8, `${count()}`);
}
{
  seed();
  say("30 minute call with dana at 11 tomorrow");
  const ev = S().events.find((e) => e.title.includes("Dana") && e.start.startsWith("2026-08-06"));
  t("a duration in front of the time does not hide it", !!ev, S().events.map((e) => e.title).join(" · "));
  t("and the length is the one given",
    ev && (new Date(ev.end) - new Date(ev.start)) / 60000 === 30,
    ev && (new Date(ev.end) - new Date(ev.start)) / 60000);
}

// ---------------------------------------------------------- the working day
/**
 * The settings have to reach the answers, or the panel is decoration. Same
 * question, two different working days, two different answers.
 */
{
  seed();
  store.addTask({ title: "Board deck", estimateMins: 600, due: "2026-08-14" });
  const wide = say("plan my week");
  store.setSetting("hours", { start: "09:00", end: "10:00", capacityMins: 60, days: [1, 2, 3, 4, 5], breaks: [] });
  const narrow = say("plan my week");
  t("a shorter working day changes the plan the assistant hands back",
    wide.text !== narrow.text, "identical output for an 11h day and a 1h day");
  t("and it says what no longer fits", /not fit/i.test(narrow.text), narrow.text);

  const r = say("what are my working hours");
  t("and it reads the setting back", /9:00 AM to 10:00 AM/.test(r.text), r.text);
  t("naming the focus budget too", /1h a day/.test(r.text), r.text);
}

/**
 * A week is not a day with more in it.
 *
 * The range was parsed correctly and then thrown away: "what does my week look
 * like" reported today, and "what does this week look like" reported the Friday
 * that phrase also reads as a deadline. Both answered confidently, which is the
 * failure worth a test — a miss announces itself and a wrong answer does not.
 */
{
  seed();
  store.addTask({ title: "Board deck", due: "2026-08-07", estimateMins: 120 });

  const week = say("what does my week look like");
  t("a question about the week is answered about the week",
    /this week/.test(week.text), week.text);
  t("grouped by day rather than read as one list", /Friday:/.test(week.text), week.text);
  t("with the deadline in it", /Board deck due/.test(week.text), week.text);
  t("and next week's QBR left out of this week", !/QBR/.test(week.text), week.text);
  t("empty days are not each reported clear", !/Sunday/.test(week.text), week.text);

  t("“this week” is read as the span, not as the Friday deadline",
    /Friday:/.test(say("what does this week look like").text),
    say("what does this week look like").text);

  const nextWeek = say("what does next week look like");
  t("next week is its own week", /QBR/.test(nextWeek.text), nextWeek.text);
  t("and does not leak this one in", !/Standup/.test(nextWeek.text), nextWeek.text);

  // The narrower questions must keep their old, better answers.
  const day = say("what does friday look like");
  t("a named day still answers as a day", /on Friday/.test(day.text), day.text);
  t("in the fuller sentence form", /At 9:00 AM/.test(day.text), day.text);
  t("and part of a day is not treated as a span",
    !/Friday:/.test(say("what does friday afternoon look like").text));

  // The set the answer just listed is what a pronoun points at next.
  seed();
  say("what does my week look like");
  const gone = say("cancel them");
  t("“cancel them” after a week answer means that week",
    count() < 8, `${count()} left: ${titles().join(" · ")}`);
  t("and leaves next week alone", titles().includes("QBR"), titles().join(" · "));
  t("saying what it did", !/didn't catch/i.test(gone.text), gone.text);
}

/**
 * "My week", asked from a weekend.
 *
 * Weeks run Monday to Sunday, which puts the weekend at the end of the week it
 * belongs to. Read literally, somebody who booked a meeting for Thursday on a
 * Saturday evening and then asked what their week looked like was told it was
 * clear: the range covered the day and a half left of the week that was ending.
 * Found by the onboarding demo doing exactly that, on a Saturday.
 */
{
  const SAT = new Date(2026, 7, 8, 20, 0);   // Saturday evening
  const SUN = new Date(2026, 7, 9, 12, 0);   // Sunday lunchtime

  reset();
  store.addEvent({ title: "Board call", start: iso(2026, 8, 13, 14), end: iso(2026, 8, 13, 15) });
  store.addTask({ title: "Board deck", due: "2026-08-14" });

  for (const [name, now] of [["Saturday", SAT], ["Sunday", SUN]]) {
    const r = ask("what does my week look like", S(), { now });
    t(`on ${name}, "my week" means the working week ahead`, /Thursday:/.test(r.text), r.text);
    t(`  carrying the deadline with it`, /Board deck due/.test(r.text), r.text);
  }

  // And it must not swallow next week along with it.
  const nx = ask("what does next week look like", S(), { now: SAT });
  t("next week still means the one after that", !/Board call/.test(nx.text), nx.text);

  // "This weekend" is a different question and keeps its own answer.
  const wknd = ask("what does this weekend look like", S(), { now: SAT });
  t("and the weekend in hand is not redirected to Monday",
    !/Thursday:/.test(wknd.text), wknd.text);

  // Midweek is unchanged: days already spent are not reported back.
  reset();
  store.addEvent({ title: "Monday standup", start: iso(2026, 8, 10, 9), end: iso(2026, 8, 10, 9, 30) });
  store.addEvent({ title: "Thursday review", start: iso(2026, 8, 13, 14), end: iso(2026, 8, 13, 15) });
  const mid = ask("what does my week look like", S(), { now: new Date(2026, 7, 12, 10) });
  t("midweek still starts from today, not from Monday",
    !/Monday standup/.test(mid.text), mid.text);
  t("and still runs to the end of the week", /Thursday review/.test(mid.text), mid.text);
}

/**
 * Handing work over, said the way people say it.
 *
 * The person had to be capitalised, which quietly broke the whole feature for
 * anybody who *talks* to her: a recogniser returns "delegate the sow to bob" in
 * lower case every time, so a dictated hand-off classified correctly, found no
 * person, and asked "delegate it to whom?" of somebody who had just said whom.
 * It does not look like a bug from outside — she just seems not to be
 * listening.
 */
{
  const seed = () => {
    reset({ confirm: false });
    store.addTask({ title: "Draft the SOW", due: "2026-08-14", estimateMins: 90 });
    store.addEvent({ title: "Board call", start: iso(2026, 8, 13, 15), end: iso(2026, 8, 13, 16) });
  };
  const NOW2 = new Date(2026, 7, 12, 10, 0);
  // `||` rather than `??`: an undelegated task carries an empty string, not
  // undefined, so a nullish check would call "" a person.
  const who = () => S().tasks.find((x) => x.title === "Draft the SOW")?.delegatedTo || null;

  for (const phrase of [
    "delegate draft the sow to bob",
    "hand the sow to bob",
    "give the sow to bob",
    "assign the sow to bob",
  ]) {
    seed();
    ask(phrase, S(), { now: NOW2 });
    t(`"${phrase}" reaches Bob`, who() === "Bob", who());
  }

  seed();
  ask("delegate the sow to Priya", S(), { now: NOW2 });
  t("a capital still works, obviously", who() === "Priya", who());

  seed();
  ask("delegate the sow to bob smith", S(), { now: NOW2 });
  t("and a surname survives without one", /^Bob/.test(who() || ""), who());

  // The guards, which are the reason this could not simply drop the capital:
  // "to" is followed by a time far more often than by a person.
  seed();
  const moved = ask("move the board call to friday", S(), { now: NOW2 });
  t("a day after “to” is still a day", /Moved/.test(moved.text), moved.text);
  t("and nothing was delegated to anybody called Friday", who() === null, who());

  seed();
  ask("move the board call to 4pm", S(), { now: NOW2 });
  t("nor to anybody called 4pm", who() === null, who());

  seed();
  const mine = ask("delegate the sow to me", S(), { now: NOW2 });
  t("“to me” is not a hand-off", who() === null, mine.text);

  seed();
  ask("book lunch with bob", S(), { now: NOW2 });
  t("and booking a meeting with somebody does not delegate to them",
    who() === null, who());
}

/**
 * "What did I finish this week?"
 *
 * Two faults in one sentence. COMPLETE_TASK owns the word "finish", so this was
 * read as an instruction — she went looking for an open task called "this week"
 * and reported she could not find one. A past-tense question about what got
 * done is the opposite of a command to get something done, and the two are one
 * auxiliary verb apart.
 *
 * And the answer was a count. This is the only question in the app whose whole
 * job is to make somebody feel they got somewhere, and "three tasks finished"
 * does not do that: it is a receipt where an answer was wanted.
 */
{
  const NOW3 = new Date(2026, 7, 12, 17, 0);
  reset({ confirm: false });
  const proj = store.addProject({ name: "Q3 Launch" });
  const done = (title, at) => {
    const task = store.addTask({ projectId: proj.id, title, estimateMins: 60 });
    if (at) store.updateTask(task.id, { done: true, doneAt: at });
    return task;
  };
  done("Draft the SOW", new Date(2026, 7, 12, 11).toISOString());
  done("Review numbers", new Date(2026, 7, 12, 14).toISOString());
  done("Send invoices", new Date(2026, 7, 10, 9).toISOString());
  done("Board deck");

  const week = ask("what did i finish this week", S(), { now: NOW3 });
  t("a past-tense question is a question, not an instruction",
    !/couldn'?t find/i.test(week.text), week.text);
  t("and the things finished are named rather than counted",
    /Draft the SOW/.test(week.text) && /Send invoices/.test(week.text), week.text);
  t("nothing was marked done by asking",
    S().tasks.filter((x) => x.done).length === 3, S().tasks.filter((x) => x.done).length);

  const today = ask("what did i get done today", S(), { now: NOW3 });
  t("today means today", /Draft the SOW/.test(today.text), today.text);
  t("and leaves out what was finished on Monday",
    !/Send invoices/.test(today.text), today.text);

  t("“what have I finished” is the same question",
    /Draft the SOW/.test(ask("what have i finished", S(), { now: NOW3 }).text));

  // The commands must not have been dragged along with it.
  reset({ confirm: false });
  store.addTask({ title: "Draft the SOW", estimateMins: 60 });
  ask("finish the sow", S(), { now: NOW3 });
  t("“finish the sow” still finishes the SOW",
    S().tasks[0]?.done === true, S().tasks[0]?.done);

  reset({ confirm: false });
  store.addTask({ title: "Draft the SOW", estimateMins: 60 });
  ask("the sow is done", S(), { now: NOW3 });
  t("and so does “the sow is done”", S().tasks[0]?.done === true);
}

/**
 * "What's left on Q3 Launch?" was answered about *today's calendar* — the
 * project named in the question ignored entirely. Confidently answering a
 * different question than the one asked is worse than a miss, because nothing
 * looks wrong.
 */
{
  const NOW4 = new Date(2026, 7, 12, 10, 0);
  reset({ confirm: false });
  const proj = store.addProject({ name: "Q3 Launch" });
  store.addTask({ projectId: proj.id, title: "Board deck", estimateMins: 120, due: "2026-08-14" });
  store.addEvent({ title: "Standup", start: iso(2026, 8, 12, 9), end: iso(2026, 8, 12, 9, 30) });

  const r = ask("whats left on q3 launch", S(), { now: NOW4 });
  t("a question about a project is answered about the work",
    /Board deck/i.test(r.text), r.text);
  t("and not about this morning's meetings", !/Standup/.test(r.text), r.text);
  t("“how much is left on” names the project outright",
    /Q3 Launch/.test(ask("how much is left on q3 launch", S(), { now: NOW4 }).text));
}

report("Assistant actions");
