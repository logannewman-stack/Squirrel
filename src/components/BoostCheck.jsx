import { useState } from "react";
import { Button } from "./ui";
import { client } from "../lib/supabase";

/**
 * Proving the boost is alive.
 *
 * Everywhere else in this app, a failed boost is deliberately invisible: the
 * message falls back to the deterministic rules and the user is told she did
 * not catch that, which is the right thing to show somebody who asked a
 * question. The cost is that a key with a typo in it, a revoked key, or a model
 * name that was correct last year all look exactly like a working setup — and
 * stay looking that way forever, because nothing ever surfaces the error.
 *
 * So there is a button. It makes one real call and reports what actually came
 * back, including which model answered, because "is it configured" and "does it
 * work" are different questions and only the second one matters.
 */
export default function BoostCheck() {
  const [state, setState] = useState({ idle: true });

  async function run() {
    setState({ busy: true });
    try {
      // The endpoint spends money, so it takes the same authorisation the boost
      // itself does. Signed out there is no token to send, and it will say so
      // rather than appearing broken.
      const supabase = await client();
      const { data } = (await supabase?.auth.getSession()) ?? {};
      const token = data?.session?.access_token;

      const res = await fetch("/api/boost-check", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      });
      if (res.status === 401) {
        return setState({ result: { ok: false, detail: "Sign in first — this check runs against your account." } });
      }
      if (!res.ok) {
        return setState({ result: { ok: false, detail: `The check itself failed (${res.status}). This deployment may not have the API routes.` } });
      }
      setState({ result: await res.json() });
    } catch (e) {
      setState({ result: { ok: false, detail: `Couldn't reach the check: ${e.message}` } });
    }
  }

  const r = state.result;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" disabled={state.busy} onClick={run}>
          {state.busy ? "Checking…" : r ? "Check again" : "Test the boost"}
        </Button>
        {r && (
          <span className={`text-[13px] font-medium ${r.ok ? "" : "alert"}`}>
            {r.ok ? "Working" : r.configured === false ? "Not set up" : "Not working"}
          </span>
        )}
      </div>

      {r && (
        <>
          <p className="mt-2.5 max-w-prose text-[13px] leading-relaxed text-[var(--muted)]">{r.detail}</p>
          {/* The model and the round trip, because a tick this component drew
              itself is not evidence and a real answer is. */}
          {r.ok && (
            <p className="num mt-1.5 text-[12px] text-[var(--faint)]">
              {r.model} · answered in {r.ms} ms
            </p>
          )}
        </>
      )}

      {!r && !state.busy && (
        <p className="mt-2.5 max-w-prose text-[13px] leading-relaxed text-[var(--muted)]">
          Sends one short message and reports what comes back. Costs about a hundredth of a
          cent, and it's the only way to tell a working key from one with a typo in it.
        </p>
      )}
    </div>
  );
}
