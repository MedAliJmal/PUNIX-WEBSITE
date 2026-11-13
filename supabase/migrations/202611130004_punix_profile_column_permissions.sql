-- PUNIX PROFILE PERMISSIONS HARDENING
-- Members may edit their own public profile fields, but must not approve themselves
-- or alter admin-controlled membership metadata.

-- Remove the broad table-level UPDATE grant from authenticated users.
revoke update on table public.profiles from public, anon, authenticated;

-- Explicitly revoke any direct column-level grants on protected membership fields.
revoke update (
  membership_status,
  is_public,
  directory_division,
  membership_reviewed_at,
  membership_reviewed_by
) on table public.profiles from public, anon, authenticated;

-- Allow members to edit only the fields exposed by the member profile editor.
grant update (
  display_name,
  gender,
  avatar_url,
  bio,
  twitch_url,
  kick_url,
  youtube_url,
  tiktok_url,
  updated_at
) on table public.profiles to authenticated;

-- The existing RLS policy still restricts updates to the signed-in user's own row.
notify pgrst, 'reload schema';
