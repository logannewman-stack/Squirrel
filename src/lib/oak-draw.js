/**
 * Drawing the oak.
 *
 * One canvas, no libraries, and no 3D this time — a tree is rooted. What
 * makes it read alive instead of plotted is wind: every branch flexes around
 * its own socket, more toward the tip the way wood actually bends, with the
 * acorns swinging a beat behind. Dragging feeds the gust, so a flick of the
 * finger moves through the crown like weather.
 *
 * The style is the app's own logo grown large: white line-work on the dark,
 * ink on the paper — monochrome, because the rest of Squirrel is monochrome
 * and this screen has to belong to it. The tree is one life in one ink; a
 * branch is told apart by its place and its name, and colour is spent the
 * way the app spends it everywhere: only on the alert, for overdue acorns.
 */
import { branchPoint, trunkPoint, geometryFor, perchFor, trunkTopT } from "./oak.js";

const hex = (c, a) => {
  const n = parseInt(c.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

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
  const ink = dark ? "#f5f6f9" : "#141417";
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
    ctx.shadowColor = hex("#ffffff", 0.45);
    ctx.shadowBlur = 14;
  }
  ctx.fillStyle = ink;
  ctx.fill(tail);
  ctx.fill(body);
  ctx.shadowBlur = 0;
  // The eye — paper-coloured, so it reads at silhouette size.
  ctx.fillStyle = dark ? "#0a0b10" : "#ffffff";
  ctx.beginPath();
  ctx.arc(13.4, 16.4, 1.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * The squirrel's thought, floating over its head: a standing offer to go
 * find something. A soft pill with a two-bead trail rising from the ear —
 * the finder made visible, so nobody has to be told the squirrel can look.
 * Tapping the thought is tapping the squirrel; the rect is returned so the
 * hit test can honour the most literal route there is: touching the question.
 */
function drawThought(ctx, sq, theme, t, font, reduced) {
  const dark = theme.mode !== "light";
  const text = "Looking for something?";
  const bob = reduced ? 0 : Math.sin(t / 700) * 0.8;
  // Its own slow breath, half a beat off the squirrel's, so the two read as
  // alive together rather than glued.
  const breathe = reduced ? 0 : Math.sin(t / 950) * 1.4;
  const dir = sq.side > 0 ? -1 : 1; // over the face, which looks at the trunk

  ctx.save();
  ctx.font = `500 11px ${font}`;
  const bw = ctx.measureText(text).width + 22;
  const bh = 26;
  const bx = sq.x + dir * (bw / 2 - 10);
  const by = sq.y - 64 + bob + breathe;

  // The trail: two beads rising from the ear toward the thought.
  ctx.fillStyle = dark ? hex("#fafafa", 0.5) : hex("#0a0a0a", 0.4);
  for (const [f, r] of [[0.32, 1.7], [0.66, 2.6]]) {
    ctx.beginPath();
    ctx.arc(sq.x + dir * f * 18, sq.y - 34 - f * 20 + bob, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const x0 = bx - bw / 2;
  const y0 = by - bh / 2;
  if (dark) {
    ctx.shadowColor = hex("#ffffff", 0.22);
    ctx.shadowBlur = 12;
  }
  ctx.fillStyle = dark ? "rgba(10,10,12,0.92)" : "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.roundRect(x0, y0, bw, bh, 13);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = dark ? hex("#fafafa", 0.4) : hex("#0a0a0a", 0.3);
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = dark ? "#fafafa" : "#0a0a0a";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, bx, by + 0.5);
  ctx.restore();
  return { x: x0, y: y0, w: bw, h: bh };
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
 * @param view {t, gust, selection, acorn, dim, find, squirrel:{x,y,side},
 *              thought, zoom, panX, reduced} — `thought` shows the squirrel's
 *              bubble; `acorn` is the taskId open in the reading panel, drawn
 *              with a steady ring.
 * @returns {{targets, squirrel, bubble}} screen-space hit records.
 */
export function drawOak(ctx, w, h, layout, view, theme) {
  const dark = theme.mode !== "light";
  const t = view.reduced ? 0 : view.t || 0;
  const gust = view.gust || 0;
  const geo = geometryFor(w, h);
  const bark = dark ? "#eef0f5" : "#18181b";
  const barkDim = dark ? "#5f5f68" : "#a1a1aa";

  /* ------------------------------------------------------------- the room */
  // Flat, like every other screen in the app — the paper itself, not a set.
  ctx.fillStyle = dark ? "#08080a" : "#ffffff";
  ctx.fillRect(0, 0, w, h);

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
    return { targets: [], squirrel: null, bubble: null };
  }

  const selected = view.selection;
  const find = view.find;
  /**
   * Selection dims strangers, not family: the selected branch stays full,
   * its shoots and its host stay half-lit — reading a bough should keep the
   * work growing off it in view.
   */
  const sel = selected ? layout.branches.find((b) => b.projectId === selected) : null;
  const kin = new Set();
  if (sel) {
    if (sel.host) kin.add(sel.host.projectId);
    for (const b of layout.branches) if (b.host === sel) kin.add(b.projectId);
  }
  const dimOf = (id) => {
    if (find) return find.branchIds.has(id) ? 1 : 0.14;
    if (!selected || view.dim <= 0) return 1;
    if (id === selected) return 1;
    return 1 - view.dim * (kin.has(id) ? 0.45 : 0.78);
  };

  /* --------------------------------------------------------------- trunk */
  const topT = trunkTopT(layout);
  const trunkPts = [];
  for (let i = 0; i <= 24; i++) trunkPts.push(trunkPoint((i / 24) * topT, geo));
  // One clean tapered line — no glow underlay. The tree is a drawing now,
  // not a light fixture; restraint is what makes it the app's.
  taper(ctx, trunkPts, 13, 4, hex(bark, dark ? 0.95 : 1));
  // The fork at the top: two short fingers, so the wood ends like wood.
  const tip = trunkPoint(topT, geo);
  for (const d of [-1, 1]) {
    taper(ctx, [tip, { x: tip.x + d * 16, y: tip.y - 20 }, { x: tip.x + d * 24, y: tip.y - 34 }],
      2.8, 1.1, hex(bark, 0.9));
  }
  // Root flare: two short strokes anchoring it into the ground.
  for (const d of [-1, 1]) {
    ctx.strokeStyle = hex(bark, 0.85);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(geo.baseX + d * 3, geo.groundY - 12);
    ctx.quadraticCurveTo(geo.baseX + d * 14, geo.groundY - 2, geo.baseX + d * 26, geo.groundY + 2);
    ctx.stroke();
  }

  /* ------------------------------------------------------------- branches */
  const targets = [];
  const labelJobs = [];
  for (const b of layout.branches) {
    const mul = dimOf(b.projectId);
    const pts = [];
    for (let i = 0; i <= 22; i++) pts.push(branchPoint(b, i / 22, geo, t, gust));
    const w0 = 5.5 * b.thick + 2;
    const accent = dark ? b.color.dark : b.color.light;

    taper(ctx, pts, w0, 1.2, hex(mul > 0.5 ? bark : barkDim, Math.max(0.16, 0.95 * mul)));

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
      // The app's one accent (--alert), spent here the way Today spends it.
      const body = a.overdue ? (dark ? "#f0a04b" : "#b45309") : accent;

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

      /**
       * The acorn is the app's own checkbox, hung on wood: a filled dot when
       * stored away, an outline while it ripens. No cap, no halo — the same
       * two states every list in the app draws, so the tree needs no legend.
       */
      if (a.done) {
        ctx.fillStyle = hex(body, aMul);
        ctx.beginPath();
        ctx.arc(ax, ay, 4.2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = hex(body, Math.max(0.2, 0.8 * aMul * overdueHot));
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(ax, ay, 4, 0, Math.PI * 2);
        ctx.stroke();
      }

      // One ring, two reasons: steady around the acorn that is open in the
      // reading panel, breathing around the ones the squirrel found.
      const open = view.acorn === a.taskId;
      if (found || open) {
        ctx.strokeStyle = hex(dark ? "#ffffff" : "#0a0a0a", 0.85);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(ax, ay, 8.5 + (found ? Math.sin(t / 300) * 1.2 : 0), 0, Math.PI * 2);
        ctx.stroke();
      }
      targets.push({ x: ax, y: ay, projectId: b.projectId, taskId: a.taskId });
    }

    /* ------------- label: measured now, placed after all wood is drawn */
    // Anchored to the still tip (no wind), so names hold steady while the
    // wood sways — they are annotations, not leaves.
    const tip = branchPoint(b, 1, geo, 0, 0);
    const lMul = find ? (find.branchIds.has(b.projectId) ? 1 : 0.25) : (mul < 1 ? 1 - view.dim * 0.55 : 1);
    // Sub-branches take a quieter voice — their name a step smaller.
    ctx.font = `600 ${b.host ? 11 : w < 560 ? 11.5 : 12.5}px ${theme.font || "system-ui"}`;
    const tw = ctx.measureText(b.name).width;
    /**
     * Clamped inside the frame. At phone width the tips reach the edges, and
     * a name sliced by the screen edge reads as a bug — so when the outward
     * side has no room, the label tucks back over the branch and climbs.
     */
    let lx = tip.x + b.side * 14;
    let align = b.side > 0 ? "left" : "right";
    let ly = tip.y;
    if (b.side > 0 && lx + tw > w - 10) { lx = tip.x - 8; align = "right"; ly = tip.y - 16; }
    if (b.side < 0 && lx - tw < 10) { lx = tip.x + 8; align = "left"; ly = tip.y - 16; }
    labelJobs.push({ b, lx, ly, align, lMul, subText: `${b.doneCount}/${b.count} stored` });
    // A generous invisible target along the wood itself.
    for (const f of [0.35, 0.6, 0.85]) {
      const bp = branchPoint(b, f, geo, t, gust);
      targets.push({ x: bp.x, y: bp.y, projectId: b.projectId });
    }
  }

  /* --------------------------------------------------------------- labels */
  /**
   * Every label claims a rectangle; one that would land on a claimed patch
   * slides up until the air is clear. Sub-branches reach into their parents'
   * sky — without this pass, names strike through wood and through each
   * other the moment the tree grows shoots, worst on a phone where the sky
   * is small. Deterministic, so nothing flickers frame to frame.
   */
  {
    const narrow = w < 560;
    const inkC = dark ? "#fafafa" : "#0a0a0a";
    const subC = dark ? "#9a9aa3" : "#6b6b74";
    /**
     * The tree claims its own space first — every acorn, every branch tip,
     * and the length of each shoot (computed still, without wind, so the
     * resolution never flickers). Labels then slide up past wood and fruit
     * alike, which is what keeps a phone-width crown readable.
     */
    const claimed = [];
    const claim = (x, y, r) => claimed.push({ x0: x - r, x1: x + r, y0: y - r, y1: y + r });
    for (const b of layout.branches) {
      // The draw loop pre-increments its index, so hang depth starts at 17.
      b.acorns.forEach((a, i) => {
        const p = branchPoint(b, a.t, geo, 0, 0);
        claim(p.x, p.y + ((i + 1) % 2 ? 17 : 9), 9);
      });
      const stops = b.host ? [0.3, 0.6, 0.85, 1] : [1];
      for (const f of stops) {
        const p = branchPoint(b, f, geo, 0, 0);
        claim(p.x, p.y, 9);
      }
    }
    ctx.textBaseline = "middle";
    for (const L of labelJobs) {
      const nameFont = `600 ${L.b.host ? 11 : narrow ? 11.5 : 12.5}px ${theme.font || "system-ui"}`;
      const subFont = `500 10px ${theme.font || "system-ui"}`;
      ctx.font = nameFont;
      const wName = ctx.measureText(L.b.name).width;
      ctx.font = subFont;
      const wMax = Math.max(wName, ctx.measureText(L.subText).width);

      let ly = L.ly;
      const box = () => {
        const x0 = L.align === "left" ? L.lx : L.lx - wMax;
        return { x0: x0 - 8, x1: x0 + wMax + 8, y0: ly - 17, y1: ly + 13 };
      };
      let guard = 0;
      while (
        guard++ < 24 &&
        claimed.some((r) => {
          const c = box();
          return c.x0 < r.x1 && c.x1 > r.x0 && c.y0 < r.y1 && c.y1 > r.y0;
        })
      ) ly -= 15;
      claimed.push(box());

      ctx.textAlign = L.align;
      ctx.font = nameFont;
      ctx.fillStyle = hex(inkC, 0.95 * L.lMul);
      ctx.fillText(L.b.name, L.lx, ly - 8);
      ctx.font = subFont;
      ctx.fillStyle = hex(subC, 0.9 * L.lMul);
      ctx.fillText(L.subText, L.lx, ly + 6);
      targets.push({ x: L.lx + (L.align === "left" ? 30 : -30), y: ly, projectId: L.b.projectId });
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
      ctx.strokeStyle = hex(g.overdue ? (dark ? "#f0a04b" : "#b45309") : barkDim, 0.8 * mul2);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(gx, gy, 3.8, 0, Math.PI * 2);
      if (g.done) { ctx.fillStyle = hex(barkDim, 0.8 * mul2); ctx.fill(); } else ctx.stroke();
      if (found || view.acorn === g.taskId) {
        ctx.strokeStyle = hex(dark ? "#ffffff" : "#0a0a0a", 0.85);
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(gx, gy, 8, 0, Math.PI * 2);
        ctx.stroke();
      }
      targets.push({ x: gx, y: gy, projectId: "unfiled", taskId: g.taskId });
    });
    ctx.font = `500 10px ${theme.font || "system-ui"}`;
    ctx.textAlign = "left";
    ctx.fillStyle = hex(dark ? "#9a9aa3" : "#6b6b74", 0.85);
    ctx.fillText("fallen — not on a branch yet", geo.baseX + 60, geo.groundY + 16);
  }

  /* ------------------------------------------------------------ squirrel */
  const perch = view.squirrel || perchFor(null, layout, geo);
  drawSquirrel(ctx, perch.x, perch.y, perch.side, theme, t, Boolean(find) || view.squirrelHot);
  const thought = view.thought
    ? drawThought(ctx, perch, theme, t, theme.font || "system-ui", view.reduced)
    : null;
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
    bubble: thought
      ? { ...toScreen(thought), w: thought.w * z, h: thought.h * z }
      : null,
  };
}
