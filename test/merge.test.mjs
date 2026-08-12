/**
 * Sync reconciliation.
 *
 * Every case here is two devices disagreeing. The stakes are that a meeting
 * survives or does not, so these run without a server, a login, or a network.
 */
import { pick, mergeCollection, decode, encode, toLocal, fromLocal } from "../src/lib/merge.js";

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const rec = (o) => ({ id: "a", updatedAt: 1000, deletedAt: null, ...o });

// ---------------------------------------------------------------- the rule
t("the later edit wins", pick(rec({ updatedAt: 1 }), rec({ updatedAt: 2 })) === "remote");
t("and it wins from either side", pick(rec({ updatedAt: 3 }), rec({ updatedAt: 2 })) === "local");
t("a tie keeps what is already on screen",
  pick(rec({ updatedAt: 5 }), rec({ updatedAt: 5 })) === "local");

// A delete has to beat a newer edit, or a meeting someone cancelled on their
// phone comes back because their laptop touched it afterwards.
t("a delete beats a later edit elsewhere",
  pick(rec({ updatedAt: 1, deletedAt: 2 }), rec({ updatedAt: 99 })) === "local");
t("in both directions",
  pick(rec({ updatedAt: 99 }), rec({ updatedAt: 1, deletedAt: 2 })) === "remote");

// -------------------------------------------------------------- collections
{
  const local = [rec({ id: "1", title: "Board", updatedAt: 100 })];
  const remote = [rec({ id: "1", title: "Board meeting", updatedAt: 200 })];
  const m = mergeCollection(local, remote);
  t("a newer remote replaces the local row", m.rows[0].title === "Board meeting", m.rows[0].title);
  t("and the change is reported", m.changed === true);
  t("with nothing to push back", m.push.length === 0, JSON.stringify(m.push));
}
{
  const local = [rec({ id: "1", title: "Mine", updatedAt: 500 })];
  const remote = [rec({ id: "1", title: "Theirs", updatedAt: 100 })];
  const m = mergeCollection(local, remote);
  t("a stale remote is refused", m.rows[0].title === "Mine", m.rows[0].title);
  t("and the server is told", m.push.length === 1 && m.push[0].title === "Mine");
  t("without claiming anything changed", m.changed === false);
}
{
  // The case that made tombstones necessary: a row the server deleted must not
  // be quietly re-added by this device on the next push.
  const local = [rec({ id: "1", title: "Cancelled", updatedAt: 100 })];
  const remote = [rec({ id: "1", title: "Cancelled", updatedAt: 200, deletedAt: 200 })];
  const m = mergeCollection(local, remote);
  t("a remote delete removes it here", m.rows.length === 0, JSON.stringify(m.rows));
  t("but is remembered as a tombstone", m.tombstones.length === 1);
  t("and is not pushed back", m.push.length === 0, JSON.stringify(m.push));
}
{
  const local = [rec({ id: "1", title: "Fresh", updatedAt: 100, dirty: true })];
  const m = mergeCollection(local, []);
  t("a row the server has never seen is pushed", m.push.length === 1);
  t("and stays on screen meanwhile", m.rows.length === 1);
}
{
  const local = [rec({ id: "1", updatedAt: 100 })];
  const m = mergeCollection(local, []);
  t("a clean row the server did not mention is left alone",
    m.push.length === 0 && m.changed === false);
}
{
  // Replaying the overlap window the server deliberately hands back must be a
  // no-op, or every sync would churn the UI.
  const local = [rec({ id: "1", title: "Same", updatedAt: 100 })];
  const remote = [rec({ id: "1", title: "Same", updatedAt: 100 })];
  const m = mergeCollection(local, remote);
  t("replaying the overlap changes nothing", m.changed === false && m.push.length === 0);
}

