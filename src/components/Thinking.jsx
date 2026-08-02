/**
 * The pause between asking and answering.
 *
 * The lookup itself is instant — this is a deliberate beat so the answer reads
 * as considered rather than as a form submitting. Two variants: a calendar
 * being scanned for lookups, a pen stroke for changes, so the animation
 * matches what is actually happening.
 *
 * Respects prefers-reduced-motion: the shapes hold still and only the status
 * line advances.
 */

const CELLS = Array.from({ length: 12 }, (_, i) => i);

function CalendarScan() {
  return (
    <svg viewBox="0 0 64 52" className="h-[42px] w-[52px]" aria-hidden="true">
      <rect x="1" y="7" width="62" height="44" rx="4"
        className="fill-none stroke-[var(--line)]" strokeWidth="2" />
      <path d="M1 18h62" className="stroke-[var(--line)]" strokeWidth="2" />
      <path d="M16 1v10M48 1v10" className="stroke-[var(--muted)]" strokeWidth="3" strokeLinecap="round" />
      {CELLS.map((i) => (
        <rect
          key={i}
          x={7 + (i % 4) * 14}
          y={24 + Math.floor(i / 4) * 9}
          width="9"
          height="5"
          rx="1.5"
          className="fill-[var(--ink)] sq-cell"
          style={{ animationDelay: `${(i % 4) * 90 + Math.floor(i / 4) * 240}ms` }}
        />
      ))}
    </svg>
  );
}

function PenStroke() {
  return (
    <svg viewBox="0 0 64 52" className="h-[42px] w-[52px]" aria-hidden="true">
      <path
        d="M6 38C14 22 22 14 30 20s10 20 18 14 8-16 10-20"
        className="fill-none stroke-[var(--ink)] sq-draw"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="58" cy="14" r="3" className="fill-[var(--ink)] sq-nib" />
    </svg>
  );
}

export default function Thinking({ line, variant = "calendar" }) {
  return (
    <div className="flex items-center gap-4 py-1">
      {variant === "pen" ? <PenStroke /> : <CalendarScan />}
      <p className="text-sm text-[var(--muted)]">{line}</p>
    </div>
  );
}
