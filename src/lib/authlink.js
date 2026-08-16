/**
 * Getting back into the app after clicking a magic link.
 *
 * Sign-in is one round trip through an email client, and the return leg is
 * where it breaks on a phone. `emailRedirectTo: location.origin` is right on
 * the web and meaningless in the app, where the origin is `https://localhost`
 * — the device's own bundle. The link in the email pointed at a server that
 * does not exist, Safari showed a failure page, and the app never heard
 * anything. Sign-in could not have worked on a device.
 *
 * So the app asks Supabase to send people back through its own URL scheme, and
 * handles the arrival itself. Two small pure functions, kept out of
 * `native.js` so they can be tested without a shell.
 *
 * ## The Supabase side
 *
 * `squirrel://auth` has to be listed under Authentication → URL Configuration →
 * Redirect URLs, or Supabase refuses the redirect and sends the person to the
 * site URL instead — which looks exactly like the bug this replaces.
 */

/** Where the emailed link should come back to, on this platform. */
export function signInRedirect(native = globalThis.__SQUIRREL_NATIVE__ === true) {
  return native ? "squirrel://auth" : globalThis.location?.origin;
}

/**
 * The session tokens carried on a returning link, if this is one.
 *
 * Supabase's default flow puts them in the URL *fragment* rather than the
 * query, deliberately — a fragment is never sent to a server, so the token
 * cannot leak into an access log on the way past. That also means nothing but
 * the client can read it, which is why this parsing exists at all.
 *
 * Returns null for every other URL the app is opened with, and there are
 * several: a Siri sentence, a universal link, a share sheet. Anything that is
 * not a sign-in must fall through untouched.
 */
export function tokensFrom(url) {
  if (typeof url !== "string" || !url.includes("#")) return null;

  const fragment = url.slice(url.indexOf("#") + 1);
  let params;
  try {
    params = new URLSearchParams(fragment);
  } catch {
    return null;
  }

  const access = params.get("access_token");
  const refresh = params.get("refresh_token");
  // Both or neither. A half-formed pair sets a session that cannot be
  // refreshed, which signs somebody in and then out again an hour later with
  // no explanation.
  if (!access || !refresh) return null;

  return { access_token: access, refresh_token: refresh };
}

/**
 * An error handed back on the link instead of a session.
 *
 * An expired link is the commonest failure in the whole flow — people open
 * email on a different device, or an hour later — and it arrives looking like
 * a successful return. Read separately so the app can say "that link has
 * expired, here's another" rather than silently doing nothing.
 */
export function errorFrom(url) {
  if (typeof url !== "string" || !url.includes("#")) return null;
  const params = new URLSearchParams(url.slice(url.indexOf("#") + 1));
  const code = params.get("error_code") || params.get("error");
  if (!code) return null;
  return {
    code,
    said: /expired|otp_expired/i.test(code)
      ? "That sign-in link has expired. Send yourself another."
      : params.get("error_description")?.replace(/\+/g, " ") || "That sign-in link didn't work.",
  };
}
