import { asService, requireUser, json } from "../_lib/db.js";
import { buildIcs, inviteHtml, sendInvite } from "../_lib/email.js";

/**
 * Send a real meeting invitation.
 *
 * The .ics builder and the Resend call have existed since the beginning and
 * nothing ever called them, so the app could record who was coming to a meeting
 * and never tell any of them. This is the endpoint that closes that.
 *
 * A real invite, not a notification: METHOD:REQUEST with the event attached, so
 * Gmail and Outlook show accept and decline rather than a message about a
 * meeting. Replies go to the organiser rather than to the sending domain,
 * because "can we move this?" should reach a person.
 *
 * ## Why this is guarded the way it is
 *
 * An endpoint that sends mail on request, to addresses supplied in the request,
 * is a spam relay unless it is scoped. So: the caller must be signed in, the
 * event must be theirs, and the recipients come from the stored event rather
 * than from the request body. The client says *which meeting*, never *which
 * addresses*.
 */

/** More than this in one meeting is a mailing list, not a meeting. */
const MAX_RECIPIENTS = 25;

const EMAIL = /^[^\s<>,;:"']+@[^\s<>,;:"']+\.[^\s<>,;:"']+$/;

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });

  const auth = await requireUser(req);
  if (!auth) return json(res, 401, { error: "unauthorized" });

  const { eventId, note } = req.body || {};
  if (!eventId) return json(res, 400, { error: "no_event" });

  const db = asService();
  // Scoped to the caller. Service role bypasses row security, so this equality
  // is the only thing between a guessed id and someone else's meeting.
  const { data: event } = await db
    .from("events").select("*").eq("id", eventId).eq("user_id", auth.user.id).maybeSingle();
  if (!event) return json(res, 404, { error: "not_found" });

  const { data: profile } = await db
    .from("profiles").select("email, full_name").eq("id", auth.user.id).maybeSingle();

  // Recipients come from the stored event, never from the request.
  const attendees = (event.attendees || [])
    .map((a) => (typeof a === "string" ? { name: a } : a))
    .filter((a) => a?.email && EMAIL.test(a.email));

  if (!attendees.length) return json(res, 400, { error: "no_addresses" });
  if (attendees.length > MAX_RECIPIENTS) return json(res, 400, { error: "too_many_recipients" });

  const organiser = {
    name: profile?.full_name || profile?.email || auth.user.email,
    email: profile?.email || auth.user.email,
  };

  const start = new Date(event.starts_at);
  const end = new Date(event.ends_at);
  const whenText = start.toLocaleString([], {
    weekday: "long", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });

  const ics = buildIcs({
    // Stable across resends: the same meeting must update in the recipient's
    // calendar rather than appearing a second time.
    uid: `${event.id}@squirrel`,
    title: event.title,
    start,
    end,
    description: event.notes || "",
    location: event.location || "",
    organizer: organiser,
    attendees,
  });

  const sent = await sendInvite({
    to: attendees.map((a) => a.email),
    subject: `Invitation: ${event.title} — ${whenText}`,
    html: inviteHtml({
      title: event.title,
      whenText,
      link: /^https?:\/\//i.test(event.location || "") ? event.location : "",
      location: event.location || "",
      note: note ? String(note).slice(0, 500) : "",
      fromName: organiser.name,
    }),
    ics,
    replyTo: organiser.email,
    fromName: organiser.name,
  });

  if (!sent.ok) {
    return json(res, sent.error === "email_not_configured" ? 501 : 502, { error: sent.error });
  }

  // A record of who was told, so "did they get it?" has an answer that is not a
  // guess. One row per send rather than per recipient, matching the schema.
  // Best effort: a logging failure must not read as a failure to send, because
  // the mail has already gone.
  await db.from("invite_log").insert({
    user_id: auth.user.id,
    event_id: event.id,
    recipients: attendees.map((a) => ({ name: a.name ?? null, email: a.email })),
    subject: `Invitation: ${event.title}`,
    provider_id: sent.id ?? null,
    status: "sent",
  }).then(() => {}, () => {});

  return json(res, 200, { sent: attendees.length, id: sent.id });
}
