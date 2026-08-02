/**
 * Tests for the built-in assistant's language layer.
 *
 *   node test/nlu.test.mjs
 *
 * These cover datetime.js, parse.js, and resolve.js, which are pure — no store,
 * no DOM. Being able to pin this behaviour with assertions is the main
 * engineering argument for a coded assistant over a model.
 */
import { parseDate, parseTime, parseDateTime, parseDuration, dayKey } from "../src/lib/nlu/datetime.js";
import { parse, INTENTS } from "../src/lib/nlu/parse.js";
import { resolveEvent, resolveTask, isConfident } from "../src/lib/nlu/resolve.js";

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  → ${detail}` : ""}`);
};
const group = (n) => console.log(`\n── ${n} ──`);

// Sunday 2 August 2026, 10:00 local — fixed so results never depend on run time.
const NOW = new Date(2026, 7, 2, 10, 0, 0);

group("time");
check("3pm → 15:00", parseTime("at 3pm")?.h === 15);
check("3:30pm → 15:30", parseTime("3:30pm")?.h === 15 && parseTime("3:30pm")?.m === 30);
check("15:00 → 15:00", parseTime("15:00")?.h === 15);
check("bare 'at 2' reads as afternoon", parseTime("at 2")?.h === 14);
check("'at 9' reads as morning", parseTime("at 9")?.h === 9);
check("noon → 12", parseTime("at noon")?.h === 12);
check("morning → 9", parseTime("thursday morning")?.h === 9);
check("11am stays morning", parseTime("11am")?.h === 11);
check("12am → midnight", parseTime("12am")?.h === 0);
check("bare number is not a time", parseTime("2 hours") === null,
  JSON.stringify(parseTime("2 hours")));

group("date");
check("today", dayKey(parseDate("today", NOW).date) === "2026-08-02");
check("tomorrow", dayKey(parseDate("tomorrow", NOW).date) === "2026-08-03");
check("monday → next upcoming", dayKey(parseDate("monday", NOW).date) === "2026-08-03");
check("wednesday → this week", dayKey(parseDate("wednesday", NOW).date) === "2026-08-05");
check("next wednesday skips a week", dayKey(parseDate("next wednesday", NOW).date) === "2026-08-12");
check("same weekday as today rolls forward", dayKey(parseDate("sunday", NOW).date) === "2026-08-09");
check("aug 20", dayKey(parseDate("aug 20", NOW).date) === "2026-08-20");
check("20 august", dayKey(parseDate("20 august", NOW).date) === "2026-08-20");
check("iso date", dayKey(parseDate("2026-09-01", NOW).date) === "2026-09-01");
check("in 3 days", dayKey(parseDate("in 3 days", NOW).date) === "2026-08-05");
check("no date → null", parseDate("review the deck") === null);

group("datetime");
const dt = parseDateTime("wednesday at 2", NOW);
check("wednesday at 2 → Aug 5 14:00", dayKey(dt.at) === "2026-08-05" && dt.at.getHours() === 14);
const passed = parseDateTime("at 9am", NOW);
check("a time already past today rolls to tomorrow", dayKey(passed.at) === "2026-08-03");
const future = parseDateTime("at 3pm", NOW);
check("a later time today stays today", dayKey(future.at) === "2026-08-02");

group("duration");
check("2 hours → 120", parseDuration("block 2 hours") === 120);
check("90 minutes → 90", parseDuration("90 minutes") === 90);
check("an hour → 60", parseDuration("an hour") === 60);
check("half an hour → 30", parseDuration("half an hour") === 30);
check("1h30m → 90", parseDuration("1h 30m") === 90);
check("no duration → null", parseDuration("move it to friday") === null);

