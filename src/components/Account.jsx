import { useEffect, useState } from "react";
import { client, configured } from "../lib/supabase";
import { syncNow, syncStatus, onSyncChange, resetCursor } from "../lib/sync";

/**
 * Signing in, and what it is for.
 *
 * An account is optional on purpose. Everything works signed out — that is the
 * free tier, not a degraded mode — so this screen has to say what signing in
 * buys rather than demand it. Nobody hands over an email to a planner that has
 * not yet proved it can plan.
 */
export default function Account({ email: current }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(syncStatus());

  useEffect(() => onSyncChange(setStatus), []);

  if (!configured) {
    return (
      <p className="text-sm text-[var(--muted)]">
        Sync is not set up on this build. Your data lives in this browser only.
      </p>
    );
  }

  async function signIn(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // A magic link rather than a password: one fewer secret for the user to
    // manage, one fewer thing for us to store, and no password reset flow.
    const supabase = await client();
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: location.origin },
    });
    setBusy(false);
    if (err) setError(err.message);
    else setSent(true);
  }

  async function signOut() {
    const supabase = await client();
    await supabase.auth.signOut();
    // The next account on this device must not inherit this one's cursor, or
    // it would skip everything that changed before it signed in.
    resetCursor();
  }

  if (current) {
    const line = {
      syncing: "Syncing…",
      idle: status.at ? `Synced ${new Date(status.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Ready",
      offline: "Offline — changes will sync when you reconnect",
      error: `Sync problem: ${status.error}`,
      off: "",
    }[status.state];

    return (
      <div>
        <p className="text-sm">{current}</p>
        <p className="mt-1 text-xs text-[var(--muted)]">{line}</p>
        <div className="mt-4 flex gap-2">
          <button
            onClick={syncNow}
            className="rounded-md border border-[var(--line)] px-4 py-2 text-xs transition-colors hover:border-[var(--ink)]"
          >
            Sync now
          </button>
          <button onClick={signOut} className="px-3 py-2 text-xs text-[var(--muted)] hover:text-[var(--ink)]">
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (sent) {
    return (
      <p className="rounded-md border border-[var(--line)] px-4 py-3 text-sm">
        Check {email} — the link signs you in and brings this device's data with it.
      </p>
    );
  }

  return (
    <form onSubmit={signIn}>
      <p className="mb-4 text-sm text-[var(--muted)]">
        Everything works without an account. Sign in to keep your calendar on your
        phone and your laptop at once, and so it survives this browser.
      </p>
      <div className="flex gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="flex-1 rounded-md border border-[var(--line)] bg-transparent px-3.5 py-2
                     text-sm outline-none placeholder:text-[var(--faint)] focus:border-[var(--ink)]"
        />
        <button
          disabled={busy || !email.trim()}
          className="rounded-md bg-[var(--ink)] px-5 py-2 text-sm font-medium text-[var(--paper)]
                     transition-opacity disabled:opacity-30"
        >
          {busy ? "…" : "Send link"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-[var(--muted)]">{error}</p>}
    </form>
  );
}
