/**
 * Putting work in by saying it.
 *
 * Everything else in this session made the app tell you *when* your work will
 * happen. This is the door in front of that: the sentence somebody dictates to
 * create the work in the first place. Walking it found four failures, and all
 * four are the same shape — the app understood something else and acted, so
 * what came back was not a refusal but a wrong answer that looked like a right
 * one.
 *
 *   "add finish the deck, 2 hours"       → "I couldn't find an open task
 *                                          matching that."  Nothing created.
 *   "add call the bank, 30 minutes"      → a task called "Bank".
 *   "add think about the rebrand"        → a task called "Think".
 *   "add talk to legal about the lease"  → nothing created.
 *   "add sign the lease, 1 hour, for X"  → "Sign the lease, , for Anders".
 *
 * The first and fourth are the expensive ones: somebody dictating into an empty
 * app got a refusal and an empty list, having used the right word — "add" — as
 * the very first one in the sentence. The middle two are worse in a quieter
 * way, because they *succeed*: the task is really created, really saved, and
 * really missing the words that said what it was.
 *
 * The through-line is that an explicit create verb was losing to rules that own
 * a later word — "finish" to completion, "to legal" to attendees — and that the
 * title cleaner, which exists to pull slots back out of a name, was pulling out
 * things that were never slots.
 */
import { store, reset, ask, t, report } from "./harness.mjs";

/** Tuesday evening: the hour somebody dictates the next day's work. */
const NOW = new Date(2026, 7, 11, 18, 30);

const say = (line, seed) => {
  reset();
  seed?.();
  const out = ask(line, store.getState(), { now: NOW });
  const s = store.getState();
  return { out, tasks: s.tasks, events: s.events, first: s.tasks[0] };
};

/* ------------------------------------------------ "add" beats "finish" */
/**
 * You cannot be asking to tick off the thing you are in the same breath asking
 * to create. The rule that owns "finish" was reading the sentence past the
 * word that said what was wanted.
 */
{
  const r = say("add finish the deck, 2 hours", () =>
    store.addTask({ title: "Something else", estimateMins: 60 }));
  t("“add finish the deck” creates the task", r.tasks.length === 2, JSON.stringify(r.tasks.map((x) => x.title)));
  t("  named as dictated", r.tasks.some((x) => x.title === "Finish the deck"),
    JSON.stringify(r.tasks.map((x) => x.title)));
  t("  and ticks nothing off", r.tasks.every((x) => !x.done));
}
{
  const r = say("create finish the quarterly review");
  t("“create” does the same", r.first?.title === "Finish the quarterly review", r.first?.title);
}

/**
 * And the other direction is untouched, which is the point of the veto being
 * narrow: without a create verb in front, "finish" still means finish.
 */
{
  const r = say("finish the deck", () => store.addTask({ title: "The deck", estimateMins: 60 }));
  t("a bare “finish the deck” still completes it", r.tasks[0]?.done === true);
}
{
  const r = say("smashed the board deck", () => store.addTask({ title: "Board deck", estimateMins: 60 }));
  t("and so does “smashed the board deck”", r.tasks[0]?.done === true);
}

/* ------------------------------------------------ "call" is a verb here */
/**
 * "call with Priya" is a noun and "call the bank" is a verb, and they open with
 * the same five letters. Stripping it as a noun left "the bank", which the
 * connector peel then reduced to "Bank" — the verb deleted from something
 * somebody had said out loud.
 */
{
  t("“call the bank” keeps its verb", say("add call the bank, 30 minutes").first?.title === "Call the bank",
    say("add call the bank, 30 minutes").first?.title);
  t("  and so does “call my mother”", say("add call my mother").first?.title === "Call my mother",
    say("add call my mother").first?.title);
  t("  while “call with Priya” is still a meeting about nobody's bank",
    /Priya/.test(say("call with Priya at 3pm tomorrow").events[0]?.title || ""),
    say("call with Priya at 3pm tomorrow").events[0]?.title);
  t("  and a bare noun opener still gives up its title",
    say("new task review the deck").first?.title === "Review the deck",
    say("new task review the deck").first?.title);
}