// -------------------------------------------------------------- wall clocks
{
  // A meeting is "2pm Thursday" wherever you are. Round-tripping it through
  // the server must not move it, which is the whole reason for converting at
  // this boundary rather than storing the instant everywhere.
  const local = "2026-08-06T14:00:00";
  t("a local time survives the round trip", toLocal(fromLocal(local)) === local,
    toLocal(fromLocal(local)));
}
{
  const rows = decode("events", [{
    id: "e1", project_id: null, title: "Board", starts_at: fromLocal("2026-08-06T14:00:00"),
    ends_at: fromLocal("2026-08-06T15:00:00"), location: "", attendees: [{ name: "Bob" }],
    notes: "", created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
    deleted_at: null,
  }]);
  t("a decoded event reads as wall clock", rows[0].start === "2026-08-06T14:00:00", rows[0].start);
  t("attendees survive decoding", rows[0].attendees[0].name === "Bob");
  const back = encode("events", rows);
  t("and encoding is the exact inverse",
    back[0].starts_at === fromLocal("2026-08-06T14:00:00"), back[0].starts_at);
  t("with the app's field names translated",
    "starts_at" in back[0] && !("start" in back[0]));
}
{
  const rows = decode("tasks", [{
    id: "t1", project_id: "p1", title: "Sign lease", notes: "", estimate_mins: 45,
    due: "2026-08-07", priority: "high", delegated_to: "Priya", done: false,
    done_at: null, scheduled_for: null, sort_order: 2,
    created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z", deleted_at: null,
  }]);
  t("snake_case becomes camelCase",
    rows[0].estimateMins === 45 && rows[0].delegatedTo === "Priya" && rows[0].order === 2,
    JSON.stringify(rows[0]));
  t("a date-only deadline stays a plain date", rows[0].due === "2026-08-07", rows[0].due);
}

/* ------------------------------------------------- nothing may be dropped */
/**
 * The quiet half of a sync bug.
 *
 * A field added to the local store and forgotten here does not throw, does
 * not warn, and works perfectly on the machine it was written on. It fails on
 * the *second* device, silently, as data that simply is not there — a branch
 * with no parent, a block that comes back unpinned, a weekly task that stops
 * coming back. That is exactly how sub-projects, pins and repeat first
 * shipped, so from here the round trip is asserted rather than assumed.
 *
 * These lists are the contract: adding a field to the store means adding it
 * in three places — the table, the mapping, and this line — and this is the
 * test that says so out loud.
 */
{
  const TASK_FIELDS = [
    "id", "projectId", "title", "notes", "estimateMins", "due", "priority",
    "delegatedTo", "done", "doneAt", "scheduledFor", "order",
    "pinDay", "pinTime", "repeat",
  ];
  const PROJECT_FIELDS = [
    "id", "name", "client", "value", "status", "archived", "meaning", "parentId",
  ];

  const task = {
    id: "t-1", projectId: "p-1", title: "Sign the lease", notes: "with the surveyor",
    estimateMins: 90, due: "2026-08-14", priority: "high", delegatedTo: "Anders",
    done: true, doneAt: 1760000000000, scheduledFor: "2026-08-13", order: 2,
    pinDay: "2026-08-13", pinTime: "09:15", repeat: "week",
    updatedAt: 1760000000000, deletedAt: null,
  };
  const back = decode("tasks", encode("tasks", [task]))[0];
  const lost = TASK_FIELDS.filter((k) => String(back[k] ?? "") !== String(task[k] ?? ""));
  t("every task field survives the round trip to the server and home",
    lost.length === 0, `dropped or changed: ${lost.join(", ")}`);

  const project = {
    id: "p-1", name: "Munich lease", client: "Hartmann", value: 48000,
    status: "active", archived: false, meaning: "Our first office of our own.",
    parentId: "p-0", updatedAt: 1760000000000, deletedAt: null,
  };
  const pBack = decode("projects", encode("projects", [project]))[0];
  const pLost = PROJECT_FIELDS.filter((k) => String(pBack[k] ?? "") !== String(project[k] ?? ""));
  t("every project field survives it too", pLost.length === 0,
    `dropped or changed: ${pLost.join(", ")}`);

  /**
   * The absent case matters as much. An unpinned task must arrive unpinned
   * rather than carrying empty strings — "" would read as a pin to nothing
   * and put a block at midnight.
   */
  const plain = decode("tasks", encode("tasks", [{ id: "x", title: "Plain", updatedAt: 1 }]))[0];
  t("and an absent pin stays absent, not an empty string",
    plain.pinDay === null && plain.pinTime === null && plain.repeat === null,
    JSON.stringify({ day: plain.pinDay, time: plain.pinTime, repeat: plain.repeat }));

  // What goes on the wire must be the column names the schema declares: a
  // camelCase key is a column that does not exist and a row Postgres rejects.
  const wire = encode("tasks", [task])[0];
  t("the wire uses the schema's own column names",
    "pin_day" in wire && "pin_time" in wire && "repeat" in wire && !("pinDay" in wire),
    Object.keys(wire).join(","));
  t("  and so does a project's parent",
    "parent_id" in encode("projects", [project])[0]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
