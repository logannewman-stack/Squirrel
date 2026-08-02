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
  active: null,
  settings: {},
};

let cache = null;
const listeners = new Set();

function read() {
  if (cache) return cache;
  try {
    cache = { ...EMPTY, ...(JSON.parse(localStorage.getItem(KEY)) || {}) };
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
const update = (patch) => commit({ ...read(), ...patch });

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const PRIORITIES = ["critical", "high", "normal", "low"];

// ---------------------------------------------------------------- projects
export function addProject({ name, client = "", value = null, status = "active" }) {
  const p = { id: uid(), name: name.trim() || "Untitled", client, value, status, createdAt: Date.now() };
  update({ projects: [...read().projects, p] });
  return p;
}

export const updateProject = (id, patch) =>
  update({ projects: read().projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

export function deleteProject(id) {
  const s = read();
  update({
    projects: s.projects.filter((p) => p.id !== id),
    tasks: s.tasks.filter((t) => t.projectId !== id),
    events: s.events.map((e) => (e.projectId === id ? { ...e, projectId: null } : e)),
  });
}

// ------------------------------------------------------------------- tasks
export function addTask({
  projectId = null, title, estimateMins = 30, due = null,
  priority = "normal", delegatedTo = "", notes = "",
}) {
  const t = {
    id: uid(), projectId, title: title.trim(), estimateMins, due, priority,
    delegatedTo, notes, done: false, doneAt: null,
    createdAt: Date.now(), scheduledFor: null, order: null,
  };
  update({ tasks: [...read().tasks, t] });
  return t;
}

export const updateTask = (id, patch) =>
  update({ tasks: read().tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });

export function toggleTask(id) {
  update({
    tasks: read().tasks.map((t) =>
      t.id === id ? { ...t, done: !t.done, doneAt: t.done ? null : Date.now() } : t,
    ),
  });
}

export const deleteTask = (id) => update({ tasks: read().tasks.filter((t) => t.id !== id) });

/** Replace today's plan with an ordered list of task ids. */
export function applyPlan(taskIds, day = dayKey()) {
  const rank = new Map(taskIds.map((id, i) => [id, i]));
  update({
    tasks: read().tasks.map((t) =>
      rank.has(t.id)
        ? { ...t, scheduledFor: day, order: rank.get(t.id) }
        : t.scheduledFor === day
          ? { ...t, scheduledFor: null, order: null }
          : t,
    ),
  });
}

// ------------------------------------------------------------------ events
export function addEvent({ title, start, end, location = "", attendees = [], projectId = null, notes = "" }) {
  const e = { id: uid(), title: title.trim(), start, end, location, attendees, projectId, notes, createdAt: Date.now() };
  update({ events: [...read().events, e] });
  return e;
}

export const updateEvent = (id, patch) =>
  update({ events: read().events.map((e) => (e.id === id ? { ...e, ...patch } : e)) });

export const deleteEvent = (id) => update({ events: read().events.filter((e) => e.id !== id) });

export const eventsOn = (day, events = read().events) =>
  events
    .filter((e) => dayKey(new Date(e.start)) === day)
    .sort((a, b) => new Date(a.start) - new Date(b.start));

// ---------------------------------------------------------------- sessions
export const logSession = (entry) =>
  update({ sessions: [{ id: uid(), ...entry }, ...read().sessions].slice(0, 2000) });

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
