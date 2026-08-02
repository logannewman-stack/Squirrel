/**
 * What deserves an interruption, and when.
 *
 * Kept entirely separate from how a notification is delivered. This module
 * decides; lib/notify.js delivers. That split is what lets the whole rule set
 * be tested without a device, a permission prompt, or a native shell — and
 * lets the same rules drive a web notification today and an iOS one later
 * without being rewritten.
 *
 * The bar for firing is deliberately high. A planner that pings all day gets
 * its permission revoked within a week, and then it cannot reach the user even
 * when it matters. Four kinds earn it:
 *
 *   meeting   — you have to be somewhere, shortly.
 *   focus     — a block of work you set aside is starting.
 *   digest    — one morning summary, instead of a notification per item.
 *   deadline  — the work no longer fits in the time left. This is the only
 *               one that is genuinely urgent, because it is the only one the
 *               user cannot see coming by looking at today.
 *
 * Everything here is derived from state, so the same input always produces the
 * same reminders. Ids are stable and content-addressed: rescheduling a meeting
 * changes its reminder's id, which is what lets the delivery layer cancel the
 * stale one instead of firing both.
 */

const MIN = 60000;

export const DEFAULTS = {
  meetingLeadMins: 10,
  focusLeadMins: 0,
  digestHour: 8,
  meetings: true,
  focus: true,
  digest: true,
  deadlines: true,
};

const pad = (n) => String(n).padStart(2, "0");
const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (day, h, m = 0) => new Date(`${day}T${pad(h)}:${pad(m)}:00`);

/**
 * A stable id that changes when the thing it describes changes.
 *
 * Not a random id and not just the entity id: if a meeting moves, the old
 * reminder has to be cancellable and the new one has to look different. Hashing
 * the kind, the subject, and the fire time gives both for free.
 */
function idFor(kind, entityId, when) {
  const key = `${kind}:${entityId}:${when.getTime()}`;
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
  return `sq_${kind}_${(h >>> 0).toString(36)}`;
}

const hours = (m) => (m >= 60 ? `${+(m / 60).toFixed(m % 60 ? 1 : 0)}h` : `${m}m`);
const clock = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * Every reminder that should be pending, for the window ahead.
 *
 * @param {object} state    projects/tasks/events/blocks/sessions
 * @param {object} settings notification preferences, merged over DEFAULTS
 * @param {Date}   now
 * @param {number} horizonDays how far ahead to schedule. The OS holds a finite
 *   number of pending local notifications, so this is a real budget, not a
 *   formality — iOS keeps 64.
 * @returns {Array<{id, at, kind, title, body, entityId}>} sorted by time
 */
export function pending(state, settings = {}, now = new Date(), horizonDays = 7) {
  const s = { ...DEFAULTS, ...settings };
  const out = [];
  const until = new Date(now.getTime() + horizonDays * 86400000);
  const soon = (d) => d > now && d <= until;

  // ---- meetings: one, shortly before, and only if there is time to act on it
  if (s.meetings) {
    for (const e of state.events || []) {
      const start = new Date(e.start);
      const when = new Date(start.getTime() - s.meetingLeadMins * MIN);
      if (!soon(when)) continue;
      const who = (e.attendees || []).map((a) => (typeof a === "string" ? a : a.name)).filter(Boolean);
      out.push({
        id: idFor("meeting", e.id, when),
        at: when,
        kind: "meeting",
        entityId: e.id,
        title: e.title,
        body:
          `${clock(start)}` +
          (who.length ? ` with ${who.join(" and ")}` : "") +
          (e.location ? ` · ${e.location}` : ""),
      });
    }
  }

  // ---- focus blocks: the work you already decided to do, starting now
  if (s.focus) {
    for (const b of state.blocks || []) {
      if (!b.start) continue;
      const start = new Date(b.start);
      const when = new Date(start.getTime() - s.focusLeadMins * MIN);
      if (!soon(when)) continue;
      const task = (state.tasks || []).find((t) => t.id === b.taskId);
      if (!task || task.done) continue;
      out.push({
        id: idFor("focus", `${b.taskId}:${b.day}:${b.start}`, when),
        at: when,
        kind: "focus",
        entityId: b.taskId,
        title: task.title,
        body: `${hours(b.mins)} set aside, starting ${clock(start)}.`,
      });
    }
  }

  // ---- one morning digest, in place of a notification per item
  if (s.digest) {
    for (let i = 0; i <= horizonDays; i++) {
      const d = new Date(now.getTime() + i * 86400000);
      const day = dayOf(d);
      const when = at(day, s.digestHour);
      if (!soon(when)) continue;
      const meetings = (state.events || []).filter((e) => e.start.slice(0, 10) === day);
      const blocks = (state.blocks || []).filter((b) => b.day === day);
      const due = (state.tasks || []).filter((t) => !t.done && t.due === day);
      if (!meetings.length && !blocks.length && !due.length) continue;

      const bits = [];
      if (meetings.length) bits.push(`${meetings.length} ${meetings.length === 1 ? "meeting" : "meetings"}`);
      const focusMins = blocks.reduce((n, b) => n + b.mins, 0);
      if (focusMins) bits.push(`${hours(focusMins)} of focus`);
      if (due.length) bits.push(`${due.length} due`);
      out.push({
        id: idFor("digest", day, when),
        at: when,
        kind: "digest",
        entityId: day,
        title: i === 0 ? "Today" : d.toLocaleDateString([], { weekday: "long" }),
        body: bits.join(" · "),
      });
    }
  }

  // ---- the only genuinely urgent one: the work stopped fitting
  if (s.deadlines) {
    for (const sf of state.shortfalls || []) {
      // Morning of the next day — early enough to move something, late enough
      // not to be the third notification in an hour.
      const when = at(dayOf(new Date(now.getTime() + 86400000)), Math.max(s.digestHour, 8), 30);
      if (!soon(when)) continue;
      out.push({
        id: idFor("deadline", sf.taskId, when),
        at: when,
        kind: "deadline",
        entityId: sf.taskId,
        title: `${sf.title} will not fit`,
        body: `${hours(sf.needMins)} of work, ${hours(sf.availableMins)} open before ${sf.due}. ${hours(sf.shortMins)} short.`,
      });
    }
  }

  return out.sort((a, b) => a.at - b.at).slice(0, 60);
}

/**
 * What changed between what is scheduled and what should be.
 *
 * Diffing rather than cancel-everything-and-reschedule matters on a phone:
 * re-registering sixty notifications on every state change is slow, and on iOS
 * it silently drops the ones past the limit.
 */
export function reconcile(current = [], next = []) {
  const have = new Set(current.map((r) => r.id));
  const want = new Set(next.map((r) => r.id));
  return {
    add: next.filter((r) => !have.has(r.id)),
    remove: current.filter((r) => !want.has(r.id)).map((r) => r.id),
  };
}
