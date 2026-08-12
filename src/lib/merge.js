/**
 * Reconciling one device's records with another's.
 *
 * Pure functions, no network, no storage — which is the point. This is the
 * part of sync that decides whether someone's meeting survives, so it has to
 * be testable without a server, a login, or a second laptop.
 *
 * The rules, in the order they matter:
 *
 *   1. Deletes beat edits. Undoing someone's delete is worse than losing an
 *      edit they can redo, and a resurrected meeting looks like a bug in a way
 *      a missing edit does not.
 *   2. Otherwise the later `updatedAt` wins, whole-record.
 *   3. Exact ties keep the local copy. Ties are almost always the same write
 *      coming back, and preferring local avoids a pointless re-render.
 *
 * Field-level merging is deliberately not attempted. Two people editing one
 * meeting is rare; a half-merged meeting that took its time from one edit and
 * its attendees from another is a support ticket nobody can diagnose.
 */

/** Rows the server speaks (snake_case, ISO strings) → rows the app speaks. */
const FROM_DB = {
  projects: (r) => ({
    id: r.id, name: r.name, client: r.client ?? "", value: r.value ?? null,
    status: r.status, archived: !!r.archived, meaning: r.meaning ?? "",
    // Sub-projects: the branch this one grows off; null on the trunk.
    parentId: r.parent_id ?? null,
    createdAt: Date.parse(r.created_at), updatedAt: Date.parse(r.updated_at),
    deletedAt: r.deleted_at ? Date.parse(r.deleted_at) : null,
  }),
  tasks: (r) => ({
    id: r.id, projectId: r.project_id, title: r.title, notes: r.notes ?? "",
    estimateMins: r.estimate_mins, due: r.due, priority: r.priority,
    delegatedTo: r.delegated_to ?? "", done: !!r.done,
    doneAt: r.done_at ? Date.parse(r.done_at) : null,
    scheduledFor: r.scheduled_for, order: r.sort_order,
    // The hand-placed day and minute, and whether the work comes back.
    // Without these the planner on a second device silently re-decides what
    // the person already decided.
    pinDay: r.pin_day ?? null, pinTime: r.pin_time ?? null,
    repeat: r.repeat ?? null,
    createdAt: Date.parse(r.created_at), updatedAt: Date.parse(r.updated_at),
    deletedAt: r.deleted_at ? Date.parse(r.deleted_at) : null,
  }),
  events: (r) => ({
    id: r.id, projectId: r.project_id, title: r.title,
    // Stored as timestamptz on the server and as local wall-clock in the app.
    // The conversion has to happen exactly here, once, in both directions.
    start: toLocal(r.starts_at), end: toLocal(r.ends_at),
    location: r.location ?? "", attendees: r.attendees ?? [], notes: r.notes ?? "",
    createdAt: Date.parse(r.created_at), updatedAt: Date.parse(r.updated_at),
    deletedAt: r.deleted_at ? Date.parse(r.deleted_at) : null,
  }),
  sessions: (r) => ({
    id: r.id, taskId: r.task_id, projectId: r.project_id, label: r.label ?? "",
    plannedMs: r.planned_ms, focusedMs: r.focused_ms,
    endedAt: Date.parse(r.ended_at), updatedAt: Date.parse(r.updated_at),
    deletedAt: r.deleted_at ? Date.parse(r.deleted_at) : null,
  }),
  // The assistant thread. Append-only: a message is never edited after it is
  // written, so the generic last-write-wins rule degenerates to a union, which
  // is exactly right for a conversation.
  chat: (r) => ({
    id: r.id, role: r.role, text: r.text ?? "", actions: r.actions ?? [],
    at: Date.parse(r.created_at), updatedAt: Date.parse(r.updated_at),
    deletedAt: r.deleted_at ? Date.parse(r.deleted_at) : null,
  }),
};

