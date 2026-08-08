import { asService } from "../_lib/db.js";
import { TOKEN_URL, API } from "../_lib/google.js";
import { verify } from "../_lib/state.js";

/**
 * Step two: Google sends the browser back here with a one-time code.
 *
 * This runs with no Authorization header — it is a plain navigation — so the
 * only proof of who this is comes from the signed `state`. An unverified state
 * is refused outright rather than trusted, because trusting it would let anyone
 * bolt their calendar onto another person's account.
 *
 * The refresh token is written with the service role and never leaves the
 * server. The schema's column grants already stop the browser reading it; this
 * is the other half of that promise.
 */
export default async function handler(req, res) {
  const done = (msg, ok = false) => {
    // Back to the app either way — an error page on a random domain after an
    // OAuth dance reads as "this app is broken", not "you denied consent".
    const to = `${process.env.PUBLIC_URL || ""}/?calendar=${ok ? "connected" : "failed"}` +
      (msg ? `&reason=${encodeURIComponent(msg)}` : "");
    res.writeHead(302, { location: to || "/" });
    res.end();
  };

  const { code, state, error } = req.query || {};
  if (error) return done(error);            // the user pressed "cancel"
  if (!code) return done("no_code");

  const claim = verify(state);
  if (!claim?.uid) return done("bad_state");

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return done("not_configured");

  try {
    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirectUri, grant_type: "authorization_code",
      }),
    });
    const token = await tokenRes.json();
    if (!tokenRes.ok) return done("exchange_failed");

    // No refresh token means offline access was not granted, and the link would
    // work for exactly one hour and then fail in a way nobody could diagnose.
    // Better to refuse it now and say so.
    if (!token.refresh_token) return done("no_refresh_token");

    // Whose calendar this is, for the label in Settings.
    const who = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { authorization: `Bearer ${token.access_token}` },
    }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));

    // The primary calendar. Choosing among several is a later feature; syncing
    // the one everybody means is the whole job for now.
    const cal = await fetch(`${API}/calendars/primary`, {
      headers: { authorization: `Bearer ${token.access_token}` },
    }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));

    const db = asService();
    await db.from("calendar_links").upsert({
      user_id: claim.uid,
      provider: "google",
      account: who.email || "google",
      calendar_id: cal.id || "primary",
      calendar_name: cal.summary || "Calendar",
      refresh_token: token.refresh_token,
      // Null forces the first sync to be a full one, which is what we want:
      // there is no cursor yet and nothing local to reconcile against.
      sync_token: null,
      last_error: null,
    }, { onConflict: "user_id,provider,account,calendar_id" });

    return done(null, true);
  } catch {
    return done("exchange_failed");
  }
}
