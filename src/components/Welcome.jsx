import { useState } from "react";
import Identity from "./Identity";
import Squirrel from "./Squirrel";
import { setSetting } from "../lib/store";

/**
 * First run, as a short conversation rather than a form.
 *
 * The old version put one question on a narrow centred card and said nothing
 * else — which on a Mac left a form marooned in the middle of a 27-inch display
 * and told a brand-new user nothing about what they had opened.
 *
 * It is three steps now, and the count matters in both directions. Fewer, and
 * the planner starts without knowing when the person works, which is the number
 * every deadline calculation in the app is measured against — it would be
 * guessing on day one. More, and it becomes a setup wizard, which is the thing
 * people abandon. Every step after the first can be skipped, so the floor is
 * one answer and about fifteen seconds.
 *
 * The left panel is the pitch and stays put; only the right side advances. That
 * is deliberate — a screen that reprints everything on each step feels like
 * paperwork, and one where the frame holds still feels like being walked
 * through something.
 */

const CAPABILITIES = [
  {
    title: "An assistant that acts",
    body: "Tell her what changed in your own words — “push the board call to Thursday” — and it is done. No forms, no dragging.",
    icon: null,
  },
  {
    title: "Your calendars, in step",
    body: "Google and Apple, both ways. Meetings booked anywhere show up here, and anything scheduled here appears there.",
    icon: "M4 8h16M4 8a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V8zM9 4v4M15 4v4",
  },
  {
    title: "Invitations people actually receive",
    body: "Put an address next to a name and Squirrel sends a real calendar invite — accept and decline, straight from their inbox.",
    icon: "M4 6h16v12H4zM4 7l8 6 8-6",
  },
  {
    title: "Work that fits the day you actually have",
    body: "Give a task a deadline and an estimate and it lays itself into your open hours — and warns you when it stops fitting.",
    icon: "M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  },
];

/** Whole hours, as most working days are actually described. */
const STARTS = [7, 8, 9, 10];
const ENDS = [16, 17, 18, 19];
const sayHour = (h) => `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;

const STEPS = ["you", "hours", "ready"];

export default function Welcome({ onDone }) {
  const [step, setStep] = useState(0);
  const [starts, setStarts] = useState(9);
  const [ends, setEnds] = useState(17);
  const [weekend, setWeekend] = useState(false);

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));

  /** The last step, and the only thing that marks the flow finished. */
  function finish() {
    setSetting("onboarded", true);
    onDone?.();
  }

  function saveHours() {
    setSetting("hours", { start: starts, end: ends });
    setSetting("workWeekend", weekend);
    next();
  }

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* ---------------------------------------------------------- the pitch */}
      <section
        className="relative flex flex-col justify-between overflow-hidden bg-[var(--brand)]
                   px-7 py-10 text-[var(--brand-ink)] sm:px-12 lg:px-14 lg:py-14
                   lg:border-r lg:border-[var(--brand-edge)]"
      >
        <div className="flex items-center gap-2.5">
          <Squirrel size={26} className="sq-invert" title="Squirrel" />
          <span className="text-[15px] font-semibold tracking-tight">Squirrel</span>
        </div>

        <div className="max-w-[30rem] py-10 lg:py-0">
          <h1 className="text-[clamp(28px,4.2vw,44px)] font-semibold leading-[1.08] tracking-[-0.03em]">
            The first planner with an assistant built into it.
          </h1>
          <p className="mt-5 text-[15px] leading-relaxed text-[var(--brand-muted)] sm:text-base">
            Tasks, projects and your calendar in one place — and someone to
            keep them straight. Say what changed; she does the rest.
          </p>

          <ul className="mt-10 hidden flex-col gap-6 lg:flex">
            {CAPABILITIES.map((c) => (
              <li key={c.title} className="flex gap-3.5">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[var(--brand-chip)]">
                  {c.icon ? (
                    <svg viewBox="0 0 24 24" className="h-[15px] w-[15px] fill-none stroke-current stroke-[1.7]">
                      <path d={c.icon} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <Squirrel size={15} className="sq-invert" />
                  )}
                </span>
                <div>
                  <p className="text-sm font-medium">{c.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--brand-muted)]">{c.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="hidden text-xs text-[var(--brand-faint)] lg:block">
          Works offline. Your day stays on your device unless you sign in.
        </p>
      </section>

      {/* ------------------------------------------------------------ the ask */}
      <section className="flex items-center justify-center px-7 py-12 sm:px-12 lg:py-14">
        <div className="w-full max-w-[26rem]">
          {/* Three ticks rather than "step 2 of 3". The end is visible either
              way, and a bar that fills is easier to read at a glance than a
              fraction that has to be parsed. */}
          <div className="mb-7 flex items-center gap-1.5" role="presentation">
            {STEPS.map((s, i) => (
              <span
                key={s}
                className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                  i <= step ? "bg-[var(--ink)]" : "bg-[var(--line)]"
                }`}
              />
            ))}
          </div>

          {step === 0 && (
            <div key="you" className="sq-step">
              <p className="label">First — the only question that matters</p>
              <h2 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.025em]">
                How should I address you?
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                She greets you by name. Change it any time.
              </p>
              <div className="mt-7">
                <Identity value={{}} onDone={next} compact submitLabel="Continue" />
              </div>
            </div>
          )}

          {step === 1 && (
            <div key="hours" className="sq-step">
              <p className="label">When do you work?</p>
              <h2 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.025em]">
                So she plans around your real day.
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                Every deadline is measured against this — whether work fits, what
                counts as urgent, when to stop scheduling.
              </p>

              <div className="mt-7">
                <p className="mb-2 text-xs font-medium text-[var(--muted)]">Start</p>
                <div className="flex flex-wrap gap-1.5">
                  {STARTS.map((h) => (
                    <Pick key={h} on={starts === h} onClick={() => setStarts(h)}>{sayHour(h)}</Pick>
                  ))}
                </div>

                <p className="mb-2 mt-5 text-xs font-medium text-[var(--muted)]">Finish</p>
                <div className="flex flex-wrap gap-1.5">
                  {ENDS.map((h) => (
                    <Pick key={h} on={ends === h} onClick={() => setEnds(h)}>{sayHour(h)}</Pick>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setWeekend((w) => !w)}
                  aria-pressed={weekend}
                  className="mt-5 flex w-full items-center justify-between rounded-lg border
                             border-[var(--line)] px-4 py-3 text-left text-sm transition-colors
                             hover:border-[var(--ink)]"
                >
                  <span>I work weekends too</span>
                  <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                    weekend ? "bg-[var(--ink)]" : "bg-[var(--line)]"
                  }`}>
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-[var(--paper)] transition-all ${
                      weekend ? "left-[18px]" : "left-0.5"
                    }`} />
                  </span>
                </button>

                <p className="mt-4 rounded-lg bg-[var(--sunken)] px-4 py-3 text-sm text-[var(--muted)]">
                  {`${sayHour(starts)} to ${sayHour(ends)}, ${weekend ? "seven days" : "weekdays"}`}
                  {" — about "}
                  <span className="num font-medium text-[var(--ink)]">
                    {Math.max(0, ends - starts) * (weekend ? 7 : 5)}h
                  </span>
                  {" a week to plan with."}
                </p>

                <button
                  onClick={saveHours}
                  className="mt-6 w-full rounded-lg bg-[var(--ink)] py-3 text-sm font-medium
                             text-[var(--paper)] transition-opacity hover:opacity-90"
                >
                  Continue
                </button>
                <Skip onClick={next} />
              </div>
            </div>
          )}

          {step === 2 && (
            <div key="ready" className="sq-step">
              <p className="label">That's everything</p>
              <h2 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.025em]">
                Try asking her something.
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                She is the squirrel at the bottom of the screen. Anything you
                would say to a person works — these are just to start.
              </p>

              <ul className="mt-6 flex flex-col gap-2">
                {[
                  "Book a call with Priya Thursday at 2",
                  "The board deck will take 8 hours, due Friday",
                  "What does my week look like?",
                ].map((line) => (
                  <li
                    key={line}
                    className="rounded-lg border border-[var(--line)] px-4 py-3 text-sm text-[var(--muted)]"
                  >
                    “{line}”
                  </li>
                ))}
              </ul>

              <button
                onClick={finish}
                className="mt-7 w-full rounded-lg bg-[var(--ink)] py-3 text-sm font-medium
                           text-[var(--paper)] transition-opacity hover:opacity-90"
              >
                Open Squirrel
              </button>
            </div>
          )}

          <p className="mt-6 text-xs leading-relaxed text-[var(--muted)] lg:hidden">
            Works offline. Your day stays on your device unless you sign in.
          </p>
        </div>
      </section>
    </div>
  );
}

function Pick({ on, children, ...rest }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={`rounded-lg border px-4 py-2 text-sm tabular-nums transition-colors ${
        on
          ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
          : "border-[var(--line)] hover:border-[var(--ink)]"
      }`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Every step after the first is skippable — the floor is one answer. */
const Skip = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="mt-3 w-full py-2 text-xs text-[var(--muted)] underline-offset-4 hover:underline"
  >
    Skip for now
  </button>
);
