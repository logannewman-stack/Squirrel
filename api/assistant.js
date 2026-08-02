import Anthropic from "@anthropic-ai/sdk";
import { asUser, asService, requireUser, json } from "./_lib/db.js";
import { TOOLS, runTool } from "./_lib/tools.js";

const MODEL = "claude-opus-5";
const MAX_TURNS = 8; // backstop against a pathological tool loop

/**
 * Effort is the cost/quality dial for this endpoint. Scheduling is not a
 * reasoning-heavy job, so `medium` is the starting point — raise it if the
 * assistant starts mis-resolving ambiguous requests, lower it if margin gets
 * tight. Thinking is deliberately left on: with it disabled, Opus 5
 * occasionally writes a tool call into visible text instead of emitting a
 * tool_use block, which fails silently — the turn succeeds and the call never
 * runs.
 */
const EFFORT = process.env.ASSISTANT_EFFORT || "medium";

function systemPrompt(tz, nowIso) {
  const now = new Date(nowIso);
  return `You are the assistant inside Squirrel, an executive planning tool. The person you are talking to runs a company and has very little time. You act on their schedule directly through tools rather than telling them what to do.

Right now it is ${now.toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz })} (${tz}). Today is ${nowIso.slice(0, 10)}. Resolve relative dates — "Monday", "next Wednesday", "tomorrow" — against that, preferring the next future occurrence when a weekday is ambiguous.

How to work:
- Anything referring to something that already exists ("my 3pm", "the board call", "that task") requires get_schedule first. You cannot move or complete what you have not looked up.
- Act, don't propose. If the request is clear, make the change and report it in one line. Ask only when a real ambiguity would send you to the wrong item.
- Times are local, written without a timezone suffix: 2026-08-05T14:00:00.
- Moving something keeps its duration unless a new end is given.
- Reply in one or two sentences stating what changed. No preamble, no restating the request.
- An event owns a slot on the clock; a task is work that needs fitting around them. "Call with Sarah at 3" is an event. "Review the term sheet" is a task.
- You cannot send messages. draft_message composes one for the user to send from their own phone — say so plainly, never imply you sent it.
- If a tool reports a plan limit, tell them which limit they hit and that upgrading lifts it. Do not retry the same call.`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });

  const auth = await requireUser(req);
  if (!auth) return json(res, 401, { error: "unauthorized" });

  const { message, history = [], timezone = "UTC" } = req.body || {};
  if (!message || typeof message !== "string") return json(res, 400, { error: "missing_message" });

  const service = asService();

  // Claim the chat before spending anything. This is atomic in Postgres, so two
  // concurrent requests cannot both slip past the last remaining chat.
  const { data: claimed, error: claimErr } = await service.rpc("claim_assistant_chat", {
    uid: auth.user.id,
  });
  if (claimErr) return json(res, 500, { error: "usage_check_failed" });
  if (!claimed) return json(res, 402, { error: "chat_limit_reached" });

  const db = asUser(auth.jwt);
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const messages = [...history, { role: "user", content: message }];
  const actions = [];
  const drafts = [];
  let inTokens = 0;
  let outTokens = 0;

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        output_config: { effort: EFFORT },
        // Cache the system prompt and tool definitions. They are identical on
        // every request and dominate the input, so this is the single biggest
        // lever on per-chat cost — cached reads bill at roughly a tenth.
        system: [
          {
            type: "text",
            text: systemPrompt(timezone, new Date().toISOString()),
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: TOOLS,
        messages,
      });

      inTokens += (response.usage?.input_tokens || 0) + (response.usage?.cache_creation_input_tokens || 0);
      outTokens += response.usage?.output_tokens || 0;

      // A safety decline returns HTTP 200 with empty content — check before
      // indexing into it.
      if (response.stop_reason === "refusal") {
        await service.rpc("record_assistant_tokens", { uid: auth.user.id, tin: inTokens, tout: outTokens });
        return json(res, 200, { error: "refusal", actions, drafts });
      }

      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason !== "tool_use") {
        const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
        await service.rpc("record_assistant_tokens", { uid: auth.user.id, tin: inTokens, tout: outTokens });
        return json(res, 200, { text, actions, drafts, messages });
      }

      // Execute every tool call from this turn and return all results in one
      // user message — splitting them trains the model out of parallel calls.
      const results = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        let out;
        try {
          out = await runTool(db, auth.user.id, block.name, block.input || {});
        } catch (e) {
          out = { content: JSON.stringify({ error: String(e?.message || e) }), isError: true };
        }
        if (out.summary || out.isError) {
          actions.push({ summary: out.summary || `${block.name} failed`, isError: !!out.isError });
        }
        if (out.draft) drafts.push(out.draft);
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: out.content,
          is_error: out.isError || undefined,
        });
      }
      messages.push({ role: "user", content: results });
    }

    await service.rpc("record_assistant_tokens", { uid: auth.user.id, tin: inTokens, tout: outTokens });
    return json(res, 200, { error: "too_many_steps", actions, drafts });
  } catch (e) {
    await service.rpc("record_assistant_tokens", { uid: auth.user.id, tin: inTokens, tout: outTokens });
    const status = e?.status;
    if (status === 429) return json(res, 429, { error: "rate_limited", actions, drafts });
    // Never leak provider errors to the client — they can carry key hints.
    console.error("assistant error", e);
    return json(res, 500, { error: "assistant_failed", actions, drafts });
  }
}
