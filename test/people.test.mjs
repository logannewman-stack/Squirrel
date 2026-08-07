/**
 * The roster, assembled from use rather than maintained.
 *
 * Delegation was a blank text box, which is bad in three ways that only the
 * third is obvious about: it is slow, it tells you nothing about who is
 * already loaded up, and it quietly turns "Abra", "abra", and "Abra " into
 * three different people. The third one is what makes a delegation feature
 * stop working after a fortnight of real use, so most of what is checked here
 * is folding.
 */

import { roster, search, isNew, summarise, keyOf, workOf } from "../src/lib/people.js";

let pass = 0, fail = 0;
const failures = [];
const t = (name, ok, detail) => {
  if (ok) pass++; else { fail++; failures.push(name); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

// Timestamps are epoch milliseconds in both tasks and events, so the fixture
// uses real ones — small integers would sort every task behind every meeting.
const T = Date.UTC(2026, 2, 10);
const state = {
  tasks: [
    { id: "1", title: "Deck", delegatedTo: "Priya", done: false, createdAt: T + 1000 },
    { id: "2", title: "Lease", delegatedTo: "priya ", done: false, createdAt: T + 2000 },
    { id: "3", title: "Memo", delegatedTo: "PRIYA.", done: false, createdAt: T + 9e8 },
    { id: "4", title: "Old", delegatedTo: "Bob", done: true, createdAt: T + 4000 },
    { id: "5", title: "Mine", delegatedTo: "", done: false, createdAt: T + 5000 },
  ],
  events: [
    { id: "e1", start: "2026-03-11T14:00:00", attendees: [{ name: "Bob" }, { name: "priya" }] },
    { id: "e2", start: "2026-03-12T09:00:00", attendees: [{ name: "me" }] },
  ],
};

// --------------------------------------------------------------- the folding
{
  t("case and spacing fold together", keyOf("  Priya ") === keyOf("priya"));
  t("punctuation folds too", keyOf("Priya R.") === keyOf("priya r"));

  const list = roster(state);
  const names = list.map((p) => p.name);
  t("one Priya, not three", names.filter((n) => /priya/i.test(n)).length === 1, JSON.stringify(names));
  t("their waiting work is counted together",
    list.find((p) => /priya/i.test(p.name)).waiting === 3,
    list.find((p) => /priya/i.test(p.name)).waiting);

  // Deliberately NOT folded: a first name is not enough to prove two people
  // are one, and merging "Priya" into "Priya Raman" would merge her with
  // "Priya Sharma" just as happily. The picker prevents the duplicate instead,
  // by making the existing name the easy thing to choose.
  const two = roster({
    tasks: [
      { delegatedTo: "Priya", done: false, createdAt: T },
      { delegatedTo: "Priya Sharma", done: false, createdAt: T },
    ],
  });
  t("a first name is not merged into a full one", two.length === 2,
    JSON.stringify(two.map((p) => p.name)));
}

// ------------------------------------------------------------- who is listed
{
  const list = roster(state);
  // Bob's only task is finished; he is still someone you meet with.
  const bob = list.find((p) => p.name === "Bob");
  t("finished work does not count as waiting", bob?.waiting === 0, bob?.waiting);
  t("but a meeting still puts them on the roster", bob?.meetings === 1, bob?.meetings);

  t("“me” is not a team member", !list.some((p) => /^me$/i.test(p.name)),
    JSON.stringify(list.map((p) => p.name)));
  t("nor is an empty delegate", !list.some((p) => !p.name));

  // Recency first: the person delegated to an hour ago is the likeliest next.
  t("most recent first", /priya/i.test(list[0].name), JSON.stringify(list.map((p) => p.name)));
}

// ------------------------------------------------------------------ searching
{
  const list = roster(state);
  t("a prefix finds them", search(list, "pri").length === 1, JSON.stringify(search(list, "pri")));
  t("a middle word finds them too",
    search(roster({ tasks: [{ delegatedTo: "Priya Raman", done: false, createdAt: T }] }), "raman").length === 1,
    "half a name is the half people remember");
  t("case does not matter", search(list, "PRIYA").length === 1);
  t("an empty query is everyone", search(list, "").length === list.length);
  t("nonsense finds nobody", search(list, "zzz").length === 0);
}

// ------------------------------------------------------------- adding someone
{
  const list = roster(state);
  t("a new name is offered", isNew(list, "Tom") === true);
  t("an existing one is not", isNew(list, "priya") === false,
    "offering Add for someone on the list is how you end up with two of them");
  t("a differently-cased existing one is not either", isNew(list, "  PRIYA  ") === false);
  t("nothing typed is not a new person", isNew(list, "  ") === false);
}

// -------------------------------------------------------------- what they say
{
  const list = roster(state);
  const priya = list.find((p) => /priya/i.test(p.name));
  t("the summary counts both kinds", summarise(priya) === "3 waiting · 1 meeting", summarise(priya));
  t("nobody with nothing gets a summary", summarise({ waiting: 0, meetings: 0 }) === "");
  t("one meeting is singular", summarise({ waiting: 0, meetings: 1 }) === "1 meeting");
}

// ------------------------------------------------------------ their work list
{
  t("work is found across spellings", workOf(state, "  priya. ").length === 3,
    workOf(state, "  priya. ").length);
  t("and finished work is left out", workOf(state, "Bob").length === 0);
}

// --------------------------------------------------------------- empty state
{
  t("no data, no roster", roster({}).length === 0);
  t("missing arrays do not throw", roster({ tasks: null, events: undefined }).length === 0);
  t("an attendee with no name is skipped",
    roster({ events: [{ start: "2026-01-01T09:00:00", attendees: [{}] }] }).length === 0);
}

console.log(`\nPeople: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
