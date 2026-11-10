-- PUNIX TEAMS + ROSTERS
-- Run once in Supabase SQL Editor after the existing auth/roles and member-directory migrations.

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  team_name text not null check (char_length(btrim(team_name)) between 2 and 80),
  game_name text not null check (char_length(btrim(game_name)) between 2 and 60),
  division text not null default 'open' check (division in ('men','women','mixed','open')),
  status text not null default 'active' check (status in ('active','recruiting','inactive')),
  logo_url text not null default '' check (logo_url = '' or logo_url ~* '^https://'),
  description text not null default '' check (char_length(description) <= 500),
  display_order integer not null default 0 check (display_order between 0 and 999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_name, team_name)
);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  member_role text not null default 'player' check (member_role in ('captain','player','coach','manager','substitute')),
  display_order integer not null default 0 check (display_order between 0 and 999),
  created_at timestamptz not null default now(),
  unique (team_id, user_id)
);

create index if not exists teams_game_status_order_idx on public.teams(game_name, status, display_order);
create index if not exists team_members_team_order_idx on public.team_members(team_id, display_order);

alter table public.teams enable row level security;
alter table public.team_members enable row level security;
revoke all on public.teams, public.team_members from public, anon, authenticated;
grant select, insert, update, delete on public.teams, public.team_members to authenticated;

drop policy if exists "PUNIX admins manage teams" on public.teams;
create policy "PUNIX admins manage teams" on public.teams
for all to authenticated
using ((select private.has_role('admin')))
with check ((select private.has_role('admin')));

drop policy if exists "PUNIX admins manage team members" on public.team_members;
create policy "PUNIX admins manage team members" on public.team_members
for all to authenticated
using ((select private.has_role('admin')))
with check ((select private.has_role('admin')));

-- Public-safe projections: expose only published teams and the selected roster fields.
create or replace view public.public_teams
with (security_barrier = true)
as
select id, team_name, game_name, division, status, logo_url, description, display_order, created_at
from public.teams
where status in ('active','recruiting');

create or replace view public.public_team_roster
with (security_barrier = true)
as
select tm.team_id, p.id as member_id, p.display_name, p.avatar_url, tm.member_role, tm.display_order
from public.team_members tm
join public.teams t on t.id = tm.team_id
join public.profiles p on p.id = tm.user_id
where t.status in ('active','recruiting');

revoke all on public.public_teams, public.public_team_roster from public, anon, authenticated;
grant select on public.public_teams, public.public_team_roster to anon, authenticated;

notify pgrst, 'reload schema';
