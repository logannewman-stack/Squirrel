import { asUser, requireUser, json } from "./_lib/db.js";

/** Current plan and this month's consumption, for the meter and paywall UI. */
export default async function handler(req, res) {
  const auth = await requireUser(req);
  if (!auth) return json(res, 401, { error: "unauthorized" });

  const db = asUser(auth.jwt);
  const period = new Date();
  period.setUTCDate(1);
  const periodKey = period.toISOString().slice(0, 10);

  const [{ data: profile }, { data: usage }, projects, tasks] = await Promise.all([
    db.from("profiles").select("plan,plan_renews_at,billing_status,billing_alert").eq("id", auth.user.id).maybeSingle(),
    db.from("usage_counters").select("assistant_chats").eq("period", periodKey).maybeSingle(),
    db.from("projects").select("id", { count: "exact", head: true }).eq("archived", false),
    db.from("tasks").select("id", { count: "exact", head: true }).eq("done", false),
  ]);

  // An expired subscription reads as free, matching current_plan() in SQL.
  const expired = profile?.plan_renews_at && new Date(profile.plan_renews_at) < new Date();
  return json(res, 200, {
    plan: expired ? "free" : (profile?.plan ?? "free"),
    renewsAt: profile?.plan_renews_at ?? null,
    billingStatus: profile?.billing_status ?? null,
    // Surfaced so a failing card is visible in the app rather than only in an
    // email the customer may not read until access has already gone.
    billingAlert: profile?.billing_alert ?? null,
    chatsUsed: usage?.assistant_chats ?? 0,
    projectCount: projects.count ?? 0,
    openTaskCount: tasks.count ?? 0,
  });
}
