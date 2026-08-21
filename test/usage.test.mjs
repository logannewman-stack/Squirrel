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

// ------------------------------------------------------------------ locked
/**
 * There is no capped-but-usable tier any more.
 *
 * A paid plan is unlimited and everything else is a wall at zero, so the
 * meters stopped being a gauge. The arithmetic that drove them is the reason
 * this block exists: `used / cap` against a cap of nothing is Infinity when
 * somebody has work and NaN when they do not, and a card that reads "1 of 0"
 * or "NaN%" is worse than one that says plainly that the trial ended.
 */
{
  const out = usage(state({ projects: 3, tasks: 9 }));
  t("an account with no plan is locked, not nearly full", out.locked === true);
  t("  and reports no meters to draw", out.meters.length === 0, out.meters.map((m) => m.key));
  t("  and names no nearest wall, because the wall is the plan", out.tightest === null);
  t("  and still answers the old questions safely",
    out.full === true && out.pressing === true);

  // The state that produced NaN: nothing created, nothing allowed.
  const empty = usage(state());
  t("an empty locked account does not produce NaN",
    empty.locked === true && empty.full === true);

  t("the assistant is not a meter on any plan",
    ["free", "pro", "studio"].every((plan) =>
      !usage(state({ plan })).meters.some((m) => m.key === "assists")));
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
    t(`${plan} is never locked`, u.locked === false);
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
  // An unknown plan must fall back to the *tightest* reading, not the loosest:
  // guessing "unlimited" from a typo gives the product away.
  const junk = usage({ plan: "enterprise", projects: [], tasks: [] });
  t("an unrecognised plan is treated as no plan", junk.tier === PLANS.free && junk.locked === true);
  t("and missing state does not throw", usage(undefined).locked === true);
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
