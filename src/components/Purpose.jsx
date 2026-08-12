import { useEffect, useMemo, useRef, useState } from "react";
import { layoutHelix, hitTest, spinToFace, camYFor } from "../lib/helix";
import { drawHelix } from "../lib/helix-draw";
import { whenProject } from "../lib/when";
import { toggleTask, updateProject, dayKey } from "../lib/store";
import { resolveTheme, setTheme, onThemeChange } from "../lib/theme";
import { duration, money } from "../lib/format";
import { UNFILED } from "./ProjectDetail";
import { Button } from "./ui";

/**
 * Purpose: the whole of somebody's work, as one strand.
 *
 * Every other screen in the app is a slice — a day, a week, one project's
 * list. This is the only place the entire thing is visible at once: every
 * project a gene along a double helix, every task a base pair inside it, the
 * finished work lit and the unfinished work waiting. It exists for the moment
 * the other screens cannot provide: seeing that the scattered lists amount to
 * a life that is going somewhere.
 *
 * It is deliberately a *place*, not a report. It opens onto a dark room with
 * one object floating in it. You can turn the object with your hand, and
 * tapping any strand pulls that project forward while the rest of the life
 * recedes — which is the feeling the screen is for, more than any number on
 * it.
 *
 * The drawing lives in lib/helix-draw and the geometry in lib/helix, both
 * plain modules with no React in them — the strand is testable arithmetic,
 * and this component is only the hand holding it: pointer→spin, tap→select,
 * store→layout, theme→palette.
 */
