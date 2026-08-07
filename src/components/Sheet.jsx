import { useEffect, useRef } from "react";

/**
 * A panel that rises from the bottom edge.
 *
 * The one modal shape used for anything that is a *place* rather than a
 * question — the assistant, a detail view, a picker with room to breathe. It
 * comes up from the thumb rather than the middle of the screen because that is
 * where the hand already is, and it leaves the top of the screen showing so the
 * sheet reads as sitting on top of the app rather than replacing it.
 *
 * Deliberately not the same component as the centred dialog. A confirmation is
 * a question and belongs in the middle of vision; a workspace is a surface and
 * belongs under the thumb. One component pretending to be both ends up wrong
 * for each.
 */
export default function Sheet({ open, onClose, label, children, className = "" }) {
  const panel = useRef(null);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (!open) return;

    // Remember where focus was, so closing the sheet returns it rather than
    // dumping the user at the top of the page.
    previouslyFocused.current = document.activeElement;

    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", onKey);

    // The body must not scroll behind an open sheet — on a phone that shows as
    // the page creeping while you drag inside the sheet.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Move focus into the sheet so the keyboard and screen reader follow it in.
    const focusable = panel.current?.querySelector(
      'input, textarea, button, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus?.({ preventScroll: true });

    return () => {
      removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={label}>
      {/* The scrim. Fades in; a hard cut reads as a bug rather than a layer. */}
      <button
        aria-label="Close"
        onClick={onClose}
        className="sq-scrim absolute inset-0 bg-black/40 backdrop-blur-[1px]"
      />

      <div
        ref={panel}
        className={`sq-sheet absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col overflow-hidden
                    rounded-t-2xl border-t border-[var(--line)] bg-[var(--paper)]
                    shadow-[var(--float)] ${className}`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* The grab handle. It is not draggable yet — it is the affordance that
            says "this came from the bottom and goes back there", which is worth
            having before the gesture is. */}
        <div className="flex shrink-0 justify-center pt-2.5">
          <span className="h-1 w-9 rounded-full bg-[var(--line)]" />
        </div>

        {children}
      </div>
    </div>
  );
}
