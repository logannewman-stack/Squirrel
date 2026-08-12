/**
 * The helix is arithmetic before it is a picture.
 *
 * Purpose draws the whole of somebody's work as one strand — every project a
 * gene, every task a base pair. The drawing is judged by eye, but the mapping
 * underneath it is judged here: which gene sits where, what belongs inside it,
 * what the strand refuses to show. A picture this charged has to be *true* —
 * a done task rendered as open, or a project's gene missing while its card
 * says otherwise, would be the planner contradicting itself in the one place
 * built to show everything agreeing.
 */
import { store, reset, t, report } from "./harness.mjs";
import {
  layoutHelix, hitTest, spinToFace, camYFor, strandPoint, PALETTE,
} from "../src/lib/helix.js";

const TODAY = "2026-08-12";
const lay = (opts = {}) => {
  const s = store.getState();
  return layoutHelix(s.projects, s.tasks, { today: TODAY, ...opts });
};

/* ------------------------------------------------------------ the mapping */
{
  reset();
  const old = store.addProject({ name: "Munich lease" });
  const now = store.addProject({ name: "Q3 launch" });
  // Munich came first in life, whatever order the store happens to hold.
  store.updateProject(old.id, { createdAt: 1000 });
  store.updateProject(now.id, { createdAt: 2000 });
  store.addTask({ title: "Sign", projectId: old.id, estimateMins: 60 });
  store.addTask({ title: "Deck", projectId: now.id, estimateMins: 60 });
  store.addTask({ title: "Loose end", estimateMins: 30 });

  const L = lay();
  t("every live project is a gene", L.segments.filter((s) => s.projectId).length === 2);
  t("  the oldest at the origin", L.segments[0].name === "Munich lease",
    L.segments.map((s) => s.name).join(" → "));
  t("  and unfiled work is the last stretch, never missing",
    L.segments.at(-1).projectId === null);
  t("genes tile the strand in order, without overlap",
    L.segments.every((s, i, a) => s.t0 < s.t1 && (i === 0 || s.t0 > a[i - 1].t1)));
  t("every base pair sits inside its own gene",
    L.rungs.every((r) => {
      const s = L.segments.find((x) => x.projectId === r.projectId);
      return r.t >= s.t0 && r.t <= s.t1;
    }));
  t("each gene takes the next colour in turn",
    L.segments[0].color === PALETTE[0] && L.segments[1].color === PALETTE[1]);
}

/* --------------------------------------------------------- what the rungs say */
{
  reset();
  const p = store.addProject({ name: "P" });
  const done = store.addTask({ title: "Done", projectId: p.id, estimateMins: 30 });
  store.toggleTask(done.id);
  store.addTask({ title: "Late", projectId: p.id, estimateMins: 30, due: "2026-08-01" });
  store.addTask({ title: "Handed", projectId: p.id, estimateMins: 30, delegatedTo: "Anders" });
  store.addTask({ title: "Open", projectId: p.id, estimateMins: 30, due: "2026-12-01" });

  const L = lay();
  const by = Object.fromEntries(L.rungs.map((r) => [r.title, r]));
  t("a finished task is a woven base pair", by.Done.done === true);
  t("overdue means open AND past due — nothing else", by.Late.overdue && !by.Open.overdue && !by.Done.overdue);
  t("delegated work is marked, so it can draw dashed", by.Handed.delegated === true);
  t("the gene counts its own weaving",
    L.segments[0].doneCount === 1 && L.segments[0].count === 4);
}

/* ---------------------------------------------------------- what stays off it */
{
  reset();
  const p = store.addProject({ name: "Old retainer" });
  store.addTask({ title: "Wrapped", projectId: p.id, estimateMins: 30 });
  store.setProjectArchived(p.id);
  t("an archived project leaves the strand", lay().empty === true);
  t("  unless asked back", lay({ includeArchived: true }).segments.length === 1);

  reset();
  t("no work at all is an honest empty, not a crash",
    lay().empty === true && lay().segments.length === 0);
}

/* ------------------------------------------------------------- proportion */
{
  reset();
  const big = store.addProject({ name: "Monster" });
  const small = store.addProject({ name: "Seed" });
  for (let i = 0; i < 40; i++) store.addTask({ title: `M${i}`, projectId: big.id, estimateMins: 15 });
  store.addTask({ title: "S", projectId: small.id, estimateMins: 15 });

  const L = lay();
  const sm = L.segments.find((s) => s.name === "Seed");
  const bg = L.segments.find((s) => s.name === "Monster");
  t("a forty-task monster cannot crush its neighbour to a sliver",
    (sm.t1 - sm.t0) > (bg.t1 - bg.t0) / 8,
    `${(sm.t1 - sm.t0).toFixed(3)} vs ${(bg.t1 - bg.t0).toFixed(3)}`);
  t("and the twist stays in the ladder range, never the slinky's",
    L.turns >= 1.8 && L.turns <= 3.2, L.turns);
}

/* ------------------------------------------------------------ the hand's math */
{
  const drawn = [{ x: 100, y: 100, projectId: "a" }, { x: 130, y: 100, projectId: "b" }];
  t("a tap lands on the nearest base pair within a fingertip",
    hitTest(drawn, 108, 102).projectId === "a");
  t("  and on nothing outside one", hitTest(drawn, 200, 200) === null);

  reset();
  store.addProject({ name: "A" });
  store.addProject({ name: "B" });
  store.addTask({ title: "x", projectId: store.getState().projects[0].id, estimateMins: 30 });
  const L = lay();
  for (const spin of [-9, 0, 7.3]) {
    const target = spinToFace(L.segments[1], L, spin);
    t(`facing a gene turns the short way round (from ${spin})`,
      Math.abs(target - spin) <= Math.PI + 1e-9, Math.abs(target - spin));
  }
  t("centring a gene is exact at the middle", Math.abs(camYFor({ mid: 0.5 }, 700)) < 1e-9);
  const p0 = strandPoint(0, 0, { turns: 2, height: 700, radius: 100 });
  const p1 = strandPoint(1, 0, { turns: 2, height: 700, radius: 100 });
  t("the strand spans its height bottom to top", p0.y === -350 && p1.y === 350);
}

/* ----------------------------------------------------- meaning survives */
/**
 * The one field Purpose writes. It has to round-trip the store — and the sync
 * mapping, which drops any column it has not been told about, is covered by
 * the merge suite's field lists.
 */
{
  reset();
  const p = store.addProject({ name: "Q3 launch" });
  store.updateProject(p.id, { meaning: "The quarter we stop being a secret." });
  t("a strand's meaning is kept",
    store.getState().projects[0].meaning === "The quarter we stop being a secret.");
  store.undo();
  t("  and writing it is undoable like everything else",
    !store.getState().projects[0].meaning);
}

report("Helix");
