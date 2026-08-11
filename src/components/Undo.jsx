import { useEffect, useRef, useState } from "react";
import { undo, lastChange, lastChangeLoud, undoDepth } from "../lib/store";
import { primary, SHORTCUTS } from "../lib/keys";
import { tap } from "../lib/native";

/**
 * The way back, where you can see it.
 *
 * The store has kept a labelled forty-step undo since it was written, and until
 * now the only route to it was opening the assistant and saying the word
 * "undo" — which the event dialog literally instructed people to do. For an app
 * whose entire safety argument is *she can change your week because you can
 * always take it back*, the taking back was the least reachable thing in it.
 *
 * A bar rather than a dialog, and it appears **after** the change rather than
 * asking before it. That is the whole design: a confirmation moves the risk to
 * the moment somebody is least able to judge it, and gets clicked through
 * within a week. Doing the thing and offering the way back costs one tap when
 * you were right and one tap when you were wrong.
 *
 * ## Why it watches the depth rather than the label
 *
 * The history is module state, not part of the store snapshot — it churns on
 * every write and belongs in no sync payload — so nothing can subscribe to it.
 * What can be observed is that the app re-rendered, and every push is
 * accompanied by a commit. Comparing the depth tells a new change from the
 * previous label resurfacing after an undo, which comparing labels cannot:
 * delete two tasks named the same thing and the label never changes.
 */

/** Long enough to notice and reach; short enough not to become furniture. */
const LINGER = 7000;

export default function Undo() {
  // The label of the change being offered, or null when there is nothing to
  // say. Held in state rather than read at render, because the offer outlives
  // the render that noticed it.
  const [showing, setShowing] = useState(null);
  const [undone, setUndone] = useState(null);
  const depth = useRef(undoDepth());
  const timer = useRef(null);

  // Runs on every render of the app, which is exactly when a change may have
  // landed. Cheap: two integers and a string.
  useEffect(() => {
    const now = undoDepth();
    if (now > depth.current) {
      /**
       * Only the loud ones. Every write is undoable and ⌘Z reaches all of
       * them; this bar is for the three shapes of change you can make without
       * immediately seeing the whole of — destructive, plural, and anything
       * that moves the calendar. Announcing a project rename you are looking
       * straight at is how people learn to ignore the bar, which is how they
       * come to ignore the one that mattered.
       */
      if (lastChangeLoud()) {
        setShowing(lastChange());
        setUndone(null);
      }
    } else if (now < depth.current) {
      // An undo happened — possibly from here, possibly from the assistant.
      // Either way the offer is stale.
      setShowing(null);
    }
    depth.current = now;
  });

  useEffect(() => {
    if (!showing && !undone) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { setShowing(null); setUndone(null); }, LINGER);
    return () => clearTimeout(timer.current);
  }, [showing, undone]);

  if (!showing && !undone) return null;

  const combo = primary(SHORTCUTS.find((s) => s.id === "undo"));

  return (
    <div
      // Above the bottom bar on a phone and clear of the safe area, so it never
      // covers the thing somebody would reach for next.
      className="sq-undo pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4
                 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] sm:pb-6"
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-auto flex max-w-[min(30rem,100%)] items-center gap-3 rounded-xl
                      border border-[var(--line)] bg-[var(--paper)] py-2.5 pl-4 pr-2.5 shadow-[var(--float)]">
        <span className="min-w-0 flex-1 truncate text-[14px]">
          {undone ? `Put back — ${undone}` : capitalise(showing)}
        </span>
        {!undone && (
          <button
            onClick={() => {
              const what = undo();
              if (!what) return setShowing(null);
              tap("success");
              // Swapped rather than dismissed, so the bar confirms what it did
              // instead of vanishing and leaving you to check.
              setUndone(what);
              setShowing(null);
            }}
            className="shrink-0 rounded-lg px-3 py-1.5 text-[14px] font-medium transition-colors
                       hover:bg-[var(--hover)]"
          >
            Undo
            <span className="ml-1.5 hidden text-[11px] text-[var(--faint)] sm:inline">{combo}</span>
          </button>
        )}
        <button
          onClick={() => { setShowing(null); setUndone(null); }}
          aria-label="Dismiss"
          className="shrink-0 rounded-lg px-2 py-1.5 text-[var(--faint)] transition-colors hover:text-[var(--ink)]"
        >
          <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4 fill-none stroke-current stroke-[2.2]">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * The labels are written from the user's side of the change — "cancelling 3
 * meetings" — because they were built to complete the sentence "say undo to
 * take back…". Standing alone at the start of a bar, they want a capital.
 */
const capitalise = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
