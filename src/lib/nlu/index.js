/**
 * The built-in assistant.
 *
 * Deterministic end to end: parse, resolve against the user's own data, act.
 * No model, no network, no per-message cost — which is what lets chats be
 * unlimited on every plan.
 *
 * The honest limit: it understands the phrasings it was built for. When it
 * cannot parse something it says so and shows what it does understand, rather
 * than guessing. Ambiguity produces a choice list instead of a coin flip —
 * moving the wrong meeting is far worse than one extra tap.
 */

import { parse, INTENTS, placeIn } from "./parse.js";
import { classify as smallTalk, answer as smallAnswer } from "./smalltalk.js";
import { resolveEvent, resolveTask, resolveProject, isConfident } from "./resolve.js";
import { describe, toLocalIso, dayKey, atLocal, parseRange, dayRange, fixDateWords } from "./datetime.js";
import { acknowledge, describeDay, addressOf, confirmLine, composeTitle, joinNames } from "./voice.js";
import {
  EMPTY_MEMORY, remember, carryable, lastTurn, focusOf, setOf, topicDay, inherit,
} from "./context.js";
import {
  addEvent, updateEvent, deleteEvent, addTask, updateTask, toggleTask,
  deleteTask, setMemory, setPlan, batch, undo, lastChange,
} from "../store.js";
import { findFreeSlots, fmtTime, workOn } from "../agenda.js";
import { distribute, describePlan, projectLoad, describeLoad, triage } from "../schedule.js";
import { planOpts, hoursOf, describeHours, sayMins, sayHour, weeklyMins } from "../hours.js";
import { duration } from "../format.js";

const DEFAULT_MEETING_MINS = 60;
const DEFAULT_TASK_MINS = 30;

const reply = (text, actions = [], extra = {}) => ({ text, actions, choices: null, ...extra });
const askWhich = (text, choices) => ({ text, actions: [], choices, pending: true });

/**
 * A question, not an answer — the command is missing something.
 *
 * Marked so the turn does not inherit the previous focus. If it did, "move the
 * ops review" → "when?" → "Wednesday at 2" would helpfully move whatever was
 * touched three turns ago instead of the ops review.
 */
const needs = (text) => ({ text, actions: [], choices: null, pending: true });

/**
 * Is this message a continuation of the last one rather than a new command?
 *
 * Four signals, any one of which is enough: an explicit correction ("no…"),
 * an edit verb aimed at a pronoun ("make it 3pm"), a bare fragment that
 * carries slots but no verb ("for Friday"), or a command whose only object is
 * a pronoun ("schedule it for Friday").
 */
const isFollowUp = (p) =>
  p.repair || p.amend || p.fragment || p.slots.rename ||
  (p.pronoun && !p.slots.title);

/**
 * Yes and no, and nothing else.
 *
 * Both are anchored end to end on purpose. "No, make it Monday" is a revision
 * of the proposal, not a rejection of it, and treating it as a rejection would
 * throw away everything the user had already said.
 */
