/**
 * The grouped inset list.
 *
 * This is the single most recognisable shape in iOS, and the reason a settings
 * screen either reads as native or reads as a website in an app bundle. It is
 * a specific set of rules, not a vibe:
 *
 *   - Rows live inside a rounded card floating on a tinted ground, inset from
 *     the edges of the screen rather than running to them.
 *   - A small quiet header sits *above* the card and a small quiet footer sits
 *     *below* it. The explanation goes in the footer, never inside the group —
 *     which is the discipline that keeps these screens short, because a footer
 *     has to be a sentence rather than a paragraph.
 *   - Separators start where the label starts, not at the edge of the card, so
 *     the eye reads a single column of text rather than a stack of boxes.
 *   - Every row is at least 44 points tall, because that is the smallest
 *     target a thumb hits reliably.
 *
 * The web version of this app gets the same shape. It is a good layout on a
 * desktop too — quiet, dense, obviously grouped — and having one visual
 * language rather than two is most of what "professional" means when the same
 * product ships in three places.
 */

/**
 * One group: a header, a card of rows, and a footer.
 *
 * `footer` is where the explaining goes. Anything long enough not to fit there
 * is a sign the setting needs a better name rather than a longer note.
 */
export function Group({ header, footer, children, className = "" }) {
  return (
    <section className={className}>
      {header && (
        <h2 className="mb-1.5 px-4 text-[13px] font-medium text-[var(--muted)]">{header}</h2>
      )}
      <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper)]">
        {children}
      </div>
      {footer && (
        <p className="mt-1.5 px-4 text-[12px] leading-[1.45] text-[var(--muted)]">{footer}</p>
      )}
    </section>
  );
}

/**
 * A row.
 *
 * The separator is drawn by the row above rather than between them, which is
 * how the inset works: `last:border-0` removes it on the final row so the card
 * does not end on a line.
 */
export function Row({ children, className = "", onPress, ...rest }) {
  const shared =
    "flex min-h-[44px] w-full items-center gap-3 border-b border-[var(--hairline)] px-4 " +
    `py-2.5 text-left last:border-b-0 ${className}`;
  if (!onPress) return <div className={shared} {...rest}>{children}</div>;
  return (
    <button type="button" onClick={onPress} className={`${shared} transition-colors active:bg-[var(--hover)] sm:hover:bg-[var(--hover)]`} {...rest}>
      {children}
    </button>
  );
}

const Chevron = () => (
  <svg viewBox="0 0 24 24" aria-hidden
       className="h-4 w-4 shrink-0 fill-none stroke-[var(--faint)] stroke-[2.2]">
    <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * A row you tap to go somewhere: label on the left, current value and a
 * chevron on the right. The value is the whole reason this shape exists — it
 * lets a list of ten settings show all ten answers without opening any of them.
 */
export function NavRow({ label, value, onPress, danger = false }) {
  return (
    <Row onPress={onPress}>
      <span className={`min-w-0 flex-1 truncate text-[15px] ${danger ? "alert" : ""}`}>{label}</span>
      {value != null && (
        <span className="min-w-0 max-w-[55%] truncate text-[15px] text-[var(--muted)]">{value}</span>
      )}
      <Chevron />
    </Row>
  );
}

/** A row that is a switch. The whole row is the target, not just the switch. */
export function SwitchRow({ label, hint, on, onChange }) {
  return (
    <Row
      onPress={onChange}
      role="switch"
      aria-checked={on}
      className={hint ? "items-start py-3" : ""}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[15px]">{label}</span>
        {hint && <span className="mt-0.5 block text-[12px] leading-[1.45] text-[var(--muted)]">{hint}</span>}
      </span>
      <span
        aria-hidden
        className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-200 ${
          on ? "bg-[var(--ink)]" : "bg-[var(--line)]"
        } ${hint ? "mt-0.5" : ""}`}
      >
        <span
          className={`absolute top-[2px] h-[26px] w-[26px] rounded-full bg-[var(--paper)]
                      shadow-[0_1px_3px_rgba(0,0,0,0.2)] transition-all duration-200 ${
                        on ? "left-[22px]" : "left-[2px]"
                      }`}
        />
      </span>
    </Row>
  );
}

/** A row that is just a label and a value — nothing to tap. */
export function ValueRow({ label, value }) {
  return (
    <Row>
      <span className="min-w-0 flex-1 truncate text-[15px]">{label}</span>
      <span className="min-w-0 max-w-[60%] truncate text-right text-[15px] text-[var(--muted)]">{value}</span>
    </Row>
  );
}

/**
 * A row holding something that is not a row — a picker, a form, a panel.
 *
 * The escape hatch, and deliberately a plain one: the moment a group needs
 * arbitrary content it stops being a list, so this gives it the padding and
 * the separator and gets out of the way.
 */
export function PanelRow({ children, className = "" }) {
  return <div className={`border-b border-[var(--hairline)] px-4 py-4 last:border-b-0 ${className}`}>{children}</div>;
}
