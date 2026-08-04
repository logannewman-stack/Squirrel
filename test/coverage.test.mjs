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
"vague dates": ["book a call next week","schedule the review end of the week","find time in a couple of days","meeting on the 15th","a week from tuesday","put it in for eod friday","cob monday","first thing tomorrow","later today","this afternoon","early next week","end of month","in two weeks","the day after tomorrow","sometime this week","start of next month"],
  "loose durations": ["book half an hour with bob","a couple of hours on the deck","45 mins with priya","an hour and a half thursday","block out all morning friday","quick call with dana","a quick 15 with sarah","two and a half hours on the letter","the rest of the afternoon"],
  "other booking verbs": ["pencil in a call with bob friday","get the board prep on my calendar","find time for the deck this week","squeeze in 30 minutes with priya","clear my friday afternoon","free up tuesday morning","hold thursday 2 to 4","pop a review in monday","stick a call in wednesday","set aside 3 hours for the deck","carve out time thursday","make time for the letter"],
  "edit the length": ["make the board prep two hours","extend my 3pm by 30 minutes","shorten the exec staff to 30","trim the review to 45 minutes","double the deck block","cut the standup in half"],
  "recurring": ["every monday at 9 standup","weekly exec staff monday 9am","a daily standup at 9","repeat the board prep every friday","move all my mondays"],
  "about one thing": ["when is the board meeting","what time is my call with bob","where is the lease walkthrough","who am i meeting friday","how long is the exec staff","what's my next meeting","when's my first meeting tomorrow","is the board prep still on"],
  "progress": ["how much have i done this week","what did i do yesterday","how much time on the raise","how many hours did i focus","what did i finish today","how am i doing on focus"],
  "hours on work": ["the deck will take 8 hours","estimate 3 hours for the letter","the lease is about 45 minutes","budget 2 hours for the review","that one is a 4 hour job"],
  "clearing": ["clear my afternoon","wipe friday","cancel everything tomorrow","move everything on friday to monday","clear the rest of today"],
  "polite combos": ["could you book a call with bob friday at 2","would you mind moving my 3pm","please cancel my 4pm","can you find me an hour thursday","do me a favour and clear friday","if you could, move the standup"],
  "removing": ["cancel my 4pm","delete the board prep","remove the standup","drop the friday lunch","call off the review","get rid of my 3pm","take the standup off my calendar","scrap the monday sync","kill the 2pm","bin the review","cancel tomorrow's lunch","i don't need the 3pm anymore","the exec staff is cancelled","cancel the meeting with bob","remove bob's meeting","delete everything friday","cancel all my meetings tomorrow","clear my calendar friday","wipe out thursday afternoon","cancel the rest of today","no longer need the board prep","drop everything monday morning","take friday off my calendar","cancel my meetings this week","free up my whole afternoon","empty out tuesday","that meeting is off","we cancelled the review","cancel and don't rebook","remove the term sheet call"],
  "adding": ["add a meeting with bob friday at 2","put a call with priya on friday","new meeting thursday at 10","create an event monday at 9","book bob for 2pm friday","set up a call with dana","schedule time with anders tuesday","i need a meeting with sarah friday","let's do 3pm thursday with bob","get me 30 minutes with priya","stick lunch in friday at noon","add a 1:1 with sarah mondays at 3","put down a review for wednesday","slot in a call with bob","throw a meeting on friday at 4","i want to meet bob friday at 2","need to see anders tuesday","meeting friday 2pm bob","book the boardroom thursday 9 to 11","reserve two hours friday morning","pop in a coffee with priya","arrange a call with the client friday","organise a review for thursday","line up a call with dana monday","have bob at 3 on friday","put bob in for friday at 2","give me an hour thursday","open a slot for the deck friday"],
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

/**
 * Routing, not just recognition.
 *
 * Coverage says a message landed somewhere. This says it landed in the right
 * place — the risk every new pattern carries is stealing a phrasing from an
 * older intent, and "shorten the exec staff" quietly becoming a move is the
 * kind of regression a coverage number is blind to.
 */
const ROUTES = {
  "move my 3pm to friday": "move_event",
  "push the review to friday": "move_event",
  "cancel my 4pm": "cancel_event",
  "what does friday look like": "query_day",
  "when am i free thursday": "query_free",
  "schedule a call with bob friday at 2": "create_event",
  "block 2 hours thursday for the deck": "create_event",
  "add a task to sign the lease": "create_task",
  "mark the deck done": "complete_task",
  "delegate the lease to anders": "delegate_task",
  "plan my week": "plan_day",
  "what is most urgent": "plan_day",
  "where is the lease walkthrough": "query_event",
  "how long is the exec staff": "query_event",
  "when is the board meeting": "query_event",
  "what time is my call with bob": "query_event",
  "how much have i done this week": "query_progress",
  "what did i do yesterday": "query_progress",
  "shorten the exec staff to 30": "resize_event",
  "extend my 3pm by 30 minutes": "resize_event",
  "cut the standup in half": "resize_event",
  "make the board prep two hours": "resize_event",
};
let misrouted = 0;
for (const [q, want] of Object.entries(ROUTES)) {
  const got = parse(q, NOW).intent;
  if (got !== want) { misrouted++; console.log(`MISROUTED "${q}" → ${got}, wanted ${want}`); }
}
console.log(misrouted ? `${misrouted} misrouted` : `${Object.keys(ROUTES).length} route correctly`);

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
if (pct < 98 || swallowed || misrouted) {
  console.log(`\nFAIL — coverage ${pct}%, ${swallowed} swallowed, ${misrouted} misrouted`);
  process.exit(1);
}
console.log(`\nPASS — coverage ${pct}%, nothing swallowed, nothing misrouted`);
