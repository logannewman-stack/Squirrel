import { asService, requireUser, json } from "../_lib/db.js";

/**
 * Who is using this, and what are they paying?
 *
 * The one screen a founder actually needs and no customer may ever see. It
 * answers three questions — how many people signed up, which of them pay, and
 * how much the assistant is costing against that — from the account rows the
 * server already keeps.
 *
 * ## Two boundaries, both deliberate
 *
 * **Who may read it.** Not "whoever is signed in" — that premise is exactly
 * what made boost-check spendable by strangers. The caller's email must appear
 * in `OWNER_EMAILS`, a server-only allow-list. Unset means nobody qualifies and
 * the console does not exist, which is the right default for a deployment that
 * has not thought about it yet.
 *
 * **What it returns.** Account facts only: address, plan, when they joined,
 * billing state, and their own usage counters. Never a task title, a project
 * name, a note, or a calendar entry. Running the business needs to know that
 * someone is on Pro and has used 40 assists; it does not need to know what they
 * are working on, and an admin screen that shows it is a breach waiting for a
 * screenshot. The data is there under the service role — the restraint has to
 * be written down, so it is written down here.
 */

/** Who may look. Comma-separated, compared case-insensitively. */
const owners = () =>
  (process.env.OWNER_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export const isOwner = (email, list = owners()) =>
  Boolean(email && list.includes(String(email).toLowerCase()));

/** The month usage_counters is keyed by. */
const thisPeriod = (now = new Date()) =>
  `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;

/**
 * One roster row per account.
 *
 * Paid accounts first, then newest — the two orders a founder actually reads
 * this in. Everything is already scoped to the columns above; this only
 * arranges it.
 */
export function rosterFrom(profiles = [], counters = [], period = thisPeriod()) {
  const rank = { studio: 0, pro: 1, plus: 2, free: 3 };
  const usage = new Map(
    counters.filter((c) => c.period === period).map((c) => [c.user_id, c]),
  );

  const rows = profiles.map((p) => {
    const u = usage.get(p.id) || {};
    return {
      id: p.id,
      email: p.email || null,
      name: p.full_name || null,
      plan: p.plan || "free",
      joined: p.created_at || null,
      renewsAt: p.plan_renews_at || null,
      // "past_due" is the row worth chasing: a card that failed, not a
      // customer who left.
      billingStatus: p.billing_status || null,
      billingAlert: p.billing_alert || null,
      paying: Boolean(p.stripe_subscription_id) && (p.plan || "free") !== "free",
      chats: u.assistant_chats || 0,
      inputTokens: Number(u.input_tokens || 0),
      outputTokens: Number(u.output_tokens || 0),
    };
  });

  rows.sort((a, b) =>
    (rank[a.plan] ?? 9) - (rank[b.plan] ?? 9) ||
    String(b.joined || "").localeCompare(String(a.joined || "")));

  const byPlan = rows.reduce((acc, r) => ({ ...acc, [r.plan]: (acc[r.plan] || 0) + 1 }), {});
  const day = new Date(Date.now() - 30 * 86400000).toISOString();

  return {
    rows,
    summary: {
      total: rows.length,
      byPlan,
      paying: rows.filter((r) => r.paying).length,
      // Cards that need chasing before they become cancellations.
      needsAttention: rows.filter((r) => r.billingAlert).length,
      newThisMonth: rows.filter((r) => r.joined && r.joined >= day).length,
      chats: rows.reduce((n, r) => n + r.chats, 0),
      inputTokens: rows.reduce((n, r) => n + r.inputTokens, 0),
      outputTokens: rows.reduce((n, r) => n + r.outputTokens, 0),
    },
  };
}

export default async function handler(req, res) {
  const auth = await requireUser(req);
  if (!auth) return json(res, 401, { error: "unauthorized" });

  // No allow-list configured is not an invitation. Answered the same way as a
  // stranger, so an unconfigured deployment cannot be probed into telling
  // anybody that a console exists at all.
  if (!isOwner(auth.user.email)) return json(res, 403, { error: "not_owner" });

  const db = asService();
  const period = thisPeriod();

  const [{ data: profiles, error: pErr }, { data: counters, error: cErr }] = await Promise.all([
    db.from("profiles")
      .select("id,email,full_name,plan,created_at,plan_renews_at,billing_status,billing_alert,stripe_subscription_id")
      .order("created_at", { ascending: false })
      .limit(500),
    db.from("usage_counters").select("user_id,period,assistant_chats,input_tokens,output_tokens")
      .eq("period", period),
  ]);

  if (pErr || cErr) return json(res, 500, { error: "read_failed" });

  return json(res, 200, { period, ...rosterFrom(profiles || [], counters || [], period) });
}