const TO_DB = {
  projects: (r) => ({
    id: r.id, name: r.name, client: r.client ?? "", value: r.value ?? null,
    status: r.status ?? "active", archived: !!r.archived, meaning: r.meaning ?? "",
    parent_id: r.parentId ?? null,
    updated_at: new Date(r.updatedAt ?? Date.now()).toISOString(),
    deleted_at: r.deletedAt ? new Date(r.deletedAt).toISOString() : null,
  }),
  tasks: (r) => ({
    id: r.id, project_id: r.projectId ?? null, title: r.title, notes: r.notes ?? "",
    estimate_mins: r.estimateMins ?? 30, due: r.due ?? null,
    priority: r.priority ?? "normal", delegated_to: r.delegatedTo ?? "",
    done: !!r.done, done_at: r.doneAt ? new Date(r.doneAt).toISOString() : null,
    scheduled_for: r.scheduledFor ?? null, sort_order: r.order ?? null,
    pin_day: r.pinDay ?? null, pin_time: r.pinTime ?? null,
    repeat: r.repeat ?? null,
    updated_at: new Date(r.updatedAt ?? Date.now()).toISOString(),
    deleted_at: r.deletedAt ? new Date(r.deletedAt).toISOString() : null,
  }),
  events: (r) => ({
    id: r.id, project_id: r.projectId ?? null, title: r.title,
    starts_at: fromLocal(r.start), ends_at: fromLocal(r.end),
    location: r.location ?? "", attendees: r.attendees ?? [], notes: r.notes ?? "",
    updated_at: new Date(r.updatedAt ?? Date.now()).toISOString(),
    deleted_at: r.deletedAt ? new Date(r.deletedAt).toISOString() : null,
  }),
  chat: (r) => ({
    id: r.id, role: r.role, text: r.text ?? "", actions: r.actions ?? [],
    // `at` is when it was said; the server column is created_at. Sending it
    // keeps the order right on a device that pulls the thread months later.
    created_at: new Date(r.at ?? Date.now()).toISOString(),
    updated_at: new Date(r.updatedAt ?? r.at ?? Date.now()).toISOString(),
    deleted_at: r.deletedAt ? new Date(r.deletedAt).toISOString() : null,
  }),
  sessions: (r) => ({
    id: r.id, task_id: r.taskId ?? null, project_id: r.projectId ?? null,
    label: r.label ?? "", planned_ms: r.plannedMs, focused_ms: r.focusedMs,
    ended_at: new Date(r.endedAt).toISOString(),
    updated_at: new Date(r.updatedAt ?? Date.now()).toISOString(),
    deleted_at: r.deletedAt ? new Date(r.deletedAt).toISOString() : null,
  }),
};

const pad = (n) => String(n).padStart(2, "0");

/**
 * An absolute instant → the local wall-clock string the app stores.
 *
 * A meeting is an instant, not a string, so the server holds timestamptz. But
 * "2pm Thursday" means 2pm wherever you are, and storing it as an instant is
 * what makes a calendar shift by an hour when the clocks change or the user
 * flies somewhere. Converting at the boundary keeps the app's own reasoning in
 * wall-clock terms, where every date rule in it already lives.
 */
export function toLocal(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

/** The inverse: a local wall-clock string → an instant, in this device's zone. */
export function fromLocal(local) {
  return new Date(local).toISOString();
}

export const decode = (kind, rows) => (rows || []).map(FROM_DB[kind]);
export const encode = (kind, rows) => (rows || []).map(TO_DB[kind]);

/**
 * Decide between two versions of the same record.
 * @returns {"remote"|"local"} which one survives.
 */
export function pick(local, remote) {
  const ld = local.deletedAt ?? 0;
  const rd = remote.deletedAt ?? 0;
  if (ld && !rd) return "local";
  if (rd && !ld) return "remote";
  return (remote.updatedAt ?? 0) > (local.updatedAt ?? 0) ? "remote" : "local";
}

/**
 * Fold a pulled set into a local set.
 *
 * @returns {{rows: object[], changed: boolean, push: object[]}}
 *   rows    the merged collection, tombstones filtered out
 *   changed whether anything actually moved, so a no-op sync repaints nothing
 *   push    local records the server has not seen or has an older copy of
 */
export function mergeCollection(localRows, remoteRows) {
  const byId = new Map(localRows.map((r) => [r.id, r]));
  const push = [];
  let changed = false;

  for (const remote of remoteRows) {
    const local = byId.get(remote.id);
    if (!local) {
      // New to this device — including tombstones, which have to be recorded
      // rather than ignored, or a later push would recreate the row.
      byId.set(remote.id, remote);
      changed = true;
      continue;
    }
    if (pick(local, remote) === "remote") {
      byId.set(remote.id, remote);
      changed = true;
    } else if ((local.updatedAt ?? 0) > (remote.updatedAt ?? 0) || (local.deletedAt && !remote.deletedAt)) {
      // Ours is newer: the server is behind and needs telling.
      push.push(local);
    }
  }

  // Anything the server did not mention at all is either brand new here or
  // outside the pull window. Pushing it is safe — the server resolves by the
  // same rule we just used.
  const mentioned = new Set(remoteRows.map((r) => r.id));
  for (const local of localRows) {
    if (!mentioned.has(local.id) && local.dirty) push.push(local);
  }

  return {
    rows: [...byId.values()].filter((r) => !r.deletedAt),
    tombstones: [...byId.values()].filter((r) => r.deletedAt),
    changed,
    push,
  };
}
