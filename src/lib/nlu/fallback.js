/**
 * The seam where a model can be plugged in, and the rules it has to obey.
 *
 * Nothing here calls a model. This is the socket: an optional resolver that
 * gets a sentence the parser couldn't handle and returns the same request
 * written in vocabulary the parser does handle. With no resolver installed —
 * the default, and the whole app today — every path below is a no-op and
 * behaviour is exactly what it was.
 *
 * ## Why it rewrites rather than decides
 *
 * The obvious design is to have the model return `{intent, slots}` and act on
 * that. This deliberately doesn't. The resolver returns *a sentence*, which is
 * then run down the ordinary deterministic road — same resolver, same
 * ambiguity checks, same confirmation gate, same undo entry.
 *
 * That buys three things worth more than the directness:
 *
 * - There is no second execution path. A model that returns nonsense produces
 *   a sentence the parser misses, and a miss is already handled. It cannot
 *   produce an action the rules can't produce, because it isn't producing
 *   actions.
 * - It is legible. The log holds both sentences, so "why did it cancel that"
 *   is answerable by reading two lines.
 * - It cannot invent capability. Asked to do something Squirrel doesn't do,
 *   the best it can write is a sentence that also fails — which is the honest
 *   answer, arrived at without a special case.
 *
 * The retry is bounded to one pass. A rewrite is never itself rewritten, so
 * there is no loop, no matter what comes back over the wire.
 */

/** Longer than this and the honest "I didn't catch that" is the better answer. */
const TIMEOUT_MS = 6000;

let resolver = null;

/**
 * Install a translator. `fn(text, context)` returns a rewritten sentence, or
 * null when it has nothing useful — which is a valid and expected answer.
 */
export function setResolver(fn) {
  resolver = typeof fn === "function" ? fn : null;
}

export const clearResolver = () => {
  resolver = null;
};

export const hasResolver = () => Boolean(resolver);

/**
 * A rewrite worth running, or null.
 *
 * Every failure mode collapses to null on purpose: no resolver, a thrown
 * error, a timeout, a non-string reply, an empty reply, or a reply that just
 * echoes the input back. The caller has one branch to write — "did I get a
 * usable sentence" — and a broken endpoint degrades to today's behaviour
 * instead of to a broken assistant.
 */
export async function interpret(text, context = {}, { timeoutMs = TIMEOUT_MS } = {}) {
  if (!resolver) return null;
  const original = String(text ?? "").trim();
  if (!original) return null;

  try {
    const said = await withTimeout(resolver(original, context), timeoutMs);
    if (typeof said !== "string") return null;

    const rewrite = said.trim();
    if (!rewrite) return null;

    // An echo is not a translation. Running it again would produce the same
    // miss and charge for the privilege.
    if (rewrite.toLowerCase() === original.toLowerCase()) return null;

    // A model asked for one short command and answering with a paragraph has
    // misunderstood the job; that text is not something to execute.
    if (rewrite.length > 300) return null;

    return rewrite;
  } catch {
    // Offline, rate-limited, 500, malformed JSON, timeout. All the same to the
    // person typing: she didn't get it, and says so.
    return null;
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    Promise.resolve(promise).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * What the translator is allowed to see.
 *
 * Deliberately narrow. Resolving "shift the thing with the Kowalski people"
 * needs the titles on the calendar, and needs nothing else — not notes, not
 * attendee emails, not anything from a day that isn't in play. Ten upcoming
 * events and ten open tasks is enough to disambiguate a reference and small
 * enough to read in full before deciding to send it.
 */
export function contextFor(state, now = new Date()) {
  const from = now.getTime();
  const upcoming = (state.events || [])
    .filter((e) => new Date(e.start).getTime() >= from - 12 * 3600e3)
    .sort((a, b) => String(a.start).localeCompare(String(b.start)))
    .slice(0, 10)
    .map((e) => ({ title: e.title, start: e.start }));

  const tasks = (state.tasks || [])
    .filter((t) => !t.done)
    .slice(0, 10)
    .map((t) => ({ title: t.title, due: t.due ?? null }));

  return { now: now.toISOString(), upcoming, tasks };
}
