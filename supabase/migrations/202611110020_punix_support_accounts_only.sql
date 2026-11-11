-- PUNIX SUPPORT CHAT: REQUIRE AN AUTHENTICATED PUNIX ACCOUNT
-- Existing anonymous conversations remain admin-visible but are not exposed to visitors.
alter table public.support_conversations
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.support_conversations drop column if exists access_token_hash;

drop function if exists public.punix_support_start(text,text,text,text);
drop function if exists public.punix_support_send(uuid,text,text);
drop function if exists public.punix_support_history(uuid,text);

drop policy if exists "PUNIX users read own support conversations" on public.support_conversations;
create policy "PUNIX users read own support conversations"
  on public.support_conversations for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "PUNIX users read own support messages" on public.support_messages;
create policy "PUNIX users read own support messages"
  on public.support_messages for select to authenticated
  using (exists (
    select 1 from public.support_conversations c
    where c.id = support_messages.conversation_id
      and c.user_id = (select auth.uid())
  ));

create or replace function public.punix_support_start(
  p_name text, p_email text, p_body text
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare v_id uuid; v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'Sign in to contact PUNIX support.'; end if;
  if coalesce(length(trim(p_name)),0) not between 1 and 80
     or coalesce(length(trim(p_email)),0) > 254
     or coalesce(length(trim(p_body)),0) not between 1 and 2000 then
    raise exception 'Please check your name, email and message.';
  end if;
  insert into public.support_conversations(user_id, visitor_name, visitor_email)
  values (v_user_id, trim(p_name), coalesce(trim(p_email),''))
  returning id into v_id;
  insert into public.support_messages(conversation_id, sender_type, body)
  values (v_id, 'visitor', trim(p_body));
  return v_id;
end;
$$;

create or replace function public.punix_support_send(
  p_conversation_id uuid, p_body text
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare v_message_id uuid; v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'Sign in to use PUNIX support.'; end if;
  if coalesce(length(trim(p_body)),0) not between 1 and 2000 then
    raise exception 'Message must contain between 1 and 2000 characters.';
  end if;
  if not exists (
    select 1 from public.support_conversations c
    where c.id=p_conversation_id and c.user_id=v_user_id and c.status='open'
  ) then raise exception 'This support conversation is unavailable.'; end if;
  insert into public.support_messages(conversation_id, sender_type, sender_id, body)
  values (p_conversation_id, 'visitor', v_user_id, trim(p_body))
  returning id into v_message_id;
  update public.support_conversations set last_message_at=now(), updated_at=now()
  where id=p_conversation_id and user_id=v_user_id;
  return v_message_id;
end;
$$;

create or replace function public.punix_support_history(
  p_conversation_id uuid
) returns table(id uuid, sender_type text, body text, created_at timestamptz)
language plpgsql security definer
set search_path = ''
as $$
declare v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null or not exists (
    select 1 from public.support_conversations c
    where c.id=p_conversation_id and c.user_id=v_user_id
  ) then raise exception 'Sign in or select your own support conversation.'; end if;
  return query
    select m.id,m.sender_type,m.body,m.created_at
    from public.support_messages m
    where m.conversation_id=p_conversation_id
    order by m.created_at asc limit 300;
end;
$$;

revoke all on function public.punix_support_start(text,text,text) from public, anon;
revoke all on function public.punix_support_send(uuid,text) from public, anon;
revoke all on function public.punix_support_history(uuid) from public, anon;
grant execute on function public.punix_support_start(text,text,text) to authenticated;
grant execute on function public.punix_support_send(uuid,text) to authenticated;
grant execute on function public.punix_support_history(uuid) to authenticated;

notify pgrst, 'reload schema';
