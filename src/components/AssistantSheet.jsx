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
 * ## Free accounts see her and cannot use her
 *
 * There was a daily allowance here — five turns, a counter above the
 * conversation, a lock when they ran out. The argument for it was sound:
 * nobody upgrades for a feature they have only seen through glass. The trade
 * goes the other way now, deliberately. She is the single reason to pay for
 * this app, and a free tier that does the thing people would pay for is a free
 * tier they stay on.
 *
 * Free is still the whole planner — the auto-scheduler, the calendar, the
 * focus timer, a week laid out for nothing. What it does not include is being
 * able to *say* what changed and have it done.
 *
 * So the lock is the whole of it now, and she is drawn behind it rather than
 * hidden. Somebody on free opens this sheet, sees a real conversation panel
 * with a real assistant in it, and is told what it costs — a different feeling
 * from a menu item that is simply missing, and the only version of a paywall
 * that converts anybody.
 */
export default function AssistantSheet({ open, onClose, state, onUpgrade, request = null }) {
  const entitled = can(state.plan, "assistant");

  return (
    <Sheet open={open} onClose={onClose} label="Squirrel, your assistant" className="h-[88dvh]">
      <div className="flex min-h-0 flex-1 flex-col">
        {entitled ? (
          <Assistant state={state} onClose={onClose} request={request} />
        ) : (
          <Locked
            feature="assistant"
            title="Squirrel is on Pro"
            blurb="Say what changed and she does it — books it, moves it, files it, and re-plans the week around it. The planner itself stays free."
            onUpgrade={() => { onClose(); onUpgrade?.("Squirrel is on Pro"); }}
          >
            <Assistant state={state} onClose={onClose} />
          </Locked>
        )}
      </div>
    </Sheet>
  );
}
