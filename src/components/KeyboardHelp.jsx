import Sheet from "./Sheet";
import { byGroup, primary, isApple } from "../lib/keys";

/**
 * Everything the app answers to, on one screen.
 *
 * The sheet reads the same list the dispatcher does, so it cannot describe a
 * set that has drifted — which is the usual fate of a shortcuts page, and the
 * reason most apps quietly stop having one.
 *
 * Both spellings are shown where a shortcut has two. "⌘K or /" is one more
 * word and saves the person who reaches for the one this app happens not to
 * have picked.
 */
export default function KeyboardHelp({ open, onClose }) {
  const apple = isApple();

  return (
    <Sheet open={open} onClose={onClose} label="Keyboard shortcuts">
      <div className="mx-auto w-full max-w-lg px-5 pb-8 pt-1">
        <h2 className="text-[22px] font-semibold tracking-tight">Keyboard</h2>
        <p className="mt-1 text-[13px] text-[var(--muted)]">
          None of these fire while you're typing.
        </p>

        <div className="mt-6 flex flex-col gap-6">
          {byGroup().map((group) => (
            <section key={group.name}>
              <h3 className="mb-1.5 px-1 text-[13px] font-medium text-[var(--muted)]">{group.name}</h3>
              <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper)]">
                {group.items.map((s) => (
                  <div
                    key={s.id}
                    className="flex min-h-[40px] items-center gap-3 border-b border-[var(--hairline)]
                               px-4 py-2 last:border-b-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-[15px]">{s.label}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {s.keys.map((k, n) => (
                        <span key={k} className="flex items-center gap-1.5">
                          {n > 0 && <span className="text-[11px] text-[var(--faint)]">or</span>}
                          <kbd className="num rounded-md border border-[var(--line)] bg-[var(--sunken)]
                                          px-2 py-0.5 text-[12px] font-medium text-[var(--muted)]">
                            {primary({ keys: [k] }, apple)}
                          </kbd>
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
