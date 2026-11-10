-- Public PUNIX events accept independently formed teams.
-- PUNIX accounts remain mandatory; team affiliation with PUNIX is not.
alter table public.tournament_registrations
  add column if not exists team_name text not null default '';

alter table public.tournament_registrations
  drop constraint if exists tournament_registrations_team_name_length;
alter table public.tournament_registrations
  add constraint tournament_registrations_team_name_length
  check (char_length(btrim(team_name)) <= 80);

create unique index if not exists tournament_registrations_team_name_unique
  on public.tournament_registrations (tournament_id, lower(btrim(team_name)))
  where team_name <> '';

drop policy if exists "PUNIX users register themselves" on public.tournament_registrations;
create policy "PUNIX users register themselves"
on public.tournament_registrations
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and status = 'pending'
  and reviewed_at is null
  and reviewed_by is null
  and exists (
    select 1 from public.tournaments t
    where t.id = tournament_id
      and t.status = 'upcoming'
      and t.registration_open
      and (t.registration_deadline is null or t.registration_deadline > now())
      and (
        (t.entry_type = 'solo' and team_id is null and team_name = '')
        or
        (t.entry_type = 'team' and team_id is null
          and char_length(btrim(team_name)) between 2 and 80)
        or
        (t.entry_type = 'team' and team_id is not null
          and team_name = ''
          and private.is_team_captain(team_id, (select auth.uid()), t.game_name))
      )
  )
);

-- Rebuild these two dependent public views so the new column can be
-- added without PostgreSQL treating it as a rename of an existing column.
drop view if exists public.public_tournament_matches;
drop view if exists public.public_tournament_registrations;

create view public.public_tournament_registrations with (security_barrier=true) as
select r.id, r.tournament_id, r.team_id, r.in_game_name,
       r.status, r.created_at,
       case
         when r.team_name <> '' then r.team_name
         when r.team_id is not null then tm.team_name
         else r.in_game_name
       end as display_name,
       r.team_name
from public.tournament_registrations r
left join public.teams tm on tm.id = r.team_id
where r.status = 'confirmed';

create view public.public_tournament_matches with (security_barrier=true) as
select m.id,m.tournament_id,m.round_number,m.match_number,
       m.participant_a_id,m.participant_b_id,m.score_a,m.score_b,
       m.winner_registration_id,m.scheduled_at,m.status,
       a.display_name as participant_a_name,
       b.display_name as participant_b_name
from public.tournament_matches m
left join public.public_tournament_registrations a on a.id=m.participant_a_id
left join public.public_tournament_registrations b on b.id=m.participant_b_id;

revoke all on public.public_tournament_registrations, public.public_tournament_matches
  from public, anon, authenticated;
grant select on public.public_tournament_registrations, public.public_tournament_matches
  to anon, authenticated;

notify pgrst, 'reload schema';
