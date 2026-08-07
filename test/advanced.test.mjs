/**
 * The harder half of scheduling, and the whole of conversation.
 *
 * `reach.test.mjs` asks whether a sentence gets anywhere. This asks whether it
 * gets to the *right* place — every case here checks the calendar afterwards,
 * because "moved it an hour earlier" and moving it an hour earlier are
 * different claims and only one of them is testable by reading the reply.
 *
 * The scheduling arithmetic is where that matters most. A meeting placed
 * "right after the board call" that lands an hour late is wrong in a way
 * nobody notices until they are sitting in the wrong room.
 */

import { store, ask, iso, reset, t, report } from "./harness.mjs";

const NOW = new Date(iso(2026, 3, 10, 9, 0)); // Tuesday 10 March 2026, 09:00

/** Tuesday 09:00. Board call Wednesday 14–15, standup Thursday 09:00–09:15. */
function seed({ confirm = false } = {}) {
  reset({ confirm });
  store.setSetting("hours", { start: "08:00", end: "19:00", capacityMins: 300, days: [1, 2, 3, 4, 5], breaks: [] });
  store.addEvent({ title: "Board call", start: iso(2026, 3, 11, 14, 0), end: iso(2026, 3, 11, 15, 0) });
  store.addEvent({ title: "Exec staff", start: iso(2026, 3, 11, 9, 0), end: iso(2026, 3, 11, 10, 0) });
  store.addEvent({ title: "Standup", start: iso(2026, 3, 12, 9, 0), end: iso(2026, 3, 12, 9, 15) });
  store.addTask({ title: "Board deck", estimateMins: 360 });
  store.addTask({ title: "Term sheet", estimateMins: 300 });
  return store.getState;
}

const say = (text, state) => ask(text, state(), { now: NOW });
const ev = (title) => store.getState().events.find((e) => e.title === title);
const evs = () => store.getState().events;
const task = (title) => store.getState().tasks.find((x) => x.title === title);
const at = (e) => `${e.start}→${e.end}`;

