import { useEffect, useRef, useState } from "react";
import { runAssistant, ERROR_COPY } from "../lib/assistant";
import { appendChat, clearChat } from "../lib/store";

const EXAMPLES = [
  "Reschedule my 3pm Monday to Wednesday at 2",
  "Block two hours Thursday morning for the board deck",
  "What's my Friday look like?",
  "Add a task to review the term sheet, high priority, due Friday",
];

export default function Assistant({ state }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [actions, setActions] = useState([]);
  // API-shaped history, kept separate from the rendered transcript: it carries
  // tool_use and tool_result blocks the UI never shows but the model needs.
  const apiHistory = useRef([]);
  const scroller = useRef(null);

  const chat = state.chat;

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [chat.length, busy, actions.length]);

  async function send(text) {
    const msg = (text ?? input).trim();
    if (!msg || busy) return;
    setInput("");
    setActions([]);
    appendChat({ role: "user", text: msg });
    setBusy(true);

    const live = [];
    const res = await runAssistant(msg, apiHistory.current, state.settings.apiKey, (a) => {
      live.push(a);
      setActions([...live]);
    });

    apiHistory.current = res.messages;
    if (res.error) {
      appendChat({ role: "error", text: ERROR_COPY[res.error] || res.error });
    } else {
      appendChat({ role: "assistant", text: res.text, actions: live });
    }
    setActions([]);
    setBusy(false);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Assistant</h1>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Changes your calendar and tasks directly.
          </p>
        </div>
        {chat.length > 0 && (
          <button
            onClick={() => {
              clearChat();
              apiHistory.current = [];
            }}
            className="text-xs text-[var(--muted)] hover:text-[var(--ink)]"
          >
            Clear
          </button>
        )}
      </header>

      <div ref={scroller} className="flex-1 overflow-y-auto px-6 py-6">
        {chat.length === 0 && (
          <div className="mx-auto max-w-lg">
            <p className="label mb-3">Try</p>
            <div className="space-y-2">
              {EXAMPLES.map((e) => (
                <button
                  key={e}
                  onClick={() => send(e)}
                  className="block w-full rounded-md border border-[var(--line)] px-4 py-3
                             text-left text-sm transition-colors hover:border-[var(--ink)]"
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mx-auto max-w-2xl space-y-5">
          {chat.map((m) => (
            <div key={m.id}>
              {m.role === "user" ? (
                <div className="flex justify-end">
                  <p className="max-w-[85%] rounded-lg bg-[var(--ink)] px-4 py-2.5 text-sm text-[var(--paper)]">
                    {m.text}
                  </p>
                </div>
              ) : m.role === "error" ? (
                <p className="rounded-md border border-[var(--line)] px-4 py-2.5 text-sm text-[var(--muted)]">
                  {m.text}
                </p>
              ) : (
                <div className="space-y-2">
                  {m.actions?.length > 0 && <Receipts actions={m.actions} />}
                  {m.text && <p className="text-sm leading-relaxed">{m.text}</p>}
                </div>
              )}
            </div>
          ))}

          {busy && (
            <div className="space-y-2">
              {actions.length > 0 && <Receipts actions={actions} />}
              <p className="text-sm text-[var(--muted)]">Working…</p>
            </div>
          )}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="border-t border-[var(--line)] px-6 py-4"
      >
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Move my 3pm to Thursday…"
            className="flex-1 rounded-md border border-[var(--line)] bg-transparent px-4 py-2.5
                       text-sm outline-none transition-colors placeholder:text-[var(--faint)]
                       focus:border-[var(--ink)]"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-md bg-[var(--ink)] px-5 py-2.5 text-sm font-medium
                       text-[var(--paper)] transition-opacity disabled:opacity-30"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

/** Action receipts — what actually changed, shown before the model's reply. */
function Receipts({ actions }) {
  return (
    <ul className="space-y-1.5">
      {actions.map((a, i) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          <span className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${a.isError ? "bg-[var(--faint)]" : "bg-[var(--ink)]"}`} />
          <span className={a.isError ? "text-[var(--muted)]" : ""}>{a.summary}</span>
        </li>
      ))}
    </ul>
  );
}
