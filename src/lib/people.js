/**
 * Who you work with, worked out rather than asked for.
 *
 * Delegation was a blank text box. Typing a name into it every time is bad in
 * three separate ways: it is slow, it silently creates "Abra", "abra", and
 * "Abra " as three different people, and it tells you nothing about whether
 * that person already has six things waiting on them.
 *
 * There is no roster to set up here and there deliberately isn't one to
 * maintain. Everyone who has ever been in a meeting or been handed a task is
 * already in the data; this reads them back out, folds the near-duplicates
 * together, and counts what each is carrying. A team that assembles itself
 * from use is one nobody has to remember to update.
 */

/** Names that are not people — the same guard the parser uses on "with X". */
const NOT_A_PERSON = new Set([
  "me", "myself", "team", "everyone", "everybody", "all", "us", "them",
  "the team", "no one", "nobody", "tbd", "n/a", "none",
]);

/** Fold case, spacing, and punctuation so one person is one person. */
export const keyOf = (name) =>
  String(name ?? "").trim().toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ");

/** How the name is shown: their own capitalisation if they used any. */
const display = (name) => {
  const n = String(name ?? "").trim().replace(/\s+/g, " ");
  if (!n) return "";
  return /[A-Z]/.test(n) ? n : n.replace(/(^|\s)\w/g, (c) => c.toUpperCase());
};

/**
 * The roster, with what each person is carrying.
 *
 * Sorted by how recently they came up rather than alphabetically. The person
 * you delegated to an hour ago is overwhelmingly the person you are about to
 * delegate to again, and making them first is worth more than the tidiness of
 * A-to-Z.
 */
export function roster(state = {}) {
  const found = new Map();

  const note = (rawName, at, kind) => {
    const key = keyOf(rawName);
    if (!key || NOT_A_PERSON.has(key)) return;
    const person = found.get(key) ?? {
      key, name: display(rawName), waiting: 0, meetings: 0, lastAt: 0,
    };
    person[kind] += 1;
    person.lastAt = Math.max(person.lastAt, at || 0);
    // Keep the version that looks most deliberate — "Priya Raman" over "priya".
    if (display(rawName).length > person.name.length) person.name = display(rawName);
    found.set(key, person);
  };

  for (const task of state.tasks || []) {
    if (task.delegatedTo && !task.done) {
      note(task.delegatedTo, task.updatedAt || task.createdAt, "waiting");
    }
  }
  for (const event of state.events || []) {
    const at = new Date(event.start).getTime();
    for (const a of event.attendees || []) note(a?.name, at, "meetings");
  }

  return [...found.values()].sort((a, b) => b.lastAt - a.lastAt || a.name.localeCompare(b.name));
}

/**
 * Filter the roster by what has been typed so far.
 *
 * Matches on any word, not just the start, because "raman" should find "Priya
 * Raman" — people reach for whichever half of a name they remember.
 */
export function search(list, query) {
  const q = keyOf(query);
  if (!q) return list;
  return list.filter((p) => {
    const k = p.key;
    return k.startsWith(q) || k.split(" ").some((w) => w.startsWith(q)) || k.includes(q);
  });
}

/**
 * Is this typed name someone new?
 *
 * Used to decide whether to offer "Add <name>" — offering it for somebody
 * already on the list is how a roster ends up with two of everyone.
 */
export const isNew = (list, query) => {
  const q = keyOf(query);
  return Boolean(q) && !list.some((p) => p.key === q);
};

/** "3 waiting · 2 meetings", or nothing when there is nothing to say. */
export function summarise(person) {
  const bits = [];
  if (person.waiting) bits.push(`${person.waiting} waiting`);
  if (person.meetings) bits.push(`${person.meetings} ${person.meetings === 1 ? "meeting" : "meetings"}`);
  return bits.join(" · ");
}

/** The tasks currently sitting with one person. */
export const workOf = (state, name) => {
  const k = keyOf(name);
  return (state.tasks || []).filter((t) => !t.done && keyOf(t.delegatedTo) === k);
};
