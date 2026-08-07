/**
 * Everything anyone might say to a calendar.
 *
 * `reach.test.mjs` samples the space; this one tries to cover it — every way
 * of adding, moving, cancelling, resizing, renaming, repeating, asking, and
 * planning that turned up when the vocabulary was written out deliberately
 * rather than remembered. It ran at 86% the first time, and the failures were
 * not exotic: "get rid of the board call", "skip the standup", "who's coming",
 * "the lease is done".
 *
 * A caveat worth keeping in view, because it cost the worst bug in the app:
 * this measures whether a sentence is *understood*, not whether it does the
 * right thing. "Drop Bob from the standup" passed this bar while deleting the
 * standup. Consequence is asserted in `advanced.test.mjs` and `act.test.mjs`;
 * this is breadth, and breadth alone.
 */
import { store, ask, iso, reset } from "./harness.mjs";
const misses = await import("../src/lib/misses.js");

const NOW = new Date(iso(2026, 3, 10, 9, 0)); // Tuesday 10 Mar 2026, 09:00

function seed() {
  reset({ confirm: false });
  misses.clear();
  store.setSetting("hours", { start: "08:00", end: "18:00", capacityMins: 300, days: [1,2,3,4,5], breaks: [] });
  const p = store.addProject({ name: "Series B", due: "2026-04-30" });
  store.addEvent({ title: "Board call", start: iso(2026,3,11,14,0), end: iso(2026,3,11,15,0), attendees: [{name:"Priya"}] });
  store.addEvent({ title: "Exec staff", start: iso(2026,3,11,9,0), end: iso(2026,3,11,10,0), attendees: [{name:"Bob"}] });
  store.addEvent({ title: "Standup", start: iso(2026,3,12,9,0), end: iso(2026,3,12,9,15) });
  store.addEvent({ title: "Priya 1:1", start: iso(2026,3,12,16,0), end: iso(2026,3,12,16,30) });
  store.addEvent({ title: "Lunch with Tom", start: iso(2026,3,13,12,0), end: iso(2026,3,13,13,0) });
  store.addTask({ projectId: p.id, title: "Board deck", estimateMins: 360, due: "2026-03-16" });
  store.addTask({ projectId: p.id, title: "Term sheet", estimateMins: 90, due: "2026-03-13" });
  store.addTask({ title: "Sign the lease", estimateMins: 45 });
  return store.getState;
}

