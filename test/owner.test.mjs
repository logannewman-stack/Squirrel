/**
 * The founder's console: who may read it, and what it says.
 *
 * Two things are worth pinning here, and neither is visual. The gate — an
 * allow-list, not "is signed in", which is the assumption that made an
 * unmetered endpoint spendable by strangers. And the shape of the roster,
 * because a wrong plan count is a wrong revenue number, and a revenue number
 * is the one thing on that screen somebody makes a decision from.
 */
import { isOwner, rosterFrom } from "../api/admin/users.js";
import { mrrOf } from "../src/lib/plans.js";

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

/* ------------------------------------------------------------------ the gate */
{
  const list = ["founder@squirrel.app", "second@squirrel.app"];
  t("an owner is let in", isOwner("founder@squirrel.app", list));
  t("  whatever case they typed", isOwner("Founder@Squirrel.APP", list));
  t("a customer is not", isOwner("someone@else.com", list) === false);
  t("a missing address is not", isOwner(null, list) === false && isOwner("", list) === false);
  /**
   * The default is nobody. A deployment that has not configured an owner has
   * not decided who may read its customer list, and guessing on its behalf —
   * first user, any signed-in user — is how a console becomes a leak.
   */
  t("nobody at all, when no allow-list is configured",
    isOwner("founder@squirrel.app", []) === false);
}

/* --------------------------------------------------------------- the roster */
{
  const profiles = [
    { id: "u1", email: "a@x.com", plan: "pro", created_at: "2026-08-01T00:00:00Z",
      stripe_subscription_id: "sub_1", billing_alert: null },
    { id: "u2", email: "b@x.com", plan: "free", created_at: "2026-08-10T00:00:00Z" },
    { id: "u3", email: "c@x.com", plan: "studio", created_at: "2026-07-01T00:00:00Z",
      stripe_subscription_id: "sub_3", billing_alert: "past_due" },
    { id: "u4", email: "d@x.com", plan: "free", created_at: "2026-01-01T00:00:00Z" },
  ];
  const counters = [
    { user_id: "u1", period: "2026-08-01", assistant_chats: 12, input_tokens: 5000, output_tokens: 900 },
    { user_id: "u3", period: "2026-08-01", assistant_chats: 40, input_tokens: 9000, output_tokens: 1100 },
    // Last month's row must not be counted as this month's usage.
    { user_id: "u2", period: "2026-07-01", assistant_chats: 99, input_tokens: 1, output_tokens: 1 },
  ];
  const { rows, summary } = rosterFrom(profiles, counters, "2026-08-01");

  t("every account appears", rows.length === 4, rows.length);
  t("paying accounts come first, best plan first",
    rows[0].plan === "studio" && rows[1].plan === "pro",
    rows.map((r) => r.plan).join(","));
  t("  and free accounts are ordered newest first",
    rows[2].email === "b@x.com" && rows[3].email === "d@x.com",
    rows.slice(2).map((r) => r.email).join(","));

  t("a subscription plus a paid plan is a paying customer",
    rows[0].paying === true && rows.find((r) => r.email === "b@x.com").paying === false);
  t("this month's usage is attached", rows[0].chats === 40 && rows[1].chats === 12);
  t("  and last month's is not", rows.find((r) => r.email === "b@x.com").chats === 0);

  t("the summary counts by plan",
    summary.byPlan.free === 2 && summary.byPlan.pro === 1 && summary.byPlan.studio === 1,
    JSON.stringify(summary.byPlan));
  t("  and how many pay", summary.paying === 2, summary.paying);
  t("a failing card is surfaced as needing attention",
    summary.needsAttention === 1, summary.needsAttention);
  t("the assistant's whole cost this month is totalled",
    summary.chats === 52 && summary.inputTokens === 14000 && summary.outputTokens === 2000,
    JSON.stringify(summary));

  /**
   * The privacy line, asserted rather than trusted: nothing a person wrote
   * may reach this screen. If a future field starts carrying titles or notes,
   * this test is what says so.
   */
  const leaked = JSON.stringify(rows).toLowerCase();
  t("no task, project, note or event content is ever in a row",
    !/title|task|project|note|event|meaning/.test(leaked), leaked.slice(0, 120));

  t("an empty deployment is an empty roster, not a crash",
    rosterFrom([], []).rows.length === 0 && rosterFrom().summary.total === 0);
}

/* ------------------------------------------------------------------- money */
{
  // Prices come from plans.js — the one place a price is written.
  t("revenue is the plans' own prices, not a second copy",
    mrrOf({ free: 10 }) === 0 && mrrOf({ pro: 2 }) === 49.98,
    mrrOf({ pro: 2 }));
  t("  an unknown tier contributes nothing rather than guessing",
    mrrOf({ enterprise: 5 }) === 0);
}

console.log(`\nOwner console: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
