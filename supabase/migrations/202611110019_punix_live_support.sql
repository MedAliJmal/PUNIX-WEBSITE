-- PUNIX LIVE SUPPORT CHAT
-- Anonymous visitors receive a random bearer token. Only its SHA-256 hash is stored.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  visitor_name text not null check (char_length(visitor_name) between 1 and 80),
  visitor_email text not null default '' check (char_length(visitor_email) <= 254),
  access_token_hash text not null,
  status text not null default 'open' check (status in ('open','closed')),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_conversations_activity_idx
  on public.support_conversations (status, last_message_at desc);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  sender_type text not null check (sender_type in ('visitor','admin')),
  sender_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists support_messages_conversation_idx
  on public.support_messages (conversation_id, created_at);

alter table public.support_conversations enable row level security;
alter table public.support_messages enable row level security;
revoke all on public.support_conversations from anon, authenticated;
revoke all on public.support_messages from anon, authenticated;
grant select, update on public.support_conversations to authenticated;
grant select, insert on public.support_messages to authenticated;

drop policy if exists "PUNIX admins read support conversations" on public.support_conversations;
create policy "PUNIX admins read support conversations" on public.support_conversations
  for select to authenticated using ((select private.has_role('admin')) or (select private.has_role('super_admin')));
drop policy if exists "PUNIX admins update support conversations" on public.support_conversations;
create policy "PUNIX admins update support conversations" on public.support_conversations
  for update to authenticated using ((select private.has_role('admin')) or (select private.has_role('super_admin')))
  with check ((select private.has_role('admin')) or (select private.has_role('super_admin')));
drop policy if exists "PUNIX admins read support messages" on public.support_messages;
create policy "PUNIX admins read support messages" on public.support_messages
  for select to authenticated using ((select private.has_role('admin')) or (select private.has_role('super_admin')));
drop policy if exists "PUNIX admins send support messages" on public.support_messages;
create policy "PUNIX admins send support messages" on public.support_messages
  for insert to authenticated with check (
    sender_type = 'admin' and sender_id = auth.uid()
    and ((select private.has_role('admin')) or (select private.has_role('super_admin')))
  );

create or replace function public.punix_support_start(
  p_name text, p_email text, p_body text, p_access_token text
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if coalesce(length(trim(p_name)),0) not between 1 and 80
     or coalesce(length(trim(p_email)),0) > 254
     or coalesce(length(trim(p_body)),0) not between 1 and 2000
     or coalesce(length(p_access_token),0) < 32 then
    raise exception 'Please check your name, email and message.';
  end if;
  insert into public.support_conversations(visitor_name, visitor_email, access_token_hash)
  values (trim(p_name), coalesce(trim(p_email),''), encode(extensions.digest(convert_to(p_access_token,'UTF8'),'sha256'),'hex'))
  returning id into v_id;
  insert into public.support_messages(conversation_id, sender_type, body)
  values (v_id, 'visitor', trim(p_body));
  return v_id;
end;
$$;

create or replace function public.punix_support_send(
  p_conversation_id uuid, p_access_token text, p_body text
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare v_message_id uuid;
begin
  if coalesce(length(trim(p_body)),0) not between 1 and 2000 then
    raise exception 'Message must contain between 1 and 2000 characters.';
  end if;
  if not exists (
    select 1 from public.support_conversations c
    where c.id=p_conversation_id and c.status='open'
      and c.access_token_hash=encode(extensions.digest(convert_to(coalesce(p_access_token,''),'UTF8'),'sha256'),'hex')
  ) then raise exception 'This support conversation is unavailable.'; end if;
  insert into public.support_messages(conversation_id, sender_type, body)
  values (p_conversation_id, 'visitor', trim(p_body)) returning id into v_message_id;
  update public.support_conversations set last_message_at=now(), updated_at=now()
  where id=p_conversation_id;
  return v_message_id;
end;
$$;

create or replace function public.punix_support_history(
  p_conversation_id uuid, p_access_token text
) returns table(id uuid, sender_type text, body text, created_at timestamptz)
language plpgsql security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.support_conversations c
    where c.id=p_conversation_id
      and c.access_token_hash=encode(extensions.digest(convert_to(coalesce(p_access_token,''),'UTF8'),'sha256'),'hex')
  ) then raise exception 'This support conversation could not be found.'; end if;
  return query
    select m.id,m.sender_type,m.body,m.created_at
    from public.support_messages m
    where m.conversation_id=p_conversation_id
    order by m.created_at asc limit 300;
end;
$$;

revoke all on function public.punix_support_start(text,text,text,text) from public;
revoke all on function public.punix_support_send(uuid,text,text) from public;
revoke all on function public.punix_support_history(uuid,text) from public;
grant execute on function public.punix_support_start(text,text,text,text) to anon, authenticated;
grant execute on function public.punix_support_send(uuid,text,text) to anon, authenticated;
grant execute on function public.punix_support_history(uuid,text) to anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.support_conversations;
exception when duplicate_object then null;
when undefined_object then null;
end $$;

notify pgrst, 'reload schema';
