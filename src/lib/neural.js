/**
 * The optional neural voice.
 *
 * Every other voice in this app belongs to the operating system: free,
 * instant, and capped in quality by whatever engine the device happens to
 * ship. This is the way past that cap without a subscription — an 82-million
 * parameter text-to-speech model that runs *in the browser*, downloaded once
 * and then cached forever.
 *
 * The three constraints it exists to satisfy, all at once:
 *
 *   No per-use cost   The model runs on the device. There is no API, no key,
 *                     and no bill that grows with how much somebody talks to
 *                     her. That is the whole reason it is this and not one of
 *                     the hosted services, which are better and charge per
 *                     character forever.
 *   Offline           After the first download it never needs the network
 *                     again. The browser cache holds the weights.
 *   Actually good     A different class of voice from a compact system one.
 *
 * What it costs instead is a download and some CPU, which is why none of this
 * is loaded, fetched, or even parsed until somebody asks for it. The import is
 * dynamic so the model library stays out of the main bundle entirely: an app
 * that opens in two seconds must not become one that opens in twelve for a
 * feature most people will never turn on.
 *
 * ## Latency, and why this streams
 *
 * A system voice speaks instantly because the audio already exists. This has to
 * *generate* the audio first, at roughly real time on an ordinary processor —
 * so a five-second answer would sit in silence for five seconds before a word
 * of it came out. Generating sentence by sentence and playing each as it
 * arrives cuts the wait to the first sentence only. It is the difference
 * between a pause and a hang.
 */

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

/**
 * Quantised weights rather than full precision.
 *
 * `q8` is about a quarter the size of `fp32` for a difference most people
 * cannot hear, and on a phone the download is the thing somebody actually
 * feels. WebGPU with `fp32` would generate faster, but it costs a much larger
 * download to buy speed on a feature whose first impression is the wait for
 * the file — so the cheap-to-fetch version is the right default and the
 * hardware path can come later.
 */
const DTYPE = "q8";
const DEVICE = "wasm";

/**
 * A short list rather than all fifty-four.
 *
 * The model ships voices across eight languages and several grades. Offering
 * every one of them turns a setting into a catalogue; these are the American
 * English ones worth putting a name to, best first.
 */
export const NEURAL_VOICES = [
  { id: "af_heart", name: "Heart", note: "Warm and level. The best of them." },
  { id: "af_bella", name: "Bella", note: "Brighter, a touch quicker." },
  { id: "af_nicole", name: "Nicole", note: "Softer, closer to the microphone." },
  { id: "af_kore", name: "Kore", note: "Cooler and more clipped." },
  { id: "am_michael", name: "Michael", note: "Male, even." },
  { id: "am_fenrir", name: "Fenrir", note: "Male, deeper." },
];

export const DEFAULT_NEURAL_VOICE = "af_heart";

/* --------------------------------------------------------------- the engine */

let engine = null;
let loading = null;
let state = "idle"; // idle | loading | ready | failed
let progress = 0;
let failure = null;
const watchers = new Set();

const announce = () => { for (const fn of watchers) fn(neuralStatus()); };

/** Subscribe to load progress. Returns an unsubscribe. */
export function onNeuralChange(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

export const neuralStatus = () => ({ state, progress, error: failure });
export const neuralReady = () => state === "ready";

/**
 * Can this browser run it at all?
 *
 * WebAssembly and Web Audio are both required, and both are old enough that
 * anything without them cannot run the rest of this app either — but a
 * download this size is not something to start on a guess.
 */
export const neuralSupported = () =>
  typeof WebAssembly === "object" &&
  typeof globalThis.AudioContext !== "undefined" &&
  typeof globalThis.caches !== "undefined";

/**
 * Fetch and start the model. Safe to call twice: the second caller waits on
 * the first rather than starting a second download.
 */
export async function loadNeural() {
  if (state === "ready") return true;
  if (loading) return loading;

  state = "loading";
  progress = 0;
  failure = null;
  announce();

  loading = (async () => {
    try {
      // Dynamic, and the only reason this file is cheap to import. Vite splits
      // the model library into its own chunk on the strength of this line.
      const { KokoroTTS } = await import("kokoro-js");
      engine = await KokoroTTS.from_pretrained(MODEL, {
        dtype: DTYPE,
        device: DEVICE,
        progress_callback: (p) => {
          // Several files arrive; the weights dwarf the rest, so their
          // progress is near enough the whole story to show as it.
          if (p?.status === "progress" && typeof p.progress === "number") {
            progress = Math.max(progress, Math.round(p.progress));
            announce();
          }
        },
      });
      state = "ready";
      progress = 100;
      announce();
      return true;
    } catch (e) {
      // A failed download must leave the app exactly as it was. The device
      // voice is still there and still works, which is why this is a warning
      // rather than an error anybody has to act on.
      engine = null;
      state = "failed";
      failure = e?.message || "The voice could not be downloaded.";
      announce();
      return false;
    } finally {
      loading = null;
    }
  })();

  return loading;
}

/* -------------------------------------------------------------- the speaking */

let audio = null;
let scheduled = [];
let generation = 0;

const context = () => {
  if (!audio) audio = new AudioContext();
  // Browsers suspend a context created outside a gesture. Speaking always
  // follows one, so this is a formality — but a suspended context plays
  // nothing and reports no error, which is the worst way to fail.
  if (audio.state === "suspended") audio.resume().catch(() => {});
  return audio;
};

/** Stop immediately and drop anything queued behind it. */
export function stopNeural() {
  generation++;
  for (const node of scheduled) {
    try { node.onended = null; node.stop(); } catch { /* already finished */ }
  }
  scheduled = [];
}

/**
 * Say something with the neural voice.
 *
 * Returns false if it could not — the caller is expected to fall back to the
 * device voice rather than leave somebody in silence.
 *
 * @returns {Promise<boolean>} whether it spoke
 */
export async function speakNeural(text, { voice = DEFAULT_NEURAL_VOICE, speed = 1, onStart, onEnd } = {}) {
  if (!engine || !text) return false;

  stopNeural();
  const gen = generation;
  const ctx = context();

  let settled = false;
  const finish = () => {
    if (settled || gen !== generation) return;
    settled = true;
    onEnd?.();
  };

  try {
    // Each sentence is played the moment it exists, scheduled to start exactly
    // where the previous one ended so the seams are inaudible. Without the
    // running clock they would each start "now" and overlap.
    let at = 0;
    let started = false;
    let last = null;

    for await (const chunk of engine.stream(text, { voice, speed })) {
      if (gen !== generation) return true; // interrupted; nothing more to play

      const raw = chunk?.audio;
      if (!raw?.audio?.length) continue;

      const buffer = ctx.createBuffer(1, raw.audio.length, raw.sampling_rate);
      buffer.copyToChannel(raw.audio, 0);
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(ctx.destination);

      at = Math.max(at, ctx.currentTime + 0.02);
      node.start(at);
      at += buffer.duration;

      scheduled.push(node);
      last = node;
      if (!started) { started = true; onStart?.(); }
    }

    if (!started) return false;
    // Only the final chunk reports the end, and only if nothing has cancelled
    // it in the meantime.
    last.onended = finish;
    return true;
  } catch {
    stopNeural();
    return false;
  }
}
