import Identity from "./Identity";
import Squirrel from "./Squirrel";

/**
 * First run.
 *
 * The old version asked "how should I address you?" on a narrow centred card
 * and said nothing else — which on a Mac left a 200-pixel form marooned in the
 * middle of a 27-inch display, and told a brand-new user nothing about what
 * they had just opened. A first screen has two jobs: say what this is, and ask
 * for the one thing needed to start. It was doing half of one.
 *
 * So the desktop layout is a split: the left half states what the product is,
 * the right half asks the question. On a phone the pitch collapses to a
 * headline and the form comes first, because a thumb should reach the input
 * without scrolling past marketing.
 *
 * The claims here are deliberately only the ones the app can keep. A first-run
 * screen that promises something the product does not do is the fastest way to
 * lose the trust it exists to build.
 */

const CAPABILITIES = [
  {
    title: "An assistant that acts",
    body: "Tell her what changed in your own words — “push the board call to Thursday” — and it is done. No forms, no dragging.",
    icon: null, // Squirrel herself
  },
  {
    title: "Your calendars, in step",
    body: "Google and Apple, both ways. Meetings booked anywhere show up here, and anything scheduled here appears there.",
    icon: "M4 8h16M4 8a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V8zM9 4v4M15 4v4",
  },
  {
    title: "Work that fits the day you actually have",
    body: "Give a task a deadline and an estimate and it lays itself into your open hours — and warns you when it no longer fits.",
    icon: "M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  {
    title: "Hand things to people",
    body: "Delegate a task to someone and keep it on your board until it is genuinely done.",
    icon: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M13 7a4 4 0 11-8 0 4 4 0 018 0zM22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  },
];

export default function Welcome({ onDone }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* ---------------------------------------------------------- the pitch
          Ink on the left. On a phone this becomes a compact header rather than
          a full panel — the same words, a tenth of the height. */}
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

          {/* Hidden on small screens: a phone should reach the form, not read
              a feature list on the way to it. */}
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

      {/* ----------------------------------------------------------- the ask */}
      <section className="flex items-center justify-center px-7 py-12 sm:px-12 lg:py-14">
        <div className="w-full max-w-[26rem]">
          <p className="label">Before we start</p>
          <h2 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.025em]">
            How should I address you?
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
            She greets you by name. Change it whenever you like — this is the
            only thing needed to start.
          </p>

          <div className="mt-7">
            <Identity value={{}} onDone={onDone} compact submitLabel="Get started" />
          </div>

          <p className="mt-6 text-xs leading-relaxed text-[var(--muted)] lg:hidden">
            Works offline. Your day stays on your device unless you sign in.
          </p>
        </div>
      </section>
    </div>
  );
}