const G = {
"adding — plain verbs": [
  "book a call with Bob thursday at 2", "schedule a review friday at 10",
  "set up a sync with Priya wednesday at 11", "put a coffee with Tom in on thursday at 3",
  "add a meeting thursday at 4", "create an event friday at 9",
  "pencil in drinks with Tom friday at 6", "arrange a call with legal thursday at 1",
  "organise a debrief friday at 2", "line up a call with Bob thursday at 5",
  "slot in a review thursday at 11", "pop a call in thursday at 3",
  "stick a sync in friday at 4", "throw a call on the calendar thursday at 10",
  "get a call with Bob on the calendar thursday at 2",
  "lock in the partner call thursday at 3", "nail down the review friday at 11",
  "fix up a call with Tom thursday at 9", "block an hour thursday morning",
  "hold thursday at 2 for the board", "reserve friday afternoon",
  "carve out two hours thursday", "squeeze in a call with Bob thursday",
  "make time for the board deck thursday", "set aside an hour friday",
],
"adding — stated, not commanded": [
  "I have a call with Bob thursday at 2", "I've got the dentist friday at 9",
  "there's a board meeting thursday at 10", "we're meeting Priya thursday at 3",
  "dinner with Tom friday at 7", "flight to Denver friday at 6am",
  "I'm seeing the lawyers thursday at 11", "lunch thursday",
  "call with Bob at 2 thursday", "the offsite is friday all day",
  "Priya wants 30 minutes thursday", "Bob asked for time thursday afternoon",
],
"moving": [
  "move the board call to friday at 2", "reschedule the standup to thursday at 10",
  "shift the exec staff to 11", "push the board call to friday",
  "bump the standup to 10", "postpone the board call to next week",
  "put off the standup until friday", "defer the board call to monday",
  "slide the standup to 9:30", "change the board call to friday at 3",
  "switch the standup to 10", "the board call is now friday at 2",
  "board call moved to friday at 2", "let's do the standup at 10 instead",
  "can we do the board call friday instead", "do the standup thursday instead",
  "move the board call to the same time friday", "board call to friday same time",
  "move my 2pm to 4", "move my thursday 9am to friday",
  "shift everything on wednesday to thursday", "move all my thursday meetings to friday",
],
"cancelling one": [
  "cancel the board call", "delete the standup", "remove the exec staff",
  "drop the board call", "scrap the standup", "bin the board call",
  "axe the standup", "ditch the exec staff", "nix the board call",
  "kill the standup", "call off the board call", "take the standup off my calendar",
  "get rid of the board call", "the board call is cancelled",
  "the standup is off", "exec staff isn't happening", "board call fell through",
  "we're not doing the standup", "I don't need the exec staff any more",
  "skip the standup", "skip tomorrow's standup", "I can't make the board call",
  "bail on the standup", "I'm going to have to miss the exec staff",
  "cancel my 2pm", "cancel the 9am", "cancel thursday's standup",
],
"cancelling many": [
  "clear my thursday", "wipe friday", "cancel everything thursday",
  "clear my calendar this week", "cancel all my meetings friday",
  "empty out thursday afternoon", "clear thursday morning",
  "cancel everything with Bob", "cancel my meetings with Priya this week",
  "clear the rest of today", "wipe out next week", "cancel the whole day thursday",
  "get rid of everything friday", "nothing on thursday any more",
  "cancel the first two things thursday",
],
"resizing": [
  "make the board call 30 minutes", "shorten the standup to 10 minutes",
  "extend the board call to 2 hours", "trim the exec staff to 45 minutes",
  "cut the board call in half", "give the standup another 15 minutes",
  "add half an hour to the board call", "the exec staff only needs 20 minutes",
  "make the standup half an hour", "the board call is running long, make it 90 minutes",
  "knock 15 minutes off the exec staff", "the standup is 5 minutes now",
],
"renaming and details": [
  "rename the board call to partner sync", "call the standup the daily",
  "the board call is about the term sheet", "add a note to the board call",
  "the exec staff is on zoom", "move the board call to the boardroom",
  "the standup is in person now", "make the board call a video call",
],
"attendees": [
  "add Tom to the board call", "invite Bob to the standup",
  "Priya is joining the exec staff", "drop Bob from the standup",
  "remove Priya from the board call", "it's just me on the standup now",
  "who's coming to the board call", "who am I meeting thursday",
],
"recurring": [
  "repeat the standup every weekday at 9", "make the 1:1 weekly",
  "standup every morning at 9", "book a monthly review first monday at 10",
  "every other tuesday at 3 with Priya", "stop the standup repeating",
  "cancel all future standups", "skip next week's standup",
  "cancel just thursday's standup", "move all future standups to 10",
  "the standup is fortnightly now",
],
"queries — one thing": [
  "when is the board call", "what time is the standup", "how long is the board call",
  "where is the exec staff", "is the board call still on", "who's in the board call",
  "what's the board call about", "when's my 1:1 with Priya",
],
"queries — a day or span": [
  "what do I have thursday", "what's on friday", "show me thursday",
  "list my meetings friday", "what does next week look like",
  "how busy is thursday", "read me thursday", "anything friday afternoon",
  "what's my week look like", "how many meetings thursday",
  "what's my busiest day", "am I overbooked this week",
  "what's left today", "anything else today",
],
"queries — availability": [
  "am I free thursday", "when can I fit an hour", "where are my gaps friday",
  "do I have time thursday afternoon", "find me 90 minutes this week",
  "what's my longest free stretch thursday", "am I free at 2 thursday",
  "is thursday at 3 free", "do I have anything at 2 on thursday",
],
"queries — conflicts": [
  "do I have any conflicts thursday", "is anything double booked",
  "does the board call clash with anything", "what overlaps thursday",
],
"queries — next": [
  "what's next", "when's my next meeting", "what's after the standup",
  "how long until my next meeting", "what's first tomorrow",
],
"tasks": [
  "add a task to call the bank", "remind me to sign the lease",
  "I need to review the term sheet", "new task: chase legal",
  "mark the term sheet done", "I finished the board deck",
  "the lease is done", "tick off the term sheet",
  "delete the sign the lease task", "delegate the board deck to Priya",
  "hand the term sheet to Bob", "rename the board deck to investor deck",
  "the board deck will take 8 hours", "the term sheet is due friday",
  "make the board deck high priority", "the lease is critical",
  "reopen the term sheet", "what tasks do I have", "what's overdue",
],
"work planning": [
  "plan my day", "plan my week", "what should I work on",
  "spread the board deck over this week", "give the term sheet an hour a day",
  "will the board deck fit", "am I going to make the deadline",
  "what should I drop", "what's at risk", "how's the Series B going",
  "how much work do I have left", "what's most urgent",
],
"holding and protecting": [
  "no meetings before 10 thursday", "nothing after 4 friday",
  "keep thursday morning free", "protect friday afternoon",
  "no calls on thursday", "block out lunch every day",
],
"vague and hedged": [
  "sometime thursday", "whenever suits thursday", "put an hour in wherever it fits thursday",
  "book something with Bob this week", "get me time with Priya soon",
  "I need to see Tom at some point", "find time for the board deck",
],
"odd time expressions": [
  "book a call thursday at noon", "lunch at midday friday",
  "call Bob first thing thursday", "review at the end of the day thursday",
  "board call at COB friday", "standup at half past nine thursday",
  "call at quarter to three thursday", "meeting at 14:30 thursday",
  "call thursday morning", "review thursday evening",
  "book something a week thursday", "call in two weeks at 3",
  "meeting the day after tomorrow at 2", "review this time next week",
  "board call at 3 o'clock thursday", "call at 3:00pm thursday",
],
};

