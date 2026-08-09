import { useEffect, useState } from "react";
import { setSetting } from "../lib/store";
import {
  canSpeak, canListen, onVoicesReady, speak, stopSpeaking, voiceSettings,
  PERSONAS, bestVoiceFor, isHiFi, activeVoice,
} from "../lib/speech";
import { addressOf } from "../lib/nlu/voice";

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

  // A line that exercises everything a persona changes: an action to
  // acknowledge, a name to use, and a time in the tail for the pause to land
  // in front of. The old preview was a greeting and a count, which sounded
  // identical in all three.
  const preview = (over = {}) => {
    const next = { ...v, ...over };
    speak("Booked 1h with Priya tomorrow at 2:00 PM. That leaves you three clear hours.", {
      voiceURI: next.voiceURI,
      rate: next.rate,
      pitch: next.pitch,
      persona: next.persona,
      address: addressOf(state.settings?.identity || {}),
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
              {/* A character rather than three sliders. Nobody wants to tune a
                  pitch value; people want "the calm English one", and the
                  persona sets the voice, the rate and the register together. */}
              <div>
                <label className="label mb-2 block">Character</label>
                <div className="flex flex-col gap-2">
                  {Object.values(PERSONAS).map((persona) => {
                    const on = v.persona === persona.id;
                    return (
                      <button
                        key={persona.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          // Clearing the explicit voice and rate lets the
                          // persona choose both; keeping them would make the
                          // picker look broken for anyone who had tuned it.
                          save({ persona: persona.id, voiceURI: null, rate: null, pitch: null });
                          preview({
                            persona: persona.id,
                            voiceURI: bestVoiceFor(persona.id)?.voiceURI ?? null,
                            rate: persona.rate,
                            pitch: persona.pitch,
                          });
                        }}
                        className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                          on ? "border-[var(--ink)] bg-[var(--hover)]" : "border-[var(--line)] hover:border-[var(--ink)]"
                        }`}
                      >
                        <span className="block text-sm font-medium">{persona.name}</span>
                        <span className="mt-0.5 block text-xs text-[var(--muted)]">{persona.blurb}</span>
                      </button>
                    );
                  })}
                </div>
                <HiFiHint list={list} settings={state.settings} />
              </div>

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

/**
 * Whether the voice doing the talking is one of the good ones — and if not,
 * the one-minute fix, which is not ours.
 *
 * Everything in this app runs on the device, so the ceiling on how she sounds
 * is set by which engine the operating system has installed. The compact voices
 * that ship by default are the ones people mean when they say an assistant
 * sounds robotic, and no amount of rate and pitch work here gets close to
 * simply downloading the better one. Saying so plainly is worth more than
 * quietly compensating: this is the single largest improvement available and it
 * belongs to the person, not the app.
 *
 * Shown as a fact, not an error. A device with a compact voice is not broken.
 */
function HiFiHint({ list, settings }) {
  const current = activeVoice(settings);
  const better = list.filter((v) => isHiFi(v));
  // Apple's are downloads; Chrome's better voices arrive over the network and
  // are already in the list. The instruction has to match the platform or it is
  // just noise pointing at a menu that does not exist.
  const apple = /Mac|iPhone|iPad|iPod/.test(globalThis.navigator?.platform || "") ||
    /Mac|iPhone|iPad/.test(globalThis.navigator?.userAgent || "");

  if (isHiFi(current)) {
    return (
      <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
        Using <span className="font-medium text-[var(--ink)]">{current.name}</span> — one of the
        high-quality voices. This is as good as it gets without sending your words to a server,
        which this app does not do.
      </p>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--sunken)] px-4 py-3">
      <p className="text-xs font-medium">
        {better.length
          ? "There's a better voice installed than the one in use."
          : "This device is using its compact voice."}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">
        {better.length ? (
          <>
            Pick <span className="font-medium text-[var(--ink)]">{better[0].name}</span> below.
            The compact voices that ship with an operating system are the ones that sound
            synthetic; the downloaded ones are a different class entirely.
          </>
        ) : apple ? (
          <>
            The biggest improvement available is a free download, and it isn't ours:
            <span className="text-[var(--ink)]"> Settings → Accessibility → Spoken Content →
            Voices → English</span>, then take an <span className="text-[var(--ink)]">Enhanced</span> or
            <span className="text-[var(--ink)]"> Premium</span> voice — Daniel or Arthur for the
            butler. It takes about a minute and does more than anything this panel can.
          </>
        ) : (
          <>
            Chrome's higher-quality voices appear here once they've loaded — they are marked
            "online" in the list below. Everything else runs on the device.
          </>
        )}
      </p>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--faint)]">
        Until then she speaks a little flatter on purpose: a compact voice warbles when it is
        pitched down, so the character is eased off rather than allowed to make her harder to
        follow.
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
