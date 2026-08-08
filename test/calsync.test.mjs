/**
 * The rules both calendars obey.
 *
 * Google runs on the server and Apple runs on the device, which is exactly the
 * situation where two copies of a conflict rule quietly drift apart — and the
 * drift shows up as a meeting that exists twice, or an edit that vanished, on
 * one platform only. There is one copy, and this is where it is pinned.
 */

import { isEcho, resolve, wallClock, toApple, fromApple } from "../src/lib/calsync.js";

let pass = 0, fail = 0;
const failures = [];
const t = (name, ok, detail) => {
  if (ok) pass++; else { fail++; failures.push(name); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

// ------------------------------------------------------------------- echoes
{
  t("a matching etag is our own write", isEcho({ etag: "abc" }, { etag: "abc" }));
  t("a different etag is real news", isEcho({ etag: "abc" }, { etag: "xyz" }) === false);
  t("no link is never an echo", isEcho({ etag: "abc" }, null) === false);

  // EventKit has no etag; it reports lastModified, so the same rule has to read
  // that too or every Apple write comes home and is created a second time.
  const at = "2026-08-12T10:00:00.000Z";
  t("an EventKit write we just made is an echo",
    isEcho({ lastModified: at }, { pushed_at: at }));
  t("an EventKit change an hour later is not",
    isEcho({ lastModified: "2026-08-12T11:00:00.000Z" }, { pushed_at: at }) === false);
}

// ---------------------------------------------------------------- conflicts
{
  const link = { pulled_at: "2026-08-12T10:00:00Z", pushed_at: "2026-08-12T10:00:00Z" };
  const later = "2026-08-12T12:00:00Z";
  const earlier = "2026-08-12T09:00:00Z";

  t("only local moved → push", resolve({ localUpdatedAt: later, remoteUpdatedAt: earlier, link }) === "push");
  t("only remote moved → pull", resolve({ localUpdatedAt: earlier, remoteUpdatedAt: later, link }) === "pull");
  t("neither moved → nothing", resolve({ localUpdatedAt: earlier, remoteUpdatedAt: earlier, link }) === "none");
  t("both moved → the shared copy wins",
    resolve({ localUpdatedAt: later, remoteUpdatedAt: later, link }) === "pull");
  t("nothing mapped yet and a local edit → push",
    resolve({ localUpdatedAt: later, remoteUpdatedAt: null, link: null }) === "push");
}

// ------------------------------------------------------------- wall clock
{
  // The app stores local wall-clock, and EventKit deals in Date objects. A
  // round trip through UTC is how a meeting drifts by the offset every sync,
  // so this must preserve the hour the user actually sees.
  const d = new Date(2026, 7, 12, 14, 30, 0);
  t("a Date becomes the local wall clock", wallClock(d) === "2026-08-12T14:30:00", wallClock(d));
  t("single digits are padded", wallClock(new Date(2026, 0, 5, 9, 5)) === "2026-01-05T09:05:00");
  t("nothing is null, not an exception", wallClock(null) === null);
  t("an unparseable value is null", wallClock("whenever") === null);
}

// ------------------------------------------------------------ apple mapping
{
  const ev = {
    title: "Board call", start: "2026-08-12T14:00:00", end: "2026-08-12T15:00:00",
    location: "Zoom", notes: "Q3",
  };
  const a = toApple(ev);
  // Dates, not strings: the bridge marshals a Date to an NSDate, and a string
  // is parsed natively in whatever zone the device feels like.
  t("EventKit gets real Date objects", a.startDate instanceof Date && a.endDate instanceof Date);
  t("at the hour we meant", a.startDate.getHours() === 14, a.startDate.toString());

  const back = fromApple({
    title: "Board call",
    startDate: new Date(2026, 7, 12, 14, 0),
    endDate: new Date(2026, 7, 12, 15, 0),
  });
  t("and comes home at the same wall clock", back.start === "2026-08-12T14:00:00", back.start);
  t("with the end intact", back.end === "2026-08-12T15:00:00");

  t("nothing maps to nothing", fromApple(null) === null);
  t("a missing start maps to nothing", fromApple({ title: "x" }) === null);
  // The schema requires an end after a start; a zero-length import would fail
  // the write and take the rest of the batch with it.
  t("a zero-length event is refused", fromApple({
    title: "x", startDate: new Date(2026, 7, 12, 9), endDate: new Date(2026, 7, 12, 9),
  }) === null);
  t("an untitled event still has a title", fromApple({
    startDate: new Date(2026, 7, 12, 9), endDate: new Date(2026, 7, 12, 10),
  }).title === "(no title)");
  // EventKit marks the account holder on their own events; keeping them would
  // add the user as an attendee of their own meeting on every pass.
  t("the user is not an attendee of their own meeting", fromApple({
    title: "x", startDate: new Date(2026, 7, 12, 9), endDate: new Date(2026, 7, 12, 10),
    attendees: [{ name: "Me", isCurrentUser: true }, { name: "Bob", email: "b@x.com" }],
  }).attendees.length === 1);
}

console.log(`\nCalendar sync rules: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
