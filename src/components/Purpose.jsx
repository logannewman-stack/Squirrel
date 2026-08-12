import { useEffect, useMemo, useRef, useState } from "react";
import { layoutOak, hitTest, perchFor, geometryFor, findOnTree } from "../lib/oak";
import { drawOak } from "../lib/oak-draw";
import { whenProject } from "../lib/when";
import { workOn, fmtTime } from "../lib/agenda";
import { planOpts } from "../lib/hours";
import {
  addProject, addTask, toggleTask, updateProject, updateTask, setProjectArchived, dayKey,
} from "../lib/store";
import { resolveTheme, setTheme, onThemeChange } from "../lib/theme";
import { duration, money } from "../lib/format";
import { UNFILED } from "./ProjectDetail";
import { Button } from "./ui";

/**
 * Purpose: the whole of somebody's work, as one oak.
 *
 * Mighty oaks from little acorns grow — the proverb is the product. Every
 * live project is a branch, oldest lowest and thickest, the way wood works;
 * sub-projects are side shoots growing off their parent's bough. Every task
 * is an acorn: an outline while it ripens, a filled dot once it is stored
 * away. Unfiled work lies fallen at the roots. Wind moves through the crown,
 * and dragging feeds the gust.
 *
 * The tree is not just read here — it is grown here. The "+" by the theme
 * toggle plants a new branch; a branch's own card grows sub-branches and
 * hangs acorns; and every acorn opens into its own small reading, where it
 * can be stored away or put back.
 *
 * And the squirrel lives here. It perches on whatever you are reading, and
 * at its crown lookout it wonders out loud — a thought bubble asking
 * "Looking for something?". Tap the thought, tap the squirrel, or press "/"
 * and it finds branches and acorns alike, carrying you to the exact one.
 *
 * This began life as a DNA helix; the oak replaced it because the shape of
 * this screen should belong to the brand, not to biology. The drawing lives
 * in lib/oak-draw and the geometry in lib/oak, both plain modules with no
 * React in them — the tree is testable arithmetic, and this component is
 * only the hand holding it.
 */
