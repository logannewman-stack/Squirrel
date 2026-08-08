/**
 * The decisions every calendar sync has to make, whoever the calendar belongs to.
 *
 * Google runs on the server; Apple runs on the device, because Apple publishes
 * no server-side Calendar API and EventKit only exists inside the app. Two
 * providers, two runtimes — and exactly one copy of the logic that decides
 * whether somebody's meeting survives, because two copies of a conflict rule
 * drift, and the drift shows up as a lost edit nobody can reproduce.
 *
 * Pure functions only. No fetch, no storage, no provider SDK — so this file
 * runs unchanged in Node on the server and in Safari on a phone.
 */

/**
 * Is this remote row our own write echoing back?
 *
 * Every calendar API returns the event we just wrote on the very next read.
 * Without this it reads as something new and gets created a second time; push
 * that copy and one meeting becomes four. Matching on etag rather than on time
 * is what makes it reliable: clocks are not comparable across machines, but an
 * etag — or Apple's `lastModified` against what we recorded — is the exact
 * version we wrote.
 */
export function isEcho(remote, link) {
  if (!link) return false;
  if (link.etag && remote?.etag && link.etag === remote.etag) return true;
  if (!link.pushed_at) return false;
  const pushed = new Date(link.pushed_at).getTime();
  const updated = new Date(remote?.updated ?? remote?.lastModified ?? 0).getTime();
  return Number.isFinite(pushed) && Number.isFinite(updated) && Math.abs(updated - pushed) < 5000;
}

/**
 * Which copy wins when both sides moved.
 *
 * The remote wins a genuine tie. A calendar is shared — other people have
 * already been sent that time and planned around it — so silently preferring
 * our own copy would put the user in a meeting nobody else thinks is happening.
 */
export function resolve({ localUpdatedAt, remoteUpdatedAt, link }) {
  const local = new Date(localUpdatedAt ?? 0).getTime() || 0;
  const remote = new Date(remoteUpdatedAt ?? 0).getTime() || 0;
  const pulled = new Date(link?.pulled_at ?? 0).getTime() || 0;
  const pushed = new Date(link?.pushed_at ?? 0).getTime() || 0;

  const localMoved = local > Math.max(pulled, pushed);
  const remoteMoved = remote > Math.max(pulled, pushed);

  if (localMoved && !remoteMoved) return "push";
  if (remoteMoved && !localMoved) return "pull";
  if (!localMoved && !remoteMoved) return "none";
  return "pull"; // both moved — the shared copy is the one others can see
}

/* ------------------------------------------------------------------ Apple
   EventKit hands the app plain JavaScript dates through the native bridge,
   rather than the RFC3339 strings a web API returns. The app's own events are
   local wall-clock strings, so the conversion happens here — once, in both
   directions, the same discipline as merge.js.
   ------------------------------------------------------------------------ */

/** A local wall-clock string ("2026-08-12T14:00:00") from anything date-ish. */
export function wallClock(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

/**
 * One of our events, as EventKit wants it.
 *
 * Dates rather than strings: the bridge marshals a JS Date straight to an
 * NSDate, and handing it a string means the native side parses it in whatever
 * zone it feels like.
 */
export function toApple(event) {
  return {
    title: event.title,
    startDate: new Date(event.start),
    endDate: new Date(event.end),
    location: event.location || "",
    notes: event.notes || "",
  };
}

/**
 * An EventKit event, as ours.
 *
 * Returns null for anything unusable so callers filter rather than branch. All
 * day events are kept — a birthday is worth seeing — anchored at midnight.
 */
export function fromApple(e) {
  if (!e) return null;
  const start = wallClock(e.startDate);
  const end = wallClock(e.endDate);
  if (!start || !end) return null;
  if (new Date(end) <= new Date(start)) return null;

  return {
    title: (e.title || "").trim() || "(no title)",
    start,
    end,
    location: e.location || "",
    notes: e.notes || "",
    attendees: (e.attendees || [])
      .filter((a) => !a.isCurrentUser)
      .map((a) => ({ name: a.name || a.email, email: a.email })),
  };
}
