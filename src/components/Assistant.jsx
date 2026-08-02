import { useEffect, useRef, useState } from "react";
import { ask, resolveChoice, EXAMPLES } from "../lib/nlu";
import { appendChat, clearChat } from "../lib/store";

/**
 * The assistant runs entirely in the browser — no API call, no per-message
 * cost, works offline, answers instantly. Ambiguity becomes a choice list
 * rather than a guess, because moving the wrong meeting is far worse than one
 * extra tap.
 */
export default function Assistant({ state }) {
  const [input, setInput] = useState("");
  const [pendingChoice, setPendingChoice] = useState(null);
  const scroller = useRef(null);
  const chat = state.chat;

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [chat.length, pendingChoice]);

  function run(text) {
    const msg = (text ?? input).trim();
    if (!msg) return;
    setInput("");
    setPendingChoice(null);
    appendChat({ role: "user", text: msg });

    const res = ask(msg, state);
    appendChat({ role: "assistant", text: res.text, actions: res.actions });
    if (res.choices) setPendingChoice(res.choices);
  }

  function pick(option) {
    const choice = pendingChoice;
    setPendingChoice(null);
    appendChat({ role: "user", text: option.label });
    const res = resolveChoice(choice, option.id, state);
    appendChat({ role: "assistant", text: res.text, actions: res.actions });
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Assistant</h1>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Changes your calendar and tasks directly. Included on every plan.
          </p>
        </div>
        {chat.length > 0 && (
          <button onClick={clearChat} className="text-xs text-[var(--muted)] hover:text-[var(--ink)]">
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
                  onClick={() => run(e)}
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
              ) : (
                <div className="space-y-2">
                  {m.actions?.length > 0 && (
                    <ul className="space-y-1.5">
                      {m.actions.map((a, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--ink)]" />
                          <span>{a.summary}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {m.text && (
                    <p className="whitespace-pre-line text-sm leading-relaxed">{m.text}</p>
                  )}
                </div>
              )}
            </div>
          ))}

          {pendingChoice && (
            <div className="space-y-2">
              {pendingChoice.options.map((o) => (
                <button
                  key={o.id}
                  onClick={() => pick(o)}
                  className="block w-full rounded-md border border-[var(--line)] px-4 py-2.5
                             text-left text-sm transition-colors hover:border-[var(--ink)]"
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run();
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
            disabled={!input.trim()}
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
