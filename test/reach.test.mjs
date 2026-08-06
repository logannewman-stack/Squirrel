/**
 * Reach, measured by consequence.
 *
 * `coverage.test.mjs` asks whether a sentence is classified. `act.test.mjs`
 * asks whether specific sentences do the right thing. This asks the blunter
 * question in between: across a wide sweep of what someone might reasonably
 * say, how much of it actually *does* something — changes data, or answers
 * with more than an apology.
 *
 * It found the honest number when the classifier was reporting 100%: 58%. The
 * gap was whole capabilities that had no handler behind them at all. It is
 * kept as a floor rather than a target, because the failure it guards against
 * is adding vocabulary without adding the thing the vocabulary asks for.
 */
import { store, ask, iso, reset } from "./harness.mjs";
const NOW = new Date(2026, 7, 5, 9, 0);
const S = () => store.getState();

function seed() {
  reset({ confirm: false });
  store.setSetting("hours", { start: "08:00", end: "18:00", capacityMins: 300, days: [1,2,3,4,5], breaks: [] });
  const p = store.addProject({ name: "Series B raise", due: "2026-08-28" });
  store.addProject({ name: "Munich lease", due: "2026-09-10" });
  store.addEvent({ title: "Exec staff", start: iso(2026,8,5,9), end: iso(2026,8,5,10), attendees: [{name:"Bob"}] });
  store.addEvent({ title: "Meridian partner call", start: iso(2026,8,5,15), end: iso(2026,8,5,16) });
  store.addEvent({ title: "Board prep", start: iso(2026,8,6,11), end: iso(2026,8,6,12) });
  store.addEvent({ title: "Lunch with Priya", start: iso(2026,8,7,12), end: iso(2026,8,7,13) });
  store.addTask({ projectId: p.id, title: "Board deck", estimateMins: 240, due: "2026-08-12", priority: "high" });
  store.addTask({ projectId: p.id, title: "Revised term sheet", estimateMins: 90, due: "2026-08-10" });
  store.addTask({ title: "Sign the Munich lease", estimateMins: 45, due: "2026-08-14" });
  store.addTask({ title: "Diligence index", estimateMins: 60 });
}

const CORPUS = {
  "edit a task by name": [
    "the lease is about 45 minutes", "make the board deck high priority",
    "the term sheet is due friday", "the diligence index will take 2 hours",
    "rename the board deck to Q3 board deck", "delete the diligence index task",
    "the board deck is not due until next week", "bump the term sheet to critical",
    "mark the board deck as low priority", "the munich lease is 3 hours of work",
  ],
  "undo": ["undo that", "undo", "put it back", "revert that", "never mind, undo it", "actually undo"],
  "what now": [
    "what should i do right now", "what's next", "what am i doing now",
    "what should i be working on", "give me something to do", "what's first",
  ],
  "recurring": [
    "every monday at 9 standup", "weekly exec staff monday 9am", "a daily standup at 9",
    "repeat the board prep every friday", "book a 1:1 with sarah every tuesday at 3",
  ],
  "relative moves": [
    "push my 3pm back 30 minutes", "move the exec staff an hour later",
    "move everything an hour later", "push the board prep forward 15 minutes",
    "shift my 3pm to 30 minutes earlier",
  ],
  "projects": [
    "start a new project called Atlas", "what projects do i have",
    "how is the series b raise going", "what's left on munich",
    "add a task to the series b raise to draft the FAQ",
  ],
  "notes and place": [
    "book a call with bob friday at 2 at the office",
    "add a note to the board prep: bring the term sheet",
    "where is the exec staff", "the meridian call is on zoom",
  ],
  "reopen and delete": [
    "delete the board deck task", "get rid of the diligence index task",
    "rename the board deck to Q3 deck", "retitle the term sheet to Series B terms",
  ],
  "searching history": [
    "when did i last meet bob", "how many meetings do i have this week",
    "how many tasks are open", "what's on my plate",
  ],
  "counting and totals": [
    "how many hours of work do i have left", "how much is on my plate this week",
    "how busy am i friday", "am i free friday afternoon",
  ],
};

const failed = [];
let total = 0, ok = 0;
for (const [group, list] of Object.entries(CORPUS)) {
  let g = 0;
  for (const q of list) {
    total++;
    seed();
    const before = JSON.stringify([S().events, S().tasks, S().projects]);
    let r;
    try { r = ask(q, S(), { now: NOW }); } catch (e) { r = { text: `THREW: ${e.message}` }; }
    const after = JSON.stringify([S().events, S().tasks, S().projects]);
    const dud = /didn't catch|couldn't find|not wired|THREW/i.test(r.text);
    const changed = before !== after;
    const answered = !dud && (changed || r.text.length > 30 || r.choices);
    if (answered) { ok++; g++; } else failed.push([group, q, r.text.slice(0, 78)]);
  }
  console.log(`${String(Math.round(g / list.length * 100)).padStart(3)}%  ${group}  (${g}/${list.length})`);
}
const pct = Math.round((ok / total) * 100);
console.log(`\n${ok}/${total} reach the point of doing something — ${pct}%\n`);
for (const [g, q, why] of failed) console.log(`  [${g}] "${q}"\n        → ${why}`);

const FLOOR = 90;
if (pct < FLOOR) {
  console.log(`\nFAIL — reach ${pct}%, floor is ${FLOOR}%`);
  process.exit(1);
}
console.log(`\nPASS — reach ${pct}%`);
