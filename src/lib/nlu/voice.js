/**
 * How the assistant speaks.
 *
 * The register is a good executive assistant: warm, brief, precise, never
 * chatty. Composition is deterministic like everything else — templates with
 * light variation, not generated prose.
 *
 * One deliberate restraint: the greeting appears on the acknowledgement line
 * only, not again on the answer. "Good morning, Mr. Newman" twice in four
 * seconds reads as a machine performing politeness rather than someone being
 * polite.
 */

export const HONORIFICS = ["Mr.", "Mrs.", "Ms.", "Mx.", "Dr."];

/** "Mr. Newman", "Logan", or "" when they'd rather not be addressed. */
export function addressOf(identity = {}) {
  const { honorific, lastName, firstName, style } = identity;
  if (style === "none") return "";
  if (honorific && lastName) return `${honorific} ${lastName}`;
  if (firstName) return firstName;
  if (lastName) return lastName;
  return "";
}

export function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** Line shown while the lookup runs. */
export function acknowledge(identity, kind, now = new Date()) {
  const who = addressOf(identity);
  const suffix = who ? `, ${who}` : "";
  const work = {
    query_day: "checking your calendar now",
    query_free: "looking for open time",
    plan_day: "working through your priorities",
    move_event: "updating your calendar",
    cancel_event: "updating your calendar",
    create_event: "putting that in",
    create_task: "adding that",
    complete_task: "marking that off",
    delegate_task: "handing that over",
  }[kind] || "one moment";
  return `${greeting(now)}${suffix} — ${work}.`;
}

const ARTICLE = /^(?:the|a|an|our|my|their|this|that)\s+/i;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * What a person would have typed in the title field.
 *
 * The subject is the most useful thing to lead with — "Term sheet with Priya"
 * tells you what the block is for at a glance, where "Call with Priya" makes
 * you open it. Falls back through who it's with, then the noun that was
 * actually used, so a lunch reads "Lunch with Bob" and not "Meeting with Bob".
 */
export function composeTitle({ title, subject, people = [], kindNoun } = {}) {
  if (title) return title;              // they named it outright; leave it alone
  const who = joinNames(people.map((x) => (typeof x === "string" ? x : x.name)));
  const topic = subject ? subject.replace(ARTICLE, "").trim() : "";
  const noun = kindNoun ? cap(kindNoun) : "Meeting";

  if (topic && who) return `${cap(topic)} with ${who}`;
  if (topic) return cap(topic);
  if (who) return `${noun} with ${who}`;
  return noun;
}

const NUMBER = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
export const spell = (n) => (n <= 10 ? NUMBER[n] : String(n));

const timeOf = (d) =>
  new Date(d).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** "Bob", "Bob and John", "Bob, John, and Sarah" */
export function joinNames(names) {
  const list = names.filter(Boolean);
  if (!list.length) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * True when the title says nothing the sentence hasn't already said.
 *
 * "Meeting with Bob" is what the assistant itself names a booking that had no
 * title, so reading it back produces "you're meeting with Bob — Meeting with
 * Bob." Anything with real words left in it, like "Q3 board review", is worth
 * saying.
 */
function saysNothingNew(title, names) {
  const rest = title
    .replace(/\b(?:meeting|call|sync|chat|catch ?up|appointment|event|block|1:1|one on one)\b/gi, " ")
    .replace(/\b(?:with|and|the|a|an)\b/gi, " ")
    .replace(names.length ? new RegExp(`\\b(?:${names.map(esc).join("|")})\\b`, "gi") : /$^/, " ")
    .replace(/[^a-z0-9]/gi, "");
  return rest.length === 0;
}

/**
 * One meeting, as a sentence.
 *   "At 10:00 AM you're meeting with Bob about the Q3 pipeline."
 * Falls back gracefully as detail runs out — an event with no attendees and no
 * subject still reads as English, not as a template with holes in it.
 */
export function describeMeeting(event, index = 0) {
  const at = `At ${timeOf(event.start)}`;
  const names = (event.attendees || []).map((a) => (typeof a === "string" ? a : a.name)).filter(Boolean);
  const people = joinNames(names);
  const about = (event.notes || "").trim();

  // Vary the verb slightly so a list of four doesn't drum.
  const verb = index % 2 === 0 ? "you're meeting with" : "you're with";

  if (people && about) return `${at} ${verb} ${people} about ${about}.`;
  if (people) {
    return saysNothingNew(event.title, names)
      ? `${at} ${verb} ${people}.`
      : `${at} ${verb} ${people} — ${event.title}.`;
  }
  if (about) return `${at} you have ${event.title} about ${about}.`;
  return `${at} you have ${event.title}.`;
}

/**
 * Full answer to "what do I have Tuesday?".
 * @param {string} dayLabel  "Tuesday", "today", "tomorrow"
 */
export function describeDay(dayLabel, events, dueTasks = []) {
  if (!events.length && !dueTasks.length) {
    return `${dayLabel} is clear — nothing scheduled and nothing due.`;
  }

  const lines = [];
  if (events.length) {
    const n = spell(events.length);
    lines.push(
      `You have ${n} ${events.length === 1 ? "meeting" : "meetings"} ${dayLabel.toLowerCase().startsWith("today") || dayLabel.toLowerCase().startsWith("tomorrow") ? dayLabel.toLowerCase() : `on ${dayLabel}`}.`,
    );
    lines.push("");
    events.forEach((e, i) => lines.push(describeMeeting(e, i)));
  }

  if (dueTasks.length) {
    if (lines.length) lines.push("");
    const n = spell(dueTasks.length);
    lines.push(`${events.length ? "You also have" : "You have"} ${n} ${dueTasks.length === 1 ? "task" : "tasks"} due: ${joinNames(dueTasks.map((t) => t.title))}.`);
  }

  return lines.join("\n");
}

/**
 * The line that goes out before anything is written.
 *
 * Reads back the whole proposal, not just the part that was inferred — the
 * point is that one glance confirms every detail, including the ones the user
 * never said out loud.
 */
export function confirmLine(identity, desc) {
  const who = addressOf(identity);
  return who
    ? `Okay, ${who} — just to confirm: ${desc}?`
    : `Just to confirm: ${desc}?`;
}

/** Closing courtesy, used sparingly — on answers, not on every confirmation. */
export function signOff(identity) {
  const who = addressOf(identity);
  return who ? `Anything else, ${who}?` : "";
}
