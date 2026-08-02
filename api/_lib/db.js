import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Client scoped to the caller's JWT. Every query runs under their RLS policies,
 * so a bug in tool code cannot reach another user's rows.
 */
export const asUser = (jwt) =>
  createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

/**
 * Service-role client — bypasses RLS. Only for things the user must not be able
 * to do to themselves: incrementing usage, writing billing state.
 */
export const asService = () =>
  createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

/** Resolve the bearer token to a user, or null. */
export async function requireUser(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const jwt = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!jwt) return null;
  const { data, error } = await asUser(jwt).auth.getUser();
  if (error || !data?.user) return null;
  return { user: data.user, jwt };
}

export const json = (res, status, body) => {
  res.setHeader("content-type", "application/json");
  res.status(status).send(JSON.stringify(body));
};
