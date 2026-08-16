import { useEffect, useState } from "react";
import { Button } from "./ui";
import { PLANS, mrrOf } from "../lib/plans";
import { client } from "../lib/supabase";
import { api } from "../lib/api";

/**
 * The founder's console: who signed up, who pays, what it costs to serve them.
 *
 * Rendered only for an account in the server's `OWNER_EMAILS` allow-list — and
 * "rendered only" is literal. A non-owner gets a 403 and this component
 * returns null, so the section never appears, never flickers, and never hints
 * that a console exists. The server is the boundary; this is only the window.
 *
 * It deliberately shows account facts and no content: an address, a plan, a
 * join date, a billing state, a usage count. Never what anybody is working
 * on. See api/admin/users.js — the restraint is enforced there, and repeated
 * here so it survives the next person to edit this file.
 */

const money = (n) =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(n % 1 ? 2 : 0)}`;

const when = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const days = Math.round((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString([], { month: "short", year: "numeric" });
};

export default function Owner() {
  const [state, setState] = useState({ loading: true });

  const load = async () => {
    setState({ loading: true });
    try {
      const supabase = await client();
      const { data } = (await supabase?.auth.getSession()) ?? {};
      const token = data?.session?.access_token;
      if (!token) return setState({ hidden: true });

      const res = await api("/api/admin/users", {
        headers: { authorization: `Bearer ${token}` },
      });
      // 403 (not an owner), 401 (signed out), 404 (no API): all the same
      // answer to this component — there is nothing here for you.
      if (!res.ok) return setState({ hidden: true });
      setState({ data: await res.json() });
    } catch {
      setState({ hidden: true });
    }
  };

  useEffect(() => { load(); }, []);

  if (state.hidden) return null;
  if (state.loading) return null;
  if (!state.data) return null;

  const { rows, summary } = state.data;
  const mrr = mrrOf(summary.byPlan);
  const tokens = summary.inputTokens + summary.outputTokens;

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--line)]
                      bg-[var(--line)] sm:grid-cols-4">
        <Stat label="People" value={summary.total} sub={`${summary.newThisMonth} in 30 days`} />
        <Stat label="Paying" value={summary.paying} sub={`of ${summary.total}`} />
        <Stat label="Monthly" value={money(mrr)} sub="recurring" />
        <Stat
          label="Assists"
          value={summary.chats}
          sub={tokens ? `${(tokens / 1000).toFixed(0)}k tokens` : "this month"}
        />
      </div>

      {summary.needsAttention > 0 && (
        <p className="alert mb-3 text-xs">
          {summary.needsAttention === 1
            ? "1 subscription needs attention — a card is failing, not a customer leaving."
            : `${summary.needsAttention} subscriptions need attention — cards failing, not customers leaving.`}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-[var(--line)]">
        <table className="w-full min-w-[34rem] text-left text-xs">
          <thead className="border-b border-[var(--line)] text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2 font-medium">Person</th>
              <th className="px-3 py-2 font-medium">Plan</th>
              <th className="px-3 py-2 font-medium">Joined</th>
              <th className="px-3 py-2 text-right font-medium">Assists</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-[var(--muted)]">
                  Nobody has signed up yet. You'll see them here the moment they do.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-[var(--hairline)] last:border-0">
                <td className="px-3 py-2">
                  <span className="block truncate">{r.email || "—"}</span>
                  {r.name && <span className="block truncate text-[var(--faint)]">{r.name}</span>}
                </td>
                <td className="px-3 py-2">
                  <span className={r.paying ? "font-medium" : "text-[var(--muted)]"}>
                    {PLANS[r.plan]?.name || r.plan}
                  </span>
                  {r.billingAlert && (
                    <span className="alert block text-[10px]">{r.billingAlert.replace(/_/g, " ")}</span>
                  )}
                </td>
                <td className="num px-3 py-2 text-[var(--muted)]">{when(r.joined)}</td>
                <td className="num px-3 py-2 text-right text-[var(--muted)]">{r.chats || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-[11px] text-[var(--faint)]">
          Accounts and billing only — never anybody's tasks, projects, or calendar.
        </p>
        <Button variant="ghost" size="sm" onClick={load}>Refresh</Button>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="bg-[var(--paper)] px-4 py-3">
      <p className="label">{label}</p>
      <p className="num mt-1 text-lg font-semibold">{value}</p>
      <p className="mt-0.5 text-[11px] text-[var(--faint)]">{sub}</p>
    </div>
  );
}
