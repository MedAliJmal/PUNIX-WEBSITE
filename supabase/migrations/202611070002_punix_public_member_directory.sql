-- PUNIX PUBLIC MEMBER DIRECTORY
-- Run once in Supabase SQL Editor.
-- Members explicitly opt in to public listing. Only safe profile fields are exposed.

alter table public.profiles
  add column if not exists avatar_url text not null default '',
  add column if not exists bio text not null default '',
  add column if not exists twitch_url text not null default '',
  add column if not exists kick_url text not null default '',
  add column if not exists youtube_url text not null default '',
  add column if not exists tiktok_url text not null default '',
  add column if not exists is_public boolean not null default false,
  add column if not exists directory_division text not null default 'creators';

alter table public.profiles
  alter column is_public set default false,
  alter column directory_division set default 'creators';

alter table public.profiles
  drop constraint if exists profiles_directory_division_check;

alter table public.profiles
  add constraint profiles_directory_division_check
  check (directory_division in ('creators', 'competitive'));

-- Public-safe view: never expose email, auth metadata, roles, or private application data.
drop view if exists public.public_member_directory;
create view public.public_member_directory
with (security_barrier = true)
as
select
  p.id,
  p.display_name,
  p.avatar_url,
  p.bio,
  p.twitch_url,
  p.kick_url,
  p.youtube_url,
  p.tiktok_url,
  p.directory_division,
  p.created_at
from public.profiles p
where p.is_public = true;

revoke all on public.public_member_directory from public, anon, authenticated;
grant select on public.public_member_directory to anon, authenticated;

-- Replace the old table-wide UPDATE grant with a safe column allowlist.
-- The user's own-row RLS policy still applies.
revoke update on public.profiles from authenticated;
grant update (
  display_name,
  avatar_url,
  bio,
  twitch_url,
  kick_url,
  youtube_url,
  tiktok_url,
  is_public,
  directory_division,
  updated_at
) on public.profiles to authenticated;

comment on view public.public_member_directory is
'Public PUNIX directory projection. Includes only members who opted in; excludes email and private account data.';

notify pgrst, 'reload schema';
