import { useEffect, useState } from "react";
import { Button } from "./ui";

/**
 * What this deployment has configured, read from the server.
 *
 * Setting up four services means twenty variables typed across four
 * dashboards, and a missed one does not announce itself — it becomes a button
 * that silently does nothing, weeks later, for one customer. This is the
 * checklist that answers itself.
 *
 * It reports only whether a variable is set, never any part of a value; see
 * api/setup-check.js.
 */
export default function SetupCheck() {
  const [state, setState] = useState({ loading: true });

  const load = () => {
    setState({ loading: true });
    fetch("/api/setup-check")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => setState({ data }))
      // No endpoint at all means the API is not deployed — which is itself the
      // answer, and a more useful one than a spinner that never stops.
      .catch(() => setState({ error: "No API on this deployment yet." }));
  };

  useEffect(load, []);

  if (state.loading) return <p className="text-sm text-[var(--muted)]">Checking…</p>;
  if (state.error) return <p className="text-sm text-[var(--muted)]">{state.error}</p>;

  const { groups, warnings, canTakeMoney } = state.data;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
          canTakeMoney
            ? "bg-[var(--ink)] text-[var(--paper)]"
            : "border border-[var(--line)] text-[var(--muted)]"
        }`}>
          {canTakeMoney ? "Ready to take payments" : "Not taking payments yet"}
        </span>
        <Button variant="ghost" size="sm" onClick={load}>Re-check</Button>
      </div>

      <ul className="flex flex-col gap-2">
        {groups.map((g) => (
          <li key={g.id} className="card px-4 py-3">
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className={`mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                  g.ready
                    ? "bg-[var(--ink)] text-[var(--paper)]"
                    : g.required
                      ? "bg-[var(--alert)] text-[var(--paper)]"
                      : "border border-[var(--line)] text-[var(--faint)]"
                }`}
              >
                {g.ready ? "✓" : g.required ? "!" : ""}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {g.name}
                  {!g.ready && g.required && (
                    <span className="ml-2 text-xs font-semibold text-[var(--alert)]">required</span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">{g.unlocks}</p>
                {g.missing.length > 0 && (
                  <p className="mt-1.5 text-xs text-[var(--muted)]">
                    Missing:{" "}
                    {g.missing.map((m) => (
                      <code key={m} className="mr-1 rounded bg-[var(--sunken)] px-1.5 py-0.5 text-[11px]">
                        {m}
                      </code>
                    ))}
                  </p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {warnings.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1.5">
          {warnings.map((w) => (
            <li key={w} className="text-xs text-[var(--alert)]">{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
