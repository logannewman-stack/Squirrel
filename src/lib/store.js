/**
 * Local-first data store.
 *
 * One versioned localStorage key holds everything. No server, so reads are
 * synchronous and writes notify subscribers directly — the app works offline by
 * construction and there is no async layer to reason about.
 *
 * Two time concepts, deliberately distinct:
 *   events — anchored to a wall clock (meetings, blocks). start/end are ISO.
 *   tasks  — work with a duration and a deadline, but no fixed hour.
 * The planner's whole job is fitting the second around the first.
 */

import { tap } from "./native.js";

const KEY = "squirrel.v2";

const EMPTY = {
  projects: [],
  tasks: [],
  events: [],
  sessions: [],
  chat: [],
  // What the assistant remembers about the conversation so far — see
  // lib/nlu/context.js. Persisted with everything else so closing the app
  // mid-thread does not lose the thread.
  memory: { turns: [] },
  // {kind, id, deletedAt} — what this device has deleted, until the server has
  // heard about it and long enough after that for other devices to catch up.
  tombstones: [],
  // Work laid out across the days before each deadline — see lib/schedule.js.
  // Derived, not authored: recomputed whenever tasks or meetings move, so it is
  // never the source of truth for anything.
  blocks: [],
  // Tasks whose remaining work no longer fits before their deadline. Kept in
  // state because it is the one thing worth interrupting someone about.
  shortfalls: [],
  // Tasks whose estimate is spent but which are still open — the state the
  // focus timer manufactures when somebody works through it and forgets the
  // checkbox. Derived like the two above, and surfaced on Today because the
  // planner cannot decide it: only the person knows whether it is finished.
  spent: [],
  active: null,
  settings: {},
  // Which tier this account is on, as last reported by the server. Cached here
  // so gating is synchronous and survives a reload — a paid user must not see
  // their own features locked for a moment on every launch. It is a cache and
  // never a source of truth: the server meters anything that costs money, so
  // editing this by hand unlocks the drawing of a feature and nothing behind it.
  plan: "free",
  // {day, n} — how many turns a free account has spent with the assistant
  // today. Reset by the date changing rather than by a timer, so it needs no
  // scheduler and survives the app being closed overnight.
  assists: { day: "", n: 0 },
};

let cache = null;
const listeners = new Set();

/**
 * Undo.
 *
 * An assistant that cancels six meetings on one sentence needs a way back, and
 * "are you sure?" is not one — it moves the risk to the moment you are least
 * able to judge it. A snapshot before every change is cheap here because the
 * whole dataset is small enough to hold in memory several times over.
 *
 * Only the collections a person would want back are kept. Chat, memory, the
 * derived plan and the running timer are excluded: they churn on every turn,
 * and restoring a stale plan over a fresh one would be a bug rather than a
 * favour. The plan is derived, so it recomputes itself the moment the data
 * beneath it moves.
 */
const UNDOABLE = ["projects", "tasks", "events", "sessions", "tombstones"];
const UNDO_LIMIT = 40;
let past = [];

const snapshot = (s) => Object.fromEntries(UNDOABLE.map((k) => [k, s[k]]));

function read() {
  if (cache) return cache;
  try {
    cache = toUuids({ ...EMPTY, ...(JSON.parse(localStorage.getItem(KEY)) || {}) });
  } catch {
    cache = { ...EMPTY };
  }
  return cache;
}

function commit(next) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Quota / private-browsing failures are non-fatal; state stays in memory.
  }
  listeners.forEach((fn) => fn(next));
}

export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const getState = () => read();

/** An ephemeral write — chat, memory, the derived plan. Not undoable. */
const update = (patch) => commit({ ...read(), ...patch });

/**
 * A write worth being able to take back.
 *
 * The label is what the user will be told they undid, so it is written from
 * their side of the change: "cancelling 3 meetings", not "deleteEvent×3".
 */
let depth = 0;

