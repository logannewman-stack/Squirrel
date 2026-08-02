/**
 * Conversational memory.
 *
 * Every case here is a transcript that went wrong before memory existed: a
 * correction read as a new command, a fragment read as a title, a bare time
 * read as today. Run with `npm run test:memory`.
 */
import { parse } from "../src/lib/nlu/parse.js";
import {
  EMPTY_MEMORY, remember, carryable, lastTurn, focusOf, topicDay, inherit,
} from "../src/lib/nlu/context.js";

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

// Sunday 2 Aug 2026, 10:00 — same fixed clock as the other suites.
const NOW = new Date(2026, 7, 2, 10, 0, 0);

// ------------------------------------------------------------ the transcript
{
  const p = parse("can you schedule a 2 pm meeting for 30 minutes with bob", NOW);
  t("lowercase name is still a name", JSON.stringify(p.slots.people) === '["Bob"]', JSON.stringify(p.slots.people));
  t("the leftover noun phrase is not a title", p.slots.title === null, p.slots.title);
  t("duration is read as duration", p.slots.durationMins === 30, p.slots.durationMins);
  t("2 pm is read as the time", p.slots.timeOnly?.h === 14, JSON.stringify(p.slots.timeOnly));
  t("no date given", p.slots.hadDate === false, p.slots.hadDate);
  t("not mistaken for a follow-up", !p.repair && !p.fragment, `${p.repair}/${p.fragment}`);
}

{
  const p = parse("no for friday", NOW);
  t("'no …' is flagged as a correction", p.repair === true);
  t("and the rest is a fragment", p.fragment === true);
  t("carrying Friday", p.slots.dateOnly?.getDay() === 5, p.slots.dateOnly);
  t("a correction never invents a title", p.slots.title === null, p.slots.title);
}

{
  const p = parse("no schedule it for friday", NOW);
  t("'no schedule it …' is a correction", p.repair === true);
  t("'it' is seen as a reference", p.pronoun === true);
  t("and never becomes a title", p.slots.title === null, p.slots.title);
  t("the verb still classifies", p.intent === "create_event", p.intent);
}

// -------------------------------------------------------------- edit phrasing
{
  const p = parse("make it 3pm", NOW);
  t("'make it …' is an amendment", p.amend === true);
  t("with the new time", p.slots.timeOnly?.h === 15, JSON.stringify(p.slots.timeOnly));
}
{
  const p = parse("actually make it an hour", NOW);
  t("'actually' is a correction", p.repair === true);
  t("an hour is 60 minutes", p.slots.durationMins === 60, p.slots.durationMins);
  // Left alone, the leftovers here spell "Make" and rename the meeting.
  t("an edit verb never becomes a title", p.slots.title === null, p.slots.title);
  t("and never a rename", p.slots.rename === null, p.slots.rename);
}
{
  const p = parse("call it board prep", NOW);
  t("a rename must be asked for in words", p.slots.rename === "Board prep", p.slots.rename);
}
{
  const p = parse("rename it to the Munich close", NOW);
  t("'rename it to …' works too", p.slots.rename === "The Munich close", p.slots.rename);
}
{
  const p = parse("push it to thursday", NOW);
  t("'push it to …' is an amendment", p.amend === true);
  t("landing on Thursday", p.slots.dateOnly?.getDay() === 4, p.slots.dateOnly);
}

// ------------------------------------------------------- real commands aren't
{
  const p = parse("schedule a call with Sarah about the term sheet friday at 10", NOW);
  t("a complete command is not a follow-up",
    !p.repair && !p.fragment && !p.amend, `${p.repair}/${p.fragment}/${p.amend}`);
}
{
  const p = parse("block 2 hours thursday morning for the board deck", NOW);
  t("titles still survive slot removal", p.slots.title === "Board deck", p.slots.title);
  t("and it is not a fragment", p.fragment === false);
}
{
  const p = parse("add a task to sign the Munich lease, high priority, due friday", NOW);
  t("task title stays clean", p.slots.title === "Sign the Munich lease", p.slots.title);
}
{
  const p = parse("meeting with the team tuesday at 9", NOW);
  t("'the team' is not a person", p.slots.people.length === 0, JSON.stringify(p.slots.people));
}
{
  const p = parse("write me a poem about autumn", NOW);
  t("off-topic stays unknown", p.intent === "unknown" && !p.fragment, `${p.intent}/${p.fragment}`);
}

