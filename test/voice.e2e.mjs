/**
 * The voice loop, driven end to end.
 *
 * Headless Chromium has no speech engines, so both are stubbed with the same
 * contract the real ones expose — and stubbed with `defineProperty`, because
 * `speechSynthesis` is a read-only accessor on `window` and plain assignment
 * silently leaves the vendor implementation in place, which is exactly the
 * false negative this file exists to avoid.
 *
 * What is being tested is the wiring rather than the vendor: that a dictated
 * sentence reaches the parser in a shape it understands, that the reply is
 * spoken once rather than twice, and that hands-free reopens the microphone
 * only where the turn is genuinely unfinished. Needs the dev server on :5173.
 */
import { chromium } from "playwright";
const b = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  // A speech-recognition stub needs the page to believe the API exists; the
  // permission grant keeps the real one from prompting where it is present.
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const p = await b.newPage({ viewport: { width: 900, height: 820 }, deviceScaleFactor: 2, timezoneId: "America/New_York" });
const errs = []; p.on("pageerror", (e) => errs.push(e.message));

// Headless Chromium has no speech engines. Stub both with the same contract the
// real ones expose, so the wiring — not the vendor implementation — is tested.
await p.addInitScript(() => {
  window.__spoken = [];
  class Utt {
    constructor(t) { this.text = t; }
  }
  // Both are read-only accessors on window in a real Chromium, so plain
  // assignment silently leaves the vendor implementation in place.
  Object.defineProperty(window, "SpeechSynthesisUtterance", { value: Utt, configurable: true });
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      speaking: false, pending: false,
      getVoices: () => [{ name: "Test Voice", lang: "en-US", voiceURI: "test", localService: true }],
      addEventListener() {}, removeEventListener() {},
      speak(u) { window.__spoken.push(u.text); setTimeout(() => u.onend?.(), 30); },
      cancel() {},
    },
  });
  class Rec {
    constructor() { this.interimResults = true; window.__rec = this; }
    start() { window.__recStarted = (window.__recStarted || 0) + 1; }
    stop() { this.onend?.(); }
    abort() { this.onend?.(); }
    say(text) {
      this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] });
    }
  }
  Object.defineProperty(window, "SpeechRecognition", { value: Rec, configurable: true });
  Object.defineProperty(window, "webkitSpeechRecognition", { value: Rec, configurable: true });
});

await p.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await p.evaluate(async () => {
  const s = await import("/src/lib/store.js");
  s.resetAll();
  s.setSetting("identity", { style: "formal", honorific: "Mr.", lastName: "Newman" });
  s.setSetting("confirm", false);
  s.setSetting("voice", { speak: true, handsFree: true, rate: 1 });
});
await p.reload({ waitUntil: "networkidle" });
// The assistant is reached from the floating button now, not a tab.
await p.getByRole("button", { name: "Ask Squirrel" }).click();
await p.waitForTimeout(400);

// 1. The microphone opens.
await p.getByRole("button", { name: "Speak" }).click();
await p.waitForTimeout(200);
const out = [];
const t = (name, ok, detail) => { out.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`); };

t("the microphone opens", await p.evaluate(() => window.__recStarted === 1));

// 2. A dictated command runs.
await p.evaluate(() => window.__rec.say("put a meeting with ronnie at three thirty p m tomorrow"));
await p.waitForTimeout(1600);
const ev = await p.evaluate(async () => (await import("/src/lib/store.js")).getState().events[0]);
t("a dictated command books the meeting", ev?.title === "Meeting with Ronnie", ev?.title);
t("at the hour that was spoken", ev?.start.endsWith("T15:30:00"), ev?.start);

// 3. She read the reply back.
const spoken = await p.evaluate(() => window.__spoken);
t("and she reads the reply back", spoken.length === 1, JSON.stringify(spoken));
t("once, not as a receipt and then an answer",
  spoken[0] && !/Added .*\. Booked/.test(spoken[0]), spoken[0]);
t("with the duration said as words", spoken[0]?.includes("1 hour"), spoken[0]);

// 4. Hands-free reopens the mic only when she asks something.
const before = await p.evaluate(() => window.__recStarted);
await p.evaluate(async () => (await import("/src/lib/store.js")).setSetting("confirm", true));
await p.waitForTimeout(200);
await p.getByRole("textbox").fill("clear my calendar");
await p.getByRole("textbox").press("Enter");
await p.waitForTimeout(1800);
t("hands-free reopens the mic when she asks something",
  await p.evaluate((b) => window.__recStarted > b, before));

t("no page errors", errs.length === 0, errs.join(" · "));

await b.close();
const failed = out.filter(([, ok]) => !ok);
console.log(`\nVoice: ${out.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
