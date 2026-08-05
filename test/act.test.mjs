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

report("Assistant actions");
