import { useEffect, useRef, useState } from "react";
import { ask, resolveChoice, EXAMPLES } from "../lib/nlu";
import { addressOf } from "../lib/nlu/voice";
import { appendChat, clearChat } from "../lib/store";
import Thinking from "./Thinking";
import Squirrel from "./Squirrel";

/**
 * The assistant runs entirely in the browser — no API call, no per-message
 * cost, works offline, answers instantly.
 *
 * "Instantly" is the problem the pause solves. An answer that appears the
 * moment you hit enter reads as a form submitting; a brief, visible beat reads
 * as someone checking. The lookup is already done — this is presentation, and
 * it is short enough not to waste anyone's time.
 */
const THINK_MS = { calendar: 900, pen: 650 };

export default function Assistant({ state }) {
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(null);
  const [pendingChoice, setPendingChoice] = useState(null);
  const scroller = useRef(null);
  const timer = useRef(null);
  const chat = state.chat;
  const who = addressOf(state.settings?.identity || {});

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [chat.length, thinking, pendingChoice]);

  // A pending timeout that fires after unmount would append to a dead view.
  useEffect(() => () => clearTimeout(timer.current), []);

  function present(res) {
    setThinking({ line: res.ack, variant: res.variant });
    timer.current = setTimeout(() => {
      setThinking(null);
      appendChat({ role: "assistant", text: res.text, actions: res.actions });
      if (res.choices) setPendingChoice(res.choices);
    }, THINK_MS[res.variant] ?? 800);
  }

  function run(text) {
    const msg = (text ?? input).trim();
    if (!msg || thinking) return;
    setInput("");
    setPendingChoice(null);
    appendChat({ role: "user", text: msg });
    present(ask(msg, state));
  }

  function pick(option) {
    const choice = pendingChoice;
    setPendingChoice(null);
    appendChat({ role: "user", text: option.label });
    present(resolveChoice(choice, option.id, state));
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
        <div className="flex items-center gap-3">
          <Squirrel size={34} pose={thinking ? "thinking" : "idle"} title="Squirrel" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Assistant</h1>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {who ? `At your service, ${who}.` : "Changes your calendar and tasks directly."}
            </p>
          </div>
        </div>
        {chat.length > 0 && (
          <button onClick={clearChat} className="text-xs text-[var(--muted)] hover:text-[var(--ink)]">
            Clear
          </button>
        )}
      </header>

      <div ref={scroller} className="flex-1 overflow-y-auto px-6 py-6">
        {chat.length === 0 && !thinking && (
          <div className="mx-auto max-w-lg">
            <div className="mb-6 flex flex-col items-center text-center">
              <Squirrel size={72} />
              <p className="mt-3 max-w-xs text-sm text-[var(--muted)]">
                Ask for anything on your calendar, your tasks, or your projects.
              </p>
            </div>
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

          {thinking && <Thinking line={thinking.line} variant={thinking.variant} />}

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
            placeholder="What do I have Tuesday?"
            className="flex-1 rounded-md border border-[var(--line)] bg-transparent px-4 py-2.5
                       text-sm outline-none transition-colors placeholder:text-[var(--faint)]
                       focus:border-[var(--ink)]"
          />
          <button
            type="submit"
            disabled={!input.trim() || !!thinking}
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
