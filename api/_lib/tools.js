/**
 * Server-side assistant tools.
 *
 * These run against Postgres under the caller's JWT, so RLS is still the
 * boundary — a tool cannot reach rows the user could not read themselves.
 * Reads always return ids alongside titles: without them the model cannot
 * address the thing it just found, which is what makes "move my 3pm"
 * resolvable rather than a guess.
 */

const iso = { type: "string", description: "ISO 8601 local datetime, e.g. 2026-08-05T14:00:00" };
const date = { type: "string", description: "Date as YYYY-MM-DD" };

export const TOOLS = [
  {
    name: "get_schedule",
    description:
      "Read events and open tasks in a date range. Call this before changing anything that refers to an existing item — it returns the ids needed to move, cancel, or complete something.",
    input_schema: { type: "object", properties: { from: date, to: date }, required: ["from", "to"] },
  },
  {
    name: "create_event",
    description: "Add a calendar event at a fixed time.",
    input_schema: {
      type: "object",
      properties: { title: { type: "string" }, start: iso, end: iso, location: { type: "string" } },
      required: ["title", "start", "end"],
    },
  },
  {
    name: "move_event",
    description: "Reschedule an event. Duration is preserved unless a new end is given.",
    input_schema: {
      type: "object",
      properties: { eventId: { type: "string" }, start: iso, end: iso },
      required: ["eventId", "start"],
    },
  },
  {
    name: "cancel_event",
    description: "Delete an event.",
    input_schema: {
      type: "object", properties: { eventId: { type: "string" } }, required: ["eventId"],
    },
  },
  {
    name: "create_task",
    description: "Add a task — work with a duration and optional deadline, but no fixed hour.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        projectName: { type: "string" },
        estimateMins: { type: "integer" },
        due: date,
        priority: { type: "string", enum: ["critical", "high", "normal", "low"] },
        delegateTo: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "update_task",
    description: "Change a task's deadline, priority, estimate, title, or owner.",
    input_schema: {
      type: "object",
      properties: {
        taskId: { type: "string" }, due: date, title: { type: "string" },
        priority: { type: "string", enum: ["critical", "high", "normal", "low"] },
        estimateMins: { type: "integer" }, delegateTo: { type: "string" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "complete_task",
    description: "Mark a task done.",
    input_schema: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"] },
  },
  {
    name: "create_project",
    description: "Create a project to group work under.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" }, client: { type: "string" }, value: { type: "number" } },
      required: ["name"],
    },
  },
  {
    name: "draft_message",
    description:
      "Compose a text or email for the user to send from their own device. This does NOT send anything — it returns a draft the app opens in the user's Messages or Mail app, where they tap send.",
    input_schema: {
      type: "object",
      properties: {
        channel: { type: "string", enum: ["sms", "email"] },
        to: { type: "string", description: "Phone number or email address, if known." },
        toName: { type: "string", description: "Person's name, for display." },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["channel", "body"],
    },
  },
];

const ok = (d) => ({ content: JSON.stringify(d), isError: false });
const bad = (m) => ({ content: JSON.stringify({ error: m }), isError: true });

const fmtTime = (v) =>
  new Date(v).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** Plan-limit violations surface as Postgres check_violation with our message. */
function limitError(error) {
  const m = error?.message || "";
  if (m.includes("plan_limit_projects")) return bad("Project limit reached on this plan. Ask the user to upgrade.");
  if (m.includes("plan_limit_tasks")) return bad("Open-task limit reached on this plan. Ask the user to upgrade.");
  return null;
}

export async function runTool(db, userId, name, input) {
  switch (name) {
    case "get_schedule": {
      const from = `${input.from}T00:00:00`;
      const to = `${input.to}T23:59:59`;
      const [{ data: events }, { data: tasks }] = await Promise.all([
        db.from("events").select("id,title,starts_at,ends_at,location")
          .gte("starts_at", from).lte("starts_at", to).order("starts_at"),
        db.from("tasks").select("id,title,estimate_mins,due,priority,delegated_to,project_id")
          .eq("done", false),
      ]);
      return ok({
        events: (events || []).map((e) => ({
          id: e.id, title: e.title, start: e.starts_at, end: e.ends_at,
          location: e.location || undefined,
        })),
        openTasks: (tasks || []).map((t) => ({
          id: t.id, title: t.title, estimateMins: t.estimate_mins,
          due: t.due || undefined, priority: t.priority,
          delegatedTo: t.delegated_to || undefined,
        })),
      });
    }

    case "create_event": {
      const { data, error } = await db.from("events").insert({
        user_id: userId, title: input.title, starts_at: input.start,
        ends_at: input.end, location: input.location || "",
      }).select("id,title,starts_at").single();
      if (error) return bad(error.message);
      return { ...ok(data), summary: `Added “${data.title}” · ${fmtTime(data.starts_at)}` };
    }

    case "move_event": {
      const { data: ev } = await db.from("events")
        .select("id,title,starts_at,ends_at").eq("id", input.eventId).maybeSingle();
      if (!ev) return bad("No event with that id. Call get_schedule first.");
      const dur = new Date(ev.ends_at) - new Date(ev.starts_at);
      const end = input.end || new Date(new Date(input.start).getTime() + dur).toISOString();
      const { error } = await db.from("events")
        .update({ starts_at: input.start, ends_at: end }).eq("id", ev.id);
      if (error) return bad(error.message);
      return {
        ...ok({ id: ev.id, title: ev.title, start: input.start, end }),
        summary: `Moved “${ev.title}” → ${new Date(input.start).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} ${fmtTime(input.start)}`,
      };
    }

    case "cancel_event": {
      const { data: ev } = await db.from("events").select("id,title").eq("id", input.eventId).maybeSingle();
      if (!ev) return bad("No event with that id.");
      const { error } = await db.from("events").delete().eq("id", ev.id);
      if (error) return bad(error.message);
      return { ...ok({ cancelled: ev.title }), summary: `Cancelled “${ev.title}”` };
    }

    case "create_task": {
      let projectId = null;
      if (input.projectName) {
        const { data: found } = await db.from("projects").select("id")
          .ilike("name", input.projectName).maybeSingle();
        if (found) projectId = found.id;
        else {
          const { data: made, error } = await db.from("projects")
            .insert({ user_id: userId, name: input.projectName }).select("id").single();
          if (error) return limitError(error) || bad(error.message);
          projectId = made.id;
        }
      }
      const { data, error } = await db.from("tasks").insert({
        user_id: userId, project_id: projectId, title: input.title,
        estimate_mins: input.estimateMins ?? 30, due: input.due ?? null,
        priority: input.priority ?? "normal", delegated_to: input.delegateTo ?? "",
      }).select("id,title").single();
      if (error) return limitError(error) || bad(error.message);
      return {
        ...ok(data),
        summary: input.delegateTo
          ? `Delegated “${data.title}” → ${input.delegateTo}`
          : `Added task “${data.title}”`,
      };
    }

    case "update_task": {
      const patch = {};
      if (input.due !== undefined) patch.due = input.due;
      if (input.title !== undefined) patch.title = input.title;
      if (input.priority !== undefined) patch.priority = input.priority;
      if (input.estimateMins !== undefined) patch.estimate_mins = input.estimateMins;
      if (input.delegateTo !== undefined) patch.delegated_to = input.delegateTo;
      const { data, error } = await db.from("tasks").update(patch)
        .eq("id", input.taskId).select("id,title").maybeSingle();
      if (error) return bad(error.message);
      if (!data) return bad("No task with that id. Call get_schedule first.");
      return { ...ok(data), summary: `Updated “${data.title}”` };
    }

    case "complete_task": {
      const { data, error } = await db.from("tasks")
        .update({ done: true, done_at: new Date().toISOString() })
        .eq("id", input.taskId).select("id,title").maybeSingle();
      if (error) return bad(error.message);
      if (!data) return bad("No task with that id.");
      return { ...ok(data), summary: `Completed “${data.title}”` };
    }

    case "create_project": {
      const { data, error } = await db.from("projects").insert({
        user_id: userId, name: input.name, client: input.client || "", value: input.value ?? null,
      }).select("id,name").single();
      if (error) return limitError(error) || bad(error.message);
      return { ...ok(data), summary: `Created project “${data.name}”` };
    }

    case "draft_message": {
      // Deliberately does not send. iOS never permits an app to send an SMS
      // without the user tapping send, and texting someone's contacts
      // automatically is the pattern that draws TCPA liability. The app hands
      // the draft to the user's own Messages or Mail app instead.
      return {
        ...ok({ drafted: true, ...input }),
        summary: `Drafted ${input.channel === "sms" ? "text" : "email"}${input.toName ? ` to ${input.toName}` : ""}`,
        draft: input,
      };
    }

    default:
      return bad(`Unknown tool: ${name}`);
  }
}