/**
 * Whether a change is worth interrupting somebody about.
 *
 * Every write is undoable; not every write deserves a bar across the bottom of
 * the screen offering to take it back. Typing a project's name and tabbing out
 * of the field does not — you are looking straight at the result, and a
 * notification telling you what you just did is the kind of thing people learn
 * to ignore, which is how the important one gets ignored too.
 *
 * Loud is the short list: anything **destructive**, anything **plural**, and
 * anything that **moves the calendar**. Those are the three shapes of change
 * you can make and not immediately see the whole of.
 */
const LOUD = "loud";

function push(label, volume) {
  past = [...past, { label, volume, at: Date.now(), data: snapshot(read()) }].slice(-UNDO_LIMIT);
}

function mutate(label, patch, volume) {
  if (depth === 0) push(label, volume);
  commit({ ...read(), ...patch });
}

/**
 * Did this patch actually change anything?
 *
 * `onBlur` fires whether or not a field was edited, so tabbing through the
 * three inputs on a project produced three writes that changed nothing — and
 * each one pushed an undo step, so ⌘Z had to be pressed three times before it
 * did something visible, which reads as a broken undo. Each also re-stamped
 * the row as dirty, queueing a pointless upload of an identical record.
 *
 * Stringified rather than compared by reference: `attendees` is an array, and
 * a reference check would call every save a change.
 */
const same = (a, b) => a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const unchanged = (row, patch) => Object.keys(patch).every((k) => same(row[k], patch[k]));

/**
 * One undo step around many writes.
 *
 * Clearing a week calls `deleteEvent` six times. Without this, undo puts back
 * one meeting and leaves five gone — which is worse than no undo, because it
 * looks like it worked.
 */
export function batch(label, fn) {
  if (depth > 0) return fn();
  push(label, LOUD);
  depth++;
  try {
    return fn();
  } finally {
    depth--;
  }
}

/** What the last undoable change was, or null. */
export const lastChange = () => past[past.length - 1]?.label ?? null;

/**
 * How many steps back there are.
 *
 * The undo history is module state rather than part of the snapshot — it churns
 * on every write and has no business in a sync payload — which means nothing
 * subscribed to the store can see it *change*. A depth that went up is the only
 * reliable signal that something just happened, and it is what the undo toast
 * watches: `lastChange()` alone cannot tell "deleted a task" from "deleted a
 * task, then undid it, and this is the previous label surfacing".
 */
export const undoDepth = () => past.length;

/**
 * Whether the last change is one to say out loud.
 *
 * Separate from `lastChange` rather than folded into it, because that returns
 * a string the assistant reads aloud mid-sentence and widening it would mean
 * touching every caller for the benefit of one.
 */
export const lastChangeLoud = () => past[past.length - 1]?.volume === "loud";

/**
 * Step back one change.
 * @returns {string|null} what was undone, for reading back.
 */
export function undo() {
  const step = past[past.length - 1];
  if (!step) return null;
  past = past.slice(0, -1);
  // Deliberately not re-pushed: undo is a step backwards through history, not
  // itself a change to be undone. A stack where undo is undoable produces a
  // loop nobody can reason about mid-panic.
  commit({ ...read(), ...step.data });
  return step.label;
}

export const canUndo = () => past.length > 0;

/**
 * Back to nothing.
 *
 * Clearing the key on its own is not enough — `cache` still holds the old state
 * and every subsequent read returns it, which is why erasing used to need a
 * full page reload to take effect.
 */
export const resetAll = () => {
  past = [];
  commit({ ...EMPTY, settings: {} });
};

/**
 * A backup file, put back.
 *
 * Replace rather than merge. Merging two copies of the same week produces
 * duplicates of everything that exists in both, and the person who reached for
 * a backup wanted the state in the file — not the state in the file mixed with
 * whatever was already here.
 *
 * Three things survive the replacement, because they describe *this device and
 * this account* rather than the data in the file:
 *
 *   - the plan, which is a server fact and must not be settable by editing a
 *     file in a text editor;
 *   - the signed-in address, so restoring somebody's export does not rewrite
 *     who is logged in;
 *   - having been through the introduction, since you are demonstrably past it.
 *
 * Not undoable, and the caller says so before asking. Undo only covers the
 * collections a normal edit touches, so an undoable restore would put four of
 * them back and leave settings and the conversation from the file — which is
 * worse than no undo, because it looks like it worked.
 */