group("intent");
const cases = [
  ["reschedule my 3pm Monday to Wednesday at 2", INTENTS.MOVE_EVENT],
  ["move the board call to friday", INTENTS.MOVE_EVENT],
  ["push my 4pm to tomorrow", INTENTS.MOVE_EVENT],
  ["cancel my 4pm", INTENTS.CANCEL_EVENT],
  ["delete the product review", INTENTS.CANCEL_EVENT],
  ["block 2 hours thursday morning for the board deck", INTENTS.CREATE_EVENT],
  ["schedule a call with anders friday at 10", INTENTS.CREATE_EVENT],
  ["add a task to review the term sheet due friday", INTENTS.CREATE_TASK],
  ["remind me to sign the lease", INTENTS.CREATE_TASK],
  ["mark the term sheet review as done", INTENTS.COMPLETE_TASK],
  ["complete the lease task", INTENTS.COMPLETE_TASK],
  ["delegate the vendor review to Priya", INTENTS.DELEGATE_TASK],
  ["what does friday look like", INTENTS.QUERY_DAY],
  ["what's on today", INTENTS.QUERY_DAY],
  ["when am i free tomorrow", INTENTS.QUERY_FREE],
  ["plan my day", INTENTS.PLAN_DAY],
  ["help", INTENTS.HELP],
  ["write me a poem about autumn", INTENTS.UNKNOWN],
];
for (const [text, want] of cases) {
  const got = parse(text, NOW).intent;
  check(`"${text}" → ${want}`, got === want, `got ${got}`);
}

group("slot extraction");
const move = parse("reschedule my 3pm Monday to Wednesday at 2", NOW);
check("move splits subject from target", /3pm monday/i.test(move.slots.subjectPhrase));
check("move target resolves to Wed 14:00",
  dayKey(move.slots.when) === "2026-08-05" && move.slots.when.getHours() === 14,
  move.slots.when?.toString());

const task = parse("add a task to review the term sheet, high priority, due friday", NOW);
check("task title is exactly the work, nothing else",
  task.slots.title === "Review the term sheet", task.slots.title);
check("priority extracted", task.slots.priority === "high");
check("due date extracted", dayKey(task.slots.dateOnly) === "2026-08-07");

const block = parse("block 2 hours thursday morning for the board deck", NOW);
check("duration extracted", block.slots.durationMins === 120);
check("start time from daypart", block.slots.when.getHours() === 9);
check("title drops the leading preposition",
  block.slots.title === "Board deck", block.slots.title);

const deleg = parse("delegate the vendor security review to Priya", NOW);
check("person extracted", deleg.slots.person === "Priya");

group("resolution");
const events = [
  { id: "a", title: "Meridian partner call", start: "2026-08-03T15:00:00", end: "2026-08-03T16:00:00" },
  { id: "b", title: "Exec staff", start: "2026-08-03T09:00:00", end: "2026-08-03T10:00:00" },
  { id: "c", title: "Product review", start: "2026-08-05T15:00:00", end: "2026-08-05T16:00:00" },
];
const byTime = resolveEvent("my 3pm monday", events, NOW);
check("'my 3pm monday' finds the Monday 3pm", byTime[0]?.item.id === "a", byTime[0]?.item.title);
check("and is confident about it", isConfident(byTime));

const byTitle = resolveEvent("the exec staff meeting", events, NOW);
check("title match finds exec staff", byTitle[0]?.item.id === "b");

const ambiguous = resolveEvent("my 3pm", events, NOW);
check("bare '3pm' matches both 3pm events", ambiguous.length >= 2);
check("and is NOT confident, so it will ask", !isConfident(ambiguous));

const tasks = [
  { id: "t1", title: "Review revised term sheet", done: false },
  { id: "t2", title: "Approve Munich lease", done: false },
];
const tr = resolveTask("mark the term sheet review as done", tasks);
check("task resolves by overlap", tr[0]?.item.id === "t1");
check("no match returns empty", resolveEvent("the quarterly retreat", events, NOW).length === 0);

console.log("");
process.exit(failed ? 1 : 0);
