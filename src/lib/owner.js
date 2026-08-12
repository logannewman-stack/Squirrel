import { client } from "./supabase";

/**
 * Does this account run the deployment?
 *
 * Asked once per session and remembered, because several screens want the
 * answer and none of them should each cost a round trip. The answer only ever
 * hides or shows founder tooling — every endpoint that does something real
 * checks the allow-list itself, server-side, so a tampered `true` here buys
 * nothing but a screen that then answers 403.
 *
 * Everything that can go wrong resolves to `false`: signed out, no API on
 * this deployment, no allow-list configured, network down. A customer and a
 * misconfigured server should look identical from here — quiet.
 */
let asked = null;

export function isOwner() {
  if (asked) return asked;
  asked = (async () => {
    try {
      const supabase = await client();
      const { data } = (await supabase?.auth.getSession()) ?? {};
      const token = data?.session?.access_token;
      if (!token) return false;
      const res = await fetch("/api/admin/whoami", {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) return false;
      return Boolean((await res.json())?.owner);
    } catch {
      return false;
    }
  })();
  return asked;
}

/** Signing in or out changes the answer; the next asker should find out. */
export const forgetOwner = () => {
  asked = null;
};