export function restoreAll({ settings = {}, ...rows }) {
  const s = read();
  const at = Date.now();
  // Dirty, so a signed-in device pushes the restored rows up rather than
  // treating them as already-synced and letting the next pull delete them.
  const restamp = (list) => (list || []).map((r) => ({ ...r, updatedAt: at, dirty: true }));
  past = [];
  commit(
    toUuids({
      ...EMPTY,
      projects: restamp(rows.projects),
      tasks: restamp(rows.tasks),
      events: restamp(rows.events),
      sessions: restamp(rows.sessions),
      chat: rows.chat || [],
      settings: { ...settings, email: s.settings?.email, onboarded: true },
      plan: s.plan,
    }),
  );
}

/**
 * UUIDs, because Postgres holds these as `uuid` and a device that invents its
 * own key has to produce one the server will accept. Random enough that two
 * offline devices creating rows at the same moment cannot collide.
 */
const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });

const IS_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Records made before ids were UUIDs cannot be pushed to Postgres. Remap them
 * once, on load, rewriting every reference in the same pass — a task pointing
 * at a project id that no longer exists is worse than the original problem.
 */
function toUuids(s) {
  const remap = new Map();
  const fix = (id) => {
    if (!id || IS_UUID.test(id)) return id;
    if (!remap.has(id)) remap.set(id, uid());
    return remap.get(id);
  };
  const next = {
    ...s,
    projects: s.projects.map((p) => ({ ...p, id: fix(p.id) })),
    tasks: s.tasks.map((t) => ({ ...t, id: fix(t.id), projectId: fix(t.projectId) })),
    events: s.events.map((e) => ({ ...e, id: fix(e.id), projectId: fix(e.projectId) })),
    sessions: s.sessions.map((x) => ({
      ...x, id: fix(x.id), taskId: fix(x.taskId), projectId: fix(x.projectId),
    })),
    active: s.active ? { ...s.active, taskId: fix(s.active.taskId) } : null,
  };
  if (!remap.size) return s;
  // The assistant remembers ids too; a stale one would silently stop resolving.
  next.memory = {
    ...s.memory,
    turns: (s.memory?.turns || []).map((t) =>
      t.entity ? { ...t, entity: { ...t.entity, id: fix(t.entity.id) } } : t),
  };
  return next;
}

/**
 * Every write carries when it happened and that it has not been sent yet.
 * Stamping here rather than at each call site means a new mutation cannot
 * forget to do it, which would make the row invisible to sync forever.
 */
const stamp = (row) => ({ ...row, updatedAt: Date.now(), dirty: true });

/**
 * Deletes leave a marker. A row that merely vanished is indistinguishable from
 * one this device has not pulled yet, and the second reading resurrects it.
 */
function bury(kind, id) {
  const s = read();
  return [...s.tombstones.filter((x) => !(x.kind === kind && x.id === id)),
          { kind, id, deletedAt: Date.now(), dirty: true }].slice(-500);
}

export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const PRIORITIES = ["critical", "high", "normal", "low"];

// ---------------------------------------------------------------- projects
export function addProject({ name, client = "", value = null, status = "active", due = null }) {
  // A project deadline is not the same as its last task's. It is the date the
  // whole thing is judged on, and it is what makes pacing arithmetic possible
  // at all — see projectLoad in lib/schedule.js.
  const p = stamp({ id: uid(), name: name.trim() || "Untitled", client, value, status, due, createdAt: Date.now() });
  mutate(`creating the project “${p.name}”`, { projects: [...read().projects, p] });
  return p;
}

export function updateProject(id, patch) {
  const was = read().projects.find((p) => p.id === id);
  if (!was || unchanged(was, patch)) return;
  mutate(`changing “${was?.name || "a project"}”`,
    { projects: read().projects.map((p) => (p.id === id ? stamp({ ...p, ...patch }) : p)) });
}

