/**
 * Assistant tools: the bridge between a sentence and a state change.
 *
 * Every executor is a synchronous mutation against the local store, so a tool
 * call either succeeds or returns a plain error the model can read and correct.
 * Reads return ids alongside titles — without them the model cannot address the
 * thing it just found, which is what makes "move my 3pm" resolvable at all.
 */

import {
  getState, addEvent, updateEvent, deleteEvent, addTask, updateTask, toggleTask,
  addProject, setPlan, startFocus, dayKey,
} from "./store";
import { findFreeSlots, fmtTime, workOn } from "./agenda";
import { distribute } from "./schedule.js";
import { planOpts } from "./hours.js";

const iso = { type: "string", description: "ISO 8601 local datetime, e.g. 2026-08-05T14:00:00" };
const date = { type: "string", description: "Date as YYYY-MM-DD" };

export const TOOLS = [
  {
    name: "get_schedule",
    description:
      "Read events and tasks in a date range. Call this before changing anything that refers to an existing item — it returns the ids you need to move, cancel, or complete something.",
    input_schema: {
      type: "object",
      properties: { from: date, to: date },
      required: ["from", "to"],
    },
  },
  {
    name: "create_event",
    description: "Add a calendar event at a fixed time (meeting, call, block).",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        start: iso,
        end: iso,
        location: { type: "string" },
        notes: { type: "string" },
      },
      required: ["title", "start", "end"],
    },
  },
  {
    name: "move_event",
    description: "Reschedule an existing event. Pass the new start; end shifts to preserve duration unless you pass one.",
    input_schema: {
      type: "object",
      properties: { eventId: { type: "string" }, start: iso, end: iso },
      required: ["eventId", "start"],
    },
  },
  {
    name: "cancel_event",
    description: "Delete an event from the calendar.",
    input_schema: {
      type: "object",
      properties: { eventId: { type: "string" } },
      required: ["eventId"],
    },
  },
  {
    name: "create_task",
    description: "Add a task — work with a duration and optional deadline, but no fixed hour.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        projectName: { type: "string", description: "Existing project name; created if new." },
        estimateMins: { type: "integer" },
        due: date,
        priority: { type: "string", enum: ["critical", "high", "normal", "low"] },
        delegateTo: { type: "string", description: "Person's name if this is being handed off." },
      },
      required: ["title"],
    },
  },
  {
    name: "update_task",
    description: "Change a task's deadline, priority, estimate, or owner.",
    input_schema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        due: date,
        priority: { type: "string", enum: ["critical", "high", "normal", "low"] },
        estimateMins: { type: "integer" },
        delegateTo: { type: "string" },
        title: { type: "string" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "complete_task",
    description: "Mark a task done.",
    input_schema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
    },
  },
  {
    name: "create_project",
    description: "Create a project to group tasks under.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        client: { type: "string" },
        value: { type: "number", description: "Deal or budget value in dollars." },
      },
      required: ["name"],
    },
  },
  {
    name: "find_free_time",
    description: "Find open gaps on a date, respecting existing events and working hours.",
    input_schema: {
      type: "object",
      properties: { date, minMins: { type: "integer" } },
      required: ["date"],
    },
  },
  {
    name: "plan_day",
    description: "Rank open tasks and lay them into the day's free gaps. Returns the resulting plan.",
    input_schema: {
      type: "object",
      properties: { date },
      required: ["date"],
    },
  },
  {
    name: "start_focus",
    description: "Begin a focus session immediately. Use only when explicitly asked to start one.",
    input_schema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        label: { type: "string" },
        minutes: { type: "integer" },
      },
      required: ["minutes"],
    },
  },
];

const ok = (data) => JSON.stringify(data);
const err = (message) => JSON.stringify({ error: message });

function findProject(name) {
  if (!name) return null;
  const want = name.trim().toLowerCase();
  return getState().projects.find((p) => p.name.toLowerCase() === want) || null;
}

/**
 * Execute one tool call.
 * @returns {{content: string, isError: boolean, summary?: string}}
 *   `summary` is a short human line the UI shows as an action receipt.
 */
