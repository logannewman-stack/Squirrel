/**
 * Sending an invitation somebody actually receives.
 *
 * Two quiet failures here, both of which look like success. A misparsed
 * address sends the invitation to nobody and reports that it sent. And an
 * .ics that is malformed — an unescaped comma, a line over 75 octets, a
 * changed UID — is not rejected by the mail client, it is simply ignored, or
 * worse it adds the same meeting to somebody's calendar a second time every
 * time you resend.
 */

import { parsePerson, parsePeople, formatPeople, invitable, looksLikeEmail } from "../src/lib/addresses.js";
import { buildIcs, inviteHtml } from "../api/_lib/email.js";

let pass = 0, fail = 0;
const failures = [];
const t = (name, ok, detail) => {
  if (ok) pass++; else { fail++; failures.push(name); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

// ----------------------------------------------------------------- addresses
{
  t("a bare name is a person with no address", JSON.stringify(parsePerson("Bob")) === '{"name":"Bob"}');
  t("a bare address is both", JSON.stringify(parsePerson("bob@acme.com")) === '{"name":"bob@acme.com","email":"bob@acme.com"}');

  const angled = parsePerson("Priya Raman <priya@acme.com>");
  t("a named address keeps the name", angled.name === "Priya Raman", angled.name);
  t("and the address", angled.email === "priya@acme.com", angled.email);

  t("quotes around a name are dropped", parsePerson('"Priya" <p@a.com>').name === "Priya");
  // Malformed rather than dropped: somebody typing a broken address should see
  // their text preserved so they can fix it, not have it silently vanish.
  t("a broken address keeps the name", JSON.stringify(parsePerson("Bob <not-an-email>")) === '{"name":"Bob"}');
  t("nothing is nothing", parsePerson("   ") === null);

  const many = parsePeople("Bob, Priya Raman <priya@acme.com> and carl@x.io");
  t("commas and 'and' both split", many.length === 3, JSON.stringify(many));
  t("order is preserved", many[0].name === "Bob" && many[2].email === "carl@x.io");
  t("semicolons split too", parsePeople("a@x.com; b@x.com").length === 2);

  // The field has to round-trip, or editing a meeting quietly rewrites who is
  // coming to it.
  const round = formatPeople(parsePeople("Bob, Priya Raman <priya@acme.com>"));
  t("formatting round-trips", round === "Bob, Priya Raman <priya@acme.com>", round);
  t("a bare address does not become 'x <x>'", formatPeople([{ name: "b@x.com", email: "b@x.com" }]) === "b@x.com");
  t("legacy string attendees still format", formatPeople(["Bob"]) === "Bob");

  t("only addressable people are invitable", invitable(many).length === 2);
  t("garbage is not invitable", invitable([{ name: "Bob" }, null, "x"]).length === 0);

  t("an address needs a dot in the domain", looksLikeEmail("a@b") === false);
  t("and no spaces", looksLikeEmail("a b@c.com") === false);
}

// ----------------------------------------------------------------------- ics
{
  const ics = buildIcs({
    uid: "abc@squirrel",
    title: "Board call, Q3",           // the comma must be escaped
    start: new Date("2026-08-12T14:00:00Z"),
    end: new Date("2026-08-12T15:00:00Z"),
    description: "Numbers; then the raise",
    location: "https://meet.example.com/xyz",
    organizer: { name: "Logan", email: "logan@x.com" },
    attendees: [{ name: "Priya", email: "priya@acme.com" }],
  });

  t("it is a request, not a note", ics.includes("METHOD:REQUEST"));
  t("the uid is carried", ics.includes("UID:abc@squirrel"));
  // Without escaping, a comma in a title ends the property early and the whole
  // event is silently discarded by the receiving client.
  t("commas in the title are escaped", ics.includes("Board call\\, Q3"), ics.split("\n").find((l) => l.startsWith("SUMMARY")));
  t("semicolons are escaped", ics.includes("Numbers\\;"));
  t("the organiser is named", ics.includes("ORGANIZER;CN=Logan:mailto:logan@x.com"));

  // Read the way a mail client reads it: unfolded. An ATTENDEE line is long
  // enough to be split across two lines by the 75-octet rule, so asserting on
  // the raw text would be testing the folding rather than the content.
  const unfold = (s) => s.replace(/\r\n /g, "");
  const flat = unfold(ics);
  t("the attendee can rsvp", flat.includes("RSVP=TRUE") && flat.includes("mailto:priya@acme.com"),
    flat.split("\r\n").find((l) => l.startsWith("ATTENDEE")));
  t("times are utc stamps", ics.includes("DTSTART:20260812T140000Z"), ics.split("\n").find((l) => l.startsWith("DTSTART")));
  t("it is wrapped properly", ics.startsWith("BEGIN:VCALENDAR") && ics.trimEnd().endsWith("END:VCALENDAR"));
  t("lines are CRLF, as the spec requires", ics.includes("\r\n"));

  // RFC 5545 caps a line at 75 octets; a client that enforces it drops an
  // over-long line, which usually means losing the title.
  const long = buildIcs({
    uid: "x", title: "T".repeat(200),
    start: new Date("2026-08-12T14:00:00Z"), end: new Date("2026-08-12T15:00:00Z"),
  });
  t("long lines are folded", long.split("\r\n").every((l) => l.length <= 75),
    String(Math.max(...long.split("\r\n").map((l) => l.length))));
  t("folded lines continue with a space",
    long.split("\r\n").filter((l) => l.startsWith(" ")).length > 0);
}

// ---------------------------------------------------------------------- html
{
  // The note and the title come from user input and land in an email client,
  // which is exactly where an unescaped tag would be worth something.
  const html = inviteHtml({
    title: '<script>alert(1)</script>', whenText: "Wednesday", fromName: 'A & B',
  });
  t("titles are escaped", !html.includes("<script>"), html.slice(0, 120));
  t("ampersands are escaped", html.includes("A &amp; B"));
  t("a join button appears when there is a link",
    inviteHtml({ title: "x", whenText: "y", link: "https://z" }).includes("Join meeting"));
  t("and not when there is not", !inviteHtml({ title: "x", whenText: "y" }).includes("Join meeting"));
}

console.log(`\nEmail: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