/**
 * Put a project away, or bring it back.
 *
 * `archived` was read in eight places — the grid filtered on it, Today
 * filtered on it, the plan quota counted against it, search ranked it down —
 * and written in none. Nothing in the app could set the flag, so every one of
 * those readers was branching on a value that was permanently false, and a
 * finished deal had exactly two fates: clutter the grid forever, or be deleted
 * along with every task and every hour ever logged against it. For work that
 * is simply *over*, both are wrong, and the second is unrecoverable.
 *
 * Its own function rather than a `updateProject` call, so the undo entry says
 * what happened: "changing Munich lease" is not a thing anybody would
 * recognise afterwards as the archive they want back.
 */
export function setProjectArchived(id, archived = true) {
  const was = read().projects.find((p) => p.id === id);
  if (!was || !!was.archived === !!archived) return;
  mutate(`${archived ? "archiving" : "reopening"} “${was.name}”`, {
    projects: read().projects.map((p) => (p.id === id ? stamp({ ...p, archived: !!archived }) : p)),
  });
}

export function deleteProject(id) {
  const s = read();
  const orphaned = s.tasks.filter((t) => t.projectId === id);
  mutate(`deleting “${s.projects.find((p) => p.id === id)?.name || "a project"}”`, {
    projects: s.projects.filter((p) => p.id !== id),
    tasks: s.tasks.filter((t) => t.projectId !== id),
    events: s.events.map((e) => (e.projectId === id ? stamp({ ...e, projectId: null }) : e)),
    // Every cascaded task needs its own marker. Relying on the server's foreign
    // key would delete them there but leave them on a device that has not
    // pulled yet, and its next push would recreate them.
    tombstones: [
      ...bury("projects", id),
      ...orphaned.map((t) => ({ kind: "tasks", id: t.id, deletedAt: Date.now(), dirty: true })),
    ],
  // The loudest change in the app: it takes every task in the project with it,
  // and the count of those is the one thing the confirmation cannot show you
  // after the fact.
  }, LOUD);
}

// ------------------------------------------------------------------- tasks
export function addTask({
  projectId = null, title, estimateMins = 30, due = null,
  priority = "normal", delegatedTo = "", notes = "",
}) {
  const t = stamp({
    id: uid(), projectId, title: title.trim(), estimateMins, due, priority,
    delegatedTo, notes, done: false, doneAt: null,
    createdAt: Date.now(), scheduledFor: null, order: null,
  });
  mutate(`adding “${t.title}”`, { tasks: [...read().tasks, t] });
  return t;
}

export function updateTask(id, patch) {
  const was = read().tasks.find((t) => t.id === id);
  if (!was || unchanged(was, patch)) return;
  mutate(`changing “${was?.title || "a task"}”`,
    { tasks: read().tasks.map((t) => (t.id === id ? stamp({ ...t, ...patch }) : t)) });
}

export function toggleTask(id) {
  // The one action in the app that is worth feeling. A task ticking off is a
  // small win, and on iOS a haptic is how a small win is acknowledged.
  tap(read().tasks.find((t) => t.id === id)?.done ? "light" : "success");
  const was = read().tasks.find((t) => t.id === id);
  mutate(`marking “${was?.title || "a task"}” ${was?.done ? "not done" : "done"}`, {
    tasks: read().tasks.map((t) =>
      t.id === id ? stamp({ ...t, done: !t.done, doneAt: t.done ? null : Date.now() }) : t,
    ),
  });
}

export const deleteTask = (id) =>
  mutate(`deleting “${read().tasks.find((t) => t.id === id)?.title || "a task"}”`,
    { tasks: read().tasks.filter((t) => t.id !== id), tombstones: bury("tasks", id) }, LOUD);

/** Replace today's plan with an ordered list of task ids. */
export function applyPlan(taskIds, day = dayKey()) {
  const rank = new Map(taskIds.map((id, i) => [id, i]));
  update({
    tasks: read().tasks.map((t) =>
      rank.has(t.id)
        ? stamp({ ...t, scheduledFor: day, order: rank.get(t.id) })
        : t.scheduledFor === day
          ? stamp({ ...t, scheduledFor: null, order: null })
          : t,
    ),
  });
}