export function runTool(name, input) {
  const s = getState();

  switch (name) {
    case "get_schedule": {
      const events = s.events
        .filter((e) => {
          const d = dayKey(new Date(e.start));
          return d >= input.from && d <= input.to;
        })
        .sort((a, b) => new Date(a.start) - new Date(b.start))
        .map((e) => ({
          id: e.id, title: e.title, start: e.start, end: e.end, location: e.location || undefined,
        }));

      const tasks = s.tasks
        .filter((t) => !t.done)
        .map((t) => ({
          id: t.id, title: t.title, estimateMins: t.estimateMins, due: t.due || undefined,
          priority: t.priority, delegatedTo: t.delegatedTo || undefined,
          project: s.projects.find((p) => p.id === t.projectId)?.name,
        }));

      return { content: ok({ events, openTasks: tasks }), isError: false };
    }

    case "create_event": {
      const e = addEvent(input);
      return {
        content: ok({ id: e.id, ...input }),
        isError: false,
        summary: `Added “${e.title}” · ${fmtTime(e.start)}`,
      };
    }

    case "move_event": {
      const ev = s.events.find((e) => e.id === input.eventId);
      if (!ev) return { content: err("No event with that id. Call get_schedule first."), isError: true };
      // Preserve duration when only a new start is given — the common case for
      // "move it to Wednesday at 2".
      const duration = new Date(ev.end) - new Date(ev.start);
      const start = input.start;
      const end = input.end || new Date(new Date(start).getTime() + duration).toISOString().slice(0, 19);
      updateEvent(ev.id, { start, end });
      return {
        content: ok({ id: ev.id, title: ev.title, start, end }),
        isError: false,
        summary: `Moved “${ev.title}” → ${new Date(start).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} ${fmtTime(start)}`,
      };
    }

    case "cancel_event": {
      const ev = s.events.find((e) => e.id === input.eventId);
      if (!ev) return { content: err("No event with that id."), isError: true };
      deleteEvent(ev.id);
      return { content: ok({ cancelled: ev.title }), isError: false, summary: `Cancelled “${ev.title}”` };
    }

    case "create_task": {
      let projectId = findProject(input.projectName)?.id ?? null;
      if (!projectId && input.projectName) projectId = addProject({ name: input.projectName }).id;
      const t = addTask({
        projectId, title: input.title,
        estimateMins: input.estimateMins ?? 30,
        due: input.due ?? null,
        priority: input.priority ?? "normal",
        delegatedTo: input.delegateTo ?? "",
      });
      return {
        content: ok({ id: t.id, title: t.title }),
        isError: false,
        summary: input.delegateTo ? `Delegated “${t.title}” → ${input.delegateTo}` : `Added task “${t.title}”`,
      };
    }

    case "update_task": {
      const t = s.tasks.find((x) => x.id === input.taskId);
      if (!t) return { content: err("No task with that id. Call get_schedule first."), isError: true };
      const patch = {};
      for (const k of ["due", "priority", "estimateMins", "title"]) {
        if (input[k] !== undefined) patch[k] = input[k];
      }
      if (input.delegateTo !== undefined) patch.delegatedTo = input.delegateTo;
      updateTask(t.id, patch);
      return { content: ok({ id: t.id, ...patch }), isError: false, summary: `Updated “${t.title}”` };
    }

    case "complete_task": {
      const t = s.tasks.find((x) => x.id === input.taskId);
      if (!t) return { content: err("No task with that id."), isError: true };
      if (!t.done) toggleTask(t.id);
      return { content: ok({ done: t.title }), isError: false, summary: `Completed “${t.title}”` };
    }

    case "create_project": {
      const p = addProject({ name: input.name, client: input.client || "", value: input.value ?? null });
      return { content: ok({ id: p.id, name: p.name }), isError: false, summary: `Created project “${p.name}”` };
    }

    case "find_free_time": {
      const slots = findFreeSlots(input.date, s.events, { minMins: input.minMins ?? 15 });
      return {
        content: ok(slots.map((x) => ({ start: x.start.toISOString().slice(0, 19), mins: x.mins }))),
        isError: false,
      };
    }

    case "plan_day": {
      // Reads the live distribution rather than running a second planner —
      // see lib/schedule.js. The plan is derived, so there is nothing to
      // "apply": it is already what the calendar shows.
      const spread = distribute(s.tasks, s.events, s.sessions, planOpts(s.settings));
      setPlan(spread);
      const mine = workOn(spread.blocks, s.tasks, input.date);
      return {
        content: ok(mine.map((b) => ({ task: b.task.title, start: b.start, mins: b.mins }))),
        isError: false,
        summary: `${mine.length} ${mine.length === 1 ? "block" : "blocks"} planned for ${input.date}`,
      };
    }

    case "start_focus": {
      const t = input.taskId ? s.tasks.find((x) => x.id === input.taskId) : null;
      startFocus({
        taskId: t?.id ?? null,
        label: input.label || t?.title || "",
        plannedMs: (input.minutes || 25) * 60000,
      });
      return {
        content: ok({ started: true }),
        isError: false,
        summary: `Started ${input.minutes}m focus`,
      };
    }

    default:
      return { content: err(`Unknown tool: ${name}`), isError: true };
  }
}