let total = 0, ok = 0;
const fails = [];
for (const [group, list] of Object.entries(G)) {
  let g = 0;
  for (const q of list) {
    const s = seed();
    let r;
    try { r = ask(q, s(), { now: NOW }); } catch (e) { r = { miss: "THREW", text: e.message, intent: "?" }; }
    const good = !r.miss;
    total++;
    if (good) { ok++; g++; } else fails.push([group, q, r.miss, (r.text||"").slice(0,50).replace(/\n/g," ")]);
  }
  const pct = Math.round(100*g/list.length);
  console.log(`${String(pct).padStart(3)}%  ${group}  (${g}/${list.length})`);
}

// Follow-ups only mean anything against the turn before them, so they run as
// one conversation rather than as isolated sentences.
{
  const s = seed();
  let g = 0;
  const thread = ["book lunch thursday at 12", "no, make it 1", "make it 30 minutes",
                  "with Tom too", "move it to 3", "cancel it", "undo", "never mind"];
  for (const q of thread) {
    let r;
    try { r = ask(q, s(), { now: NOW }); } catch (e) { r = { miss: "THREW", text: e.message }; }
    total++;
    if (!r.miss) { ok++; g++; } else fails.push(["corrections", q, r.miss, (r.text||"").slice(0,50)]);
  }
  console.log(`${String(Math.round(100*g/thread.length)).padStart(3)}%  corrections and follow-ups  (${g}/${thread.length})`);
}

console.log(`\n${ok}/${total} = ${Math.round(100*ok/total)}%\n`);
for (const [g,q,m,t] of fails) console.log(`  [${g}] ${JSON.stringify(q)}  → ${m} | ${t}`);

const FLOOR = 95;
const pct = Math.round(100 * ok / total);
if (pct < FLOOR) {
  console.log(`\nFAIL — vocabulary ${pct}%, floor is ${FLOOR}%`);
  process.exit(1);
}
console.log(`\nPASS — vocabulary ${pct}%`);
