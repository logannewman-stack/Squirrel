import { useState } from "react";
import { setSetting, totals, resetAll } from "../lib/store";
import Identity from "./Identity";
import Account from "./Account";
import Reminders from "./Reminders";
import WorkingHours from "./WorkingHours";
import VoiceSettings from "./VoiceSettings";
import Misses from "./Misses";
import Billing from "./Billing";
import Usage from "./Usage";
import Calendars from "./Calendars";
import SetupCheck from "./SetupCheck";
import DeleteAccount from "./DeleteAccount";
import Appearance from "./Appearance";
import { configured as canSync } from "../lib/supabase";
import { duration } from "../lib/format";

/**
 * Settings, in five places rather than one.
 *
 * This was thirteen sections stacked in a single column — three and a half
 * screens of scroll, every heading the same size and weight, with the plan
 * next to the honorific next to the deployment diagnostics. Nothing was hard
 * to find because it was hidden; it was hard to find because everything was
 * equally present, which is the same problem wearing a different coat. People
 * hit a wall on Tuesday, scrolled, gave up, and never came back.
 *
 * Grouped by the question being asked instead: who you are, how she behaves,
 * what she is connected to, what it costs, what happens to the data. Five
 * answers, none of them more than a screen. The rail is a rail on a desktop
 * and a scrolling row of chips on a phone, and the group is component state
 * rather than a route because a settings tab is not a place you should be able
 * to land on from the outside or reach with a back button.
 */

const GROUPS = [
  { id: "account", name: "Account", blurb: "Signing in, your plan, and what you're using of it." },
  { id: "you", name: "You", blurb: "Your name, your working day, and how the app looks." },
  { id: "assistant", name: "Assistant", blurb: "How she behaves, how she sounds, and what she missed." },
  { id: "connections", name: "Connections", blurb: "Calendars and reminders." },
  { id: "data", name: "Data", blurb: "What's stored, what this build has configured, and the legal pages." },
];

/** One setting, with its heading and its explanation, on its own card. */
function Panel({ title, note, children }) {
  return (
    <section className="card px-5 py-5 sm:px-6">
      <h2 className="font-medium">{title}</h2>
      {note && <p className="mb-4 mt-1 max-w-prose text-sm leading-relaxed text-[var(--muted)]">{note}</p>}
      <div className={note ? "" : "mt-4"}>{children}</div>
    </section>
  );
}

