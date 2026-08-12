/**
 * Drawing the oak.
 *
 * One canvas, no libraries, and no 3D this time — a tree is rooted. What
 * makes it read alive instead of plotted is wind: every branch flexes around
 * its own socket, more toward the tip the way wood actually bends, with the
 * acorns swinging a beat behind. Dragging feeds the gust, so a flick of the
 * finger moves through the crown like weather.
 *
 * The style is the app's own logo grown large: warm gold line-work on the
 * dark, ink on the paper. Bark is one colour on purpose — the tree is one
 * life — and each branch's identity lives in its acorn caps and its label,
 * which is enough to tell ten branches apart without the crown turning into
 * a colour wheel.
 */
import { branchPoint, trunkPoint, geometryFor, perchFor, trunkTopT } from "./oak.js";

const hex = (c, a) => {
  const n = parseInt(c.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/** Deterministic fireflies — the dark room's dust, warmed up. */
function makeFlies(count = 34, seed = 11) {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: count }, () => ({
    x: rand(), y: rand() * 0.8, r: 0.7 + rand() * 1.4,
    dx: (rand() - 0.5) * 0.012, wob: rand() * Math.PI * 2,
  }));
}
const FLIES = makeFlies();

/**
 * The squirrel, as three strokes of a brush.
 *
 * A sitting profile: haunch, chest, small ear, and the signature S of tail
 * carried over the back. Drawn facing the trunk (flipped per side), about
 * forty pixels tall — small enough that hand-drawn is charming, big enough
 * to be unmistakably the one from the icon.
 */
