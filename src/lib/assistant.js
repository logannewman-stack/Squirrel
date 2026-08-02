/**
 * Conversational assistant: a tool-use loop run from the browser.
 *
 * The loop is written by hand rather than using the SDK's tool runner, because
 * every tool here is a synchronous local mutation and the UI streams a receipt
 * for each one as it lands. Owning the loop keeps that reporting exact and
 * avoids pulling a beta surface into the browser bundle.
 *
 * The key travels from the user's browser straight to Anthropic — there is no
 * server to hold it. Acceptable for a single-operator tool on a trusted
 * machine; not acceptable for a hosted multi-tenant product. When Squirrel
 * grows a backend, this module is what moves behind it.
 */

import Anthropic from "@anthropic-ai/sdk";
import { TOOLS, runTool } from "./tools";

const MODEL = "claude-opus-5";
const MAX_TURNS = 8; // backstop against a pathological tool loop

function systemPrompt() {
  const now = new Date();
  return `You are the assistant inside Squirrel, an executive planning tool. The person you are talking to runs a company and has very little time. You act on their schedule directly through tools rather than telling them what to do.

Right now it is ${now.toLocaleString([], { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })} (${Intl.DateTimeFormat().resolvedOptions().timeZone}). Today's date is ${now.toISOString().slice(0, 10)}. Resolve relative dates — "Monday", "next Wednesday", "tomorrow" — against that, and prefer the next future occurrence when a weekday is ambiguous.

How to work:
- Anything referring to something that already exists ("my 3pm", "the board call", "that task") requires get_schedule first. You cannot move or complete what you have not looked up.
- Act, don't propose. If the request is clear, make the change and report it in one line. Only ask when a genuine ambiguity would send you to the wrong item — two candidate meetings, or a date that could read two ways.
- Times are local and written without a timezone suffix: 2026-08-05T14:00:00.
- When told to move something, keep its duration unless a new end time is given.
- After acting, reply in one or two sentences. State what changed. No preamble, no restating the request, no bulleted recap of a single action.
- Distinguish events from tasks: an event owns a slot on the clock, a task is work that needs fitting around them. "Call with Sarah at 3" is an event; "review the term sheet" is a task.
- If a request would drop something on the floor — moving a meeting onto a conflict, deleting work that is not done — say so plainly in your reply, but still do what was asked.`;
}

/**
 * Run one assistant turn to completion, executing tools along the way.
 *
 * @param {string} userText
 * @param {{role: string, content: any}[]} history  Prior API-shaped messages.
 * @param {string} apiKey
 * @param {(a: {summary: string, isError: boolean}) => void} onAction
 *   Fired per tool call so the UI can show receipts as they happen.
 * @returns {Promise<{text: string, messages: any[], error?: string}>}
 */
export async function runAssistant(userText, history, apiKey, onAction = () => {}) {
  if (!apiKey) return { text: "", messages: history, error: "no-key" };

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const messages = [...history, { role: "user", content: userText }];

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system: systemPrompt(),
        tools: TOOLS,
        messages,
      });

      // A safety decline returns HTTP 200 with an empty content array —
      // check before indexing into it.
      if (res.stop_reason === "refusal") {
        return { text: "", messages, error: "refusal" };
      }

      messages.push({ role: "assistant", content: res.content });

      if (res.stop_reason !== "tool_use") {
        const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
        return { text, messages };
      }

      // Execute every tool call from this turn and return the results in a
      // single user message. Splitting them across messages trains the model
      // out of making parallel calls.
      const results = [];
      for (const block of res.content) {
        if (block.type !== "tool_use") continue;
        let out;
        try {
          out = runTool(block.name, block.input || {});
        } catch (e) {
          out = { content: JSON.stringify({ error: String(e?.message || e) }), isError: true };
        }
        if (out.summary || out.isError) {
          onAction({ summary: out.summary || `${block.name} failed`, isError: out.isError });
        }
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: out.content,
          is_error: out.isError || undefined,
        });
      }
      messages.push({ role: "user", content: results });
    }

    return { text: "", messages, error: "too-many-steps" };
  } catch (e) {
    const status = e?.status;
    if (status === 401) return { text: "", messages, error: "bad-key" };
    if (status === 429) return { text: "", messages, error: "rate-limited" };
    return { text: "", messages, error: String(e?.message || e) };
  }
}

export const ERROR_COPY = {
  "no-key": "Add an API key in Settings to use the assistant.",
  "bad-key": "That API key was rejected. Check it in Settings.",
  "rate-limited": "Rate limited by the API. Try again shortly.",
  refusal: "The model declined that request.",
  "too-many-steps": "That took too many steps. Try breaking it into smaller asks.",
};
