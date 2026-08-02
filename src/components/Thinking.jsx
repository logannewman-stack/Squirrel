import Squirrel from "./Squirrel";

/**
 * The pause between asking and answering.
 *
 * The lookup itself is instant — this is a deliberate beat so the answer reads
 * as considered rather than as a form submitting. It is her doing it, in two
 * moods: thinking when she is looking something up, writing when she is
 * changing it, so the motion matches what is actually happening.
 *
 * Reduced motion is handled in the stylesheet: she holds still and the status
 * line carries the meaning on its own.
 */
export default function Thinking({ line, variant = "calendar" }) {
  return (
    <div className="flex items-center gap-4 py-1">
      <Squirrel size={44} pose={variant === "pen" ? "writing" : "thinking"} />
      <p className="text-sm text-[var(--muted)]">{line}</p>
    </div>
  );
}
