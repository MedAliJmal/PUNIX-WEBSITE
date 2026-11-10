-- PUNIX AUTH + ROLE SECURITY
-- Run in Supabase SQL Editor. Keep the private schema out of the exposed API schemas.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'PUNIX Member' check (char_length(display_name) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'admin', 'super_admin')),
  created_at timestamptz not null default now()
);

-- This table is intentionally in a non-exposed schema. Add approved admin emails here.
create table if not exists private.admin_whitelist (
  email text primary key check (email = lower(btrim(email))),
  role text not null check (role in ('admin', 'super_admin')),
  added_at timestamptz not null default now(),
  added_by uuid null references auth.users(id) on delete set null
);

create table if not exists public.partnership_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  creator_name text not null check (char_length(creator_name) between 2 and 80),
  platform text not null check (platform in ('Kick', 'Twitch', 'YouTube', 'TikTok', 'Other')),
  channel_url text not null check (channel_url ~* '^https://'),
  game_or_category text not null check (char_length(game_or_category) between 2 and 80),
  audience_size text not null check (char_length(audience_size) between 1 and 40),
  message text not null default '' check (char_length(message) <= 1500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_note text not null default '' check (char_length(admin_note) <= 1500),
  reviewed_by uuid null references auth.users(id) on delete set null,
  reviewed_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists partnership_applications_user_id_idx on public.partnership_applications(user_id);
create index if not exists partnership_applications_status_idx on public.partnership_applications(status);

-- Role check helper: safe for RLS because it has a pinned empty search_path and no user-controlled inputs.
create or replace function private.has_role(required_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = (select auth.uid())
      and (
        r.role = required_role
        or (required_role = 'admin' and r.role = 'super_admin')
      )
  );
$$;
revoke all on function private.has_role(text) from public, anon;
grant execute on function private.has_role(text) to authenticated;

-- On signup, create the profile and assign only the role approved in the private whitelist.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  approved_role text;
  safe_name text;
begin
  select w.role into approved_role
  from private.admin_whitelist w
  where w.email = lower(btrim(new.email));

  safe_name := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, 'PUNIX Member'), '@', 1));
  safe_name := left(safe_name, 60);

  insert into public.profiles (id, display_name)
  values (new.id, safe_name)
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, coalesce(approved_role, 'member'))
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_punix on auth.users;
create trigger on_auth_user_created_punix
after insert on auth.users
for each row execute function private.handle_new_user();

-- Profiles: users can read/update only their own profile. Role is stored separately and is never client-editable.
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select, update on public.profiles to authenticated;
drop policy if exists "Members read own profile; admins read all" on public.profiles;
create policy "Members read own profile; admins read all" on public.profiles
for select to authenticated
using (id = (select auth.uid()) or (select private.has_role('admin')));
drop policy if exists "Members update own profile" on public.profiles;
create policy "Members update own profile" on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- Users can inspect their own role only. No client writes are granted.
alter table public.user_roles enable row level security;
revoke all on public.user_roles from anon, authenticated;
grant select on public.user_roles to authenticated;
drop policy if exists "Users read own role; admins read all roles" on public.user_roles;
create policy "Users read own role; admins read all roles" on public.user_roles
for select to authenticated
using (user_id = (select auth.uid()) or (select private.has_role('admin')));

-- Partnership applications: members submit and view their own; admins review all.
alter table public.partnership_applications enable row level security;
revoke all on public.partnership_applications from anon, authenticated;
grant select, insert on public.partnership_applications to authenticated;
grant update (status, admin_note, reviewed_by, reviewed_at) on public.partnership_applications to authenticated;
drop policy if exists "Members see own applications; admins see all" on public.partnership_applications;
create policy "Members see own applications; admins see all" on public.partnership_applications
for select to authenticated
using (user_id = (select auth.uid()) or (select private.has_role('admin')));
drop policy if exists "Members submit own applications" on public.partnership_applications;
create policy "Members submit own applications" on public.partnership_applications
for insert to authenticated
with check (user_id = (select auth.uid()) and status = 'pending' and admin_note = '' and reviewed_by is null and reviewed_at is null);
drop policy if exists "Admins review applications" on public.partnership_applications;
create policy "Admins review applications" on public.partnership_applications
for update to authenticated
using ((select private.has_role('admin')))
with check (
  (select private.has_role('admin'))
  and reviewed_by = (select auth.uid())
  and reviewed_at is not null
  and status in ('approved', 'rejected')
);

-- Prevent browser clients from changing roles or the private whitelist.
revoke all on table private.admin_whitelist from public, anon, authenticated;
revoke all on table public.user_roles from anon, authenticated;
grant select on public.user_roles to authenticated;

-- IMPORTANT: Add founder addresses below after running this migration, before those founders sign up.
-- Replace the examples with real addresses and run the INSERT separately.
-- insert into private.admin_whitelist (email, role) values
--   ('founder1@example.com', 'super_admin'),
--   ('founder2@example.com', 'super_admin');

-- To promote an already-registered, whitelisted account, run a controlled SQL statement:
-- insert into public.user_roles (user_id, role)
-- select u.id, w.role
-- from auth.users u
-- join private.admin_whitelist w on w.email = lower(btrim(u.email))
-- where w.email = lower(btrim('founder@example.com'))
-- on conflict (user_id) do update set role = excluded.role;
