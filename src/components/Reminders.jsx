import { useEffect, useState } from "react";
import { setSetting } from "../lib/store";
import { backend, permission, requestPermission, scheduled, clear } from "../lib/notify";
import { DEFAULTS } from "../lib/reminders";

/**
 * Turning reminders on, and being honest about what they can do here.
 *
 * The permission prompt is behind a button rather than fired on load. A prompt
 * that appears before the app has proved anything gets denied, and on iOS a
 * denial is close to permanent — the only way back is Settings, which nobody
 * visits.
 */
const LEADS = [0, 5, 10, 15, 30];

const WHERE = {
  capacitor: "Reminders fire on your lock screen, with the app closed.",
  web: "Reminders fire while this browser is running. Install the app to your home screen for the rest.",
  none: "This browser cannot show reminders. They still appear inside the app.",
};

export default function Reminders({ state }) {
  const s = { ...DEFAULTS, ...(state.settings?.reminders || {}) };
  const [perm, setPerm] = useState(permission());
  const [count, setCount] = useState(scheduled().length);
  const be = backend();

  useEffect(() => {
    const id = setInterval(() => setCount(scheduled().length), 2000);
    return () => clearInterval(id);
  }, []);

  const set = (patch) => setSetting("reminders", { ...s, ...patch });

  async function enable() {
    setPerm(await requestPermission());
  }

  const Row = ({ k, label, hint }) => (
    <button
      type="button"
      role="switch"
      aria-checked={s[k]}
      onClick={() => set({ [k]: !s[k] })}
      className="flex w-full items-start justify-between gap-4 border-b border-[var(--line)] py-3 text-left"
    >
      <span>
        <span className="text-sm">{label}</span>
        <span className="mt-0.5 block text-xs text-[var(--muted)]">{hint}</span>
      </span>
      <span className={`relative mt-1 h-5 w-9 shrink-0 rounded-full transition-colors ${
        s[k] ? "bg-[var(--ink)]" : "bg-[var(--line)]"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-[var(--paper)] transition-all ${
          s[k] ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );

  return (
    <div>
      <p className="mb-4 text-sm text-[var(--muted)]">{WHERE[be]}</p>

      {perm !== "granted" && be !== "none" && (
        <button
          onClick={enable}
          className="mb-5 w-full rounded-md bg-[var(--ink)] py-2.5 text-sm font-medium text-[var(--paper)]"
        >
          {perm === "denied" ? "Reminders are blocked — allow them in system settings" : "Turn on reminders"}
        </button>
      )}

      <Row k="meetings" label="Before meetings" hint="Once, shortly before it starts." />
      <Row k="focus" label="When focus time starts" hint="For work you have set aside on the calendar." />
      <Row k="digest" label="Morning summary" hint="One notification for the whole day, instead of one each." />
      <Row
        k="deadlines"
        label="When something will not fit"
        hint="The work left no longer fits before its deadline. This is the one worth interrupting you for."
      />

      {s.meetings && (
        <div className="mt-5">
          <p className="label mb-2">Meeting warning</p>
          <div className="flex flex-wrap gap-1.5">
            {LEADS.map((m) => (
              <button
                key={m}
                onClick={() => set({ meetingLeadMins: m })}
                aria-pressed={s.meetingLeadMins === m}
                className={`rounded border px-3 py-1.5 text-xs transition-colors ${
                  s.meetingLeadMins === m
                    ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
                    : "border-[var(--line)] hover:border-[var(--ink)]"
                }`}
              >
                {m === 0 ? "At start" : `${m} min before`}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="mt-5 text-xs text-[var(--muted)]">
        {count} reminder{count === 1 ? "" : "s"} queued.{" "}
        {count > 0 && (
          <button onClick={() => { clear(); setCount(0); }} className="underline underline-offset-2">
            Clear
          </button>
        )}
      </p>
    </div>
  );
}
