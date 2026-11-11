-- PUNIX TOURNAMENT ENTRY CANCELLATION AND REAPPLICATION
-- Admins can withdraw pending or confirmed entries without deleting history.
-- A captain may then submit a fresh application for the same tournament,
-- including reusing the same independent team name.

-- Replace the table-level one-entry-per-user constraint with an active-entry
-- constraint. Historical rejected/withdrawn rows remain in the table.
alter table public.tournament_registrations
  drop constraint if exists tournament_registrations_tournament_id_user_id_key;

create unique index if not exists tournament_registrations_one_active_user_entry
  on public.tournament_registrations (tournament_id, user_id)
  where status in ('pending', 'confirmed');

-- Independent team names are unique only while an entry is active.
drop index if exists public.tournament_registrations_team_name_unique;
create unique index tournament_registrations_team_name_unique
  on public.tournament_registrations (tournament_id, lower(btrim(team_name)))
  where team_name <> '' and status in ('pending', 'confirmed');

-- Public tournament views already expose confirmed entries only, so changing
-- a registration to 'withdrawn' removes it from the public lineup and bracket
-- names while retaining its registration and match history.
notify pgrst, 'reload schema';
