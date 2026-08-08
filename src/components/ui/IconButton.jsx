/**
 * A square, quiet button that holds an icon.
 *
 * Close buttons, toolbar toggles, the mic. Always a real hit target — 36px, so
 * a thumb finds it — even though the glyph inside is small. Every one of these
 * was a different size and hover treatment before.
 */
export default function IconButton({ label, on = false, className = "", type = "button", children, ...rest }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={rest["aria-pressed"] ?? undefined}
      className={
        "grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors outline-none " +
        "focus-visible:ring-2 focus-visible:ring-[var(--ink)] focus-visible:ring-offset-2 " +
        "focus-visible:ring-offset-[var(--paper)] " +
        (on
          ? "text-[var(--ink)] bg-[var(--hover)]"
          : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]") +
        ` ${className}`
      }
      {...rest}
    >
      {children}
    </button>
  );
}
