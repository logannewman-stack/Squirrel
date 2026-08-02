/**
 * Delivering reminders, on whatever this is running on today.
 *
 * One thing worth being clear about, because it decides the whole design:
 * **none of this needs a push server.** Every reminder here is derived from
 * the user's own calendar and is known in advance, so it can be scheduled
 * locally on the device and fires with no network, no APNs certificate, no
 * Firebase project, and no cost per message. A push server is only required
 * for things that originate somewhere else — a teammate's change, a message
 * from us — and there are none of those yet.
 *
 * Three backends behind one interface:
 *
 *   capacitor  the native app. Real local notifications, fire when the app is
 *              closed, work on the lock screen. This is the one that matters,
 *              and it is why the interface is `schedule a list ahead of time`
 *              rather than `show one now`.
 *   web        the browser. The Notification API via a service worker, which
 *              covers desktop and Android. iOS Safari only allows it for a PWA
 *              the user has added to their home screen, and never for a plain
 *              tab, so treat web as a bonus rather than the plan.
 *   none       no permission, no support, or a plain tab on iOS. Everything
 *              still works; the reminders simply show up in the app instead.
 *
 * The interface is deliberately the *native* one — schedule ahead, cancel by
 * id — rather than the web's fire-now. Writing it the other way round would
 * mean rewriting the caller when the app is wrapped, which is exactly the
 * trap this is meant to avoid.
 */

const STORE_KEY = "squirrel.scheduled";

/** Which backend this device actually has. Decided once, at first use. */
export function backend() {
  if (globalThis.Capacitor?.isNativePlatform?.()) return "capacitor";
  if (typeof Notification !== "undefined" && "serviceWorker" in navigator) return "web";
  return "none";
}

export function permission() {
  if (backend() === "none") return "unsupported";
  if (backend() === "capacitor") return globalThis.__sqNativePerm || "default";
  return Notification.permission;         // "default" | "granted" | "denied"
}

/**
 * Ask, once, at a moment the user will understand.
 *
 * Never called on load. A permission prompt that appears before the app has
 * done anything gets denied, and a denial on iOS is close to permanent — the
 * only way back is Settings, which nobody visits.
 */
export async function requestPermission() {
  const be = backend();
  if (be === "none") return "unsupported";
  if (be === "capacitor") {
    const { LocalNotifications } = globalThis.Capacitor.Plugins;
    const res = await LocalNotifications.requestPermissions();
    globalThis.__sqNativePerm = res.display === "granted" ? "granted" : "denied";
    return globalThis.__sqNativePerm;
  }
  return Notification.requestPermission();
}

/** What this device currently believes is pending. */
export const scheduled = () => {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
  } catch {
    return [];
  }
};

const remember = (list) => localStorage.setItem(STORE_KEY, JSON.stringify(list));

/**
 * Bring the device's pending notifications in line with a list of reminders.
 *
 * @param {Array} want reminders from lib/reminders.js
 * @returns {Promise<{added: number, removed: number, backend: string}>}
 */
export async function sync(want) {
  const be = backend();
  const have = scheduled();

  // Ids are content-addressed, so a moved meeting looks like a different
  // reminder and the stale one gets cancelled rather than firing anyway.
  const wantIds = new Set(want.map((r) => r.id));
  const haveIds = new Set(have.map((r) => r.id));
  const add = want.filter((r) => !haveIds.has(r.id));
  const remove = have.filter((r) => !wantIds.has(r.id)).map((r) => r.id);

  if (be === "none" || permission() !== "granted") {
    // Still record the intent, so turning notifications on later does not have
    // to wait for the next state change to catch up.
    remember(want.map(pack));
    return { added: 0, removed: 0, backend: be };
  }

  if (be === "capacitor") {
    const { LocalNotifications } = globalThis.Capacitor.Plugins;
    if (remove.length) {
      await LocalNotifications.cancel({ notifications: remove.map((id) => ({ id: numeric(id) })) });
    }
    if (add.length) {
      await LocalNotifications.schedule({
        notifications: add.map((r) => ({
          // Capacitor wants a 32-bit int, not our string id.
          id: numeric(r.id),
          title: r.title,
          body: r.body,
          schedule: { at: new Date(r.at), allowWhileIdle: r.kind === "meeting" },
          extra: { kind: r.kind, entityId: r.entityId },
        })),
      });
    }
  } else {
    // The browser cannot schedule ahead without a service worker holding a
    // timer, and a timer dies with the tab. Only near-term reminders are worth
    // registering; the rest are picked up next time the app is open.
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    if (reg?.active) {
      reg.active.postMessage({ type: "sq-reminders", cancel: remove, schedule: add.map(pack) });
    }
  }

  remember(want.map(pack));
  return { added: add.length, removed: remove.length, backend: be };
}

/** Stored form: dates do not survive JSON, so they go out as epoch millis. */
const pack = (r) => ({ ...r, at: new Date(r.at).getTime() });

/** A stable 31-bit integer, because native ids are ints and ours are strings. */
function numeric(id) {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 2147483647;
}

/** Clear everything — used when the user turns reminders off. */
export async function clear() {
  const be = backend();
  const have = scheduled();
  if (be === "capacitor" && have.length) {
    const { LocalNotifications } = globalThis.Capacitor.Plugins;
    await LocalNotifications.cancel({ notifications: have.map((r) => ({ id: numeric(r.id) })) });
  }
  if (be === "web") {
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    reg?.active?.postMessage({ type: "sq-reminders", cancel: have.map((r) => r.id), schedule: [] });
  }
  remember([]);
}