// ------------------------------------------------------- booking off an anchor
{
  const s = seed();
  say("put a debrief right after the board call", s);
  const d = ev("Debrief");
  t("a debrief lands when the board call ends", d?.start === iso(2026, 3, 11, 15, 0), d && at(d));
  t("and runs the default hour", d?.end === iso(2026, 3, 11, 16, 0), d && at(d));
}
{
  const s = seed();
  say("schedule prep an hour before the board call", s);
  const p = ev("Prep");
  // An hour before means finishing an hour before it starts, not starting
  // then — otherwise the prep runs straight through the thing it prepares for.
  t("prep an hour before finishes on the hour", p?.end === iso(2026, 3, 11, 13, 0), p && at(p));
  t("and starts an hour before that", p?.start === iso(2026, 3, 11, 12, 0), p && at(p));
}
{
  const s = seed();
  say("I need 45 minutes with Priya before the board call", s);
  const m = evs().find((e) => /priya/i.test(e.title) || e.attendees?.some((a) => /priya/i.test(a.name)));
  t("45 minutes before ends exactly when it starts", m?.end === iso(2026, 3, 11, 14, 0), m && at(m));
  t("and is 45 minutes long", m && (new Date(m.end) - new Date(m.start)) / 60000 === 45, m && at(m));
  t("and is not titled with the request", !/i need/i.test(m?.title || ""), m?.title);
}
{
  // The ambiguity that decides between length and distance: what sits between
  // the verb and the number.
  const a = seed();
  say("book 30 minutes after the board call", a);
  const bare = evs().find((e) => !["Board call", "Exec staff", "Standup"].includes(e.title));
  t("a bare booking reads the number as a length",
    (new Date(bare.end) - new Date(bare.start)) / 60000 === 30, bare && at(bare));
  t("and starts as soon as the board call ends", bare.start === iso(2026, 3, 11, 15, 0), at(bare));

  const b = seed();
  say("book a debrief 30 minutes after the board call", b);
  const named = ev("Debrief");
  t("a named booking reads the number as a distance",
    named?.start === iso(2026, 3, 11, 15, 30), named && at(named));
  t("and keeps the default length",
    (new Date(named.end) - new Date(named.start)) / 60000 === 60, named && at(named));
}
{
  const s = seed();
  const r = say("book lunch right after the trip to Denver", s);
  t("an anchor that matches nothing asks rather than inventing a time",
    !ev("Lunch") && /can't find/i.test(r.text), r.text);
}

// --------------------------------------------------------------- nudging
{
  const s = seed();
  const r = say("bring the standup forward", s);
  t("a nudge with no distance asks how far", /how far/i.test(r.text), r.text);
  t("and moves nothing yet", ev("Standup").start === iso(2026, 3, 12, 9, 0), at(ev("Standup")));
}
{
  const s = seed();
  say("bring the standup forward an hour", s);
  t("forward an hour is an hour earlier", ev("Standup").start === iso(2026, 3, 12, 8, 0), at(ev("Standup")));
  t("and keeps its own length", ev("Standup").end === iso(2026, 3, 12, 8, 15), at(ev("Standup")));
}
{
  const s = seed();
  say("push the board call back 30 minutes", s);
  t("back 30 minutes is half an hour later", ev("Board call").start === iso(2026, 3, 11, 14, 30));
}
{
  const s = seed();
  const r = say("push the board call out a week", s);
  t("out a week is seven days later", ev("Board call").start === iso(2026, 3, 18, 14, 0), at(ev("Board call")));
  t("and is read back in weeks, not hours", /1 week/.test(r.text) && !/168/.test(r.text), r.text);
}
{
  // A direction word next to a real time is not a nudge.
  const s = seed();
  say("move the board call back to friday at 2", s);
  t("a move with a destination is still a move", ev("Board call").start === iso(2026, 3, 13, 14, 0), at(ev("Board call")));
}
{
  const s = seed();
  say("move everything on wednesday an hour later", s);
  t("a bulk nudge shifts each one", ev("Board call").start === iso(2026, 3, 11, 15, 0), at(ev("Board call")));
  t("including the others on that day", ev("Exec staff").start === iso(2026, 3, 11, 10, 0), at(ev("Exec staff")));
  t("and leaves other days alone", ev("Standup").start === iso(2026, 3, 12, 9, 0), at(ev("Standup")));
}
{
  const s = seed();
  const r = say("move everything an hour later", s);
  t("a bulk nudge with no day asks which one", Boolean(r.choices), r.text);
  t("and moves nothing meanwhile", ev("Board call").start === iso(2026, 3, 11, 14, 0));
}

// ----------------------------------------------------------------- swapping
{
  const s = seed();
  say("swap the standup and the board call", s);
  t("the standup takes the board call's slot", ev("Standup").start === iso(2026, 3, 11, 14, 0), at(ev("Standup")));
  t("the board call takes the standup's", ev("Board call").start === iso(2026, 3, 12, 9, 0), at(ev("Board call")));
  // Each keeps its own length: a fifteen-minute standup that traded with an
  // hour-long call is still fifteen minutes.
  t("the standup is still a quarter of an hour",
    (new Date(ev("Standup").end) - new Date(ev("Standup").start)) / 60000 === 15, at(ev("Standup")));
  t("and the board call still an hour",
    (new Date(ev("Board call").end) - new Date(ev("Board call").start)) / 60000 === 60, at(ev("Board call")));
}
{
  const s = seed();
  say("swap the standup and the board call", s);
  const undone = ask("undo", store.getState(), { now: NOW });
  t("a swap undoes as one step",
    ev("Standup").start === iso(2026, 3, 12, 9, 0) && ev("Board call").start === iso(2026, 3, 11, 14, 0),
    `${at(ev("Standup"))} / ${at(ev("Board call"))} — ${undone.text}`);
}
{
  const s = seed();
  const r = say("swap the standup and the christmas party", s);
  t("swapping with something that isn't there names what's missing",
    /couldn't find/i.test(r.text) && /christmas/i.test(r.text), r.text);
  t("and moves nothing", ev("Standup").start === iso(2026, 3, 12, 9, 0));
}

// -------------------------------------------------------- spreading work out
{
  const s = seed();
  const r = say("spread the board deck over the rest of the week", s);
  t("a spread sets a deadline", Boolean(task("Board deck").due), task("Board deck").due);
  t("and reports the days it landed on", /laid across \d+ days/.test(r.text), r.text);
  t("with an amount against each", /\d+h/.test(r.text), r.text);
}
{
  const s = seed();
  say("give the term sheet two hours a day", s);
  t("a rate is stored on the task", task("Term sheet").maxPerDayMins === 120, task("Term sheet").maxPerDayMins);
  const blocks = store.getState().blocks || [];
  const mine = blocks.filter((b) => b.taskId === task("Term sheet").id);
  // The rate is a ceiling that holds even where there is room to exceed it —
  // the point of asking for two hours a day is not to be given five on a day
  // that happens to be free.
  t("and no day exceeds it", mine.every((b) => b.mins <= 120), JSON.stringify(mine.map((b) => b.mins)));
}
{
  const s = seed();
  say("split the term sheet across tomorrow and thursday", s);
  t("a start day is stored", task("Term sheet").notBeforeDay === "2026-03-11", task("Term sheet").notBeforeDay);
  const mine = (store.getState().blocks || []).filter((b) => b.taskId === task("Term sheet").id);
  t("and nothing is laid before it",
    mine.every((b) => b.start >= "2026-03-11"), JSON.stringify(mine.map((b) => b.start)));
}
{
  const s = seed();
  store.addTask({ title: "Vague thing", estimateMins: null });
  const r = say("spread the vague thing over this week", s);
  t("spreading something with no estimate asks how long it is",
    /how long/i.test(r.text), r.text);
}

// ---------------------------------------------------------- holding time open
{
  const s = seed();
  say("no meetings before 10 tomorrow", s);
  const hold = evs().find((e) => /no meetings/i.test(e.title));
  t("a prohibition becomes a held block", Boolean(hold), evs().map((e) => e.title).join(" · "));
  t("running from the start of the working day", hold?.start === iso(2026, 3, 11, 8, 0), hold && at(hold));
  t("to the boundary named", hold?.end === iso(2026, 3, 11, 10, 0), hold && at(hold));
}
{
  const s = seed();
  const r = say("no meetings before 10 tomorrow", s);
  // Exec staff is 09:00–10:00 tomorrow, inside the hold.
  t("anything already in there is named", /already in there/i.test(r.text), r.text);
  t("and is not silently moved", ev("Exec staff").start === iso(2026, 3, 11, 9, 0), at(ev("Exec staff")));
}
{
  const s = seed();
  say("nothing after 4 on friday", s);
  const hold = evs().find((e) => /no meetings after/i.test(e.title));
  t("after a boundary runs to the end of the day", hold?.end === iso(2026, 3, 13, 19, 0), hold && at(hold));
  t("a bare afternoon hour is read as the afternoon", hold?.start === iso(2026, 3, 13, 16, 0), hold && at(hold));
}
{
  const s = seed();
  say("keep friday morning free", s);
  const hold = evs().find((e) => /no meetings/i.test(e.title));
  t("a daypart holds from the working day's start, not midnight",
    hold?.start === iso(2026, 3, 13, 8, 0), hold && at(hold));
}
// "no" is a determiner here and a correction elsewhere, and the difference is
// the noun behind it.
{
  const s = seed();
  say("book lunch thursday at 12", s);
  say("no, make it 1", s);
  const lunch = evs().find((e) => /lunch/i.test(e.title));
  t("a real correction is still a correction", lunch?.start === iso(2026, 3, 12, 13, 0), lunch && at(lunch));
}

// -------------------------------------------------------------- what's next
{
  const s = seed();
  const r = say("when's my next meeting", s);
  t("the next meeting is answered, not looked up by name",
    !r.miss && /exec staff/i.test(r.text), `${r.miss} | ${r.text}`);
}
{
  const s = seed();
  const r = say("what's next", s);
  t("so is the bare question", !r.miss && r.text.length > 10, r.text);
}
{
  reset();
  const r = ask("when's my next meeting", store.getState(), { now: NOW });
  t("an empty calendar says so plainly", /nothing else/i.test(r.text), r.text);
}

// ------------------------------------------------------------- conversation
{
  const s = seed();
  const first = say("what do I have tomorrow?", s);
  store.appendChat({ role: "assistant", text: first.text, actions: first.actions });
  const again = say("say that again", s);
  t("she repeats the last thing she said, verbatim", again.text === first.text, again.text);
}
{
  reset();
  const r = ask("say that again", store.getState(), { now: NOW });
  t("with nothing said yet, she says so", /haven't said anything/i.test(r.text), r.text);
}
{
  const s = seed();
  const booked = say("book lunch thursday at 12", s);
  store.appendChat({ role: "assistant", text: booked.text, actions: booked.actions });
  const r = say("did you get that", s);
  t("“did you get that” answers with the receipt", /got it/i.test(r.text), r.text);
}
{
  const s = seed();
  const r = say("are you there", s);
  t("presence is answered as presence", /still here|here —|right here/i.test(r.text), r.text);
}
{
  const s = seed();
  const r = say("I'm swamped", s);
  t("frustration is answered with arithmetic, not sympathy",
    /\d/.test(r.text) && !/sorry to hear|that sounds/i.test(r.text), r.text);
  t("and with something to do about it", /Say “/.test(r.text), r.text);
}
{
  const s = seed();
  const r = say("I'm swamped, clear my wednesday", s);
  t("a complaint with an instruction attached is the instruction",
    r.intent === "clear_range", `${r.intent} | ${r.text}`);
}
{
  const s = seed();
  const r = say("hold on", s);
  t("a request to wait is answered as one", /take your time|no rush|standing by/i.test(r.text), r.text);
}
{
  const s = seed();
  const r = say("wait", s);
  t("even when the opener stripper would have eaten it",
    /take your time|no rush|standing by/i.test(r.text), r.text);
}
{
  const s = seed();
  const r = say("wait, cancel the standup", s);
  t("but not when there is an instruction behind it", r.intent === "cancel_event", `${r.intent} | ${r.text}`);
}
{
  const s = seed();
  const r = say("you still there", s);
  t("“you still there” is presence, not how-are-you",
    /still here|here —|right here/i.test(r.text), r.text);
}
{
  const s = seed();
  const r = say("ok", s);
  t("a bare ok is answered, not queried", !r.miss, `${r.intent} | ${r.text}`);
}

report("Advanced scheduling and conversation");
