/**
 * The geometry of a life's work, as a double helix.
 *
 * Every project is a gene: a contiguous segment of the strand, sized by how
 * much has gone into it. Every task is a base pair: one rung between the two
 * backbones, placed in the order the work actually happened. The strand reads
 * bottom to top the way time runs, so the oldest commitment sits at the origin
 * and the newest work is still being written at the top.
 *
 * All of it is pure arithmetic — no canvas, no DOM — so the mapping from a
 * store full of projects to a strand full of genes can be tested the same way
 * the planner is: by running it.
 */

/** Neon on black; ink on paper. Each project takes the next pair in turn. */
export const PALETTE = [
  { name: "cyan",    dark: "#39d8f5", light: "#0b8fac" },
  { name: "magenta", dark: "#f26df9", light: "#a21caf" },
  { name: "lime",    dark: "#b8f34e", light: "#4d7c0f" },
  { name: "amber",   dark: "#ffc44d", light: "#b45309" },
  { name: "violet",  dark: "#a78bfa", light: "#6d28d9" },
  { name: "coral",   dark: "#ff7d8f", light: "#be123c" },
  { name: "mint",    dark: "#5eead4", light: "#0f766e" },
  { name: "gold",    dark: "#fde047", light: "#a16207" },
];

/** The unfiled pile is part of the strand too — faint, but never invisible. */
export const UNFILED_COLOR = { name: "unfiled", dark: "#8b93a7", light: "#64748b" };

/**
 * Lay projects and tasks out along the strand.
 *
 * Segments are ordered by when each project entered the person's life, and
 * sized by the square root of the work in them — linear sizing let one
 * forty-task monster crush every other gene to a sliver, and a strand where
 * only one project is legible defeats the reason to draw one.
 *
 * @returns {{segments, rungs, turns, empty}}
 *   segments [{projectId, name, color, t0, t1, mid, count, doneCount, archived}]
 *   rungs    [{taskId, projectId, t, done, overdue, delegated, color, title}]
 *   turns    how many full twists the strand makes — grows gently with size
 */
export function layoutHelix(projects = [], tasks = [], opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const live = projects
    .filter((p) => !p.archived || opts.includeArchived)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  const byProject = new Map(live.map((p) => [p.id, []]));
  const unfiled = [];
  for (const t of tasks) {
    if (byProject.has(t.projectId)) byProject.get(t.projectId).push(t);
    else if (!t.projectId) unfiled.push(t);
  }

  const groups = live.map((p, i) => ({
    project: p,
    tasks: byProject.get(p.id).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
    color: PALETTE[i % PALETTE.length],
  }));
  if (unfiled.length) {
    groups.push({
      project: { id: null, name: "Unfiled", createdAt: Infinity },
      tasks: unfiled.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
      color: UNFILED_COLOR,
    });
  }

  if (!groups.length) return { segments: [], rungs: [], turns: 3, empty: true };

  // Weight, then normalise to [0,1] with a small gap between genes so the
  // boundary is legible even where two neighbours share a colour family.
  const GAP = 0.018;
  const weights = groups.map((g) => Math.sqrt(g.tasks.length + 2));
  const total = weights.reduce((n, w) => n + w, 0);
  const usable = 1 - GAP * (groups.length - 1);

  const segments = [];
  const rungs = [];
  let cursor = 0;
  groups.forEach((g, i) => {
    const span = (weights[i] / total) * usable;
    const t0 = cursor;
    const t1 = cursor + span;
    cursor = t1 + GAP;

    const done = g.tasks.filter((t) => t.done).length;
    segments.push({
      projectId: g.project.id,
      name: g.project.name,
      color: g.color,
      t0, t1,
      mid: (t0 + t1) / 2,
      count: g.tasks.length,
      doneCount: done,
      archived: !!g.project.archived,
    });

    // Rungs sit strictly inside the gene, padded off its ends so the first
    // task never melts into the boundary gap.
    const pad = span * 0.08;
    g.tasks.forEach((t, j) => {
      const f = g.tasks.length === 1 ? 0.5 : j / (g.tasks.length - 1);
      rungs.push({
        taskId: t.id,
        projectId: g.project.id,
        t: t0 + pad + f * (span - pad * 2),
        done: !!t.done,
        overdue: !t.done && !!t.due && t.due < today,
        delegated: !!t.delegatedTo,
        color: g.color,
        title: t.title,
      });
    });
  });

  // Far fewer turns than instinct suggests. Real B-DNA's pitch is about 3.4x
  // its radius — the molecule is much straighter than people draw it — and the
  // first render here proved the instinct wrong: at a turn per gene the strand
  // read as a coiled spring, and the rungs, which are the entire point, were
  // lost crossing the coil at odd angles. Two-and-some turns is where it stops
  // being a slinky and becomes a ladder gently twisting.
  const turns = Math.max(1.8, Math.min(3.2, groups.length * 0.3 + 1.0));
  return { segments, rungs, turns, empty: false };
}

