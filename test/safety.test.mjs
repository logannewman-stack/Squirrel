/**
 * Safety first, then the messy parts of real use.
 *
 * The other suites ask whether she understands and whether she acts correctly.
 * This one asks the question underneath both: can a sentence that was never
 * meant to destroy anything destroy something anyway.
 *
 * It has found that twice. "Drop Bob from the standup" deleted the standup,
 * because `drop` is a cancel verb. "Don't cancel the standup" cancelled the
 * standup, because nothing looked at the word in front of the verb. Both read
 * as successes to every other measurement in the repo — the sentence was
 * understood, an action was taken, a confirmation was printed. Only counting
 * the rows afterwards catches them.
 *
 * The rest is what real use looks like and unit tests usually skip: threads
 * where each turn depends on the last, dictation that drops apostrophes and
 * hears "too" for "to", two commands in one breath, hostile input, and the
 * date expressions that are one word away from being a day out.
 */
import { store, ask, iso, reset, t, report } from "./harness.mjs";
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
const nEv = () => store.getState().events.length;
const nTask = () => store.getState().tasks.filter(t => !t.done).length;

const check = (group, q, cond, why) => t(`${group}: ${q}`, cond, why);

// ------------------------------------------------ 1. NOTHING MAY VANISH
// Every one of these is non-destructive. If the event count drops, that is a
// data-loss bug regardless of what the reply said.
const SAFE = [
  "add Tom to the board call", "drop Bob from the exec staff",
  "remove Priya from the board call", "who's coming to the board call",
  "invite Tom to the standup", "it's just me on the standup now",
  "make the board call 30 minutes", "shorten the standup to 10 minutes",
  "knock 15 minutes off the exec staff", "give the standup another 15 minutes",
  "rename the board call to partner sync", "the board call is about the term sheet",
  "the exec staff is on zoom", "move the board call to friday at 2",
  "bring the standup forward an hour", "swap the standup and the board call",
  "what do I have thursday", "am I free thursday", "when's my next meeting",
  "how long is the board call", "who am I meeting thursday",
  "no meetings before 10 thursday", "keep friday morning free",
  "spread the board deck over this week", "plan my week", "what should I drop",
  "book a call with Bob thursday at 2", "repeat the standup every weekday at 9",
  "don't cancel the standup", "I don't want to cancel the board call",
  "why did you cancel the standup", "did I cancel the board call",
  "mark the term sheet done", "delegate the board deck to Priya",
  "what's my busiest day", "is anything double booked",
  "make the standup high priority", "the board deck will take 8 hours",
];
for (const q of SAFE) {
  const s = seed();
  const before = nEv();
  let r; try { r = ask(q, s(), { now: NOW }); } catch (e) { r = { text: "THREW " + e.message }; }
  check("nothing vanishes", q, nEv() >= before, `events ${before} → ${nEv()} | ${(r.text||"").slice(0,44)}`);
}

// Read-only requests must not change anything at all.
const READONLY = [
  "what do I have thursday", "am I free thursday", "when's my next meeting",
  "who's coming to the board call", "how busy is thursday", "what's at risk",
  "what should I work on", "how long is the board call", "what's my week look like",
  "where are my gaps thursday", "do I have any conflicts thursday",
  "what tasks do I have", "what's overdue", "how's the Series B going",
  "what are my working hours", "what time is it", "what's next",
];
for (const q of READONLY) {
  const s = seed();
  const before = JSON.stringify([store.getState().events, store.getState().tasks]);
  try { ask(q, s(), { now: NOW }); } catch {}
  check("read-only stays read-only", q,
    JSON.stringify([store.getState().events, store.getState().tasks]) === before, "state changed");
}

// ------------------------------------------------ 2. THREADS
const THREADS = [
  { name: "book then amend twice",
    turns: [["book lunch thursday at 12", null], ["no, make it 1", null], ["actually make it 90 minutes", null],
            ["and add Tom", null]],
    end: (s) => s.events.some(e => /lunch/i.test(e.title) && e.start === iso(2026,3,12,13,0)
                 && (new Date(e.end)-new Date(e.start))/60000 === 90
                 && (e.attendees||[]).some(a => /tom/i.test(a.name))) },
  { name: "ask then act on it",
    turns: [["when is the board call", null], ["move it to friday at 2", null]],
    end: (s) => s.events.some(e => e.title === "Board call" && e.start === iso(2026,3,13,14,0)) },
  { name: "ask then cancel it",
    turns: [["when is the board call", null], ["cancel it", null]],
    end: (s) => !s.events.some(e => e.title === "Board call") },
  { name: "topic switch does not leak",
    turns: [["when is the board call", null], ["what do I have friday", null], ["cancel it", null]],
    end: (s) => s.events.length >= 4 },
  { name: "correct a correction",
    turns: [["book a call thursday at 2", null], ["no, friday", null], ["no, saturday", null]],
    end: (s) => s.events.some(e => e.start.startsWith("2026-03-14")) },
  { name: "plural then act",
    turns: [["what do I have wednesday", null], ["move them an hour later", null]],
    end: (s) => s.events.some(e => e.title === "Board call" && e.start === iso(2026,3,11,15,0)) },
  { name: "undo after a bulk clear",
    turns: [["clear my wednesday", null], ["undo", null]],
    end: (s) => s.events.length === 5 },
  { name: "add person then ask who",
    turns: [["add Tom to the standup", null], ["who's coming to it", null]],
    end: (s) => (s.events.find(e => e.title === "Standup").attendees||[]).length === 1 },
  { name: "resize then move",
    turns: [["make the board call 30 minutes", null], ["and move it to friday at 2", null]],
    end: (s) => { const e = s.events.find(x => x.title === "Board call");
                  return e.start === iso(2026,3,13,14,0) && (new Date(e.end)-new Date(e.start))/60000 === 30; } },
  { name: "task then estimate then spread",
    turns: [["add a task to draft the memo", null], ["it will take 4 hours", null],
            ["spread it over this week", null]],
    end: (s) => { const t = s.tasks.find(x => /memo/i.test(x.title));
                  return t && t.estimateMins === 240 && t.due; } },
];
for (const th of THREADS) {
  const s = seed();
  let threw = null;
  for (const [q] of th.turns) {
    try { ask(q, s(), { now: NOW }); } catch (e) { threw = e.message; break; }
  }
  check("threads", th.name, !threw && th.end(store.getState()),
    threw || store.getState().events.map(e => `${e.title}@${e.start.slice(5,16)}`).join(" "));
}

