/**
 * Drawing the strand.
 *
 * One canvas, no libraries. The 3D is done by hand — rotate, tilt, perspective
 * divide — because a double helix is two sine waves and a bundle of rungs, and
 * shipping a six-hundred-kilobyte engine to draw that would be absurd in an
 * app that promises to work offline forever.
 *
 * Everything is drawn with the painter's algorithm: every primitive (a short
 * arc of backbone, a rung, an orb) knows its depth, the lot is sorted far to
 * near, and the far half naturally dims and thins with distance. That depth
 * falloff — not any single effect — is what makes it read as an object
 * floating in a room rather than a diagram.
 *
 * In the dark the strand is drawn twice per primitive on an additive
 * composite: a wide, faint pass that bleeds light, then a hot core. On paper
 * (light mode) additive blending would wash to white, so the halo becomes a
 * soft normal-composite underlay instead — same geometry, different physics,
 * the way neon signage photographs differently at noon.
 */
import { strandPoint, project } from "./helix.js";

const SAMPLES = 420;

/** Deterministic dust, so the room is stable between frames and reloads. */
function makeDust(count = 130, seed = 7) {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: count }, () => ({
    a: rand() * Math.PI * 2,
    r: 190 + rand() * 320,
    y: (rand() - 0.5) * 1150,
    size: 0.6 + rand() * 1.5,
    drift: 0.02 + rand() * 0.05,
    tw: rand() * Math.PI * 2,
  }));
}
const DUST = makeDust();

