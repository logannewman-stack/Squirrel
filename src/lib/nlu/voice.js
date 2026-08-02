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

/**
 * One meeting, as a sentence.
 *   "At 10:00 AM you're meeting with Bob about the Q3 pipeline."
 * Falls back gracefully as detail runs out — an event with no attendees and no
 * subject still reads as English, not as a template with holes in it.
 */
export function describeMeeting(event, index = 0) {
  const at = `At ${timeOf(event.start)}`;
  const people = joinNames((event.attendees || []).map((a) => (typeof a === "string" ? a : a.name)));
  const about = (event.notes || "").trim();

  // Vary the verb slightly so a list of four doesn't drum.
  const verb = index % 2 === 0 ? "you're meeting with" : "you're with";

  if (people && about) return `${at} ${verb} ${people} about ${about}.`;
  if (people) return `${at} ${verb} ${people} — ${event.title}.`;
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

/** Closing courtesy, used sparingly — on answers, not on every confirmation. */
export function signOff(identity) {
  const who = addressOf(identity);
  return who ? `Anything else, ${who}?` : "";
}
