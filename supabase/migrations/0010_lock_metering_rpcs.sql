-- Lock the metering functions to the server, not the browser.
--
-- claim_assistant_chat and record_assistant_tokens are SECURITY DEFINER: they
-- run as the owner and write usage_counters, a table RLS otherwise makes
-- unwritable by clients. That is correct — only the server should move the
-- meter. But a SECURITY DEFINER function keeps Postgres's default EXECUTE grant
-- to PUBLIC, so the anon and authenticated roles (the keys shipped to every
-- browser) could call them directly via supabase.rpc(...):
--
--   * record_assistant_tokens(uid, tin, tout) — inflate anyone's token counter,
--     poisoning the usage numbers the owner reads to set prices.
--   * claim_assistant_chat(uid) — burn any user's monthly allowance, or (passing
--     one's own id) spend chats outside the /api/interpret path that is supposed
--     to be the only place spend happens.
--
-- The API calls both through the service-role client (asService in
-- api/_lib/db.js), which is not subject to these grants, so revoking PUBLIC
-- costs the server nothing and closes the client's back door. Belt and braces:
-- grant EXECUTE explicitly to service_role after the revoke.

revoke execute on function claim_assistant_chat(uuid) from public;
revoke execute on function record_assistant_tokens(uuid, bigint, bigint) from public;

grant execute on function claim_assistant_chat(uuid) to service_role;
grant execute on function record_assistant_tokens(uuid, bigint, bigint) to service_role;
