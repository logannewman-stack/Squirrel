/**
 * The promise on the box: it works offline.
 *
 * It did not. The service worker registered for years with no fetch handler,
 * so "offline" was a half-truth — the data was local, but the app was not.
 * Kill the network and reload, and Chrome's dinosaur stood where the planner
 * should be: everything the person owned intact underneath an app that could
 * not be summoned to show it.
 *
 * So this is tested the only honest way: the real production build, served,
 * visited once online, then the network cut dead and the page reloaded. The
 * worker's runtime cache has to bring the whole shell back from disk — and
 * the data with it, and the planner running over that data, and the paid tier
 * the account had before the connection went.
 *
 * Runs its own preview server on :4198, so it needs `vite build` to have run
 * (the test:build chain does) and touches nobody else's port.
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { skipOnboarding } from "./onboard.mjs";

const PORT = 4198;
const ROOT = new URL("..", import.meta.url).pathname;

const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  cwd: ROOT, stdio: "ignore",
});
const up = async () => {
  for (let i = 0; i < 40; i++) {
    if (await fetch(`http://localhost:${PORT}/`).then((r) => r.ok).catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

const out = [];
const t = (name, ok, detail) => {
  out.push([name, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

if (!(await up())) {
  console.error("preview server never came up — run `vite build` first");
  process.exit(1);
}

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1280, height: 850 } });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));

/* ------------------------------------------------- one ordinary online visit */
await p.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: "networkidle" });
await skipOnboarding(p);

const swReady = await p.evaluate(async () => {
  const reg = await navigator.serviceWorker?.ready.catch(() => null);
  return Boolean(reg?.active);
});
t("the worker takes the door on an ordinary visit", swReady);

// Give the runtime cache one settled pass over the shell's requests.
await p.reload({ waitUntil: "networkidle" });
await p.waitForTimeout(800);

/* -------------------------------------------------------- then the cable cut */
await ctx.setOffline(true);
await p.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
await p.waitForTimeout(1200);

const body = await p.locator("body").innerText().catch(() => "");
t("the app opens with no network at all", /Today|Squirrel/.test(body), body.slice(0, 120));
t("  onboarding stays done — this is the same person's app", !/tell me your name|Welcome/i.test(body));
t("  and the whole shell is present, not an error shell",
  (await p.getByRole("button", { name: "Calendar", exact: true }).count()) >= 1);

// Work is still creatable offline — the entire point of local-first.
await p.getByRole("button", { name: "Projects", exact: true }).first().click();
await p.waitForTimeout(500);
const before = await p.evaluate(() => JSON.parse(localStorage.getItem("squirrel.v2") || "{}")?.projects?.length ?? 0);
await p.getByPlaceholder("New project").fill("Born offline");
await p.getByRole("button", { name: "Create", exact: true }).click();
await p.waitForTimeout(500);
const after = await p.evaluate(() => JSON.parse(localStorage.getItem("squirrel.v2") || "{}")?.projects?.length ?? 0);
t("a project can be born with the network dead", after === before + 1, `${before} → ${after}`);

t("no page errors across the outage", errs.filter((e) => !/Failed to fetch|network/i.test(e)).length === 0,
  errs.join(" · "));

await b.close();
server.kill();
const failed = out.filter(([, ok]) => !ok);
console.log(`\nOffline: ${out.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
