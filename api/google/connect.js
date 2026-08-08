import { requireUser, json } from "../_lib/db.js";
import { consentUrl } from "../_lib/google.js";
import { sign } from "../_lib/state.js";

/**
 * Step one of connecting a Google Calendar: where to send the browser.
 *
 * The user's identity travels in the `state` parameter, signed. It has to
 * travel somehow — Google's redirect arrives as a plain browser navigation with
 * no Authorization header — and signing it is what stops the obvious attack:
 * without a signature anyone could call the callback with someone else's user
 * id in the URL and staple their own Google account onto that person's data.
 *
 * Calendar sync is a paid feature, and this is where that is enforced. The
 * client hides the button, but the client is not a control.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !redirectUri) return json(res, 501, { error: "google not configured" });

  const auth = await requireUser(req);
  if (!auth) return json(res, 401, { error: "unauthorized" });

  const { asService } = await import("../_lib/db.js");
  const { data: profile } = await asService()
    .from("profiles").select("plan").eq("id", auth.user.id).maybeSingle();

  // Mirrors FEATURES.calendarSync in src/lib/plans.js. The server is the one
  // that counts.
  if (!["pro", "plus", "studio"].includes(profile?.plan)) {
    return json(res, 402, { error: "calendar sync is a Pro feature" });
  }

  return json(res, 200, {
    url: consentUrl({
      clientId,
      redirectUri,
      state: sign({ uid: auth.user.id, at: Date.now() }),
    }),
  });
}
