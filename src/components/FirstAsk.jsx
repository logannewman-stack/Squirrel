import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ask, resolveChoice } from "../lib/nlu";
import { subscribe, getState, appendChat } from "../lib/store";
import { FIRST_ASKS } from "../lib/firstrun";
import Squirrel from "./Squirrel";
import Thinking from "./Thinking";

/**
 * The last step of setup, and the only one that is not setup.
 *
 * This used to be three example sentences printed on cards, above a button
 * that closed the flow. It told somebody what they could say and then took the
 * chance to say it away — so the single moment that sells this app, watching
 * her actually do something, never happened during the one minute when
 * everybody is still paying attention. People arrived at an empty planner
 * having read a promise, which is the same as arriving at an empty planner.
 *
 * So this is the real assistant, not a mock of one. The suggestions type
 * themselves in, she runs them against the real store, and what she creates is
 * kept: the meeting made here is on the calendar they land on. By the time the
 * flow ends they have used the core interaction, seen the confirmation habit,
 * and own something — which is a different app from the one that opens empty.
 *
 * Nothing is simulated and no answer is canned. If a suggestion would fail,
 * it fails here, in front of us, rather than in front of them on day two.
 */

/** Fast enough not to be a wait, slow enough to read as typing. */
const KEYSTROKE_MS = 26;

