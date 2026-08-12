/**
 * The oak is arithmetic before it is a picture.
 *
 * Purpose draws the whole of somebody's work as one tree — every project a
 * branch, every task an acorn, finished work stored away gold. The drawing is
 * judged by eye; the mapping underneath is judged here: which branch grows
 * where, what hangs on it, what lies fallen at the roots, and whether the
 * squirrel can actually find what it is asked to. A picture this charged has
 * to be true — a done task drawn unripe, or a branch missing while its card
 * says otherwise, would be the planner contradicting itself in the one place
 * built to show everything agreeing.
 */
import { store, reset, t, report } from "./harness.mjs";
import {
  layoutOak, hitTest, perchFor, geometryFor, findOnTree, branchPoint, trunkTopT, PALETTE,
} from "../src/lib/oak.js";

const TODAY = "2026-08-12";
const grow = (opts = {}) => {
  const s = store.getState();
  return layoutOak(s.projects, s.tasks, { today: TODAY, ...opts });
};

/* ------------------------------------------------------------ the mapping */
{
  reset();
  const old = store.addProject({ name: "Munich lease" });
  const now = store.addProject({ name: "Q3 launch" });
  store.updateProject(old.id, { createdAt: 1000 });
  store.updateProject(now.id, { createdAt: 2000 });
  store.addTask({ title: "Sign", projectId: old.id, estimateMins: 60 });
  store.addTask({ title: "Deck", projectId: now.id, estimateMins: 60 });
  store.addTask({ title: "Loose end", estimateMins: 30 });

  const L = grow();
  t("every live project is a branch", L.branches.length === 2);
  t("  the oldest lowest on the trunk, the way wood works",
    L.branches[0].name === "Munich lease" && L.branches[0].baseT < L.branches[1].baseT,
    L.branches.map((b) => `${b.name}@${b.baseT.toFixed(2)}`).join(" "));
  t("  and thicker", L.branches[0].thick > L.branches[1].thick);
  t("unfiled work lies fallen at the roots, never missing",
    L.ground.length === 1 && L.ground[0].title === "Loose end");
  t("branches alternate sides, so the crown balances",
    L.branches[0].side !== L.branches[1].side);
  t("each branch takes the next ink in turn",
    L.branches[0].color === PALETTE[0] && L.branches[1].color === PALETTE[1]);
  t("the count over the door is every acorn, hung or fallen",
    L.counts.total === 3, L.counts.total);
}

/* --------------------------------------------------------- what the acorns say */
{
  reset();
  const p = store.addProject({ name: "P" });
  const done = store.addTask({ title: "Done", projectId: p.id, estimateMins: 30 });
  store.toggleTask(done.id);
  store.addTask({ title: "Late", projectId: p.id, estimateMins: 30, due: "2026-08-01" });
  store.addTask({ title: "Handed", projectId: p.id, estimateMins: 30, delegatedTo: "Anders" });
  store.addTask({ title: "Open", projectId: p.id, estimateMins: 30, due: "2026-12-01" });

  const b = grow().branches[0];
  const by = Object.fromEntries(b.acorns.map((a) => [a.title, a]));
  t("a finished task is a stored acorn", by.Done.done === true);
  t("overdue means open AND past due — nothing else",
    by.Late.overdue && !by.Open.overdue && !by.Done.overdue);
  t("delegated work hangs by an agreement, marked for the dashed stem",
    by.Handed.delegated === true);
  t("the branch counts its own store", b.doneCount === 1 && b.count === 4);
  t("acorns hang strictly along their own branch",
    b.acorns.every((a) => a.t > 0.3 && a.t <= 0.96), JSON.stringify(b.acorns.map((a) => a.t)));
}

/* ---------------------------------------------------------- what stays off it */
{
  reset();
  const p = store.addProject({ name: "Old retainer" });
  store.addTask({ title: "Wrapped", projectId: p.id, estimateMins: 30 });
  store.setProjectArchived(p.id);
  const L = grow();
  t("an archived project leaves the tree", L.branches.length === 0);
  t("  without dragging its work to the roots — it is shelved, not fallen",
    L.ground.length === 0);

  reset();
  t("no work at all is an honest bare oak, not a crash",
    grow().empty === true && grow().branches.length === 0);
}

