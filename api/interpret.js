import Anthropic from "@anthropic-ai/sdk";
import { asService, requireUser, json } from "./_lib/db.js";

/**
 * The fallback translator — the one endpoint in Squirrel that costs money.
 *
 * It is given a sentence the deterministic parser could not handle, and it
 * returns the same request written in words the parser does handle. It does
 * not act, does not touch the database, and does not see anything beyond the
 * ten upcoming events and ten open tasks the browser chose to send.
 *
 * The rewrite goes back to the browser and runs down the ordinary path there:
 * same resolver, same "which one did you mean", same confirmation before
 * anything destructive, same undo entry. That is the containment. The worst a
 * confused model can do is produce a sentence that also fails to parse, which
 * is a case that already existed and is already handled.
 *
 * ## Why this is not the default
 *
 * The rules handle the overwhelming majority of what anyone types at a
 * calendar, at zero marginal cost, offline, instantly. Putting a model in
 * front of that would multiply the bill by roughly the reciprocal of the miss
 * rate for no gain on the traffic that already works. So this is second, and
 * only ever second.
 */

/**
 * Haiku by default: this is short-sentence-to-short-sentence translation over
 * a fixed vocabulary, which is the cheapest job in the catalogue. Overridable
 * because the arithmetic is not obvious and is worth measuring rather than
 * assuming — see the note on caching by the `system` block below.
 */
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";

/** One short command comes back. Anything longer is a misunderstanding, not an answer. */
const MAX_TOKENS = 120;

/** A sentence, not an essay. Longer than this is not somebody talking to a calendar. */
const MAX_INPUT = 500;

/** The literal the model returns when a request cannot be expressed at all. */
const NONE = "NONE";