// ------------------------------------------------ 3. DICTATION AND TYPOS
const TYPOS = [
  "schedjule a call with bob thursday at 2", "book a meating thursday at 2",
  "cancle the standup", "resechdule the board call to friday",
  "move the board call to tommorow at 3", "book lunch thurday at 12",
  "book lunch on wendesday at 1", "whats on my calender thursday",
  "add a taks to sign the lease", "delet the standup",
  "book a call at for pm thursday", "book a call thursday at too oclock",
  "book a call with bob at free thirty thursday", "canel my 2pm",
  "move teh standup to 10", "book lunch tomorow",
  "shedule a review friday at 10", "remind me too sign the lease",
];
for (const q of TYPOS) {
  const s = seed();
  let r; try { r = ask(q, s(), { now: NOW }); } catch (e) { r = { miss: "THREW", text: e.message }; }
  check("dictation and typos", q, !r.miss, `${r.miss} | ${(r.text||"").slice(0,40)}`);
}

// ------------------------------------------------ 4. COMPOUND COMMANDS
const COMPOUND = [
  "cancel the standup and book lunch thursday at 12",
  "move the board call to friday and add Tom",
  "book a call with Bob thursday at 2 and one with Priya at 3",
  "clear thursday and book a call friday at 10",
  "cancel the standup, and put a review in friday at 2",
  "add a task to sign the lease and one to call the bank",
  "make the board call 30 minutes and move it to 3",
];
for (const q of COMPOUND) {
  const s = seed();
  let r; try { r = ask(q, s(), { now: NOW }); } catch (e) { r = { miss: "THREW", text: e.message }; }
  check("compound", q, !r.miss, `${r.miss} | ${(r.text||"").slice(0,44)}`);
}

// ------------------------------------------------ 5. HOSTILE INPUT
const HOSTILE = [
  "", "   ", "\n\n", "?", "!!!", "...", "a", "1", "42", "🎉", "😀 book lunch thursday at 12",
  "BOOK LUNCH THURSDAY AT 12", "bOoK lUnCh ThUrSdAy At 12",
  "book lunch thursday at 12".repeat(30),
  "<script>alert(1)</script>", "'; DROP TABLE events; --",
  "book lunch at 25:00 thursday", "book lunch thursday at -3",
  "book a meeting on february 30th", "book a call at 99 oclock",
  "move the board call to yesterday", "book lunch on the 32nd",
  " ", "book lunch‮thursday",
];
for (const q of HOSTILE) {
  const s = seed();
  let threw = null, r = null;
  try { r = ask(q, s(), { now: NOW }); } catch (e) { threw = e.message; }
  check("hostile input", JSON.stringify(q.slice(0, 30)), !threw && r && typeof r.text === "string",
    threw || "no text returned");
}

// ------------------------------------------------ 6. DATE EDGES
const DATES = [
  ["book a call on the 31st at 2", (s) => s.events.some(e => /-31T14/.test(e.start))],
  ["book a call march 31st at 2", (s) => s.events.some(e => e.start.startsWith("2026-03-31"))],
  ["book a call on the last day of the month at 2", null],
  ["book a call next friday at 2", (s) => s.events.some(e => e.start.startsWith("2026-03-20"))],
  ["book a call this friday at 2", (s) => s.events.some(e => e.start.startsWith("2026-03-13"))],
  ["book a call a week today at 2", (s) => s.events.some(e => e.start.startsWith("2026-03-17"))],
  ["book a call in 3 days at 2", (s) => s.events.some(e => e.start.startsWith("2026-03-13"))],
  ["book a call in two weeks at 2", (s) => s.events.some(e => e.start.startsWith("2026-03-24"))],
  ["book a call on new years day at 2", null],
  ["book a call december 31st at 2", (s) => s.events.some(e => /-12-31T14/.test(e.start))],
  ["book a call at midnight thursday", null],
  ["book a call at 12am thursday", null],
  ["book a call at 12pm thursday", (s) => s.events.some(e => e.start === iso(2026,3,12,12,0))],
  ["book a call the day after tomorrow at 2", (s) => s.events.some(e => e.start === iso(2026,3,12,14,0))],
  ["book a call the monday after next at 2", null],
];
for (const [q, verify] of DATES) {
  const s = seed();
  let r; try { r = ask(q, s(), { now: NOW }); } catch (e) { r = { miss: "THREW", text: e.message }; }
  const understood = !r.miss;
  const right = !verify || verify(store.getState());
  check("date edges", q, understood && right,
    !understood ? `${r.miss}` : `wrong date — ${store.getState().events.map(e=>e.start).slice(-1)}`);
}

report("Safety, threads, dictation, and edges");
