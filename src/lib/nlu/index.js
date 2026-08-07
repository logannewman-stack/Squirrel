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
import { describe, toLocalIso, dayKey, atLocal, parseDate, parseRange, dayRange, fixDateWords } from "./datetime.js";
import { acknowledge, describeDay, addressOf, confirmLine, composeTitle, joinNames } from "./voice.js";
import {
  EMPTY_MEMORY, remember, carryable, lastTurn, focusOf, setOf, topicDay, inherit,
} from "./context.js";
import {
  addEvent, updateEvent, deleteEvent, addTask, updateTask, toggleTask,
  deleteTask, setMemory, setPlan, batch, undo, lastChange,
} from "../store.js";
import { record as recordMiss, resolve as pairMiss, REASONS } from "../misses.js";
import { interpret, hasResolver, contextFor } from "./fallback.js";
import { findFreeSlots, fmtTime, workOn } from "../agenda.js";
import { distribute, describePlan, projectLoad, describeLoad, triage, isWorkday } from "../schedule.js";
import { planOpts, hoursOf, describeHours, sayMins, saySpan, sayHour, weeklyMins } from "../hours.js";
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
 * A dead end, marked as one.
 *
 * "Here is your Tuesday" and "I couldn't find that" have the same shape — a
 * sentence with no actions on it — so the handlers that give up say so
 * explicitly rather than leaving it to be recovered later by matching against
 * their own wording. What is marked here is what reaches the miss log, and
 * nothing else does.
 */
const dead = (text, reason) => ({ text, actions: [], choices: null, miss: reason });

/**
 * The id of the miss still waiting to see how the person rephrased it.
 *
 * Module-level rather than stored in memory, because it is worth nothing after
 * a reload and belongs in neither the sync payload nor the undo stack. Only
 * the very next turn can claim it — see `note`.
 */
let openMiss = null;

/**
 * Keep score, quietly.
 *
 * A miss on its own says a phrasing failed. A miss followed by the sentence
 * that worked says what the person actually wanted, in their own words, next
 * to the intent that satisfied them — which is the missing rule, already
 * written. That pair is the reason this bookkeeping exists at all.
 *
 * Small talk never reaches here: it returns earlier in `ask`. That is the
 * right behaviour and worth stating, because it means muttering at her
 * between a failure and a retry doesn't break the pair.
 */
function note(res, p, opts) {
  // A rewrite is not traffic — it is the fallback's second attempt at traffic
  // that was already written down. It never opens a new row; at most it
  // answers the one still standing open, tagged so the two sources of a fix
  // never get read as one number.
  if (opts.rewrite) {
    if (!res.miss && openMiss) {
      pairMiss(openMiss, { text: p.text, intent: p.intent, by: "model" });
      openMiss = null;
    }
    return;
  }
  if (res.miss) {
    openMiss = recordMiss({ text: p.text, reason: res.miss, intent: p.intent });
    return;
  }
  if (openMiss) {
    pairMiss(openMiss, { text: p.text, intent: p.intent, by: "user" });
    openMiss = null;
  }
}

