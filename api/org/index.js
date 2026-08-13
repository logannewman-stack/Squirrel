import { asService, requireUser, json } from "../_lib/db.js";

/**
 * A company, its seats, and the people in them.
 *
 * One endpoint for the whole lifecycle because the operations are small and
 * share every guard: is this person signed in, do they administer this
 * company, and is there a seat for what they are about to do.
 *
 *   GET                      → the company this account belongs to, or null
 *   POST { name }            → found one, and become its first administrator
 *   POST { invite: email }   → invite somebody to a seat
 *   POST { revoke: id }      → withdraw an invitation
 *   POST { remove: userId }  → take a seat back
 *   POST { accept: token }   → take up an invitation addressed to you
 *
 * Everything reads and writes through the service role, so the answers do not
 * depend on RLS being right — but RLS is right, and is tested, which means a
 * bug here fails closed rather than open. The checks below are the ones that
 * actually decide.
 */

/** Seats in use, and the invitations still outstanding against them. */
async function seatsUsed(db, orgId) {
  const [{ count: members }, { count: pending }] = await Promise.all([
    db.from("org_members").select("user_id", { count: "exact", head: true }).eq("org_id", orgId),
    db.from("org_invites").select("id", { count: "exact", head: true })
      .eq("org_id", orgId).is("accepted_at", null).is("revoked_at", null),
  ]);
  return { members: members || 0, pending: pending || 0, taken: (members || 0) + (pending || 0) };
}

/** The caller's company and role, or null. */
async function orgOf(db, userId) {
  const { data } = await db
    .from("org_members")
    .select("role, org_id, organizations(id,name,plan,seats,plan_renews_at,billing_status,billing_alert)")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data?.organizations) return null;
  return { role: data.role, org: data.organizations };
}

export default async function handler(req, res) {
  const auth = await requireUser(req);
  if (!auth) return json(res, 401, { error: "unauthorized" });

  const db = asService();
  const me = auth.user.id;
  const myEmail = (auth.user.email || "").toLowerCase();

  /* ------------------------------------------------------------------ read */
  if (req.method === "GET") {
    const mine = await orgOf(db, me);
    // An invitation waiting for this address is worth returning even to
    // somebody with no company yet — it is the whole of their next step.
    const { data: invites } = await db
      .from("org_invites")
      .select("id, role, created_at, organizations(name)")
      .ilike("email", myEmail)
      .is("accepted_at", null).is("revoked_at", null);

    if (!mine) return json(res, 200, { org: null, invites: invites || [] });

    const seats = await seatsUsed(db, mine.org.id);
    const body = { org: mine.org, role: mine.role, seats, invites: invites || [] };
    if (mine.role !== "admin") return json(res, 200, body);

    // Administrators get the roster: who holds a seat, and who has been asked.
    const { data: rows } = await db
      .from("org_members")
      .select("user_id, role, joined_at, profiles(email, full_name)")
      .eq("org_id", mine.org.id);
    const { data: outstanding } = await db
      .from("org_invites")
      .select("id, email, role, created_at")
      .eq("org_id", mine.org.id).is("accepted_at", null).is("revoked_at", null);

    return json(res, 200, {
      ...body,
      members: (rows || []).map((r) => ({
        userId: r.user_id, role: r.role, joinedAt: r.joined_at,
        email: r.profiles?.email || null, name: r.profiles?.full_name || null,
      })),
      pending: outstanding || [],
    });
  }

  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });
  const body = req.body || {};

  /* --------------------------------------------------------------- accept */
  // Deliberately first: accepting is the one action taken by somebody who is
  // not yet a member of anything, so it must not sit behind an admin check.
  if (body.accept) {
    const { data: invite } = await db
      .from("org_invites")
      .select("id, org_id, role, email")
      .eq("id", body.accept)
      .is("accepted_at", null).is("revoked_at", null)
      .maybeSingle();
    // Addressed to somebody else is the same answer as does-not-exist — an
    // invitation id should not confirm which company invited whom.
    if (!invite || invite.email.toLowerCase() !== myEmail) {
      return json(res, 404, { error: "no_invitation" });
    }

    const { error } = await db.from("org_members")
      .insert({ org_id: invite.org_id, user_id: me, role: invite.role });
    // The seat trigger raises when the company has run out; that is a real
    // answer for the person, not a server fault.
    if (error) return json(res, 409, { error: "no_seats" });

    await db.from("org_invites")
      .update({ accepted_at: new Date().toISOString() }).eq("id", invite.id);
    return json(res, 200, { joined: true });
  }

  /* ----------------------------------------------------------- found one */
  if (body.name) {
    if (await orgOf(db, me)) return json(res, 409, { error: "already_in_a_company" });

    const { data: org, error } = await db
      .from("organizations")
      .insert({ name: String(body.name).trim().slice(0, 80) || "My company" })
      .select("id,name,plan,seats")
      .single();
    if (error) return json(res, 500, { error: "create_failed" });

    // The founder is its first administrator. A seat is granted alongside,
    // because a company of nobody cannot be administered — and the seat
    // trigger would otherwise refuse the very first insert, seats being zero.
    await db.from("organizations").update({ seats: 1 }).eq("id", org.id);
    await db.from("org_members").insert({ org_id: org.id, user_id: me, role: "admin" });
    return json(res, 200, { org: { ...org, seats: 1 }, role: "admin" });
  }

  /* -------------------------------------------------- everything else: admin */
  const mine = await orgOf(db, me);
  if (!mine || mine.role !== "admin") return json(res, 403, { error: "not_an_admin" });
  const orgId = mine.org.id;

  if (body.invite) {
    const email = String(body.invite).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: "bad_email" });

    // Seats are checked against members *and* invitations outstanding, or a
    // company with one seat could invite fifty people and disappoint
    // forty-nine of them at the moment they clicked.
    const seats = await seatsUsed(db, orgId);
    if (seats.taken >= (mine.org.seats || 0)) return json(res, 409, { error: "no_seats" });

    const { data: invite, error } = await db
      .from("org_invites")
      .insert({ org_id: orgId, email, invited_by: me, role: body.role === "admin" ? "admin" : "member" })
      .select("id, email, role, created_at")
      .single();
    // The partial unique index refuses a second live invitation to the same
    // address, which is a state rather than a failure.
    if (error) return json(res, 409, { error: "already_invited" });
    return json(res, 200, { invite });
  }

  if (body.revoke) {
    await db.from("org_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", body.revoke).eq("org_id", orgId);
    return json(res, 200, { revoked: true });
  }

  if (body.remove) {
    // An administrator cannot remove themselves while they are the last one;
    // a company with no administrator can never buy a seat or invite anybody
    // again, and nothing in the product could put it right.
    if (body.remove === me) {
      const { count } = await db.from("org_members")
        .select("user_id", { count: "exact", head: true })
        .eq("org_id", orgId).eq("role", "admin");
      if ((count || 0) <= 1) return json(res, 409, { error: "last_admin" });
    }
    await db.from("org_members").delete().eq("org_id", orgId).eq("user_id", body.remove);
    // The person keeps everything they wrote. Losing a seat ends the company's
    // plan for them, not their account — they fall back to whatever they hold
    // personally, which is what current_plan already answers.
    return json(res, 200, { removed: true });
  }

  return json(res, 400, { error: "nothing_to_do" });
}
