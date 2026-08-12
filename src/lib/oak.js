/**
 * The geometry of a life's work, as one oak.
 *
 * Mighty oaks from little acorns grow — the proverb is the product: small
 * tasks, repeated, become the whole tree. Every live project is a branch,
 * every task an acorn on it: open acorns hang dim and unripe, finished ones
 * glow gold — stored away, the way the app's own name promises. Unfiled work
 * lies at the roots, fallen and not on any branch yet. And the squirrel lives
 * here: perched on whatever you are reading, and ready to run and find
 * anything you ask it to.
 *
 * All pure arithmetic — no canvas, no DOM — so the mapping from a store full
 * of projects to a tree full of branches is tested the way the planner is:
 * by running it.
 */

/**
 * One ink — the app's own (`--ink`: #fafafa on dark, #0a0a0a on paper).
 *
 * The first tree gave every branch its own colour, and it read as somebody
 * else's app: Squirrel is monochrome everywhere, ink on paper with a single
 * alert accent, and the oak has to belong to it. A branch's identity is its
 * place on the trunk and its name, not a hue; the renderer spends the one
 * accent (`--alert`) on overdue acorns only, the same way the rest of the
 * app spends colour. Kept as a list so a future ink still slots in.
 */
export const PALETTE = [
  { name: "ink", dark: "#fafafa", light: "#0a0a0a" },
];