const hex = (c, a) => {
  const n = parseInt(c.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/** Which gene owns this point of the strand, if any (gaps own nothing). */
function segmentAt(t, segments) {
  for (const s of segments) if (t >= s.t0 && t <= s.t1) return s;
  return null;
}

/**
 * Draw one frame.
 *
 * @param view {spin, camY, zoom, dolly, selection, dim, t, reduced}
 *   `dim` is 0..1 — how far non-selected genes have faded, eased by the caller
 *   so selection changes glide rather than cut.
 * @returns {{rungs, labels}} screen-space records for hit testing.
 */
export function drawHelix(ctx, w, h, layout, view, theme) {
  const dark = theme.mode !== "light";
  const t = view.t || 0;
  const narrow = w < 560;
  const cam = {
    cx: w / 2,
    // On a phone the header floats over the top of the room, so the strand
    // hangs a little lower — otherwise its first label and the screen's own
    // title fight over the same corner.
    cyPx: h * (narrow ? 0.55 : 0.5),
    y: view.camY || 0,
    f: 950,
    dolly: view.dolly || 0,
    zoom: view.zoom || 1,
    tilt: 0.16,
  };
  const opts = {
    turns: layout.turns,
    spin: view.spin,
    // Fits inside the frame with air above and below — the first render bled
    // off both edges, and a specimen you cannot see the ends of reads as a
    // texture rather than a thing.
    height: h * (narrow ? 0.66 : 0.78),
    radius: Math.min(150, w * 0.17),
    breathe: view.reduced ? 0 : Math.sin(t / 2600) * 0.02,
  };

  /* ------------------------------------------------------------- the room */
  const vg = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) * 0.75);
  if (dark) {
    vg.addColorStop(0, "#070910");
    vg.addColorStop(0.55, "#04050b");
    vg.addColorStop(1, "#010103");
  } else {
    vg.addColorStop(0, "#fdfdfb");
    vg.addColorStop(0.6, "#f6f6f2");
    vg.addColorStop(1, "#ebebe5");
  }
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);

  // Dust drifts against the spin — cheap parallax, and the first thing that
  // makes dragging feel like moving through a space rather than spinning a gif.
  for (const d of DUST) {
    const a = d.a + (view.reduced ? 0 : t * 0.00002) - view.spin * 0.25;
    const p = project({ x: Math.cos(a) * d.r, y: d.y, z: Math.sin(a) * d.r }, cam);
    if (p.s <= 0) continue;
    const twinkle = view.reduced ? 0.5 : 0.35 + 0.3 * Math.sin(t / 900 + d.tw);
    ctx.fillStyle = dark
      ? `rgba(160,180,220,${0.05 + 0.1 * p.s * twinkle})`
      : `rgba(70,80,100,${0.03 + 0.05 * p.s * twinkle})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, d.size * p.s, 0, Math.PI * 2);
    ctx.fill();
  }

  if (layout.empty) return { rungs: [], labels: [] };

  /* -------------------------------------------- gather every 3D primitive */
  const prims = [];
  // Selection compares by key, with the unfiled gene answering to "unfiled" —
  // it has no record and no id, and selecting it must not dim the very thing
  // being read.
  const selected = view.selection;
  const keyOf = (seg) => (seg ? seg.projectId ?? "unfiled" : null);
  const dimOf = (seg) => {
    if (!selected || view.dim <= 0) return 1;
    const away = 1 - view.dim * 0.82;
    return keyOf(seg) === selected ? 1 : away;
  };

  for (const phase of [0, Math.PI]) {
    let prev = null;
    for (let i = 0; i <= SAMPLES; i++) {
      const tt = i / SAMPLES;
      const wp = strandPoint(tt, phase, opts);
      const sp = project(wp, cam);
      if (prev) {
        const seg = segmentAt((prev.tt + tt) / 2, layout.segments);
        prims.push({
          kind: "bone", z: (prev.sp.z + sp.z) / 2,
          x0: prev.sp.x, y0: prev.sp.y, x1: sp.x, y1: sp.y,
          s: (prev.sp.s + sp.s) / 2, seg,
        });
      }
      prev = { tt, sp };
    }
  }

  for (const r of layout.rungs) {
    const a = project(strandPoint(r.t, 0, opts), cam);
    const b = project(strandPoint(r.t, Math.PI, opts), cam);
    const seg = segmentAt(r.t, layout.segments);
    const z = (a.z + b.z) / 2;
    prims.push({ kind: "rung", z, a, b, r, seg });
    prims.push({ kind: "orb", z: a.z - 0.01, p: a, r, seg });
    prims.push({ kind: "orb", z: b.z - 0.01, p: b, r, seg });
  }

  prims.sort((p1, p2) => p2.z - p1.z);

  /* ------------------------------------------------------------- draw far→near */
  const drawnRungs = [];

  for (const p of prims) {
    // Depth: far primitives fade and thin. `depth` runs ~0.55 (far) → ~1.45 (near).
    const depth = p.kind === "bone" ? p.s : p.kind === "rung" ? (p.a.s + p.b.s) / 2 : p.p.s;
    const near = Math.max(0, Math.min(1, (depth - 0.62) * 2.1));
    const fade = 0.28 + near * 0.72;
    const mul = dimOf(p.seg);
    if (mul <= 0.05) continue;

    if (p.kind === "bone") {
      // Butt caps: round ones overlap at every sample joint, and on the
      // additive composite each overlap double-exposes — the whole far side
      // turned into a string of pearls.
      ctx.lineCap = "butt";
      const unfiled = p.seg && p.seg.projectId === null;
      const color = p.seg ? (dark ? p.seg.color.dark : p.seg.color.light) : (dark ? "#3a4358" : "#b9bdc9");
      // The unfiled stretch is present — nothing is ever invisible — but it is
      // the one part of the strand that has not been given a meaning yet, and
      // it should look like it: matte, quiet, waiting.
      const alpha = (p.seg ? (unfiled ? 0.32 : 0.9) : 0.4) * fade * mul;
      const width = (p.seg ? (unfiled ? 1.5 : 2.5) : 1.2) * depth * cam.zoom;
      if (dark && !unfiled) {
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = hex(color, alpha * 0.16);
        ctx.lineWidth = width * 4.6;
        line(ctx, p);
        ctx.strokeStyle = hex(color, alpha * 0.5);
        ctx.lineWidth = width * 1.9;
        line(ctx, p);
        ctx.strokeStyle = hex(mix(color, "#ffffff", 0.45 * near), alpha);
        ctx.lineWidth = width * 0.85;
        line(ctx, p);
        ctx.globalCompositeOperation = "source-over";
      } else if (dark) {
        ctx.strokeStyle = hex(color, alpha);
        ctx.lineWidth = width * 0.9;
        line(ctx, p);
      } else {
        ctx.strokeStyle = hex(color, alpha * 0.14);
        ctx.lineWidth = width * 3.6;
        line(ctx, p);
        ctx.strokeStyle = hex(color, alpha * 0.92);
        ctx.lineWidth = width * 0.95;
        line(ctx, p);
      }
    } else if (p.kind === "rung") {
      ctx.lineCap = "round";
      const { r } = p;
      const base = dark ? r.color.dark : r.color.light;
      const color = r.overdue ? (dark ? "#ff5d6c" : "#dc2626") : base;
      const pulse = r.overdue && !view.reduced ? 0.75 + 0.25 * Math.sin(t / 260) : 1;
      const alpha = (r.done ? 1 : 0.5) * fade * mul * pulse;
      const width = (r.done ? 2.7 : 1.8) * depth * cam.zoom;
      if (r.delegated) ctx.setLineDash([4 * depth, 5 * depth]);
      if (dark) {
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = hex(color, alpha * 0.2);
        ctx.lineWidth = width * 3.4;
        seg(ctx, p.a, p.b);
        ctx.strokeStyle = hex(color, alpha);
        ctx.lineWidth = width;
        seg(ctx, p.a, p.b);
        ctx.globalCompositeOperation = "source-over";
      } else {
        ctx.strokeStyle = hex(color, alpha * 0.85);
        ctx.lineWidth = width;
        seg(ctx, p.a, p.b);
      }
      ctx.setLineDash([]);
      drawnRungs.push({
        x: (p.a.x + p.b.x) / 2, y: (p.a.y + p.b.y) / 2,
        taskId: r.taskId, projectId: r.projectId, title: r.title, near,
      });
    } else {
      const { r } = p;
      const base = dark ? r.color.dark : r.color.light;
      const color = r.overdue ? (dark ? "#ff5d6c" : "#dc2626") : base;
      const alpha = (r.done ? 1 : 0.55) * fade * mul;
      const rad = (r.done ? 3.2 : 2.6) * depth * cam.zoom;
      if (dark) {
        ctx.globalCompositeOperation = "lighter";
        const g = ctx.createRadialGradient(p.p.x, p.p.y, 0, p.p.x, p.p.y, rad * 3.2);
        g.addColorStop(0, hex(color, alpha * 0.5));
        g.addColorStop(1, hex(color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.p.x, p.p.y, rad * 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hex(mix(color, "#ffffff", r.done ? 0.55 : 0.15), alpha);
        ctx.beginPath();
        ctx.arc(p.p.x, p.p.y, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
      } else {
        ctx.fillStyle = hex(color, alpha * 0.9);
        ctx.beginPath();
        ctx.arc(p.p.x, p.p.y, rad, 0, Math.PI * 2);
        if (r.done) ctx.fill();
        else { ctx.lineWidth = 1.4 * depth; ctx.strokeStyle = hex(color, alpha * 0.9); ctx.stroke(); }
      }
    }
  }

  /* ---------------------------------------------------------------- labels */
  // Anchored to the strand's axis at each gene's midpoint and pushed out to
  // the side, with a hairline leader. Labels never dim below legibility —
  // they are the index of the whole picture.
  const labels = [];
  ctx.textBaseline = "middle";
  layout.segments.forEach((s, i) => {
    const axis = project({ x: 0, y: (s.mid - 0.5) * opts.height, z: 0 }, cam);
    // Alternating sides, like annotations around a specimen plate. Choosing
    // the side from geometry put every label on the right, which pushed the
    // whole composition off balance and tangled the leader lines through the
    // strand.
    const right = i % 2 === 0;
    const off = (opts.radius * cam.zoom + (narrow ? 30 : 56)) * axis.s;
    const lx = right ? Math.min(w - 14, axis.x + off) : Math.max(14, axis.x - off);
    const mul = !selected || view.dim <= 0 ? 1 : ((s.projectId ?? "unfiled") === selected ? 1 : 1 - view.dim * 0.6);
    const ink = dark ? "#e8ecf4" : "#1c1c20";
    const sub = dark ? "#7d879c" : "#71717a";
    const accent = dark ? s.color.dark : s.color.light;

    ctx.strokeStyle = hex(accent, 0.28 * mul);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(axis.x + (right ? 14 : -14), axis.y);
    ctx.lineTo(lx + (right ? -8 : 8), axis.y);
    ctx.stroke();

    ctx.textAlign = right ? "left" : "right";
    ctx.font = `600 ${narrow ? 11 : 12.5}px ${theme.font || "system-ui"}`;
    ctx.fillStyle = hex(ink, 0.95 * mul);
    ctx.fillText(s.name, lx, axis.y - 8);
    ctx.font = `500 10px ${theme.font || "system-ui"}`;
    ctx.fillStyle = hex(sub, 0.9 * mul);
    ctx.fillText(
      s.archived ? "archived" : `${s.doneCount}/${s.count} woven in`,
      lx, axis.y + 8,
    );
    const tw = Math.max(ctx.measureText(s.name).width, 60);
    labels.push({
      projectId: s.projectId,
      x: right ? lx : lx - tw, y: axis.y - 18, w: tw + 16, h: 36,
    });
  });

  // Terminal caps: a small bright point where the strand begins and ends.
  // Without them the ends just stop, and a thing that stops reads as cropped
  // even when it is not.
  for (const phase of [0, Math.PI]) {
    for (const tt of [0, 1]) {
      const p = project(strandPoint(tt, phase, opts), cam);
      const c = dark ? "#cfd8ea" : "#52525b";
      ctx.fillStyle = hex(c, 0.6 * p.s);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.4 * p.s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return { rungs: drawnRungs, labels };
}

function line(ctx, p) {
  ctx.beginPath();
  ctx.moveTo(p.x0, p.y0);
  ctx.lineTo(p.x1, p.y1);
  ctx.stroke();
}
function seg(ctx, a, b) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

/** Blend two hex colours — used to white-heat the near side of a stroke. */
function mix(c1, c2, f) {
  const a = parseInt(c1.slice(1), 16);
  const b = parseInt(c2.slice(1), 16);
  const ch = (x, y) => Math.round(x + (y - x) * f);
  const r = ch((a >> 16) & 255, (b >> 16) & 255);
  const g = ch((a >> 8) & 255, (b >> 8) & 255);
  const bl = ch(a & 255, b & 255);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, "0")}`;
}
