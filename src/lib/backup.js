/**
 * Taking your data with you.
 *
 * The other half of deletion. Apple asks for a way out of an account and the
 * GDPR asks for a copy of what is held, and those are usually treated as two
 * checklist items — but for an app whose whole premise is that your week lives
 * on your own device, a copy you can actually hold is closer to the point than
 * either regulation is.
 *
 * It is also the answer to the one honest objection to local-first: *what
 * happens when I get a new phone?* Without an account there is no server to
 * pull from, so without this the answer is "you retype it". A file fixes that
 * without a backend, without a subscription, and without asking anyone to trust
 * us with anything.
 *
 * ## What is in the file, and what is not
 *
 * Everything a person made: projects, tasks, meetings, focus sessions, the
 * conversation, and their settings. Nothing the app derives or bookkeeps —
 * the schedule recomputes itself from the data, and shipping sync flags and
 * tombstones inside a document called "your data" is noise at best.
 *
 * Two omissions are deliberate rather than tidiness:
 *
 * **The plan.** A restore must not be a way to grant yourself a paid tier by
 * editing a file. The tier is a server fact and stays one; the local copy is a
 * cache that the next check corrects.
 *
 * **The running timer.** A focus session that was live when the file was
 * written is not live when it is read, possibly weeks later on another device.
 * Restoring it would start a clock nobody set.
 */

/**
 * The shape version.
 *
 * Written into every file so a future format can read an old one, and so a
 * file from a *newer* version is refused with an explanation rather than
 * half-imported into a build that does not understand it.
 */
export const FORMAT = 1;

/** Collections a person authored, in the order they read best in the file. */
const KEPT = ["projects", "tasks", "events", "sessions", "chat"];

/** Bookkeeping stripped on the way out and re-stamped on the way in. */
const INTERNAL = ["dirty", "updatedAt"];

const clean = (row) => {
  const out = { ...row };
  for (const k of INTERNAL) delete out[k];
  return out;
};

/**
 * Everything worth keeping, as a plain object.
 *
 * @param {object} state
 * @param {number} now
 */
export function exportOf(state = {}, now = Date.now()) {
  const rows = Object.fromEntries(
    KEPT.map((k) => [k, (Array.isArray(state[k]) ? state[k] : []).map(clean)]),
  );
  return {
    app: "squirrel",
    format: FORMAT,
    exportedAt: new Date(now).toISOString(),
    // A header a person can read before deciding whether this is the right
    // file — the commonest thing anybody does with a backup is squint at two
    // of them and try to work out which is the newer one.
    counts: Object.fromEntries(KEPT.map((k) => [k, rows[k].length])),
    settings: { ...(state.settings || {}) },
    ...rows,
  };
}

/** What the file is called. Dated, because there will be more than one. */
export const fileName = (now = Date.now()) =>
  `squirrel-${new Date(now).toISOString().slice(0, 10)}.json`;

/**
 * Read a file back, refusing anything that is not one of ours.
 *
 * Everything here is a guard against a person picking the wrong file, which is
 * the realistic failure — not an attack. So each refusal says which thing went
 * wrong, because "invalid file" sends somebody hunting through a folder with
 * no idea what they are looking for.
 *
 * @returns {{ok: true, data: object} | {ok: false, error: string}}
 */
export function readBackup(text) {
  let data;
  try {
    data = JSON.parse(String(text));
  } catch {
    return { ok: false, error: "That isn't a Squirrel backup — it isn't even a JSON file." };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: "That file doesn't have anything in it we recognise." };
  }
  if (data.app !== "squirrel") {
    return { ok: false, error: "That's a JSON file, but it didn't come from Squirrel." };
  }
  if (!Number.isFinite(data.format) || data.format > FORMAT) {
    return {
      ok: false,
      error: "That backup was made by a newer version of Squirrel than this one. Update, then try again.",
    };
  }
  // A file that parses but holds nothing is almost always the wrong file, and
  // restoring it would quietly erase everything — the worst possible outcome
  // of a mis-click, so it is refused rather than obeyed.
  const rows = Object.fromEntries(KEPT.map((k) => [k, Array.isArray(data[k]) ? data[k] : []]));
  const total = KEPT.reduce((n, k) => n + rows[k].length, 0);
  if (total === 0) return { ok: false, error: "That backup is empty — there'd be nothing to restore." };

  return {
    ok: true,
    data: { ...rows, settings: data.settings && typeof data.settings === "object" ? data.settings : {} },
  };
}

/** "12 projects, 48 tasks and 31 meetings" — said before anything is replaced. */
export function summarize(data = {}) {
  const NAMES = {
    projects: ["project", "projects"],
    tasks: ["task", "tasks"],
    events: ["meeting", "meetings"],
    sessions: ["focus session", "focus sessions"],
  };
  const parts = Object.entries(NAMES)
    .map(([k, [one, many]]) => {
      const n = (data[k] || []).length;
      return n ? `${n} ${n === 1 ? one : many}` : null;
    })
    .filter(Boolean);
  if (!parts.length) return "nothing";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Hand the file to the person.
 *
 * A blob and an anchor, which is the one download mechanism that works the
 * same in a browser tab, in a Mac app and in an iOS web view. Revoked on a
 * timer rather than immediately: Safari has not finished reading the URL when
 * the click returns, and revoking synchronously produces an empty file.
 */
export function download(text, name, doc = globalThis.document) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = doc.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return url;
}
