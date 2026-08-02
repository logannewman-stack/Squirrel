/**
 * Meeting invites.
 *
 * Sends a real calendar invite: an .ics attachment with METHOD:REQUEST, which
 * Gmail and Outlook render with accept/decline buttons rather than as a plain
 * message. The meeting link is the user's own standing room, pasted once in
 * settings — minting a fresh Google Meet or Zoom link per meeting requires that
 * provider's OAuth and API, which is a separate integration.
 */

const ICS_LINE_LIMIT = 75;

/** RFC 5545: escape separators, then fold to 75 octets with a leading space. */
function icsLine(name, value) {
  const escaped = String(value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
  const full = `${name}:${escaped}`;
  if (full.length <= ICS_LINE_LIMIT) return full;
  const out = [full.slice(0, ICS_LINE_LIMIT)];
  let rest = full.slice(ICS_LINE_LIMIT);
  while (rest.length) {
    out.push(" " + rest.slice(0, ICS_LINE_LIMIT - 1));
    rest = rest.slice(ICS_LINE_LIMIT - 1);
  }
  return out.join("\r\n");
}

const stamp = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function buildIcs({ uid, title, start, end, description, location, organizer, attendees }) {
  const rows = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Squirrel//Planner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    icsLine("UID", uid),
    icsLine("DTSTAMP", stamp(new Date())),
    icsLine("DTSTART", stamp(start)),
    icsLine("DTEND", stamp(end)),
    icsLine("SUMMARY", title),
  ];
  if (description) rows.push(icsLine("DESCRIPTION", description));
  if (location) rows.push(icsLine("LOCATION", location));
  if (organizer?.email) {
    rows.push(icsLine(`ORGANIZER;CN=${organizer.name || organizer.email}`, `mailto:${organizer.email}`));
  }
  for (const a of attendees || []) {
    rows.push(
      icsLine(
        `ATTENDEE;CN=${a.name || a.email};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE`,
        `mailto:${a.email}`,
      ),
    );
  }
  rows.push("STATUS:CONFIRMED", "SEQUENCE:0", "END:VEVENT", "END:VCALENDAR");
  return rows.join("\r\n");
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function inviteHtml({ title, whenText, link, location, note, fromName }) {
  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#111">
  <p>${escapeHtml(fromName || "Your host")} has invited you to a meeting.</p>
  <p style="font-size:17px;font-weight:600;margin:18px 0 4px">${escapeHtml(title)}</p>
  <p style="margin:0 0 14px;color:#555">${escapeHtml(whenText)}</p>
  ${link ? `<p style="margin:0 0 14px"><a href="${escapeHtml(link)}" style="background:#000;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Join meeting</a></p>` : ""}
  ${location && !link ? `<p style="margin:0 0 14px;color:#555">${escapeHtml(location)}</p>` : ""}
  ${note ? `<p style="margin:14px 0;color:#333">${escapeHtml(note)}</p>` : ""}
  <p style="margin-top:24px;font-size:12px;color:#888">The calendar invite is attached.</p>
</div>`;
}

/**
 * @returns {{ok: boolean, id?: string, error?: string}}
 */
export async function sendInvite({ to, subject, html, ics, replyTo, fromName }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "email_not_configured" };

  const from = process.env.INVITE_FROM || "invites@squirrel.app";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: fromName ? `${fromName} <${from}>` : from,
      // Replies go to the actual organiser, not the sending domain.
      reply_to: replyTo || undefined,
      to,
      subject,
      html,
      attachments: [
        {
          filename: "invite.ics",
          content: Buffer.from(ics, "utf8").toString("base64"),
        },
      ],
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body?.message || `resend_${res.status}` };
  return { ok: true, id: body?.id };
}
