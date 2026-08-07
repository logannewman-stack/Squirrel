import Squirrel from "./Squirrel";

/**
 * The one way in to the assistant.
 *
 * She used to be a tab, which put her behind a navigation and made "just ask
 * her" cost the same as "go to a different screen". A floating button over
 * every screen makes asking the cheapest thing in the app — which is the whole
 * point of having an assistant rather than a search box.
 *
 * The button carries her, filled onto her own disc so she has weight. When
 * something is overdue or will not fit, a single reserved ring pulses around
 * her — the same discipline as the alert colour: it means one specific thing,
 * so it never has to compete with decoration.
 */
export default function AssistantFab({ onClick, hidden, attention = false, thinking = false }) {
  if (hidden) return null;

  return (
    <div
      className="fixed right-4 z-40 sm:right-6"
      // Clears the bottom nav and the phone's home indicator, so she never
      // sits on top of a tab or under the gesture bar.
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 4.75rem)" }}
    >
      <div className="relative">
        {attention && (
          <span
            aria-hidden
            className="sq-fab-ring absolute inset-0 rounded-full border-2 border-[var(--alert)]"
          />
        )}

        <button
          onClick={onClick}
          aria-label="Ask Squirrel"
          title="Ask Squirrel"
          className="sq-fab sq-fab-in relative grid h-14 w-14 place-items-center rounded-full
                     bg-[var(--ink)] shadow-[var(--float)] ring-1 ring-black/5
                     hover:shadow-[0_16px_40px_-8px_rgba(9,9,11,0.28)]"
        >
          <Squirrel size={30} pose={thinking ? "thinking" : "idle"} className="sq-fab" title="Squirrel" />

          {/* The quiet state of the same signal: a solid dot when there is
              something to see but not while she is mid-thought, which would
              read as two things happening at once. */}
          {attention && !thinking && (
            <span
              aria-hidden
              className="absolute right-0 top-0 h-3.5 w-3.5 rounded-full border-2 border-[var(--paper)] bg-[var(--alert)]"
            />
          )}
        </button>
      </div>
    </div>
  );
}
