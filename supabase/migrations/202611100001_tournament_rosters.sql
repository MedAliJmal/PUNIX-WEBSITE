-- PUNIX TOURNAMENT TEAM ROSTERS
-- Run once in Supabase SQL Editor after the independent-team registration migration (004).
alter table public.tournaments
  add column if not exists min_team_size integer not null default 5,
  add column if not exists max_team_size integer not null default 5,
  add column if not exists max_substitutes integer not null default 1;

alter table public.tournament_registrations
  add column if not exists roster jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='tournaments_min_team_size_check' and conrelid='public.tournaments'::regclass) then
    alter table public.tournaments add constraint tournaments_min_team_size_check check(min_team_size between 1 and 20);
  end if;
  if not exists (select 1 from pg_constraint where conname='tournaments_max_team_size_check' and conrelid='public.tournaments'::regclass) then
    alter table public.tournaments add constraint tournaments_max_team_size_check check(max_team_size between min_team_size and 20);
  end if;
  if not exists (select 1 from pg_constraint where conname='tournaments_max_substitutes_check' and conrelid='public.tournaments'::regclass) then
    alter table public.tournaments add constraint tournaments_max_substitutes_check check(max_substitutes between 0 and 10);
  end if;
  if not exists (select 1 from pg_constraint where conname='tournament_registrations_roster_array_check' and conrelid='public.tournament_registrations'::regclass) then
    alter table public.tournament_registrations add constraint tournament_registrations_roster_array_check check(jsonb_typeof(roster)='array');
  end if;
end $$;

create or replace function private.validate_punix_tournament_roster()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_entry_type text;
  v_min integer;
  v_max integer;
  v_sub_max integer;
  v_starters integer;
  v_substitutes integer;
  v_member jsonb;
begin
  select t.entry_type,t.min_team_size,t.max_team_size,t.max_substitutes
    into v_entry_type,v_min,v_max,v_sub_max
  from public.tournaments t where t.id=new.tournament_id;

  if not found then
    raise exception 'Tournament not found.';
  end if;

  if jsonb_typeof(new.roster) <> 'array' then
    raise exception 'Team roster must be a list of players.';
  end if;

  if v_entry_type='solo' then
    if jsonb_array_length(new.roster) <> 0 then
      raise exception 'Solo tournament entries cannot include a team roster.';
    end if;
    return new;
  end if;

  if length(btrim(coalesce(new.team_name,''))) < 2 then
    raise exception 'Please provide a team name.';
  end if;

  v_starters := 1; -- The captain is the first starting player.
  v_substitutes := 0;

  for v_member in select value from jsonb_array_elements(new.roster)
  loop
    if jsonb_typeof(v_member) <> 'object'
      or coalesce(v_member->>'role','') not in ('starter','substitute')
      or length(btrim(coalesce(v_member->>'in_game_name',''))) not between 2 and 60
      or length(btrim(coalesce(v_member->>'discord_handle',''))) not between 2 and 80 then
      raise exception 'Each roster player needs a valid Discord username and in-game name.';
    end if;

    if v_member->>'role'='starter' then
      v_starters := v_starters + 1;
    else
      v_substitutes := v_substitutes + 1;
    end if;
  end loop;

  if v_starters < v_min or v_starters > v_max then
    raise exception 'This tournament requires between % and % starting players, including the captain.',v_min,v_max;
  end if;
  if v_substitutes > v_sub_max then
    raise exception 'This tournament allows up to % substitute players.',v_sub_max;
  end if;

  return new;
end;
$$;

revoke all on function private.validate_punix_tournament_roster() from public,anon,authenticated;
drop trigger if exists validate_punix_tournament_roster on public.tournament_registrations;
create trigger validate_punix_tournament_roster
before insert or update of tournament_id,team_name,roster
on public.tournament_registrations
for each row execute function private.validate_punix_tournament_roster();

create or replace view public.public_tournaments with(security_barrier=true) as
select id,title,game_name,format,entry_type,status,registration_open,max_participants,
       starts_at,ends_at,registration_deadline,prize_pool,description,rules,created_at,
       min_team_size,max_team_size,max_substitutes
from public.tournaments
where status<>'draft';

revoke all on public.public_tournaments from public,anon,authenticated;
grant select on public.public_tournaments to anon,authenticated;
notify pgrst,'reload schema';
