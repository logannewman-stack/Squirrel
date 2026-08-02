/**
 * Optional AI scheduling.
 *
 * The app has no backend, so the request goes straight from the browser using a
 * key the user supplies and which never leaves their machine. That is fine for
 * a local-first personal tool and would not be for a hosted multi-user product:
 * a key in the browser is readable by the user and by anything running on the
 * page. If Squirrel ever gets a server, this call moves behind it.
 *
 * Every failure path here returns null so the caller falls back to the
 * deterministic planner. AI ordering is a refinement, never a dependency.
 */

import Anthropic from "@anthropic-ai/sdk";
import { DAILY_CAPACITY_MINS, MAX_DAILY_TASKS } from "./schedule";

const MODEL = "claude-opus-5";

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    plan: {
      type: "array",
      items: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          reason: { type: "string", description: "One short clause on why it sits here." },
        },
        required: ["taskId", "reason"],
        additionalProperties: false,
      },
    },
    note: { type: "string", description: "One warm sentence about the shape of the day." },
  },
  required: ["plan", "note"],
  additionalProperties: false,
};

const SYSTEM = `You order a daily task list for someone with ADHD. You are given every open task across their projects; you choose which ones make today and in what order.

What matters, in priority order:
1. Anything overdue or due today makes the list.
2. Lead with a short task. Starting is the hard part of ADHD, not finishing — the first item decides whether the list gets touched at all, so make it the cheapest real win available.
3. Keep the total under the stated capacity, and never exceed the stated maximum number of tasks. A list that cannot be finished is a list that gets abandoned.
4. Group tasks from the same project together where it costs nothing. Switching projects is expensive.

Never include a task id that was not given to you. Reasons are one short clause, plainly worded. The note is one warm sentence about the day's shape — never scolding, never motivational-poster.`;

function client(apiKey) {
  return new Anthropic({
    apiKey,
    // No backend to proxy through — see the file header for why this is an
    // acceptable trade here and where the boundary is.
    dangerouslyAllowBrowser: true,
  });
}

/**
 * @returns {Promise<{plan: {taskId: string, reason: string}[], note: string} | null>}
 *   null whenever AI planning is unavailable or fails — caller falls back.
 */
export async function planDayWithAI(tasks, projects, apiKey) {
  if (!apiKey || tasks.length === 0) return null;

  const projectName = Object.fromEntries(projects.map((p) => [p.id, p.name]));
  const today = new Date().toISOString().slice(0, 10);
  const payload = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    project: projectName[t.projectId] || "No project",
    estimateMins: t.estimateMins,
    due: t.due || null,
  }));

  try {
    const res = await client(apiKey).messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: PLAN_SCHEMA } },
      messages: [
        {
          role: "user",
          content: `Today is ${today}. Capacity: ${DAILY_CAPACITY_MINS} focused minutes. Maximum ${MAX_DAILY_TASKS} tasks.

Open tasks:
${JSON.stringify(payload, null, 2)}`,
        },
      ],
    });

    // A refusal returns 200 with an empty content array — guard before indexing.
    if (res.stop_reason === "refusal") return null;
    const text = res.content.find((b) => b.type === "text")?.text;
    if (!text) return null;

    const parsed = JSON.parse(text);
    const known = new Set(tasks.map((t) => t.id));
    const plan = (parsed.plan || [])
      .filter((p) => known.has(p.taskId))
      .slice(0, MAX_DAILY_TASKS);
    return plan.length ? { plan, note: parsed.note || "" } : null;
  } catch {
    return null;
  }
}