/** Test seam: forget the pending pair between scenarios. */
export const forgetMiss = () => {
  openMiss = null;
};

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
  "Put a debrief right after the board call",
  "Bring the standup forward an hour",
  "Swap the standup and the board call",
  "Spread the board deck over the rest of the week",
  "No meetings before 10 tomorrow",
  "What does Friday look like?",
  "The board deck will take 8 hours",
  "Every Monday at 9, standup",
  "Clear my Friday afternoon",
  "What should I drop?",
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
  // `p.body` with the original behind it: the opener stripper removes "wait"
  // as courtesy, and a message that was *entirely* courtesy leaves nothing to
  // classify — which read as an empty greeting. Falling back to what was
  // actually typed keeps "wait" a request for a pause.
  const chat = !pending && !opts.resolvedId ? smallTalk(p.body || text) : null;
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

  /**
   * "And add Tom." — after booking something.
   *
   * Too bare to classify on its own: no preposition, no object, nothing that
   * says it is about a meeting rather than a new task. Against the turn before
   * it, it is unambiguous, so it is resolved here where the thread is in hand
   * rather than by loosening a rule that would then fire on "add Tom" cold.
   */
  const bareAdd = focus?.kind === "event" && !slots.attendees
    ? p.body.match(/^\s*(?:add|invite|include|bring|cc)\s+([A-Za-z][\w'’-]*(?:\s+[A-Z][\w'’-]*)?)\s*(?:too|as well|also)?\s*$/)
    : null;
  if (bareAdd) {
    slots.attendees = { op: "add", who: bareAdd[1].replace(/^\w/, (c) => c.toUpperCase()), phrase: null };
    p.intent = INTENTS.EDIT_ATTENDEES;
  }

  const res = short ?? (p.refuses && PEN_INTENTS.has(p.intent) ? stand() : amending ? adjust(amending) : run());

  // Write down what she couldn't do, and — more usefully — what the person
  // said next when it worked. `opts.memory` marks a caller that wants a pure
  // function (the coverage probe sweeps hundreds of phrasings), and those are
  // not real traffic, so they stay out of the log.
  if (!opts.memory) note(res, p, opts);

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

  /**
   * A destructive verb, mentioned rather than asked for.
   *
   * "Don't cancel the standup" cancelled the standup. So did "why did you
   * cancel the standup", "did I cancel the board call", and "I don't want to
   * cancel it" — every rule saw a cancel verb and an object, and none of them
   * looked at the word in front of it.
   *
   * The fix is one branch in front of every intent that writes, rather than a
   * patch on each verb: a new destructive verb added later is covered by
   * construction instead of by remembering. What it does is answer the
   * question that was actually asked — where the thing is now — and touch
   * nothing.
   */
  function stand() {
    const named = slots.subjectPhrase || p.body;
    const ranked = resolveEvent(named, state.events, now);
    const lead = p.refuses === "negated" ? "Leaving it alone." : "";

    if (ranked.length && isConfident(ranked)) {
      const ev = ranked[0].item;
      return reply(
        `${lead ? `${lead} ` : ""}\u201c${ev.title}\u201d is still ${describe(new Date(ev.start), now)}.`,
        [], { entity: { kind: "event", id: ev.id }, day: dayKey(new Date(ev.start)) },
      );
    }

    const task = resolveTask(named, openTasks);
    if (task.length && isConfident(task)) {
      return reply(
        `${lead ? `${lead} ` : ""}\u201c${task[0].item.title}\u201d is still open.`,
        [], { entity: { kind: "task", id: task[0].item.id } },
      );
    }

    // Nothing by that name. If something was changed recently, saying what is
    // the most useful answer to "why did you cancel it" there is.
    const last = lastChange();
    if (p.refuses === "asked" && last) {
      return reply(`Nothing on your calendar by that name. The last change I made was ${last} — say \u201cundo\u201d to put it back.`);
    }
    return reply(lead ? `${lead} Nothing changed.` : "Nothing on your calendar by that name.");
  }

  function run() {
  switch (p.intent) {
    // ------------------------------------------------------------- move
    case INTENTS.MOVE_EVENT: {
      /**
       * "Bring the standup forward." "Push the board call out a week."
       *
       * A move with a direction instead of a destination. Resolved before
       * anything else asks for a time, because there isn't one to give — the
       * new time is the old one plus a shift, and it can only be worked out
       * once the meeting itself has been found.
       */
      // Gated on the nudge alone. A named day here is scope, not a
      // destination — "move everything on Wednesday an hour later" carries a
      // date and still has nowhere to land — and `parse` has already dropped
      // the nudge wherever an actual clock time was given.
      if (slots.nudge) {
        /**
         * "Move everything an hour later."
         *
         * A nudge aimed at a set rather than at one meeting, handled before
         * the single-event resolver gets a look at it — that resolver goes
         * hunting for a meeting called "everything" and reports it missing,
         * which is how a request to shift a whole morning came back as a
         * failed lookup.
         */
        const bulk = p.plural ||
          /\b(?:everything|every ?thing|all|the rest|the lot|meetings|appointments|events|calls)\b/i
            .test(slots.subjectPhrase);
        if (bulk) {
          if (!slots.nudge.mins) {
            return needs(`How far ${slots.nudge.dir === "earlier" ? "forward" : "back"}? \u201cAn hour\u201d works.`);
          }
          // The named stretch, then whatever was just being discussed, then the
          // day under discussion. Never the whole calendar: "move everything
          // later" is about a morning, and applying it to every meeting anyone
          // has ever booked is not a reading worth offering.
          const span = parseRange(slots.subjectPhrase, now) || parseRange(p.body, now);
          const remembered = setOf(memory, state, now);
          const moving = span
            ? inRange(state.events, span)
            : remembered?.kind === "event" && Array.isArray(remembered.ids)
              ? state.events.filter((e) => remembered.ids.includes(e.id))
              : (() => {
                  const day = topicDay(memory, now);
                  return day ? inRange(state.events, dayRange(day, now)) : null;
                })();

          // No stretch named and nothing in mind. Rather than guess at "today"
          // — which for a shift is a real change to real meetings — offer the
          // days that actually have something on them, so the answer is one tap
          // and the question is worth asking.
          if (!moving) {
            return askWhich("Everything on which day?", {
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
          if (!moving.length) return reply("Nothing there to move.");

          const shift = slots.nudge.mins * 60000 * (slots.nudge.dir === "earlier" ? -1 : 1);
          const by = saySpan(slots.nudge.mins);
          const way = slots.nudge.dir === "earlier" ? "earlier" : "later";
          const where = span ? ` on ${span.label}` : "";

          return gate(`moving all ${moving.length}${where} ${by} ${way}`, () => {
            batch(`moving ${moving.length} ${by} ${way}`, () => {
              for (const e of moving) {
                updateEvent(e.id, {
                  start: toLocalIso(new Date(new Date(e.start).getTime() + shift)),
                  end: toLocalIso(new Date(new Date(e.end).getTime() + shift)),
                });
              }
            });
            return reply(
              `Moved ${moving.length} ${moving.length === 1 ? "meeting" : "meetings"} ${by} ${way}.`,
              [{ summary: `Moved ${moving.length} ${by} ${way}` }],
              {
                entity: null,
                set: { kind: "event", ids: moving.map((e) => e.id) },
                day: dayKey(new Date(new Date(moving[0].start).getTime() + shift)),
              },
            );
          });
        }

        const found = opts.resolvedId
          ? state.events.filter((e) => e.id === opts.resolvedId).map((item) => ({ item, score: 9 }))
          : resolveEvent(slots.subjectPhrase, state.events, now);

        if (!found.length) return dead("I couldn't find that on your calendar.", REASONS.NO_MATCH);
        if (!isConfident(found)) {
          return askWhich("Which one?", {
            kind: "event", intent: "nudge", text: p.text,
            options: found.slice(0, 4).map((r) => ({
              id: r.item.id, label: `${r.item.title} · ${describe(new Date(r.item.start), now)}`,
            })),
          });
        }
        // "Move it later" without saying how much is genuinely underspecified,
        // and picking a default would move a real meeting by an amount nobody
        // asked for. One question is cheaper than one apology.
        if (!slots.nudge.mins) {
          return needs(
            `How far ${slots.nudge.dir === "earlier" ? "forward" : "back"}? ` +
            `“${slots.nudge.dir === "earlier" ? "An hour earlier" : "An hour later"}” works.`,
          );
        }

        const ev = found[0].item;
        const shift = slots.nudge.mins * 60000 * (slots.nudge.dir === "earlier" ? -1 : 1);
        const start = new Date(new Date(ev.start).getTime() + shift);
        const end = new Date(new Date(ev.end).getTime() + shift);
        const by = saySpan(slots.nudge.mins);
        const way = slots.nudge.dir === "earlier" ? "earlier" : "later";

        return gate(`moving “${ev.title}” ${by} ${way}, to ${describe(start, now)}`, () => {
          updateEvent(ev.id, { start: toLocalIso(start), end: toLocalIso(end) });
          return reply(
            `Moved “${ev.title}” ${by} ${way} — now ${describe(start, now)}.`,
            [{ summary: `Moved “${ev.title}” ${by} ${way}` }],
            { entity: { kind: "event", id: ev.id }, day: dayKey(start) },
          );
        });
      }

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

      if (!ranked.length) return dead("I couldn't find that on your calendar.", REASONS.NO_MATCH);
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
      if (!ranked.length) return dead("I couldn't find that on your calendar.", REASONS.NO_MATCH);
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
        return dead("I couldn't find a task matching that.", REASONS.NO_MATCH);
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
      const mins = slots.durationMins || DEFAULT_MEETING_MINS;

      /**
       * "No meetings before 10 tomorrow." "Nothing after 4 on Friday."
       *
       * Said as a prohibition, meant as a booking: the way to stop something
       * landing in a stretch of calendar is to put something there first. So
       * it becomes an ordinary held block, running from the start of the
       * working day to the boundary or from the boundary to the end of it.
       *
       * Anything already inside is named rather than moved. Being told a hold
       * clashes with two meetings is useful; having those two meetings
       * silently rescheduled by a sentence that never mentioned them is not.
       */
      if (slots.protect) {
        const day = slots.dateOnly || (slots.range ? new Date(slots.range.from) : null);
        if (!day) return needs("Which day should I keep clear?");

        const h = hoursOf(state.settings);
        const asHour = (v) => [Math.floor(v), Math.round((v % 1) * 60)];
        const [sh, sm] = asHour(h.start);
        const [eh, em] = asHour(h.end);

        let from;
        let to;
        if (slots.protect.h == null) {
          // No clock — a named stretch is doing the work, as in "keep Friday
          // morning free". Without either there is nothing to fence off.
          if (!slots.range || slots.range.scope !== "part") {
            return needs("Clear until when? “No meetings before 10” works.");
          }
          // A daypart begins at midnight. Holding from midnight is technically
          // true and reads as nonsense on a calendar, so the working day's
          // start wins wherever it falls later.
          const partFrom = new Date(slots.range.from);
          from = new Date(Math.max(partFrom, atLocal(partFrom, sh, sm)));
          to = new Date(slots.range.to);
        } else if (slots.protect.side === "before") {
          from = atLocal(day, sh, sm);
          to = atLocal(day, slots.protect.h, slots.protect.m);
        } else {
          from = atLocal(day, slots.protect.h, slots.protect.m);
          to = atLocal(day, eh, em);
        }

        if (to <= from) return reply("That leaves nothing to hold — the day is already over by then.");

        const clashes = state.events.filter((e) => new Date(e.start) < to && new Date(e.end) > from);
        const label = slots.protect.side === "before"
          ? `No meetings before ${fmtTime(to)}`
          : `No meetings after ${fmtTime(from)}`;

        return gate(
          `holding ${describe(from, now)} to ${fmtTime(to)} as “${label}”`,
          () => {
            const made = addEvent({ title: label, start: toLocalIso(from), end: toLocalIso(to) });
            const warn = clashes.length
              ? `\n\n⚠ ${clashes.length === 1 ? "One thing is" : `${clashes.length} things are`} already in there: ` +
                `${clashes.map((e) => e.title).join(", ")}. Say “move them” and I'll shift them out.`
              : "";
            return reply(
              `Held ${describe(from, now)} to ${fmtTime(to)}. Nothing gets booked in there.${warn}`,
              [{ summary: `Held ${describe(from, now)} — ${fmtTime(to)}` }],
              {
                entity: { kind: "event", id: made.id },
                day: dayKey(from),
                set: clashes.length ? { kind: "event", ids: clashes.map((e) => e.id) } : null,
              },
            );
          },
        );
      }

      /**
       * "Right after the board call" — a time named by what it sits next to.
       *
       * Resolved here rather than in the parser because it needs the calendar.
       * If the phrase matches nothing, the anchor is dropped and the sentence
       * is read the ordinary way, so "book lunch before the trip" with no trip
       * on the calendar asks when rather than inventing a Tuesday.
       */
      if (!slots.when && slots.anchor) {
        const ranked = resolveEvent(slots.anchor.phrase, state.events, now);
        if (!ranked.length) {
          return needs(`I can't find “${slots.anchor.phrase}” on your calendar. When should I put it?`);
        }
        if (!isConfident(ranked)) {
          return askWhich(`Which one is “${slots.anchor.phrase}”?`, {
            kind: "event", intent: "anchor", text: p.text,
            options: ranked.slice(0, 4).map(({ item }) => ({
              id: item.id, label: `${item.title} — ${describe(new Date(item.start), now)}`,
            })),
          });
        }
        const at = ranked[0].item;
        const start = slots.anchor.side === "after"
          ? new Date(new Date(at.end).getTime() + slots.anchor.offsetMins * 60000)
          // Before means finishing before it starts, so the meeting's own
          // length comes off too. Placing it to *start* at the offset would
          // run it straight through the thing it was meant to precede.
          : new Date(new Date(at.start).getTime() - (slots.anchor.offsetMins + mins) * 60000);
        slots.when = start;
        slots.hadDate = true;
        slots.hadTime = true;
        slots.anchorTitle = at.title;
      }

      /**
       * "The offsite is Friday, all day."
       *
       * No start time, because there isn't one — the answer is the working day
       * itself. Measured against the user's own hours rather than midnight to
       * midnight, since a block starting at 00:00 is true and useless.
       */
      if (slots.allDay && slots.dateOnly) {
        const h = hoursOf(state.settings);
        const from = atLocal(slots.dateOnly, Math.floor(h.start), Math.round((h.start % 1) * 60));
        const to = atLocal(slots.dateOnly, Math.floor(h.end), Math.round((h.end % 1) * 60));
        const dayName = describe(from, now).split(" at ")[0];
        // A day blocked out with nothing named is "Busy", not "Meeting" —
        // there is nobody to meet and the point is that the day is gone.
        const title = slots.title || slots.subject || slots.people?.length ? composeTitle(slots) : "Busy";
        return gate(`“${title}” all day ${dayName}`, () => {
          const made = addEvent({
            title,
            start: toLocalIso(from),
            end: toLocalIso(to),
            attendees: (slots.people || []).map((name) => ({ name })),
            notes: slots.subject || "",
          });
          return reply(
            `“${title}” blocked out all day ${dayName}, ${fmtTime(from)} to ${fmtTime(to)}.`,
            [{ summary: `Added “${title}”, all day` }],
            { entity: { kind: "event", id: made.id }, day: dayKey(from) },
          );
        });
      }

      if (!slots.when) return needs("When should I put it? A day and time works — “Thursday at 10”.");
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
      if (!ranked.length) return dead("I couldn't find an open task matching that.", REASONS.NO_MATCH);
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
      if (!ranked.length) return dead("I couldn't find that task.", REASONS.NO_MATCH);
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
    /**
     * "What's next?"
     *
     * The most ordinary question anyone asks a diary, and it used to be
     * answered "I couldn't find that on your calendar" — the resolver was
     * being handed the word "next" and going looking for a meeting by that
     * name. It wants the clock, not a lookup.
     *
     * Planned work counts as much as meetings. A day laid out by the scheduler
     * and then described as empty is a schedule nobody trusts twice.
     */
    /**
     * Who is in a meeting.
     *
     * The most expensive gap the sweep found, and not because it was missing —
     * because of where the sentences landed instead. "Drop Bob from the
     * standup" reached the cancel rule, since `drop` is a cancel verb, and
     * deleted the standup. Someone asking to take one person off an invitation
     * lost the appointment, and got a cheerful confirmation for it.
     *
     * Adding a name here does not send anything. Squirrel has no mail, and
     * says so when asked to send; what it can do is keep the list right, which
     * is what "invite Bob to the standup" is actually asking for.
     */
    case INTENTS.EDIT_ATTENDEES: {
      const spec = slots.attendees;
      // The phrase after the preposition names the meeting. For a bare
      // question — "who's coming?" — there is no phrase, so the thread decides.
      const ranked = opts.resolvedId
        ? state.events.filter((e) => e.id === opts.resolvedId).map((item) => ({ item, score: 9 }))
        : spec.phrase === null && focus?.kind === "event"
          // A bare "add Tom" carries no name for the meeting, because the
          // meeting is the one already under discussion.
          ? state.events.filter((e) => e.id === focus.item.id).map((item) => ({ item, score: 9 }))
          : resolveEvent(spec.op === "list" || spec.op === "clear" ? p.body : spec.phrase, state.events, now);

      if (!ranked.length) {
        const day = spec.op === "list" ? topicDay(memory, now) : null;
        if (day) {
          const on = inRange(state.events, dayRange(day, now));
          const people = [...new Set(on.flatMap((e) => (e.attendees || []).map((a) => a.name)))];
          return reply(
            people.length
              ? `${joinNames(people)} — across ${on.length} ${on.length === 1 ? "meeting" : "meetings"}.`
              : "Nobody named on anything that day.",
            [], { day: dayKey(day) },
          );
        }
        return dead("I couldn't find that on your calendar.", REASONS.NO_MATCH);
      }
      if (!isConfident(ranked)) {
        return askWhich("Which one?", {
          kind: "event", intent: "attendees", text: p.text,
          options: ranked.slice(0, 4).map(({ item }) => ({
            id: item.id, label: `${item.title} \u00b7 ${describe(new Date(item.start), now)}`,
          })),
        });
      }

      const ev = ranked[0].item;
      const list = ev.attendees || [];
      const names = list.map((a) => a.name);

      if (spec.op === "list") {
        return reply(
          names.length
            ? `${joinNames(names)}${names.length === 1 ? " is" : " are"} on \u201c${ev.title}\u201d.`
            : `Nobody else is on \u201c${ev.title}\u201d \u2014 just you.`,
          [], { entity: { kind: "event", id: ev.id }, day: dayKey(new Date(ev.start)) },
        );
      }

      if (spec.op === "clear") {
        if (!names.length) return reply(`\u201c${ev.title}\u201d already has nobody else on it.`);
        return gate(`taking ${joinNames(names)} off \u201c${ev.title}\u201d`, () => {
          updateEvent(ev.id, { attendees: [] });
          return reply(
            `\u201c${ev.title}\u201d is just you now.`,
            [{ summary: `Cleared ${names.length} from \u201c${ev.title}\u201d` }],
            { entity: { kind: "event", id: ev.id }, day: dayKey(new Date(ev.start)) },
          );
        });
      }

      if (spec.op === "add") {
        if (names.some((n) => n.toLowerCase() === spec.who.toLowerCase())) {
          return reply(`${spec.who} is already on \u201c${ev.title}\u201d.`, [],
            { entity: { kind: "event", id: ev.id } });
        }
        return gate(`adding ${spec.who} to \u201c${ev.title}\u201d`, () => {
          updateEvent(ev.id, { attendees: [...list, { name: spec.who }] });
          return reply(
            `${spec.who} is on \u201c${ev.title}\u201d, ${describe(new Date(ev.start), now)}.` +
            (names.length ? ` With ${joinNames(names)}.` : ""),
            [{ summary: `Added ${spec.who} to \u201c${ev.title}\u201d` }],
            { entity: { kind: "event", id: ev.id }, day: dayKey(new Date(ev.start)) },
          );
        });
      }

      // remove
      const hit = names.find((n) => n.toLowerCase() === spec.who.toLowerCase());
      if (!hit) {
        return reply(
          names.length
            ? `${spec.who} isn't on \u201c${ev.title}\u201d \u2014 ${joinNames(names)} ${names.length === 1 ? "is" : "are"}.`
            : `Nobody is on \u201c${ev.title}\u201d to remove.`,
          [], { entity: { kind: "event", id: ev.id } },
        );
      }
      const left = list.filter((a) => a.name.toLowerCase() !== spec.who.toLowerCase());
      return gate(`taking ${hit} off \u201c${ev.title}\u201d`, () => {
        updateEvent(ev.id, { attendees: left });
        return reply(
          `${hit} is off \u201c${ev.title}\u201d.` +
          (left.length
            ? ` ${joinNames(left.map((a) => a.name))} still on.`
            : " The meeting is still there \u2014 say \u201ccancel it\u201d if it should go too."),
          [{ summary: `Removed ${hit} from \u201c${ev.title}\u201d` }],
          { entity: { kind: "event", id: ev.id }, day: dayKey(new Date(ev.start)) },
        );
      });
    }

    /**
     * "Swap the standup and the board call."
     *
     * Two meetings changing places. Written as one move it is two moves that
     * have to happen together, and doing them one at a time puts the first on
     * top of the second for as long as it takes to do the second — which the
     * undo stack would then take back one half at a time. Hence `batch`.
     *
     * Each keeps its own length. Exchanging durations as well would turn a
     * fifteen-minute standup into an hour because the thing it traded with
     * happened to be long, which is not what anybody means by "swap".
     */
    case INTENTS.SWAP_EVENTS: {
      const halves = slots.subjectPhrase
        .replace(/^.*?\b(?:swap|switch|exchange|trade|flip)\b\s*/i, "")
        .split(/\s+\b(?:and|with|for)\b\s+/i)
        .map((x) => x.replace(/\b(?:round|around|over)\b/gi, "").trim())
        .filter(Boolean);

      if (halves.length < 2) {
        return needs("Swap which two? Name them both — “swap the standup and the board call”.");
      }

      const picked = [];
      for (const half of halves.slice(0, 2)) {
        const ranked = resolveEvent(half, state.events, now);
        if (!ranked.length) {
          return dead(`I couldn't find “${half}” on your calendar.`, REASONS.NO_MATCH);
        }
        if (!isConfident(ranked)) {
          return askWhich(`Which one is “${half}”?`, {
            kind: "event", intent: "swap", text: p.text,
            options: ranked.slice(0, 4).map(({ item }) => ({
              id: item.id, label: `${item.title} · ${describe(new Date(item.start), now)}`,
            })),
          });
        }
        picked.push(ranked[0].item);
      }

      const [a, b] = picked;
      if (a.id === b.id) return reply("That's the same meeting twice — nothing to swap.");

      const aStart = new Date(b.start);
      const bStart = new Date(a.start);
      const aEnd = new Date(aStart.getTime() + (new Date(a.end) - new Date(a.start)));
      const bEnd = new Date(bStart.getTime() + (new Date(b.end) - new Date(b.start)));

      return gate(
        `swapping “${a.title}” and “${b.title}” — ${a.title} to ${describe(aStart, now)}, ` +
        `${b.title} to ${describe(bStart, now)}`,
        () => {
          batch(`swapping “${a.title}” and “${b.title}”`, () => {
            updateEvent(a.id, { start: toLocalIso(aStart), end: toLocalIso(aEnd) });
            updateEvent(b.id, { start: toLocalIso(bStart), end: toLocalIso(bEnd) });
          });
          return reply(
            `Swapped them. “${a.title}” is now ${describe(aStart, now)}, ` +
            `“${b.title}” is ${describe(bStart, now)}.`,
            [{ summary: `Swapped “${a.title}” and “${b.title}”` }],
            { entity: null, set: { kind: "event", ids: [a.id, b.id] }, day: dayKey(aStart) },
          );
        },
      );
    }

    case INTENTS.QUERY_NEXT: {
      const upcoming = state.events
        .filter((e) => new Date(e.start) > now)
        .sort((a, b) => new Date(a.start) - new Date(b.start));
      const block = workOn(state.blocks, state.tasks, dayKey(now))
        .filter((b) => new Date(b.start) > now)
        .sort((a, b) => new Date(a.start) - new Date(b.start))[0];

      const next = upcoming[0];
      if (!next && !block) {
        return reply("Nothing else on your calendar. The rest of the day is yours.");
      }

      // Whichever comes first — a meeting tomorrow does not outrank an hour of
      // focus work starting in twenty minutes.
      const workFirst = block && (!next || new Date(block.start) < new Date(next.start));
      const at = new Date(workFirst ? block.start : next.start);
      const title = workFirst ? block.task.title : next.title;

      const mins = Math.round((at - now) / 60000);
      const away =
        mins < 1 ? "starting now"
        : mins < 60 ? `in ${mins} ${mins === 1 ? "minute" : "minutes"}`
        : dayKey(at) === dayKey(now) ? `at ${fmtTime(at)}`
        : `${describe(at, now)}`;

      const kind = workFirst ? "Work on " : "";
      const who = !workFirst && next.attendees?.length ? ` with ${joinNames(next.attendees)}` : "";
      const after = upcoming[1] && dayKey(new Date(upcoming[1].start)) === dayKey(at)
        ? ` Then ${upcoming[1].title} at ${fmtTime(new Date(upcoming[1].start))}.`
        : "";

      return reply(`${kind}${title}${who}, ${away}.${after}`, [], { day: dayKey(at) });
    }

    case INTENTS.QUERY_EVENT: {
      const ranked = resolveEvent(p.body, state.events, now);
      if (!ranked.length) return dead("I couldn't find that on your calendar.", REASONS.NO_MATCH);
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
      if (!ranked.length) return dead("I couldn't find that on your calendar.", REASONS.NO_MATCH);
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

    /**
     * "Spread the board deck over the rest of the week."
     *
     * The planner already knows how to lay a long job across the days before
     * its deadline — that is the whole of `distribute`. What it could not be
     * told, until now, is *which* days, so the only way to influence it was to
     * go and edit a due date by hand.
     *
     * So this changes exactly one thing: the deadline. The layout that follows
     * is the ordinary one, computed the ordinary way, still respecting working
     * hours, meetings already booked, and everything else competing for the
     * same week. A second mechanism that placed blocks directly would drift
     * from the first one the day either of them changed.
     */
    case INTENTS.SPREAD_TASK: {
      let ranked = resolveTask(slots.subjectPhrase, openTasks);
      // "Spread it over this week" names nothing the resolver can match, and
      // the thing it means is whatever was just being discussed.
      if (!ranked.length && p.pronoun && focus?.kind === "task") {
        const it = openTasks.find((x) => x.id === focus.item.id);
        if (it) ranked = [{ item: it, score: 9 }];
      }
      if (!ranked.length) return dead("I couldn't find an open task matching that.", REASONS.NO_MATCH);
      if (!isConfident(ranked)) {
        return askWhich("Which task?", {
          kind: "task", intent: "spread", text: p.text,
          options: ranked.slice(0, 4).map(({ item }) => ({ id: item.id, label: item.title })),
        });
      }
      const task = ranked[0].item;
      if (!task.estimateMins) {
        return needs(`How long is “${task.title}” altogether? I can't spread it without knowing.`);
      }

      // The last day it may run to. A named stretch gives that directly; a
      // rate — "two hours a day" — gives it by division, which is the same
      // question asked from the other end.
      let last = null;
      let first = null;
      if (slots.range) {
        // Ranges are half-open, so the final working day is one before the end.
        last = new Date(slots.range.to);
        last.setDate(last.getDate() - 1);
        // "across tomorrow and Thursday" — parseRange takes the first date it
        // finds and stops there. The day after the "and" is the one that
        // decides how far this runs.
        const tail = slots.subjectPhrase.split(/\b(?:and|to|through|until|till)\b/i).slice(1).join(" ");
        const later = tail ? parseDate(tail, now)?.date : null;
        if (later && later > last) last = later;
        // And the start of the stretch is a real instruction too, not just a
        // way of naming the end of it.
        if (slots.range.from > atLocal(now, 0)) first = new Date(slots.range.from);
      } else if (slots.durationMins) {
        const days = Math.max(1, Math.ceil(task.estimateMins / slots.durationMins));
        last = atLocal(now, 0);
        // Counted in working days rather than calendar days — four days of work
        // starting Thursday should not quietly assume the weekend.
        // Stops *on* the last working day it needs, not past it — both branches
        // hand the same thing to the buffer arithmetic below.
        let placed = 0;
        while (placed < days) {
          if (isWorkday(last, work)) placed++;
          if (placed < days) last.setDate(last.getDate() + 1);
        }
      }
      // The planner stops a buffer short of a deadline on purpose, so a due
      // date set to the last working day would quietly lose that day. The
      // buffer is added back here rather than removed there — finishing early
      // is the right default for work that wasn't given an explicit deadline.
      if (last) last.setDate(last.getDate() + (work.bufferDays ?? 1));

      if (!last) {
        return needs(`Across which days? “This week” or “two hours a day” both work.`);
      }

      // A rate is a standing instruction about the task, not a one-off, so it
      // is written onto the task itself — the planner re-runs on every change
      // and would otherwise forget it the next time anything moved.
      const patch = { due: dayKey(last) };
      if (slots.durationMins) patch.maxPerDayMins = slots.durationMins;
      if (first) patch.notBeforeDay = dayKey(first);
      const { due } = patch;

      return gate(
        `spreading “${task.title}” across the days up to ${due}` +
        (patch.maxPerDayMins ? `, at most ${sayMins(patch.maxPerDayMins)} a day` : ""),
        () => {
        updateTask(task.id, patch);
        const spread = distribute(
          state.tasks.map((t) => (t.id === task.id ? { ...t, ...patch } : t)),
          state.events, state.sessions, { ...work, now },
        );
        const mine = spread.blocks.filter((b) => b.taskId === task.id);
        if (!mine.length) {
          return reply(
            `Set “${task.title}” to finish by ${due} — but nothing fits, the days up to then are full.`,
            [{ summary: `“${task.title}” due ${due}` }],
            { entity: { kind: "task", id: task.id }, day: due },
          );
        }

        const byDay = new Map();
        for (const b of mine) {
          const k = dayKey(new Date(b.start));
          byDay.set(k, (byDay.get(k) || 0) + b.mins);
        }
        const lines = [...byDay.entries()].map(([d, m]) => {
          const when = describe(new Date(`${d}T12:00:00`), now).split(" at ")[0];
          return `${when} — ${sayMins(m)}`;
        });
        const done = [...byDay.values()].reduce((a, b) => a + b, 0);
        const missing = task.estimateMins - done;
        return reply(
          `“${task.title}” laid across ${byDay.size} ${byDay.size === 1 ? "day" : "days"}:\n${lines.join("\n")}` +
          (missing > 0 ? `\n\n⚠ ${sayMins(missing)} of it still doesn't fit before ${due}.` : ""),
          [{ summary: `Spread “${task.title}” over ${byDay.size} ${byDay.size === 1 ? "day" : "days"}` }],
          { entity: { kind: "task", id: task.id }, day: due },
        );
      },
      );
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
      return dead("Sending invites needs email set up on your account — not wired up yet.", REASONS.UNSUPPORTED);

    case INTENTS.HELP:
      return reply(`I work with your calendar, tasks, and projects. Things I understand:\n${EXAMPLES.map((e) => `• ${e}`).join("\n")}`);

    default:
      return dead(
        "I didn't catch that. I handle your calendar, your tasks, and your projects — " +
        "and I'll tell you the time, the date, or what's left to do. Try:\n" +
        EXAMPLES.slice(0, 4).map((e) => `• ${e}`).join("\n"),
        REASONS.UNPARSED,
      );
  }
  }
}

/**
 * `ask`, with one optional second attempt through the fallback.
 *
 * This is what the UI calls. With no resolver installed it is `ask` with a
 * promise around it — same answer, same speed, no network — which is the state
 * the app ships in.
 *
 * With one installed, a sentence the rules missed gets rewritten into
 * vocabulary the rules do handle and run again. The rerun is an ordinary turn:
 * same resolver, same ambiguity questions, same confirmation before anything
 * destructive, same undo entry. Nothing here can act on its own.
 *
 * Three guarantees worth stating, because they are the whole safety argument:
 *
 * - Exactly one rewrite. A rewrite is never itself rewritten, so no sequence
 *   of replies from the far end can produce a loop or a second charge.
 * - A failed rewrite is invisible. If the rerun misses too, the user gets the
 *   original honest "I didn't catch that" rather than a second confusing one.
 * - A broken fallback is indistinguishable from no fallback. Offline, timing
 *   out, rate-limited, returning nonsense — every one of those lands back on
 *   the deterministic answer.
 */
export async function askAsync(text, state, opts = {}) {
  const first = ask(text, state, opts);
  // The deterministic answer, handed over the moment it exists. The UI puts
  // its thinking indicator up on this, so the beat before an answer looks the
  // same whether or not a second attempt is about to happen behind it.
  opts.onFirst?.(first);
  if (!first.miss || !hasResolver()) return first;

  const now = opts.now || new Date();
  const rewrite = await interpret(text, contextFor(state, now));
  if (!rewrite) return first;

  // `rewrite: true` keeps the rerun out of the log as traffic of its own.
  const second = ask(rewrite, state, { ...opts, now, rewrite: true });
  if (second.miss) return first;

  return { ...second, rewroteFrom: text, rewrote: rewrite };
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
