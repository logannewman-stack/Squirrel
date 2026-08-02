/**
 * Local-first data store.
 *
 * Everything lives in localStorage under one versioned key. There is no server,
 * so reads are synchronous and writes notify subscribers directly — no async
 * layer to reason about, and the app works offline by construction.
 *
 * The running focus session is stored as an `endsAt` timestamp rather than a
 * counter that ticks down. Browsers throttle timers in background tabs, often
 * to once a minute, so anything accumulating intervals loses time whenever the
 * app is not in front. Deriving from a wall-clock timestamp keeps the session
 * correct while backgrounded and survives a refresh or an outright close.
 */

const KEY = "squirrel.v1";

const EMPTY = {
  projects: [],
  tasks: [],
  sessions: [],
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
    // Corrupt storage must never brick the app — start clean instead.
    cache = { ...EMPTY };
  }
  return cache;
}

function commit(next) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Quota or private-browsing failures are non-fatal; state stays in memory.
  }
  listeners.forEach((fn) => fn(next));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  return read();
}

function update(patch) {
  commit({ ...read(), ...patch });
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ---------------------------------------------------------------- projects
export function addProject(name) {
  const project = { id: uid(), name: name.trim() || "Untitled", createdAt: Date.now() };
  update({ projects: [...read().projects, project] });
  return project;
}

export function renameProject(id, name) {
  update({
    projects: read().projects.map((p) => (p.id === id ? { ...p, name } : p)),
  });
}

export function deleteProject(id) {
  const s = read();
  update({
    projects: s.projects.filter((p) => p.id !== id),
    tasks: s.tasks.filter((t) => t.projectId !== id),
  });
}

// ------------------------------------------------------------------- tasks
export function addTask({ projectId, title, estimateMins = 25, due = null }) {
  const task = {
    id: uid(),
    projectId,
    title: title.trim(),
    estimateMins,
    due,
    done: false,
    doneAt: null,
    createdAt: Date.now(),
    scheduledFor: null,
    order: null,
  };
  update({ tasks: [...read().tasks, task] });
  return task;
}

export function updateTask(id, patch) {
  update({ tasks: read().tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
}

export function toggleTask(id) {
  update({
    tasks: read().tasks.map((t) =>
      t.id === id ? { ...t, done: !t.done, doneAt: t.done ? null : Date.now() } : t,
    ),
  });
}

export function deleteTask(id) {
  update({ tasks: read().tasks.filter((t) => t.id !== id) });
}

/** Replace today's plan: an ordered list of task ids. */
export function applyPlan(taskIds) {
  const day = todayKey();
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

// ---------------------------------------------------------------- sessions
export function logSession(entry) {
  update({ sessions: [{ id: uid(), ...entry }, ...read().sessions].slice(0, 1000) });
}

export function totals(sessions = read().sessions) {
  return {
    count: sessions.length,
    focusedMs: sessions.reduce((sum, s) => sum + (s.focusedMs || 0), 0),
  };
}

// ------------------------------------------------------------ focus session
export function startFocus({ taskId = null, label = "", plannedMs }) {
  const now = Date.now();
  update({
    active: { taskId, label, plannedMs, startedAt: now, endsAt: now + plannedMs, remainingMs: plannedMs },
  });
}

export function pauseFocus(now = Date.now()) {
  const a = read().active;
  if (!a || a.endsAt == null) return;
  update({ active: { ...a, endsAt: null, remainingMs: remainingOf(a, now) } });
}

export function resumeFocus(now = Date.now()) {
  const a = read().active;
  if (!a || a.endsAt != null) return;
  update({ active: { ...a, endsAt: now + a.remainingMs } });
}

export function endFocus(now = Date.now()) {
  const a = read().active;
  if (!a) return null;
  const focusedMs = focusedOf(a, now);
  const task = read().tasks.find((t) => t.id === a.taskId);
  logSession({
    taskId: a.taskId,
    projectId: task?.projectId ?? null,
    label: a.label || task?.title || "",
    plannedMs: a.plannedMs,
    focusedMs,
    endedAt: now,
  });
  update({ active: null });
  return { ...a, focusedMs };
}

/** Milliseconds left, derived from the clock. Never negative. */
export function remainingOf(a, now = Date.now()) {
  if (!a) return 0;
  return Math.max(0, a.endsAt == null ? a.remainingMs : a.endsAt - now);
}

/** Time actually spent focused — excludes any paused stretches. */
export function focusedOf(a, now = Date.now()) {
  if (!a) return 0;
  return Math.max(0, a.plannedMs - remainingOf(a, now));
}

// ---------------------------------------------------------------- settings
export function setSetting(key, value) {
  update({ settings: { ...read().settings, [key]: value } });
}
