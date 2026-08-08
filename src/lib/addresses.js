/**
 * Turning what someone typed into the "With" field into people who can be
 * emailed.
 *
 * The field takes prose, because that is what people type: "Bob and Priya",
 * "bob@acme.com", "Priya Raman <priya@acme.com>". All three mean a list of
 * humans, and two of them mean humans an invitation can actually reach.
 *
 * Separate from people.js, which is about the roster the app assembles from
 * use. This is only about the address, and it lives on its own because an
 * address that is silently misparsed sends an invitation to nobody — or to the
 * wrong person — and neither failure announces itself.
 */

// Deliberately not RFC 5322. That grammar admits addresses no mail server in
// practice accepts, and the cost of being slightly strict is somebody retyping;
// the cost of being loose is a bounce nobody notices.
const EMAIL = /^[^\s<>,;:"']+@[^\s<>,;:"']+\.[^\s<>,;:"']+$/;

export const looksLikeEmail = (s) => EMAIL.test(String(s ?? "").trim());

/** Split on commas, semicolons, and the word "and". */
const pieces = (text) =>
  String(text ?? "")
    .split(/\s*[,;]\s*|\s+and\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * One fragment as a person.
 *
 * "Priya Raman <priya@acme.com>" yields both. A bare address becomes its own
 * name until something better is known — "priya@acme.com is at 3pm" reads
 * awkwardly but reads *correctly*, whereas inventing "Priya" from an address is
 * a guess that will eventually be wrong in front of the person it names.
 */
export function parsePerson(fragment) {
  const raw = String(fragment ?? "").trim();
  if (!raw) return null;

  const angled = raw.match(/^(.*?)\s*<\s*([^>]*?)\s*>$/);
  if (angled) {
    const email = angled[2].trim();
    const name = angled[1].trim().replace(/^["']|["']$/g, "");
    if (!looksLikeEmail(email)) return name || email ? { name: name || email } : null;
    return { name: name || email, email };
  }

  if (looksLikeEmail(raw)) return { name: raw, email: raw };
  return { name: raw };
}

/** Everyone named in a "With" field, in the order they were typed. */
export const parsePeople = (text) => pieces(text).map(parsePerson).filter(Boolean);

/** Back to a string the field can show, so editing round-trips unchanged. */
export const formatPeople = (people = []) =>
  (people || [])
    .map((p) => {
      if (typeof p === "string") return p;
      if (!p) return "";
      return p.email && p.name && p.name !== p.email ? `${p.name} <${p.email}>` : p.name || p.email || "";
    })
    .filter(Boolean)
    .join(", ");

/** The ones an invitation can actually reach. */
export const invitable = (people = []) =>
  (people || []).filter((p) => p && typeof p === "object" && looksLikeEmail(p.email));
