import Sheet from "./Sheet";
import Assistant from "./Assistant";
import Locked from "./Locked";
import { can } from "../lib/plans";

/**
 * The assistant, as a sheet rather than a screen.
 *
 * Fixed at a tall height rather than sized to its content, because a chat that
 * grows the sheet as it fills would shift the input under the thumb every time
 * she answers. A stable tall panel with a scrolling middle is what a
 * conversation wants.
 *
 * On a free account the sheet still opens, and she is still in it — greeting,
 * suggestions, the input, all drawn — behind a lock. She is the whole reason to
 * pay for this app, so the one thing the paywall must not do is hide her: a
 * free user should be able to see exactly what they are buying, which is why
 * the gate is here rather than on the button that opens the sheet.
 */
export default function AssistantSheet({ open, onClose, state, onUpgrade }) {
  const allowed = can(state.plan, "assistant");

  return (
    <Sheet open={open} onClose={onClose} label="Squirrel, your assistant" className="h-[88dvh]">
      <div className="flex min-h-0 flex-1 flex-col">
        {allowed ? (
          <Assistant state={state} onClose={onClose} />
        ) : (
          <Locked
            feature="assistant"
            title="Let Squirrel run your week"
            blurb="Tell her what changed in your own words — “move the board call to Thursday”, “clear my Friday afternoon” — and she does it."
            onUpgrade={() => { onClose(); onUpgrade?.(); }}
          >
            <Assistant state={state} onClose={onClose} />
          </Locked>
        )}
      </div>
    </Sheet>
  );
}