export default function Settings({ state, onBack, onLegal, onUpgrade }) {
  const [group, setGroup] = useState("account");
  const t = totals(state.sessions);
  const confirms = state.settings?.confirm !== false;
  // Off unless explicitly turned on. It is the only setting in the app that
  // can cost money, so the default has to be the free one.
  const fallback = state.settings?.fallback === true;
  const here = GROUPS.find((g) => g.id === group) ?? GROUPS[0];

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
      <button
        onClick={onBack}
        className="text-sm text-[var(--muted)] underline-offset-4 hover:text-[var(--ink)] hover:underline"
      >
        ← Back
      </button>
      <h1 className="mb-7 mt-4 text-3xl font-semibold tracking-tight">Settings</h1>

      <div className="gap-8 lg:grid lg:grid-cols-[13rem_1fr]">
        {/* The rail. A scrolling row of chips on a phone, where a column of
            five would push the actual content below the fold. */}
        <nav
          aria-label="Settings sections"
          className="-mx-5 mb-6 flex gap-1.5 overflow-x-auto px-5 pb-1 lg:mx-0 lg:mb-0 lg:flex-col
                     lg:overflow-visible lg:px-0 lg:pb-0"
        >
          {GROUPS.map((g) => {
            const on = g.id === group;
            return (
              <button
                key={g.id}
                onClick={() => setGroup(g.id)}
                aria-current={on}
                className={`shrink-0 rounded-lg px-3.5 py-2 text-left text-sm transition-colors lg:w-full ${
                  on
                    ? "bg-[var(--ink)] font-medium text-[var(--paper)] lg:bg-[var(--hover)] lg:text-[var(--ink)]"
                    : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                }`}
              >
                {g.name}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0">
          <p className="mb-4 hidden text-sm text-[var(--muted)] lg:block">{here.blurb}</p>
          <div className="flex flex-col gap-4">
            {group === "account" && (
              <>
                <Panel title="Account">
                  <Account email={state.settings?.email || null} />
                </Panel>
                <Panel
                  title="Plan and usage"
                  note="What you're using of what the plan allows. Billed monthly, cancel any time — the free tier is not a trial, it keeps working."
                >
                  <Usage state={state} onUpgrade={onUpgrade} />
                  {canSync && (
                    <div className="mt-6">
                      <Billing email={state.settings?.email || null} />
                    </div>
                  )}
                </Panel>
              </>
            )}

            {group === "you" && (
              <>
                <Panel title="How I address you" note="Used when the assistant greets you.">
                  <Identity value={state.settings?.identity || {}} compact />
                </Panel>
                <Panel
                  title="Your working day"
                  note="Every deadline calculation in the app is measured against this — whether work fits, how thinly a project has to be spread, what counts as urgent."
                >
                  <WorkingHours state={state} />
                </Panel>
                <Panel title="Appearance" note="Light, dark, or whatever this device is already doing.">
                  <Appearance />
                </Panel>
              </>
            )}

            {group === "assistant" && (
              <>
                <Panel
                  title="Before she acts"
                  note="She reads back every change before making it, so nothing lands on your calendar without you seeing it first. Turn this off and she acts straight away — faster, and you will occasionally correct her afterwards."
                >
                  <Toggle
                    label="Confirm before changing anything"
                    on={confirms}
                    onChange={() => setSetting("confirm", !confirms)}
                  />
                  <p className="mt-3 max-w-prose text-xs leading-relaxed text-[var(--muted)]">
                    She runs entirely on this device — no API key and no per-message cost, so she
                    answers instantly and works offline. Pro removes the daily limit on how often
                    you can ask.
                  </p>
                </Panel>
                <Panel title="Voice" note="Talk to her, and have her talk back.">
                  <VoiceSettings state={state} onUpgrade={onUpgrade} />
                </Panel>
                {canSync && (
                  <Panel
                    title="Boost"
                    note="When she can't parse something, send just that message off to be reworded, then run the reworded version through the ordinary path — same confirmation, same undo. Messages she already understands never leave the device, so this only ever costs anything on the ones she gets stuck on."
                  >
                    <Toggle
                      label="Give her a boost when she gets stuck"
                      on={fallback}
                      onChange={() => setSetting("fallback", !fallback)}
                    />
                    <p className="mt-3 max-w-prose text-xs leading-relaxed text-[var(--muted)]">
                      Needs an account and a server with a key configured; without one this stays
                      off by itself and she answers exactly as she does now. When it is on, the
                      message and a short summary of your next ten events and tasks are sent —
                      nothing else.
                    </p>
                  </Panel>
                )}
                <Panel
                  title="What she missed"
                  note="Every message she couldn't act on, kept here so the gaps are a list rather than a feeling. Where you rephrased something and it worked, the phrasing that worked is saved next to the one that didn't — which is exactly what's needed to teach her."
                >
                  <Misses />
                </Panel>
              </>
            )}

            {group === "connections" && (
              <>
                {canSync ? (
                  <Panel
                    title="Calendars"
                    note="Connect Google Calendar and the two stay in step — meetings booked anywhere show up here, and anything Squirrel schedules appears there."
                  >
                    <Calendars
                      plan={state.plan}
                      email={state.settings?.email || null}
                      onUpgrade={onUpgrade}
                    />
                  </Panel>
                ) : (
                  <Panel title="Calendars">
                    <p className="text-sm text-[var(--muted)]">
                      Calendar sync needs a backend, and this build doesn't have one configured.
                    </p>
                  </Panel>
                )}
                <Panel title="Reminders">
                  <Reminders state={state} />
                </Panel>
              </>
            )}

            {group === "data" && (
              <>
                <Panel title="Your data">
                  <p className="text-sm text-[var(--muted)]">
                    {state.projects.length} projects · {state.tasks.length} tasks ·{" "}
                    {state.events.length} events · {t.count} sessions · {duration(t.focusedMs)} focused.
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
                    {state.settings?.email
                      ? "Synced to your account, and kept on this device so it works offline."
                      : "All of it lives in this browser. Clearing site data erases it, and it does not sync between devices."}
                  </p>
                  <button
                    onClick={() => {
                      if (confirm("Erase all projects, tasks, and sessions? This cannot be undone.")) resetAll();
                    }}
                    className="mt-4 rounded-lg border border-[var(--line)] px-5 py-2 text-sm
                               transition-colors hover:border-[var(--ink)]"
                  >
                    Erase everything
                  </button>

                  {/* Erasing clears this device. Deleting removes the account
                      itself, everywhere — a different thing, so it is said
                      separately and asks for more than a click. */}
                  <div className="mt-6 border-t border-[var(--hairline)] pt-5">
                    <DeleteAccount email={state.settings?.email || null} />
                  </div>
                </Panel>
                <Panel
                  title="This build"
                  note="What this copy of Squirrel has configured. Only whether a key is set, never any part of its value."
                >
                  <SetupCheck />
                </Panel>
                <Panel title="Legal">
                  <div className="flex flex-wrap gap-4 text-sm">
                    <button onClick={() => onLegal?.("privacy")}
                      className="text-[var(--muted)] underline-offset-4 hover:text-[var(--ink)] hover:underline">
                      Privacy
                    </button>
                    <button onClick={() => onLegal?.("terms")}
                      className="text-[var(--muted)] underline-offset-4 hover:text-[var(--ink)] hover:underline">
                      Terms of service
                    </button>
                  </div>
                </Panel>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, on, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onChange}
      className="flex w-full items-center justify-between gap-4 rounded-lg border border-[var(--line)]
                 px-4 py-3 text-left text-sm transition-colors hover:border-[var(--ink)]"
    >
      <span>{label}</span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
        on ? "bg-[var(--ink)]" : "bg-[var(--line)]"
      }`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-[var(--paper)] transition-all ${
          on ? "left-[18px]" : "left-0.5"
        }`} />
      </span>
    </button>
  );
}
