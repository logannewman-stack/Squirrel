import { useState, useSyncExternalStore } from "react";
import { client, configured } from "../lib/supabase";
import { subscribe, getState } from "../lib/store";
import Squirrel from "./Squirrel";

/**
 * Signing in, asked at the only moment it is reasonable to ask.
 *
 * An account is optional in this app on purpose — everything works signed out,
 * and that is the free tier rather than a degraded mode. Which makes the
 * timing of this question the entire design problem. Asked at the door, as
 * almost every app asks it, it is a stranger demanding a toll before showing
 * anybody the thing. Asked here, one step after she has booked something real,
 * it is a different question: *you have a week started — where should it live?*
 *
 * So it names what is actually at stake, in their numbers, and the way out is
 * a plain word rather than a greyed link. Somebody who declines has lost
 * nothing: the data is already saved on the device, and Settings will ask
 * again the day they get a second device.
 */
export default function JoinUp({ onDone }) {
  const state = useSyncExternalStore(subscribe, getState);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  const events = state.events.length;
  const tasks = state.tasks.filter((t) => !t.done).length;
  const started = events + tasks > 0;

  async function send(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // A link rather than a password: one fewer secret for them to manage, one
      // fewer for us to hold, and no reset flow to build or to get wrong.
      const supabase = await client();
      const { error: err } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: location.origin },
      });
      if (err) throw new Error(err.message);
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Nothing to offer on a build with no backend, and a sign-in box that cannot
  // sign anybody in is worse than no step at all.
  if (!configured) {
    return (
      <div className="sq-step">
        <p className="label">You're set up</p>
        <h2 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.025em]">
          {started ? "Go and use it." : "That's everything."}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
          She's one tap away on every screen — the squirrel in the bar. Say what
          changed and she does the rest.
        </p>
        <Done onClick={onDone} />
      </div>
    );
  }

  if (sent) {
    return (
      <div className="sq-step">
        <div className="flex items-center gap-3">
          <Squirrel size={40} title="Squirrel" />
          <div>
            <p className="label">Sent</p>
            <h2 className="mt-1 text-[22px] font-semibold leading-tight tracking-[-0.025em]">
              Check {email}.
            </h2>
          </div>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-[var(--muted)]">
          The link signs you in and brings this device's data with it — nothing
          you just made is lost. You can open the link later; go and use the app
          in the meantime.
        </p>
        <Done onClick={onDone} label="Open Squirrel" />
      </div>
    );
  }

  return (
    <div className="sq-step">
      <p className="label">One last thing, and it's optional</p>
      <h2 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.025em]">
        {started ? "Keep what you just made." : "Keep it across your devices."}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
        {started ? (
          <>
            Right now{" "}
            <span className="font-medium text-[var(--ink)]">{sayHave(events, tasks)}</span>{" "}
            {events + tasks === 1 ? "lives" : "live"} in this browser and nowhere else. Sign
            in and it follows you to your phone, and survives clearing your history.
          </>
        ) : (
          <>
            Everything works without an account. Sign in and your calendar is on
            your phone and your laptop at once, instead of only here.
          </>
        )}
      </p>

      <form onSubmit={send} className="mt-6 flex gap-2">
        <input
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-transparent px-3.5 py-2.5
                     text-sm outline-none placeholder:text-[var(--faint)] focus:border-[var(--ink)]"
        />
        <button
          disabled={busy || !email.trim()}
          className="shrink-0 rounded-lg bg-[var(--ink)] px-5 py-2.5 text-sm font-medium
                     text-[var(--paper)] transition-opacity hover:opacity-90 disabled:opacity-30"
        >
          {busy ? "Sending…" : "Send link"}
        </button>
      </form>

      {error && <p className="mt-2 text-xs text-[var(--alert)]">{error}</p>}

      <p className="mt-3 text-xs leading-relaxed text-[var(--faint)]">
        No password to invent. We email a link that signs you in.
      </p>

      {/* A real button, not a greyed-out apology. Declining is a legitimate
          answer here and the interface should not sulk about it. */}
      <button
        type="button"
        onClick={onDone}
        className="mt-6 w-full rounded-lg border border-[var(--line)] py-3 text-sm font-medium
                   transition-colors hover:border-[var(--ink)]"
      >
        Not now — open Squirrel
      </button>
    </div>
  );
}

const Done = ({ onClick, label = "Open Squirrel" }) => (
  <button
    onClick={onClick}
    className="mt-7 w-full rounded-lg bg-[var(--ink)] py-3 text-sm font-medium
               text-[var(--paper)] transition-opacity hover:opacity-90"
  >
    {label}
  </button>
);

/** What is at stake, counted the way a person would say it. */
function sayHave(events, tasks) {
  const parts = [];
  if (events) parts.push(`${events} ${events === 1 ? "meeting" : "meetings"}`);
  if (tasks) parts.push(`${tasks} ${tasks === 1 ? "task" : "tasks"}`);
  return parts.join(" and ");
}
