/**
 * A labelled cluster of controls.
 *
 * The label is the whole point: a control with a word over it is a question
 * being asked; the same control bare is a mystery the user has to solve. The
 * project composer was fifteen bare controls in a row, which read as a cockpit
 * rather than a form.
 */
export default function Field({ label, hint, children, className = "" }) {
  return (
    <div className={className}>
      {label && <span className="label mb-1.5 block">{label}</span>}
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
      {hint && <p className="mt-1.5 text-xs text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

/**
 * The one text input.
 *
 * Underline on the composer, boxed in a dialog — the app had both and no rule
 * for which. This is the boxed one, the default; a bare underline is a
 * deliberate exception a screen opts into, not a coin flip.
 */
export function Input({ className = "", ...rest }) {
  return (
    <input
      className={
        "w-full rounded-lg border border-[var(--line)] bg-transparent px-3 py-2 text-sm " +
        "outline-none transition-colors placeholder:text-[var(--faint)] " +
        "focus:border-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--ink)]/15 " +
        className
      }
      {...rest}
    />
  );
}