const YES = /^\s*(?:y|ya|yes+|yep|yeah|yup|sure|ok|okay|k|confirm(?:ed)?|correct|right|perfect|do it|go ahead|book it|sounds good|please do|that'?s right)\b[\s.!,]*$/i;
const NO = /^\s*(?:n|no+|nope|nah|cancel(?: (?:it|that))?|forget it|never ?mind|dont|don'?t|stop|leave it|scratch that)\b[\s.!,]*$/i;

/** Slots a proposal can be revised on, all JSON-safe so they survive a reload. */
function revisePatch(patch, slots, base, now) {
  const next = { ...patch };
  if (slots.dateOnly || slots.timeOnly) {
    const from = next.whenIso ? new Date(next.whenIso) : base.slots.when || now;
    let d = new Date(from);
    if (slots.dateOnly) d = atLocal(slots.dateOnly, d.getHours(), d.getMinutes());
    if (slots.timeOnly) d = atLocal(d, slots.timeOnly.h, slots.timeOnly.m);
    next.whenIso = toLocalIso(d);
  }
  if (slots.durationMins) next.durationMins = slots.durationMins;
  if (slots.people?.length) next.people = slots.people;
  if (slots.subject) next.subject = slots.subject;
  if (slots.priority) next.priority = slots.priority;
  if (slots.rename) next.title = slots.rename;
  if (slots.person) next.person = slots.person;
  return next;
}

/** Fold a stored patch back onto a freshly parsed command. */
function applyPatch(slots, patch, now = new Date()) {
  if (!patch) return slots;
  if (patch.whenIso) {
    const d = new Date(patch.whenIso);
    slots.when = d;
    slots.dateOnly = atLocal(d, 0);
    slots.timeOnly = { h: d.getHours(), m: d.getMinutes(), source: "confirmed" };
    slots.hadDate = true;
    slots.hadTime = true;
    // "Clear Friday" → "no, Thursday" has to re-aim the span as well as the
    // moment. Patching only `when` left the original range in place, so the
    // revision was acknowledged and then Friday was cleared anyway.
    slots.range = dayRange(d, now);
  }
  if (patch.durationMins != null) slots.durationMins = patch.durationMins;
  if (patch.people) slots.people = patch.people;
  if (patch.subject) slots.subject = patch.subject;
  if (patch.priority) slots.priority = patch.priority;
  if (patch.title) slots.title = patch.title;
  if (patch.person) slots.person = patch.person;
  return slots;
}

/** Lookups scan the calendar; changes write to it. The art should match. */
const PEN_INTENTS = new Set([
  INTENTS.CREATE_EVENT, INTENTS.CREATE_TASK, INTENTS.MOVE_EVENT,
  INTENTS.CANCEL_EVENT, INTENTS.CLEAR_RANGE, INTENTS.COMPLETE_TASK,
  INTENTS.DELEGATE_TASK, INTENTS.RESIZE_EVENT, INTENTS.EDIT_TASK,
  INTENTS.REPEAT_EVENT, INTENTS.UNDO,
]);

/**
 * How full a day is, in a sentence.
 *
 * Meetings plus planned work against the focus budget — the same arithmetic
 * the calendar shades a square with, said out loud, because "you have three
 * meetings" does not answer "how busy am I".
 */
function loadLine(day, events, state, work) {
  const meetings = events.reduce((n, e) => n + (new Date(e.end) - new Date(e.start)) / 60000, 0);
  const planned = workOn(state.blocks, state.tasks, day).reduce((n, b) => n + b.mins, 0);
  const budget = work.dailyCapacity;
  const used = meetings + planned;
  const left = Math.max(0, budget - planned);
  const verdict =
    used >= budget * 1.1 ? "That is a full day"
    : used >= budget * 0.7 ? "Busy, but not solid"
    : used > 0 ? "There is room in it"
    : "Wide open";
  return `\n\n${verdict} — ${sayMins(meetings)} of meetings and ${sayMins(planned)} of planned work, ` +
    `against ${sayMins(budget)} of focus time. ${sayMins(left)} of that is still free.`;
}

/** Events starting inside a half-open range, in the order they happen. */
const inRange = (events, range) =>
  events
    .filter((e) => {
      const at = new Date(e.start);
      return at >= range.from && at < range.to;
    })
    .sort((a, b) => new Date(a.start) - new Date(b.start));

/**
 * A set, read back before it is deleted.
 *
 * The weekday appears as soon as the set spans more than one day. Without it a
 * week's worth reads "11:00 AM, 9:00 AM, 12:00 PM" — times marching backwards,
 * which looks like a bug in the very sentence that is asking permission to
 * delete four meetings.
 */
const listEvents = (events, limit = 4) => {
  const days = new Set(events.map((e) => dayKey(new Date(e.start))));
  const named = events.slice(0, limit).map((e) => {
    const at = new Date(e.start);
    const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const day = days.size > 1 ? `${at.toLocaleDateString([], { weekday: "short" })} ` : "";
    return `${day}${time} ${e.title}`;
  });
  const more = events.length - named.length;
  return joinNames(named) + (more > 0 ? `, and ${more} more` : "");
};

export const EXAMPLES = [
  "What time is it?",
  "Reschedule my 3pm Monday to Wednesday at 2",
  "Block 2 hours Thursday morning for the board deck",
  "What does Friday look like?",
  "The board deck will take 8 hours",
  "Every Monday at 9, standup",
  "Clear my Friday afternoon",
  "Undo that",
];

/**
 * @param {string} text
 * @param {object} state  Full app state.
 * @param {object} [opts] `{ now, resolvedId }` — resolvedId answers a prior choice.
 * @returns {{text: string, actions: {summary: string}[], choices: object|null}}
 */
export function ask(text, state, opts = {}) {
  const now = opts.now || new Date();
  const memory = opts.memory ?? state.memory ?? EMPTY_MEMORY;
  let p = parse(text, now);
  const identity = state.settings?.identity || {};
  // On unless turned off. Reading a change back before making it is cheap;
  // finding out next week that a board meeting moved is not.
  const confirms = state.settings?.confirm !== false;
  // Every scheduling answer is measured against the user's own day — their
  // hours, their working days, their breaks — rather than against a constant
  // that was right for nobody in particular.
  const work = planOpts(state.settings);

  const openTasks = state.tasks.filter((t) => !t.done);

  // ------------------------------------------------- a proposal is on the table
  const pending = opts.confirmed || opts.resolvedId ? null : memory.pending;
  let baseText = text;
  let patch = opts.patch ?? null;
  let short = null;

  if (pending) {
    if (YES.test(text)) {
      return ask(pending.text, state, {
        ...opts, now, confirmed: true, patch: pending.patch, resolvedId: pending.resolvedId,
      });
    }
    if (NO.test(text)) {
      short = reply("Left it as it was.", [], { entity: null });
    } else if (isFollowUp(p)) {
      // "No, make it Monday" — a revision, not a new command. Everything
      // already agreed stays; only what was just said changes.
      const base = parse(pending.text, now);
      patch = revisePatch(pending.patch, p.slots, base, now);
      baseText = pending.text;
      p = base;
    }
    // Anything else is a genuinely new command, and the proposal lapses.
  }

  if (patch) applyPatch(p.slots, patch, now);

  // Courtesies and questions about the clock, answered before anything else
  // touches the calendar. Checked after the confirmation branch above, so
  // "ok" while a proposal is open still means yes rather than hello — and the
  // patterns are anchored, so "hi, what's on Tuesday?" is a Tuesday question.
  const chat = !pending && !opts.resolvedId ? smallTalk(p.body) : null;
  if (chat) {
    const said = smallAnswer(chat, state, now, memory.turns?.length || 0);
    if (said) {
      if (!opts.memory) {
        setMemory({
          ...remember(memory, {
            text, intent: `small:${chat}`, slots: carryable(p.slots),
            // Small talk does not change what is being discussed, so the
            // thread carries straight through it.
            entity: lastTurn(memory, now)?.entity ?? null,
            day: lastTurn(memory, now)?.day ?? null,
          }, now.getTime()),
          pending: null,
        });
      }
      return {
        text: said.text,
        actions: [],
        choices: null,
        intent: `small:${chat}`,
        ack: acknowledge(identity, chat, now),
        variant: said.variant,
      };
    }
  }

  // Answering a choice list is already fully specified — it must not be read
  // as a follow-up, or "cancel it" would amend the wrong thing entirely.
  const prior = opts.resolvedId || pending ? null : lastTurn(memory, now);
  const focus = opts.resolvedId || pending ? null : focusOf(memory, state, now);

  let amending = null;
  if (prior && isFollowUp(p)) {
    // Something was created or changed last turn: adjust that, don't do it
    // again. Repeating the intent is how one meeting becomes three.
    if (focus) amending = focus;
    // Nothing was created — the last turn stopped to ask a question, so this
    // is the missing piece of it.
    else p = inherit(p, prior);
  }

  const { slots } = p;
  const res = short ?? (amending ? adjust(amending) : run());

  if (!opts.memory) {
    setMemory({
      ...remember(
        memory,
        {
          text,
          intent: p.intent,
          slots: carryable(slots),
          // Precedence matters. A branch that names an entity — or explicitly
          // names none — is always believed. Only a question that named
          // nothing drops the thread, because the next message is answering
          // the question rather than continuing with the old subject.
          entity:
            res.entity !== undefined ? res.entity
            : res.pending ? null
            : (prior?.entity ?? null),
          // A set is written only by the turn that produced one. Older sets
          // stay reachable — setOf walks back — so a question in between does
          // not lose what "them" refers to.
          set: res.set ?? null,
          day: res.day ?? (slots.dateOnly ? dayKey(slots.dateOnly) : prior?.day ?? null),
        },
        now.getTime(),
      ),
      // Held only while a proposal is open. Any turn that acts, declines, or
      // wanders off somewhere else clears it.
      pending: res.proposal
        ? { text: baseText, patch, resolvedId: opts.resolvedId ?? null }
        : null,
    });
  }

  return decorate(res);

  function decorate(r) {
    const { entity, set, day, pending: _p, proposal, ...rest } = r;
    return {
      ...rest,
      intent: p.intent,
      ack: acknowledge(identity, p.intent, now),
      variant: amending || PEN_INTENTS.has(p.intent) ? "pen" : "calendar",
    };
  }

  /**
   * Read it back before doing it.
   *
   * The description covers the whole action, not only the parts that were
   * inferred — one line to check, and the inferred day sits in it plainly
   * rather than being discovered later on the calendar.
   */
  function gate(desc, act) {
    if (opts.confirmed || !confirms) return act();
    return {
      text: confirmLine(identity, desc),
      actions: [],
      choices: {
        kind: "confirm",
        options: [
          { id: "yes", label: "Yes, go ahead" },
          { id: "no", label: "No, leave it" },
        ],
      },
      pending: true,
      proposal: desc,
    };
  }

  /**
   * Change the thing the last turn produced.
   *
   * "No, Friday" keeps the time, the length, and the attendees, and moves the
   * day — every slot the user did not restate stays exactly as it was. That is
   * the whole point: they should not have to say it all again.
   */
  function adjust({ kind, item }) {
    if (kind === "event") {
      if (p.intent === INTENTS.CANCEL_EVENT) {
        return gate(`cancelling “${item.title}”`, () => {
          deleteEvent(item.id);
          return reply(`Cancelled “${item.title}”.`, [{ summary: `Cancelled “${item.title}”` }], { entity: null });
        });
      }

      const cur = new Date(item.start);
      let start = new Date(cur);
      if (slots.dateOnly) start = atLocal(slots.dateOnly, start.getHours(), start.getMinutes());
      if (slots.timeOnly) start = atLocal(start, slots.timeOnly.h, slots.timeOnly.m);
      const mins = slots.durationMins ?? (new Date(item.end) - cur) / 60000;

      const patch = {
        start: toLocalIso(start),
        end: toLocalIso(new Date(start.getTime() + mins * 60000)),
      };
      if (slots.people?.length) patch.attendees = slots.people.map((name) => ({ name }));
      if (slots.subject) patch.notes = slots.subject;
      if (slots.rename) patch.title = slots.rename;

      const nothingChanged =
        patch.start === item.start && patch.end === item.end &&
        !patch.attendees && !patch.notes && !patch.title;
      if (nothingChanged) {
        // Still holding on to it — asking what to change must not drop the
        // subject, or the answer arrives with nothing to apply it to.
        return {
          ...needs(`“${item.title}” is already ${describe(cur, now)}. What should I change?`),
          entity: { kind: "event", id: item.id },
        };
      }

      const moved = patch.start !== item.start;
      const bits = [];
      if (moved) bits.push(`now ${describe(start, now)}`);
      if (slots.durationMins) bits.push(duration(mins * 60000));
      if (patch.attendees) bits.push(`with ${slots.people.join(" and ")}`);
      if (patch.notes) bits.push(`about ${slots.subject}`);

      return gate(`“${item.title}” — ${bits.join(", ")}`, () => {
        updateEvent(item.id, patch);
        const clash = state.events.find(
          (o) => o.id !== item.id &&
            new Date(o.start) < new Date(patch.end) && new Date(o.end) > start,
        );
        return reply(
          `${patch.title || item.title} — ${bits.join(", ")}.` +
            (clash ? ` That overlaps “${clash.title}”.` : ""),
          [{ summary: `Updated “${patch.title || item.title}” · ${describe(start, now)}` }],
          { entity: { kind: "event", id: item.id }, day: dayKey(start) },
        );
      });
    }

    // ---- task
    if (p.intent === INTENTS.COMPLETE_TASK) {
      return gate(`marking “${item.title}” done`, () => {
        toggleTask(item.id);
        return reply(`Done — “${item.title}”.`, [{ summary: `Completed “${item.title}”` }], { entity: null });
      });
    }
    if (p.intent === INTENTS.CANCEL_EVENT) {
      return gate(`deleting “${item.title}”`, () => {
        deleteTask(item.id);
        return reply(`Deleted “${item.title}”.`, [{ summary: `Deleted “${item.title}”` }], { entity: null });
      });
    }

    const patch = {};
    const bits = [];
    if (slots.dateOnly) {
      patch.due = dayKey(slots.dateOnly);
      bits.push(`due ${describe(atLocal(slots.dateOnly, 9), now).split(" at ")[0]}`);
    }
    if (slots.priority) {
      patch.priority = slots.priority;
      bits.push(`${slots.priority} priority`);
    }
    if (slots.durationMins) {
      patch.estimateMins = slots.durationMins;
      bits.push(duration(slots.durationMins * 60000));
    }
    if (slots.person) {
      patch.delegatedTo = slots.person;
      bits.push(`with ${slots.person}`);
    }
    if (slots.rename) {
      patch.title = slots.rename;
      bits.push(`renamed “${slots.rename}”`);
    }
    if (!bits.length) {
      return {
        ...needs(`“${item.title}” — what should I change about it?`),
        entity: { kind: "task", id: item.id },
      };
    }

    return gate(`“${item.title}” — ${bits.join(", ")}`, () => {
      updateTask(item.id, patch);
      return reply(
        `“${patch.title || item.title}” — ${bits.join(", ")}.`,
        [{ summary: `Updated “${patch.title || item.title}”` }],
        { entity: { kind: "task", id: item.id }, day: patch.due ?? null },
      );
    });
  }

  function run() {
  switch (p.intent) {
    // ------------------------------------------------------------- move
    case INTENTS.MOVE_EVENT: {
      if (!slots.when) {
        return needs("Move it to when? Give me a day and a time — “Wednesday at 2”, say.");
      }

      // "Move everything on Friday to Monday" — a whole day picked up and set
      // down elsewhere, each meeting keeping its own hour. Slid by whole days
      // rather than stacked on one time, because six meetings all at 9:00 is
      // not what anyone meant by "move them".
      const fromRange = p.plural ? parseRange(slots.subjectPhrase, now) : null;
      if (fromRange) {
        const moving = inRange(state.events, fromRange);
        if (!moving.length) {
          return reply(`Nothing on ${fromRange.label} to move.`, [], { day: dayKey(fromRange.from) });
        }
        const shift = Math.round(
          (atLocal(slots.when, 0) - atLocal(new Date(moving[0].start), 0)) / 86400000,
        );
        const target = describe(atLocal(slots.when, 9), now).split(" at ")[0];
        return gate(
          `moving all ${moving.length} from ${fromRange.label} to ${target}, keeping the times`,
          () => {
            batch(`moving ${moving.length} from ${fromRange.label}`, () => {
              for (const e of moving) {
                const s = new Date(e.start);
                const en = new Date(e.end);
                s.setDate(s.getDate() + shift);
                en.setDate(en.getDate() + shift);
                updateEvent(e.id, { start: toLocalIso(s), end: toLocalIso(en) });
              }
            });
            return reply(
              `Moved ${moving.length} ${moving.length === 1 ? "meeting" : "meetings"} to ${target}.`,
              [{ summary: `Moved ${moving.length} → ${target}` }],
              { entity: null, set: { kind: "event", ids: moving.map((e) => e.id) }, day: dayKey(slots.when) },
            );
          },
        );
      }

      const ranked = opts.resolvedId
        ? state.events.filter((e) => e.id === opts.resolvedId).map((item) => ({ item, score: 9 }))
        : resolveEvent(slots.subjectPhrase, state.events, now);

      if (!ranked.length) return reply("I couldn't find that on your calendar.");
      if (!isConfident(ranked)) {
        return askWhich("Which one?", {
          kind: "event",
          intent: "move",
          when: toLocalIso(slots.when),
          options: ranked.slice(0, 4).map((r) => ({
            id: r.item.id,
            label: `${r.item.title} · ${describe(new Date(r.item.start), now)}`,
          })),
        });
      }

      const ev = ranked[0].item;
      const durMs = new Date(ev.end) - new Date(ev.start);
      const start = slots.when;
      const end = new Date(start.getTime() + durMs);

      return gate(`moving “${ev.title}” to ${describe(start, now)}`, () => {
        updateEvent(ev.id, { start: toLocalIso(start), end: toLocalIso(end) });
        const clash = state.events.find(
          (o) => o.id !== ev.id && new Date(o.start) < end && new Date(o.end) > start,
        );
        return reply(
          `Moved “${ev.title}” to ${describe(start, now)}.` +
            (clash ? ` Heads up — that now overlaps “${clash.title}”.` : ""),
          [{ summary: `Moved “${ev.title}” → ${describe(start, now)}` }],
          { entity: { kind: "event", id: ev.id }, day: dayKey(start) },
        );
      });
    }

    // ----------------------------------------------------------- cancel
    case INTENTS.CANCEL_EVENT: {
      const ranked = opts.resolvedId
        ? state.events.filter((e) => e.id === opts.resolvedId).map((item) => ({ item, score: 9 }))
        : resolveEvent(p.text, state.events, now);
      if (!ranked.length) return reply("I couldn't find that on your calendar.");
      if (!isConfident(ranked)) {
        return askWhich("Cancel which one?", {
          kind: "event",
          intent: "cancel",
          options: ranked.slice(0, 4).map((r) => ({
            id: r.item.id,
            label: `${r.item.title} · ${describe(new Date(r.item.start), now)}`,
          })),
        });
      }
      const ev = ranked[0].item;
      return gate(
        `cancelling “${ev.title}”, ${describe(new Date(ev.start), now)}`,
        () => {
          deleteEvent(ev.id);
          return reply(`Cancelled “${ev.title}”.`, [{ summary: `Cancelled “${ev.title}”` }], { entity: null });
        },
      );
    }

    // -------------------------------------------------------------- undo
    /**
     * Step back.
     *
     * An assistant that cancels six meetings on one sentence needs a way back,
     * and a confirmation is not one — it puts the decision at the moment you
     * are least able to weigh it. This is the other half of that bargain.
     */
    case INTENTS.UNDO: {
      const what = undo();
      if (!what) return reply("Nothing to undo — I haven't changed anything yet.");
      return reply(
        `Undone — ${what} is back the way it was.`,
        [{ summary: `Undid ${what}` }],
        { entity: null, set: null },
      );
    }

    // --------------------------------------------------- change a task
    /**
     * Setting a property on a task named rather than pointed at.
     *
     * The estimate case is the one that mattered. People state how long
     * something takes — "the lease is about 45 minutes" — rather than
     * commanding it, and a rule table built from imperatives was blind to
     * every phrasing of it. Which meant the number the whole planner runs on
     * could only be entered by hand.
     */
    case INTENTS.EDIT_TASK: {
      const b = p.body.toLowerCase();
      const place = placeIn(p.body, now);

      // "The Meridian call is on Zoom" is almost always a meeting, so places
      // look at the calendar first. A task can carry one too — some work has
      // to happen somewhere — but it is the rarer reading.
      if (place) {
        const where = resolveEvent(p.body, state.events, now);
        if (where.length && isConfident(where)) {
          const ev = where[0].item;
          return gate(`“${ev.title}” at ${place}`, () => {
            updateEvent(ev.id, { location: place });
            return reply(`“${ev.title}” is at ${place}.`,
              [{ summary: `${ev.title} · ${place}` }],
              { entity: { kind: "event", id: ev.id } });
          });
        }
        if (where.length) {
          return askWhich("Which one?", {
            kind: "event", intent: "show",
            options: where.slice(0, 4).map((r) => ({
              id: r.item.id, label: `${r.item.title} · ${describe(new Date(r.item.start), now)}`,
            })),
          });
        }
      }

      const ranked = opts.resolvedId
        ? state.tasks.filter((t) => t.id === opts.resolvedId).map((item) => ({ item, score: 9 }))
        : resolveTask(slots.subjectPhrase, state.tasks);
      if (!ranked.length) {
        // It may be a meeting after all — "the review is 45 minutes" is a
        // perfectly good way to resize one.
        const asEvent = resolveEvent(p.body, state.events, now);
        if (asEvent.length && isConfident(asEvent) && slots.durationMins) {
          const ev = asEvent[0].item;
          const end = toLocalIso(new Date(new Date(ev.start).getTime() + slots.durationMins * 60000));
          return gate(`“${ev.title}” set to ${duration(slots.durationMins * 60000)}`, () => {
            updateEvent(ev.id, { end });
            return reply(`“${ev.title}” is now ${duration(slots.durationMins * 60000)}.`,
              [{ summary: `${ev.title} → ${duration(slots.durationMins * 60000)}` }],
              { entity: { kind: "event", id: ev.id } });
          });
        }
        return reply("I couldn't find a task matching that.");
      }
      if (!isConfident(ranked)) {
        return askWhich("Which task?", {
          kind: "task", intent: "edit", text: p.body,
          options: ranked.slice(0, 4).map((r) => ({ id: r.item.id, label: r.item.title })),
        });
      }

      const task = ranked[0].item;
      const patch = {};
      const bits = [];

      if (/\b(?:delete|remove|drop|bin|scrap|get rid of)\b/.test(b) && /\btasks?\b/.test(b)) {
        return gate(`deleting the task “${task.title}”`, () => {
          deleteTask(task.id);
          return reply(`Deleted “${task.title}”.`, [{ summary: `Deleted task “${task.title}”` }], { entity: null });
        });
      }
      if (/\b(?:re-?open|un-?complete|un-?tick|un-?check|not done|isn'?t done|didn'?t (?:actually )?finish|still open|undone)\b/.test(b)) {
        if (!task.done) {
          return reply(`“${task.title}” is already open.`, [], { entity: { kind: "task", id: task.id } });
        }
        return gate(`reopening “${task.title}”`, () => {
          toggleTask(task.id);
          return reply(`“${task.title}” is open again.`, [{ summary: `Reopened “${task.title}”` }],
            { entity: { kind: "task", id: task.id } });
        });
      }

      if (slots.rename) {
        patch.title = slots.rename;
        bits.push(`renamed “${slots.rename}”`);
      }
      if (slots.durationMins) {
        patch.estimateMins = slots.durationMins;
        bits.push(`${duration(slots.durationMins * 60000)} of work`);
      }
      if (slots.priority) {
        patch.priority = slots.priority;
        bits.push(`${slots.priority} priority`);
      }
      if (slots.dateOnly) {
        patch.due = dayKey(slots.dateOnly);
        bits.push(`due ${describe(atLocal(slots.dateOnly, 9), now).split(" at ")[0]}`);
      }
      if (!bits.length) {
        return {
          ...needs(`“${task.title}” — what should I change about it?`),
          entity: { kind: "task", id: task.id },
        };
      }

      return gate(`“${task.title}” — ${bits.join(", ")}`, () => {
        updateTask(task.id, patch);
        return reply(
          `“${patch.title || task.title}” — ${bits.join(", ")}.`,
          [{ summary: `Updated “${patch.title || task.title}”` }],
          { entity: { kind: "task", id: task.id }, day: patch.due ?? null },
        );
      });
    }

    // ------------------------------------------------------------ a series
    /**
     * "Every Monday at 9."
     *
     * Written out as real occurrences rather than stored as a rule. The store
     * has no concept of recurrence and inventing one would touch sync, the
     * planner, and every view; twelve rows that can each be moved or cancelled
     * on their own is both simpler and closer to how a standing meeting
     * actually behaves — the one that gets skipped in August is skipped, not
     * an exception to a rule.
     */
    case INTENTS.REPEAT_EVENT: {
      if (!slots.when) return needs("Starting when? A day and a time — “every Monday at 9”.");
      const every = /\b(?:every ?day|daily|each day)\b/.test(p.body.toLowerCase()) ? 1
        : /\b(?:every other week|fortnightly|biweekly)\b/.test(p.body.toLowerCase()) ? 14
        : /\b(?:monthly|every month)\b/.test(p.body.toLowerCase()) ? 28
        : 7;
      const count = slots.repeatCount ?? (every === 1 ? 20 : 12);
      const mins = slots.durationMins || DEFAULT_MEETING_MINS;
      const title = composeTitle(slots);
      const cadence = every === 1 ? "every weekday" : every === 7 ? "weekly" : every === 14 ? "every other week" : "every four weeks";
      const last = new Date(slots.when);
      last.setDate(last.getDate() + every * (count - 1));

      return gate(
        `“${title}”, ${cadence} from ${describe(slots.when, now)} — ${count} of them, through ` +
        `${last.toLocaleDateString([], { month: "long", day: "numeric" })}`,
        () => {
          let made = null;
          batch(`booking ${count} × “${title}”`, () => {
            for (let i = 0; i < count; i++) {
              const start = new Date(slots.when);
              start.setDate(start.getDate() + every * i);
              // A weekday series skips the weekend rather than landing on it.
              if (every === 1 && !work.workDays.includes(start.getDay())) continue;
              const ev = addEvent({
                title,
                start: toLocalIso(start),
                end: toLocalIso(new Date(start.getTime() + mins * 60000)),
                attendees: (slots.people || []).map((name) => ({ name })),
                notes: slots.subject || "",
              });
              made ||= ev;
            }
          });
          const n = state.events.length;
          return reply(
            `Booked “${title}” ${cadence} from ${describe(slots.when, now)}, through ` +
            `${last.toLocaleDateString([], { month: "long", day: "numeric" })}. ` +
            `Each one can be moved or cancelled on its own.`,
            [{ summary: `Added ${count} × “${title}”` }],
            { entity: made ? { kind: "event", id: made.id } : null, day: dayKey(slots.when) },
          );
        },
      );
    }

    // ------------------------------------------------- clear a whole stretch
    /**
     * Emptying a span of calendar.
     *
     * This existed only as a single-event cancel for far too long, and the
     * result was an assistant that answered "I couldn't find that on your
     * calendar" to "can you clear my calendar" — a sentence with nothing
     * ambiguous about it. Three things make it safe rather than alarming:
     * the scope is always named back before anything happens, the count is in
     * the confirmation, and a request with no scope at all is asked about
     * rather than guessed at.
     */
    case INTENTS.CLEAR_RANGE: {
      const wantsTasks = /\b(?:tasks?|to-?dos?|to do list|todos)\b/i.test(p.body);

      // "Remove them" — the set the last turn put on the table. Checked before
      // any date parsing, because "them" carries the scope by itself.
      const remembered = p.plural && !slots.range ? setOf(memory, state, now) : null;
      if (remembered?.items.length) {
        const items = remembered.items;
        const what = remembered.kind === "task" ? "task" : "meeting";
        return gate(
          `removing ${items.length === 1 ? `“${items[0].title}”` : `all ${items.length} — ${listEvents(items)}`}`,
          () => {
            batch(`removing ${items.length} ${items.length === 1 ? "thing" : "things"}`, () => {
              for (const it of items) {
                if (remembered.kind === "task") deleteTask(it.id);
                else deleteEvent(it.id);
              }
            });
            return reply(
              `Cleared ${items.length} ${items.length === 1 ? what : `${what}s`}.`,
              [{ summary: `Cleared ${items.length} ${items.length === 1 ? what : `${what}s`}` }],
              { entity: null, set: null },
            );
          },
        );
      }

      // The stretch, read the forward way. A typo gets one retry — "remove my
      // appointments for this wek" is not an ambiguous request.
      //
      // The day under discussion is inherited only when the sentence actually
      // points back at it — "what does Friday look like?" then "clear it".
      // A bare "clear my calendar" after booking something tomorrow inherits
      // nothing: it read as "clearing tomorrow, 1 meeting", which is a
      // confident answer to a question the user had not asked, about the one
      // operation where guessing the scope costs the most.
      const pointsBack = p.pronoun || p.plural;
      const asked =
        slots.range ||
        parseRange(fixDateWords(p.body), now) ||
        (pointsBack && topicDay(memory, now) ? dayRange(topicDay(memory, now), now) : null);

      // Bulk clearing never reaches backwards.
      //
      // "Clear this week", said on Thursday, cannot mean the three days that
      // already happened — those are a record, and a record deleted in passing
      // by a forward-looking instruction is not recoverable. Anything already
      // begun is left alone; naming it specifically still cancels it.
      const range = asked && asked.from < now ? { ...asked, from: now } : asked;

      if (asked && asked.to <= now) {
        return reply(`${asked.label[0].toUpperCase()}${asked.label.slice(1)} has already been and gone.`);
      }

      if (!range) {
        // No scope at all. "Clear my calendar" spans months on the honest
        // reading, so this is the one place a question beats a default.
        return askWhich("Happy to. Which stretch should I clear?", {
          kind: "range",
          text: p.body,
          options: [
            { id: "today", label: "Today" },
            { id: "tomorrow", label: "Tomorrow" },
            { id: "this week", label: "The rest of this week" },
            { id: "cancel", label: "Never mind" },
          ],
        });
      }

      // "Cancel my meetings with Bob this week" — the span narrowed by who.
      const named = (slots.people || []).map((x) => x.toLowerCase());
      const matches = (e) =>
        !named.length ||
        (e.attendees || []).some((a) => named.includes((typeof a === "string" ? a : a.name || "").toLowerCase()));

      const events = wantsTasks ? [] : inRange(state.events, range).filter(matches);
      const tasks = wantsTasks
        ? openTasks.filter((t) => t.due && t.due >= dayKey(range.from) && t.due <= dayKey(new Date(range.to - 1)))
        : [];
      const items = wantsTasks ? tasks : events;
      const noun = wantsTasks ? "task" : "meeting";

      if (!items.length) {
        const who = named.length ? ` with ${joinNames(slots.people)}` : "";
        return reply(`Nothing${who} on ${range.label} — it's already clear.`, [], {
          day: dayKey(range.from), set: null,
        });
      }

      const who = named.length ? ` with ${joinNames(slots.people)}` : "";
      return gate(
        `clearing ${range.label}${who} — ${items.length} ${items.length === 1 ? noun : `${noun}s`}: ${listEvents(items)}`,
        () => {
          batch(`clearing ${range.label}`, () => {
            for (const it of items) {
              if (wantsTasks) deleteTask(it.id);
              else deleteEvent(it.id);
            }
          });
          return reply(
            `${range.label[0].toUpperCase()}${range.label.slice(1)} is clear — ` +
              `removed ${items.length} ${items.length === 1 ? noun : `${noun}s`}.`,
            [{ summary: `Cleared ${range.label} · ${items.length} ${items.length === 1 ? noun : `${noun}s`}` }],
            { entity: null, set: null, day: dayKey(range.from) },
          );
        },
      );
    }

    // ----------------------------------------------------------- create
    case INTENTS.CREATE_EVENT: {
      if (!slots.when) return needs("When should I put it? A day and time works — “Thursday at 10”.");
      const mins = slots.durationMins || DEFAULT_MEETING_MINS;
      const people = slots.people || [];
      // A bare time belongs to the day being discussed. Asked "what does Friday
      // look like?" then "book a 2pm" — that 2pm is Friday's, not today's. The
      // confirmation always names the day, so a wrong inference is visible
      // immediately and one "no, Monday" away from fixed.
      let start = slots.when;
      const topic = slots.hadDate ? null : topicDay(memory, now);
      if (topic && slots.hadTime) start = atLocal(topic, start.getHours(), start.getMinutes());

      // Name it the way a person would: lead with what it is about, fall back
      // to who it is with, then to the noun they actually used.
      const title = composeTitle(slots);
      const end = new Date(start.getTime() + mins * 60000);
      const withWho = people.length ? ` with ${people.join(" and ")}` : "";
      const about = slots.subject ? ` about ${slots.subject}` : "";

      return gate(
        `a ${duration(mins * 60000)} ${slots.kindNoun || "meeting"}${withWho}${about}, ${describe(start, now)}, titled “${title}”`,
        () => {
          const made = addEvent({
            title,
            start: toLocalIso(start),
            end: toLocalIso(end),
            attendees: people.map((name) => ({ name })),
            notes: slots.subject || "",
          });
          const clash = state.events.find(
            (o) => new Date(o.start) < end && new Date(o.end) > start,
          );
          return reply(
            `Booked ${duration(mins * 60000)}${withWho}${about} ${describe(start, now)}.` +
              (clash ? ` That runs into “${clash.title}” — say the word and I'll move one.` : ""),
            [{ summary: `Added “${title}” · ${describe(start, now)}` }],
            { entity: { kind: "event", id: made.id }, day: dayKey(start) },
          );
        },
      );
    }

    case INTENTS.CREATE_TASK: {
      const title = slots.title;
      if (!title) return needs("What's the task?");
      const projectHit = resolveProject(p.text, state.projects);
      const due = slots.dateOnly || (slots.hadDate ? null : topicDay(memory, now));
      const bits = [];
      if (due) bits.push(`due ${describe(atLocal(due, 9), now).split(" at ")[0]}`);
      if (slots.priority) bits.push(`${slots.priority} priority`);
      if (slots.person) bits.push(`for ${slots.person}`);

      return gate(
        `a task, “${title}”${bits.length ? `, ${bits.join(", ")}` : ""}`,
        () => {
          const made = addTask({
            projectId: projectHit.length && isConfident(projectHit) ? projectHit[0].item.id : null,
            title,
            estimateMins: slots.durationMins || DEFAULT_TASK_MINS,
            due: due ? dayKey(due) : null,
            priority: slots.priority || "normal",
            delegatedTo: slots.person || "",
          });
          return reply(
            `Added “${title}”${bits.length ? ` — ${bits.join(", ")}` : ""}.`,
            [{ summary: `Added task “${title}”` }],
            { entity: { kind: "task", id: made.id }, day: due ? dayKey(due) : null },
          );
        },
      );
    }

    // --------------------------------------------------------- complete
    case INTENTS.COMPLETE_TASK: {
      const ranked = opts.resolvedId
        ? openTasks.filter((t) => t.id === opts.resolvedId).map((item) => ({ item, score: 9 }))
        : resolveTask(p.text, openTasks);
      if (!ranked.length) return reply("I couldn't find an open task matching that.");
      if (!isConfident(ranked)) {
        return askWhich("Which task?", {
          kind: "task",
          intent: "complete",
          options: ranked.slice(0, 4).map((r) => ({ id: r.item.id, label: r.item.title })),
        });
      }
      const t = ranked[0].item;
      return gate(`marking “${t.title}” done`, () => {
        toggleTask(t.id);
        return reply(`Done — “${t.title}”.`, [{ summary: `Completed “${t.title}”` }], { entity: null });
      });
    }

    case INTENTS.DELEGATE_TASK: {
      if (!slots.person) return needs("Delegate it to whom?");
      const ranked = resolveTask(slots.subjectPhrase, openTasks);
      if (!ranked.length) return reply("I couldn't find that task.");
      if (!isConfident(ranked)) {
        return askWhich("Which task?", {
          kind: "task",
          intent: "delegate",
          person: slots.person,
          options: ranked.slice(0, 4).map((r) => ({ id: r.item.id, label: r.item.title })),
        });
      }
      const t = ranked[0].item;
      return gate(`handing “${t.title}” to ${slots.person}`, () => {
        updateTask(t.id, { delegatedTo: slots.person });
        return reply(
          `“${t.title}” is with ${slots.person} now.`,
          [{ summary: `Delegated “${t.title}” → ${slots.person}` }],
          { entity: { kind: "task", id: t.id } },
        );
      });
    }

    // ------------------------------------------------------------ query
    case INTENTS.QUERY_DAY: {
      const day = dayKey(slots.dateOnly || now);
      const events = state.events
        .filter((e) => dayKey(new Date(e.start)) === day)
        .sort((a, b) => new Date(a.start) - new Date(b.start));
      const due = openTasks.filter((t) => t.due === day);
      const rawLabel = slots.dateOnly ? describe(atLocal(slots.dateOnly, 9), now).split(" at ")[0] : "Today";
      const label = rawLabel[0].toUpperCase() + rawLabel.slice(1);

      // "How busy am I Friday" is a different question from "what is on
      // Friday". The list answers the second and only implies the first, and
      // implying it is what makes someone open the calendar to check.
      const load = /\bhow (?:busy|full|packed|loaded)\b|\bon my plate\b|\bhow'?s (?:my|the) (?:day|week)\b/i.test(p.body)
        ? loadLine(day, events, state, work)
        : "";

      // The day asked about becomes the topic, so a bare "book a 2pm" next
      // lands here rather than on today — and the meetings just listed become
      // the set, so "cancel them" has something to point at.
      return reply(describeDay(label, events, due) + load, [], {
        day,
        set: events.length ? { kind: "event", ids: events.map((e) => e.id), label } : null,
      });
    }

    // ------------------------------------------------------- one thing
    case INTENTS.QUERY_EVENT: {
      const ranked = resolveEvent(p.body, state.events, now);
      if (!ranked.length) return reply("I couldn't find that on your calendar.");
      if (!isConfident(ranked)) {
        return askWhich("Which one?", {
          kind: "event", intent: "show",
          options: ranked.slice(0, 4).map((r) => ({
            id: r.item.id, label: `${r.item.title} · ${describe(new Date(r.item.start), now)}`,
          })),
        });
      }
      const ev = ranked[0].item;
      const mins = Math.round((new Date(ev.end) - new Date(ev.start)) / 60000);
      const who = (ev.attendees || []).map((a) => (typeof a === "string" ? a : a.name)).filter(Boolean);
      const bits = [`${ev.title} is ${describe(new Date(ev.start), now)}`];
      bits.push(`${duration(mins * 60000)} long`);
      if (who.length) bits.push(`with ${who.join(" and ")}`);
      if (ev.location) bits.push(`at ${ev.location}`);
      if (ev.notes) bits.push(`about ${ev.notes}`);
      return reply(`${bits.join(", ")}.`, [], { entity: { kind: "event", id: ev.id }, day: dayKey(new Date(ev.start)) });
    }

    // ------------------------------------------------------- how it went
    case INTENTS.QUERY_PROGRESS: {
      // Answered from logged sessions, which is the only honest source — what
      // was planned is not what happened.
      //
      // Looking back needs its own reading of the words. "This week" as a
      // deadline means before it runs out, so the date parser resolves it to
      // Friday; asked about what has been done, it means since Monday. Same
      // phrase, opposite end of the same week, and using the forward reading
      // here reported an empty week every time.
      const b = p.body.toLowerCase();
      const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
      const mondayOf = (d, backWeeks = 0) => {
        const x = startOfDay(d);
        x.setDate(x.getDate() - ((x.getDay() + 6) % 7) - backWeeks * 7);
        return x;
      };
      const since =
        /\btoday\b/.test(b) ? startOfDay(now)
        : /\byesterday\b/.test(b) ? startOfDay(new Date(now.getTime() - 86400000))
        : /\blast week\b/.test(b) ? mondayOf(now, 1)
        : /\bthis week\b|\bthe week\b/.test(b) ? mondayOf(now)
        : /\bthis month\b/.test(b) ? new Date(now.getFullYear(), now.getMonth(), 1)
        : new Date(now.getTime() - 7 * 86400000);
      const until =
        /\byesterday\b/.test(b) ? startOfDay(now)
        : /\blast week\b/.test(b) ? mondayOf(now)
        : new Date(now.getTime() + 86400000);
      const mine = state.sessions.filter(
        (x) => new Date(x.endedAt) >= since && new Date(x.endedAt) < until);
      const project = resolveProject(p.body, state.projects);
      const scoped = project.length && isConfident(project)
        ? mine.filter((x) => x.projectId === project[0].item.id)
        : mine;

      const focused = scoped.reduce((n, x) => n + (x.focusedMs || 0), 0);
      const doneTasks = state.tasks.filter(
        (t) => t.done && t.doneAt && new Date(t.doneAt) >= since && new Date(t.doneAt) < until).length;
      const label = project.length && isConfident(project) ? ` on ${project[0].item.name}` : "";

      if (!scoped.length && !doneTasks) {
        return reply(`Nothing logged${label} in that stretch.`);
      }
      return reply(
        `${duration(focused)} of focused work${label} across ${scoped.length} ` +
        `${scoped.length === 1 ? "session" : "sessions"}` +
        (doneTasks ? `, and ${doneTasks} ${doneTasks === 1 ? "task" : "tasks"} finished` : "") + ".",
      );
    }

    // ------------------------------------------------------ the working day
    /**
     * "What are my working hours?" — answered from the settings, in the same
     * words the planner reasons in.
     *
     * Worth its own intent because these numbers govern every "that does not
     * fit" the assistant ever says, and a user who cannot ask what they are
     * has no way to tell a wrong plan from a wrong setting.
     */
    case INTENTS.QUERY_HOURS: {
      const h = hoursOf(state.settings);
      const bits = [`You work ${describeHours(h)}`];
      bits.push(`with ${sayMins(h.capacityMins)} a day set aside for focused work`);
      if (h.breaks.length) {
        bits.push(
          `and ${joinNames(h.breaks.map((b) => `${b.label.toLowerCase()} ${sayHour(b.start)}–${sayHour(b.end)}`))} kept clear`,
        );
      }
      const week = weeklyMins(h);
      return reply(
        `${bits.join(", ")}. That's about ${sayMins(week)} of focus a week — ` +
        `it's what I measure every deadline against. Change it in Settings.`,
      );
    }

    // --------------------------------------------------- change its length
    case INTENTS.RESIZE_EVENT: {
      const ranked = opts.resolvedId
        ? state.events.filter((e) => e.id === opts.resolvedId).map((item) => ({ item, score: 9 }))
        : resolveEvent(p.body, state.events, now);
      if (!ranked.length) return reply("I couldn't find that on your calendar.");
      if (!isConfident(ranked)) {
        return askWhich("Which one?", {
          kind: "event", intent: "resize",
          options: ranked.slice(0, 4).map((r) => ({
            id: r.item.id, label: `${r.item.title} · ${describe(new Date(r.item.start), now)}`,
          })),
        });
      }
      const ev = ranked[0].item;
      const start = new Date(ev.start);
      const was = Math.round((new Date(ev.end) - start) / 60000);
      const body = p.body.toLowerCase();

      let mins;
      if (/\bin half\b/.test(body)) mins = Math.max(15, Math.round(was / 2));
      else if (/\bdouble\b/.test(body)) mins = was * 2;
      else if (slots.durationMins && /\bby\b/.test(body)) {
        mins = /\b(?:shorten|trim|cut|reduce)\b/.test(body)
          ? Math.max(15, was - slots.durationMins)
          : was + slots.durationMins;
      } else if (slots.durationMins) mins = slots.durationMins;
      else return needs(`How long should “${ev.title}” be?`);

      const end = toLocalIso(new Date(start.getTime() + mins * 60000));
      return gate(
        `“${ev.title}” ${mins > was ? "extended" : "shortened"} to ${duration(mins * 60000)}`,
        () => {
          updateEvent(ev.id, { end });
          return reply(
            `“${ev.title}” is now ${duration(mins * 60000)}, ${describe(start, now)}.`,
            [{ summary: `${ev.title} → ${duration(mins * 60000)}` }],
            { entity: { kind: "event", id: ev.id }, day: dayKey(start) },
          );
        },
      );
    }

    case INTENTS.QUERY_FREE: {
      const day = dayKey(slots.dateOnly || now);
      const slots_ = findFreeSlots(day, state.events, {
        minMins: slots.durationMins || 30,
        start: work.workStart, end: work.workEnd, breaks: work.breaks,
      });
      if (!slots_.length) return reply("Nothing open that day inside working hours.", [], { day });
      const lines = slots_.map((s) => `${fmtTime(s.start)}–${fmtTime(s.end)} (${duration(s.mins * 60000)})`);
      return reply(`Open time:\n${lines.join("\n")}`, [], { day });
    }

    case INTENTS.PLAN_DAY: {
      // "how is the board cycle going" / "will the raise fit" — the pacing
      // arithmetic for one project, which is the question behind most of them.
      const hit = resolveProject(p.body, state.projects);
      if (hit.length && isConfident(hit) && /\bproject\b|\bon track\b|\bpace\b|\bhow (?:is|are|much)\b|\bfit\b|\bbehind\b/i.test(p.body)) {
        const load = projectLoad(hit[0].item, state.tasks, state.sessions, state.events, { ...work, now });
        return reply(describeLoad(load), [], { day: load.due });
      }
      // "what's most urgent" — ranked by how little room each has left, which
      // is not the same as what the user marked important.
      if (/\bmost urgent\b|\bwhat'?s urgent\b|\bwhat should i (?:do|work on) first\b|\bbehind on\b|\btriage\b/i.test(p.body)) {
        const ranked = triage(state.tasks, state.events, state.sessions, { ...work, now }).slice(0, 5);
        if (!ranked.length) return reply("Nothing open with time on it.");
        const h = (m) => (m >= 60 ? `${+(m / 60).toFixed(m % 60 ? 1 : 0)}h` : `${m}m`);
        return reply(
          ranked.map((x) =>
            `${x.level === "critical" ? "⚠ " : ""}${x.task.title} — ${h(x.need)} left` +
            (x.task.due ? `, due ${x.task.due}` : "") +
            (x.days ? `, ${x.days} working ${x.days === 1 ? "day" : "days"} to do it` : "")).join("\n"),
        );
      }

      // "plan my week" and "how do I get this done" want the whole runway, not
      // just today — that is where the deadline maths actually lives.
      if (/\bweek\b|\bdeadlines?\b|\bfit\b|\bahead\b/.test(p.body.toLowerCase())) {
        const spread = distribute(state.tasks, state.events, state.sessions, { ...work, now });
        if (!spread.blocks.length && !spread.shortfalls.length) {
          return reply("Nothing to lay out — no open work with time on it.");
        }
        return gate(
          `laying ${duration(spread.totals.plannedMins * 60000)} of work across the days before your deadlines`,
          () => {
            setPlan(spread);
            const warn = spread.shortfalls.length
              ? `\n\n${spread.shortfalls.length} ${spread.shortfalls.length === 1 ? "task does" : "tasks do"} not fit.`
              : "";
            return reply(describePlan(spread, state.tasks) + warn,
              [{ summary: `Planned ${duration(spread.totals.plannedMins * 60000)} across ${spread.totals.taskCount} tasks` }]);
          },
        );
      }
      // "Plan my day" is a question now, not a command.
      //
      // The plan is derived and always current — it moves the moment a task or
      // a meeting does. There was a second planner behind this branch with its
      // own scoring and its own capacity arithmetic, so asking produced a
      // different answer from the one already on the calendar. Reading the
      // real plan back is both simpler and the only version that can be true.
      const day = dayKey(slots.dateOnly || now);
      const spread = distribute(state.tasks, state.events, state.sessions, { ...work, now });
      setPlan(spread);
      const mine = workOn(spread.blocks, state.tasks, day);
      const label = slots.dateOnly ? describe(atLocal(slots.dateOnly, 9), now).split(" at ")[0] : "today";
      const late = spread.shortfalls.length
        ? `\n\n⚠ ${spread.shortfalls.length} ${spread.shortfalls.length === 1 ? "task does" : "tasks do"} not fit before ` +
          `${spread.shortfalls.length === 1 ? "its deadline" : "their deadlines"} — ask me what is short.`
        : "";
      if (!mine.length) {
        const why = spread.totals.unestimatedCount
          ? ` ${spread.totals.unestimatedCount} ${spread.totals.unestimatedCount === 1 ? "task has" : "tasks have"} no time on ${spread.totals.unestimatedCount === 1 ? "it" : "them"}, so I can't place ${spread.totals.unestimatedCount === 1 ? "it" : "them"}.`
          : "";
        return reply(`Nothing laid out for ${label} — no open work with a deadline near enough to schedule.${why}${late}`, [], { day });
      }
      const lines = mine.map((b) => `${fmtTime(b.start)} — ${b.task.title}, ${duration(b.mins * 60000)}`);
      const total = mine.reduce((n, b) => n + b.mins, 0);
      return reply(
        `${duration(total * 60000)} of work laid into the gaps ${label === "today" ? "today" : `on ${label}`}:\n${lines.join("\n")}${late}`,
        [],
        { day },
      );
    }

    case INTENTS.INVITE:
      // Sending needs a server; the deterministic layer stops at the boundary
      // rather than pretending.
      return reply("Sending invites needs email set up on your account — not wired up yet.");

    case INTENTS.HELP:
      return reply(`I work with your calendar, tasks, and projects. Things I understand:\n${EXAMPLES.map((e) => `• ${e}`).join("\n")}`);

    default:
      return reply(
        "I didn't catch that. I handle your calendar, your tasks, and your projects — " +
        "and I'll tell you the time, the date, or what's left to do. Try:\n" +
        EXAMPLES.slice(0, 4).map((e) => `• ${e}`).join("\n"),
      );
  }
  }
}

/** Continue after the user picks from a choice list. */
export function resolveChoice(choice, id, state, now = new Date()) {
  // Tapping and typing take the same path, so both behave identically and
  // there is only one place where a confirmation can be granted.
  if (choice.kind === "confirm") return ask(id === "yes" ? "yes" : "no", state, { now });

  // The scope question. The original sentence is re-asked with the answer
  // appended, so it runs down exactly the path a fully specified request
  // would have — one route to the calendar, not two.
  if (choice.kind === "range") {
    if (id === "cancel") return ask("no", state, { now });
    return ask(`${choice.text} ${id}`, state, { now });
  }

  const verb = {
    move: `move it to ${choice.when}`,
    cancel: "cancel it",
    complete: "complete it",
    delegate: `delegate it to ${choice.person}`,
  }[choice.intent];
  return ask(verb, state, { now, resolvedId: id });
}
