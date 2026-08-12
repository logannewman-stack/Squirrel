import { useState } from "react";
import { addProject, dayKey } from "../lib/store";
import { Button, Input, Find } from "./ui";
import { UNFILED } from "./ProjectDetail";
import { usage } from "../lib/plans";
import { TEMPLATES, scheduleFor } from "../lib/templates";
import { addTask } from "../lib/store";
import { hoursOf } from "../lib/hours";
import { duration, money } from "../lib/format";
import { whenProject } from "../lib/when";
import { remainingMins } from "../lib/schedule";

/**
 * Every project, and how each is actually going.
 *
 * This was a table, and a table was the wrong instrument. Stretched across a
 * desktop it put a project's name at one edge of the window and the number 2 at
 * the other, with eleven hundred pixels of nothing between them — the eye has
 * to travel the whole width to read one row, and five columns of mostly em
 * dashes said less than a sentence would have.
 *
 * Cards instead, because each project is a thing with a state rather than a row
 * in a ledger. They fill the frame at any width, they carry a progress bar that
 * is read rather than calculated, and the one number that means "act now" — how
 * many are late — is the only thing allowed to use the reserved colour.
 */
/**
 * A deadline, said the way a person would say it.
 *
 * "2026-08-13" is a date only a database enjoys. What anybody actually wants
 * from this line is how much room is left, and near dates carry that in words
 * while far ones are better as a date than as "in 47 days".
 */