// ------------------------------------------------------------------- the noun
{
  const p = parse("book a call with priya at 4", NOW);
  t("the noun is captured for the title", p.slots.kindNoun === "call", p.slots.kindNoun);
  t("and the name is normalised", p.slots.people[0] === "Priya", p.slots.people[0]);
}

// ------------------------------------------------------------------- memory
{
  let m = EMPTY_MEMORY;
  m = remember(m, { text: "a", intent: "create_event", slots: {}, entity: { kind: "event", id: "e1" }, day: "2026-08-07" }, NOW.getTime());
  const state = { events: [{ id: "e1", title: "X" }], tasks: [] };

  t("the last turn is recalled", lastTurn(m, NOW)?.intent === "create_event");
  t("focus resolves to the live record", focusOf(m, state, NOW)?.item.id === "e1");
  t("a deleted record is not focus", focusOf(m, { events: [], tasks: [] }, NOW) === null);
  t("the topic day is remembered", topicDay(m, NOW)?.getDay() === 5, topicDay(m, NOW));

  const stale = new Date(NOW.getTime() + 45 * 60000);
  t("memory goes cold on its own", lastTurn(m, stale) === null);
  t("and so does the topic", topicDay(m, stale) === null);
}

{
  // Today is the default, not a topic — otherwise every thread sticks to it.
  const m = remember(EMPTY_MEMORY, { text: "a", intent: "query_day", slots: {}, entity: null, day: "2026-08-02" }, NOW.getTime());
  t("today is not a topic", topicDay(m, NOW) === null, topicDay(m, NOW));
}
{
  // A day that has already been and gone should not pull new bookings back.
  const m = remember(EMPTY_MEMORY, { text: "a", intent: "query_day", slots: {}, entity: null, day: "2026-07-30" }, NOW.getTime());
  t("a past day is not a topic", topicDay(m, NOW) === null, topicDay(m, NOW));
}

// ------------------------------------------------------------------ inherit
{
  const prior = { intent: "move_event", slots: carryable(parse("move the exec staff meeting", NOW).slots) };
  const merged = inherit(parse("wednesday at 2", NOW), prior);
  t("a fragment inherits the intent", merged.intent === "move_event", merged.intent);
  t("and the subject it never restated",
    /exec staff/i.test(merged.slots.subjectPhrase), merged.slots.subjectPhrase);
  t("while its own time wins", merged.slots.timeOnly?.h === 14, JSON.stringify(merged.slots.timeOnly));
}
{
  // The new message must beat the old one on any slot it actually states.
  const prior = { intent: "create_event", slots: carryable(parse("30 minute meeting", NOW).slots) };
  const merged = inherit(parse("make it 90 minutes", NOW), prior);
  t("a restated slot overrides", merged.slots.durationMins === 90, merged.slots.durationMins);
}

