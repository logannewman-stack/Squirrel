/**
 * The assistant, on projects.
 *
 * Projects were the one part of the app she could not touch: twenty-four
 * intents and not one of them reached the layer everything else hangs off. So
 * somebody could ask her to book a meeting and file a task, then had to go and
 * make the project by hand before either could belong anywhere.
 *
 * Most of what is pinned here is the *parsing*, because that is where this
 * goes wrong quietly. A project name lifted from the wrong side of the word —
 * "add the deck to the Marketing project" read as a project called "deck to
 * the Marketing" — does not throw. It creates a second project with a nonsense
 * name, and the work goes into it.
 */

globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = v; },
  removeItem(k) { delete this._d[k]; },
};

const { parse, projectPhrase } = await import("../src/lib/nlu/parse.js");
const store = await import("../src/lib/store.js");
const { ask } = await import("../src/lib/nlu/index.js");

let pass = 0, fail = 0;
const failures = [];
const t = (name, ok, detail) => {
  if (ok) pass++; else { fail++; failures.push(name); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const NOW = new Date(2026, 7, 10, 10, 0);
const intentOf = (text) => parse(text, NOW).intent;
const nameIn = (text) => parse(text, NOW).slots.project;

// ------------------------------------------------------------------ naming
{
  t("a name after 'called' is the name", projectPhrase("start a project called Q3 Launch") === "Q3 Launch");
  t("a name after the noun works too", projectPhrase("new project Marketing") === "Marketing");
  t("a name before the noun works", projectPhrase("the Series B project") === "Series B");
  t("quotes are dropped", projectPhrase('a project called "Acme Rebrand"') === "Acme Rebrand");

  // The one that matters. A regex that grabs the words before the noun reads
  // the whole clause as a name, and the work lands in a project nobody made.
  t("the name is not the clause in front of it",
    nameIn("add the deck to the Marketing project") === "Marketing",
    nameIn("add the deck to the Marketing project"));
  t("nor is it the verb", nameIn("start a project") === null, nameIn("start a project"));
  t("nor a question", nameIn("what projects do i have") === null, nameIn("what projects do i have"));
  t("nor the tail of a question",
    nameIn("how is the Series B project going") === "Series B",
    nameIn("how is the Series B project going"));
  t("nor 'show me'", nameIn("show me my projects") === null, nameIn("show me my projects"));
}

// ----------------------------------------------------------------- routing
{
  t("making one is making one", intentOf("start a project called Q3 Launch") === "create_project");
  t("even without ceremony", intentOf("new project Marketing") === "create_project");
  t("listing is listing", intentOf("what projects do i have") === "query_projects");
  t("and so is asking for them", intentOf("show me my projects") === "query_projects");
  t("filing is filing", intentOf("add the deck to the Marketing project") === "file_task",
    intentOf("add the deck to the Marketing project"));
  t("and moving is too", intentOf("file the term sheet under the Series B project") === "file_task");
  // "How is X going" reached the day-triage rule before this, and answered a
  // question about one project with advice about the whole week.
  t("progress on a project is a progress question",
    intentOf("how is the Series B project going") === "query_progress");

  // Nothing about projects may take traffic that was never about them.
  t("an ordinary task is untouched", intentOf("add a task to email legal") === "create_task");
  t("an ordinary booking is untouched", intentOf("book a call with bob tomorrow at 3") === "create_event");
  t("an ordinary question is untouched", intentOf("what do i have tomorrow") === "query_day");
}

// ------------------------------------------------- "add a task to finish X"
{
  // "finish" is a completion verb and it was winning, so asking for a task to
  // be *made* marked an unrelated one done — or, more often, failed to find
  // anything and did nothing at all.
  t("adding a task to finish something creates it",
    intentOf("add a task to finish the board deck") === "create_task",
    intentOf("add a task to finish the board deck"));
  t("so does a reminder to finish something",
    intentOf("remind me to finish the board deck") === "create_task");
  // And completion still completes.
  t("finishing something still completes it", intentOf("finish the board deck") === "complete_task");
  t("as does saying it is done", intentOf("the board deck is done") === "complete_task");
}

// --------------------------------------------------------------- end to end
{
  localStorage.removeItem("squirrel.v2");
  store.setSetting("confirm", false);
  const S = () => store.getState();
  const say = (text) => ask(text, S(), { now: NOW });

  let r = say("start a project called Q3 Launch");
  t("she makes the project", S().projects.length === 1, JSON.stringify(S().projects.map((x) => x.name)));
  t("with the name given", S().projects[0].name === "Q3 Launch");
  t("and says so", /Q3 Launch/.test(r.text));

  // A second one with the same name splits the work across two boards, which
  // is worse than refusing.
  r = say("start a project called Q3 Launch");
  t("a duplicate is refused", S().projects.length === 1);
  t("and says why", /already exists/i.test(r.text), r.text);

  store.addTask({ title: "Board deck", estimateMins: 120 });
  r = say("put the board deck under the Q3 Launch project");
  const filed = S().tasks.find((x) => x.title === "Board deck");
  t("filing puts the task in the project", filed.projectId === S().projects[0].id, r.text);
  t("and says so", /Q3 Launch/.test(r.text));

  r = say("put the board deck under the Q3 Launch project");
  t("filing it twice says it is already there", /already in/i.test(r.text), r.text);

  r = say("what projects do i have");
  t("listing names the project", /Q3 Launch/.test(r.text), r.text);
  t("and counts them", /1 project\b/.test(r.text), r.text);

  r = say("put the board deck under the Nonexistent project");
  t("an unknown project is refused rather than invented",
    /couldn't find a project/i.test(r.text) && S().projects.length === 1, r.text);
}

console.log(`\nProjects: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
