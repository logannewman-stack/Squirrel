/**
 * Conversational memory.
 *
 * Without it, every message is parsed as if it were the first — which is how
 * "no, schedule it for Friday" becomes a brand new event called "No schedule
 * it" instead of moving the meeting you just made.
 *
 * Three things are worth remembering, and only three:
 *
 *   focus — the last event or task the assistant actually touched, so "it",
 *           "that", and "the meeting" have something to point at.
 *   topic — the day the conversation is about, so "book a 2pm" right after
 *           "what does Friday look like?" lands on Friday, not today.
 *   frame — the last command's intent and slots, so a fragment can inherit
 *           what it doesn't restate.
 *
 * Memory expires on its own. A reference to "it" forty minutes later is far
 * more likely to be a new thought than a follow-up, and silently amending a
 * meeting the user has stopped thinking about is worse than asking.
 */

export const STALE_MS = 30 * 60 * 1000;
const MAX_TURNS = 12;

export const EMPTY_MEMORY = { turns: [] };

/** Slots worth carrying forward. Anything derived is recomputed, not stored. */
export function carryable(slots) {
  return {
    durationMins: slots.durationMins ?? null,
    priority: slots.priority ?? null,
    person: slots.person ?? null,
    people: slots.people?.length ? slots.people : null,
    subject: slots.subject ?? null,
    // Deliberately absent: title. A title belongs to one specific thing, and
    // carrying it forward means a later fragment gets named after an earlier
    // sentence — which is how a booking ended up called "Then can you book".
    subjectPhrase: slots.subjectPhrase ?? null,
    kindNoun: slots.kindNoun ?? null,
  };
}

/**
 * @param {object} memory
 * @param {{intent: string, slots: object, entity: object|null, day: string|null, text: string}} turn
 */
export function remember(memory, turn, at = Date.now()) {
  const turns = [...(memory?.turns || []), { at, ...turn }];
  return { turns: turns.slice(-MAX_TURNS) };
}

/** The previous turn, or null if the thread has gone cold. */
export function lastTurn(memory, now = new Date()) {
  const turns = memory?.turns || [];
  const t = turns[turns.length - 1];
  if (!t) return null;
  return now.getTime() - t.at > STALE_MS ? null : t;
}

/**
 * The live entity the last turn acted on.
 *
 * Re-read from state every time rather than trusted from memory: the thing may
 * have been deleted, or edited elsewhere, since it was mentioned.
 */
export function focusOf(memory, state, now = new Date()) {
  const t = lastTurn(memory, now);
  if (!t?.entity) return null;
  const pool = t.entity.kind === "event" ? state.events : state.tasks;
  const item = pool.find((x) => x.id === t.entity.id);
  return item ? { kind: t.entity.kind, item } : null;
}

/**
 * The day under discussion, as a Date at local midnight.
 *
 * Walks back through recent turns rather than reading only the last one, so
 * "what does Friday look like?" → "anything due then?" → "book a 2pm" all stay
 * on Friday. Today is not a topic — it is the default, and treating it as one
 * would make every conversation sticky to the current date.
 */
export function topicDay(memory, now = new Date()) {
  const turns = memory?.turns || [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (now.getTime() - t.at > STALE_MS) return null;
    if (t.day) {
      const [y, m, d] = t.day.split("-").map(Number);
      const date = new Date(y, m - 1, d);
      date.setHours(0, 0, 0, 0);
      // A day that has already passed is history, not a topic.
      const midnight = new Date(now);
      midnight.setHours(0, 0, 0, 0);
      if (date < midnight) return null;
      return date.getTime() === midnight.getTime() ? null : date;
    }
  }
  return null;
}

/**
 * Merge a fragment onto the previous frame.
 *
 * Only slots the new message actually supplies win — an absent slot inherits,
 * an explicitly stated one overrides. This is what lets "Wednesday at 2" finish
 * a "move the exec staff meeting" that stopped to ask when.
 */
/**
 * Always populated, because they default to the whole message rather than to
 * nothing. Treating them as freshly stated would let "Wednesday at 2" replace
 * the description of which meeting to move — with itself.
 */
const DERIVED = new Set(["subjectPhrase", "targetPhrase"]);

export function inherit(p, prior) {
  const fresh = {};
  for (const [k, v] of Object.entries(p.slots)) {
    if (DERIVED.has(k) && p.intent === "unknown") continue;
    const present = Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== false;
    if (present) fresh[k] = v;
  }
  return {
    ...p,
    inherited: true,
    intent: p.intent === "unknown" ? prior.intent : p.intent,
    slots: { ...p.slots, ...(prior.slots || {}), ...fresh },
  };
}
