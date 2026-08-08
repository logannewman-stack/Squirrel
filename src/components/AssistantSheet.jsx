import Sheet from "./Sheet";
import Assistant from "./Assistant";
import Locked from "./Locked";
import { can, FREE_ASSISTS_PER_DAY } from "../lib/plans";
import { assistsToday } from "../lib/store";

/**
 * The assistant, as a sheet rather than a screen.
 *
 * Fixed at a tall height rather than sized to its content, because a chat that
 * grows the sheet as it fills would shift the input under the thumb every time
 * she answers. A stable tall panel with a scrolling middle is what a
 * conversation wants.
 *
 * ## The free tier gets a few turns, not a locked door
 *
 * She is the reason to pay for this app, which is exactly why a free account
 * must be able to *use* her rather than read about her: nobody upgrades for a
 * feature they have only seen through glass. So free accounts get a handful of
 * turns a day, with the count in plain view, and the lock appears when they run
 * out — at which point it is asking somebody to pay for something they have
 * just felt working, which is the only version of this that converts.
 */
export default function AssistantSheet({ open, onClose, state, onUpgrade }) {
  const entitled = can(state.plan, "assistant");
  const used = assistsToday();
  const left = Math.max(0, FREE_ASSISTS_PER_DAY - used);
  const spent = !entitled && left === 0;

  return (
    <Sheet open={open} onClose={onClose} label="Squirrel, your assistant" className="h-[88dvh]">
      <div className="flex min-h-0 flex-1 flex-col">
        {spent ? (
          <Locked
            feature="assistant"
            title="You've used today's free turns"
            blurb={`Free accounts get ${FREE_ASSISTS_PER_DAY} a day. On Pro she's unlimited — tell her what changed and she does it.`}
            onUpgrade={() => { onClose(); onUpgrade?.("You've used today's free turns"); }}
          >
            <Assistant state={state} onClose={onClose} />
          </Locked>
        ) : (
          <>
            {!entitled && (
              // Said once, quietly, above the conversation. A counter that
              // shouts is a counter people resent; this one is just honest
              // about where the edge is.
              <div className="flex items-center justify-between gap-3 border-b border-[var(--hairline)]
                              bg-[var(--sunken)] px-4 py-2 text-xs">
                <span className="text-[var(--muted)]">
                  <span className="num font-semibold text-[var(--ink)]">{left}</span>
                  {` of ${FREE_ASSISTS_PER_DAY} free turns left today`}
                </span>
                <button
                  onClick={() => {
                    onClose();
                    onUpgrade?.(
                      left === 1 ? "One turn left today" : `${left} turns left today`,
                    );
                  }}
                  className="shrink-0 font-semibold text-[var(--ink)] underline underline-offset-2"
                >
                  Go unlimited
                </button>
              </div>
            )}
            <Assistant state={state} onClose={onClose} metered={!entitled} />
          </>
        )}
      </div>
    </Sheet>
  );
}