function drawSquirrel(ctx, x, y, side, theme, t, glowing) {
  const dark = theme.mode !== "light";
  const ink = dark ? "#eec06a" : "#4a3a28";
  const bob = Math.sin(t / 700) * 0.8;
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.scale(side > 0 ? -1 : 1, 1);
  ctx.scale(1.28, 1.28);
  ctx.translate(-19, -38);

  const body = new Path2D(
    // haunch → back → neck
    "M24 38 C32 37 34.5 28.5 30 22 C28.5 17 25 13.5 20 13.5 " +
    // ear (a real leaf of one), forehead, snout, chin
    "C19.5 10.5 17.5 8 15.5 9.5 C14.8 10.6 15.2 12 16.2 13 " +
    "C12.8 13.6 10.2 15.8 9.4 18.4 C8.9 20.4 10.4 22 12.6 22.2 " +
    "C11.2 26.5 12.4 32.5 11.2 38 L15.4 38 C15.8 34 15.6 30.5 16.8 27.8 " +
    "C17.8 31.5 17.4 35 18.2 38 Z",
  );
  const tail = new Path2D(
    // up behind the rump, over the back, curling toward the head
    "M26 34 C36 32 40.5 22 35.5 11.5 C34 7.5 27.5 6.5 26.5 11 " +
    "C31.5 13.5 33 21 24.5 25.5 C21.5 27.5 22 32.5 26 34 Z",
  );

  if (dark && glowing) {
    ctx.shadowColor = hex("#ffc44d", 0.55);
    ctx.shadowBlur = 14;
  }
  ctx.fillStyle = ink;
  ctx.fill(tail);
  ctx.fill(body);
  ctx.shadowBlur = 0;
  // The eye — paper-coloured, so it reads at silhouette size.
  ctx.fillStyle = dark ? "#0a0b10" : "#faf9f5";
  ctx.beginPath();
  ctx.arc(13.4, 16.4, 1.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A tapered stroke along a sampled curve — canvas cannot taper, so we lay
 *  short segments whose width eases from root to tip. */
function taper(ctx, pts, w0, w1, color) {
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  for (let i = 1; i < pts.length; i++) {
    const f = i / (pts.length - 1);
    ctx.lineWidth = w0 + (w1 - w0) * f;
    ctx.beginPath();
    ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
    ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
}

/**
 * Draw one frame.
 *
 * @param view {t, gust, selection, dim, find, squirrel:{x,y,side}, zoom, panX, reduced}
 * @returns {{targets, squirrel}} screen-space hit records.
 */
export function drawOak(ctx, w, h, layout, view, theme) {
  const dark = theme.mode !== "light";
  const t = view.reduced ? 0 : view.t || 0;
  const gust = view.gust || 0;
  const geo = geometryFor(w, h);
  const bark = dark ? "#b98d4a" : "#4a3a28";
  const barkDim = dark ? "#6d5731" : "#a08b6f";

  /* ------------------------------------------------------------- the night */
  const vg = ctx.createRadialGradient(w / 2, h * 0.35, 0, w / 2, h * 0.45, Math.max(w, h) * 0.8);
  if (dark) {
    vg.addColorStop(0, "#0a0c14");
    vg.addColorStop(0.6, "#05060c");
    vg.addColorStop(1, "#010102");
  } else {
    vg.addColorStop(0, "#fdfdfa");
    vg.addColorStop(0.65, "#f6f5f0");
    vg.addColorStop(1, "#ecebe3");
  }
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);

  // A breath of warmth where the ground meets the dark.
  const hz = ctx.createLinearGradient(0, geo.groundY - 60, 0, geo.groundY + 40);
  hz.addColorStop(0, "rgba(0,0,0,0)");
  hz.addColorStop(1, dark ? "rgba(233,180,76,0.06)" : "rgba(74,58,40,0.05)");
  ctx.fillStyle = hz;
  ctx.fillRect(0, geo.groundY - 60, w, 100);

  for (const f of FLIES) {
    const fx = ((f.x + (view.reduced ? 0 : t * 0.000006) + Math.sin(t / 2400 + f.wob) * 0.004) % 1) * w;
    const fy = f.y * h + Math.sin(t / 1700 + f.wob) * 6;
    const tw = view.reduced ? 0.5 : 0.3 + 0.35 * Math.sin(t / 800 + f.wob);
    ctx.fillStyle = dark ? hex("#ffd98a", 0.06 + 0.1 * tw) : hex("#8a7a5a", 0.05 + 0.05 * tw);
    ctx.beginPath();
    ctx.arc(fx, fy, f.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // The ground: one long quiet stroke, swelling under the trunk.
  ctx.strokeStyle = hex(bark, dark ? 0.35 : 0.5);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(w * 0.06, geo.groundY + 6);
  ctx.quadraticCurveTo(geo.baseX, geo.groundY - 8, w * 0.94, geo.groundY + 4);
  ctx.stroke();

  ctx.save();
  ctx.translate(view.panX || 0, 0);
  ctx.translate(geo.baseX, geo.groundY);
  ctx.scale(view.zoom || 1, view.zoom || 1);
  ctx.translate(-geo.baseX, -geo.groundY);

  if (layout.empty) {
    // A sapling: two leaves and the first hope. The copy does the talking.
    taper(ctx, [
      { x: geo.baseX, y: geo.groundY },
      { x: geo.baseX + 3, y: geo.groundY - 40 },
      { x: geo.baseX - 2, y: geo.groundY - 78 },
    ], 5, 2.4, bark);
    ctx.restore();
    return { targets: [], squirrel: null };
  }

  const selected = view.selection;
  const find = view.find;
  const dimOf = (id) => {
    if (find) return find.branchIds.has(id) ? 1 : 0.14;
    if (!selected || view.dim <= 0) return 1;
    return id === selected ? 1 : 1 - view.dim * 0.78;
  };

  /* --------------------------------------------------------------- trunk */
  const topT = trunkTopT(layout);
  const trunkPts = [];
  for (let i = 0; i <= 24; i++) trunkPts.push(trunkPoint((i / 24) * topT, geo));
  if (dark) {
    ctx.globalCompositeOperation = "lighter";
    taper(ctx, trunkPts, 30, 9, hex(bark, 0.1));
    ctx.globalCompositeOperation = "source-over";
  }
  taper(ctx, trunkPts, 24, 6, hex(bark, dark ? 0.95 : 1));
  // The fork at the top: two short fingers, so the wood ends like wood.
  const tip = trunkPoint(topT, geo);
  for (const d of [-1, 1]) {
    taper(ctx, [tip, { x: tip.x + d * 16, y: tip.y - 20 }, { x: tip.x + d * 24, y: tip.y - 34 }],
      4.4, 1.4, hex(bark, 0.9));
  }
  // Root flare: two short strokes anchoring it into the ground.
  for (const d of [-1, 1]) {
    ctx.strokeStyle = hex(bark, 0.85);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(geo.baseX + d * 4, geo.groundY - 14);
    ctx.quadraticCurveTo(geo.baseX + d * 16, geo.groundY - 2, geo.baseX + d * 30, geo.groundY + 2);
    ctx.stroke();
  }

  /* ------------------------------------------------------------- branches */
  const targets = [];
  for (const b of layout.branches) {
    const mul = dimOf(b.projectId);
    const pts = [];
    for (let i = 0; i <= 22; i++) pts.push(branchPoint(b, i / 22, geo, t, gust));
    const w0 = 10 * b.thick + 3;
    const accent = dark ? b.color.dark : b.color.light;

    if (dark && mul > 0.5) {
      ctx.globalCompositeOperation = "lighter";
      taper(ctx, pts, w0 * 1.7, 2.4, hex(bark, 0.07 * mul));
      ctx.globalCompositeOperation = "source-over";
    }
    taper(ctx, pts, w0, 1.8, hex(mul > 0.5 ? bark : barkDim, Math.max(0.16, 0.95 * mul)));

    // Two twigs, deterministic, purely for grownness.
    for (const [tt, ang, ln] of [[0.5, -0.75, 0.14], [0.74, -0.55, 0.1]]) {
      const p0 = branchPoint(b, tt, geo, t, gust);
      const p1 = branchPoint(b, tt + 0.02, geo, t, gust);
      const dx = p1.x - p0.x, dy = p1.y - p0.y;
      const n = Math.hypot(dx, dy) || 1;
      const twig = geo.reach * b.len * ln;
      const a2 = ang * b.side;
      const ux = dx / n, uy = dy / n;
      const rx = ux * Math.cos(a2) - uy * Math.sin(a2);
      const ry = ux * Math.sin(a2) + uy * Math.cos(a2);
      const mid = { x: p0.x + rx * twig * 0.6, y: p0.y + ry * twig * 0.6 - 2 };
      const end = { x: p0.x + rx * twig, y: p0.y + ry * twig - twig * 0.16 };
      taper(ctx, [p0, mid, end], 2 * b.thick + 0.6, 0.6,
        hex(mul > 0.5 ? bark : barkDim, 0.65 * mul));
    }

    /* -------------------------------------------------------------- acorns */
    let i = 0;
    for (const a of b.acorns) {
      i++;
      const p = branchPoint(b, a.t, geo, t, gust);
      const swing = view.reduced ? 0 : Math.sin(t / 900 + a.t * 9 + b.phase) * 1.6 + gust * 2;
      const ax = p.x + swing;
      const ay = p.y + (i % 2 ? 17 : 9);
      const found = find && find.acornIds.has(a.taskId);
      const aMul = find ? (found ? 1 : 0.12) : mul;
      const overdueHot = a.overdue && !view.reduced ? 0.7 + 0.3 * Math.sin(t / 280) : 1;
      const body = a.overdue ? (dark ? "#ff5d6c" : "#dc2626") : accent;

      // Stem — dashed when the task is with somebody else: hanging by an
      // agreement rather than by wood.
      ctx.strokeStyle = hex(bark, 0.75 * aMul);
      ctx.lineWidth = 1.1;
      if (a.delegated) ctx.setLineDash([2.5, 2.5]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + 1.5);
      ctx.lineTo(ax, ay - 4);
      ctx.stroke();
      ctx.setLineDash([]);

      if (a.done) {
        // Stored away: solid gold, softly alight.
        if (dark) {
          ctx.globalCompositeOperation = "lighter";
          const g = ctx.createRadialGradient(ax, ay, 0, ax, ay, 11);
          g.addColorStop(0, hex(body, 0.45 * aMul));
          g.addColorStop(1, hex(body, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(ax, ay, 11, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalCompositeOperation = "source-over";
        }
        ctx.fillStyle = hex(body, aMul);
        ctx.beginPath();
        ctx.arc(ax, ay, 4.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Still ripening: an outline waiting to be filled.
        ctx.strokeStyle = hex(body, Math.max(0.2, 0.75 * aMul * overdueHot));
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(ax, ay, 4.2, 0, Math.PI * 2);
        ctx.stroke();
      }
      // The cap — every acorn wears the branch's colour.
      ctx.strokeStyle = hex(bark, 0.9 * aMul);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(ax, ay - 1.2, 4.6, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();

      if (found) {
        ctx.strokeStyle = hex(dark ? "#ffe9b0" : "#7c5a12", 0.85);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(ax, ay, 8.5 + Math.sin(t / 300) * 1.2, 0, Math.PI * 2);
        ctx.stroke();
      }
      targets.push({ x: ax, y: ay, projectId: b.projectId, taskId: a.taskId });
    }

    /* --------------------------------------------------------------- label */
    const tip = branchPoint(b, 1, geo, t, gust);
    const narrow = w < 560;
    const ink = dark ? "#e8ecf4" : "#1c1c20";
    const sub = dark ? "#7d879c" : "#71717a";
    const lMul = find ? (find.branchIds.has(b.projectId) ? 1 : 0.25) : (mul < 1 ? 1 - view.dim * 0.55 : 1);
    ctx.textBaseline = "middle";
    ctx.font = `600 ${narrow ? 11.5 : 12.5}px ${theme.font || "system-ui"}`;
    /**
     * Clamped inside the frame. At phone width the tips reach the edges, and
     * a name sliced by the screen edge reads as a bug — so when the outward
     * side has no room, the label tucks back over the branch instead.
     */
    const name = b.name;
    const tw = ctx.measureText(name).width;
    let lx = tip.x + b.side * 14;
    let align = b.side > 0 ? "left" : "right";
    let ly = tip.y;
    // Tucking a label back over the branch lands it on the acorns hanging
    // there, so a clamped label also climbs above the wood.
    if (b.side > 0 && lx + tw > w - 10) { lx = tip.x - 8; align = "right"; ly = tip.y - 16; }
    if (b.side < 0 && lx - tw < 10) { lx = tip.x + 8; align = "left"; ly = tip.y - 16; }
    ctx.textAlign = align;
    ctx.fillStyle = hex(ink, 0.95 * lMul);
    ctx.fillText(name, lx, ly - 8);
    ctx.font = `500 10px ${theme.font || "system-ui"}`;
    ctx.fillStyle = hex(sub, 0.9 * lMul);
    ctx.fillText(narrow ? `${b.doneCount}/${b.count} stored` : `${b.doneCount} of ${b.count} stored away`, lx, ly + 6);
    // A drop of the branch's own colour beside the name — the legend, inline.
    ctx.fillStyle = hex(accent, 0.9 * lMul);
    ctx.beginPath();
    ctx.arc(lx + (align === "left" ? -7 : 7), ly - 8, 2.4, 0, Math.PI * 2);
    ctx.fill();
    targets.push({ x: lx + (align === "left" ? 30 : -30), y: ly, projectId: b.projectId });
    // A generous invisible target along the wood itself.
    for (const f of [0.35, 0.6, 0.85]) {
      const bp = branchPoint(b, f, geo, t, gust);
      targets.push({ x: bp.x, y: bp.y, projectId: b.projectId });
    }
  }

  /* ------------------------------------------------- the fallen, unfiled */
  if (layout.ground.length) {
    const gMul = find ? 0.6 : selected ? 1 - view.dim * 0.5 : 1;
    layout.ground.forEach((g) => {
      const gx = geo.baseX + 60 + g.spot * Math.min(140, w * 0.13);
      const gy = geo.groundY - 4 - (g.spot * 7) % 6;
      const found = find && find.acornIds.has(g.taskId);
      const mul2 = find ? (found ? 1 : 0.12) : gMul;
      ctx.strokeStyle = hex(g.overdue ? (dark ? "#ff5d6c" : "#dc2626") : barkDim, 0.8 * mul2);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(gx, gy, 3.8, 0, Math.PI * 2);
      if (g.done) { ctx.fillStyle = hex(barkDim, 0.8 * mul2); ctx.fill(); } else ctx.stroke();
      ctx.strokeStyle = hex(bark, 0.8 * mul2);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(gx, gy - 1, 4, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      if (found) {
        ctx.strokeStyle = hex(dark ? "#ffe9b0" : "#7c5a12", 0.85);
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(gx, gy, 8, 0, Math.PI * 2);
        ctx.stroke();
      }
      targets.push({ x: gx, y: gy, projectId: "unfiled", taskId: g.taskId });
    });
    ctx.font = `500 10px ${theme.font || "system-ui"}`;
    ctx.textAlign = "left";
    ctx.fillStyle = hex(dark ? "#7d879c" : "#71717a", 0.85);
    ctx.fillText("fallen — not on a branch yet", geo.baseX + 60, geo.groundY + 16);
  }

  /* ------------------------------------------------------------ squirrel */
  const perch = view.squirrel || perchFor(null, layout, geo);
  drawSquirrel(ctx, perch.x, perch.y, perch.side, theme, t, Boolean(find) || view.squirrelHot);
  ctx.restore();

  // Report in screen space (undo the zoom/pan transform for hit testing).
  const z = view.zoom || 1;
  const px = view.panX || 0;
  const toScreen = (pt) => ({
    ...pt,
    x: (pt.x - geo.baseX) * z + geo.baseX + px,
    y: (pt.y - geo.groundY) * z + geo.groundY,
  });
  return {
    targets: targets.map(toScreen),
    squirrel: toScreen({ x: perch.x, y: perch.y - 14 }),
  };
}
