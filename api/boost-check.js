import Anthropic from "@anthropic-ai/sdk";
import { asService, requireUser, json } from "./_lib/db.js";

/**
 * Does the boost actually work?
 *
 * `setup-check` answers "is a key set", which is the question you can answer
 * without spending anything and is not the question anybody has. A key with a
 * typo in it is set. A revoked key is set. A model name that was right last
 * year is set. All three read as configured, and then the failure is invisible
 * forever after — `lib/nlu/fallback.js` collapses every error to null on
 * purpose, because a user must never see a stack trace where an answer should
 * be. Correct for them; it means the operator has no way to learn the boost has
 * been dead since the day they deployed it.
 *
 * So this makes one real call and reports what came back.
 *
 * ## Why it is behind sign-in when setup-check is not
 *
 * `setup-check` returns booleans and costs nothing, so it is safe to leave
 * open. This spends money on every request. Left public it is a stranger's
 * button for running up someone else's bill, so it takes the same
 * authorisation as the boost itself — and this is a deployment diagnostic for
 * whoever owns the deployment, who is by definition signed in.
 *
 * The call is deliberately the smallest one the API will accept: one short
 * sentence, a handful of output tokens, no cache write. Roughly a hundredth of
 * a cent, which makes "press it again" a reasonable thing to tell somebody.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";

/**
 * Anthropic's error shapes, in the words of the person who has to fix them.
 *
 * A raw `401 {"type":"error",...}` sends somebody to a search engine. Naming
 * the dashboard and the variable turns the same failure into one action.
 */
function explain(e) {
  const status = e?.status ?? e?.response?.status ?? null;
  if (status === 401) {
    return "The key was refused. Check ANTHROPIC_API_KEY — a rotated or revoked key looks exactly like a correct one from here.";
  }
  if (status === 403) return "The key is valid but not permitted to use this model.";
  if (status === 404) {
    return `No model named “${MODEL}”. Check ANTHROPIC_MODEL — model names change, and an old one fails only at the moment somebody needs it.`;
  }
  if (status === 429) return "Rate limited. The key works; this deployment is asking too often.";
  if (status === 400) return `The request was rejected: ${e?.message || "bad request"}.`;
  if (status >= 500) return "Anthropic returned a server error. The configuration looks right; try again shortly.";
  // No status at all is a network or DNS failure, which on a serverless host
  // usually means egress is blocked rather than that anything is misconfigured.
  return `Could not reach the API: ${e?.message || "no response"}. If this host restricts outbound traffic, that is the likeliest cause.`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });

  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    return json(res, 200, {
      ok: false,
      configured: false,
      model: MODEL,
      detail: "No ANTHROPIC_API_KEY on this deployment. The assistant still answers from her own rules, offline and at no cost — the boost is the safety net for phrasings those rules miss.",
    });
  }

  const auth = await requireUser(req);
  if (!auth) return json(res, 401, { error: "unauthorized" });

  // A shape mistake worth catching before spending anything: the client-side
  // prefix would have shipped the key to every browser that loaded the app.
  if (process.env.VITE_ANTHROPIC_API_KEY) {
    return json(res, 200, {
      ok: false,
      configured: true,
      model: MODEL,
      detail: "VITE_ANTHROPIC_API_KEY is set. Anything prefixed VITE_ is inlined into the browser bundle, so that key is public — revoke it, and set ANTHROPIC_API_KEY instead.",
    });
  }

  /**
   * A real model call costs money, so it is metered exactly like /api/interpret
   * — through the same atomic claim. Without this, "signed in" was treated as
   * "is the operator", and any free account (0 chat allowance, so /interpret
   * always 402s them) could script this endpoint for unbounded spend against
   * the shared key, degrading paying users to deterministic-only when the
   * shared rate-limit bucket drained. A boost test is one chat; a free tier
   * with no allowance cannot run it, which is correct — the boost is a paid
   * feature and testing it is the operator's own paid account doing so.
   */
  const db = asService();
  const { data: allowed, error: claimErr } = await db.rpc("claim_assistant_chat", {
    uid: auth.user.id,
  });
  if (claimErr) return json(res, 200, { ok: false, configured: true, model: MODEL, detail: "Could not reach the usage meter — try again." });
  if (!allowed) {
    return json(res, 200, {
      ok: false,
      configured: true,
      model: MODEL,
      detail: "This account has no assistant allowance left this month, so the test can't run. The boost itself is fine — it's the meter, not the key.",
    });
  }

  const started = Date.now();
  try {
    const client = new Anthropic({ apiKey: key });
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply with the single word: ready" }],
    });
    // Count the tokens the test really spent, same as the interpret path.
    const u = message.usage || {};
    await db.rpc("record_assistant_tokens", {
      uid: auth.user.id,
      tin: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      tout: u.output_tokens ?? 0,
    });
    const said = message.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
    return json(res, 200, {
      ok: true,
      configured: true,
      model: message.model || MODEL,
      ms: Date.now() - started,
      // Returned so the answer is evidently a real round trip rather than a
      // green tick this endpoint decided to draw.
      said: said.slice(0, 40),
      detail: "The boost is working. Messages her rules miss will be reworded and run down the ordinary path — same confirmation, same undo.",
    });
  } catch (e) {
    return json(res, 200, { ok: false, configured: true, model: MODEL, detail: explain(e) });
  }
}