export default function Purpose({ state, onOpenProject, onStart, onFocus }) {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const [selection, setSelection] = useState(null);
  const [acornId, setAcornId] = useState(null); // the one acorn open in the panel
  const [mode, setMode] = useState(resolveTheme());
  const [touched, setTouched] = useState(false);
  const [finder, setFinder] = useState(null); // { q } while the squirrel listens
  const [plant, setPlant] = useState(false); // naming a new trunk branch
  const [grow, setGrow] = useState(null); // { kind: "sub" | "acorn" } inside the card
  const [openDay, setOpenDay] = useState(null); // a day of the week dock, being read
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
  const acornTask = acornId ? state.tasks.find((t) => t.id === acornId) : null;

  /**
   * The week, routed. `state.blocks` is the one plan — the same distribution
   * Today works from and the calendar draws — so the tree showing where its
   * acorns land can never disagree with the day that arrives. Seven days,
   * each with the blocks the planner gave it.
   */
  const week = useMemo(() => {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const key = dayKey(d);
      const rows = workOn(state.blocks || [], state.tasks, key);
      days.push({
        key,
        short: i === 0 ? "now" : d.toLocaleDateString([], { weekday: "narrow" }),
        wd: i === 0 ? "Today" : d.toLocaleDateString([], { weekday: "short" }),
        name: i === 0 ? "today" : d.toLocaleDateString([], { weekday: "long" }),
        date: d.toLocaleDateString([], { month: "short", day: "numeric" }),
        mins: rows.reduce((n, b) => n + b.mins, 0),
        rows,
      });
    }
    return days;
  }, [state.blocks, state.tasks]);
  const weekMins = week.reduce((n, d) => n + d.mins, 0);
  const dayCap = planOpts(state.settings).dailyCapacity || 300;
  const dockUp = !layout.empty && (weekMins > 0 || (state.shortfalls?.length ?? 0) > 0);
  const readingDay = openDay ? week.find((d) => d.key === openDay) : null;

  /** Everything mutable per-frame lives in one ref, off React's books. */
  const v = useRef({
    t: 0, gust: 0, dim: 0, zoom: 1, panX: 0,
    dragging: false, lastX: 0, downAt: null,
    pts: new Map(), pinch: 0,
    drawn: { targets: [], squirrel: null, bubble: null },
    squirrel: null,
    selection: null, acorn: null, find: null, finderOpen: false,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
  v.current.selection = unfiledOpen ? null : selection;
  v.current.acorn = acornId;
  v.current.find = found;
  v.current.finderOpen = Boolean(finder);

  const clear = () => {
    setSelection(null);
    setAcornId(null);
    setGrow(null);
  };

  useEffect(() => onThemeChange(() => setMode(resolveTheme())), []);
  useEffect(() => {
    if (finder) findInput.current?.focus();
  }, [finder]);
  useEffect(() => setGrow(null), [selection]);

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
        t, gust: s.gust, selection: s.selection, acorn: s.acorn, dim: s.dim,
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
    s.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    if (s.pts.size === 2) {
      // A second finger means pinch, not tap and not weather.
      const [a, b] = [...s.pts.values()];
      s.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      s.dragging = false;
      s.downAt = null;
      return;
    }
    s.dragging = true;
    s.lastX = e.clientX;
    s.downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onMove = (e) => {
    const s = v.current;
    if (!s.pts.has(e.pointerId)) return;
    s.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (s.pts.size === 2) {
      // Pinch: the spread between two fingers scales the tree directly.
      const [a, b] = [...s.pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (s.pinch > 0) s.zoom = Math.max(0.8, Math.min(1.8, s.zoom * (d / s.pinch)));
      s.pinch = d;
      return;
    }
    if (!s.dragging) return;
    // Dragging is weather: the pointer's speed becomes the gust.
    s.gust = Math.max(-1.2, Math.min(1.2, s.gust + (e.clientX - s.lastX) * 0.01));
    s.lastX = e.clientX;
    if (!touched && Math.abs(s.gust) > 0.2) setTouched(true);
  };
  const onUp = (e) => {
    const s = v.current;
    s.pts.delete(e.pointerId);
    if (s.pts.size < 2) s.pinch = 0;
    s.dragging = false;
    const d = s.downAt;
    s.downAt = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) >= 7 || performance.now() - d.t >= 450) return;
    const rect = canvas.current.getBoundingClientRect();
    const hit = hitTest(s.drawn, e.clientX - rect.left, e.clientY - rect.top);
    if (hit?.squirrel) {
      setFinder({ q: "" });
      setPlant(false);
      setTouched(true);
      return;
    }
    if (hit) {
      // An acorn opens itself; wood and labels open their branch.
      setSelection(hit.projectId === "unfiled" ? UNFILED : hit.projectId);
      setAcornId(hit.taskId || null);
      setFinder(null);
      setPlant(false);
      setOpenDay(null);
      setTouched(true);
    } else if (s.selection || finder || plant || openDay) {
      clear();
      setFinder(null);
      setPlant(false);
      setOpenDay(null);
    }
  };

  /**
   * The keyboard walks the tree: arrows step branch to branch (sub-branches
   * in stride), Enter opens the project, Escape lets go one layer at a time
   * — and "/" summons the squirrel, same as tapping it, because a finder
   * unreachable from the keys is decoration.
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
    if (e.key === "ArrowRight" || (!selection && e.key === "ArrowUp")) {
      e.preventDefault();
      setAcornId(null);
      setSelection(limbs[Math.min(limbs.length - 1, idx < 0 ? 0 : idx + 1)].projectId);
    } else if (e.key === "ArrowLeft" || (!selection && e.key === "ArrowDown")) {
      e.preventDefault();
      setAcornId(null);
      setSelection(limbs[Math.max(0, idx < 0 ? limbs.length - 1 : idx - 1)].projectId);
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && selection) {
      // Down and up walk the acorns of the branch being read, one card at a
      // time; up from the first steps back to the branch itself.
      e.preventDefault();
      const list = branch ? branch.acorns : layout.ground;
      if (!list.length) return;
      const ai = list.findIndex((a) => a.taskId === acornId);
      if (e.key === "ArrowDown") setAcornId(list[Math.min(list.length - 1, ai + 1)].taskId);
      else if (ai <= 0) setAcornId(null);
      else setAcornId(list[ai - 1].taskId);
    } else if (e.key === "Escape") {
      if (openDay) setOpenDay(null);
      else if (acornId) setAcornId(null);
      else clear();
    } else if (e.key === "Enter" && selection) {
      onOpenProject(selection);
    }
  };

  /** The squirrel found it: run there and open exactly what was found. */
  const pick = (r) => {
    if (r.kind === "task") {
      setSelection(r.projectId ?? UNFILED);
      setAcornId(r.id);
    } else {
      setSelection(r.id);
      setAcornId(null);
    }
    setFinder(null);
    setOpenDay(null);
    canvas.current?.focus();
  };

  const branch = layout.branches.find((b) => b.projectId === selection);
  const shoots = branch && !branch.host
    ? layout.branches.filter((x) => x.host === branch)
    : [];
  const acornBranch = acornTask?.projectId
    ? layout.branches.find((b) => b.projectId === acornTask.projectId)
    : null;
  const results = found?.results ?? [];

  /** One quiet input, shared by everything that grows something. */
  const seedInput = (label, placeholder, onName, onClose) => (
    <input
      autoFocus
      aria-label={label}
      placeholder={placeholder}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        if (e.key === "Enter" && e.target.value.trim()) onName(e.target.value.trim());
      }}
      className="w-full rounded-lg border border-[var(--hairline)] bg-transparent px-2.5 py-2
                 text-sm outline-none placeholder:text-[var(--faint)] focus:border-[var(--ink)]"
    />
  );

  return (
    <div ref={wrap} className="relative h-full min-h-0 flex-1 overflow-hidden bg-[var(--paper)]">
      <canvas
        ref={canvas}
        role="application"
        aria-label={
          layout.empty
            ? "Your oak — bare until the first acorn"
            : `Your oak — ${layout.branches.length} branches, ${layout.counts.done} of ${layout.counts.total} acorns stored away. Left and right walk the branches, down and up walk a branch's acorns, Enter opens the whole project, and / asks the squirrel to find anything.`
        }
        tabIndex={0}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={() => { v.current.zoom = 1; v.current.panX = 0; }}
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
            {weekMins > 0 ? ` · ${hm(weekMins)} routed this week` : ""}
          </p>
        )}
      </header>

      <div className="absolute right-6 top-6 flex items-center gap-2">
        {/* Plant a branch without leaving the tree — creation lives here too. */}
        <button
          onClick={() => { setPlant((p) => !p); setFinder(null); }}
          aria-label="Plant a branch"
          className="grid h-9 w-9 place-items-center rounded-full border border-[var(--line)]
                     bg-[var(--paper)]/60 text-base backdrop-blur transition-colors
                     hover:border-[var(--ink)]"
        >
          +
        </button>
        {/* Light and dark, from the grove itself — the same three-state theme
            the rest of the app follows. */}
        <button
          onClick={() => setTheme(resolveTheme() === "dark" ? "light" : "dark")}
          aria-label="Toggle appearance"
          className="grid h-9 w-9 place-items-center rounded-full border border-[var(--line)]
                     bg-[var(--paper)]/60 text-sm backdrop-blur transition-colors
                     hover:border-[var(--ink)]"
        >
          {mode === "dark" ? "◐" : "◑"}
        </button>
      </div>

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
        !touched && !finder && !plant && (
          <p className={`pointer-events-none absolute left-1/2 w-max max-w-[92%] -translate-x-1/2
                        text-center text-xs text-[var(--faint)] ${dockUp ? "bottom-[4.8rem]" : "bottom-6"}`}>
            Tap anything — a branch, an acorn, the squirrel · drag for wind
          </p>
        )
      )}

      {/* ------------------------------------------------ the week, routed */}
      {/**
        * Seven days at the foot of the tree, each column filled to the height
        * of the work the planner routed into it. This is the tree's answer to
        * "when will all this actually happen?" — read from the same
        * `state.blocks` Today works from, so it cannot disagree with the day
        * that arrives. A tap opens the day; an over-committed day caps amber.
        */}
      {dockUp && (
        <div
          className={`absolute bottom-3 left-1/2 -translate-x-1/2 items-end gap-1 rounded-xl border
                      border-[var(--line)] bg-[var(--paper)]/85 px-2.5 py-1.5 backdrop-blur-md
                      sm:left-6 sm:translate-x-0
                      ${branch || unfiledOpen || acornTask || finder || plant || openDay
                        ? "hidden sm:flex" : "flex"}`}
        >
          {week.map((d) => (
            <button
              key={d.key}
              onClick={() => { setOpenDay(openDay === d.key ? null : d.key); setPlant(false); setFinder(null); }}
              aria-label={`${d.name} — ${d.mins ? `${hm(d.mins)} routed` : "nothing routed"}`}
              title={`${d.name} · ${d.mins ? hm(d.mins) : "clear"}`}
              className="group flex w-6 flex-col items-center gap-1"
            >
              <span
                className={`flex h-10 w-3.5 items-end overflow-hidden rounded-sm border transition-colors ${
                  openDay === d.key ? "border-[var(--ink)]" : "border-[var(--hairline)] group-hover:border-[var(--muted)]"
                }`}
              >
                <span
                  className={`w-full ${d.mins > dayCap ? "bg-[var(--alert)]" : "bg-[var(--ink)]"}`}
                  style={{
                    height: `${Math.min(100, Math.round((d.mins / dayCap) * 100))}%`,
                    opacity: d.mins ? 0.9 : 0,
                  }}
                />
              </span>
              <span className={`text-[9px] leading-none ${d.key === week[0].key ? "text-[var(--ink)]" : "text-[var(--faint)]"}`}>
                {d.short}
              </span>
            </button>
          ))}
          <span className="num ml-1.5 pb-4 text-[10px] text-[var(--muted)]">{hm(weekMins)}</span>
        </div>
      )}

      {/* ------------------------------------------------ plant a new branch */}
      {plant && (
        <div
          className="absolute left-1/2 top-16 w-[min(24rem,calc(100%-1.5rem))] -translate-x-1/2
                     rounded-xl border border-[var(--line)] bg-[var(--paper)]/92 p-3
                     shadow-[var(--float)] backdrop-blur-md"
        >
          {seedInput(
            "Name the new branch",
            "Name the new branch…",
            (name) => {
              const p = addProject({ name });
              setPlant(false);
              setAcornId(null);
              setSelection(p.id);
              canvas.current?.focus();
            },
            () => { setPlant(false); canvas.current?.focus(); },
          )}
        </div>
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

      {/* -------------------------------------------------- one routed day */}
      {readingDay && !finder && (
        <aside
          aria-label={`${readingDay.name} routed`}
          className="absolute inset-x-3 bottom-3 max-h-[62%] overflow-y-auto rounded-xl border
                     border-[var(--line)] bg-[var(--paper)]/92 p-4 shadow-[var(--float)]
                     backdrop-blur-md sm:inset-x-auto sm:bottom-auto sm:right-6 sm:top-20
                     sm:max-h-[calc(100%-7rem)] sm:w-[21rem]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="label">{readingDay.date}</p>
              <p className="mt-1 text-sm font-semibold capitalize">{readingDay.name}</p>
              <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                {readingDay.mins
                  ? `${hm(readingDay.mins)} routed · ${new Set(readingDay.rows.map((b) => b.taskId)).size} ${
                      new Set(readingDay.rows.map((b) => b.taskId)).size === 1 ? "acorn" : "acorns"
                    }`
                  : "nothing routed — a clear day"}
              </p>
            </div>
            <button
              onClick={() => setOpenDay(null)}
              aria-label="Close"
              className="shrink-0 px-1 text-[var(--faint)] hover:text-[var(--ink)]"
            >
              ×
            </button>
          </div>

          {readingDay.rows.length > 0 && (
            <ul className="mt-3 space-y-0.5 border-t border-[var(--hairline)] pt-2">
              {readingDay.rows.map((b, i) => (
                <li key={`${b.taskId}-${i}`}>
                  {/* Each routed block walks back to its acorn — the day and
                      the tree are two views of one plan. */}
                  <button
                    onClick={() => {
                      setOpenDay(null);
                      setSelection(b.task.projectId ?? UNFILED);
                      setAcornId(b.taskId);
                    }}
                    className="flex w-full items-baseline gap-2 rounded px-1 py-1 text-left text-xs
                               transition-colors hover:bg-[var(--hairline)]"
                  >
                    <span className="num w-14 shrink-0 text-[var(--muted)]">
                      {b.start ? fmtTime(b.start) : "—"}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{b.task.title}</span>
                    <span className="num shrink-0 text-[10px] text-[var(--faint)]">{hm(b.mins)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {(state.shortfalls?.length ?? 0) > 0 && (
            <p className="alert mt-3 border-t border-[var(--hairline)] pt-2 text-[11px]">
              {state.shortfalls.length === 1
                ? "1 task doesn't fit before its deadline"
                : `${state.shortfalls.length} tasks don't fit before their deadlines`}
              {" — Today has the details."}
            </p>
          )}
        </aside>
      )}

      {/* --------------------------------------------------- one open acorn */}
      {acornTask && !finder && !readingDay && (
        <aside
          aria-label={`${acornTask.title} acorn`}
          className="absolute inset-x-3 bottom-3 max-h-[62%] overflow-y-auto rounded-xl border
                     border-[var(--line)] bg-[var(--paper)]/92 p-4 shadow-[var(--float)]
                     backdrop-blur-md sm:inset-x-auto sm:bottom-auto sm:right-6 sm:top-20
                     sm:max-h-[calc(100%-7rem)] sm:w-[21rem]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <button
                onClick={() => setAcornId(null)}
                className="label transition-colors hover:text-[var(--ink)]"
              >
                {acornBranch ? acornBranch.name : "Unfiled"} ›
              </button>
              <p className="mt-1 text-sm font-semibold leading-snug">{acornTask.title}</p>
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                <span className={!acornTask.done && acornTask.due && acornTask.due < dayKey() ? "alert" : ""}>
                  {acornTask.done
                    ? "stored away"
                    : acornTask.due && acornTask.due < dayKey() ? "overdue" : "ripening"}
                </span>
                {acornTask.estimateMins ? ` · ${acornTask.estimateMins}m` : ""}
                {acornTask.due
                  ? ` · due ${new Date(`${acornTask.due}T00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}`
                  : ""}
                {acornTask.delegatedTo ? ` · with ${acornTask.delegatedTo}` : ""}
              </p>
              {/* When the planner routed it — and the line is a door to that
                  day. Honest when it couldn't be: no estimate, or no room. */}
              {!acornTask.done && (() => {
                const mine = (state.blocks || []).filter((b) => b.taskId === acornTask.id);
                if (mine.length) {
                  const total = mine.reduce((n, b) => n + b.mins, 0);
                  const when = new Date(`${mine[0].day}T00:00`).toLocaleDateString([], { weekday: "short" });
                  const label = `routed ${when}${mine[0].start ? ` ${fmtTime(mine[0].start)}` : ""}${
                    mine.length > 1 ? ` +${mine.length - 1} more` : ""
                  } · ${hm(total)}`;
                  return week.some((d) => d.key === mine[0].day) ? (
                    <button
                      onClick={() => setOpenDay(mine[0].day)}
                      className="mt-1 block text-[11px] text-[var(--muted)] underline
                                 decoration-[var(--hairline)] underline-offset-2 transition-colors
                                 hover:text-[var(--ink)]"
                    >
                      {label}
                    </button>
                  ) : (
                    <p className="mt-1 text-[11px] text-[var(--muted)]">{label}</p>
                  );
                }
                if (state.shortfalls?.some((s) => s.taskId === acornTask.id)) {
                  return (
                    <p className="alert mt-1 text-[11px]">
                      {acornTask.pinDay
                        ? "doesn't fit on its pinned day"
                        : "doesn't fit before its deadline"}
                    </p>
                  );
                }
                if (!(acornTask.estimateMins > 0)) {
                  return (
                    <p className="mt-1 text-[11px] text-[var(--faint)]">
                      no estimate yet, so it can't be routed
                    </p>
                  );
                }
                return null;
              })()}
            </div>
            <button
              onClick={clear}
              aria-label="Close"
              className="shrink-0 px-1 text-[var(--faint)] hover:text-[var(--ink)]"
            >
              ×
            </button>
          </div>

          <div className="mt-3 flex flex-col gap-2">
            <div className="flex gap-2">
              <Button variant="primary" size="sm" className="flex-1" onClick={() => toggleTask(acornTask.id)}>
                {acornTask.done ? "Put it back" : "Store it away"}
              </Button>
              {/* The app's core verb, reachable from the tree: pick this
                  acorn up and work on it, right now. */}
              {!acornTask.done && onFocus && (
                <Button variant="ghost" size="sm" className="flex-1" onClick={() => onFocus(acornTask)}>
                  Focus on it
                </Button>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => onOpenProject(acornTask.projectId ? acornTask.projectId : UNFILED)}
            >
              Open the whole branch →
            </Button>
          </div>

          {/* "This one, Thursday." A pin overrides the router for one acorn
              and the rest of the week routes around it. Tapping the pinned
              day again lets go. */}
          {!acornTask.done && (
            <div className="mt-3 border-t border-[var(--hairline)] pt-2">
              <p className="label">{acornTask.pinDay ? "Pinned" : "Pin to a day"}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {week.map((d) => (
                  <button
                    key={d.key}
                    aria-label={`Pin to ${d.name}`}
                    onClick={() =>
                      updateTask(acornTask.id, {
                        pinDay: acornTask.pinDay === d.key ? null : d.key,
                      })
                    }
                    className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                      acornTask.pinDay === d.key
                        ? "border-[var(--ink)] font-medium"
                        : "border-[var(--line)] hover:border-[var(--ink)]"
                    }`}
                  >
                    {d.wd}
                  </button>
                ))}
                {acornTask.pinDay && (
                  <button
                    onClick={() => updateTask(acornTask.id, { pinDay: null })}
                    className="rounded-md px-2 py-1 text-[11px] text-[var(--faint)]
                               transition-colors hover:text-[var(--ink)]"
                  >
                    Unpin
                  </button>
                )}
              </div>
            </div>
          )}

          {/* A fallen acorn climbs straight onto a branch from here — the
              same filing the assistant does by voice, one tap instead. */}
          {!acornTask.projectId && layout.branches.length > 0 && (
            <div className="mt-3 border-t border-[var(--hairline)] pt-2">
              <p className="label">It climbs onto…</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {layout.branches.slice(0, 8).map((b) => (
                  <button
                    key={b.projectId}
                    onClick={() => {
                      updateTask(acornTask.id, { projectId: b.projectId });
                      setSelection(b.projectId);
                    }}
                    className="rounded-md border border-[var(--line)] px-2 py-1 text-[11px]
                               transition-colors hover:border-[var(--ink)]"
                  >
                    {b.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>
      )}

      {/* --------------------------------------------------- the reading panel */}
      {(branch || unfiledOpen) && !finder && !acornTask && !readingDay && (
        <aside
          aria-label={`${branch ? branch.name : "Unfiled"} branch`}
          className="absolute inset-x-3 bottom-3 max-h-[62%] overflow-y-auto rounded-xl border
                     border-[var(--line)] bg-[var(--paper)]/92 p-4 shadow-[var(--float)]
                     backdrop-blur-md sm:inset-x-auto sm:bottom-auto sm:right-6 sm:top-20
                     sm:max-h-[calc(100%-7rem)] sm:w-[21rem]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {/* A shoot names the bough that carries it — and the name is
                  the way back up. */}
              {branch?.host && (
                <button
                  onClick={() => { setAcornId(null); setSelection(branch.host.projectId); }}
                  className="label transition-colors hover:text-[var(--ink)]"
                >
                  off {branch.host.name} ›
                </button>
              )}
              <p className="truncate text-sm font-semibold">{branch ? branch.name : "Unfiled"}</p>
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
                * writes prose, because purpose is the screen's subject: a
                * project with its meaning written down survives the week that
                * goes badly. Saved on blur, like every inline field in the app.
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
              Acorns with no branch of their own yet. Open one and it can
              climb straight onto a branch.
            </p>
          )}

          {/* The shoots growing off this bough, each one a door. */}
          {shoots.length > 0 && (
            <div className="mt-3 border-t border-[var(--hairline)] pt-2">
              <p className="label">Shoots</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {shoots.map((s) => (
                  <button
                    key={s.projectId}
                    onClick={() => { setAcornId(null); setSelection(s.projectId); }}
                    className="rounded-md border border-[var(--line)] px-2 py-1 text-[11px]
                               transition-colors hover:border-[var(--ink)]"
                  >
                    {s.name} · {s.doneCount}/{s.count}
                  </button>
                ))}
              </div>
            </div>
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
                      t.done
                        ? "border-transparent bg-[var(--ink)]"
                        : "border-[var(--line)] hover:border-[var(--ink)]"
                    }`}
                  />
                  {/* The row is a door: every acorn opens up. */}
                  <button
                    onClick={() => setAcornId(t.id)}
                    className={`min-w-0 flex-1 truncate text-left transition-colors hover:text-[var(--ink)] ${
                      t.done ? "text-[var(--faint)] line-through" : ""
                    }`}
                  >
                    {t.title}
                  </button>
                </li>
              ))}
          </ul>

          {/* ------------------------------------------ growing, in place */}
          <div className="mt-3 border-t border-[var(--hairline)] pt-2.5">
            {grow ? (
              seedInput(
                grow.kind === "sub" ? "Name the new sub-branch" : "Name the new acorn",
                grow.kind === "sub" ? "Name the sub-branch…" : "Name the acorn…",
                (name) => {
                  if (grow.kind === "sub") {
                    const p = addProject({ name, parentId: selection });
                    setGrow(null);
                    setSelection(p.id);
                  } else {
                    const t = addTask(
                      unfiledOpen ? { title: name } : { title: name, projectId: selection },
                    );
                    setGrow(null);
                    setAcornId(t.id);
                  }
                },
                () => setGrow(null),
              )
            ) : (
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="flex-1" onClick={() => setGrow({ kind: "acorn" })}>
                  + Acorn
                </Button>
                {branch && !branch.host && (
                  <Button variant="ghost" size="sm" className="flex-1" onClick={() => setGrow({ kind: "sub" })}>
                    + Sub-branch
                  </Button>
                )}
              </div>
            )}
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full"
            onClick={() => onOpenProject(selection)}
          >
            Open the whole branch →
          </Button>

          {/* Done with the whole thing: off the tree, never lost. The same
              archive Projects offers, one undo away like everything else. */}
          {project && (
            <button
              onClick={() => { setProjectArchived(project.id); clear(); }}
              className="mt-2 w-full text-center text-[11px] text-[var(--faint)]
                         transition-colors hover:text-[var(--ink)]"
            >
              Shelve this branch — off the tree, never lost
            </button>
          )}
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
  // What the planner has already routed for this branch, across the horizon.
  const routed = (state.blocks || []).reduce((n, b) => {
    const t = state.tasks.find((x) => x.id === b.taskId);
    return t?.projectId === project.id ? n + b.mins : n;
  }, 0);

  return (
    <p className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--muted)]">
      {started && <span>began {started}</span>}
      {focused > 0 && <span>{duration(focused)} lived in it</span>}
      {routed > 0 && <span>{hm(routed)} routed ahead</span>}
      {lands?.short && lands.state !== "clear" && (
        <span className={lands.state === "short" || lands.state === "late" ? "font-medium text-[var(--ink)]" : ""}>
          {lands.short}
        </span>
      )}
    </p>
  );
}

/** Minutes, said the way the app says them: 90 → "1.5h", 45 → "45m". */
const hm = (m) => (m >= 60 ? `${+(m / 60).toFixed(1)}h` : `${m}m`);
