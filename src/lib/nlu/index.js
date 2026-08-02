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
import { resolveEvent, resolveTask, resolveProject, isConfident } from "./resolve.js";
import { describe, toLocalIso, dayKey, atLocal } from "./datetime.js";
import { acknowledge, describeDay, addressOf } from "./voice.js";
import {
  addEvent, updateEvent, deleteEvent, addTask, updateTask, toggleTask,
  applyPlan,
} from "../store";
import { planDay, findFreeSlots, fmtTime } from "../agenda";
import { duration } from "../format";

const DEFAULT_MEETING_MINS = 60;
const DEFAULT_TASK_MINS = 30;

const reply = (text, actions = []) => ({ text, actions, choices: null });
const askWhich = (text, choices) => ({ text, actions: [], choices });

/** Lookups scan the calendar; changes write to it. The art should match. */
const PEN_INTENTS = new Set([
  INTENTS.CREATE_EVENT, INTENTS.CREATE_TASK, INTENTS.MOVE_EVENT,
  INTENTS.CANCEL_EVENT, INTENTS.COMPLETE_TASK, INTENTS.DELEGATE_TASK,
]);

export const EXAMPLES = [
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
  const p = parse(text, now);
  const { slots } = p;
  const identity = state.settings?.identity || {};

  const openTasks = state.tasks.filter((t) => !t.done);

  const decorate = (res) => ({
    ...res,
    intent: p.intent,
    ack: acknowledge(identity, p.intent, now),
    variant: PEN_INTENTS.has(p.intent) ? "pen" : "calendar",
  });

  return decorate(run());

  function run() {
  switch (p.intent) {
    // ------------------------------------------------------------- move
    case INTENTS.MOVE_EVENT: {
      if (!slots.when) {
        return reply("Move it to when? Give me a day and a time — “Wednesday at 2”, say.");
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
      updateEvent(ev.id, { start: toLocalIso(start), end: toLocalIso(end) });

      const clash = state.events.find(
        (o) => o.id !== ev.id && new Date(o.start) < end && new Date(o.end) > start,
      );
      return reply(
        `Moved “${ev.title}” to ${describe(start, now)}.` +
          (clash ? ` Heads up — that now overlaps “${clash.title}”.` : ""),
        [{ summary: `Moved “${ev.title}” → ${describe(start, now)}` }],
      );
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
      deleteEvent(ev.id);
      return reply(`Cancelled “${ev.title}”.`, [{ summary: `Cancelled “${ev.title}”` }]);
    }

    // ----------------------------------------------------------- create
    case INTENTS.CREATE_EVENT: {
      if (!slots.when) return reply("When should I put it? A day and time works — “Thursday at 10”.");
      const mins = slots.durationMins || DEFAULT_MEETING_MINS;
      const people = slots.people || [];
      // When the whole sentence was consumed by slots there is no title left,
      // so build one from who it is with.
      const title =
        slots.title || (people.length ? `Meeting with ${people.join(" and ")}` : "Meeting");
      const start = slots.when;
      const end = new Date(start.getTime() + mins * 60000);
      addEvent({
        title,
        start: toLocalIso(start),
        end: toLocalIso(end),
        attendees: people.map((name) => ({ name })),
        notes: slots.subject || "",
      });
      const withWho = people.length ? ` with ${people.join(" and ")}` : "";
      const about = slots.subject ? ` about ${slots.subject}` : "";
      return reply(
        `Booked ${duration(mins * 60000)}${withWho}${about} ${describe(start, now)}.`,
        [{ summary: `Added “${title}” · ${describe(start, now)}` }],
      );
    }

    case INTENTS.CREATE_TASK: {
      const title = slots.title;
      if (!title) return reply("What's the task?");
      const projectHit = resolveProject(p.text, state.projects);
      addTask({
        projectId: projectHit.length && isConfident(projectHit) ? projectHit[0].item.id : null,
        title,
        estimateMins: slots.durationMins || DEFAULT_TASK_MINS,
        due: slots.dateOnly ? dayKey(slots.dateOnly) : null,
        priority: slots.priority || "normal",
        delegatedTo: slots.person || "",
      });
      const bits = [];
      if (slots.dateOnly) bits.push(`due ${dayKey(slots.dateOnly)}`);
      if (slots.priority) bits.push(slots.priority);
      if (slots.person) bits.push(`for ${slots.person}`);
      return reply(
        `Added “${title}”${bits.length ? ` — ${bits.join(", ")}` : ""}.`,
        [{ summary: `Added task “${title}”` }],
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
      toggleTask(t.id);
      return reply(`Done — “${t.title}”.`, [{ summary: `Completed “${t.title}”` }]);
    }

    case INTENTS.DELEGATE_TASK: {
      if (!slots.person) return reply("Delegate it to whom?");
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
      updateTask(t.id, { delegatedTo: slots.person });
      return reply(`“${t.title}” is with ${slots.person} now.`, [
        { summary: `Delegated “${t.title}” → ${slots.person}` },
      ]);
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

      return reply(describeDay(label, events, due));
    }

    case INTENTS.QUERY_FREE: {
      const day = dayKey(slots.dateOnly || now);
      const slots_ = findFreeSlots(day, state.events, { minMins: slots.durationMins || 30 });
      if (!slots_.length) return reply("Nothing open that day inside working hours.");
      const lines = slots_.map((s) => `${fmtTime(s.start)}–${fmtTime(s.end)} (${duration(s.mins * 60000)})`);
      return reply(`Open time:\n${lines.join("\n")}`);
    }

    case INTENTS.PLAN_DAY: {
      const day = dayKey(slots.dateOnly || now);
      const plan = planDay(state.tasks, state.events, { day, now });
      if (!plan.tasks.length) return reply("Nothing to plan — no open tasks.");
      applyPlan(plan.tasks.map((t) => t.id), day);
      const lines = plan.blocks.map((b) => `${fmtTime(b.start)} — ${b.task.title}`);
      return reply(
        `Planned ${plan.tasks.length} ${plan.tasks.length === 1 ? "task" : "tasks"} around your meetings.` +
          (lines.length ? `\n${lines.join("\n")}` : ""),
        [{ summary: `Planned ${plan.tasks.length} tasks` }],
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
        `I didn't catch that. I handle scheduling, tasks, and projects — try something like:\n${EXAMPLES.slice(0, 3).map((e) => `• ${e}`).join("\n")}`,
      );
  }
  }
}

/** Continue after the user picks from a choice list. */
export function resolveChoice(choice, id, state, now = new Date()) {
  const verb = {
    move: `move it to ${choice.when}`,
    cancel: "cancel it",
    complete: "complete it",
    delegate: `delegate it to ${choice.person}`,
  }[choice.intent];
  return ask(verb, state, { now, resolvedId: id });
}
