/**
 * Reminder delivery for the browser.
 *
 * A page cannot schedule a notification for tomorrow — its timers die with the
 * tab. A service worker outlives the tab, so near-term reminders are held here
 * and fired on time. It is still best-effort: browsers stop workers they think
 * are idle, and iOS Safari only runs this at all for a PWA the user has added
 * to their home screen.
 *
 * The native app does not use any of this. Capacitor hands the schedule to the
 * OS, which is the only thing that can reliably wake a closed app — which is
 * why the interface both share is "schedule ahead", not "show one now".
 */
const TIMERS = new Map();

self.addEventListener("install", (e) => e.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || msg.type !== "sq-reminders") return;

  for (const id of msg.cancel || []) {
    clearTimeout(TIMERS.get(id));
    TIMERS.delete(id);
  }

  for (const r of msg.schedule || []) {
    const delay = r.at - Date.now();
    // Anything further out than a day is not worth holding: the worker will
    // have been stopped long before, and the app will re-register on next open.
    if (delay <= 0 || delay > 86400000) continue;
    clearTimeout(TIMERS.get(r.id));
    TIMERS.set(
      r.id,
      setTimeout(() => {
        TIMERS.delete(r.id);
        self.registration.showNotification(r.title, {
          body: r.body,
          tag: r.id,
          icon: "/icon-512.png",
          badge: "/favicon.png",
          data: { kind: r.kind, entityId: r.entityId },
        });
      }, delay),
    );
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
      for (const c of cs) if ("focus" in c) return c.focus();
      return self.clients.openWindow("/");
    }),
  );
});
