/**
 * The thing that actually ships.
 *
 * Every other suite runs against the dev server, which is a different program:
 * unminified, unbundled, modules served one file at a time, `define`
 * substitutions and dynamic-import boundaries all behaving differently. A bug
 * that only exists in the production bundle is invisible to all of them and
 * visible to every user — and it is a category with real members: a `define`
 * that was never configured, a dynamic import that got hoisted into the eager
 * chunk, a dependency that only breaks when minified.
 *
 * Run with `npm run test:build`, which builds first. Needs `dist/` to exist.
 *
 * ## The weight guard
 *
 * The neural voice pulls in an ONNX runtime that Vite emits as a **21 MB**
 * WebAssembly asset, and `capacitor.config.json` copies all of `dist/` into
 * the iOS app — so this is app-download size, not just deploy size. It is
 * acceptable only for as long as it is never fetched by somebody who has not
 * turned the feature on. That property is one careless static import away from
 * being lost, and losing it would be silent: the app would still work, just
 * download twenty megabytes on launch to do it. So it is asserted.
 */
import { spawn } from "node:child_process";
import { existsSync, statSync, readdirSync } from "node:fs";
import { chromium } from "playwright";

const out = [];
const t = (name, ok, detail) => {
  out.push([name, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const dist = new URL("../dist/", import.meta.url);
if (!existsSync(dist)) {
  console.error("No dist/ — run `npm run build` first, or use `npm run test:build`.");
  process.exit(1);
}

const PORT = 4173;
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  cwd: new URL("..", import.meta.url).pathname,
  stdio: "ignore",
});
const stop = () => { try { server.kill("SIGTERM"); } catch { /* already gone */ } };
process.on("exit", stop);

// The preview server takes a moment; polling beats a fixed sleep that is either
// flaky or slow.
let up = false;
for (let i = 0; i < 40 && !up; i++) {
  await new Promise((r) => setTimeout(r, 250));
  up = await fetch(`http://localhost:${PORT}/`).then((r) => r.ok).catch(() => false);
}
if (!up) { console.error("preview server never came up"); stop(); process.exit(1); }

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: "America/New_York" });
const errs = [];
const got = [];
p.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
p.on("console", (m) => m.type() === "error" && errs.push(`console: ${m.text()}`));
p.on("response", (r) => got.push({ url: r.url(), type: r.request().resourceType() }));

await p.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
await p.waitForTimeout(600);

/* ------------------------------------------------------------- it runs at all */
t("the built app boots", await p.getByText("How should I address you?").isVisible());

await p.getByRole("button", { name: "Mr." }).click();
await p.getByPlaceholder("Surname").fill("Newman");
await p.getByRole("button", { name: "Continue" }).click();
await p.getByRole("button", { name: "Continue" }).click();
await p.getByRole("button", { name: "Skip for now" }).click();
const notNow = p.getByRole("button", { name: /^Not now/ });
if (await notNow.count()) await notNow.click();
await p.waitForTimeout(700);
t("and onboarding completes on the real bundle",
  /Today/.test(await p.locator("h1").first().innerText()), await p.locator("h1").first().innerText());

/* ------------------------------------------------- things only the build can break */
/**
 * `__APP_VERSION__` is a Vite `define`, substituted at build time. It exists
 * only in the built output, so the dev-server suites cannot tell whether it was
 * ever configured — the fallback would quietly render an em dash forever.
 */
await p.keyboard.press("Control+Comma");
await p.waitForTimeout(500);
await p.getByRole("button", { name: "Data", exact: true }).click();
await p.waitForTimeout(600);
const data = await p.locator("body").innerText();
const version = (data.match(/Version\s*\n?\s*([\d.]+)/) || [])[1];
t("the version is substituted at build time, not left as a fallback",
  Boolean(version) && /^\d+\.\d+\.\d+$/.test(version), version ?? "missing");

await p.keyboard.press("Control+1");
await p.waitForTimeout(400);
await p.keyboard.press("Control+k");
await p.waitForTimeout(400);
t("the keyboard layer survives minification",
  await p.getByPlaceholder(/Search|Find/i).first().isVisible());
await p.keyboard.press("Escape");
await p.waitForTimeout(250);
await p.keyboard.press("?");
await p.waitForTimeout(400);
t("and so does the sheet that documents it",
  /In the calendar/.test(await p.locator('[role="dialog"]').innerText()));
await p.keyboard.press("Escape");

/* --------------------------------------------------------------- the weight */
{
  const heavy = got.filter((r) => /\.wasm$|kokoro|onnxruntime|huggingface/i.test(r.url));
  /**
   * The one that matters. Twenty-one megabytes sitting in the app bundle is a
   * cost paid once at install; twenty-one megabytes fetched on launch is a cost
   * paid by everybody, every time, for a feature most will never enable.
   */
  t("nothing heavy is fetched by somebody who never asked for the neural voice",
    heavy.length === 0, heavy.map((r) => r.url.split("/").pop()));

  const scripts = got.filter((r) => r.type === "script");
  t("the eager JavaScript is a handful of files, not the whole app",
    scripts.length <= 4, scripts.map((r) => r.url.split("/").pop()));

  // Measured from disk rather than over the wire: `vite preview` does not gzip,
  // so response sizes here would libel the real payload.
  const assets = readdirSync(new URL("assets/", dist));
  const wasm = assets.filter((f) => f.endsWith(".wasm"));
  const eager = scripts
    .map((r) => r.url.split("/").pop())
    .filter((f) => assets.includes(f))
    .reduce((n, f) => n + statSync(new URL(`assets/${f}`, dist)).size, 0);

  t("the eager bundle stays under a megabyte unminified-gzip-free",
    eager < 1_100_000, `${Math.round(eager / 1024)} kB`);
  /**
   * Not a failure — the asset is legitimately part of an optional feature. It
   * is printed because it is the single largest thing in the deploy and in the
   * iOS app, and a number nobody prints is a number nobody notices growing.
   */
  for (const f of wasm) {
    console.log(`      note: ${f} is ${Math.round(statSync(new URL(`assets/${f}`, dist)).size / 1024 / 1024)} MB, ` +
      "shipped in dist/ and therefore inside the iOS app — lazy at runtime, but paid for at install.");
  }
}

t("no page errors in the built app", errs.length === 0, errs.join(" · "));

await b.close();
stop();
const failed = out.filter(([, ok]) => !ok);
console.log(`\nProduction build: ${out.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
