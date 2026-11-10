-- PUNIX MULTI-GAME TOURNAMENT HUB
-- Run once in Supabase SQL Editor after the existing PUNIX auth, member and team migrations.
create table if not exists public.tournaments (
 id uuid primary key default gen_random_uuid(),
 title text not null check(char_length(btrim(title)) between 3 and 120),
 game_name text not null check(char_length(btrim(game_name)) between 2 and 60),
 format text not null default 'single_elimination' check(format in ('single_elimination','double_elimination','round_robin','swiss','custom')),
 entry_type text not null default 'team' check(entry_type in ('solo','team')),
 status text not null default 'draft' check(status in ('draft','upcoming','live','completed','cancelled')),
 registration_open boolean not null default false,
 max_participants integer null check(max_participants is null or max_participants between 2 and 512),
 starts_at timestamptz null, ends_at timestamptz null, registration_deadline timestamptz null,
 prize_pool text not null default '' check(char_length(prize_pool)<=120),
 description text not null default '' check(char_length(description)<=1200),
 rules text not null default '' check(char_length(rules)<=6000),
 created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(ends_at is null or starts_at is null or ends_at>=starts_at)
);
create table if not exists public.tournament_registrations (
 id uuid primary key default gen_random_uuid(),
 tournament_id uuid not null references public.tournaments(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 team_id uuid null references public.teams(id) on delete set null,
 in_game_name text not null check(char_length(btrim(in_game_name)) between 2 and 60),
 status text not null default 'pending' check(status in ('pending','confirmed','rejected','withdrawn')),
 created_at timestamptz not null default now(), reviewed_at timestamptz null,
 reviewed_by uuid null references auth.users(id) on delete set null,
 unique(tournament_id,user_id)
);
create unique index if not exists tournament_registrations_team_unique on public.tournament_registrations(tournament_id,team_id) where team_id is not null;
create index if not exists tournament_registrations_tournament_status_idx on public.tournament_registrations(tournament_id,status,created_at);
create table if not exists public.tournament_matches (
 id uuid primary key default gen_random_uuid(),
 tournament_id uuid not null references public.tournaments(id) on delete cascade,
 round_number integer not null check(round_number between 1 and 16),
 match_number integer not null check(match_number between 1 and 512),
 participant_a_id uuid null references public.tournament_registrations(id) on delete set null,
 participant_b_id uuid null references public.tournament_registrations(id) on delete set null,
 score_a integer null check(score_a is null or score_a between 0 and 999),
 score_b integer null check(score_b is null or score_b between 0 and 999),
 winner_registration_id uuid null references public.tournament_registrations(id) on delete set null,
 scheduled_at timestamptz null,
 status text not null default 'scheduled' check(status in ('scheduled','live','completed')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(tournament_id,round_number,match_number),
 check(participant_a_id is null or participant_b_id is null or participant_a_id<>participant_b_id)
);
create index if not exists tournament_matches_order_idx on public.tournament_matches(tournament_id,round_number,match_number);
alter table public.tournaments enable row level security;
alter table public.tournament_registrations enable row level security;
alter table public.tournament_matches enable row level security;
revoke all on public.tournaments,public.tournament_registrations,public.tournament_matches from public,anon,authenticated;
grant select,insert,update,delete on public.tournaments,public.tournament_registrations,public.tournament_matches to authenticated;
drop policy if exists "PUNIX admins manage tournaments" on public.tournaments;
create policy "PUNIX admins manage tournaments" on public.tournaments for all to authenticated using((select private.has_role('admin'))) with check((select private.has_role('admin')));
create or replace function private.is_team_captain(p_team_id uuid,p_user_id uuid,p_game_name text)
returns boolean language sql stable security definer set search_path=''
as $
 select exists(select 1 from public.teams tm join public.team_members m on m.team_id=tm.id
  where tm.id=p_team_id and lower(tm.game_name)=lower(p_game_name) and tm.status in('active','recruiting')
  and m.user_id=p_user_id and m.member_role='captain');
$;
revoke all on function private.is_team_captain(uuid,uuid,text) from public,anon;
grant execute on function private.is_team_captain(uuid,uuid,text) to authenticated;

drop policy if exists "PUNIX users register themselves" on public.tournament_registrations;
create policy "PUNIX users register themselves" on public.tournament_registrations for insert to authenticated with check(
 user_id=(select auth.uid()) and status='pending' and reviewed_at is null and reviewed_by is null and exists(
  select 1 from public.tournaments t where t.id=tournament_id and t.status='upcoming' and t.registration_open
  and(t.registration_deadline is null or t.registration_deadline>now())
  and((t.entry_type='solo' and team_id is null) or(t.entry_type='team' and team_id is not null and private.is_team_captain(team_id,(select auth.uid()),t.game_name)))
 )
);
drop policy if exists "Users read own tournament entries; admins read all" on public.tournament_registrations;
create policy "Users read own tournament entries; admins read all" on public.tournament_registrations for select to authenticated using(user_id=(select auth.uid()) or(select private.has_role('admin')));
drop policy if exists "Users withdraw own pending tournament entries" on public.tournament_registrations;
create policy "Users withdraw own pending tournament entries" on public.tournament_registrations for update to authenticated using(user_id=(select auth.uid()) and status='pending') with check(user_id=(select auth.uid()) and status='withdrawn');
drop policy if exists "PUNIX admins manage tournament registrations" on public.tournament_registrations;
create policy "PUNIX admins manage tournament registrations" on public.tournament_registrations for all to authenticated using((select private.has_role('admin'))) with check((select private.has_role('admin')));
drop policy if exists "PUNIX admins manage tournament matches" on public.tournament_matches;
create policy "PUNIX admins manage tournament matches" on public.tournament_matches for all to authenticated using((select private.has_role('admin'))) with check((select private.has_role('admin')));
create or replace view public.public_tournaments with(security_barrier=true) as
select id,title,game_name,format,entry_type,status,registration_open,max_participants,starts_at,ends_at,registration_deadline,prize_pool,description,rules,created_at from public.tournaments where status<>'draft';
create or replace view public.public_tournament_registrations with(security_barrier=true) as
select r.id,r.tournament_id,r.team_id,r.in_game_name,r.status,r.created_at,case when r.team_id is not null then tm.team_name else r.in_game_name end as display_name
from public.tournament_registrations r left join public.teams tm on tm.id=r.team_id where r.status='confirmed';
create or replace view public.public_tournament_matches with(security_barrier=true) as
select m.id,m.tournament_id,m.round_number,m.match_number,m.participant_a_id,m.participant_b_id,m.score_a,m.score_b,m.winner_registration_id,m.scheduled_at,m.status,a.display_name as participant_a_name,b.display_name as participant_b_name
from public.tournament_matches m left join public.public_tournament_registrations a on a.id=m.participant_a_id left join public.public_tournament_registrations b on b.id=m.participant_b_id;
revoke all on public.public_tournaments,public.public_tournament_registrations,public.public_tournament_matches from public,anon,authenticated;
grant select on public.public_tournaments,public.public_tournament_registrations,public.public_tournament_matches to anon,authenticated;
notify pgrst,'reload schema';
