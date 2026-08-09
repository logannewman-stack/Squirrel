/**
 * Sentences arriving from outside the app.
 *
 * Siri, a Shortcut, a widget, Spotlight, a bookmark — all of them can produce a
 * URL, so a URL is the whole interface. Which makes the parsing of it the one
 * place this can go wrong, and one of the ways it can go wrong is expensive: a
 * deep link left in the address bar re-runs on every reload, and for an
 * assistant that *changes your calendar* that is not cosmetic. Refresh the page
 * and the meeting is booked twice.
 */
import { takeRequest, askUrl } from "../src/lib/intent.js";

let pass = 0, fail = 0;
const failures = [];
const t = (name, ok, detail) => {
  if (ok) pass++; else { fail++; failures.push(name); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

/** A location and a history that record what was rewritten. */
const at = (search, pathname = "/") => {
  const loc = { search, pathname, hash: "" };
  const rewrites = [];
  const history = { replaceState: (_s, _t, url) => rewrites.push(url) };
  return { loc, history, rewrites };
};

// ------------------------------------------------------------------ reading
{
  const { loc, history } = at("?ask=move%20my%203pm%20to%204");
  const r = takeRequest(loc, history);
  t("a sentence in the URL is picked up", r?.text === "move my 3pm to 4", r?.text);
  t("and is not spoken back by default", r?.speak === false);
  t("with the source recorded", r?.source === "url", r?.source);

  t("`q` works too, because the custom scheme reads better that way",
    takeRequest(...Object.values(at("?q=what%20does%20friday%20look%20like")).slice(0, 2))?.text
      === "what does friday look like");

  const siri = takeRequest(...Object.values(at("?ask=cancel%20lunch&from=siri")).slice(0, 2));
  t("something asked out loud is answered out loud", siri?.speak === true);
  t("and knows where it came from", siri?.source === "siri", siri?.source);

  t("speak can be asked for outright",
    takeRequest(...Object.values(at("?ask=hello&speak=1")).slice(0, 2))?.speak === true);
  t("an unknown source is not taken at its word",
    takeRequest(...Object.values(at("?ask=hello&from=hackers")).slice(0, 2))?.source === "url");
}

// ------------------------------------------------------------------ nothing
{
  t("no query, no request", takeRequest({ search: "", pathname: "/" }, null) === null);
  t("an unrelated query is left alone",
    takeRequest(...Object.values(at("?utm_source=x")).slice(0, 2)) === null);
  t("an empty ask is not a request",
    takeRequest(...Object.values(at("?ask=")).slice(0, 2)) === null);
  t("nor is one made only of spaces",
    takeRequest(...Object.values(at("?ask=%20%20")).slice(0, 2)) === null);
  t("a missing location does not throw", takeRequest(undefined, undefined) === null);
}

// ----------------------------------------------------------------- consumed
/**
 * The expensive one. A link that stays in the bar runs again on reload, and
 * "book a meeting" running again is a second meeting.
 */
{
  const { loc, history, rewrites } = at("?ask=book%20lunch");
  takeRequest(loc, history);
  t("the request is stripped from the address bar", rewrites.length === 1, rewrites);
  t("leaving the path intact", rewrites[0] === "/", rewrites[0]);

  const other = at("?ask=book%20lunch&view=today&utm=abc");
  takeRequest(other.loc, other.history);
  t("and anything else in the query survives",
    /view=today/.test(other.rewrites[0]) && /utm=abc/.test(other.rewrites[0]), other.rewrites[0]);
  t("while the ask itself does not", !/ask=/.test(other.rewrites[0]), other.rewrites[0]);

  // A browser that refuses to rewrite its own bar is unusual, not fatal.
  const stubborn = { search: "?ask=hello", pathname: "/", hash: "" };
  t("a history that throws still yields the request",
    takeRequest(stubborn, { replaceState: () => { throw new Error("denied"); } })?.text === "hello");
}

// ------------------------------------------------------------------- limits
{
  const long = "a".repeat(900);
  const r = takeRequest(...Object.values(at(`?ask=${long}`)).slice(0, 2));
  t("an absurd sentence is cut rather than run", r.text.length === 500, r.text.length);
}

// ------------------------------------------------------------------ writing
{
  const url = askUrl("move my 3pm", { origin: "https://squirelll.com", from: "widget" });
  t("a link can be built", url === "https://squirelll.com/?ask=move%20my%203pm&from=widget", url);
  const round = takeRequest(
    { search: new URL(url).search, pathname: "/", hash: "" },
    null,
  );
  t("and reads back as what went in", round.text === "move my 3pm" && round.source === "widget",
    JSON.stringify(round));
}

console.log(`\nIntent: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
