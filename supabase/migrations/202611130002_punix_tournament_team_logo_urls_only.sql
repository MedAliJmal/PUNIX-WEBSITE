-- PUNIX TOURNAMENT TEAM LOGO URLS ONLY
-- New tournament team entries must reference an externally hosted HTTPS image.
-- Existing stored logos remain available for historical entries.

alter table public.tournament_registrations
  drop constraint if exists tournament_registrations_team_logo_url_https;

alter table public.tournament_registrations
  add constraint tournament_registrations_team_logo_url_https
  check (
    team_logo_url = ''
    or (
      char_length(team_logo_url) <= 500
      and team_logo_url ~* '^https://'
    )
  );

-- Prevent new uploads to the tournament team logo bucket.
drop policy if exists "Applicants upload their own tournament team logo" on storage.objects;

notify pgrst, 'reload schema';
