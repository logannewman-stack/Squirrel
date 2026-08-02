import { useState } from "react";
import { setSetting } from "../lib/store";
import { HONORIFICS, addressOf, greeting } from "../lib/nlu/voice";

/**
 * How the assistant should address you.
 *
 * Asked once on first run and editable in Settings. The "just my name" and
 * "no name" options exist because an honorific is a preference, not a default
 * to be guessed from anything.
 */
export default function Identity({ value = {}, onDone, compact = false }) {
  const [style, setStyle] = useState(value.style || "formal");
  // Deliberately blank. Pre-selecting one would put a guess about the person on
  // screen before they have said anything, which is the whole thing this
  // question exists to avoid.
  const [honorific, setHonorific] = useState(value.honorific || "");
  const [firstName, setFirstName] = useState(value.firstName || "");
  const [lastName, setLastName] = useState(value.lastName || "");

  const draft = { style, honorific, firstName, lastName };
  const ready =
    style === "none" ||
    (style === "first" ? !!firstName.trim() : !!lastName.trim() && !!honorific);
  // Never preview a form of address they haven't finished choosing.
  const preview = ready ? addressOf(draft) : "";

  function save() {
    setSetting("identity", draft);
    onDone?.();
  }

  const Chip = ({ on, children, ...rest }) => (
    <button
      type="button"
      aria-pressed={on}
      className={`rounded border px-3 py-1.5 text-xs transition-colors ${
        on ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]" : "border-[var(--line)] hover:border-[var(--ink)]"
      }`}
      {...rest}
    >
      {children}
    </button>
  );

  return (
    <div className={compact ? "" : "mx-auto w-full max-w-md"}>
      {!compact && (
        <>
          <p className="label">Before we start</p>
          <h1 className="mb-1 mt-1 text-2xl font-semibold tracking-tight">
            How should I address you?
          </h1>
          <p className="mb-6 text-sm text-[var(--muted)]">
            The assistant uses this when it greets you. You can change it any time.
          </p>
        </>
      )}

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Chip on={style === "formal"} onClick={() => setStyle("formal")}>Title and surname</Chip>
        <Chip on={style === "first"} onClick={() => setStyle("first")}>First name</Chip>
        <Chip on={style === "none"} onClick={() => setStyle("none")}>No name</Chip>
      </div>

      {style === "formal" && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {HONORIFICS.map((h) => (
            <Chip key={h} on={honorific === h} onClick={() => setHonorific(h)}>{h}</Chip>
          ))}
        </div>
      )}

      {style !== "none" && (
        <div className="mb-4 flex gap-2">
          {style === "first" ? (
            <input
              autoFocus
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
              className="flex-1 rounded-md border border-[var(--line)] bg-transparent px-3.5 py-2
                         text-sm outline-none placeholder:text-[var(--faint)] focus:border-[var(--ink)]"
            />
          ) : (
            <input
              autoFocus
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Surname"
              className="flex-1 rounded-md border border-[var(--line)] bg-transparent px-3.5 py-2
                         text-sm outline-none placeholder:text-[var(--faint)] focus:border-[var(--ink)]"
            />
          )}
        </div>
      )}

      <p className="mb-5 rounded-md border border-[var(--line)] px-4 py-3 text-sm text-[var(--muted)]">
        {greeting()}
        {preview ? `, ${preview}` : ""} — checking your calendar now.
      </p>

      <button
        onClick={save}
        disabled={!ready}
        className="w-full rounded-md bg-[var(--ink)] py-3 text-sm font-medium text-[var(--paper)]
                   transition-opacity disabled:opacity-30"
      >
        {compact ? "Save" : "Continue"}
      </button>
    </div>
  );
}
