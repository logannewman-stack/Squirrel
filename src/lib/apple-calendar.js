import { isEcho, resolve, toApple, fromApple } from "./calsync";
import { getState, addEvent, updateEvent } from "./store";

/**
 * Apple Calendar, which can only be synced from the device.
 *
 * Apple publishes no server-side Calendar API. There is no OAuth to perform, no
 * token to store, and nothing a backend can call — EventKit exists inside the
 * app, on the user's own hardware, and that is the whole of it. So unlike
 * Google, this runs in the client: the same decisions (`isEcho`, `resolve`)
 * from the same file, executed somewhere else.
 *
 * That constraint is also the reason the native app is worth building at all.
 * Everything else Squirrel does works in a browser; this does not.
 *
 * ## The bridge
 *
 * The native shell exposes `__SQUIRREL_EVENTKIT__`. Every method is async and
 * mirrors EventKit closely:
 *
 *   available()                     → boolean
 *   requestAccess()                 → "granted" | "denied"
 *   calendars()                     → [{ id, title, writable }]
 *   events({ calendarId, from, to })→ [{ id, title, startDate, endDate, … }]
 *   save({ calendarId, event })     → { id, lastModified }
 *   remove({ calendarId, id })      → boolean
 *
 * Absent — in a browser, or an older build — every function here reports "not
 * available" rather than throwing, so the settings screen can say so plainly.
 */

const bridge = () => globalThis.__SQUIRREL_EVENTKIT__ ?? null;

export const appleCalendarAvailable = () => Boolean(bridge());

/** The window kept in step: recent past for context, a season ahead for planning. */
const WINDOW = { back: 7, forward: 120 };

const dayShift = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
};

/**
 * The map between our events and EventKit's, kept on the device.
 *
 * The server's `event_links` table cannot help here: the identifiers are local
 * to this phone's calendar database and mean nothing on another device, or even
 * to the same account after a restore. So the mapping lives beside the events
 * it describes, and a second device builds its own.
 */
const MAP_KEY = "squirrel.eventkit.map";

const loadMap = () => {
  try {
    return JSON.parse(localStorage.getItem(MAP_KEY)) || {};
  } catch {
    return {};
  }
};
const saveMap = (m) => {
  try {
    localStorage.setItem(MAP_KEY, JSON.stringify(m));
  } catch {
    // A full quota should not break syncing; the worst case is a rebuilt map.
  }
};

export async function requestAppleAccess() {
  const kit = bridge();
  if (!kit) return "unavailable";
  try {
    return await kit.requestAccess();
  } catch {
    return "denied";
  }
}

export async function appleCalendars() {
  const kit = bridge();
  if (!kit) return [];
  try {
    return (await kit.calendars()) || [];
  } catch {
    return [];
  }
}

/**
 * One pass: bring EventKit's changes in, then send ours out.
 *
 * Pull first, same as Google and for the same reason — pushing first would send
 * our copy of an event we were about to learn had moved, and whoever moved it
 * would watch it jump back.
 *
 * @param {string} calendarId  Which EventKit calendar to keep in step.
 * @param {boolean} writeBack  False makes this a one-way import.
 */
export async function syncAppleCalendar(calendarId, { writeBack = true } = {}) {
  const kit = bridge();
  if (!kit) return { ok: false, reason: "unavailable" };

  const access = await requestAppleAccess();
  if (access !== "granted") return { ok: false, reason: access };

  const map = loadMap();
  // Two directions of the same relation. Rebuilt each pass because it is small
  // and a stale reverse index is a duplicated meeting.
  const byRemote = new Map(Object.entries(map).map(([localId, m]) => [m.remote_id, { localId, ...m }]));

  let pulled = 0, pushed = 0;

  // ---------------------------------------------------------------- pull
  let remote = [];
  try {
    remote = (await kit.events({
      calendarId,
      from: dayShift(-WINDOW.back),
      to: dayShift(WINDOW.forward),
    })) || [];
  } catch {
    return { ok: false, reason: "read_failed" };
  }

  for (const item of remote) {
    const link = byRemote.get(item.id);
    if (isEcho({ etag: item.lastModified, lastModified: item.lastModified }, link)) continue;

    const fields = fromApple(item);
    if (!fields) continue;

    let localId = link?.localId ?? null;

    if (link) {
      const mine = getState().events.find((e) => e.id === link.localId);
      // The mapping outlived the event — deleted here while the app was closed.
      // Drop it rather than resurrecting the meeting.
      if (!mine) {
        delete map[link.localId];
        continue;
      }
      const call = resolve({
        localUpdatedAt: mine.updatedAt,
        remoteUpdatedAt: item.lastModified,
        link,
      });
      if (call !== "pull") continue;
      updateEvent(mine.id, fields);
    } else {
      localId = addEvent(fields).id;
    }

    map[localId] = {
      ...map[localId],
      remote_id: item.id,
      etag: item.lastModified,
      pulled_at: new Date().toISOString(),
    };
    pulled++;
  }

  // ---------------------------------------------------------------- push
  if (writeBack) {
    const from = dayShift(-WINDOW.back);
    const to = dayShift(WINDOW.forward);
    const mine = getState().events.filter((e) => {
      const at = new Date(e.start);
      return at >= from && at <= to;
    });

    for (const event of mine) {
      const link = map[event.id];
      const call = resolve({
        localUpdatedAt: event.updatedAt,
        remoteUpdatedAt: link?.pulled_at,
        link,
      });
      if (link && call !== "push") continue;

      try {
        const saved = await kit.save({
          calendarId,
          event: { ...toApple(event), id: link?.remote_id },
        });
        if (!saved?.id) continue;
        map[event.id] = {
          remote_id: saved.id,
          etag: saved.lastModified,
          pushed_at: new Date().toISOString(),
        };
        pushed++;
      } catch {
        // One event that will not save must not stop the rest. It is retried
        // next pass, and a permanently bad one costs a single write attempt.
      }
    }
  }

  saveMap(map);
  return { ok: true, pulled, pushed };
}

/**
 * Forget an Apple calendar.
 *
 * The mapping goes; the events stay. They are the user's own data, and often
 * ours in the first place — deleting a calendar because somebody unplugged a
 * sync is not a reading of "disconnect" anyone would expect.
 */
export function forgetAppleCalendar() {
  try {
    localStorage.removeItem(MAP_KEY);
  } catch {
    // Nothing to do; a stale map is rebuilt on the next pass anyway.
  }
}
