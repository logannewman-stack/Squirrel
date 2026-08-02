import { setSetting, totals } from "../lib/store";
import Identity from "./Identity";
import { duration } from "../lib/format";

export default function Settings({ state, onBack }) {
  const t = totals(state.sessions);
  const confirms = state.settings?.confirm !== false;

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
        <h2 className="mb-2 font-medium">How I address you</h2>
        <p className="mb-4 text-sm text-[var(--muted)]">
          Used when the assistant greets you.
        </p>
        <Identity value={state.settings?.identity || {}} compact />
      </section>

      <section className="mb-10">
        <h2 className="mb-2 font-medium">Assistant</h2>
        <p className="mb-4 text-sm text-[var(--muted)]">
          It reads back every change before making it, so nothing lands on your calendar
          without you seeing it first. Turn this off and it acts straight away — faster,
          and you will occasionally correct it afterwards.
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={confirms}
          onClick={() => setSetting("confirm", !confirms)}
          className="flex w-full items-center justify-between rounded-md border border-[var(--line)]
                     px-4 py-3 text-left text-sm transition-colors hover:border-[var(--ink)]"
        >
          <span>Confirm before changing anything</span>
          <span
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
              confirms ? "bg-[var(--ink)]" : "bg-[var(--line)]"
            }`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-[var(--paper)] transition-all ${
                confirms ? "left-[18px]" : "left-0.5"
              }`}
            />
          </span>
        </button>
        <p className="mt-3 text-xs text-[var(--muted)]">
          The assistant runs entirely on this device. No account, no API key, no per-message
          cost — which is why every plan gets unlimited chats.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="mb-2 font-medium">Your data</h2>
        <p className="text-sm text-[var(--muted)]">
          {state.projects.length} projects · {state.tasks.length} tasks · {state.events.length} events · {t.count} sessions ·{" "}
          {duration(t.focusedMs)} focused.
        </p>
        <p className="mt-2 text-xs text-[var(--muted)]">
          All of it lives in this browser. Clearing site data erases it, and it does not sync
          between devices.
        </p>
        <button
          onClick={() => {
            if (confirm("Erase all projects, tasks, and sessions? This cannot be undone.")) {
              localStorage.removeItem("squirrel.v2");
              location.reload();
            }
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
