-- PUNIX: tournament default series length and per-match BO1/BO3/BO5.
alter table public.tournaments
  add column if not exists best_of integer not null default 1;
alter table public.tournament_matches
  add column if not exists best_of integer;

update public.tournament_matches m
set best_of=coalesce(t.best_of,1)
from public.tournaments t
where t.id=m.tournament_id and m.best_of is null;

alter table public.tournament_matches
  alter column best_of set default 1,
  alter column best_of set not null;

alter table public.tournaments
  drop constraint if exists tournaments_best_of_check;
alter table public.tournaments
  add constraint tournaments_best_of_check check (best_of in (1,3,5));

alter table public.tournament_matches
  drop constraint if exists tournament_matches_best_of_check;
alter table public.tournament_matches
  add constraint tournament_matches_best_of_check check (best_of in (1,3,5));

create or replace function private.set_punix_match_series_default()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_best_of integer;
begin
  if new.best_of is null then
    select t.best_of into v_best_of
    from public.tournaments t
    where t.id=new.tournament_id;
    new.best_of:=coalesce(v_best_of,1);
  end if;
  return new;
end;
$$;
revoke all on function private.set_punix_match_series_default() from public,anon,authenticated;
drop trigger if exists punix_match_series_default on public.tournament_matches;
create trigger punix_match_series_default
before insert on public.tournament_matches
for each row execute function private.set_punix_match_series_default();

create or replace view public.public_tournament_matches with(security_barrier=true) as
select m.id,m.tournament_id,m.round_number,m.match_number,m.participant_a_id,m.participant_b_id,
       m.score_a,m.score_b,m.winner_registration_id,m.scheduled_at,m.status,
       a.display_name as participant_a_name,b.display_name as participant_b_name,
       m.bracket_section,m.bracket_label,m.best_of
from public.tournament_matches m
left join public.public_tournament_registrations a on a.id=m.participant_a_id
left join public.public_tournament_registrations b on b.id=m.participant_b_id;

revoke all on public.public_tournament_matches from public,anon,authenticated;
grant select on public.public_tournament_matches to anon,authenticated;
notify pgrst,'reload schema';
