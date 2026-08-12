import { useEffect, useMemo, useRef, useState } from "react";
import { layoutOak, hitTest, perchFor, geometryFor, findOnTree } from "../lib/oak";
import { drawOak } from "../lib/oak-draw";
import { whenProject } from "../lib/when";
import { toggleTask, updateProject, dayKey } from "../lib/store";
import { resolveTheme, setTheme, onThemeChange } from "../lib/theme";
import { duration, money } from "../lib/format";
import { UNFILED } from "./ProjectDetail";
import { Button } from "./ui";

/**
 * Purpose: the whole of somebody's work, as one oak.
 *
 * Mighty oaks from little acorns grow — the proverb is the product. Every
 * live project is a branch, oldest lowest and thickest, the way wood works.
 * Every task is an acorn on its branch: open ones hang dim and unripe,
 * finished ones glow gold — stored away, which is what the app's own name
 * has promised all along. Unfiled work lies fallen at the roots. Wind moves
 * through the crown, and dragging feeds the gust.
 *
 * And the squirrel lives here. It perches on whatever you are reading, runs
 * along the tree when you change your mind, and at its crown lookout it
 * wonders out loud — a thought bubble asking "Looking for something?".
 * Tap the thought, tap the squirrel, or press "/" and it finds things:
 * type a few letters and the acorns that answer stay lit while the rest of
 * the tree steps back into the dark.
 *
 * This began life as a DNA helix; the oak replaced it because the shape of
 * this screen should belong to the brand, not to biology. The drawing lives
 * in lib/oak-draw and the geometry in lib/oak, both plain modules with no
 * React in them — the tree is testable arithmetic, and this component is
 * only the hand holding it.
 */
