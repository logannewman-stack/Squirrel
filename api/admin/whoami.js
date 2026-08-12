import { requireUser, json } from "../_lib/db.js";
import { isOwner } from "./users.js";

/**
 * "Is this account the one that runs this deployment?"
 *
 * One boolean, so the app can hide founder tooling from customers without
 * guessing. The screens that use it — the roster, the boost diagnostic —
 * could each probe their own endpoint and read a 403, but that means every
 * customer's Settings screen quietly issuing a forbidden request, and a
 * roster query run purely to be refused.
 *
 * It reveals nothing a caller does not already know about themselves: the
 * answer for anybody not on the list is `false`, which is exactly what they
 * would learn by clicking. The real boundary stays where it belongs — on the
 * endpoints that actually do something.
 */
export default async function handler(req, res) {
  const auth = await requireUser(req);
  if (!auth) return json(res, 401, { error: "unauthorized" });
  return json(res, 200, { owner: isOwner(auth.user.email) });
}
