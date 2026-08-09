import { useEffect, useState } from "react";
import { summary, count, clear, exportText, labelFor } from "../lib/misses";
import { parse } from "../lib/nlu/parse";

/**
 * What she didn't understand, shown to the person who can do something about it.
 *
 * A log nobody reads is a log nobody writes rules from, so this is a screen
 * rather than a file. It answers one question — what should be taught next —
 * by putting the phrasings that came up most at the top, with the sentence
 * that eventually worked underneath where there is one.
 *
 * It never leaves the device on its own. Copy is a button somebody presses.
 *
 * ## Teaching her
 *
 * A diagnostic tells you what broke. This lets you do something about it: type
 * what you *meant* against any pattern she missed, and she says immediately
 * whether she would get it now. That turns the worst moments in the app — the
 * ones where she did not understand — into the only place a person can improve
 * her, and it turns a wall of failures into a list of things to try.
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

            <Teach shape={g.shape} />

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


/**
 * "Say it another way."
 *
 * Runs the rephrasing through the same parser the assistant uses and reports
 * what it would do with it — not a guess, the real classification. Somebody who
 * finds a phrasing that works has learned something about how to talk to her,
 * which is worth more than the log entry that sent them here.
 *
 * Nothing is written. This is a rehearsal: it says whether she would understand,
 * and the person can then go and say it to her for real.
 */
function Teach({ shape }) {
  const [text, setText] = useState("");
  const [verdict, setVerdict] = useState(null);

  function tryIt(e) {
    e.preventDefault();
    const said = text.trim();
    if (!said) return;
    const p = parse(said, new Date());
    setVerdict(
      p.intent && p.intent !== "unknown"
        ? { ok: true, intent: p.intent.replace(/_/g, " ") }
        : { ok: false },
    );
  }

  return (
    <form onSubmit={tryIt} className="mt-3 border-t border-[var(--hairline)] pt-3">
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => { setText(e.target.value); setVerdict(null); }}
          placeholder="Say it another way…"
          aria-label={`Try another phrasing for ${shape}`}
          className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-transparent px-3 py-1.5
                     text-xs outline-none placeholder:text-[var(--faint)] focus:border-[var(--ink)]"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="shrink-0 rounded-md border border-[var(--line)] px-3 py-1.5 text-xs
                     transition-colors hover:border-[var(--ink)] disabled:opacity-30"
        >
          Try it
        </button>
      </div>
      {verdict && (
        <p className="mt-2 text-xs">
          {verdict.ok ? (
            <>
              <span className="font-medium">She'd get that</span>
              <span className="text-[var(--muted)]"> — reads it as “{verdict.intent}”. Say it to her that way.</span>
            </>
          ) : (
            <span className="text-[var(--muted)]">
              Still not one she knows. Try naming the thing and the time outright — “move the board call to Thursday at 2”.
            </span>
          )}
        </p>
      )}
    </form>
  );
}
