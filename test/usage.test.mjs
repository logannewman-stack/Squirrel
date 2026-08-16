/**
 * The numbers every upgrade prompt is built on.
 *
 * Four surfaces read this — the rail card, the phone strip, the settings row,
 * and the moment a project is refused — and each of them tells somebody what
 * they can and cannot do. A meter that disagrees with the wall it is warning
 * about is worse than no meter, so the one calculation they all share is
 * pinned here: which limit is closest, when it is worth mentioning, and when
 * the answer is silence.
 */
import { usage, wallReason, PLANS, can } from "../src/lib/plans.js";

let pass = 0, fail = 0;
const failures = [];
const t = (name, ok, detail) => {
  if (ok) pass++; else { fail++; failures.push(name); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const state = ({ plan = "free", projects = 0, tasks = 0, archived = 0, done = 0 } = {}) => ({
  plan,
  projects: [
    ...Array.from({ length: projects }, (_, i) => ({ id: `p${i}`, name: `P${i}` })),
    ...Array.from({ length: archived }, (_, i) => ({ id: `a${i}`, name: `A${i}`, archived: true })),
  ],
  tasks: [
    ...Array.from({ length: tasks }, (_, i) => ({ id: `t${i}`, title: `T${i}` })),
    ...Array.from({ length: done }, (_, i) => ({ id: `d${i}`, title: `D${i}`, done: true })),
  ],
});

// ------------------------------------------------------------------ counting
{
  const u = usage(state({ projects: 1, tasks: 3 }));
  t("a free account is measured against the free caps", u.tier === PLANS.free);
  t("projects are counted", u.meters.find((m) => m.key === "projects").used === 1);
  t("open tasks are counted", u.meters.find((m) => m.key === "tasks").used === 3);
  // The assistant is not metered on any tier. Free cannot use her at all, and
  // a meter that always reads "0 of 0" is furniture on a screen whose job is
  // to say which wall is closest.
  t("the assistant is not a meter on any plan",
    ["free", "pro", "studio"].every((plan) =>
      !usage(state({ plan })).meters.some((m) => m.key === "assists")));

  // Both of these were the bug worth writing the shared function for: a card
  // saying 3/2 because it counted rows the database does not.
  t("an archived project stops taking up room",
    usage(state({ projects: 1, archived: 5 })).meters.find((m) => m.key === "projects").used === 1);
  t("and a finished task stops taking up room",
    usage(state({ tasks: 2, done: 9 })).meters.find((m) => m.key === "tasks").used === 2);
}

// ------------------------------------------------------------------ pressure
{
  t("an empty account is not pressed", usage(state()).pressing === false);
  t("nor nearly full at half a cap",
    usage(state({ projects: 1 })).pressing === false, PLANS.free.projects);

  const full = usage(state({ projects: PLANS.free.projects }));
  t("a reached cap is full", full.full === true);
  t("and is pressing", full.pressing === true);
  t("and names itself as the nearest wall", full.tightest.key === "projects");

  // The one that decides which wall a card leads with. Tasks at 14/15 is
  // tighter than projects at 1/2, and the prompt has to say the true one.
  const mixed = usage(state({ projects: 1, tasks: PLANS.free.tasks - 1 }));
  t("the tightest meter wins, not the first", mixed.tightest.key === "tasks", mixed.tightest.key);

  // Seeded at -1 rather than 0, so all-zero meters still name one.
  t("an untouched account still has a nearest wall", usage(state()).tightest !== null);

  // Free is full when it runs out of room, and room is projects and tasks —
  // the two things it still has. The assistant is not a quantity here.
  t("a free account at its task cap is full",
    usage(state({ tasks: PLANS.free.tasks })).full === true);
}

// --------------------------------------------------------------------- quiet
{
  // Paid accounts are the ones most likely to resent being sold to, and they
  // are the ones the product can least afford to annoy.
  for (const plan of ["pro", "plus", "studio"]) {
    const u = usage(state({ plan, projects: 40, tasks: 300 }));
    t(`${plan} has nothing to meter`, u.meters.length === 0, u.meters.map((m) => m.key));
    t(`${plan} is never pressing`, u.pressing === false);
    t(`${plan} is never full`, u.full === false);
  }

  /**
   * The assistant is allowed or it is not — there is no free allowance left.
   *
   * Free accounts used to get five turns a day. The entitlement is now the
   * whole answer, so the only thing worth asserting is that free is outside it
   * and the paid tiers are inside.
   */
  t("free cannot use the assistant at all", can("free", "assistant") === false);
  t("and every paid tier can",
    ["pro", "plus", "studio"].every((plan) => can(plan, "assistant")));

  // An unknown plan must fall back to the *tightest* interpretation, not the
  // loosest: guessing "unlimited" from a typo gives the app away for free.
  const junk = usage({ plan: "enterprise", projects: [], tasks: [] });
  t("an unrecognised plan is treated as free", junk.tier === PLANS.free && junk.meters.length === 2);
  t("and missing state does not throw", usage(undefined).meters.length === 2);
}

// -------------------------------------------------------------------- wording
{
  const at = { key: "projects", used: 2, cap: 2 };
  const near = { key: "projects", used: 1, cap: 2 };
  t("a reached wall is stated as reached", /at 2 projects/.test(wallReason(at)), wallReason(at));
  t("a near wall is stated as near", /Nearly/.test(wallReason(near)), wallReason(near));
  t("a retired meter says nothing rather than stale copy",
    wallReason({ key: "assists", used: 5, cap: 5 }) === null);
  t("nothing said about nothing", wallReason(null) === null);
  t("an unknown meter says nothing rather than something wrong",
    wallReason({ key: "sessions", used: 1, cap: 2 }) === null);
}

console.log(`\nUsage: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
