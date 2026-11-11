-- PUNIX TOURNAMENT CREATION SCHEMA COMPATIBILITY
-- Ensures every field submitted by the Admin Tournament Hub exists, even if
-- the earlier roster migration was skipped or only partially applied.

alter table public.tournaments
  add column if not exists min_team_size integer not null default 5,
  add column if not exists max_team_size integer not null default 5,
  add column if not exists max_substitutes integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tournaments_min_team_size_check'
      and conrelid = 'public.tournaments'::regclass
  ) then
    alter table public.tournaments
      add constraint tournaments_min_team_size_check
      check (min_team_size between 1 and 20);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tournaments_max_team_size_check'
      and conrelid = 'public.tournaments'::regclass
  ) then
    alter table public.tournaments
      add constraint tournaments_max_team_size_check
      check (max_team_size between min_team_size and 20);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tournaments_max_substitutes_check'
      and conrelid = 'public.tournaments'::regclass
  ) then
    alter table public.tournaments
      add constraint tournaments_max_substitutes_check
      check (max_substitutes between 0 and 10);
  end if;
end
$$;

notify pgrst, 'reload schema';
