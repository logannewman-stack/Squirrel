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
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const PORT = 5173;
const ROOT = new URL("..", import.meta.url).pathname;

/** Every source module, newest edit first. */
function sources(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (/\.jsx?$/.test(entry.name)) out.push({ full, mtime: statSync(full).mtimeMs });
  }
  return out;
}

/**
 * Words long enough that finding them is proof the server has this version.
 *
 * Comments are stripped first: esbuild's JSX transform drops them, so a token
 * taken from a comment would be reported missing on a perfectly fresh server
 * and this check would cry wolf on every run. Identifiers and string literals
 * survive the dev transform intact, which is what makes them usable as
 * fingerprints.
 */
const fingerprints = (src) => [
  ...new Set(
    src
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ")
      .match(/[A-Za-z_$][A-Za-z0-9_$]{13,}/g) || [],
  ),
].slice(0, 4);

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
    if (!body.includes("export") || body.includes("Internal server error")) return false;
  } catch {
    return false;
  }
  return (await stale()) === null;
};

/**
 * Is the server serving the code that is on disk *right now*?
 *
 * This is the case the old check could not see, and the expensive one. A
 * server left running across an edit keeps compiling and keeps answering — so
 * "can it serve a module" says yes — while handing out the previous version of
 * whatever changed. The app boots, renders, and disagrees with the source in
 * front of you. That has produced, more than once, an afternoon spent
 * debugging a component that was already correct: the store held three
 * projects and the grid rendered "No projects yet", which reads exactly like a
 * real rendering bug.
 *
 * So the recently-edited files are checked against what the server returns for
 * them. Recent ones only — asking for all of them would be slow and would tell
 * us nothing, since a file nobody has touched cannot have gone stale.
 *
 * @returns the offending path, or null if everything matches.
 */
async function stale() {
  const recent = sources(join(ROOT, "src"))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 6);

  for (const { full } of recent) {
    const url = `http://localhost:${PORT}/${relative(ROOT, full)}`;
    const marks = fingerprints(readFileSync(full, "utf8"));
    if (!marks.length) continue;
    let body;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return relative(ROOT, full);
      body = await res.text();
    } catch {
      return relative(ROOT, full);
    }
    /**
     * The status is not the signal here, which is worth saying out loud: Vite's
     * SPA fallback answers an unknown path with `index.html` and a cheerful
     * 200, so a module the server has never heard of arrives looking fine. The
     * fingerprints are what catch it — a page of HTML contains none of the
     * file's identifiers — and they catch an out-of-date transform by exactly
     * the same test.
     */
    if (!marks.every((m) => body.includes(m))) return relative(ROOT, full);
  }
  return null;
}

if (await healthy()) {
  console.log(`dev server already up on :${PORT}`);
  process.exit(0);
}

if (await reachable()) {
  const behind = await stale();
  console.error(
    behind
      ? `The dev server on :${PORT} is serving an old ${behind}.\n` +
        "Stop it and run this again — a stale server produces assertion failures that look\n" +
        "exactly like real bugs, in code that is already correct."
      : `Something is answering on :${PORT} but cannot serve the app — a stale dev server.\n` +
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
