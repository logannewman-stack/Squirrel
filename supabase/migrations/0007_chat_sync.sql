-- The conversation, on every device.
--
-- chat_messages has existed since 0001 and nothing has ever written to it. The
-- assistant's thread lived only in the browser that produced it, so asking
-- Squirrel something on a phone and then opening a laptop showed an empty
-- conversation — and the thread is not decoration: she resolves "move it an
-- hour later" against what was said before. A conversation that does not
-- follow you makes the pronoun mean nothing on the second device.
--
-- Same machinery as every other synced table: an updated_at the trigger keeps,
-- a deleted_at so clearing the chat propagates instead of resurrecting, and the
-- (user_id, updated_at) index the pull query actually uses.

alter table chat_messages add column if not exists updated_at timestamptz not null default now();
alter table chat_messages add column if not exists deleted_at timestamptz;

drop trigger if exists chat_messages_touch on chat_messages;
create trigger chat_messages_touch before update on chat_messages
  for each row execute function touch_updated_at();

create index if not exists chat_messages_sync_idx on chat_messages (user_id, updated_at);

-- Append-only in practice, so there is no conflict to resolve — a merge is a
-- union. The generic last-write-wins rule handles it correctly for free, since
-- a message never changes after it is written.
create or replace function pull_changes(since timestamptz)
returns jsonb
language sql security invoker stable set search_path = public as $$
  select jsonb_build_object(
    'cursor', (now() - interval '2 seconds'),
    'projects', coalesce((select jsonb_agg(to_jsonb(p)) from projects p
       where p.user_id = auth.uid() and p.updated_at > since), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(to_jsonb(t)) from tasks t
       where t.user_id = auth.uid() and t.updated_at > since), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e)) from events e
       where e.user_id = auth.uid() and e.updated_at > since), '[]'::jsonb),
    'sessions', coalesce((select jsonb_agg(to_jsonb(s)) from focus_sessions s
       where s.user_id = auth.uid() and s.updated_at > since), '[]'::jsonb),
    -- Bounded on purpose. The browser keeps the last 200 messages and a device
    -- that has been away for months does not need every one it missed — it
    -- needs the recent thread, which is all the assistant reads anyway.
    'chat', coalesce((select jsonb_agg(to_jsonb(c)) from (
       select * from chat_messages c
       where c.user_id = auth.uid() and c.updated_at > since
       order by c.created_at desc limit 200) c), '[]'::jsonb)
  )
$$;

comment on function pull_changes(timestamptz) is
  'Everything of the caller''s that changed since the given instant, including the assistant thread.';