export default function Purpose({ state, onOpenProject, onStart }) {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const [selection, setSelection] = useState(null);
  const [mode, setMode] = useState(resolveTheme());
  const [touched, setTouched] = useState(false);
  const [finder, setFinder] = useState(null); // { q } while the squirrel listens
  const findInput = useRef(null);

  // The tree only re-grows when the work actually changes, not per frame.
  const layout = useMemo(
    () => layoutOak(state.projects, state.tasks, { today: dayKey() }),
    [state.projects, state.tasks],
  );

  const project = selection && selection !== UNFILED
    ? state.projects.find((p) => p.id === selection)
    : null;
  const unfiledOpen = selection === UNFILED;
  const found = finder?.q ? findOnTree(layout, finder.q) : null;

  /** Everything mutable per-frame lives in one ref, off React's books. */
  const v = useRef({
    t: 0, gust: 0, dim: 0, zoom: 1, panX: 0,
    dragging: false, lastX: 0, downAt: null,
    drawn: { targets: [], squirrel: null },
    squirrel: null,
    selection: null, find: null,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
  v.current.selection = unfiledOpen ? null : selection;
  v.current.find = found;
  v.current.finderOpen = Boolean(finder);

  const clear = () => setSelection(null);

  useEffect(() => onThemeChange(() => setMode(resolveTheme())), []);
  useEffect(() => {
    if (finder) findInput.current?.focus();
  }, [finder]);

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
      s.gust *= 0.94;
      s.dim += ((s.selection ? 1 : 0) - s.dim) * 0.1;

      /**
       * The squirrel runs: its perch is a target and its body an easing
       * towards it — which is the entire animation, and enough to read as an
       * animal rather than an icon being teleported.
       */
      const geo = geometryFor(box.clientWidth, box.clientHeight);
      const target = perchFor(s.selection, layout, geo);
      if (!s.squirrel) s.squirrel = { ...target };
      s.squirrel.x += (target.x - s.squirrel.x) * 0.07;
      s.squirrel.y += (target.y - s.squirrel.y) * 0.07;
      s.squirrel.side = target.side;

      s.drawn = drawOak(ctx, box.clientWidth, box.clientHeight, layout, {
        t, gust: s.gust, selection: s.selection, dim: s.dim,
        find: s.find, squirrel: s.squirrel, squirrelHot: Boolean(s.find),
        // The thought bubble shows while the squirrel keeps lookout — gone
        // the moment it is answered (finder open) or has a branch to show.
        thought: !s.selection && !s.find && !s.finderOpen,
        zoom: s.zoom, panX: s.panX, reduced: s.reduced,
      }, { mode, font });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // A hidden tab gets no frames — the tree can wait, the battery cannot.
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
      s.zoom = Math.max(0.8, Math.min(1.8, s.zoom * (1 - e.deltaY * 0.0012)));
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
    s.downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onMove = (e) => {
    const s = v.current;
    if (!s.dragging) return;
    // Dragging is weather: the pointer's speed becomes the gust.
    s.gust = Math.max(-1.2, Math.min(1.2, s.gust + (e.clientX - s.lastX) * 0.01));
    s.lastX = e.clientX;
    if (!touched && Math.abs(s.gust) > 0.2) setTouched(true);
  };
  const onUp = (e) => {
    const s = v.current;
    s.dragging = false;
    const d = s.downAt;
    s.downAt = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) >= 7 || performance.now() - d.t >= 450) return;
    const rect = canvas.current.getBoundingClientRect();
    const hit = hitTest(s.drawn, e.clientX - rect.left, e.clientY - rect.top);
    if (hit?.squirrel) {
      setFinder({ q: "" });
      setTouched(true);
      return;
    }
    if (hit) {
      setSelection(hit.projectId === "unfiled" ? UNFILED : hit.projectId);
      setFinder(null);
      setTouched(true);
    } else if (s.selection || finder) {
      clear();
      setFinder(null);
    }
  };

  /**
   * The keyboard walks the tree: arrows step branch to branch, Enter opens
   * the project, Escape lets go — and "/" summons the squirrel, same as
   * tapping it, because a finder unreachable from the keys is decoration.
   */
  const onKey = (e) => {
    if (e.key === "/") {
      e.preventDefault();
      setFinder({ q: "" });
      return;
    }
    const limbs = layout.branches;
    if (!limbs.length) return;
    const idx = limbs.findIndex((b) => b.projectId === selection);
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      setSelection(limbs[Math.min(limbs.length - 1, idx < 0 ? 0 : idx + 1)].projectId);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      setSelection(limbs[Math.max(0, idx < 0 ? limbs.length - 1 : idx - 1)].projectId);
    } else if (e.key === "Escape") {
      clear();
    } else if (e.key === "Enter" && selection) {
      onOpenProject(selection);
    }
  };

  /** The squirrel found it: select it, run to it, read it. */
  const pick = (r) => {
    setSelection(r.projectId ?? UNFILED);
    setFinder(null);
    canvas.current?.focus();
  };

  const branch = layout.branches.find((b) => b.projectId === selection);
  const results = found?.results ?? [];

  return (
    <div ref={wrap} className="relative h-full min-h-0 flex-1 overflow-hidden bg-[var(--paper)]">
      <canvas
        ref={canvas}
        role="application"
        aria-label={
          layout.empty
            ? "Your oak — bare until the first acorn"
            : `Your oak — ${layout.branches.length} branches, ${layout.counts.done} of ${layout.counts.total} acorns stored away. Arrow keys walk the branches; press / and the squirrel finds anything.`
        }
        tabIndex={0}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onKeyDown={onKey}
        className="absolute inset-0 h-full w-full cursor-grab touch-none outline-none
                   active:cursor-grabbing"
      />

      {/* ------------------------------------------------ the grove's header */}
      <header className="pointer-events-none absolute left-6 top-6 select-none">
        <p className="label">Purpose</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Your oak</h1>
        {!layout.empty && (
          <p className="mt-1 text-xs text-[var(--muted)]">
            {layout.branches.length} {layout.branches.length === 1 ? "branch" : "branches"} ·{" "}
            {layout.counts.done} of {layout.counts.total} acorns stored away
          </p>
        )}
      </header>

      {/* Light and dark, from the grove itself — the same three-state theme
          the rest of the app follows. */}
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
              Your oak is bare. Every project becomes a branch, every task an
              acorn — and everything you finish is stored away for winter.
              Mighty oaks from little acorns grow.
            </p>
            <Button variant="primary" className="mt-4" onClick={onStart}>
              Plant the first acorn
            </Button>
          </div>
        </div>
      ) : (
        !touched && !finder && (
          <p className="pointer-events-none absolute bottom-6 left-1/2 w-max max-w-[92%] -translate-x-1/2
                        text-center text-xs text-[var(--faint)]">
            Drag for wind · tap a branch to read it · tap the squirrel to find anything
          </p>
        )
      )}

      {/* ------------------------------------------------ ask the squirrel */}
      {finder && (
        <div
          className="absolute left-1/2 top-16 w-[min(24rem,calc(100%-1.5rem))] -translate-x-1/2
                     rounded-xl border border-[var(--line)] bg-[var(--paper)]/92 p-3
                     shadow-[var(--float)] backdrop-blur-md"
        >
          <input
            ref={findInput}
            value={finder.q}
            onChange={(e) => setFinder({ q: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setFinder(null); canvas.current?.focus(); }
              if (e.key === "Enter" && results[0]) pick(results[0]);
            }}
            placeholder="What should I find? A task, a project…"
            aria-label="Ask the squirrel to find something"
            className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--faint)]"
          />
          {finder.q && (
            <ul className="mt-2 max-h-56 overflow-y-auto border-t border-[var(--hairline)] pt-1.5">
              {results.length === 0 && (
                <li className="py-2 text-xs text-[var(--muted)]">
                  Nothing on the tree matches — it may be spelled differently, or archived off the tree.
                </li>
              )}
              {results.map((r) => (
                <li key={`${r.kind}-${r.id}`}>
                  <button
                    onClick={() => pick(r)}
                    className="flex w-full items-baseline justify-between gap-3 rounded px-1.5 py-1.5
                               text-left text-sm transition-colors hover:bg-[var(--hairline)]"
                  >
                    <span className="truncate">{r.label}</span>
                    <span className="shrink-0 text-[11px] text-[var(--faint)]">
                      {r.kind === "project" ? "branch" : r.branch}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* --------------------------------------------------- the reading panel */}
      {(branch || unfiledOpen) && !finder && (
        <aside
          aria-label={`${branch ? branch.name : "Unfiled"} branch`}
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
                  style={{ background: branch ? (mode === "dark" ? branch.color.dark : branch.color.light) : "var(--muted)" }}
                />
                <span className="truncate">{branch ? branch.name : "Unfiled"}</span>
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                {branch
                  ? `${branch.doneCount} of ${branch.count} stored away`
                  : "fallen — not on a branch yet"}
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
                * What this branch is *for*. The one field on this screen that
                * writes, because purpose is the screen's subject: a project
                * with its meaning written down survives the week that goes
                * badly. Saved on blur, like every inline field in the app.
                */}
              <textarea
                key={project.id}
                defaultValue={project.meaning || ""}
                onBlur={(e) => updateProject(project.id, { meaning: e.target.value.trim() })}
                placeholder="Why does this branch exist? What does finishing it change?"
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
              Acorns with no branch of their own yet. Say{" "}
              <span className="text-[var(--ink)]">“file the lease under Q3 launch”</span>{" "}
              and they climb the tree.
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
                    style={t.done ? { background: branch ? (mode === "dark" ? branch.color.dark : branch.color.light) : "var(--muted)" } : {}}
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
            Open the whole branch →
          </Button>
        </aside>
      )}
    </div>
  );
}

/**
 * When this branch began, and when it lands.
 *
 * The landing date comes from `whenProject` — the same blocks the calendar
 * draws — so the tree can never promise a different week than the planner.
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
