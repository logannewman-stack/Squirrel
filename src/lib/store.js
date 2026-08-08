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
  active: null,
  settings: {},
  // Which tier this account is on, as last reported by the server. Cached here
  // so gating is synchronous and survives a reload — a paid user must not see
  // their own features locked for a moment on every launch. It is a cache and
  // never a source of truth: the server meters anything that costs money, so
  // editing this by hand unlocks the drawing of a feature and nothing behind it.
  plan: "free",
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

function push(label) {
  past = [...past, { label, at: Date.now(), data: snapshot(read()) }].slice(-UNDO_LIMIT);
}

function mutate(label, patch) {
  if (depth === 0) push(label);
  commit({ ...read(), ...patch });
}

/**
 * One undo step around many writes.
 *
 * Clearing a week calls `deleteEvent` six times. Without this, undo puts back
 * one meeting and leaves five gone — which is worse than no undo, because it
 * looks like it worked.
 */
export function batch(label, fn) {
  if (depth > 0) return fn();
  push(label);
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

export const updateProject = (id, patch) =>
  mutate(`changing “${read().projects.find((p) => p.id === id)?.name || "a project"}”`,
    { projects: read().projects.map((p) => (p.id === id ? stamp({ ...p, ...patch }) : p)) });

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
  });
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

export const updateTask = (id, patch) =>
  mutate(`changing “${read().tasks.find((t) => t.id === id)?.title || "a task"}”`,
    { tasks: read().tasks.map((t) => (t.id === id ? stamp({ ...t, ...patch }) : t)) });

export function toggleTask(id) {
  const was = read().tasks.find((t) => t.id === id);
  mutate(`marking “${was?.title || "a task"}” ${was?.done ? "not done" : "done"}`, {
    tasks: read().tasks.map((t) =>
      t.id === id ? stamp({ ...t, done: !t.done, doneAt: t.done ? null : Date.now() }) : t,
    ),
  });
}

export const deleteTask = (id) =>
  mutate(`deleting “${read().tasks.find((t) => t.id === id)?.title || "a task"}”`,
    { tasks: read().tasks.filter((t) => t.id !== id), tombstones: bury("tasks", id) });

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
  mutate(`booking “${e.title}”`, { events: [...read().events, e] });
  return e;
}

export const updateEvent = (id, patch) =>
  mutate(`changing “${read().events.find((e) => e.id === id)?.title || "a meeting"}”`,
    { events: read().events.map((e) => (e.id === id ? stamp({ ...e, ...patch }) : e)) });

export const deleteEvent = (id) =>
  mutate(`cancelling “${read().events.find((e) => e.id === id)?.title || "a meeting"}”`,
    { events: read().events.filter((e) => e.id !== id), tombstones: bury("events", id) });

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
  update({ chat: [...read().chat, { id: uid(), at: Date.now(), ...msg }].slice(-200) });

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

// ------------------------------------------------------------------ planning
/**
 * Replace the work plan.
 *
 * Derived state, so it is written wholesale rather than patched: the planner
 * decides every block at once, and merging its output with a stale copy would
 * produce a schedule neither of them intended.
 */
export const setPlan = ({ blocks, shortfalls }) =>
  update({ blocks: blocks || [], shortfalls: shortfalls || [] });
