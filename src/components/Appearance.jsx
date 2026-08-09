import { useEffect, useState } from "react";
import { THEMES, readTheme, setTheme, resolveTheme, onThemeChange } from "../lib/theme";

/**
 * Light, dark, or the machine's own mind.
 *
 * "System" is first and is the default, because it is right for most people
 * most of the time and it is the only one that keeps following a Mac when it
 * changes itself at dusk. The other two exist for everybody it is *not* right
 * for — a dark desktop and one bright app, or the reverse — and choosing one
 * is not a door that closes: System is still sitting there to go back to.
 */
const LABELS = {
  system: { name: "System", note: "Follows your Mac or phone, including at sunset." },
  light: { name: "Light", note: "Always bright, whatever the machine is doing." },
  dark: { name: "Dark", note: "Always dark, whatever the machine is doing." },
};

const ICONS = {
  system: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" strokeLinecap="round" />
    </>
  ),
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" strokeLinecap="round" />
    </>
  ),
  dark: <path d="M20 13.5A8 8 0 1110.5 4a6.5 6.5 0 009.5 9.5z" strokeLinejoin="round" />,
};

export default function Appearance() {
  const [choice, setChoice] = useState(readTheme);
  useEffect(() => onThemeChange(setChoice), []);

  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-3">
        {THEMES.map((id) => {
          const on = choice === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              onClick={() => setChoice(setTheme(id))}
              className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                on ? "border-[var(--ink)] bg-[var(--hover)]" : "border-[var(--line)] hover:border-[var(--ink)]"
              }`}
            >
              <svg viewBox="0 0 24 24" aria-hidden
                   className="mt-0.5 h-[18px] w-[18px] shrink-0 fill-none stroke-current stroke-[1.6]">
                {ICONS[id]}
              </svg>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{LABELS[id].name}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-[var(--muted)]">
                  {LABELS[id].note}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {choice === "system" && (
        <p className="mt-3 text-xs text-[var(--muted)]">
          Currently {resolveTheme("system")}, because that's what this device is set to.
        </p>
      )}
    </div>
  );
}