/* --------------------------------------------------------------- the geometry */
{
  reset();
  const a = store.addProject({ name: "A" });
  for (let i = 0; i < 6; i++) store.addTask({ title: `t${i}`, projectId: a.id, estimateMins: 15 });
  const L = grow();
  const geo = geometryFor(1440, 900);
  const b = L.branches[0];
  const socket = branchPoint(b, 0, geo, 0, 0);
  const tip = branchPoint(b, 1, geo, 0, 0);
  t("a branch leaves the trunk and climbs", tip.y < socket.y,
    `${socket.y.toFixed(0)} → ${tip.y.toFixed(0)}`);
  t("  reaching outward on its own side",
    Math.sign(tip.x - socket.x) === b.side);
  t("  and stays inside the sky", tip.y > 900 * 0.05 && tip.x > 0 && tip.x < 1440);
  t("the trunk ends just past the last socket, not at an abstract line",
    trunkTopT(L) <= Math.max(...L.branches.map((x) => x.baseT)) + 0.11);
  t("wind moves the tip more than the socket",
    Math.abs(branchPoint(b, 1, geo, 0, 1).x - tip.x) >
    Math.abs(branchPoint(b, 0.1, geo, 0, 1).x - branchPoint(b, 0.1, geo, 0, 0).x));
}

/* ------------------------------------------------------------ the hand's math */
{
  const drawn = {
    squirrel: { x: 300, y: 100 },
    targets: [{ x: 100, y: 100, projectId: "a" }, { x: 130, y: 100, projectId: "b" }],
  };
  t("a tap lands on the nearest acorn within a fingertip",
    hitTest(drawn, 108, 102).projectId === "a");
  t("  and on nothing outside one", hitTest(drawn, 200, 200) === null);
  t("the squirrel wins its own square — it is the smallest and most alive",
    hitTest(drawn, 310, 108).squirrel === true);
}

/* ------------------------------------------------------------- the squirrel */
{
  reset();
  const a = store.addProject({ name: "A" });
  const b = store.addProject({ name: "B" });
  store.addTask({ title: "x", projectId: a.id, estimateMins: 30 });
  store.addTask({ title: "y", projectId: b.id, estimateMins: 30 });
  const L = grow();
  const geo = geometryFor(1440, 900);

  const home = perchFor(null, L, geo);
  t("unbidden, the squirrel keeps lookout at the crown",
    home.branch === null && home.y < 900 * 0.5, JSON.stringify(home));

  const out = perchFor(b.id, L, geo);
  const mid = branchPoint(L.branches[1], 0.62, geo, 0, 0);
  t("selected, it runs to perch on that branch",
    out.branch?.projectId === b.id && Math.abs(out.x - mid.x) < 1 && out.y < mid.y,
    JSON.stringify(out));
}

/* -------------------------------------------------------------- the finding */
{
  reset();
  const lease = store.addProject({ name: "Munich lease" });
  const launch = store.addProject({ name: "Q3 launch" });
  store.addTask({ title: "Sign the lease", projectId: lease.id, estimateMins: 60 });
  store.addTask({ title: "Board deck", projectId: launch.id, estimateMins: 60 });
  store.addTask({ title: "Loose lease note", estimateMins: 15 });
  const L = grow();

  const f = findOnTree(L, "lease");
  t("the squirrel finds by any word", f.results.length === 3, JSON.stringify(f.results.map((r) => r.label)));
  t("  lighting the branches that answer",
    f.branchIds.has(lease.id) && !f.branchIds.has(launch.id));
  t("  and the acorns themselves, fallen ones included",
    f.acornIds.size === 2);
  t("  each result naming its branch",
    f.results.every((r) => r.kind === "project" || r.branch), JSON.stringify(f.results));

  const two = findOnTree(L, "sign lease");
  t("every typed word must answer — 'sign lease' is one acorn, not a union",
    two.results.length === 1 && two.results[0].label === "Sign the lease");

  t("an empty ask is no search at all", findOnTree(L, "  ") === null);
  t("and a miss is an empty hand, not a crash",
    findOnTree(L, "zeppelin").results.length === 0);
}

/* ----------------------------------------------------- meaning survives */
{
  reset();
  const p = store.addProject({ name: "Q3 launch" });
  store.updateProject(p.id, { meaning: "The quarter we stop being a secret." });
  t("a branch's meaning is kept",
    store.getState().projects[0].meaning === "The quarter we stop being a secret.");
  store.undo();
  t("  and writing it is undoable like everything else",
    !store.getState().projects[0].meaning);
}

report("Oak");
