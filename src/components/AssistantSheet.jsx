import Sheet from "./Sheet";
import Assistant from "./Assistant";

/**
 * The assistant, as a sheet rather than a screen.
 *
 * Fixed at a tall height rather than sized to its content, because a chat that
 * grows the sheet as it fills would shift the input under the thumb every time
 * she answers. A stable tall panel with a scrolling middle is what a
 * conversation wants.
 */
export default function AssistantSheet({ open, onClose, state }) {
  return (
    <Sheet open={open} onClose={onClose} label="Squirrel, your assistant" className="h-[88dvh]">
      <div className="flex min-h-0 flex-1 flex-col">
        <Assistant state={state} onClose={onClose} />
      </div>
    </Sheet>
  );
}
