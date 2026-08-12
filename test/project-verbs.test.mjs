/**
 * Managing projects by talking.
 *
 * An audit ran the natural phrasings through the real assistant and found the
 * project verbs either unreachable or — far worse — landing on the wrong
 * thing and reporting success:
 *
 *   · "rename the Munich lease project to X" renamed a TASK, sometimes in a
 *     different project, destroying its title while the project kept its name.
 *   · Picking a project from the assistant's own "Which project?" list threw
 *     a TypeError — the answer to her question crashed her.
 *   · "start a project called Berlin lease" was refused because "Munich
 *     lease already exists" — a fuzzy near-match wearing the costume of fact.
 *   · An archived project silently swallowed newly filed work, and a money
 *     question naming it was answered with a different project's money.
 *   · Archiving itself — which the UI had just learned — had no voice at all.
 *
 * A misroute that edits the wrong record is the worst outcome an assistant
 * has; every case here is executed against the real store, and most of them
 * fingerprint what must NOT have changed.
 */
import { store, reset, ask, resolveChoice, t, report } from "./harness.mjs";

const NOW = new Date(2026, 7, 12, 9, 0);
const say = (line) => ask(line, store.getState(), { now: NOW });

/* ----------------------------------------------- renaming renames the project */
{
  reset();
  const lease = store.addProject({ name: "Munich lease" });
  const sale = store.addProject({ name: "Munich sale" });
  store.addTask({ title: "chase the notary", projectId: lease.id, estimateMins: 30 });
  store.addTask({ title: "review the deed", projectId: sale.id, estimateMins: 30 });

  const out = say("rename the Munich sale project to Bavaria sale");
  const s = store.getState();
  t("renaming a project renames the project", s.projects.find((x) => x.id === sale.id)?.name === "Bavaria sale",
    JSON.stringify(s.projects.map((x) => x.name)));
  t("  and says so", /Bavaria sale/.test(out.text), out.text);
  t("  no task was touched — that was the old failure",
    s.tasks.every((x) => ["chase the notary", "review the deed"].includes(x.title)),
    JSON.stringify(s.tasks.map((x) => x.title)));
  t("  the sibling project kept its name", s.projects.find((x) => x.id === lease.id)?.name === "Munich lease");
  store.undo();
  t("  and it is undoable", store.getState().projects.find((x) => x.id === sale.id)?.name === "Munich sale");
}

/* --------------------------------------------------- the picker cannot crash */
{
  reset();
  store.addProject({ name: "Munich lease" });
  store.addProject({ name: "Munich sale" });
  store.addTask({ title: "sign the papers", estimateMins: 30 });

  const out = say("put sign the papers in the Munich project");
  t("an ambiguous project asks", /Which project/.test(out.text), out.text);
  let picked = null;
  let threw = null;
  try {
    picked = resolveChoice(out.choices, out.choices.options[1].id, store.getState(), NOW);
  } catch (e) {
    threw = e.message;
  }
  t("answering her question does not crash her", threw === null, threw);
  t("  the pick actually files the task",
    store.getState().tasks[0].projectId === out.choices.options[1].id,
    JSON.stringify(store.getState().tasks[0]));
  t("  and the reply says where it went", /Munich sale/.test(picked?.text || ""), picked?.text);
}

/* -------------------------------------------------- creation is not vetoed */
{
  reset();
  store.addProject({ name: "Munich lease" });
  const out = say("start a project called Berlin lease");
  t("a similar name is not a collision", store.getState().projects.length === 2,
    out.text);
  t("  the new project is the one asked for",
    store.getState().projects.some((x) => x.name === "Berlin lease"));

  const dup = say("start a project called munich lease");
  t("an identical name still refuses", store.getState().projects.length === 2, dup.text);
  t("  and says why", /already exists/.test(dup.text), dup.text);
}

/* ---------------------------------------------------------- archive by voice */
{
  reset();
  const p = store.addProject({ name: "Old retainer" });
  store.addTask({ title: "Wrap up notes", projectId: p.id, estimateMins: 30 });

  const out = say("archive the Old retainer project");
  t("a project can be archived by voice", store.getState().projects[0].archived === true, out.text);
  t("  and the reply says what that means for the plan",
    /out of the plan/.test(out.text), out.text);

  const back = say("reopen the Old retainer project");
  t("and reopened", !store.getState().projects[0].archived, back.text);
  t("  with its work back in the plan, said aloud", /back/.test(back.text), back.text);

  const again = say("reopen the Old retainer project");
  t("reopening something live says so instead of guessing", /already live/.test(again.text), again.text);
}

