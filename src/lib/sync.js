/**
 * Keeping a laptop and a phone holding the same calendar.
 *
 * The shape is pull-then-push, on a loop and on demand:
 *
 *   1. Ask the server for everything changed since this device's cursor,
 *      tombstones included.
 *   2. Merge it locally — see lib/merge.js, which owns the actual rules and is
 *      tested on its own.
 *   3. Send back whatever is still newer here, plus anything never sent.
 *   4. Store the cursor the server handed back, not our own clock.
 *
 * Deliberately not real-time. A calendar does not need sub-second propagation,
 * and a websocket that has to be reconnected, backed off, and reasoned about
 * on a flaky phone connection buys latency nobody asked for at a cost in
 * reliability everybody notices. Every write is pushed immediately anyway; the
 * poll is only there to catch what another device did.
 *
 * Nothing here is on the critical path of using the app. A failed sync leaves
 * the local copy exactly as it was, so being offline is indistinguishable from
 * being signed out — which is the whole point of local-first.
 */
import { client, configured, deviceId, deviceName } from "./supabase.js";
import { decode, encode, mergeCollection } from "./merge.js";
import { getState, applyRemote, markSynced } from "./store.js";

const KINDS = ["projects", "tasks", "events", "sessions", "chat"];
const TABLE = {
  projects: "projects", tasks: "tasks", events: "events",
  sessions: "focus_sessions", chat: "chat_messages",
};
const CURSOR_KEY = "squirrel.cursor";

let running = false;
let timer = null;
let listeners = new Set();

/** `idle` | `syncing` | `offline` | `error` — for the one-line status in the UI. */
let status = { state: configured ? "idle" : "off", at: 0, error: null };

export const onSyncChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const syncStatus = () => status;

function setStatus(next) {
  status = { ...status, ...next, at: Date.now() };
  listeners.forEach((fn) => fn(status));
}

const cursor = () => localStorage.getItem(CURSOR_KEY) || "1970-01-01T00:00:00Z";

/**
 * One full reconciliation.
 * @returns {Promise<boolean>} whether anything changed locally.
 */
export async function syncNow() {
  if (!configured || running) return false;
  const supabase = await client();
  const { data: { user } = {} } = await supabase.auth.getUser();
  if (!user) return false;

  running = true;
  setStatus({ state: "syncing", error: null });
  try {
    // ---- pull
    const { data, error } = await supabase.rpc("pull_changes", { since: cursor() });
    if (error) throw error;

    const local = getState();
    const merged = {};
    const outgoing = {};
    let changed = false;

    for (const kind of KINDS) {
      const remote = decode(kind, data[kind]);
      const m = mergeCollection(withTombstones(local, kind), remote);
      merged[kind] = m.rows;
      merged[`${kind}Tombstones`] = m.tombstones;
      outgoing[kind] = m.push;
      changed = changed || m.changed;
    }

    if (changed) applyRemote(merged);

    // ---- push
    const sent = [];
    for (const kind of KINDS) {
      if (!outgoing[kind].length) continue;
      const { error: upErr } = await supabase
        .from(TABLE[kind])
        .upsert(encode(kind, outgoing[kind]).map((r) => ({ ...r, user_id: user.id })));
      if (upErr) throw upErr;
      sent.push(...outgoing[kind].map((r) => ({ kind, id: r.id })));
    }
    if (sent.length) markSynced(sent);

    // ---- cursor, from the server's clock, already rewound for safety
    localStorage.setItem(CURSOR_KEY, data.cursor);

    await supabase.from("sync_state").upsert({
      user_id: user.id,
      device_id: deviceId(),
      device_name: deviceName(),
      pulled_at: data.cursor,
      seen_at: new Date().toISOString(),
    });

    setStatus({ state: "idle", error: null });
    return changed;
  } catch (e) {
    // Offline is not an error worth shouting about; anything else is.
    const offline = !navigator.onLine || /fetch|network/i.test(e?.message || "");
    setStatus({ state: offline ? "offline" : "error", error: offline ? null : e?.message || String(e) });
    return false;
  } finally {
    running = false;
  }
}

/**
 * Everything of one kind this device knows about, live rows and tombstones
 * together, because the merge has to see both to decide anything.
 */
function withTombstones(state, kind) {
  const dead = state.tombstones
    .filter((x) => x.kind === TABLE[kind] || x.kind === kind)
    .map((x) => ({ id: x.id, updatedAt: x.deletedAt, deletedAt: x.deletedAt, dirty: x.dirty }));
  return [...state[kind], ...dead];
}

const POLL_MS = 60_000;

/** Start syncing: once now, then on a slow poll, on focus, and on reconnect. */
export function startSync() {
  if (!configured || timer) return;
  const tick = () => syncNow();
  tick();
  timer = setInterval(tick, POLL_MS);
  addEventListener("online", tick);
  addEventListener("focus", tick);
  // A phone backgrounds the tab rather than closing it; this is the moment a
  // user actually looks at the screen again and expects it to be current.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tick();
  });
}

export function stopSync() {
  clearInterval(timer);
  timer = null;
}

/** Called after a local write, so the other device does not wait out the poll. */
let pushSoon = null;
export function nudge() {
  if (!configured) return;
  clearTimeout(pushSoon);
  // Coalesced: typing a title fires a write per keystroke, and each one does
  // not deserve its own round trip.
  pushSoon = setTimeout(syncNow, 1500);
}

/** Forget this device's cursor — used on sign-out and after a failed schema change. */
export function resetCursor() {
  localStorage.removeItem(CURSOR_KEY);
}
