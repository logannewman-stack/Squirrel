import { useEffect, useState } from "react";
import { summary, count, clear, exportText, labelFor } from "../lib/misses";

/**
 * What she didn't understand, shown to the person who can do something about it.
 *
 * A log nobody reads is a log nobody writes rules from, so this is a screen
 * rather than a file. It answers one question — what should be taught next —
 * by putting the phrasings that came up most at the top, with the sentence
 * that eventually worked underneath where there is one.
 *
 * It never leaves the device on its own. Copy is a button somebody presses.
 */
export default function Misses() {
  const [rows, setRows] = useState([]);
  const [copied, setCopied] = useState(false);

  // Read once on open. This is a diagnostic, not a live feed — re-reading on
  // every keystroke elsewhere in the app would cost more than it tells anyone.
  useEffect(() => {
    setRows(summary());
  }, []);

  const total = rows.reduce((n, g) => n + g.count, 0);

  if (!total) {
    return (
      <p className="text-sm text-[var(--muted)]">
        Nothing logged. Anything she can't handle will show up here, grouped, so you can see
        what's worth teaching her next.
      </p>
    );
  }

  async function copy() {
    const text = exportText();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard is permission-gated and refuses outright in some browsers.
      // A prompt is ugly and always works, which beats a button that silently
      // does nothing.
      window.prompt("Copy the log:", text);
    }
  }

  return (
    <div>
      <p className="mb-4 text-sm text-[var(--muted)]">
        {total} {total === 1 ? "message" : "messages"} she couldn't act on, grouped into{" "}
        {rows.length} {rows.length === 1 ? "pattern" : "patterns"}. Times and dates are
        replaced with placeholders so the same request phrased twice counts as one.
      </p>

      <ul className="space-y-3">
        {rows.slice(0, 12).map((g) => (
          <li
            key={g.shape}
            className="rounded-md border border-[var(--line)] px-4 py-3"
          >
            <div className="flex items-baseline justify-between gap-3">
              <code className="min-w-0 break-words text-sm">{g.shape}</code>
              <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">
                {g.count}×
              </span>
            </div>

            <p className="mt-1 text-xs text-[var(--muted)]">{labelFor(g.reason)}</p>

            {g.examples.length > 1 && (
              <ul className="mt-2 space-y-0.5">
                {g.examples.map((e) => (
                  <li key={e} className="truncate text-xs text-[var(--muted)]">
                    “{e}”
                  </li>
                ))}
              </ul>
            )}

            {/* The valuable half: what the person said next that did work. */}
            {g.resolvedAs.length > 0 && (
              <p className="mt-2 text-xs">
                <span className="text-[var(--muted)]">
                  {g.resolvedAs[0].by === "model" ? "Fallback rewrote it as" : "Then worked as"}:
                </span>{" "}
                “{g.resolvedAs[0].text}”
                {g.resolvedAs[0].intent && (
                  <span className="text-[var(--muted)]"> ({g.resolvedAs[0].intent})</span>
                )}
              </p>
            )}
          </li>
        ))}
      </ul>

      {rows.length > 12 && (
        <p className="mt-3 text-xs text-[var(--muted)]">
          {rows.length - 12} more {rows.length - 12 === 1 ? "pattern" : "patterns"} below this —
          copy the log to see all of them.
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          onClick={copy}
          className="rounded-full border border-[var(--line)] px-5 py-2 text-sm
                     transition-colors hover:border-[var(--ink)]"
        >
          {copied ? "Copied" : "Copy the log"}
        </button>
        <button
          onClick={() => {
            clear();
            setRows([]);
          }}
          className="rounded-full border border-[var(--line)] px-5 py-2 text-sm
                     text-[var(--muted)] transition-colors hover:border-[var(--ink)]"
        >
          Clear
        </button>
      </div>

      <p className="mt-3 text-xs text-[var(--muted)]">
        Kept on this device only, {count() >= 200 ? "capped at the last 200" : "up to the last 200"}.
        Nothing is sent anywhere unless you copy it out.
      </p>
    </div>
  );
}
