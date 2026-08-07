import { setSetting, totals, resetAll } from "../lib/store";
import Identity from "./Identity";
import Account from "./Account";
import Reminders from "./Reminders";
import WorkingHours from "./WorkingHours";
import VoiceSettings from "./VoiceSettings";
import Misses from "./Misses";
import Billing from "./Billing";
import { configured as canSync } from "../lib/supabase";
import { duration } from "../lib/format";

export default function Settings({ state, onBack }) {
  const t = totals(state.sessions);
  const confirms = state.settings?.confirm !== false;
  // Off unless explicitly turned on. It is the only setting in the app that
  // can cost money, so the default has to be the free one.
  const fallback = state.settings?.fallback === true;

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <button
        onClick={onBack}
        className="text-sm text-[var(--muted)] underline-offset-4 hover:underline"
      >
        ← Back
      </button>

      <h1 className="mb-8 mt-4 text-3xl font-semibold tracking-tight">Settings</h1>

      <section className="mb-10">
        <h2 className="mb-2 font-medium">Account</h2>
        <Account email={state.settings?.email || null} />
      </section>

      {canSync && (
        <section className="mb-10">
          <h2 className="mb-2 font-medium">Plan</h2>
          <p className="mb-4 max-w-prose text-sm text-[var(--muted)]">
            Billed monthly, cancel any time. The free tier is not a trial — it keeps working.
          </p>
          <Billing email={state.settings?.email || null} />
        </section>
      )}

      <section className="mb-10">
        <h2 className="mb-2 font-medium">How I address you</h2>
        <p className="mb-4 text-sm text-[var(--muted)]">
          Used when the assistant greets you.
        </p>
        <Identity value={state.settings?.identity || {}} compact />
      </section>

      <section className="mb-10">
        <h2 className="mb-2 font-medium">Your working day</h2>
        <p className="mb-5 max-w-prose text-sm text-[var(--muted)]">
          Every deadline calculation in the app is measured against this — whether work fits,
          how thinly a project has to be spread, what counts as urgent.
        </p>
        <WorkingHours state={state} />
      </section>

      <section className="mb-10">
        <h2 className="mb-2 font-medium">Assistant</h2>
        <p className="mb-4 text-sm text-[var(--muted)]">
          It reads back every change before making it, so nothing lands on your calendar
          without you seeing it first. Turn this off and it acts straight away — faster,
          and you will occasionally correct it afterwards.
        </p>
        <Toggle
          label="Confirm before changing anything"
          on={confirms}
          onChange={() => setSetting("confirm", !confirms)}
        />
        <p className="mt-3 text-xs text-[var(--muted)]">
          The assistant runs entirely on this device. No account, no API key, no per-message
          cost — which is why every plan gets unlimited chats.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="mb-2 font-medium">What she missed</h2>
        <p className="mb-4 max-w-prose text-sm text-[var(--muted)]">
          Every message she couldn't act on, kept here so the gaps are a list rather than a
          feeling. Where you rephrased something and it worked, the phrasing that worked is
          saved next to the one that didn't — which is exactly what's needed to teach her.
        </p>
        <Misses />
      </section>

      {canSync && (
        <section className="mb-10">
          <h2 className="mb-2 font-medium">Fallback</h2>
          <p className="mb-4 max-w-prose text-sm text-[var(--muted)]">
            When she can't parse something, send just that message to a language model, have it
            reword the request, and run the reworded version through the ordinary path — same
            confirmation, same undo. Messages she already understands never leave the device, so
            this only ever costs anything on the ones she gets stuck on.
          </p>
          <Toggle
            label="Ask a model when she gets stuck"
            on={fallback}
            onChange={() => setSetting("fallback", !fallback)}
          />
          <p className="mt-3 max-w-prose text-xs text-[var(--muted)]">
            Needs an account and a server with a key configured; without one this stays off by
            itself and she answers exactly as she does now. When it is on, the message and a
            short summary of your next ten events and tasks are sent — nothing else.
          </p>
        </section>
      )}

      <section className="mb-10">
        <h2 className="mb-2 font-medium">Voice</h2>
        <p className="mb-4 max-w-prose text-sm text-[var(--muted)]">
          Talk to her, and have her talk back.
        </p>
        <VoiceSettings state={state} />
      </section>

      <section className="mb-10">
        <h2 className="mb-2 font-medium">Reminders</h2>
        <Reminders state={state} />
      </section>

      <section className="mb-10">
        <h2 className="mb-2 font-medium">Your data</h2>
        <p className="text-sm text-[var(--muted)]">
          {state.projects.length} projects · {state.tasks.length} tasks · {state.events.length} events · {t.count} sessions ·{" "}
          {duration(t.focusedMs)} focused.
        </p>
        <p className="mt-2 text-xs text-[var(--muted)]">
          {state.settings?.email
            ? "Synced to your account, and kept on this device so it works offline."
            : "All of it lives in this browser. Clearing site data erases it, and it does not sync between devices."}
        </p>
        <button
          onClick={() => {
            if (confirm("Erase all projects, tasks, and sessions? This cannot be undone.")) resetAll();
          }}
          className="mt-4 rounded-full border border-[var(--line)] px-5 py-2 text-sm
                     transition-colors hover:border-[var(--ink)]"
        >
          Erase everything
        </button>
      </section>
    </div>
  );
}

/** One switch. Two of these had drifted apart by a pixel before it was extracted. */
function Toggle({ label, on, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onChange}
      className="flex w-full items-center justify-between rounded-md border border-[var(--line)]
                 px-4 py-3 text-left text-sm transition-colors hover:border-[var(--ink)]"
    >
      <span>{label}</span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          on ? "bg-[var(--ink)]" : "bg-[var(--line)]"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-[var(--paper)] transition-all ${
            on ? "left-[18px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