/* --------------------------------------------- "about" is an object here */
/**
 * A subject is the topic of an appointment — "meeting about the merger" is the
 * merger. A lone verb in front of "about" is different grammar, and reading it
 * as a subject cut the object out and kept the verb.
 */
{
  t("“think about the rebrand” keeps the rebrand",
    say("add think about the rebrand").first?.title === "Think about the rebrand",
    say("add think about the rebrand").first?.title);
  t("  and “decide about the office” keeps the office",
    say("add decide about the office").first?.title === "Decide about the office",
    say("add decide about the office").first?.title);

  /** Meetings must not regress: their subject really is their name. */
  const m = say("meeting with priya about the merger at 3pm tomorrow");
  t("a meeting is still named for its subject", /Merger/.test(m.events[0]?.title || ""), m.events[0]?.title);
  const l = say("lunch with sam about the raise on friday");
  t("  including lunch with somebody about something", /Raise/.test(l.events[0]?.title || ""), l.events[0]?.title);
  const c = say("call about the lease at 2pm tomorrow");
  t("  and a one-word meeting noun is exempt, so this is the lease",
    /Lease/.test(c.events[0]?.title || ""), c.events[0]?.title);
}

/* ------------------------------------------- "add X to Y" is still attendees */
/**
 * The create-verb veto is deliberately blind to this shape. "add priya to the
 * standup" opens with "add" and is not a task, and breaking it to fix the
 * sentences above would be trading one misroute for another.
 */
{
  const seed = () => {
    store.addEvent({ title: "Standup", start: "2026-08-12T09:00:00", end: "2026-08-12T09:15:00" });
    store.addEvent({ title: "Review", start: "2026-08-12T15:00:00", end: "2026-08-12T16:00:00" });
  };
  const a = say("add priya to the standup", seed);
  t("“add priya to the standup” still adds an attendee",
    a.events.find((e) => e.title === "Standup")?.attendees?.length === 1,
    JSON.stringify(a.events.map((e) => [e.title, e.attendees?.length])));
  t("  and creates no task", a.tasks.length === 0);

  const b = say("add tom to the 3pm", seed);
  t("and so does “add tom to the 3pm”",
    b.events.find((e) => e.title === "Review")?.attendees?.length === 1);
}

/* ------------------------------------------------ nothing is silently dropped */
{
  const r = say("add talk to legal about the lease");
  t("“add talk to legal” creates something rather than nothing", r.tasks.length === 1,
    JSON.stringify(r.out.text).slice(0, 80));
}

/* ------------------------------------------- punctuation left by a cut phrase */
/**
 * Every slot is cut out of the middle of the sentence and the tidy-up only
 * touched the two ends, so a removed duration left both of the commas that had
 * been holding it. A stray comma in a title reads as a typo the user made.
 */
{
  const r = say("add sign the lease, 1 hour, for Anders");
  t("a cut-out phrase leaves no double comma behind", !/,\s*,/.test(r.first?.title || ""), r.first?.title);
  t("  and no space in front of one", !/\s,/.test(r.first?.title || ""), r.first?.title);
}

/* ------------------------------------------------ and the answer says when */
/**
 * The other half of this session's work, reached through the spoken door: the
 * planner decides immediately, and she has to say so.
 */
{
  const r = say("add a task to draft the lease redlines, 2 hours, due friday");
  t("she names the task", /Draft the lease redlines/.test(r.out.text), r.out.text);
  t("  and the deadline given", /due Friday/.test(r.out.text), r.out.text);
  t("  and when it will actually be done", /\d+:\d\d\s*[AP]M/.test(r.out.text), r.out.text);
}
{
  const r = say("add review the contract, 40 hours, due thursday");
  t("work that cannot fit is said to not fit", /Won't fit/.test(r.out.text), r.out.text);
  t("  with the gap", /short/.test(r.out.text), r.out.text);
  t("  and a way out", /would do it|would fit by/.test(r.out.text), r.out.text);
}
{
  /** Delegated work is not on this person's calendar to book. */
  const r = say("add a task to sign the lease and give it to Anders");
  t("handed-over work is not given a booking",
    !/\d+:\d\d\s*[AP]M/.test(r.out.text) || !/Anders/.test(r.out.text), r.out.text);
}

report("Dictated");
