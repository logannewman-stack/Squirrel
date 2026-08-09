import { useCallback, useEffect, useRef, useState } from "react";
import { askAsync, resolveChoice, EXAMPLES } from "../lib/nlu";
import { addressOf } from "../lib/nlu/voice";
import { appendChat, clearChat, setSetting, claimAssist } from "../lib/store";
import { canSpeak, canListen, speak, stopSpeaking, listen, voiceSettings } from "../lib/speech";
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

export default function Assistant({ state, onClose, metered = false }) {
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(null);
  const [pendingChoice, setPendingChoice] = useState(null);
  const [heard, setHeard] = useState("");
  const [listening, setListening] = useState(false);
  const [talking, setTalking] = useState(false);
  const scroller = useRef(null);
  const timer = useRef(null);
  const mic = useRef(null);
  const chat = state.chat;
  const who = addressOf(state.settings?.identity || {});

  const voice = voiceSettings(state.settings);
  const hasEars = canListen();
  const hasVoice = canSpeak();

  useEffect(() => {
    if (!scroller.current) return;
    // An empty conversation opens at the top — the intro and suggestions are
    // the point of it. A conversation with anything in it follows the newest
    // line down. Without the first case, opening the sheet auto-scrolled past
    // the intro to the last suggestion.
    const top = chat.length === 0 ? 0 : scroller.current.scrollHeight;
    scroller.current.scrollTo({ top, behavior: chat.length === 0 ? "auto" : "smooth" });
  }, [chat.length, thinking, pendingChoice, heard]);

  // A pending timeout that fires after unmount would append to a dead view —
  // and a microphone left open, or a sentence still being spoken, outlives the
  // screen it belongs to.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      mic.current?.abort();
      stopSpeaking();
    },
    [],
  );

  /** Stop listening without sending whatever was half-heard. */
  const dropMic = useCallback(() => {
    mic.current?.abort();
    mic.current = null;
    setListening(false);
    setHeard("");
  }, []);

  /**
   * Open the microphone.
   *
   * Anything being spoken is cut off first. Talking over your own assistant is
   * how conversation works, and a synthesiser that carries on while you are
   * mid-sentence is also feeding itself into the microphone.
   */
  const startListening = useCallback(() => {
    if (!hasEars || mic.current) return;
    stopSpeaking();
    setTalking(false);
    setHeard("");
    setListening(true);
    mic.current = listen({
      onInterim: (t) => setHeard(t),
      onFinal: (t) => {
        mic.current = null;
        setListening(false);
        setHeard("");
        runRef.current(t);
      },
      onEnd: (gotSomething) => {
        mic.current = null;
        setListening(false);
        if (!gotSomething) setHeard("");
      },
      onError: () => {
        mic.current = null;
        setListening(false);
        setHeard("");
      },
    });
  }, [hasEars]);

  function present(res, elapsed = 0) {
    setThinking({ line: res.ack, variant: res.variant });
    // Time already spent waiting counts towards the beat. Without this, a turn
    // that went out to the fallback pauses twice — once for the network, then
    // again for a pause meant to stand in for thinking that has already
    // visibly happened.
    const wait = Math.max(0, (THINK_MS[res.variant] ?? 800) - elapsed);
    timer.current = setTimeout(() => {
      setThinking(null);
      appendChat({ role: "assistant", text: res.text, actions: res.actions });
      if (res.choices) setPendingChoice(res.choices);

      if (!voice.speak || !hasVoice) return;
      // The reply alone. On screen the action line and the sentence read as a
      // receipt above an answer and the eye skips one; spoken, they are the
      // same fact twice in a row — "Added Meeting with Ronnie, tomorrow at
      // 3:30. Booked one hour with Ronnie tomorrow at 3:30."
      const said = res.text || (res.actions || []).map((a) => a.summary).join(". ");
      setTalking(true);
      speak(said, {
        voiceURI: voice.voiceURI,
        rate: voice.rate,
        // Without this the persona's lower register is dropped and the butler
        // sounds exactly like the default voice, only slower.
        pitch: voice.pitch,
        // Delivery, not only timbre: where the pauses fall, and whether she
        // acknowledges before she reports. `who` is the form of address they
        // chose for themselves, so the butler can use it and the others leave
        // it alone.
        persona: voice.persona,
        address: who,
        // Used only if the model was downloaded and is still cached; `speak`
        // falls back to the device voice on its own if it is not.
        neuralVoice: voice.neuralVoice,
        onEnd: () => {
          setTalking(false);
          // Hands-free: reopen the microphone, but only where the turn is
          // plainly unfinished. Listening on after a closed answer means the
          // room is being recorded for no reason.
          if (voice.handsFree && hasEars && res.choices) startListening();
        },
      });
    }, wait);
  }

  /**
   * Send one message.
   *
   * `askAsync` is awaited, but in the ordinary case it has already finished
   * before the await — the rules answer without leaving the browser. It only
   * goes anywhere when the rules miss *and* a fallback has been turned on, so
   * the promise here costs a microtask, not a round trip.
   */
  async function run(text) {
    const msg = (text ?? input).trim();
    if (!msg || thinking) return;
    stopSpeaking();
    setTalking(false);
    setInput("");
    setPendingChoice(null);
    appendChat({ role: "user", text: msg });
    // A free account is spending one of its few turns for the day. Counted on
    // the way in rather than on a successful answer: a turn she could not parse
    // still used her, and refunding it would make the allowance impossible to
    // reason about from the outside.
    if (metered) claimAssist();

    const started = Date.now();
    const res = await askAsync(msg, state, {
      onFirst: (r) => setThinking({ line: r.ack, variant: r.variant }),
    });
    present(res, Date.now() - started);
  }

  // The microphone callbacks are created once and would otherwise close over
  // the first render's `run`, sending every dictated command against stale state.
  const runRef = useRef(run);
  runRef.current = run;

  function pick(option) {
    const choice = pendingChoice;
    setPendingChoice(null);
    appendChat({ role: "user", text: option.label });
    present(resolveChoice(choice, option.id, state));
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`relative ${listening ? "sq-hears" : ""}`}>
            <Squirrel size={34} pose={thinking || talking ? "thinking" : "idle"} title="Squirrel" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">Squirrel</h1>
            <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
              {listening
                ? "Listening…"
                : talking
                  ? "Speaking — say anything to interrupt."
                  : who
                    ? `At your service, ${who}.`
                    : "Changes your calendar and tasks directly."}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {hasVoice && (
            <button
              onClick={() => {
                stopSpeaking();
                setTalking(false);
                setSetting("voice", { ...(state.settings?.voice || {}), speak: !voice.speak });
              }}
              role="switch"
              aria-checked={voice.speak}
              title={voice.speak ? "Reading replies aloud" : "Replies are silent"}
              className={`rounded-md p-2 transition-colors hover:bg-[var(--hover)] ${
                voice.speak ? "text-[var(--ink)]" : "text-[var(--faint)]"
              }`}
            >
              <SpeakerIcon on={voice.speak} />
            </button>
          )}
          {chat.length > 0 && (
            <button onClick={clearChat} className="px-2 text-xs text-[var(--muted)] hover:text-[var(--ink)]">
              Clear
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close"
              className="grid h-9 w-9 place-items-center rounded-md text-[var(--muted)]
                         transition-colors hover:bg-[var(--hover)] hover:text-[var(--ink)]"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-[1.6]">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </header>

      <div ref={scroller} className="flex-1 overflow-y-auto px-6 py-6">
        {chat.length === 0 && !thinking && (
          <div className="mx-auto flex h-full max-w-lg flex-col justify-center">
            <div className="mb-7 flex flex-col items-center text-center">
              <Squirrel size={64} />
              <p className="mt-3 max-w-xs text-sm text-[var(--muted)]">
                Ask for anything on your calendar, tasks, or projects — or just say what changed.
              </p>
            </div>
            {/* A handful, not the whole catalogue. The empty state is an
                invitation, and an invitation with thirteen options is a menu. */}
            <p className="label mb-2.5">Try one</p>
            <div className="space-y-2">
              {EXAMPLES.slice(0, 5).map((e) => (
                <button
                  key={e}
                  onClick={() => run(e)}
                  className="flex w-full items-center gap-2.5 rounded-lg border border-[var(--line)] px-4 py-3
                             text-left text-sm transition-colors hover:border-[var(--ink)] hover:bg-[var(--hover)]"
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 fill-none stroke-[var(--faint)] stroke-[1.8]">
                    <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>{e}</span>
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
        <div className="mx-auto flex max-w-2xl items-center gap-2 sm:gap-3">
          {hasEars && (
            <button
              type="button"
              onClick={() => (listening ? dropMic() : startListening())}
              aria-pressed={listening}
              aria-label={listening ? "Stop listening" : "Speak"}
              title={listening ? "Stop listening" : "Speak"}
              className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-full border
                          transition-colors ${
                            listening
                              ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
                              : "border-[var(--line)] text-[var(--muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
                          }`}
            >
              {listening && (
                <span className="sq-ripple absolute inset-0 rounded-full border border-[var(--ink)]" />
              )}
              <MicIcon />
            </button>
          )}
          <input
            value={listening ? heard : input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={dropMic}
            readOnly={listening}
            placeholder={listening ? "Listening…" : hasEars ? "Ask, or tap the mic" : "What do I have Tuesday?"}
            className={`min-w-0 flex-1 rounded-md border bg-transparent px-4 py-2.5 text-sm outline-none
                        transition-colors placeholder:text-[var(--faint)] ${
                          listening ? "border-[var(--ink)] text-[var(--muted)]" : "border-[var(--line)] focus:border-[var(--ink)]"
                        }`}
          />
          <button
            type="submit"
            disabled={!input.trim() || !!thinking || listening}
            className="shrink-0 rounded-md bg-[var(--ink)] px-4 py-2.5 text-sm font-medium
                       text-[var(--paper)] transition-opacity disabled:opacity-30 sm:px-5"
          >
            Send
          </button>
        </div>
        {hasEars && voice.speak && (
          <p className="mx-auto mt-2 max-w-2xl text-[11px] text-[var(--faint)]">
            {voice.handsFree
              ? "Hands-free: she reopens the mic when she asks you something."
              : "Reading replies aloud. Hands-free is in Settings."}
          </p>
        )}
      </form>
    </div>
  );
}

const MicIcon = () => (
  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-none stroke-current stroke-[1.6]">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0014 0M12 18v3" strokeLinecap="round" />
  </svg>
);

const SpeakerIcon = ({ on }) => (
  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-none stroke-current stroke-[1.6]">
    <path d="M4 9h3l4.5-3.5v13L7 15H4z" strokeLinejoin="round" />
    {on ? (
      <path d="M15.5 9.5a3.5 3.5 0 010 5M18 7a7 7 0 010 10" strokeLinecap="round" />
    ) : (
      <path d="M16 9.5l4 5M20 9.5l-4 5" strokeLinecap="round" />
    )}
  </svg>
);
