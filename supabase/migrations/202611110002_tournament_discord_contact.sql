-- Add a private Discord contact field for tournament organizers.
-- Existing registrations remain valid; older rows receive an empty value.
alter table public.tournament_registrations
  add column if not exists discord_handle text not null default '';

alter table public.tournament_registrations
  drop constraint if exists tournament_registrations_discord_handle_length;

alter table public.tournament_registrations
  add constraint tournament_registrations_discord_handle_length
  check (char_length(discord_handle) <= 80);

notify pgrst, 'reload schema';