/**
 * A point on one backbone, in world units.
 *
 * `t` runs 0→1 bottom→top. `phase` is 0 for one backbone, π for the other.
 * `spin` is the user's rotation plus the idle drift. `breathe` widens the
 * radius a couple of percent on a slow cycle so the thing reads as alive
 * rather than rendered.
 */
export function strandPoint(t, phase, { turns, spin = 0, height = 900, radius = 110, breathe = 0 }) {
  const angle = t * turns * Math.PI * 2 + phase + spin;
  const r = radius * (1 + breathe);
  return {
    x: Math.cos(angle) * r,
    y: (t - 0.5) * height,
    z: Math.sin(angle) * r,
    angle,
  };
}

/**
 * World → screen. Camera sits on -z looking at the origin; a gentle fixed
 * tilt keeps the top of the strand leaning away, which is what makes it read
 * as an object in a room rather than a diagram on a plane.
 */
export function project(p, cam) {
  const tilt = cam.tilt ?? 0.16;
  const cy = p.y - (cam.y ?? 0);
  const y = cy * Math.cos(tilt) - p.z * Math.sin(tilt);
  const z = cy * Math.sin(tilt) + p.z * Math.cos(tilt);
  const f = cam.f ?? 900;
  const s = f / (f + z + (cam.dolly ?? 0));
  return {
    x: cam.cx + p.x * s * (cam.zoom ?? 1),
    y: cam.cyPx - y * s * (cam.zoom ?? 1),
    s,
    z,
  };
}

/**
 * Which rung, if any, is under a finger.
 *
 * Screen-space, against the positions the last frame actually drew — the only
 * geometry that is guaranteed to be what the person is pointing at. The
 * threshold is finger-sized, not cursor-sized: 26px covers a fingertip at 1x.
 */
export function hitTest(drawn, x, y, threshold = 26) {
  let best = null;
  let bestD = threshold * threshold;
  for (const d of drawn) {
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
 * The spin that brings a gene to face the camera.
 *
 * The camera looks down -z→+z, so "facing" means the segment's midpoint sits
 * at minimum z: angle ≡ -π/2. Returned as the nearest equivalent to the
 * current spin so the ease travels the short way round, never a full lap.
 */
export function spinToFace(segment, layout, currentSpin, opts = {}) {
  const turns = layout.turns;
  const midAngleAtZeroSpin = segment.mid * turns * Math.PI * 2;
  let target = -Math.PI / 2 - midAngleAtZeroSpin;
  const TAU = Math.PI * 2;
  while (target < currentSpin - Math.PI) target += TAU;
  while (target > currentSpin + Math.PI) target -= TAU;
  return target;
}

/** The camera height that centres a gene on screen. */
export const camYFor = (segment, height = 900) => (segment.mid - 0.5) * height;
