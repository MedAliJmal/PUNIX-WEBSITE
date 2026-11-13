-- PUNIX SUPPORT CHAT ABUSE PROTECTION
-- Enforce visitor message limits inside Postgres so direct API calls cannot bypass them.
-- Limits: 1,000 characters, at least 3 seconds between messages, at most 10 per minute,
-- and no identical message repeated within 30 seconds. Limits apply per authenticated account.

create index if not exists support_messages_visitor_rate_idx
  on public.support_messages (sender_id, created_at desc)
  where sender_type = 'visitor';

create or replace function public.punix_support_start(
  p_name text, p_email text, p_body text
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_user_id uuid;
  v_body text := trim(coalesce(p_body, ''));
  v_last_message_at timestamptz;
  v_recent_count integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'Sign in to contact PUNIX support.'; end if;

  if coalesce(length(trim(p_name)),0) not between 1 and 80
     or coalesce(length(trim(p_email)),0) > 254
     or length(v_body) not between 1 and 1000 then
    raise exception 'Please check your name, email and message. Messages must be 1,000 characters or fewer.';
  end if;

  -- Serialize concurrent sends from this account before checking its limits.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));

  select max(m.created_at), count(*)::integer
    into v_last_message_at, v_recent_count
    from public.support_messages m
   where m.sender_id = v_user_id
     and m.sender_type = 'visitor'
     and m.created_at > now() - interval '60 seconds';

  if v_last_message_at is not null and v_last_message_at > now() - interval '3 seconds' then
    raise exception 'Please wait a few seconds before sending another message.';
  end if;
  if v_recent_count >= 10 then
    raise exception 'You have reached the support message limit. Please try again in a minute.';
  end if;
  if exists (
    select 1 from public.support_messages m
     where m.sender_id = v_user_id
       and m.sender_type = 'visitor'
       and m.body = v_body
       and m.created_at > now() - interval '30 seconds'
  ) then
    raise exception 'Please do not send the same message repeatedly.';
  end if;

  insert into public.support_conversations(user_id, visitor_name, visitor_email)
  values (v_user_id, trim(p_name), coalesce(trim(p_email),''))
  returning id into v_id;

  insert into public.support_messages(conversation_id, sender_type, sender_id, body)
  values (v_id, 'visitor', v_user_id, v_body);

  return v_id;
end;
$$;

create or replace function public.punix_support_send(
  p_conversation_id uuid, p_body text
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_message_id uuid;
  v_user_id uuid;
  v_body text := trim(coalesce(p_body, ''));
  v_last_message_at timestamptz;
  v_recent_count integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'Sign in to use PUNIX support.'; end if;

  if length(v_body) not between 1 and 1000 then
    raise exception 'Message must contain between 1 and 1,000 characters.';
  end if;

  if not exists (
    select 1 from public.support_conversations c
    where c.id = p_conversation_id
      and c.user_id = v_user_id
      and c.status = 'open'
  ) then
    raise exception 'This support conversation is unavailable.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));

  select max(m.created_at), count(*)::integer
    into v_last_message_at, v_recent_count
    from public.support_messages m
   where m.sender_id = v_user_id
     and m.sender_type = 'visitor'
     and m.created_at > now() - interval '60 seconds';

  if v_last_message_at is not null and v_last_message_at > now() - interval '3 seconds' then
    raise exception 'Please wait a few seconds before sending another message.';
  end if;
  if v_recent_count >= 10 then
    raise exception 'You have reached the support message limit. Please try again in a minute.';
  end if;
  if exists (
    select 1 from public.support_messages m
     where m.sender_id = v_user_id
       and m.sender_type = 'visitor'
       and m.body = v_body
       and m.created_at > now() - interval '30 seconds'
  ) then
    raise exception 'Please do not send the same message repeatedly.';
  end if;

  insert into public.support_messages(conversation_id, sender_type, sender_id, body)
  values (p_conversation_id, 'visitor', v_user_id, v_body)
  returning id into v_message_id;

  update public.support_conversations
     set last_message_at = now(), updated_at = now()
   where id = p_conversation_id and user_id = v_user_id;

  return v_message_id;
end;
$$;

revoke all on function public.punix_support_start(text,text,text) from public, anon;
revoke all on function public.punix_support_send(uuid,text) from public, anon;
grant execute on function public.punix_support_start(text,text,text) to authenticated;
grant execute on function public.punix_support_send(uuid,text) to authenticated;

notify pgrst, 'reload schema';
