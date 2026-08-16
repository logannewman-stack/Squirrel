/**
 * The two things that only break on a device.
 *
 * Both were shipped and neither could ever have worked, because both are
 * correct in a browser and wrong in the app, and every test until now ran in a
 * browser:
 *
 *   · every API call was root-relative, and the app is served from the
 *     device at https://localhost — so `/api/usage` addressed a server that
 *     does not exist, and sign-in, billing, the company screen and the App
 *     Store receipt check all failed together.
 *   · the magic link came back to `location.origin`, which on device is that
 *     same non-existent server, so the return leg of sign-in went nowhere.
 *
 * Neither throws. Both produce a screen where nothing happens. Assertions
 * below are the cheapest thing that would have caught either.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { signInRedirect, tokensFrom, errorFrom } from "../src/lib/authlink.js";

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

/* ------------------------------------------------------- the return address */
t("on the web the link comes back to this origin",
  signInRedirect(false) === globalThis.location?.origin);
t("in the app it comes back through the app's own scheme",
  signInRedirect(true) === "squirrel://auth", signInRedirect(true));

const good = "squirrel://auth#access_token=abc.def&refresh_token=xyz&token_type=bearer&expires_in=3600";
t("a returning link yields both tokens",
  JSON.stringify(tokensFrom(good)) === JSON.stringify({ access_token: "abc.def", refresh_token: "xyz" }),
  JSON.stringify(tokensFrom(good)));

// Half a pair signs somebody in and then out an hour later with no explanation,
// which is worse than not signing them in at all.
t("half a pair is refused rather than half-applied",
  tokensFrom("squirrel://auth#access_token=abc") === null);
t("and so is a refresh token on its own",
  tokensFrom("squirrel://auth#refresh_token=xyz") === null);

// The app is opened by several kinds of URL. Only one of them is a sign-in.
t("a Siri sentence is not mistaken for a sign-in",
  tokensFrom("squirrel://ask?ask=book%20a%20call") === null);
t("nor is a plain launch", tokensFrom("squirrel://") === null);
t("nor is a non-string", tokensFrom(undefined) === null && tokensFrom(null) === null);

/* --------------------------------------------------------------- the errors */
const expired = "squirrel://auth#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";
t("an expired link is recognised", errorFrom(expired)?.code === "otp_expired");
t("and said in words somebody can act on",
  /expired.*another/i.test(errorFrom(expired).said), errorFrom(expired).said);
t("a good link reports no error", errorFrom(good) === null);
t("and a Siri sentence reports no error", errorFrom("squirrel://ask?ask=hello") === null);

/* ------------------------------------------ nothing addresses the API itself */
/**
 * The mechanical half. `api()` knows where the server is; a bare
 * `fetch("/api/…")` does not, and on a device it fails silently. One module is
 * allowed to know, and every new call site has to go through it.
 */
function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.jsx?$/.test(path)) out.push(path);
  }
  return out;
}

const SRC = new URL("../src", import.meta.url).pathname;
const offenders = sources(SRC)
  .filter((p) => !p.endsWith("/lib/api.js"))
  .filter((p) => /\bfetch\(\s*["'`]\/api/.test(readFileSync(p, "utf8")))
  .map((p) => p.slice(SRC.length + 1));

t("no screen addresses the API with a bare relative fetch",
  offenders.length === 0,
  `${offenders.join(", ")} — use api() from lib/api.js, or it dies on device`);

// And the module that is allowed to know must refuse to guess in a native
// build with nothing configured, rather than falling back to the broken form.
const apiSrc = readFileSync(join(SRC, "lib/api.js"), "utf8");
t("an unconfigured native build fails loudly instead of silently",
  /native\(\)/.test(apiSrc) && /throw new Error/.test(apiSrc));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