// -------------------------------------------------------------- typed fast
// Logan's line, exactly as typed. Two typos and an unusual time format, and it
// used to produce a confirmation reading: “Then can you book” — with Bob?
{
  const p = parse("can you scheduke a 3 o clok for a meeting with bob on financials for DOD", NOW);
  t("a mistyped verb still classifies", p.intent === "create_event", p.intent);
  t("and is not mistaken for a fragment", p.fragment === false);
  t("'3 o clok' is three o'clock", p.slots.timeOnly?.h === 15, JSON.stringify(p.slots.timeOnly));
  t("'on financials' is the subject", p.slots.subject === "financials for DOD", p.slots.subject);
  t("bob is still the attendee", p.slots.people[0] === "Bob", JSON.stringify(p.slots.people));
  t("no scrap of the command survives as a title", p.slots.title === null, p.slots.title);
}
{
  const forms = ["3 o'clock", "3 oclock", "3 o clock", "3 o clok", "3oclock"];
  for (const f of forms) {
    const p = parse(`meeting with bob at ${f} friday`, NOW);
    t(`“${f}” reads as 3 PM`, p.slots.timeOnly?.h === 15, JSON.stringify(p.slots.timeOnly));
  }
}
{
  // The correction pass must not touch a sentence that already made sense,
  // and must never rewrite a name into a verb.
  const p = parse("book 30 minutes with Blocke friday at 2", NOW);
  t("a name near a command word is left alone",
    p.slots.people[0] === "Blocke", JSON.stringify(p.slots.people));
}
{
  const p = parse("put it on my calendar tomorrow at 3", NOW);
  t("a calendar phrase is not a subject", p.slots.subject === null, p.slots.subject);
  t("nor a title", p.slots.title === null, p.slots.title);
}
{
  const p = parse("meeting on friday with bob", NOW);
  t("'on friday' is a date, not a subject", p.slots.subject === null, p.slots.subject);
  t("and the day is read", p.slots.dateOnly?.getDay() === 5, p.slots.dateOnly);
}
{
  // A title belongs to one thing. Carrying it is what produced the nonsense.
  const prior = { intent: "create_event", slots: carryable(parse("block 2 hours for the board deck", NOW).slots) };
  t("a title is never carried between turns", prior.slots.title === undefined, JSON.stringify(prior.slots));
  const merged = inherit(parse("friday at 2", NOW), prior);
  t("so a fragment cannot inherit one", !merged.slots.title, merged.slots.title);
}

// ------------------------------------------------------------------ titles
{
  const { composeTitle } = await import("../src/lib/nlu/voice.js");
  const T = (text) => composeTitle(parse(text, NOW).slots);

  t("subject leads when there is one",
    T("book 45 minutes with anders about the munich lease thursday at 9") === "Munich lease with Anders",
    T("book 45 minutes with anders about the munich lease thursday at 9"));
  t("otherwise it is the noun and who",
    T("schedule a 2 pm meeting for 30 minutes with bob") === "Meeting with Bob",
    T("schedule a 2 pm meeting for 30 minutes with bob"));
  t("the noun they used is the noun kept",
    T("lunch with priya friday at 12") === "Lunch with Priya",
    T("lunch with priya friday at 12"));
  t("a call is a call", T("book a call with priya at 4") === "Call with Priya", T("book a call with priya at 4"));
  t("a subject alone stands on its own",
    T("block 2 hours thursday morning for the board deck") === "Board deck",
    T("block 2 hours thursday morning for the board deck"));
  t("and with nothing to go on, it is a meeting",
    T("schedule something friday at 2") === "Something", T("schedule something friday at 2"));
}
{
  // No verb, but a noun and a time — people book like this constantly.
  const p = parse("lunch with priya friday at 12", NOW);
  t("a noun with a time is a booking", p.intent === "create_event", p.intent);
  t("and not a fragment to be attached to something else", p.fragment === false);
}

// ---------------------------------------------------------------- phrasing
{
  const { describeMeeting } = await import("../src/lib/nlu/voice.js");
  const generic = describeMeeting(
    { start: "2026-08-03T14:00:00", title: "Meeting with Bob", attendees: [{ name: "Bob" }] });
  t("a title that repeats the attendee is dropped",
    generic === "At 2:00 PM you're meeting with Bob.", generic);

  const real = describeMeeting(
    { start: "2026-08-03T14:00:00", title: "Q3 board review", attendees: [{ name: "Bob" }] });
  t("a title with something to say is kept",
    /Q3 board review/.test(real), real);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
