import { useEffect, useState } from "react";
import {
  NEURAL_VOICES, DEFAULT_NEURAL_VOICE, loadNeural, neuralStatus, neuralReady,
  neuralSupported, onNeuralChange, speakNeural, stopNeural,
} from "../lib/neural";
import { can } from "../lib/plans";
import { Button } from "./ui";

/**
 * The downloaded voice.
 *
 * Every other voice in this app is the operating system's — free, instant, and
 * only ever as good as whatever engine that device happens to ship. This is the
 * way past that ceiling that does not involve a subscription: a real
 * text-to-speech model, fetched once, cached, and run here. No key, no
 * per-message cost, and nothing sent anywhere afterwards.
 *
 * Presented as a download rather than a switch, because that is honestly what
 * it is. Eighty-odd megabytes and a slower first word are a real trade against
 * a voice that sounds like a person, and somebody deciding that deserves both
 * halves of it up front rather than a spinner and a surprise.
 *
 * On Pro only — not to hold it hostage, but because it is the one thing here
 * with a genuine cost attached, and that cost is bandwidth we serve. The device
 * voice stays fully capable on every plan, which is why the free tier can go on
 * being a working app rather than a demonstration.
 */
export default function NeuralVoice({ state, voice, onChange, onUpgrade }) {
  const [status, setStatus] = useState(neuralStatus());
  const [previewing, setPreviewing] = useState(null);

  useEffect(() => onNeuralChange(setStatus), []);
  useEffect(() => () => stopNeural(), []);

  const entitled = can(state.plan, "assistant");
  const on = Boolean(voice);

  if (!neuralSupported()) {
    return (
      <p className="text-xs leading-relaxed text-[var(--muted)]">
        This browser can't run the downloaded voice — it needs WebAssembly and Web Audio.
        The device voices above work everywhere.
      </p>
    );
  }

  async function download(id) {
    const ok = await loadNeural();
    if (ok) {
      onChange(id);
      speakNeural("Booked an hour with Priya, tomorrow at 2 PM. That leaves you three clear hours.", { voice: id });
    }
  }

  function preview(id) {
    setPreviewing(id);
    speakNeural("Booked an hour with Priya, tomorrow at 2 PM.", {
      voice: id,
      onEnd: () => setPreviewing(null),
    });
  }

  /* ------------------------------------------------------------- locked */
  if (!entitled) {
    return (
      <div className="rounded-lg border border-[var(--line)] px-4 py-3">
        <p className="text-sm font-medium">A voice that sounds like a person</p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
          Pro can download a real speech model — a different class of voice from the one
          your operating system ships. It runs on your device afterwards, so it still costs
          nothing per message and still works with no signal.
        </p>
        <Button variant="primary" size="sm" className="mt-3"
          onClick={() => onUpgrade?.("A better voice is on Pro")}>
          Upgrade
        </Button>
      </div>
    );
  }

  /* ---------------------------------------------------------- downloading */
  if (status.state === "loading") {
    return (
      <div className="rounded-lg border border-[var(--line)] px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium">Downloading the voice…</span>
          <span className="num text-xs text-[var(--muted)]">{status.progress}%</span>
        </div>
        <span className="mt-2 block h-1 w-full overflow-hidden rounded-full bg-[var(--hairline)]">
          <span className="block h-full rounded-full bg-[var(--ink)] transition-[width] duration-300"
            style={{ width: `${status.progress}%` }} />
        </span>
        <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
          Once. It's kept on this device afterwards and never fetched again — you can carry
          on using the app while it finishes.
        </p>
      </div>
    );
  }

  /* -------------------------------------------------------------- ready */
  if (neuralReady() || on) {
    return (
      <div>
        <p className="mb-2 text-xs leading-relaxed text-[var(--muted)]">
          {on
            ? "She's using the downloaded voice. It takes a moment longer to start speaking than the device one, because the sound is being made rather than played."
            : "Downloaded and ready. Pick one to switch to it."}
        </p>
        <ul className="flex flex-col gap-1.5">
          {NEURAL_VOICES.map((v) => {
            const chosen = voice === v.id;
            return (
              <li key={v.id}>
                <button
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => { onChange(v.id); preview(v.id); }}
                  className={`flex w-full items-center gap-3 rounded-lg border px-4 py-2.5 text-left
                              transition-colors ${
                                chosen ? "border-[var(--ink)] bg-[var(--hover)]" : "border-[var(--line)] hover:border-[var(--ink)]"
                              }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{v.name}</span>
                    <span className="block text-xs text-[var(--muted)]">{v.note}</span>
                  </span>
                  {previewing === v.id && (
                    <span className="shrink-0 text-[11px] text-[var(--muted)]">speaking…</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {on && (
          <button
            type="button"
            onClick={() => { stopNeural(); onChange(null); }}
            className="mt-3 text-xs text-[var(--muted)] underline-offset-4 hover:text-[var(--ink)] hover:underline"
          >
            Go back to the device voice
          </button>
        )}
      </div>
    );
  }

  /* ------------------------------------------------------------- offered */
  return (
    <div className="rounded-lg border border-[var(--line)] px-4 py-3">
      <p className="text-sm font-medium">A voice that sounds like a person</p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
        A real speech model, downloaded once — about 90 MB — and then kept on this device.
        No key, nothing sent anywhere, no cost per message, and it works with no signal
        afterwards. It takes a beat longer to start speaking than the system voice, because
        the sound is being made rather than played back.
      </p>
      {status.state === "failed" && (
        <p className="mt-2 text-xs text-[var(--alert)]">
          {status.error} The device voice is still working — nothing has changed.
        </p>
      )}
      <Button variant="primary" size="sm" className="mt-3" onClick={() => download(DEFAULT_NEURAL_VOICE)}>
        {status.state === "failed" ? "Try again" : "Download the voice"}
      </Button>
    </div>
  );
}
