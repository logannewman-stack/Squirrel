/**
 * Conversational coverage, measured rather than asserted.
 *
 * Every other suite checks that a specific phrasing does the right thing. This
 * one checks the opposite risk: that the phrasings nobody wrote a test for
 * still land somewhere. A single unrecognised "hi there" reads as broken, and
 * the only way to know the rate is to count it.
 *
 * Two failure modes, both fatal, so both are enforced:
 *   coverage — anything falling through to "I didn't catch that"
 *   swallowing — a real request eaten by the politeness layer, which is what
 *                widening the courtesy patterns risks every time
 */
import { classify } from "../src/lib/nlu/smalltalk.js";
import { parse } from "../src/lib/nlu/parse.js";
const NOW = new Date(2026, 7, 3, 9, 0);

const understand = (q) => {
  const small = classify(q);
  if (small) return `small:${small}`;
  const p = parse(q, NOW);
  if (p.intent !== "unknown") return p.intent;
  if (p.slots.rename) return "rename";
  if (p.repair || p.amend || p.fragment) return "follow-up";
  return null;
};

const CORPUS = {
  "greetings": ["hi","hello","hey","yo","hiya","howdy","sup","hi there","hey there","hello again","hey squirrel","good morning","good afternoon","good evening","morning","evening","hey there buddy","hello!","hi!!","gm","heya","hey you"],
  "how are you": ["how are you","how are you doing","how's it going","hows it going","how are things","what's up","whats up","you good","you okay","how's your day","how do you do","you there","how's life"],
  "thanks": ["thanks","thank you","thanks so much","thx","ty","cheers","appreciate it","nice","perfect","great","awesome","amazing","you're the best","well done","good job","thank you so much","much appreciated"],
  "goodbye": ["bye","goodbye","see you","see you later","see ya","later","goodnight","good night","talk soon","i'm off","that's all","that will be all","catch you later","night"],
  "apology / ack": ["sorry","my bad","oops","whoops","my mistake","nevermind","cool","got it","understood","makes sense","sounds good","fair enough","ok cool","alright"],
  "time & date": ["what time is it","what's the time","time?","what day is it","what's the date","what is today's date","what's today","current time"],
  "identity": ["who are you","what are you","what's your name","are you an ai","are you a robot","are you real","what can you do","what do you do","how do you work"],
  "counts": ["how many tasks do i have","how many meetings today","how many projects","what do i have left","what do i have open"],
  "day queries": ["what does friday look like","what do i have tuesday","what's on today","show me tomorrow","what's my schedule","agenda for thursday","what's going on monday","do i have anything friday","am i busy tomorrow"],
  "free time": ["when am i free","when am i free thursday","any open time tomorrow","do i have any gaps friday","when can i fit an hour"],
  "create event": ["schedule a meeting with bob tomorrow at 2","book a call with priya friday at 10","block 2 hours thursday for the board deck","lunch with anders friday at 12","set up a 1:1 with sarah monday at 3","put a review on my calendar wednesday at 4","meeting with the team tuesday 9am","30 minute call with dana at 11"],
  "create task": ["add a task to sign the lease","remind me to call the bank","new task review the deck due friday","i need to draft the letter by tuesday","add sign the munich lease, high priority, due friday","todo: send the diligence index"],
  "move / cancel": ["move my 3pm to friday","reschedule the board prep to wednesday at 2","push the exec staff to next week","cancel my 4pm","delete the munich walkthrough","drop the friday lunch","postpone the term sheet review"],
  "complete / delegate": ["mark the term sheet done","complete the lease task","i finished the board deck","delegate the lease to anders","assign the letter to priya","hand off the data room to sarah"],
  "planning & pacing": ["plan my day","plan my week","what should i work on","what's most urgent","will the board deck fit","am i behind on the raise","how is the board cycle going","how much is left on munich","spread the deck out","when will i finish the letter","triage my tasks"],
  "corrections": ["no make it monday","actually make it an hour","no for friday","make it 3pm","push it to thursday","call it board prep","no cancel it","instead do it tuesday"],
  "out of scope": ["what's the capital of france","what's the weather","tell me a joke","write me a poem","who won the game","translate this","define serendipity"],
};

let total = 0, got = 0;
const gaps = [];
for (const [group, list] of Object.entries(CORPUS)) {
  let g = 0;
  for (const q of list) {
    total++;
    const r = understand(q);
    if (r) { got++; g++; } else gaps.push([group, q]);
  }
  const pct = Math.round((g / list.length) * 100);
  const bar = "█".repeat(Math.round(pct / 5)).padEnd(20, "·");
  console.log(`${bar} ${String(pct).padStart(3)}%  ${group}  (${g}/${list.length})`);
}
console.log(`\n${got}/${total} understood — ${Math.round((got / total) * 100)}%`);
if (gaps.length) {
  console.log(`\nFalls through to "I didn't catch that":`);
  for (const [g, q] of gaps) console.log(`  [${g}] ${q}`);
}

// A courtesy layer that eats requests is worse than one that misses
// courtesies: the first loses work, the second only looks rude.
const MUST_REACH_PARSER = [
  "hi, what does friday look like", "thanks, now book lunch friday",
  "sorry i meant tuesday at 4", "morning meeting with bob",
  "good morning meeting tomorrow", "later today book a call",
  "cool, schedule it for monday", "ok move my 3pm",
  "nice, add a task to sign the lease", "right, cancel the 4pm",
  "great, what do i have thursday", "how many hours on the deck",
  "you free thursday", "are you able to move my 3pm",
];
let swallowed = 0;
for (const q of MUST_REACH_PARSER) {
  const c = classify(q);
  if (c) { swallowed++; console.log(`SWALLOWED as ${c}: ${q}`); }
}
console.log(swallowed ? `${swallowed} requests swallowed by small talk` : `${MUST_REACH_PARSER.length} requests still reach the parser`);

const pct = Math.round((got / total) * 100);
if (pct < 98 || swallowed) {
  console.log(`\nFAIL — coverage ${pct}%, ${swallowed} swallowed`);
  process.exit(1);
}
console.log(`\nPASS — coverage ${pct}%, nothing swallowed`);
