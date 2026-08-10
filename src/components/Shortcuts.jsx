import { useState } from "react";
import { SHORTCUTS } from "../lib/shortcuts";
import { askUrl } from "../lib/intent";
import { isIOS } from "../lib/native";

/**
 * Teaching the phrases, because iOS will not.
 *
 * The shortcuts are registered with the system at install and mentioned by it
 * nowhere. An app either says its own phrases out loud or ships a voice feature
 * nobody finds — and "nobody finds it" is indistinguishable from "it doesn't
 * work" from the outside.
 *
 * The examples are written as full sentences rather than patterns with slots in
 * them. `Ask Squirrel to <something>` is a specification; "Ask Squirrel to move
 * my three o'clock to Thursday" is a thing a person can read once and then say,
 * which is the entire job of this screen.
 */
export default function Shortcuts() {
  const [copied, setCopied] = useState(false);
  const native = isIOS();
  const link = askUrl("move my 3pm to Thursday", { from: "shortcut" });

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard access denied, or an insecure origin. The link is on screen
      // and selectable, which is the fallback that always works.
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {SHORTCUTS.map((s) => (
        <div key={s.id}>
          <p className="text-[15px] font-medium">{s.title}</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--muted)]">{s.what}</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {s.examples.map((ex) => (
              <li
                key={ex}
                className="rounded-lg bg-[var(--sunken)] px-3 py-2 text-[13px] leading-snug"
              >
                <span aria-hidden className="mr-1.5 text-[var(--faint)]">“</span>
                {ex}
                <span aria-hidden className="ml-0.5 text-[var(--faint)]">”</span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {/* On the web there is no App Intent to register, and saying nothing
          would read as the feature being missing rather than being elsewhere.
          The URL works in a Shortcut today, which is a real answer. */}
      {!native && (
        <div className="border-t border-[var(--hairline)] pt-4">
          <p className="text-[13px] leading-relaxed text-[var(--muted)]">
            These come with the iPhone and Mac apps — nothing to set up, they're
            registered when you install. In a browser you can get the same thing with a
            one-action Shortcut: <span className="text-[var(--ink)]">Open URL</span>, with this.
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-[var(--sunken)] px-3 py-2 text-[12px]">
              {link}
            </code>
            <button
              onClick={copy}
              className="shrink-0 rounded-lg border border-[var(--line)] px-3 py-2 text-[12px]
                         transition-colors hover:border-[var(--ink)] hover:bg-[var(--hover)]"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