/* --------------------------------------------- the shelf does not eat work */
{
  reset();
  const shelf = store.addProject({ name: "Munich lease" });
  store.addProject({ name: "Q3 launch" });
  store.setProjectArchived(shelf.id);
  store.addTask({ title: "sign the papers", estimateMins: 30 });

  const out = say("put sign the papers in the Munich lease project");
  t("filing into an archived project is refused with the way out",
    /archived/.test(out.text) && /reopen/.test(out.text), out.text);
  t("  and the task did not move", store.getState().tasks[0].projectId === null);
}

/* --------------------------------------- money answers name the named project */
{
  reset();
  const lease = store.addProject({ name: "Munich lease", value: 12000, client: "Hoffmann" });
  store.addProject({ name: "Munich sale", value: 40000, client: "Bauer" });
  store.setProjectArchived(lease.id);

  const out = say("how much is the Munich lease worth");
  t("a money question about an archived project answers about IT",
    /\$12k/.test(out.text), out.text);
  t("  marked as archived", /archived/.test(out.text), out.text);
  t("  and never a neighbour's number", !/\$40k/.test(out.text), out.text);
}

/* ------------------------------------------------------- scoped project asks */
{
  reset();
  const lease = store.addProject({ name: "Munich lease" });
  const sale = store.addProject({ name: "Munich sale" });
  store.addTask({ title: "chase the notary", projectId: lease.id, estimateMins: 60 });
  store.addTask({ title: "call the letting agent", projectId: lease.id, estimateMins: 30 });
  store.addTask({ title: "commission the survey", projectId: sale.id, estimateMins: 45 });

  const left = say("what is left on the Munich lease project");
  t("asking about one project answers about one project",
    /Munich lease/.test(left.text) && !/Munich sale/.test(left.text), left.text);

  const which = say("which project is commission the survey in");
  t("“which project is X in” finally has an answer",
    /Munich sale/.test(which.text) && !/Munich lease/.test(which.text), which.text);

  reset();
  store.addProject({ name: "Q3 launch" });
  store.addTask({ title: "loose end", estimateMins: 15 });
  const unfiled = say("what project is loose end in");
  t("  and unfiled work says it is unfiled", /Unfiled|isn'?t filed/.test(unfiled.text), unfiled.text);
}

/* ------------------------------------------------------ project deadlines */
{
  reset();
  store.addProject({ name: "Munich sale" });
  store.addTask({ title: "commission the survey", projectId: store.getState().projects[0].id, estimateMins: 45 });

  const out = say("set the Munich sale project deadline to friday");
  const proj = store.getState().projects[0];
  t("a project deadline lands on the project", Boolean(proj.due), out.text);
  t("  not on a task", store.getState().tasks.every((x) => !x.due),
    JSON.stringify(store.getState().tasks.map((x) => x.due)));
  t("  and the reply commits to pacing it", /pace/.test(out.text), out.text);

  const q = say("when is the Munich sale project due");
  t("and asking reads it back", /due/.test(q.text) && !/no deadline/.test(q.text), q.text);
}

/* ------------------------------------------------- filing words stay out of names */
/**
 * "add a task to the Munich lease project to chase the notary" filed
 * correctly and then created a task literally titled "Munich lease project to
 * chase the notary" — the instruction embalmed in the record it created. Only
 * the filing SHAPE is cut; a title that genuinely contains the project's name
 * keeps it.
 */
{
  const cases = [
    ["add a task to the Munich lease project to chase the notary", "Chase the notary"],
    ["add a task to sign the deed under Munich lease", "Sign the deed"],
    ["add chase the Munich lease notary, 30 minutes", "Chase the Munich lease notary"],
  ];
  for (const [line, want] of cases) {
    reset();
    store.addProject({ name: "Munich lease" });
    say(line);
    const made = store.getState().tasks[0];
    t(`\u201c${line.slice(0, 44)}\u2026\u201d names it \u201c${want}\u201d`,
      made?.title === want, made?.title);
    t("  and files it", Boolean(made?.projectId));
  }
}

report("Project verbs");