export default function Purpose({ state, onOpenProject, onStart }) {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const [selection, setSelection] = useState(null);
  const [mode, setMode] = useState(resolveTheme());
  const [touched, setTouched] = useState(false);

  // The strand only re-lays when the work actually changes, not per frame.
  const layout = useMemo(
    () => layoutHelix(state.projects, state.tasks, { today: dayKey() }),
    [state.projects, state.tasks],
  );

  const project = selection && selection !== UNFILED
    ? state.projects.find((p) => p.id === selection)
    : null;
  const unfiledOpen = selection === UNFILED;

  /** Everything mutable per-frame lives in one ref, off React's books. */
  const v = useRef({
    spin: 0.6, camY: 0, zoom: 1, dim: 0, t: 0, vel: 0,
    targetSpin: null, targetCamY: null,
    dragging: false, lastX: 0, lastT: 0, downAt: null, idleAt: 0,
    drawn: { rungs: [], labels: [] },
    selection: null,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
  v.current.selection = selection;

  /** Select a gene and glide the camera to face it. */
  const focus = (projectId) => {
    const key = projectId === null ? UNFILED : projectId;
    setSelection(key);
    const seg = layout.segments.find((s) => (s.projectId ?? UNFILED) === key);
    if (seg) {
      v.current.targetSpin = spinToFace(seg, layout, v.current.spin);
      v.current.targetCamY = camYFor(seg, v.current.lastHeight || 700);
    }
  };
  const clear = () => { setSelection(null); v.current.targetCamY = 0; };

  useEffect(() => onThemeChange(() => setMode(resolveTheme())), []);

  /* ------------------------------------------------------------ the loop */
  useEffect(() => {
    const el = canvas.current;
    const box = wrap.current;
    if (!el || !box) return;
    const ctx = el.getContext("2d");
    let raf = 0;
    let alive = true;
    const font = getComputedStyle(el).fontFamily;

    const size = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      el.width = box.clientWidth * dpr;
      el.height = box.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(box);

    const frame = (t) => {
      if (!alive) return;
      const s = v.current;
      s.t = t;
      s.lastHeight = box.clientHeight * 0.78;
      if (!s.dragging) {
        if (s.targetSpin != null) {
          s.spin += (s.targetSpin - s.spin) * 0.08;
          if (Math.abs(s.targetSpin - s.spin) < 0.002) s.targetSpin = null;
        } else {
          s.spin += s.vel;
          s.vel *= 0.95;
          // The idle drift: alive, not restless. It waits out a touch, and it
          // holds still while something is selected — a specimen being read
          // should not wander.
          if (!s.reduced && Math.abs(s.vel) < 0.0004 && t - s.idleAt > 2400 && !s.selection) {
            s.spin += 0.0011;
          }
        }
      }
      if (s.targetCamY != null) {
        s.camY += (s.targetCamY - s.camY) * 0.08;
        if (Math.abs(s.targetCamY - s.camY) < 0.5 && !s.selection) s.targetCamY = null;
      }
      s.dim += ((s.selection ? 1 : 0) - s.dim) * 0.1;
      s.drawn = drawHelix(ctx, box.clientWidth, box.clientHeight, layout, {
        spin: s.spin, camY: s.camY, zoom: s.zoom, dim: s.dim, t,
        selection: s.selection, reduced: s.reduced,
      }, { mode, font });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // A hidden tab gets no frames — the strand can wait, the battery cannot.
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && alive) raf = requestAnimationFrame(frame);
    };
    document.addEventListener("visibilitychange", onVis);

    /**
     * Wheel zoom, attached by hand: React registers `onWheel` passively, so a
     * `preventDefault` inside it is silently ignored and the page scrolls
     * behind the zoom — the canvas needs a real non-passive listener.
     */
    const onWheel = (e) => {
      e.preventDefault();
      const s = v.current;
      s.zoom = Math.max(0.6, Math.min(1.9, s.zoom * (1 - e.deltaY * 0.0012)));
      s.idleAt = performance.now();
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      el.removeEventListener("wheel", onWheel);
    };
  }, [layout, mode]);

  /* ------------------------------------------------------- the hand */
  const onDown = (e) => {
    const s = v.current;
    s.dragging = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    s.lastX = e.clientX;
    s.lastT = performance.now();
    s.downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    s.targetSpin = null;
    s.vel = 0;
  };
  const onMove = (e) => {
    const s = v.current;
    if (!s.dragging) return;
    const now = performance.now();
    const dx = e.clientX - s.lastX;
    s.spin += dx * 0.008;
    s.vel = ((dx * 0.008) / Math.max(1, now - s.lastT)) * 16;
    s.lastX = e.clientX;
    s.lastT = now;
    s.idleAt = now;
    if (!touched && Math.abs(dx) > 2) setTouched(true);
  };
  const onUp = (e) => {
    const s = v.current;
    s.dragging = false;
    const d = s.downAt;
    s.downAt = null;
    s.idleAt = performance.now();
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) >= 7 || performance.now() - d.t >= 400) return;
    const rect = canvas.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = hitTest(s.drawn.rungs, x, y)
      || s.drawn.labels.find((l) => x >= l.x && x <= l.x + l.w && y >= l.y && y <= l.y + l.h);
    if (hit) { focus(hit.projectId); setTouched(true); }
    else if (s.selection) clear();
  };

  /**
   * The keyboard walks the strand: arrows step gene to gene, Enter opens the
   * project itself, Escape lets go. This is also what makes the screen usable
   * without sight of the canvas — the same selection, driven from keys, read
   * back through the panel.
   */
  const onKey = (e) => {
    const genes = layout.segments;
    if (!genes.length) return;
    const idx = genes.findIndex((s) => (s.projectId ?? UNFILED) === selection);
    if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      e.preventDefault();
      focus(genes[Math.max(0, idx < 0 ? genes.length - 1 : idx - 1)].projectId);
    } else if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      e.preventDefault();
      focus(genes[Math.min(genes.length - 1, idx < 0 ? 0 : idx + 1)].projectId);
    } else if (e.key === "Escape") {
      clear();
    } else if (e.key === "Enter" && selection) {
      onOpenProject(selection);
    }
  };

  const seg = layout.segments.find((s) => (s.projectId ?? UNFILED) === selection);
  const woven = layout.rungs.filter((r) => r.done).length;

  return (
    <div ref={wrap} className="relative h-full min-h-0 flex-1 overflow-hidden bg-[var(--paper)]">
      <canvas
        ref={canvas}
        role="application"
        aria-label={
          layout.empty
            ? "Your helix — empty until the first project"
            : `Your helix — ${layout.segments.length} strands, ${woven} of ${layout.rungs.length} base pairs woven in. Arrow keys walk the strand.`
        }
        tabIndex={0}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onKeyDown={onKey}
        className="absolute inset-0 h-full w-full cursor-grab touch-none outline-none
                   active:cursor-grabbing"
      />

      {/* ------------------------------------------------ the room's header */}
      <header className="pointer-events-none absolute left-6 top-6 select-none">
        <p className="label">Purpose</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Your helix</h1>
        {!layout.empty && (
          <p className="mt-1 text-xs text-[var(--muted)]">
            {layout.segments.length} {layout.segments.length === 1 ? "strand" : "strands"} ·{" "}
            {woven} of {layout.rungs.length} base pairs woven in
          </p>
        )}
      </header>

      {/* Light and dark, from the room itself — the same three-state theme the
          rest of the app follows, cycled from here because a black room and a
          paper room are both worth seeing. */}
      <button
        onClick={() => setTheme(resolveTheme() === "dark" ? "light" : "dark")}
        aria-label="Toggle appearance"
        className="absolute right-6 top-6 grid h-9 w-9 place-items-center rounded-full border
                   border-[var(--line)] bg-[var(--paper)]/60 text-sm backdrop-blur
                   transition-colors hover:border-[var(--ink)]"
      >
        {mode === "dark" ? "◐" : "◑"}
      </button>

      {layout.empty ? (
        <div className="absolute inset-0 grid place-items-center">
          <div className="pointer-events-auto max-w-xs text-center">
            <p className="text-sm text-[var(--muted)]">
              Your helix is unwritten. Every project becomes a strand of it,
              and every task a base pair — start one and watch it grow.
            </p>
            <Button variant="primary" className="mt-4" onClick={onStart}>
              Start the first strand
            </Button>
          </div>
        </div>
      ) : (
        !touched && (
          <p className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 text-xs
                        text-[var(--faint)]">
            Drag to turn · tap a strand to read it
          </p>
        )
      )}

      {/* --------------------------------------------------- the reading panel */}
      {seg && (
        <aside
          aria-label={`${seg.name} strand`}
          className="absolute inset-x-3 bottom-3 max-h-[62%] overflow-y-auto rounded-xl border
                     border-[var(--line)] bg-[var(--paper)]/92 p-4 shadow-[var(--float)]
                     backdrop-blur-md sm:inset-x-auto sm:bottom-auto sm:right-6 sm:top-20
                     sm:max-h-[calc(100%-7rem)] sm:w-[21rem]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: mode === "dark" ? seg.color.dark : seg.color.light }}
                />
                <span className="truncate">{seg.name}</span>
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                {seg.doneCount} of {seg.count} woven in
                {project?.client ? ` · ${project.client}` : ""}
                {project?.value ? ` · ${money(project.value)}` : ""}
              </p>
            </div>
            <button
              onClick={clear}
              aria-label="Close"
              className="shrink-0 px-1 text-[var(--faint)] hover:text-[var(--ink)]"
            >
              ×
            </button>
          </div>

          {project && (
            <>
              {/**
                * What this strand is *for*. The one field on this screen that
                * writes, because purpose is the screen's subject: a project
                * with its meaning written down survives the week that goes
                * badly. Saved on blur, like every inline field in the app.
                */}
              <textarea
                key={project.id}
                defaultValue={project.meaning || ""}
                onBlur={(e) => updateProject(project.id, { meaning: e.target.value.trim() })}
                placeholder="Why does this strand exist? What does finishing it change?"
                rows={2}
                className="mt-3 w-full resize-none rounded-lg border border-[var(--hairline)]
                           bg-transparent px-2.5 py-2 text-xs leading-relaxed outline-none
                           placeholder:text-[var(--faint)] focus:border-[var(--ink)]"
              />
              <Timeline project={project} state={state} />
            </>
          )}

          {unfiledOpen && (
            <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
              Work with no strand of its own yet. Say{" "}
              <span className="text-[var(--ink)]">“file the lease under Q3 launch”</span>{" "}
              and it joins one.
            </p>
          )}

          <ul className="mt-3 space-y-1 border-t border-[var(--hairline)] pt-2">
            {state.tasks
              .filter((t) => (unfiledOpen ? !t.projectId : t.projectId === selection))
              .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
              .slice(0, 7)
              .map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-xs">
                  <button
                    onClick={() => toggleTask(t.id)}
                    aria-label={t.done ? `Mark ${t.title} not done` : `Mark ${t.title} done`}
                    className={`h-3 w-3 shrink-0 rounded-full border transition-colors ${
                      t.done ? "border-transparent" : "border-[var(--line)] hover:border-[var(--ink)]"
                    }`}
                    style={t.done ? { background: mode === "dark" ? seg.color.dark : seg.color.light } : {}}
                  />
                  <span className={`truncate ${t.done ? "text-[var(--faint)] line-through" : ""}`}>
                    {t.title}
                  </span>
                </li>
              ))}
          </ul>

          <Button
            variant="ghost"
            size="sm"
            className="mt-3 w-full"
            onClick={() => onOpenProject(selection)}
          >
            Open the whole strand →
          </Button>
        </aside>
      )}
    </div>
  );
}

/**
 * When this strand began, and when it lands.
 *
 * The landing date comes from `whenProject` — the same blocks the calendar
 * draws — so the helix can never promise a different week than the planner.
 */
function Timeline({ project, state }) {
  const lands = whenProject(project, state.tasks, state);
  const started = project.createdAt
    ? new Date(project.createdAt).toLocaleDateString([], { month: "short", year: "numeric" })
    : null;
  const focused = state.sessions
    .filter((s) => s.projectId === project.id)
    .reduce((n, s) => n + (s.focusedMs || 0), 0);

  return (
    <p className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--muted)]">
      {started && <span>began {started}</span>}
      {focused > 0 && <span>{duration(focused)} lived in it</span>}
      {lands?.short && lands.state !== "clear" && (
        <span className={lands.state === "short" || lands.state === "late" ? "font-medium text-[var(--ink)]" : ""}>
          {lands.short}
        </span>
      )}
    </p>
  );
}
