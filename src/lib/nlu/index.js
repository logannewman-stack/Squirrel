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

import { parse, INTENTS } from "./parse.js";
import { classify as smallTalk, answer as smallAnswer } from "./smalltalk.js";
import { resolveEvent, resolveTask, resolveProject, isConfident } from "./resolve.js";
import { describe, toLocalIso, dayKey, atLocal } from "./datetime.js";
import { acknowledge, describeDay, addressOf, confirmLine, composeTitle } from "./voice.js";
import {
  EMPTY_MEMORY, remember, carryable, lastTurn, focusOf, topicDay, inherit,
} from "./context.js";
import {
  addEvent, updateEvent, deleteEvent, addTask, updateTask, toggleTask,
  deleteTask, applyPlan, setMemory, setPlan,
} from "../store";
import { planDay, findFreeSlots, fmtTime } from "../agenda";
import { distribute, describePlan, projectLoad, describeLoad, triage } from "../schedule";
import { duration } from "../format";

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
  if (slots.people.length) next.people = slots.people;
  if (slots.subject) next.subject = slots.subject;
  if (slots.priority) next.priority = slots.priority;
  if (slots.rename) next.title = slots.rename;
  if (slots.person) next.person = slots.person;
  return next;
}

/** Fold a stored patch back onto a freshly parsed command. */
function applyPatch(slots, patch) {
  if (!patch) return slots;
  if (patch.whenIso) {
    const d = new Date(patch.whenIso);
    slots.when = d;
    slots.dateOnly = atLocal(d, 0);
    slots.timeOnly = { h: d.getHours(), m: d.getMinutes(), source: "confirmed" };
    slots.hadDate = true;
    slots.hadTime = true;
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
  INTENTS.CANCEL_EVENT, INTENTS.COMPLETE_TASK, INTENTS.DELEGATE_TASK,
]);

export const EXAMPLES = [
  "What time is it?",
  "Reschedule my 3pm Monday to Wednesday at 2",
  "Block 2 hours Thursday morning for the board deck",
  "What does Friday look like?",
  "Add a task to review the term sheet, high priority, due Friday",
  "When am I free tomorrow?",
  "Cancel my 4pm",
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

  if (patch) applyPatch(p.slots, patch);

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
    const { entity, day, pending: _p, proposal, ...rest } = r;
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
      if (slots.people.length) patch.attendees = slots.people.map((name) => ({ name }));
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

      // The day asked about becomes the topic, so a bare "book a 2pm" next
      // lands here rather than on today.
      return reply(describeDay(label, events, due), [], { day });
    }

    case INTENTS.QUERY_FREE: {
      const day = dayKey(slots.dateOnly || now);
      const slots_ = findFreeSlots(day, state.events, { minMins: slots.durationMins || 30 });
      if (!slots_.length) return reply("Nothing open that day inside working hours.", [], { day });
      const lines = slots_.map((s) => `${fmtTime(s.start)}–${fmtTime(s.end)} (${duration(s.mins * 60000)})`);
      return reply(`Open time:\n${lines.join("\n")}`, [], { day });
    }

    case INTENTS.PLAN_DAY: {
      // "how is the board cycle going" / "will the raise fit" — the pacing
      // arithmetic for one project, which is the question behind most of them.
      const hit = resolveProject(p.body, state.projects);
      if (hit.length && isConfident(hit) && /\bproject\b|\bon track\b|\bpace\b|\bhow (?:is|are|much)\b|\bfit\b|\bbehind\b/i.test(p.body)) {
        const load = projectLoad(hit[0].item, state.tasks, state.sessions, state.events, { now });
        return reply(describeLoad(load), [], { day: load.due });
      }
      // "what's most urgent" — ranked by how little room each has left, which
      // is not the same as what the user marked important.
      if (/\bmost urgent\b|\bwhat'?s urgent\b|\bwhat should i (?:do|work on) first\b|\bbehind on\b|\btriage\b/i.test(p.body)) {
        const ranked = triage(state.tasks, state.events, state.sessions, { now }).slice(0, 5);
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
        const spread = distribute(state.tasks, state.events, state.sessions, { now });
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
      const day = dayKey(slots.dateOnly || now);
      const plan = planDay(state.tasks, state.events, { day, now });
      if (!plan.tasks.length) return reply("Nothing to plan — no open tasks.");
      return gate(
        `laying ${plan.tasks.length} ${plan.tasks.length === 1 ? "task" : "tasks"} into the gaps around your meetings`,
        () => {
          applyPlan(plan.tasks.map((t) => t.id), day);
          const lines = plan.blocks.map((b) => `${fmtTime(b.start)} — ${b.task.title}`);
          return reply(
            `Planned ${plan.tasks.length} ${plan.tasks.length === 1 ? "task" : "tasks"} around your meetings.` +
              (lines.length ? `\n${lines.join("\n")}` : ""),
            [{ summary: `Planned ${plan.tasks.length} tasks` }],
            { day },
          );
        },
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

  const verb = {
    move: `move it to ${choice.when}`,
    cancel: "cancel it",
    complete: "complete it",
    delegate: `delegate it to ${choice.person}`,
  }[choice.intent];
  return ask(verb, state, { now, resolvedId: id });
}
