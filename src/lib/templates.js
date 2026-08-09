/**
 * Project shapes you run more than once.
 *
 * Agencies, consultancies and anybody with clients do the same eight things
 * every time somebody signs — and re-type them every time, which is both the
 * dullest ten minutes of the week and the place things get forgotten. A
 * template is a project with its tasks already in it, offset from a start date
 * rather than pinned to one, so "start a client onboarding for Meridian"
 * produces a real week of work in one sentence.
 *
 * ## Offsets, not dates
 *
 * Every task carries `afterDays` — how long after the project starts it is due
 * — because a template pinned to real dates is a template that expires. The
 * dates are computed at the moment it is used, against the working week, so
 * nothing lands on a Sunday for somebody who does not work Sundays.
 *
 * ## Why these are built in rather than authored
 *
 * A template editor is a feature; a template is a starting point. Three good
 * ones that somebody can then edit like any other project beats an empty
 * builder nobody fills in — and every one of these is a real shape rather than
 * a demonstration, so the first use is the useful one.
 */

export const TEMPLATES = [
  {
    id: "client-onboarding",
    name: "Client onboarding",
    blurb: "Everything between a signature and the first working week.",
    tier: "studio",
    tasks: [
      { title: "Send the welcome note and invoice", estimateMins: 30, afterDays: 0 },
      { title: "Kick-off call", estimateMins: 60, afterDays: 2 },
      { title: "Collect brand assets and access", estimateMins: 45, afterDays: 3 },
      { title: "Write the scope of work", estimateMins: 120, afterDays: 5 },
      { title: "Set up the shared folder and channel", estimateMins: 30, afterDays: 5 },
      { title: "Agree the schedule and check-in day", estimateMins: 45, afterDays: 7 },
    ],
  },
  {
    id: "launch",
    name: "Launch",
    blurb: "Two weeks from “it works” to “people know”.",
    tier: "pro",
    tasks: [
      { title: "Write the announcement", estimateMins: 120, afterDays: 2 },
      { title: "Screenshots and the demo clip", estimateMins: 180, afterDays: 4 },
      { title: "Brief the team on what changed", estimateMins: 45, afterDays: 5 },
      { title: "Line up the first ten people to tell", estimateMins: 60, afterDays: 7 },
      { title: "Ship it", estimateMins: 60, afterDays: 10 },
      { title: "Read the replies and write down what to fix", estimateMins: 90, afterDays: 12 },
    ],
  },
  {
    id: "week",
    name: "A week of the usual",
    blurb: "The recurring admin that never quite gets a project of its own.",
    tier: "pro",
    tasks: [
      { title: "Plan the week", estimateMins: 30, afterDays: 0 },
      { title: "Invoices and expenses", estimateMins: 45, afterDays: 1 },
      { title: "Reply to everything outstanding", estimateMins: 60, afterDays: 2 },
      { title: "Weekly review", estimateMins: 30, afterDays: 4 },
    ],
  },
];

export const templateById = (id) => TEMPLATES.find((t) => t.id === id) ?? null;

/**
 * Find a template by what somebody called it.
 *
 * Loose on purpose — "onboarding", "client onboarding", "onboard a client" are
 * the same request, and this is reached from a typed sentence rather than from
 * a menu where the exact name was in front of them.
 */
export function matchTemplate(phrase) {
  const s = String(phrase ?? "").toLowerCase();
  if (!s.trim()) return null;
  // Longest name first, so "client onboarding" is not claimed by a shorter
  // template whose name happens to be a substring of it.
  for (const t of [...TEMPLATES].sort((a, b) => b.name.length - a.name.length)) {
    if (s.includes(t.name.toLowerCase())) return t;
  }
  if (/\bonboard/.test(s)) return templateById("client-onboarding");
  if (/\blaunch/.test(s)) return templateById("launch");
  return null;
}

/**
 * The dates a template's tasks would land on.
 *
 * Offsets are counted in *working* days when the settings say which those are,
 * so a six-day template does not quietly put two of its tasks on a weekend
 * nobody works. Given no working days at all — somebody who has turned every
 * day off — it falls back to calendar days rather than looping for ever.
 */
export function scheduleFor(template, start = new Date(), workingDays = [1, 2, 3, 4, 5]) {
  const days = workingDays?.length ? workingDays : [0, 1, 2, 3, 4, 5, 6];
  const pad = (n) => String(n).padStart(2, "0");
  const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  return (template?.tasks ?? []).map((t) => {
    const d = new Date(start);
    d.setHours(12, 0, 0, 0);
    // Day zero has to be a working day itself, or a template started on a
    // Saturday puts its first task on that Saturday.
    while (!days.includes(d.getDay())) d.setDate(d.getDate() + 1);
    for (let left = t.afterDays; left > 0; ) {
      d.setDate(d.getDate() + 1);
      if (days.includes(d.getDay())) left -= 1;
    }
    return { title: t.title, estimateMins: t.estimateMins, due: key(d) };
  });
}