// ------------------------------------------------------------------ events
export function addEvent({ title, start, end, location = "", attendees = [], projectId = null, notes = "" }) {
  const e = stamp({ id: uid(), title: title.trim(), start, end, location, attendees, projectId, notes, createdAt: Date.now() });
  mutate(`booking “${e.title}”`, { events: [...read().events, e] }, LOUD);
  return e;
}

/** A meeting moving is loud: it is a change to a day you cannot see all of. */
export function updateEvent(id, patch) {
  const was = read().events.find((e) => e.id === id);
  if (!was || unchanged(was, patch)) return;
  mutate(`changing “${was?.title || "a meeting"}”`,
    { events: read().events.map((e) => (e.id === id ? stamp({ ...e, ...patch }) : e)) }, LOUD);
}

export const deleteEvent = (id) =>
  mutate(`cancelling “${read().events.find((e) => e.id === id)?.title || "a meeting"}”`,
    { events: read().events.filter((e) => e.id !== id), tombstones: bury("events", id) }, LOUD);

export const eventsOn = (day, events = read().events) =>
  events
    .filter((e) => dayKey(new Date(e.start)) === day)
    .sort((a, b) => new Date(a.start) - new Date(b.start));

// ---------------------------------------------------------------- sessions
export const logSession = (entry) =>
  update({ sessions: [stamp({ id: uid(), ...entry }), ...read().sessions].slice(0, 2000) });

export const totals = (sessions = read().sessions) => ({
  count: sessions.length,
  focusedMs: sessions.reduce((s, x) => s + (x.focusedMs || 0), 0),
});

// -------------------------------------------------------------------- chat
export const appendChat = (msg) =>
  // `updatedAt` and `dirty` are what make a message visible to sync — without
  // them the thread stays on the device that produced it.
  update({
    chat: [...read().chat,
      { id: uid(), at: Date.now(), updatedAt: Date.now(), dirty: true, ...msg },
    ].slice(-200),
  });

/** Clearing the visible thread has to clear what the assistant remembers of it
 *  too, or the next message quietly amends something the user can no longer see. */
export const clearChat = () => update({ chat: [], memory: { turns: [] } });

export const setMemory = (memory) => update({ memory });

// ------------------------------------------------------------------- sync
/**
 * Replace collections with the result of a merge.
 *
 * Called only by lib/sync.js, and deliberately blunt: the merge has already
 * decided every row, so patching field by field here would just be a second
 * place for the rules to live and disagree.
 */
export function applyRemote({ projects, tasks, events, sessions, ...rest }) {
  const s = read();
  const tombstones = [
    ...(rest.projectsTombstones || []).map((r) => ({ kind: "projects", id: r.id, deletedAt: r.deletedAt, dirty: r.dirty })),
    ...(rest.tasksTombstones || []).map((r) => ({ kind: "tasks", id: r.id, deletedAt: r.deletedAt, dirty: r.dirty })),
    ...(rest.eventsTombstones || []).map((r) => ({ kind: "events", id: r.id, deletedAt: r.deletedAt, dirty: r.dirty })),
    ...(rest.sessionsTombstones || []).map((r) => ({ kind: "sessions", id: r.id, deletedAt: r.deletedAt, dirty: r.dirty })),
  ];
  update({
    projects: projects ?? s.projects,
    tasks: tasks ?? s.tasks,
    events: events ?? s.events,
    sessions: sessions ?? s.sessions,
    tombstones,
  });
}

/**
 * Clear the dirty flag on rows the server has acknowledged.
 *
 * Compares `updatedAt` rather than clearing blindly: a row edited while the
 * push was in flight is dirty again, and marking it clean would strand that
 * edit on this device forever.
 */
