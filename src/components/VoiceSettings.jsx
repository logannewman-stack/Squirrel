import { useEffect, useState } from "react";
import { setSetting } from "../lib/store";
import { canSpeak, canListen, onVoicesReady, speak, stopSpeaking, voiceSettings } from "../lib/speech";

/**
 * Voice, on both sides.
 *
 * Everything here runs on the device's own engines, which is why it is free
 * and offline like the rest of the assistant — and also why the panel has to
 * be candid about support. Dictation is Chrome and Safari; Firefox has no
 * recogniser at all, and a microphone button that silently does nothing is
 * worse than one that is absent with a reason next to it.
 *
 * The voice list is the fiddly part: Chrome returns an empty array on the
 * first call and fills it in asynchronously, so anything reading it at mount
 * concludes the device is mute.
 */
export default function VoiceSettings({ state }) {
  const [list, setList] = useState([]);
  const v = voiceSettings(state.settings);
  const hasVoice = canSpeak();
  const hasEars = canListen();

  useEffect(() => onVoicesReady(setList), []);
  useEffect(() => () => stopSpeaking(), []);

  const save = (patch) => setSetting("voice", { ...(state.settings?.voice || {}), ...patch });

  const preview = (over = {}) => {
    const next = { ...v, ...over };
    speak("Good morning. You have three meetings on Friday, and two hours of work planned.", {
      voiceURI: next.voiceURI,
      rate: next.rate,
    });
  };

  if (!hasVoice && !hasEars) {
    return (
      <p className="text-sm text-[var(--muted)]">
        This browser has neither speech synthesis nor dictation. Chrome and Safari have both;
        Firefox has neither.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {hasVoice ? (
        <>
          <Toggle
            on={v.speak}
            onChange={() => {
              stopSpeaking();
              save({ speak: !v.speak });
            }}
            label="Read replies aloud"
            note="She speaks what she would otherwise only print. Talking or typing cuts her off mid-sentence, the way it would a person."
          />

          {v.speak && (
            <div className="space-y-5 border-l border-[var(--line)] pl-4">
              <div>
                <label className="label mb-2 block" htmlFor="voice-pick">Voice</label>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    id="voice-pick"
                    value={v.voiceURI || ""}
                    onChange={(e) => {
                      save({ voiceURI: e.target.value || null });
                      preview({ voiceURI: e.target.value || null });
                    }}
                    className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--paper)]
                               px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--ink)]"
                  >
                    <option value="">System default</option>
                    {list.map((x) => (
                      <option key={x.voiceURI} value={x.voiceURI}>
                        {x.name} {x.localService ? "" : "(online)"}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => preview()}
                    className="shrink-0 rounded-full border border-[var(--line)] px-4 py-2 text-xs
                               transition-colors hover:border-[var(--ink)]"
                  >
                    Hear it
                  </button>
                </div>
                {!list.length && (
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    No voices installed for your language yet — the system default will be used.
                  </p>
                )}
              </div>

              <div>
                <label className="label mb-2 block" htmlFor="voice-rate">Pace</label>
                <div className="flex items-center gap-4">
                  <input
                    id="voice-rate"
                    type="range"
                    min={0.7}
                    max={1.6}
                    step={0.1}
                    value={v.rate}
                    onChange={(e) => save({ rate: Number(e.target.value) })}
                    onMouseUp={() => preview()}
                    onTouchEnd={() => preview()}
                    className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--line)] accent-[var(--ink)]"
                  />
                  <span className="num w-12 shrink-0 text-right text-sm">{v.rate.toFixed(1)}×</span>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-[var(--muted)]">This browser cannot speak. Chrome and Safari can.</p>
      )}

      {hasEars ? (
        <Toggle
          on={v.handsFree}
          onChange={() => save({ handsFree: !v.handsFree })}
          label="Hands-free replies"
          note="After she asks you something, the microphone reopens on its own so you can just answer. It stays shut after a finished answer — listening on to an empty room is not a feature."
        />
      ) : (
        <p className="text-sm text-[var(--muted)]">
          Dictation needs a browser with speech recognition — Chrome or Safari. The microphone is
          hidden here rather than shown doing nothing.
        </p>
      )}

      <p className="text-xs text-[var(--muted)]">
        Both run on this device. Nothing you say is sent anywhere, and there is no per-message cost —
        the same reason chats are unlimited on every plan.
      </p>
    </div>
  );
}

function Toggle({ on, onChange, label, note }) {
  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={onChange}
        className="flex w-full items-center justify-between gap-4 rounded-md border border-[var(--line)]
                   px-4 py-3 text-left text-sm transition-colors hover:border-[var(--ink)]"
      >
        <span>{label}</span>
        <span
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
            on ? "bg-[var(--ink)]" : "bg-[var(--line)]"
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-[var(--paper)] transition-all ${
              on ? "left-[18px]" : "left-0.5"
            }`}
          />
        </span>
      </button>
      <p className="mt-2 max-w-prose text-xs leading-relaxed text-[var(--muted)]">{note}</p>
    </div>
  );
}
