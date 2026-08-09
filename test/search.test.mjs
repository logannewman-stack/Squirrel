/**
 * Finding something you wrote three weeks ago.
 *
 * The palette this replaces searched the first forty *open* tasks by
 * substring, which could not find a finished task, a past meeting, a note or
 * anybody's name — most of what somebody is actually looking for, since the
 * thing you half-remember doing is by definition already done.
 */
import { store, iso, reset, t, report } from "./harness.mjs";
import { search, whenLabel } from "../src/lib/search.js";

const NOW = new Date(2026, 7, 12, 10, 0);
const S = () => store.getState();

reset({ confirm: false });
const q3 = store.addProject({ name: "Q3 Launch", client: "Meridian" });
const rebrand = store.addProject({ name: "Rebrand" });
const deck = store.addTask({ projectId: q3.id, title: "Board deck", estimateMins: 120, due: "2026-08-14" });
store.addTask({ projectId: q3.id, title: "Draft the SOW", estimateMins: 90, notes: "waiting on legal" });
const old = store.addTask({ projectId: rebrand.id, title: "Pick the typeface", estimateMins: 60 });
store.updateTask(old.id, { done: true, doneAt: new Date(2026, 6, 20).toISOString() });
store.addTask({ projectId: q3.id, title: "Chase the invoice", estimateMins: 30, delegatedTo: "Priya" });
store.addEvent({ title: "Board call", start: iso(2026, 8, 13, 15), end: iso(2026, 8, 13, 16), attendees: [{ name: "Bob" }] });
store.addEvent({ title: "Kick-off", start: iso(2026, 7, 2, 10), end: iso(2026, 7, 2, 11) });

const find = (q) => search(q, S(), { now: NOW });
const titles = (q) => find(q).map((r) => r.title);

// -------------------------------------------------------------- the basics
t("a task is found by its title", titles("board deck").includes("Board deck"), titles("board deck"));
t("a project is found by its name", titles("rebrand").includes("Rebrand"), titles("rebrand"));
t("a meeting is found too", titles("board call").includes("Board call"), titles("board call"));
t("nothing matches nothing", find("zzzz").length === 0);
t("an empty query returns nothing rather than everything", find("   ").length === 0);

// ------------------------------------------------------- what it could not do
t("a finished task is findable, which is the whole point",
  titles("typeface").includes("Pick the typeface"), titles("typeface"));
t("so is a meeting that already happened", titles("kick").includes("Kick-off"), titles("kick"));
t("a note is searched", titles("legal").includes("Draft the SOW"), titles("legal"));
t("so is who a meeting is with", titles("bob").includes("Board call"), titles("bob"));
t("so is who a task was handed to", titles("priya").includes("Chase the invoice"), titles("priya"));
t("and a task is findable by its project", titles("meridian").length > 0, titles("meridian"));

// ------------------------------------------------------------------ tokens
/** Nobody remembers word order. They remember two words out of five. */
t("word order does not matter", titles("deck board").includes("Board deck"), titles("deck board"));
t("nor does the words in between", titles("sow draft").includes("Draft the SOW"), titles("sow draft"));
t("every word has to appear somewhere",
  !titles("board zzzz").includes("Board deck"), titles("board zzzz"));
t("a prefix is enough", titles("inv").includes("Chase the invoice"), titles("inv"));

// ----------------------------------------------------------------- ranking
{
  const r = find("board");
  t("live work outranks a past meeting at the same relevance",
    r.findIndex((x) => x.title === "Board deck") < r.findIndex((x) => x.title === "Board call") ||
      r[0].title === "Board deck", r.map((x) => x.title));
  const all = find("q3");
  t("a project ranks up, because a project is a place",
    all[0]?.kind === "project", all.map((x) => `${x.kind}:${x.title}`));
  t("a finished task ranks below a live one",
    find("the").findIndex((x) => x.done) > 0 || !find("the").some((x) => x.done));
}

// -------------------------------------------------------------------- shape
{
  const [hit] = find("board deck");
  t("a result says what kind of thing it is", hit.kind === "task", hit.kind);
  t("and carries a hint worth reading", /Q3 Launch/.test(hit.hint), hit.hint);
  t("and when it is", hit.when === "2026-08-14", hit.when);
  t("overdue is called overdue", () => {
    store.updateTask(deck.id, { due: "2026-08-01" });
    return /Overdue/.test(search("board deck", S(), { now: NOW })[0].hint);
  });
  t("a limit is honoured", search("a", S(), { now: NOW, limit: 2 }).length <= 2);
}

// -------------------------------------------------------------------- dates
t("today reads as today", whenLabel("2026-08-12", NOW) === "today");
t("tomorrow reads as tomorrow", whenLabel("2026-08-13", NOW) === "tomorrow");
t("yesterday too", whenLabel("2026-08-11", NOW) === "yesterday");
t("this week is a weekday name", whenLabel("2026-08-15", NOW) === "Sat", whenLabel("2026-08-15", NOW));
t("further out is a date", /Sep/.test(whenLabel("2026-09-20", NOW)), whenLabel("2026-09-20", NOW));
t("no date, no label", whenLabel(null) === "");
t("and rubbish does not throw", whenLabel("not-a-date") === "");

// ------------------------------------------------------------------- safety
t("missing state does not throw", search("x", undefined) .length === 0);
t("nor an empty one", search("x", { tasks: [], events: [], projects: [] }).length === 0);

report("Search");