function sayDue(due, today) {
  if (!due) return null;
  const days = Math.round((new Date(`${due}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000);
  if (days < 0) return `${Math.abs(days)}d late`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  if (days <= 6) return `due in ${days} days`;
  return `due ${new Date(`${due}T00:00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

export default function Projects({ state, onOpen, onUpgrade, onSearch }) {
  const { projects, tasks, sessions } = state;
  const [name, setName] = useState("");
  const today = dayKey();

  // The cap is enforced in SQL, so a third project on a free account is not
  // merely discouraged — it will not survive the next sync. Letting it be typed
  // and then quietly losing it is the worst of both, so the wall is here, at
  // the moment somebody reaches it, with the way past it attached.
  const room = usage(state).meters.find((m) => m.key === "projects");
  const capped = Boolean(room) && room.used >= room.cap;

  const rows = projects
    .map((p) => {
      const mine = tasks.filter((t) => t.projectId === p.id);
      /**
       * "Open" means the same thing here as on the screen this card opens:
       * not done and not handed over. The card used to count delegated work
       * as open while the detail called it waiting, so "7 open" opened onto
       * "Open 6" — the same store, two arithmetic dialects.
       */
      const open = mine.filter((t) => !t.done && !t.delegatedTo);
      const waiting = mine.filter((t) => !t.done && t.delegatedTo);
      const undone = open.length + waiting.length;
      return {
        p,
        total: mine.length,
        open: open.length,
        waiting: waiting.length,
        overdue: open.filter((t) => t.due && t.due < today).length,
        // The nearest deadline is what tells you which project is next, and it
        // was nowhere in the table.
        due: open.map((t) => t.due).filter(Boolean).sort()[0] ?? null,
        // What is genuinely left, after the sessions already logged against
        // it — the raw estimate sum said "1h left" moments after a 25-minute
        // sitting that Today was already crediting.
        remaining: open.reduce((n, t) => n + remainingMins(t, sessions), 0),
        focused: sessions.filter((s) => s.projectId === p.id).reduce((a, s) => a + s.focusedMs, 0),
        pct: mine.length ? Math.round(((mine.length - undone) / mine.length) * 100) : 0,
      };
    })
    // Late first, then whatever is due soonest — the order somebody would
    // triage them in, rather than the order they were created.
    .sort((a, b) =>
      b.overdue - a.overdue ||
      (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
      b.open - a.open);

  const live = rows.filter((r) => !r.p.archived);
  /**
   * The projects that have been put away.
   *
   * Archiving without anywhere to see the result is a delete with extra steps
   * — the grid filters `archived` out, so a project that gained the flag left
   * the only screen that lists projects and could be reached afterwards by
   * nothing but the ⌘K palette. Behind a count rather than beside the live
   * work: finished projects are the ones you look for on purpose.
   */
  const shelved = rows.filter((r) => r.p.archived);

  // Every project's landing date, read from the same blocks the calendar
  // draws, so a card and the screen it opens cannot name different days.
  const lands = Object.fromEntries(
    rows.map((r) => [r.p.id, whenProject(r.p, tasks, state)]),
  );

  /**
   * Work with no project on it, which until now had nowhere to be.
   *
   * This screen groups by project and the detail screen is keyed on one, so an
   * unfiled task was visible on Today while it was due and invisible the moment
   * it was finished, delegated past the sixth row, or simply not urgent yet.
   * A card here is the whole fix: it gives the pile a name, a count, and a
   * door.
   */
  const unfiled = state.tasks.filter((t) => !t.projectId);
  const unfiledOpen = unfiled.filter((t) => !t.done && !t.delegatedTo);
  const unfiledWaiting = unfiled.filter((t) => !t.done && t.delegatedTo);
  const unfiledNoEstimate = unfiledOpen.filter((t) => !(t.estimateMins > 0));
  const unfiledLate = unfiledOpen.filter((t) => t.due && t.due < today).length;

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">
            {live.length} active
            {/* Counting the unfiled pile too — the header said "4 late" while
                Today said five, and the missing one was simply filed nowhere.
                A number that disagrees with the next screen's number teaches
                people to trust neither. */}
            {(live.reduce((n, r) => n + r.overdue, 0) + unfiledLate > 0) && (
              <span className="alert"> · {live.reduce((n, r) => n + r.overdue, 0) + unfiledLate} late</span>
            )}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Projects</h1>
        </div>

        <Find onOpen={onSearch} className="order-last sm:order-none" />

        {/* Bounded rather than full-bleed. A project name is a few words, and a
            field eleven hundred pixels wide invites a sentence. */}
        <div className="w-full sm:w-auto">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              // The wall is checked before the name, not after: at the cap this
              // button is an upgrade, and an upgrade does not need a project
              // name it is only going to throw away.
              if (capped) return onUpgrade?.(`You're at ${room.cap} projects`);
              if (!name.trim()) return;
              onOpen(addProject({ name }).id);
              setName("");
            }}
            className="flex w-full gap-2 sm:w-auto"
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New project"
              className="w-full sm:w-64"
            />
            {/* At the cap the button stops waiting for a name it cannot use.
                Requiring one first would make the way out of a wall depend on
                typing something that gets thrown away. */}
            <Button type="submit" variant="primary" disabled={!capped && !name.trim()}>
              {capped ? "Upgrade" : "Create"}
            </Button>
          </form>
          {!capped && (
            <Templates
              onUse={(tpl) => {
                const project = addProject({ name: tpl.name });
                for (const task of scheduleFor(tpl, new Date(), hoursOf(state.settings).days)) {
                  addTask({ projectId: project.id, ...task });
                }
                onOpen(project.id);
              }}
            />
          )}
          {capped && (
            <p className="mt-1.5 text-right text-xs text-[var(--muted)]">
              <span className="num alert font-semibold">{room.used}/{room.cap}</span>{" "}
              projects on the free plan. Pro is unlimited.
            </p>
          )}
        </div>
      </header>

      {live.length === 0 && unfiled.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          {/* "No projects yet" to somebody who has archived all of theirs is
              the same sentence as to somebody on their first morning, and only
              one of them is true. "Yet" is the word that does the lying. */}
          {shelved.length > 0
            ? `Nothing open. ${shelved.length === 1 ? "One project is" : `${shelved.length} projects are`} archived below.`
            : "No projects yet. A project groups work — a deal, a launch, a function."}
        </p>
      ) : (
        <ul className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {/* Deliberately first and deliberately plain. It is a holding pen
              rather than an achievement, and the point of showing it is that
              somebody notices the number and empties it. */}
          {unfiled.length > 0 && (
            <li>
              <button
                onClick={() => onOpen(UNFILED)}
                className="card row-hover flex h-full w-full flex-col items-start px-4 py-4 text-left"
              >
                <span className="flex w-full items-center justify-between">
                  <span className="label">Unfiled</span>
                  {unfiledLate > 0 && <span className="alert-chip">{unfiledLate} late</span>}
                </span>
                <span className="mt-1 text-sm font-medium">
                  {unfiledOpen.length} open
                  {unfiledWaiting.length > 0 && ` · ${unfiledWaiting.length} with someone else`}
                </span>
                <span className="mt-1 text-xs text-[var(--muted)]">
                  {unfiledNoEstimate.length > 0
                    ? `${unfiledNoEstimate.length} still need an estimate`
                    : `${unfiled.length - unfiledOpen.length - unfiledWaiting.length} finished`}
                </span>
              </button>
            </li>
          )}
          {live.map(({ p, open, waiting, overdue, focused, pct, total, due, remaining }) => (
            <li key={p.id} className="min-w-0">
              <button
                onClick={() => onOpen(p.id)}
                className="card flex h-full w-full flex-col px-5 py-4 text-left transition-colors hover:border-[var(--ink)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.name}</p>
                    {(p.client || p.value) && (
                      <p className="mt-0.5 truncate text-[11px] text-[var(--faint)]">
                        {p.client}
                        {p.client && p.value ? " · " : ""}
                        {money(p.value)}
                      </p>
                    )}
                  </div>
                  {/* The only place the reserved colour is spent here: work
                      that is already late is the one state that costs money. */}
                  {overdue > 0 && <span className="alert-chip shrink-0">{overdue} late</span>}
                </div>

                <div className="mt-4 flex items-baseline gap-4">
                  <span>
                    <span className="num text-lg font-semibold">{open}</span>
                    <span className="ml-1 text-xs text-[var(--muted)]">open</span>
                  </span>
                  {waiting > 0 && (
                    <span className="num text-xs text-[var(--muted)]">{waiting} waiting</span>
                  )}
                  {remaining > 0 && (
                    <span className="num text-xs text-[var(--muted)]">
                      {duration(remaining * 60000)} left
                    </span>
                  )}
                  {focused > 0 && (
                    <span className="num text-xs text-[var(--faint)]">
                      {duration(focused)} done
                    </span>
                  )}
                </div>

                <div className="mt-3 flex flex-1 items-end gap-3">
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--hairline)]">
                    <span className="block h-full rounded-full bg-[var(--ink)]" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="num w-9 shrink-0 text-right text-[11px] text-[var(--faint)]">
                    {total ? `${pct}%` : "—"}
                  </span>
                </div>

                {(due || lands[p.id]?.short) && (
                  <p className={`num mt-2 text-[11px] ${
                    due && due < today ? "alert" : "text-[var(--muted)]"
                  }`}>
                    {due ? sayDue(due, today) : ""}
                    {/* When the work is actually booked to finish, beside the
                        date it is owed by. A deadline on its own is a wish;
                        the pair is the thing worth knowing, and it comes from
                        the same blocks the calendar draws. */}
                    {lands[p.id]?.short && (
                      <span className={lands[p.id].state === "short" || lands[p.id].state === "late"
                        ? "text-[var(--ink)]" : "text-[var(--faint)]"}>
                        {due ? " · " : ""}{lands[p.id].short}
                      </span>
                    )}
                  </p>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/**
        * The projects that have been put away.
        *
        * Folded, and only present when there are any: finished work is looked
        * for on purpose, and a permanent empty section teaches people to skip
        * the bottom of the screen. Each one opens the ordinary detail screen,
        * which is where Reopen lives — so the way back is the same door as the
        * way in, rather than a second set of controls that can disagree.
        */}
      {shelved.length > 0 && (
        <details className="mt-10 border-t border-[var(--hairline)] pt-4">
          <summary className="cursor-pointer text-xs text-[var(--muted)] hover:text-[var(--ink)]">
            Archived {shelved.length}
          </summary>
          <ul className="mt-3 divide-y divide-[var(--hairline)]">
            {shelved.map(({ p, total, focused }) => (
              <li key={p.id}>
                <button
                  onClick={() => onOpen(p.id)}
                  className="flex w-full items-baseline justify-between gap-4 py-2.5 text-left
                             text-sm text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
                >
                  <span className="truncate">{p.name}</span>
                  <span className="num shrink-0 text-[11px] text-[var(--faint)]">
                    {total} {total === 1 ? "task" : "tasks"}
                    {focused > 0 ? ` · ${duration(focused)}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}


/**
 * A project you have run before.
 *
 * Agencies do the same eight things every time somebody signs, and re-type them
 * every time — the dullest ten minutes of the week and the place things get
 * forgotten. These are real shapes rather than demonstrations, so the first use
 * is a useful one, and what lands is an ordinary project: editable, deletable,
 * nothing special about it afterwards.
 *
 * Collapsed by default. Somebody who came here to type a name should not have
 * to read a menu first.
 */
function Templates({ onUse }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-1.5 text-right text-xs text-[var(--muted)] underline-offset-4
                   hover:text-[var(--ink)] hover:underline sm:w-full"
      >
        or start from a template
      </button>
    );
  }
  return (
    <div className="mt-2 w-full sm:w-[22rem]">
      <ul className="flex flex-col gap-1.5">
        {TEMPLATES.map((tpl) => (
          <li key={tpl.id}>
            <button
              onClick={() => onUse(tpl)}
              className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-left
                         transition-colors hover:border-[var(--ink)]"
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{tpl.name}</span>
                <span className="num shrink-0 text-[11px] text-[var(--faint)]">
                  {tpl.tasks.length} tasks
                </span>
              </span>
              <span className="mt-0.5 block text-xs text-[var(--muted)]">{tpl.blurb}</span>
            </button>
          </li>
        ))}
      </ul>
      <button
        onClick={() => setOpen(false)}
        className="mt-2 text-xs text-[var(--muted)] underline-offset-4 hover:underline"
      >
        Never mind
      </button>
    </div>
  );
}