export default function FirstAsk({ onDone }) {
  const state = useSyncExternalStore(subscribe, getState);
  const [turns, setTurns] = useState([]);
  const [typed, setTyped] = useState("");
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(null);
  const [choice, setChoice] = useState(null);
  const [used, setUsed] = useState([]);
  const timers = useRef([]);
  const scroller = useRef(null);

  // Every timeout here outlives the step if the flow is finished mid-answer,
  // and a setState after that is a warning in the console and a leak in the
  // heap. One list, cleared on the way out.
  const later = (fn, ms) => {
    const id = setTimeout(fn, ms);
    timers.current.push(id);
    return id;
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, thinking, choice]);

  const busy = typed !== "" || thinking !== null;

  /** Show the answer after a beat, the way the real assistant does. */
  function present(res) {
    setThinking({ line: res.ack, variant: res.variant });
    later(() => {
      setThinking(null);
      setTurns((t) => [...t, { role: "her", text: res.text, actions: res.actions || [] }]);
      appendChat({ role: "assistant", text: res.text, actions: res.actions });
      if (res.choices) setChoice(res.choices);
    }, res.variant === "pen" ? 620 : 820);
  }

  function send(text) {
    const msg = text.trim();
    if (!msg) return;
    setInput("");
    setChoice(null);
    setTurns((t) => [...t, { role: "you", text: msg }]);
    appendChat({ role: "user", text: msg });
    present(ask(msg, getState()));
  }

  /**
   * Play a suggestion in, one character at a time.
   *
   * The animation is the whole point of tapping rather than typing: it shows
   * where the words go and that they are ordinary words, which a chip that
   * silently submits does not. It is also the only moment in the flow that is
   * purely for pleasure, and a product that never spends a beat on that reads
   * as software rather than as something somebody made.
   */
  function play(suggestion) {
    if (busy) return;
    setUsed((u) => [...u, suggestion.text]);
    const chars = [...suggestion.text];
    chars.forEach((_, i) => {
      later(() => setTyped(chars.slice(0, i + 1).join("")), KEYSTROKE_MS * (i + 1));
    });
    later(() => {
      setTyped("");
      send(suggestion.text);
    }, KEYSTROKE_MS * chars.length + 260);
  }

  function pick(option) {
    const c = choice;
    setChoice(null);
    setTurns((t) => [...t, { role: "you", text: option.label }]);
    appendChat({ role: "user", text: option.label });
    present(resolveChoice(c, option.id, getState()));
  }

  // What now exists because of this step. The count is the reward — an app
  // that opens with something in it is a different first day from one that
  // opens with an empty week and an encouraging sentence.
  const made = {
    events: state.events.length,
    tasks: state.tasks.filter((t) => !t.done).length,
    projects: state.projects.filter((p) => !p.archived).length,
  };
  const anything = made.events + made.tasks + made.projects > 0;
  const left = FIRST_ASKS.filter((s) => !used.includes(s.text));

  return (
    <div className="sq-step flex min-h-0 flex-col">
      <p className="label">Last thing — and it's the good one</p>
      <h2 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.025em]">
        {anything ? "She's already started." : "Tell her something."}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
        {anything
          ? "That's real — it's on your calendar and it comes with you. Try another, or go in."
          : "Tap one and watch. Whatever she does here is yours to keep."}
      </p>

      {/* ------------------------------------------------------ the exchange */}
      <div
        ref={scroller}
        className="mt-5 flex max-h-[42vh] min-h-[8.5rem] flex-col gap-3 overflow-y-auto
                   rounded-xl border border-[var(--line)] bg-[var(--sunken)] px-4 py-4"
      >
        {turns.length === 0 && !thinking && !typed && (
          <div className="flex items-center gap-3 py-1">
            <Squirrel size={38} title="Squirrel" />
            <p className="text-sm text-[var(--muted)]">Ready when you are.</p>
          </div>
        )}

        {turns.map((t, i) =>
          t.role === "you" ? (
            <p key={i} className="self-end rounded-2xl rounded-br-md bg-[var(--ink)] px-3.5 py-2
                                  text-sm text-[var(--paper)]">
              {t.text}
            </p>
          ) : (
            <div key={i} className="sq-step">
              {t.text && <p className="text-sm leading-relaxed">{t.text}</p>}
              {/* The receipt. She said what she would do; this is the row that
                  proves she did, and it is the thing they will recognise on
                  the calendar in ten seconds' time. */}
              {t.actions.map((a, j) => (
                <p key={j} className="mt-1.5 flex items-start gap-2 text-xs text-[var(--muted)]">
                  <svg viewBox="0 0 24 24" aria-hidden
                       className="mt-[3px] h-3 w-3 shrink-0 fill-none stroke-current stroke-[2.4]">
                    <path d="M4 12.5l5 5L20 6.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>{a.summary}</span>
                </p>
              ))}
            </div>
          ),
        )}

        {typed && (
          <p className="self-end rounded-2xl rounded-br-md bg-[var(--ink)] px-3.5 py-2
                        text-sm text-[var(--paper)]">
            {typed}
            <span className="sq-caret ml-0.5 inline-block w-px align-middle" aria-hidden>&nbsp;</span>
          </p>
        )}

        {thinking && <Thinking line={thinking.line} variant={thinking.variant} />}

        {/* A confirmation is not friction to be hidden during a demo — it is
            the habit that makes an assistant safe to hand a calendar to, and
            somebody who has tapped Yes once already knows how she works. */}
        {choice && (
          <div className="sq-step flex flex-wrap gap-2 pt-0.5">
            {choice.options.map((o) => (
              <button
                key={o.id}
                onClick={() => pick(o)}
                className="rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3.5 py-2
                           text-sm transition-colors hover:border-[var(--ink)]"
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ----------------------------------------------------- what to try */}
      {left.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {left.map((s) => (
            <li key={s.text}>
              <button
                onClick={() => play(s)}
                disabled={busy}
                className="group flex w-full items-center gap-3 rounded-lg border border-[var(--line)]
                           px-4 py-2.5 text-left transition-colors hover:border-[var(--ink)]
                           disabled:opacity-40"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">“{s.text}”</span>
                  <span className="mt-0.5 block text-[11px] text-[var(--faint)]">{s.teaches}</span>
                </span>
                <span className="shrink-0 text-[11px] font-medium text-[var(--muted)]
                                 group-hover:text-[var(--ink)]">
                  Try it
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Typing your own is the actual skill, so the field is here from the
          start rather than unlocked after the tour. */}
      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="mt-3 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          placeholder="…or say it your own way"
          className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-transparent px-3.5 py-2.5
                     text-sm outline-none placeholder:text-[var(--faint)] focus:border-[var(--ink)]
                     disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="shrink-0 rounded-lg border border-[var(--line)] px-4 py-2.5 text-sm
                     transition-colors hover:border-[var(--ink)] disabled:opacity-30"
        >
          Ask
        </button>
      </form>

      {/* Quiet until there is something to be proud of. Filled, this button is
          the loudest thing on the step and pulls against the very thing the
          step exists for — including, at the worst moment, against the Yes that
          is waiting to be tapped. Once she has actually done something it earns
          the weight, and says what is waiting rather than "skip". */}
      <button
        onClick={onDone}
        className={`mt-5 w-full rounded-lg py-3 text-sm font-medium transition-all ${
          anything
            ? "bg-[var(--ink)] text-[var(--paper)] hover:opacity-90"
            : "border border-[var(--line)] text-[var(--muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
        }`}
      >
        {anything ? `Open Squirrel — ${sayMade(made)} waiting` : "Skip for now"}
      </button>
    </div>
  );
}

/** What was made, counted the way a person would say it. */
function sayMade({ events, tasks, projects }) {
  const parts = [];
  if (events) parts.push(`${events} ${events === 1 ? "meeting" : "meetings"}`);
  if (tasks) parts.push(`${tasks} ${tasks === 1 ? "task" : "tasks"}`);
  if (projects) parts.push(`${projects} ${projects === 1 ? "project" : "projects"}`);
  if (parts.length <= 1) return parts[0] ?? "nothing";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}
