/**
 * The number a company actually buys.
 *
 * Enterprise visibility is sold on one promise — you will know who is drowning
 * before the deadline tells you — and that promise is arithmetic, so it can be
 * wrong quietly. A load model that flatters is worse than none: a manager who
 * is told the week fits and then watches it not fit stops opening the screen.
 *
 * So the cases asserted here are the ones where a naive count lies: work that
 * is already late, work with no date on it at all, and eleven small errands
 * next to one enormous rewrite.
 */
import { memberLoad, teamLoad, roomFor, sayLoad, HORIZON, STANDARD_WEEK } from "../src/lib/team.js";

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

// Monday 5 January 2026. Fixed, because a load model tested against "now"
// passes on a Tuesday and fails on a Sunday.
const MON = new Date(2026, 0, 5);
const opts = { today: MON };
const task = (over = {}) => ({ id: Math.random().toString(36), title: "x", estimateMins: 60, done: false, due: null, ...over });
const hours = (n, due) => Array.from({ length: n }, () => task({ estimateMins: 60, due }));

/* ------------------------------------------------------------------ room */
// Seven consecutive days contain five working days whatever day they start
// on, so the room is the same number all week: 5 × 300 minutes.
t("a standard week has 25 hours of room", roomFor(MON) === 1500, roomFor(MON));
t("and the same starting midweek", roomFor(new Date(2026, 0, 8)) === 1500, roomFor(new Date(2026, 0, 8)));
t("a horizon of one working day is one day of room", roomFor(MON, STANDARD_WEEK, 1) === 300);
t("a horizon starting Saturday still spans five working days",
  roomFor(new Date(2026, 0, 10)) === 1500, roomFor(new Date(2026, 0, 10)));

/* -------------------------------------------------------------- one week */
t("no tasks is 'nothing on record', not 'clear'",
  memberLoad([], opts).state === "empty", memberLoad([], opts).state);

t("open work with no dates is clear, not load",
  memberLoad(hours(8), opts).state === "clear" && memberLoad(hours(8), opts).committedMins === 0,
  JSON.stringify(memberLoad(hours(8), opts)));

t("undated work is counted and named separately",
  memberLoad(hours(8), opts).undated === 8);

const ten = memberLoad(hours(10, "2026-01-07"), opts);
t("ten hours against twenty-five is steady", ten.state === "steady", ten.state);

const twentyone = memberLoad(hours(21, "2026-01-07"), opts);
t("twenty-one of twenty-five is full", twentyone.state === "full", `${twentyone.state} ${twentyone.ratio}`);

const thirty = memberLoad(hours(30, "2026-01-07"), opts);
t("thirty hours in a twenty-five hour week is over", thirty.state === "over", thirty.state);
t("and the ratio says by how much", Math.round(thirty.ratio * 100) === 120, thirty.ratio);

/* ------------------------------------------------------------- the late */
// The case a "due this week" filter gets wrong. Somebody with a month of
// backlog and nothing newly due is the most stretched person on the team, and
// a model that only looks forward reports them as having an empty week.
const backlog = memberLoad(hours(30, "2025-12-01"), opts);
t("work already late still counts against the week ahead",
  backlog.state === "over", backlog.state);
t("and is counted as late", backlog.overdue === 30 && backlog.dueSoon === 0,
  `${backlog.overdue}/${backlog.dueSoon}`);
t("the late work itself comes back, oldest first",
  backlog.late.length === 30 && backlog.late[0].due === "2025-12-01");

// Due today is not late.
const todayDue = memberLoad(hours(2, "2026-01-05"), opts);
t("work due today is due, not overdue", todayDue.overdue === 0 && todayDue.dueSoon === 2);

// The last day of the horizon is inside it; the day after is not.
t("the horizon includes its last day",
  memberLoad(hours(1, "2026-01-11"), opts).dueSoon === 1);
t("and excludes the day after",
  memberLoad(hours(1, "2026-01-12"), opts).dueSoon === 0);

/* ------------------------------------------------- estimates, not counts */
// Eleven errands and one rewrite. A count says the errand-runner is busier.
const errands = memberLoad(Array.from({ length: 11 }, () => task({ estimateMins: 10, due: "2026-01-07" })), opts);
const rewrite = memberLoad([task({ estimateMins: 60 * 30, due: "2026-01-07" })], opts);
t("load follows hours, not the number of tasks",
  errands.state === "steady" && rewrite.state === "over",
  `${errands.state}/${rewrite.state}`);
t("even though the count says the opposite", errands.open > rewrite.open);

// A task with no estimate is not free work: it takes the app's own default.
t("an estimate-less task still weighs something",
  memberLoad([task({ estimateMins: undefined, due: "2026-01-07" })], opts).committedMins === 30);

/* ---------------------------------------------------------- done is gone */
t("finished work is not load",
  memberLoad(hours(30, "2026-01-07").map((x) => ({ ...x, done: true })), opts).state === "empty");
t("and neither is deleted work",
  memberLoad(hours(30, "2026-01-07").map((x) => ({ ...x, deletedAt: 1 })), opts).state === "empty");

/* ------------------------------------------------------------- the team */
const team = teamLoad([
  { id: "a", name: "Ana",  tasks: hours(4, "2026-01-07") },
  { id: "b", name: "Bo",   tasks: [] },
  { id: "c", name: "Cass", tasks: hours(40, "2026-01-07") },
], opts);

t("the team is sorted worst first", team.rows[0].name === "Cass", team.rows.map((r) => r.name).join(","));
t("and nothing-on-record sorts last", team.rows[2].name === "Bo", team.rows.map((r) => r.name).join(","));
t("the totals add up", team.totals.open === 44 && team.totals.over === 1 && team.totals.silent === 1,
  JSON.stringify(team.totals));
t("the headline names the person drowning",
  team.headline.startsWith("Cass has more due"), team.headline);

const late = teamLoad([
  { id: "a", name: "Ana", tasks: hours(2, "2025-12-01") },
  { id: "b", name: "Bo",  tasks: hours(2, "2026-01-07") },
], opts);
t("with nobody over, lateness leads", late.headline === "2 tasks across the team are already late.", late.headline);

const calm = teamLoad([
  { id: "a", name: "Ana", tasks: hours(2, "2026-01-07") },
  { id: "b", name: "Bo",  tasks: hours(3, "2026-01-08") },
], opts);
t("and with neither, the good news is allowed to be the news",
  calm.headline === "5 tasks open, and everybody's week fits.", calm.headline);

t("an empty company says so", teamLoad([], opts).headline === "Nobody holds a seat yet.");
t("a company where nobody writes anything down says that instead",
  teamLoad([{ id: "a", name: "Ana", tasks: [] }], opts).headline === "Nobody has anything on record yet.");

/* --------------------------------------------------------------- the copy */
t("the line under a name is hours, not jargon",
  sayLoad(memberLoad(hours(10, "2026-01-07"), opts)) === "10h due · 25h of room",
  sayLoad(memberLoad(hours(10, "2026-01-07"), opts)));
t("and mentions lateness when there is any",
  sayLoad(backlog).endsWith("· 30 late"), sayLoad(backlog));
t("an empty account is not described as having a light week",
  sayLoad(memberLoad([], opts)) === "Nothing on this account yet.");

/* ------------------------------------------------------------ the horizon */
t("the horizon is a week", HORIZON === 7);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
