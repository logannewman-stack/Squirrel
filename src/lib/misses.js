/**
 * A record of what she didn't understand.
 *
 * The reach number in the test suite is measured against phrasings I wrote,
 * which makes it a statement about my imagination rather than about anyone's
 * users. This is the instrument that replaces it: every sentence that fell
 * through, kept locally, grouped so a hundred entries read as a handful of
 * patterns instead of a wall of text.
 *
 * Two things it deliberately is not:
 *
 * It is not part of the app state. Its own key, outside `squirrel.v2`, so it
 * never enters the undo stack, never rides along in a sync payload, and never
 * grows the blob that gets parsed on every load.
 *
 * It is not telemetry. Nothing here leaves the device unless the person using
 * it presses export. What people type at a calendar is their week — who they
 * are meeting and when — and that is not something to collect quietly.
 */

const KEY = "squirrel.misses";

/** Enough to see the shape of the tail; small enough to never matter on disk. */
const LIMIT = 200;

/** Why a sentence was logged. */
export const REASONS = {
  /** No rule matched — she had no idea what was being asked. */
  UNPARSED: "unparsed",
  /** The verb landed, the object didn't: "move the thing that doesn't exist". */
  NO_MATCH: "no-match",
  /** Understood exactly, and the capability isn't built yet. */
  UNSUPPORTED: "unsupported",
};

const LABEL = {
  [REASONS.UNPARSED]: "Didn't understand",
  [REASONS.NO_MATCH]: "Couldn't find it",
  [REASONS.UNSUPPORTED]: "Not built yet",
};

export const labelFor = (reason) => LABEL[reason] ?? reason;

/**
 * Storage that cannot take the app down with it.
 *
 * Private browsing throws on write, quota throws on write, and a corrupted
 * value throws on parse. None of those are worth an error screen over a
 * diagnostic log, so every path here fails to "no data" and carries on.
 */
function load() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(rows) {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(rows));
  } catch {
    // Full disk or a locked-down browser. The log is a nice-to-have.
  }
}

let seq = 0;
/** Ids are local and short-lived — a counter is enough, and it keeps tests stable. */
const nextId = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * Collapse a sentence to its shape.
 *
 * Without this the log is two hundred unique strings and nobody reads it.
 * "book lunch with priya friday at 1" and "book dinner with tom tuesday at 7"
 * are the same gap in the parser, and they only look like it once the times,
 * dates, and digits are replaced by placeholders. What survives is the
 * skeleton — the words that decide which rule should have fired.
 */
const DAY_WORD =
  /\b(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight|yesterday)\b/g;
const MONTH_WORD =
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b/g;
const CLOCK = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?\b/g;

export function shapeOf(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\w\s:.]/g, " ")
    .replace(CLOCK, " <time> ")
    .replace(DAY_WORD, " <day> ")
    .replace(MONTH_WORD, " <month> ")
    .replace(/\d+/g, " <n> ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Log one sentence she couldn't act on.
 *
 * Returns the row's id so the next turn can attach the phrasing that worked —
 * see `resolve` below, which is where most of the value actually is.
 */
export function record({ text, reason = REASONS.UNPARSED, intent = null, at = Date.now() }) {
  const body = String(text ?? "").trim();
  if (!body) return null;

  const row = {
    id: nextId(),
    text: body,
    shape: shapeOf(body),
    reason,
    intent,
    at,
    // Filled in by `resolve` if the next thing they typed worked.
    fix: null,
    fixIntent: null,
  };
  save([...load(), row].slice(-LIMIT));
  return row.id;
}

/**
 * Pair a miss with the sentence that worked straight after it.
 *
 * This is the part worth having. A miss on its own says a phrasing failed; a
 * miss with the retry attached says what the person actually wanted, in their
 * own words, labelled with the intent that satisfied them. That is a training
 * pair — the exact thing needed to write the missing rule, and the exact thing
 * a model fallback would have to produce.
 *
 * Only the immediately following turn counts. Two messages later they have
 * moved on to something else, and guessing otherwise would fill the log with
 * pairs that mean nothing.
 */
const PAIR_STOP = new Set([
  "the", "a", "an", "my", "to", "for", "on", "at", "in", "of", "and", "with",
  "me", "it", "that", "this", "please", "can", "you", "add", "task", "make",
]);

/**
 * Do these two sentences look like the same request?
 *
 * The turn after a miss is usually a rephrasing, but sometimes the person just
 * moved on — and "order me a coffee" filed under "move the board call" is a
 * lead that wastes whoever follows it. One shared content word is a low bar
 * deliberately: it costs nothing to clear when the pair is real, and an
 * unrelated sentence almost never clears it.
 *
 * Rephrasings with no words in common do exist, and losing those is the price.
 * A log that is mostly right and short beats one that is complete and noisy.
 */
function related(a, b) {
  const words = (s) =>
    new Set(
      String(s ?? "").toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/)
        .filter((w) => w.length >= 4 && !PAIR_STOP.has(w)),
    );
  const left = words(a);
  if (!left.size) return true; // Nothing to disagree with.
  for (const w of words(b)) if (left.has(w)) return true;
  return false;
}

export function resolve(id, { text, intent, by = "user" }) {
  if (!id) return false;
  const rows = load();
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0 || rows[i].fix) return false;
  if (!related(rows[i].text, text)) return false;
  rows[i] = {
    ...rows[i],
    fix: String(text ?? "").trim(),
    fixIntent: intent ?? null,
    // Who did the rephrasing. A person finding their own way to say it is
    // evidence about the parser; a fallback model doing it is evidence about
    // the fallback. Reading them as one number would flatter both.
    fixSource: by,
  };
  save(rows);
  return true;
}

export const all = () => load();
export const count = () => load().length;
export const clear = () => save([]);

/**
 * The log as a short list of patterns, worst first.
 *
 * Sorted by how often each shape came up, because the tail is long and the
 * head is where the next hour of work pays for itself. A shape seen eleven
 * times is a rule worth writing; a shape seen once is somebody testing her.
 */
export function summary() {
  const groups = new Map();
  for (const row of load()) {
    const g = groups.get(row.shape) ?? {
      shape: row.shape,
      count: 0,
      reason: row.reason,
      examples: [],
      resolvedAs: [],
      lastAt: 0,
    };
    g.count += 1;
    g.lastAt = Math.max(g.lastAt, row.at);
    if (g.examples.length < 3 && !g.examples.includes(row.text)) g.examples.push(row.text);
    if (row.fix && !g.resolvedAs.some((r) => r.text === row.fix)) {
      g.resolvedAs.push({ text: row.fix, intent: row.fixIntent, by: row.fixSource ?? "user" });
    }
    groups.set(row.shape, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}

/** How much of the traffic she is missing, over the window the log covers. */
export function rate(handled) {
  const missed = count();
  const total = missed + Math.max(0, handled || 0);
  return total ? missed / total : 0;
}

/** The whole log as text, for pasting somewhere it can be read. */
export function exportText() {
  const rows = summary();
  if (!rows.length) return "No misses logged.";
  return rows
    .map((g) => {
      const head = `${g.count}×  [${labelFor(g.reason)}]  ${g.shape}`;
      const eg = g.examples.map((e) => `      "${e}"`).join("\n");
      const fix = g.resolvedAs.length
        ? `\n      → worked as: "${g.resolvedAs[0].text}"${g.resolvedAs[0].intent ? ` (${g.resolvedAs[0].intent})` : ""}`
        : "";
      return `${head}\n${eg}${fix}`;
    })
    .join("\n\n");
}
