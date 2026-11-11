-- PUNIX TOURNAMENT MEMBER-ONLY DETAILS
-- Public visitors may see a minimal event directory. Full tournament details,
-- confirmed entries and match/bracket information require an authenticated account.
-- Existing tournament data and registration workflows are preserved.

create or replace view public.public_tournament_directory
with (security_barrier = true) as
select id, title, game_name, status
from public.tournaments
where status <> 'draft';

revoke all on public.public_tournament_directory from public, anon, authenticated;
grant select on public.public_tournament_directory to anon, authenticated;

-- The full-detail view remains available to signed-in PUNIX accounts only.
revoke all on public.public_tournaments from public, anon, authenticated;
grant select on public.public_tournaments to authenticated;

-- Do not expose entry lists or match/bracket data to anonymous visitors.
revoke all on public.public_tournament_registrations from public, anon, authenticated;
grant select on public.public_tournament_registrations to authenticated;

revoke all on public.public_tournament_matches from public, anon, authenticated;
grant select on public.public_tournament_matches to authenticated;

notify pgrst, 'reload schema';
