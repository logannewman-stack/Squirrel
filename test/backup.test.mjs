/**
 * Taking your data out, and putting it back.
 *
 * Two failures matter here and they are not symmetrical. Exporting badly loses
 * something quietly — you find out months later, on the new phone, that the
 * file was missing half your projects. Importing badly is worse and faster: a
 * restore replaces everything, so a file that should have been refused erases
 * a year of work in one tap.
 *
 * Which is why most of this is about what `readBackup` says no to.
 */
import { exportOf, readBackup, summarize, fileName, download, FORMAT } from "../src/lib/backup.js";

let pass = 0, fail = 0;
const failures = [];
const t = (name, ok, detail) => {
  if (ok) pass++; else { fail++; failures.push(name); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const state = () => ({
  projects: [{ id: "p1", name: "Q3 launch", dirty: true, updatedAt: 111 }],
  tasks: [
    { id: "t1", title: "Board deck", projectId: "p1", done: false, dirty: true, updatedAt: 222 },
    { id: "t2", title: "Invoices", done: true },
  ],
  events: [{ id: "e1", title: "Call with Priya", start: "2026-08-13T15:00:00.000Z" }],
  sessions: [{ id: "s1", taskId: "t1", ms: 1500000 }],
  chat: [{ role: "user", text: "what's on today" }],
  settings: { hours: { start: 7, end: 18 }, identity: { first: "Logan" } },
  // Everything below is derived, bookkeeping, or a server fact. None of it
  // belongs in a file called "your data".
  blocks: [{ day: "2026-08-10", taskId: "t1" }],
  shortfalls: [{ taskId: "t1" }],
  tombstones: [{ kind: "tasks", id: "gone" }],
  active: { taskId: "t1", endsAt: 999 },
  plan: "pro",
  assists: { day: "2026-08-10", n: 4 },
});

const NOW = Date.UTC(2026, 7, 10, 12, 0, 0);

// ------------------------------------------------------------------ the file
{
  const f = exportOf(state(), NOW);
  t("it says what it is", f.app === "squirrel" && f.format === FORMAT, JSON.stringify([f.app, f.format]));
  t("and when it was made", f.exportedAt === "2026-08-10T12:00:00.000Z", f.exportedAt);

  t("the projects come with it", f.projects.length === 1 && f.projects[0].name === "Q3 launch");
  t("and the tasks", f.tasks.length === 2);
  t("and the meetings", f.events.length === 1);
  t("and the focus history", f.sessions.length === 1);
  t("and the conversation", f.chat.length === 1);
  t("and the settings", f.settings?.identity?.first === "Logan");

  t("a header says how much is in it, without opening it",
    f.counts.tasks === 2 && f.counts.projects === 1 && f.counts.events === 1, JSON.stringify(f.counts));

  // Sync flags are how this device talks to a server. They are not the user's
  // data and they mean nothing on the machine that reads the file.
  t("sync bookkeeping is stripped",
    !("dirty" in f.projects[0]) && !("updatedAt" in f.tasks[0]), JSON.stringify(f.projects[0]));

  // The derived plan recomputes itself; shipping it means shipping a stale one.
  t("the derived schedule is left out", f.blocks === undefined && f.shortfalls === undefined);
  t("so are deletion markers", f.tombstones === undefined);
  t("a running timer is not portable, so it does not travel", f.active === undefined);

  /**
   * The one with teeth. If the tier were in the file, upgrading would be a text
   * editor away — so it is a server fact and stays one.
   */
  t("the paid tier is not something a file can grant", f.plan === undefined);
  t("nor is the free-tier counter something a file can reset", f.assists === undefined);

  t("an empty account still exports a valid file",
    exportOf({}, NOW).app === "squirrel" && exportOf({}, NOW).tasks.length === 0);
  t("and one with nothing but junk in it does not throw",
    exportOf({ tasks: "not an array" }, NOW).tasks.length === 0);
}

// ------------------------------------------------------------------- naming
{
  t("the file is dated, because there will be more than one",
    fileName(NOW) === "squirrel-2026-08-10.json", fileName(NOW));
}

// ------------------------------------------------------------- reading back
{
  const f = exportOf(state(), NOW);
  const r = readBackup(JSON.stringify(f));
  t("a file we wrote reads back", r.ok === true, r.error);
  t("with everything in it", r.data.tasks.length === 2 && r.data.projects.length === 1);
  t("and the settings", r.data.settings?.hours?.start === 7);
  t("but not the header, which is for people rather than the app", r.data.counts === undefined);
}

// -------------------------------------------------------------- refusing it
/**
 * Each refusal names the actual problem. "Invalid file" sends somebody hunting
 * through a folder with no idea what they are looking for, and the realistic
 * cause of every one of these is picking the wrong file — not an attack.
 */
{
  const no = (text) => readBackup(text);

  t("a photo is not a backup", no("PNG\r\n").ok === false);
  t("and says so in words", /JSON/.test(no("nonsense").error), no("nonsense").error);

  t("somebody else's JSON is refused",
    no(JSON.stringify({ app: "notion", format: 1, tasks: [{ id: 1 }] })).ok === false);
  t("naming Squirrel, so it is clear which file was wanted",
    /Squirrel/.test(no(JSON.stringify({ app: "notion", tasks: [] })).error));

  t("a bare array is refused", no("[1,2,3]").ok === false);
  t("so is null", no("null").ok === false);

  const future = JSON.stringify({ app: "squirrel", format: FORMAT + 1, tasks: [{ id: "x" }] });
  t("a file from a newer version is refused rather than half-read", no(future).ok === false);
  t("and says to update", /[Uu]pdate/.test(no(future).error), no(future).error);
  t("a file with no version at all is refused too",
    no(JSON.stringify({ app: "squirrel", tasks: [{ id: "x" }] })).ok === false);

  /**
   * The expensive one. An empty file that restored successfully would erase
   * everything, and it would look like it had worked.
   */
  const empty = JSON.stringify({ app: "squirrel", format: 1, tasks: [], projects: [] });
  t("an empty backup is refused, because restoring it erases everything", no(empty).ok === false);
  t("saying that there would be nothing to restore", /nothing/.test(no(empty).error), no(empty).error);

  t("a backup with one task in it is not empty",
    no(JSON.stringify({ app: "squirrel", format: 1, tasks: [{ id: "x" }] })).ok === true);
  t("missing collections become empty ones rather than undefined",
    no(JSON.stringify({ app: "squirrel", format: 1, tasks: [{ id: "x" }] })).data.events.length === 0);
  t("settings that are not an object are dropped rather than trusted",
    no(JSON.stringify({ app: "squirrel", format: 1, tasks: [{ id: "x" }], settings: "no" }))
      .data.settings.hours === undefined);
}

// ------------------------------------------------------------------ telling
/**
 * The sentence shown before replacing anything. It is read under pressure by
 * somebody deciding whether this is the right file, so it has to be countable
 * at a glance rather than a table.
 */
{
  t("it counts what is there",
    summarize({ projects: [1], tasks: [1, 2], events: [1] }) === "1 project, 2 tasks and 1 meeting",
    summarize({ projects: [1], tasks: [1, 2], events: [1] }));
  t("singular where there is one of something",
    summarize({ tasks: [1] }) === "1 task", summarize({ tasks: [1] }));
  t("two things read as two things, not a list of two",
    summarize({ tasks: [1], events: [1, 2] }) === "1 task and 2 meetings");
  t("empty collections are not mentioned at all",
    summarize({ projects: [], tasks: [1] }) === "1 task", summarize({ projects: [], tasks: [1] }));
  t("nothing is said plainly", summarize({}) === "nothing");
  t("focus history is named in words a person uses",
    /focus session/.test(summarize({ sessions: [1] })), summarize({ sessions: [1] }));
}

// --------------------------------------------------------------- the saving
{
  const clicks = [];
  const revoked = [];
  const el = { click: () => clicks.push(el.download), remove: () => {}, setAttribute: () => {} };
  const doc = { createElement: () => el, body: { appendChild: () => {} } };
  const realURL = globalThis.URL.createObjectURL;
  const realRevoke = globalThis.URL.revokeObjectURL;
  globalThis.URL.createObjectURL = () => "blob:fake";
  globalThis.URL.revokeObjectURL = (u) => revoked.push(u);

  const url = download("{}", "squirrel-2026-08-10.json", doc);
  t("saving clicks a download", clicks.length === 1, clicks);
  t("with the dated name attached", clicks[0] === "squirrel-2026-08-10.json", clicks[0]);
  t("and hands back the URL it made", url === "blob:fake", url);
  /**
   * Not revoked synchronously: Safari has not finished reading the blob when
   * the click returns, and revoking immediately produces an empty file.
   */
  t("the blob outlives the click", revoked.length === 0, revoked);

  globalThis.URL.createObjectURL = realURL;
  globalThis.URL.revokeObjectURL = realRevoke;
}

console.log(`\nBackup: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
