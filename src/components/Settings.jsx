import { useState } from "react";
import { setSetting, totals } from "../lib/store";
import { duration } from "../lib/format";

export default function Settings({ state, onBack }) {
  const [key, setKey] = useState(state.settings.apiKey || "");
  const t = totals(state.sessions);

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
        <h2 className="mb-2 font-medium">Assistant</h2>
        <p className="mb-4 text-sm text-[var(--muted)]">
          Required for the assistant. Planning also works without one — rules order the
          day by deadline, priority, and what fits between meetings. A key adds the
          conversational layer that can read your calendar and act on it.
        </p>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onBlur={() => setSetting("apiKey", key.trim())}
          placeholder="sk-ant-…"
          className="w-full border-b-2 border-[var(--line)] bg-transparent pb-2 font-mono text-sm
                     outline-none transition-colors placeholder:text-[var(--muted)]
                     focus:border-[var(--ink)]"
        />
        <p className="mt-3 text-xs text-[var(--muted)]">
          Stored in this browser only and sent straight to Anthropic — Squirrel has no server
          to hold it. That is fine for a personal tool on your own machine. Don't paste a key
          you also use in production, and don't use this on a shared computer.
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
