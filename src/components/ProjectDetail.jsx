import { useState } from "react";
import TaskRow from "./TaskRow";
import PersonPicker from "./PersonPicker";
import { Button, Chip, Field } from "./ui";
import { roster, workOf, keyOf } from "../lib/people";
import {
  addTask, deleteProject, toggleTask, deleteTask, updateProject, setProjectArchived, dayKey,
} from "../lib/store";
import { PRIORITIES } from "../lib/store";
import { duration } from "../lib/format";
import { whenTask, whenProject } from "../lib/when";
import { can } from "../lib/plans";

const ESTIMATES = [15, 30, 60, 120];

/**
 * The id that means "everything with no project on it".
 *
 * Work filed nowhere had no home at all: `Projects` groups by project and this
 * screen is keyed on one, so a task with no `projectId` appeared on Today while
 * it was due and nowhere at all once it was finished, or delegated past the
 * sixth row, or simply not urgent yet. It could be *found* by search, and
 * pressing enter on it navigated to Today — the one screen that does not
 * contain it.
 *
 * Rather than a fourth list somewhere, it is a project without a record. Every
 * part of this screen already does the right thing for a set of tasks; the only
 * things that do not apply are the ones that edit the project itself.
 */
export const UNFILED = "unfiled";

export default function ProjectDetail({ state, projectId, onBack, onFocus, onUpgrade }) {
  /**
   * Two of the tiers' own promises, enforced here for the first time. Both
   * were declared Studio features in plans.js and gated in no code anywhere,
   * so Studio's entire differentiator over Pro was working for free.
   */
  const canDelegate = can(state.plan, "delegation");
  const canClient = can(state.plan, "clientWork");
  const unfiled = projectId === UNFILED;
  const project = unfiled
    ? { id: null, name: "Unfiled", client: "", value: null }
    : state.projects.find((p) => p.id === projectId);
  const tasks = unfiled
    ? state.tasks.filter((t) => !t.projectId)
    : state.tasks.filter((t) => t.projectId === projectId);

  const [title, setTitle] = useState("");
  const [estimate, setEstimate] = useState(30);
  const [priority, setPriority] = useState("normal");
  const [due, setDue] = useState("");
  const [delegate, setDelegate] = useState("");
  const [tab, setTab] = useState("open");
  /**
   * The id of the thing just added, so the screen can answer for it.
   *
   * Adding work used to be silent: the row appeared, and the fact that the
   * planner had just booked it into tomorrow morning existed only in the
   * store. This holds on to which task the person is owed an answer about
   * until they add another one — the plan recomputes underneath, so the
   * sentence stays live rather than being a snapshot of the moment.
   */
  const [added, setAdded] = useState(null);

  if (!project) return null;

  const open = tasks.filter((t) => !t.done && !t.delegatedTo);
  const waiting = tasks.filter((t) => !t.done && t.delegatedTo);
  const done = tasks.filter((t) => t.done);
  const focused = state.sessions
    .filter((s) => (unfiled ? !s.projectId : s.projectId === project.id))
    .reduce((a, s) => a + s.focusedMs, 0);
  const overdue = open.filter((t) => t.due && t.due < dayKey()).length;

  const shown = tab === "open" ? open : tab === "waiting" ? waiting : done;

  // One plan, read by the header, the confirmation and every row, so they
  // cannot end up describing different weeks.
  const lands = unfiled ? null : whenProject(project, state.tasks, state);
  const justAdded = added && state.tasks.find((t) => t.id === added);
  const addedWhen = justAdded ? whenTask(justAdded, state) : null;

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8">
      <button onClick={onBack} className="text-xs text-[var(--muted)] hover:text-[var(--ink)]">
        ← Projects
      </button>

      <header className="mb-6 mt-3 flex items-start justify-between gap-6">
        {unfiled ? (
          /* Nothing here to rename, bill, or delete — there is no record. What
             this screen owes an unfiled pile instead is the way out of being
             one, which is the line underneath. */
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">Unfiled</h1>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Work with no project on it. Say “file the lease under Q3 launch” and it moves.
            </p>
          </div>
        ) : (
        <>
        <div className="min-w-0 flex-1">
          <input
            defaultValue={project.name}
            onBlur={(e) => updateProject(project.id, { name: e.target.value.trim() || project.name })}
            className="w-full bg-transparent text-2xl font-semibold tracking-tight outline-none"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {/* Who the work is for and what it is worth: the consultant's
                half of Studio, and the other gate that was never applied. */}
            {canClient ? (
              <>
                <input
                  defaultValue={project.client}
                  onBlur={(e) => updateProject(project.id, { client: e.target.value })}
                  placeholder="Client"
                  className="rounded border border-[var(--line)] bg-transparent px-2.5 py-1 text-xs
                             outline-none placeholder:text-[var(--faint)] focus:border-[var(--ink)]"
                />
                <input
                  type="number"
                  defaultValue={project.value ?? ""}
                  onBlur={(e) => updateProject(project.id, { value: e.target.value ? Number(e.target.value) : null })}
                  placeholder="Value ($)"
                  className="w-28 rounded border border-[var(--line)] bg-transparent px-2.5 py-1 text-xs
                             tabular-nums outline-none placeholder:text-[var(--faint)] focus:border-[var(--ink)]"
                />
              </>
            ) : (
              <button
                type="button"
                onClick={() => onUpgrade?.("Client projects are on Studio")}
                className="rounded border border-[var(--line)] px-2.5 py-1 text-xs text-[var(--muted)]
                           transition-colors hover:border-[var(--ink)] hover:text-[var(--ink)]"
              >
                Add a client and a value — on Studio
              </button>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/**
            * Finished, not deleted.
            *
            * Delete was the only way to get a project off the grid, and it
            * takes every task and every logged hour with it — so the ordinary
            * end of a piece of work, finishing it, was served by the one
            * irreversible button on the screen. Archiving is what somebody
            * actually means, and it is the flag the grid, Today, search and
            * the plan quota were already reading.
            */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setProjectArchived(project.id, !project.archived)}
            className="!text-[var(--muted)] hover:!text-[var(--ink)]"
          >
            {project.archived ? "Reopen" : "Archive"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (confirm(`Delete "${project.name}" and its ${tasks.length} tasks?`)) {
                deleteProject(project.id);
                onBack();
              }
            }}
            className="!text-[var(--muted)] hover:!text-[var(--alert)]"
          >
            Delete
          </Button>
        </div>
        </>
        )}
      </header>

      <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--line)]
                      bg-[var(--line)] sm:grid-cols-4">
        <Stat label="Open" value={String(open.length)} />
        <Stat label="Overdue" value={String(overdue)} />
        <Stat label="Waiting on" value={String(waiting.length)} />
        <Stat label="Focused" value={duration(focused)} />
      </div>

      {/**
        * When the whole thing lands.
        *
        * Four counters say how much is left and none of them say when it ends,
        * which is the number somebody repeats to a client. It comes from the
        * same blocks as every row below it, so the project's finish date can
        * never be a day its own tasks disagree with.
        */}
      {lands?.long && lands.state !== "clear" && (
        <p className={`-mt-6 mb-8 text-xs ${
          lands.state === "short" || lands.state === "late"
            ? "font-medium text-[var(--ink)]"
            : "text-[var(--muted)]"
        }`}>
          {lands.long}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          const made = addTask({
            projectId: unfiled ? null : projectId, title, estimateMins: estimate, priority,
            due: due || null, delegatedTo: delegate.trim(),
          });
          setAdded(made?.id || null);
          setTitle("");
          setDue("");
          setDelegate("");
        }}
        className="mb-8 rounded-lg border border-[var(--line)] p-4"
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add work…"
          className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--faint)]"
        />
        {/* Four decisions, each labelled and each on its own line at narrow
            widths. They were a single unlabelled row of fifteen controls, which
            reads as a toolbar rather than as a question anyone is being asked —
            and put a 112-pixel text box in charge of who does the work. */}
        <div className="mt-3 space-y-3 border-t border-[var(--hairline)] pt-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Field label="Takes">
              {ESTIMATES.map((m) => (
                <Chip key={m} on={estimate === m} onClick={() => setEstimate(m)}>
                  {m >= 60 ? `${m / 60}h` : `${m}m`}
                </Chip>
              ))}
            </Field>

            <Field label="Priority">
              {PRIORITIES.map((p) => (
                <Chip key={p} on={priority === p} onClick={() => setPriority(p)} className="capitalize">
                  {p}
                </Chip>
              ))}
            </Field>
          </div>

          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <Field label="Due">
              {/* Quick days first: a deadline is "Friday" far more often than
                  it is a date somebody wants to pick out of a grid. */}
              {[["Today", 0], ["Tomorrow", 1], ["Friday", null], ["Next week", 7]].map(([label, days]) => (
                <Chip key={label} on={due === dayFor(days, label)} onClick={() => setDue(dayFor(days, label))}>
                  {label}
                </Chip>
              ))}
              <input
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                aria-label="Due date"
                className="rounded-lg border border-[var(--line)] bg-transparent px-2.5 py-1.5 text-xs outline-none
                           transition-colors focus:border-[var(--ink)]"
              />
              {due && (
                <Button variant="ghost" size="sm" onClick={() => setDue("")} className="!px-2">
                  Clear
                </Button>
              )}
            </Field>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3">
            {/* Handing work to somebody else is Studio's story, and was
                advertised as one while working on every tier. Locked rather
                than hidden: a control nobody can see is a control nobody
                upgrades for, and the person reaching for a colleague's name
                is exactly who the tier is for. */}
            <Field label="Delegate" className="min-w-[15rem] flex-1">
              {canDelegate ? (
                <PersonPicker
                  value={delegate}
                  onChange={setDelegate}
                  state={state}
                  className="w-full max-w-xs"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onUpgrade?.("Handing work to someone is on Studio")}
                  className="w-full max-w-xs rounded-md border border-[var(--line)] px-2.5 py-2
                             text-left text-xs text-[var(--muted)] transition-colors
                             hover:border-[var(--ink)] hover:text-[var(--ink)]"
                >
                  Hand it to someone — on Studio
                </button>
              )}
            </Field>
            <Button type="submit" variant="primary" disabled={!title.trim()}>
              Add
            </Button>
          </div>
        </div>
      </form>

      {/**
        * What just happened to the thing you just added.
        *
        * This is the whole point of the form having a "Takes" row and a "Due"
        * row: between them the planner can decide when the work will actually
        * be done, and it does, immediately. Before this the decision was made
        * and never mentioned — you added two hours of high-priority work due
        * Friday and the app replied with a list row reading "120m 3d".
        *
        * It names the task because by the time you read it the field is empty
        * and the row is one of twelve.
        */}
      {addedWhen && (
        <p
          role="status"
          className="-mt-6 mb-8 flex flex-wrap items-baseline gap-x-2 text-xs text-[var(--muted)]"
        >
          <span className="font-medium text-[var(--ink)]">{justAdded.title}</span>
          <span>— {addedWhen.long}</span>
          <button
            onClick={() => setAdded(null)}
            className="ml-auto text-[var(--faint)] hover:text-[var(--ink)]"
            aria-label="Dismiss"
          >
            ×
          </button>
        </p>
      )}

      <div className="mb-3 flex gap-4 border-b border-[var(--line)]">
        {[
          ["open", `Open ${open.length}`],
          ["waiting", `Waiting ${waiting.length}`],
          ["done", `Done ${done.length}`],
        ].map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 pb-2 text-xs transition-colors ${
              tab === k ? "border-[var(--ink)] font-medium" : "border-transparent text-[var(--muted)]"
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="py-6 text-sm text-[var(--muted)]">
          {tab === "waiting"
            ? "Nothing with anyone else. Delegate something above and it will show up here, grouped by who has it."
            : tab === "done"
              ? "Nothing finished yet."
              : "No open work. Add some above."}
        </p>
      ) : tab === "waiting" ? (
        /* Grouped by person, because the question this tab answers is "who has
           what" — and a flat list of twelve tasks with a name on each makes
           that a counting exercise. */
        <div className="space-y-5">
          {byPerson(shown).map(([name, items]) => (
            <div key={name}>
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{name}</span>
                <span className="text-xs text-[var(--muted)]">
                  {items.length} waiting
                  {items.some((t) => t.due && t.due < dayKey()) && (
                    <span className="text-[var(--alert)]">
                      {" · "}{items.filter((t) => t.due && t.due < dayKey()).length} overdue
                    </span>
                  )}
                </span>
              </div>
              <ul className="divide-y divide-[var(--hairline)] border-t border-[var(--hairline)]">
                {items.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    when={whenTask(t, state)}
                    onToggle={() => toggleTask(t.id)}
                    onFocus={() => onFocus(t)}
                    onDelete={() => deleteTask(t.id)}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-[var(--hairline)]">
          {shown.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              when={whenTask(t, state)}
              onToggle={() => toggleTask(t.id)}
              onFocus={() => onFocus(t)}
              onDelete={() => deleteTask(t.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Delegated work, gathered under whoever has it.
 *
 * Most overdue first inside each person, and the person with the most overdue
 * first overall — the list is read to find out who to chase, so it opens with
 * whoever needs chasing.
 */
function byPerson(tasks) {
  const today = dayKey();
  const groups = new Map();
  for (const t of tasks) {
    const key = keyOf(t.delegatedTo) || "unassigned";
    const g = groups.get(key) ?? { name: t.delegatedTo || "Unassigned", items: [] };
    g.items.push(t);
    groups.set(key, g);
  }
  const late = (items) => items.filter((t) => t.due && t.due < today).length;
  return [...groups.values()]
    .map((g) => {
      g.items.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
      return g;
    })
    .sort((a, b) => late(b.items) - late(a.items) || b.items.length - a.items.length)
    .map((g) => [g.name, g.items]);
}

/** A labelled cluster of controls. Without the label they read as a toolbar. */
/** "Friday" means the next one, which is what anyone saying it means. */
function dayFor(days, label) {
  const d = new Date();
  if (days === null) {
    // Next Friday, and today only if today is Friday and the week is young.
    const ahead = (5 - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + ahead);
  } else {
    d.setDate(d.getDate() + days);
  }
  return dayKey(d);
}

function Stat({ label, value }) {
  return (
    <div className="bg-[var(--paper)] px-4 py-3">
      <p className="label">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight">{value}</p>
    </div>
  );
}
