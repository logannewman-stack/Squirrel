import { useEffect, useMemo, useRef, useState } from "react";
import { roster, search, isNew, summarise } from "../lib/people";

/**
 * Choosing who something goes to.
 *
 * A combobox rather than a select, because the list is not fixed — the first
 * time you hand something to someone new, typing their name has to work. And
 * not a plain text input, because after that first time it never should be
 * necessary again.
 *
 * Each name carries what that person is already holding. Deciding who to hand
 * something to is a question about load, and answering it inside the picker
 * saves the trip to another screen that nobody makes.
 */
export default function PersonPicker({
  value = "",
  onChange,
  state,
  placeholder = "Delegate to…",
  className = "",
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef(null);

  useEffect(() => setQuery(value), [value]);

  const all = useMemo(() => roster(state), [state.tasks, state.events]);
  const matches = useMemo(() => search(all, query).slice(0, 6), [all, query]);
  const offerNew = isNew(all, query);
  const rows = offerNew ? [...matches, { key: "__new", name: query.trim(), isNew: true }] : matches;

  // Clicking away commits what was typed. Losing a half-typed name because the
  // list stole the click is the single most annoying thing a combobox can do.
  useEffect(() => {
    const away = (e) => {
      if (box.current && !box.current.contains(e.target)) {
        setOpen(false);
        if (query !== value) onChange(query.trim());
      }
    };
    addEventListener("mousedown", away);
    return () => removeEventListener("mousedown", away);
  }, [query, value, onChange]);

  const choose = (name) => {
    const picked = String(name ?? "").trim();
    setQuery(picked);
    onChange(picked);
    setOpen(false);
  };

  function onKeyDown(e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => {
        const n = rows.length || 1;
        return (i + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
      });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      choose(rows[active]?.name ?? query);
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      setQuery(value);
    }
  }

  return (
    <div ref={box} className={`relative ${className}`}>
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label="Delegate to"
        aria-expanded={open}
        aria-autocomplete="list"
        role="combobox"
        className="w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm
                   outline-none transition-colors placeholder:text-[var(--faint)]
                   focus:border-[var(--ink)]"
      />

      {open && rows.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-md
                     border border-[var(--line)] bg-[var(--paper)] py-1 shadow-lg"
        >
          {rows.map((p, i) => (
            <li key={p.key}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                // mousedown, not click: the input's blur would close the list
                // before a click ever landed.
                onMouseDown={(e) => { e.preventDefault(); choose(p.name); }}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm
                            transition-colors ${i === active ? "bg-[var(--hover)]" : ""}`}
              >
                <span className="truncate">
                  {p.isNew ? <>Add <span className="font-medium">{p.name}</span></> : p.name}
                </span>
                {!p.isNew && summarise(p) && (
                  <span className="shrink-0 text-xs text-[var(--muted)]">{summarise(p)}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