export function markSynced(sent, at = Date.now()) {
  const s = read();
  const byKind = new Map();
  for (const { kind, id } of sent) {
    if (!byKind.has(kind)) byKind.set(kind, new Set());
    byKind.get(kind).add(id);
  }
  const clean = (kind, rows) => {
    const ids = byKind.get(kind);
    if (!ids) return rows;
    return rows.map((r) => (ids.has(r.id) && r.updatedAt <= at ? { ...r, dirty: false } : r));
  };
  update({
    projects: clean("projects", s.projects),
    tasks: clean("tasks", s.tasks),
    events: clean("events", s.events),
    sessions: clean("sessions", s.sessions),
    chat: clean("chat", s.chat),
    tombstones: s.tombstones.map((t) =>
      byKind.get(t.kind)?.has(t.id) ? { ...t, dirty: false } : t),
  });
}

// ------------------------------------------------------------ focus session
/**
 * The running session stores an `endsAt` timestamp rather than a counter that
 * ticks down. Browsers throttle background-tab timers to as little as once a
 * minute, so anything accumulating intervals loses time whenever the app is not
 * in front. Wall-clock derivation stays correct backgrounded and across a
 * refresh or an outright close.
 */
export function startFocus({ taskId = null, eventId = null, label = "", plannedMs }) {
  const now = Date.now();
  update({ active: { taskId, eventId, label, plannedMs, startedAt: now, endsAt: now + plannedMs, remainingMs: plannedMs } });
}

export function pauseFocus(now = Date.now()) {
  const a = read().active;
  if (a?.endsAt != null) update({ active: { ...a, endsAt: null, remainingMs: remainingOf(a, now) } });
}

export function resumeFocus(now = Date.now()) {
  const a = read().active;
  if (a && a.endsAt == null) update({ active: { ...a, endsAt: now + a.remainingMs } });
}

export function endFocus(now = Date.now()) {
  const a = read().active;
  if (!a) return null;
  const focusedMs = focusedOf(a, now);
  const task = read().tasks.find((t) => t.id === a.taskId);
  logSession({
    taskId: a.taskId, projectId: task?.projectId ?? null,
    label: a.label || task?.title || "", plannedMs: a.plannedMs, focusedMs, endedAt: now,
  });
  update({ active: null });
  return { ...a, focusedMs };
}

/** Milliseconds left, derived from the clock. Never negative. */
export const remainingOf = (a, now = Date.now()) =>
  !a ? 0 : Math.max(0, a.endsAt == null ? a.remainingMs : a.endsAt - now);

/** Time actually spent focused — excludes paused stretches. */
export const focusedOf = (a, now = Date.now()) =>
  !a ? 0 : Math.max(0, a.plannedMs - remainingOf(a, now));

// ---------------------------------------------------------------- settings
export const setSetting = (key, value) =>
  update({ settings: { ...read().settings, [key]: value } });

/**
 * Cache the tier the server reported.
 *
 * Ephemeral on purpose — this is not a change anyone would want to undo, and it
 * is re-fetched on every launch. Written only from the usage endpoint's answer;
 * signing out reports nothing and drops back to free.
 */
export const setPlanTier = (plan) =>
  read().plan === (plan || "free") ? undefined : update({ plan: plan || "free" });

/** How many of today's free assistant turns have been used. */
export function assistsToday(now = new Date()) {
  const a = read().assists;
  return a?.day === dayKey(now) ? a.n : 0;
}

/**
 * Spend one of today's free assistant turns.
 *
 * Called only when the account is not entitled outright — a paid plan never
 * reaches here, so the counter stays at zero and there is nothing to reset when
 * somebody upgrades.
 */
export function claimAssist(now = new Date()) {
  const today = dayKey(now);
  const a = read().assists;
  const n = (a?.day === today ? a.n : 0) + 1;
  update({ assists: { day: today, n } });
  return n;
}

// ------------------------------------------------------------------ planning
/**
 * Replace the work plan.
 *
 * Derived state, so it is written wholesale rather than patched: the planner
 * decides every block at once, and merging its output with a stale copy would
 * produce a schedule neither of them intended.
 */
export const setPlan = ({ blocks, shortfalls, spent }) =>
  update({ blocks: blocks || [], shortfalls: shortfalls || [], spent: spent || [] });
