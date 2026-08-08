/**
 * The signed OAuth state.
 *
 * This is the one piece of the calendar integration where a mistake is not a
 * bug but a breach. The `state` parameter is the only thing that survives the
 * redirect through Google, so it carries the user's identity — and if it can be
 * forged, anyone can attach their own Google account to somebody else's
 * Squirrel account and read every meeting in it. These tests are the proof that
 * it cannot.
 */

process.env.OAUTH_STATE_SECRET = "test-secret-not-a-real-key";
const { sign, verify } = await import("../api/_lib/state.js");

let pass = 0, fail = 0;
const failures = [];
const t = (name, ok, detail) => {
  if (ok) pass++; else { fail++; failures.push(name); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const NOW = 1_800_000_000_000;

// ------------------------------------------------------------- round trip
{
  const token = sign({ uid: "user-1", at: NOW });
  const out = verify(token, NOW + 1000);
  t("a signed payload comes back", out?.uid === "user-1", JSON.stringify(out));
  t("and the token is not readable as plain json", !token.startsWith("{"));
}

// ----------------------------------------------------------------- forgery
{
  // The whole attack: put someone else's id in and hope nobody checks.
  const mine = sign({ uid: "attacker", at: NOW });
  const body = mine.slice(0, mine.lastIndexOf("."));
  const sig = mine.slice(mine.lastIndexOf(".") + 1);
  const forged = `${Buffer.from(JSON.stringify({ uid: "victim", at: NOW })).toString("base64url")}.${sig}`;

  t("a payload swapped under a real signature is refused", verify(forged, NOW) === null);
  t("a tampered body is refused", verify(`${body}x.${sig}`, NOW) === null);
  t("a tampered signature is refused", verify(`${body}.${sig.slice(0, -1)}x`, NOW) === null);
  t("an unsigned payload is refused", verify(body, NOW) === null);
  t("empty is refused", verify("", NOW) === null);
  t("undefined is refused, not thrown", verify(undefined, NOW) === null);
  t("a signature of the wrong length is refused, not thrown", verify(`${body}.abc`, NOW) === null);

  // Signed with a different secret — i.e. by somebody who does not have ours.
  process.env.OAUTH_STATE_SECRET = "a-different-secret";
  const elsewhere = sign({ uid: "attacker", at: NOW });
  process.env.OAUTH_STATE_SECRET = "test-secret-not-a-real-key";
  t("a token signed with another secret is refused", verify(elsewhere, NOW) === null);
}

// ------------------------------------------------------------------ expiry
{
  const token = sign({ uid: "user-1", at: NOW });
  t("a fresh token is accepted", verify(token, NOW + 60_000)?.uid === "user-1");
  t("a token from an hour ago is refused", verify(token, NOW + 3_600_000) === null);
  t("a payload with no timestamp is refused",
    verify(sign({ uid: "user-1" }), NOW) === null);
}

// ------------------------------------------------------------------ replay
{
  // Two tokens for the same user must not be identical, or one captured from a
  // log is reusable forever.
  t("two tokens for the same user differ",
    sign({ uid: "u", at: NOW }) !== sign({ uid: "u", at: NOW }));
}

console.log(`\nOAuth state: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