/** Deterministic per-id variety, so the same tree grows the same way twice. */
export function hashOf(str = "") {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/**
 * Lay projects and tasks onto the tree.
 *
 * Branches are ordered by when each project entered the person's life — the
 * oldest lowest on the trunk and thickest, the way real wood works. Length
 * grows with the square root of the work on it, so a forty-task monster is a
 * long bough rather than a scene-crushing one.
 *
 * @returns {{branches, ground, counts, empty}}
 *   branches [{projectId, name, color, side, baseT, len, thick, lean, phase,
 *              acorns: [{taskId, t, done, overdue, delegated, title}]}]
 *   ground   fallen acorns for unfiled work [{taskId, done, overdue, title, spot}]
 */
export function layoutOak(projects = [], tasks = [], opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const live = projects
    .filter((p) => !p.archived)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  const byProject = new Map(live.map((p) => [p.id, []]));
  const ground = [];
  for (const t of tasks) {
    if (byProject.has(t.projectId)) byProject.get(t.projectId).push(t);
    else if (!t.projectId) {
      ground.push({
        taskId: t.id,
        title: t.title,
        done: !!t.done,
        overdue: !t.done && !!t.due && t.due < today,
        spot: hashOf(t.id),
      });
    }
  }

  if (!live.length && !ground.length) {
    return { branches: [], ground: [], counts: { done: 0, total: 0 }, empty: true };
  }

  /**
   * Sub-projects grow off their parent's branch — one level deep, the way a
   * bough carries side shoots. The rule is written to never hide work: a
   * project whose parent is missing, archived, or itself a sub is treated as
   * a branch of the trunk. Ancestry is a drawing decision, not custody.
   */
  const liveById = new Map(live.map((p) => [p.id, p]));
  const isRoot = (p) => {
    const host = p.parentId ? liveById.get(p.parentId) : null;
    if (!host) return true;
    const grand = host.parentId ? liveById.get(host.parentId) : null;
    return Boolean(grand); // the host is itself a sub → this one climbs to the trunk
  };
  const roots = live.filter(isRoot);
  const rootIds = new Set(roots.map((p) => p.id));
  const subsOf = new Map(roots.map((p) => [p.id, []]));
  for (const p of live) if (!rootIds.has(p.id)) subsOf.get(p.parentId).push(p);

  const most = Math.max(1, ...live.map((p) => byProject.get(p.id).length));
  const acornsFor = (mine) =>
    mine.map((t, j) => ({
      taskId: t.id,
      title: t.title,
      // Strung from mid-branch to the tip, oldest nearest the trunk.
      t: mine.length === 1 ? 0.7 : 0.42 + (j / (mine.length - 1)) * 0.53,
      done: !!t.done,
      overdue: !t.done && !!t.due && t.due < today,
      delegated: !!t.delegatedTo,
    }));
  const work = (id) => byProject.get(id).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  /**
   * The flat list is ordered the way the tree is read: each trunk branch,
   * then the shoots growing off it, then the next branch — so the keyboard
   * walks parent-to-children without knowing the difference.
   */
  const branches = [];
  roots.forEach((p, i) => {
    const mine = work(p.id);
    const jitter = hashOf(p.id);
    const root = {
      projectId: p.id,
      name: p.name,
      color: PALETTE[i % PALETTE.length],
      /**
       * Alternating sides keep the crown balanced; the hash nudges each
       * branch's height and lean so the tree reads grown, not plotted.
       */
      side: i % 2 === 0 ? 1 : -1,
      baseT: roots.length === 1 ? 0.55 : 0.28 + (i / (roots.length - 1)) * 0.5 + (jitter - 0.5) * 0.04,
      len: 0.5 + 0.5 * Math.sqrt((mine.length + 1) / (most + 1)),
      thick: 1 - (i / Math.max(1, roots.length)) * 0.45,
      lean: 0.26 + jitter * 0.2,
      phase: jitter * Math.PI * 2,
      count: mine.length,
      doneCount: mine.filter((t) => t.done).length,
      acorns: acornsFor(mine),
    };
    branches.push(root);
    subsOf.get(p.id).forEach((s, j, arr) => {
      const theirs = work(s.id);
      const sj = hashOf(s.id);
      branches.push({
        projectId: s.id,
        name: s.name,
        color: PALETTE[0],
        host: root,
        // Spaced along the outer half of the parent, oldest nearest the trunk.
        socketT: arr.length === 1 ? 0.62 : 0.46 + (j / (arr.length - 1)) * 0.34 + (sj - 0.5) * 0.03,
        side: root.side,
        len: 0.24 + 0.22 * Math.sqrt((theirs.length + 1) / (most + 1)),
        thick: root.thick * 0.5,
        lean: 0.48 + sj * 0.2, // side shoots climb — steeper than the bough that carries them
        phase: sj * Math.PI * 2,
        count: theirs.length,
        doneCount: theirs.filter((t) => t.done).length,
        acorns: acornsFor(theirs),
      });
    });
  });

  const all = tasks.filter((t) => byProject.has(t.projectId) || !t.projectId);
  return {
    branches,
    ground,
    counts: { done: all.filter((t) => t.done).length, total: all.length },
    empty: false,
  };
}

/**
 * A point along one branch, in world units, wind included.
 *
 * The branch is a quadratic curve from its trunk socket, rising as it goes.
 * Wind rotates it around the socket by an angle that grows toward the tip —
 * wood bends more the further from the trunk — which is what makes the sway
 * read as weight rather than as the whole image wobbling.
 */
export function branchPoint(b, t, geo, time = 0, gust = 0) {
  // A sub-branch's socket is a point on the wood that carries it — computed
  // with the parent's own sway, so the shoot rides the bough in the wind.
  const socket = b.host
    ? branchPoint(b.host, b.socketT, geo, time, gust)
    : trunkPoint(b.baseT, geo);
  const dir = b.side;
  const len = geo.reach * b.len;
  // A bough, not a spoke: it leaves the trunk climbing steeply, arches, and
  // reaches out nearly level, with a last little upturn at the tip — a cubic,
  // because wood has two bends in it.
  const c1x = socket.x + dir * len * 0.18;
  const c1y = socket.y - len * (0.34 + b.lean * 0.3);
  const c2x = socket.x + dir * len * 0.66;
  const c2y = socket.y - len * (b.lean + 0.16);
  const tx = socket.x + dir * len;
  const ty = socket.y - len * (b.lean + 0.05);

  const cu = (a, c1, c2, z, tt) => {
    const u = 1 - tt;
    return u * u * u * a + 3 * u * u * tt * c1 + 3 * u * tt * tt * c2 + tt * tt * tt * z;
  };
  let x = cu(socket.x, c1x, c2x, tx, t);
  let y = cu(socket.y, c1y, c2y, ty, t);

  const sway = (Math.sin(time / 1300 + b.phase) * 0.012 + gust * 0.02) * t * t;
  if (sway) {
    const dx = x - socket.x;
    const dy = y - socket.y;
    const cos = Math.cos(sway * dir);
    const sin = Math.sin(sway * dir);
    x = socket.x + dx * cos - dy * sin;
    y = socket.y + dx * sin + dy * cos;
  }
  return { x, y };
}

/** The trunk's centreline: rooted at the ground, easing to the crown. */
export function trunkPoint(t, geo) {
  const bend = Math.sin(t * Math.PI) * geo.reach * 0.045;
  return {
    x: geo.baseX + bend,
    y: geo.groundY - (geo.groundY - geo.crownY) * t,
  };
}

/** World geometry from the canvas size — one place, so every layer agrees. */
export function geometryFor(w, h) {
  return {
    baseX: w * 0.46,
    groundY: h * 0.87,
    crownY: h * 0.2,
    reach: Math.min(w * 0.32, h * 0.44),
  };
}

/** Where the wood stops: a little past the highest trunk socket. Sub-branches
 *  live on their parents, not the trunk, so they don't raise it. */
export const trunkTopT = (layout) =>
  Math.min(1, layout.branches.reduce((m, b) => (b.baseT != null ? Math.max(m, b.baseT) : m), 0.5) + 0.1);

/**
 * Which drawn thing, if any, is under a finger.
 * Screen-space, against what the last frame actually drew; 26px covers a
 * fingertip. The squirrel wins ties — it is the smallest and the most alive —
 * and its thought bubble counts as the squirrel: touching the question is
 * the most literal way to ask it.
 */
export function hitTest(drawn, x, y, threshold = 26) {
  const bb = drawn.bubble;
  if (bb && x >= bb.x - 4 && x <= bb.x + bb.w + 4 && y >= bb.y - 4 && y <= bb.y + bb.h + 4) {
    return { squirrel: true };
  }
  const sq = drawn.squirrel;
  if (sq && Math.hypot(sq.x - x, sq.y - y) < threshold + 8) return { squirrel: true };
  let best = null;
  let bestD = threshold * threshold;
  for (const d of drawn.targets || []) {
    const dx = d.x - x;
    const dy = d.y - y;
    const dd = dx * dx + dy * dy;
    if (dd < bestD) {
      bestD = dd;
      best = d;
    }
  }
  return best;
}

/**
 * Where the squirrel sits.
 *
 * On nothing selected it keeps lookout from the crown. Select a branch and it
 * runs to perch a little past the middle, above the wood, facing the acorns
 * it is showing you.
 */
export function perchFor(selection, layout, geo) {
  const branch = layout.branches.find((b) => b.projectId === selection);
  if (!branch) {
    const top = trunkPoint(trunkTopT(layout), geo);
    return { x: top.x, y: top.y - 4, side: 1, branch: null };
  }
  const p = branchPoint(branch, 0.62, geo, 0, 0);
  return { x: p.x, y: p.y - 7, side: branch.side, branch };
}

/**
 * The finder's matching: which branches and acorns answer a query.
 *
 * Token match, the same spirit as lib/search.js: every word the person typed
 * has to appear somewhere in the name. Returns ids so the renderer can dim
 * everything else and the squirrel can run to the best branch.
 */
export function findOnTree(layout, q) {
  const words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const has = (text) => {
    const s = String(text || "").toLowerCase();
    return words.every((w) => s.includes(w));
  };
  const branchIds = new Set();
  const acornIds = new Set();
  const results = [];
  for (const b of layout.branches) {
    if (has(b.name)) {
      branchIds.add(b.projectId);
      results.push({ kind: "project", id: b.projectId, label: b.name });
    }
    for (const a of b.acorns) {
      if (has(a.title)) {
        branchIds.add(b.projectId);
        acornIds.add(a.taskId);
        results.push({ kind: "task", id: a.taskId, projectId: b.projectId, label: a.title, branch: b.name });
      }
    }
  }
  for (const g of layout.ground) {
    if (has(g.title)) {
      acornIds.add(g.taskId);
      results.push({ kind: "task", id: g.taskId, projectId: null, label: g.title, branch: "Unfiled" });
    }
  }
  return { branchIds, acornIds, results: results.slice(0, 8) };
}
