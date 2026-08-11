import { isApple, primary, SHORTCUTS } from "../../lib/keys";

/**
 * The way into search, on a device with no ⌘K.
 *
 * Search was reachable by one route: the command palette, opened by a keyboard
 * shortcut. Which meant that on a phone — where the app is mostly used, and
 * where there is no keyboard until you tap into a field — there was no way to
 * search at all. `lib/search.js` covers finished tasks, past meetings, notes
 * and attendees, and none of it could be reached with a thumb.
 *
 * A phone gets a target; a desktop gets the same target with the shortcut
 * printed on it, which is how somebody learns the shortcut exists. Both open
 * the same palette, so there is one search rather than two.
 */
export default function Find({ onOpen, className = "" }) {
  const combo = primary(SHORTCUTS.find((s) => s.id === "search"), isApple());

  return (
    <button
      onClick={onOpen}
      aria-label="Search"
      title={`Search (${combo})`}
      className={`flex items-center gap-2 rounded-md border border-[var(--line)] px-2.5 py-2
                  text-[var(--muted)] transition-colors hover:border-[var(--ink)]
                  hover:text-[var(--ink)] sm:px-3 ${className}`}
    >
      <svg viewBox="0 0 24 24" aria-hidden className="h-[15px] w-[15px] shrink-0 fill-none stroke-current stroke-[2]">
        <circle cx="11" cy="11" r="7" />
        <path d="M16.5 16.5L21 21" strokeLinecap="round" />
      </svg>
      {/* The word on a phone, the shortcut on a desktop. Saying both is a
          crowded button, and each device only needs the half it can act on. */}
      <span className="text-xs sm:hidden">Search</span>
      <span className="num hidden text-[11px] sm:inline">{combo}</span>
    </button>
  );
}
