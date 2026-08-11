/**
 * Make sure there is something on :5173 before the browser suites run.
 *
 * Every end-to-end file here assumes a dev server and none of them start one,
 * which is fine until the server is not there — and then the failure is not
 * "no server", it is nine suites reporting assertion failures about missing
 * buttons. Worse is the half-dead case: a server left running across a large
 * edit serves some modules from a stale graph, and the app boots, renders, and
 * quietly disagrees with itself. That produced a run where the screen showed a
 * meeting and the store read empty, which looks exactly like a real bug and
 * costs an hour before anybody thinks to check the server.
 *
 * So this is run once before the suites: reuse a healthy server, replace a sick
 * one, start one if there is none.
 */
import { spawn } from "node:child_process";

const PORT = 5173;
const ROOT = new URL("..", import.meta.url).pathname;

const reachable = () =>
  fetch(`http://localhost:${PORT}/`, { signal: AbortSignal.timeout(2000) })
    .then((r) => r.ok)
    .catch(() => false);

/**
 * Healthy means it can still compile the app, not merely answer.
 *
 * A stale dev server keeps serving `index.html` long after its module graph has
 * gone bad, so a plain reachability check is the one thing that cannot tell the
 * dangerous case from the good one. Asking it for a module the suites depend on
 * is what actually distinguishes them.
 */
const healthy = async () => {
  if (!(await reachable())) return false;
  try {
    const res = await fetch(`http://localhost:${PORT}/src/lib/store.js`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return false;
    const body = await res.text();
    return body.includes("export") && !body.includes("Internal server error");
  } catch {
    return false;
  }
};

if (await healthy()) {
  console.log(`dev server already up on :${PORT}`);
  process.exit(0);
}

if (await reachable()) {
  console.error(
    `Something is answering on :${PORT} but cannot serve the app — a stale dev server.\n` +
    "Stop it and run this again; leaving it up produces assertion failures that look like real bugs.",
  );
  process.exit(1);
}

console.log(`starting dev server on :${PORT}…`);
// Detached and unreferenced so it outlives this process — the npm script chain
// moves straight on to the suites, which need the server still running.
const server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  cwd: ROOT,
  detached: true,
  stdio: "ignore",
});
server.unref();

for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 500));
  if (await healthy()) {
    console.log(`dev server ready on :${PORT}`);
    process.exit(0);
  }
}

console.error("dev server did not come up within 30s");
process.exit(1);
