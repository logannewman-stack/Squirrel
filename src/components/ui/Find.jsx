import { isApple, primary, SHORTCUTS } from "../../lib/keys";

/**
 * The search bar. It looks like an input and acts like a door.
 *
 * Search used to hide behind a small magnifier chip, which meant it existed
 * for people who already knew — a shortcut printed on a button is a hint, not
 * an affordance. This is the pattern every serious tool has converged on: a
 * bar shaped like the thing you want to do, sitting in the header of every
 * main screen, that opens the real search (the palette) the moment it is
 * touched. One search, many doors.
 *
 * It is a <button>, not an <input>: focus must land in the palette's field —
 * where arrows, Enter and the results live — and a real input here would
 * fight the palette for the keyboard and the phone's autofocus zoom.
 *
 * On a phone it takes the full row under the title, the way iOS puts a
 * search field under a large title. On a desktop it is a fixed bar with the
 * shortcut printed where a keyboard exists to press it.
 */
export default function Find({ onOpen, className = "" }) {
  const combo = primary(SHORTCUTS.find((s) => s.id === "search"), isApple());

  return (
    <button
      onClick={onOpen}
      aria-label="Search"
      title={`Search (${combo})`}
      className={`group flex w-full items-center gap-2 rounded-lg border border-[var(--line)]
                  px-3 py-2 text-left transition-colors hover:border-[var(--ink)] sm:w-64
                  ${className}`}
    >
      <svg viewBox="0 0 24 24" aria-hidden className="h-[15px] w-[15px] shrink-0 fill-none stroke-current stroke-[2] text-[var(--muted)]">
        <circle cx="11" cy="11" r="7" />
        <path d="M16.5 16.5L21 21" strokeLinecap="round" />
      </svg>
      <span className="flex-1 truncate text-xs text-[var(--faint)] transition-colors group-hover:text-[var(--muted)]">
        Search anything…
      </span>
      {/* The shortcut rides inside the bar, desktop only — a phone has no ⌘
          to press, and the empty cap would just be furniture. */}
      <kbd className="num hidden shrink-0 rounded border border-[var(--hairline)] px-1.5 py-0.5
                      text-[10px] text-[var(--faint)] sm:inline">
        {combo}
      </kbd>
    </button>
  );
}