const SYSTEM = `You translate a person's calendar request into ONE short command
in the fixed vocabulary of a scheduling assistant called Squirrel.

You do not answer the request. You do not confirm anything. You do not explain.
You rewrite the request as a single imperative sentence, and nothing else.

# What Squirrel can be told

Booking:
  "book <title> <day> at <time>"
  "book <title> with <person> <day> at <time> for <n> minutes"
  "schedule a call with <person> tomorrow at 3pm"

Moving:
  "move <title> to <day> at <time>"
  "move my 3pm to Friday at 10"

Cancelling one thing:
  "cancel <title>"
  "cancel my 2pm on Thursday"

Emptying a stretch of time:
  "clear my Friday"
  "clear my calendar next week"
  "cancel everything Tuesday afternoon"

Length:
  "make <title> 45 minutes"
  "make the standup half an hour"

Repeating:
  "repeat <title> every Monday at 9"

Tasks:
  "add a task to <do something>"
  "add a task to <do something> due Friday"
  "add a high priority task to <do something>, 2 hours"
  "mark <task> done"
  "rename <task> to <new name>"
  "delegate <task> to <person>"

Questions:
  "what do I have <day>"
  "when is <title>"
  "am I free <day> afternoon"
  "what am I working on <day>"
  "how am I doing on <project>"
  "what are my working hours"

Other:
  "undo"

# Rules

1. Output the command only. No quotes around the whole line, no preamble, no
   trailing explanation, no markdown.
2. Use the context to resolve references. "the thing with the Kowalski people"
   becomes the actual title from the upcoming list. "after my flight" becomes a
   real day and time if the flight is in the list, and ${NONE} if it is not.
3. Keep every detail the person gave: the person, the length, the priority,
   the deadline. Dropping one is worse than returning ${NONE}.
4. Never invent a time, a day, a person, or a title that is neither in the
   request nor in the context. If a required detail is genuinely missing,
   translate it anyway and let Squirrel ask — "move the board call" is a valid
   output, and Squirrel will ask when to.
5. Use plain weekday names and clock times: "Friday at 2pm", "tomorrow at 9:30".
   Do not output ISO dates.
6. One command. If the person asked for two things, translate the first.
7. If the request is not about a calendar, tasks, or projects at all — the
   weather, a joke, sending email, booking a flight, playing music — return
   exactly ${NONE}. Squirrel would rather say it cannot do something than do
   the wrong thing.
8. If you cannot express the request in the vocabulary above, return exactly
   ${NONE}. This is a normal and expected answer, not a failure.

# Examples

Request: shift whatever I had with the Kowalski people to after my flight lands
Context: upcoming includes "Kowalski diligence" Thu 10:00, "Flight to Denver" Thu 13:00-16:00
Output: move Kowalski diligence to Thursday at 4:30pm

Request: I need an hour with Ronnie sometime Tuesday morning
Output: book a meeting with Ronnie Tuesday at 9am for 1 hour

Request: bin everything I've got on the back half of Friday
Output: cancel everything Friday afternoon

Request: the standup is running long, give it another quarter hour
Context: upcoming includes "Standup" Wed 09:00-09:15
Output: make Standup 30 minutes

Request: chase legal about the term sheet before the week is out
Output: add a task to chase legal about the term sheet due Friday

Request: scrap the 4 o'clock
Output: cancel my 4pm

Request: put the board deck on Priya's plate
Context: tasks include "Board deck"
Output: delegate Board deck to Priya

Request: actually no, put that back
Output: undo

Request: what's the weather in Denver
Output: ${NONE}

Request: email the deck to legal
Output: add a task to email the deck to legal

Request: order me a coffee
Output: ${NONE}`;

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });

  // No key configured on this deployment. Said plainly and with its own status
  // so the browser can stop asking rather than retrying on every miss forever.
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json(res, 501, { say: null, error: "fallback not configured" });

  const auth = await requireUser(req);
  if (!auth) return json(res, 401, { error: "unauthorized" });

  const { text, context } = req.body || {};
  const request = String(text ?? "").trim();
  if (!request) return json(res, 400, { error: "no text" });
  if (request.length > MAX_INPUT) return json(res, 413, { say: null });

  // Metered against the account's plan, and locked at the row so two requests
  // in flight cannot both pass the check. This is the only per-message cost in
  // the product, so it is the one thing that must not be uncapped.
  //
  // Claimed before the call rather than after, which means a request that then
  // fails upstream still spends one from the allowance. That is the wrong way
  // round for the user and the right way round for the bill: claiming
  // afterwards leaves a window where concurrent requests all pass the check and
  // the spend has no ceiling at all.
  const db = asService();
  const { data: allowed, error: claimErr } = await db.rpc("claim_assistant_chat", {
    uid: auth.user.id,
  });
  if (claimErr) return json(res, 500, { say: null });
  if (!allowed) return json(res, 402, { say: null, error: "over plan allowance" });

  try {
    const client = new Anthropic({ apiKey: key });
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: "text",
          text: SYSTEM,
          /**
           * The vocabulary is identical on every request, so it is worth
           * caching — reads bill at roughly a tenth of the input rate.
           *
           * Whether it actually caches depends on the model's minimum
           * cacheable prefix, and the block above does not clear Haiku 4.5's
           * 4,096-token floor. Below the floor this is silently ignored and
           * every request pays full input price. Check
           * `usage.cache_creation_input_tokens` and `cache_read_input_tokens`
           * on the response before believing any saving: if both are zero, the
           * prompt is too short to cache and the choice is to grow it with
           * examples worth having anyway, or to use a model with a lower floor.
           */
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `Request: ${request}\nContext: ${JSON.stringify(context ?? {})}\nOutput:`,
        },
      ],
    });

    const said = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    // Tokens are recorded even when the answer is unusable — an endpoint that
    // only counts its successes understates the bill.
    const u = message.usage || {};
    await db.rpc("record_assistant_tokens", {
      uid: auth.user.id,
      tin: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      tout: u.output_tokens ?? 0,
    });

    // "NONE" is the expected answer for anything outside the vocabulary, and
    // it means the same thing to the browser as a network failure: keep the
    // honest reply the rules already produced.
    if (!said || said === NONE || said.startsWith(NONE)) return json(res, 200, { say: null });

    return json(res, 200, { say: said });
  } catch {
    // Rate limits, overload, a malformed response. The browser degrades to the
    // deterministic answer, so there is nothing useful to say here.
    return json(res, 200, { say: null });
  }
}
