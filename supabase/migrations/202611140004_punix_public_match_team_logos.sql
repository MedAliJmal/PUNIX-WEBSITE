-- PUNIX: SHOW TEAM LOGOS IN PUBLIC MATCH CARDS
-- Preserve the existing public view column order, then append the new logo
-- columns. PostgreSQL requires new view columns to be appended on CREATE OR REPLACE.

create or replace view public.public_tournament_matches
with (security_barrier = true) as
select
  m.id,
  m.tournament_id,
  m.round_number,
  m.match_number,
  m.participant_a_id,
  m.participant_b_id,
  m.score_a,
  m.score_b,
  m.winner_registration_id,
  m.scheduled_at,
  m.status,
  a.display_name as participant_a_name,
  b.display_name as participant_b_name,
  m.bracket_section,
  m.bracket_label,
  m.best_of,
  a.team_logo_url as participant_a_logo_url,
  b.team_logo_url as participant_b_logo_url
from public.tournament_matches m
left join public.public_tournament_registrations a on a.id = m.participant_a_id
left join public.public_tournament_registrations b on b.id = m.participant_b_id;

revoke all on public.public_tournament_matches from public, anon, authenticated;
grant select on public.public_tournament_matches to anon, authenticated;

notify pgrst, 'reload schema';
