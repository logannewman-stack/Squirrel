/**
 * A small selectable pill.
 *
 * Durations, priorities, quick day choices — anywhere a person picks one of a
 * short set. It is a pill rather than a rounded rectangle because a row of
 * pills reads as choices and a row of rectangles reads as a toolbar, and the
 * composer was drowning in the second kind.
 *
 * `on` drives the selected state so a parent never restyles it by hand, which
 * is how two chips for the same job drift apart.
 */
export default function Chip({ on = false, className = "", type = "button", ...rest }) {
  return (
    <button
      type={type}
      aria-pressed={on}
      className={
        "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors " +
        "outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)] " +
        "focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)] " +
        (on
          ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
          : "border-[var(--line)] text-[var(--muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]") +
        ` ${className}`
      }
      {...rest}
    />
  );
}
