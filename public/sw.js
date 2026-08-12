/**
 * The worker that keeps two promises: reminders fire, and the app opens.
 *
 * Reminders — a page cannot schedule a notification for tomorrow; its timers
 * die with the tab. The worker outlives the tab, so near-term reminders are
 * held here and fired on time. Best-effort: browsers stop idle workers, and
 * iOS Safari only runs this for a PWA on the home screen. The native app
 * hands its schedule to the OS instead.
 *
 * Opening — this file registered for years with no fetch handler, which made
 * "works offline" a half-truth: the data was local, but the *app* was not.
 * Kill the network and reload, and Chrome's dinosaur stood where the planner
 * should be — everything the person owned intact underneath an app that could
 * not be summoned to show it. So every same-origin GET is cached as it is
 * served: after one online visit, the shell opens from disk forever.
 *
 * Two policies, by what a wrong answer costs. Hashed assets cannot change
 * behind their names, so they come cache-first — instant, and refreshed in
 * the background out of caution. Navigations come network-first with the
 * cached shell as fallback, so a deploy is picked up on the next online open
 * and never blocks an offline one. Nothing cross-origin, nothing non-GET,
 * and nothing under /api/ is ever cached — a stale answer about billing is
 * worse than no answer.
 */
const TIMERS = new Map();
const SHELL = "sq-shell-v1";

self.addEventListener("install", (e) => e.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("sq-shell-") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);

const cacheable = (req) => {
  if (req.method !== "GET") return false;
  const url = new URL(req.url);
  return url.origin === self.location.origin && !url.pathname.startsWith("/api/");
};

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (!cacheable(req)) return;

  // The app itself. Fresh when the network answers; from disk when it cannot.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put("/index.html", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("/index.html").then((hit) => hit || Response.error())),
    );
    return;
  }

  // Everything else the shell is made of: cache-first, refreshed behind.
  event.respondWith(
    caches.match(req).then((hit) => {
      const refresh = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => hit || Response.error());
      return hit || refresh;
    }),
  );
});

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
