/**
 * The fallback, wired to the server — the only part of Squirrel that costs
 * money per message, and the only part that is off by default.
 *
 * It is one function shaped to fit the socket in `fallback.js`: give it a
 * sentence the rules missed, get back the same request in words the rules
 * understand, or nothing. It never decides anything. What comes back is run
 * down the ordinary deterministic path, gates and all.
 *
 * ## Why the key lives on the server
 *
 * Nobody using this app should have to go and find an API key, and nothing
 * shipped to a browser is secret — a key in the bundle is a key on Pastebin by
 * the weekend. So the browser talks to `/api/interpret` with the session it
 * already has, and the key stays in an environment variable on the server,
 * where usage can also be counted and capped.
 *
 * ## What it costs
 *
 * Nothing, on any message the rules already handle — which is the overwhelming
 * majority, and the entire reason the deterministic parser stays in front. The
 * bill only tracks the tail.
 */

import { setResolver, clearResolver } from "./fallback.js";
import { client } from "../supabase.js";

/** Where the server-side proxy lives. Same origin, so no CORS and no key. */
const ENDPOINT = "/api/interpret";

/**
 * Turned off after the server says it has nothing to offer.
 *
 * A deployment without `ANTHROPIC_API_KEY` set answers 501 forever, and asking
 * it again on every miss is a round trip spent to learn what the last one
 * already said. One failure of that kind is enough.
 */
let unavailable = false;

async function translate(text, context) {
  if (unavailable) return null;

  const supabase = await client();
  const { data } = (await supabase?.auth.getSession()) ?? {};
  const token = data?.session?.access_token;
  // The endpoint requires a session. Without one there is nothing to charge
  // against and no way to cap anybody, so it is not attempted.
  if (!token) return null;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ text, context }),
  });

  // 501 means the deployment has no key configured. 402 means this account is
  // over its allowance. Both are permanent for this session; the rest — 429,
  // 500, a dropped connection — are worth trying again on the next miss.
  if (res.status === 501) {
    unavailable = true;
    return null;
  }
  if (!res.ok) return null;

  const body = await res.json().catch(() => null);
  return body?.say ?? null;
}

/**
 * Turn the fallback on.
 *
 * Everything after this point is guarded by `interpret`, which treats an
 * error, a timeout, an echo, and a paragraph identically to silence — so the
 * worst this can do is cost a round trip and land back on the answer the rules
 * would have given anyway.
 */
export const enableRemote = () => {
  // Clear the "no key configured" latch every time the boost is enabled. A
  // 501 earlier in the session — before a key was added, or from a
  // since-redeployed backend — must not keep the fallback dark for the life
  // of the tab. Toggling Boost off and on is precisely how someone says "try
  // again", and the 501 path re-latches in a single round trip if the
  // deployment genuinely still has no key.
  unavailable = false;
  setResolver(translate);
};

export const disableRemote = () => clearResolver();

/** Test seam: forget that a deployment said it had no key. */
export const resetRemote = () => {
  unavailable = false;
};
