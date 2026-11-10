-- PUNIX PRIVATE GENDER FIELD
-- Gender is visible only to the account owner; it is intentionally excluded
-- from public_member_directory.
alter table public.profiles
  add column if not exists gender text;

alter table public.profiles
  drop constraint if exists profiles_gender_check;

alter table public.profiles
  add constraint profiles_gender_check
  check (gender is null or gender in ('male', 'female'));

-- The original member-approval migration revoked broad profile updates.
-- Explicitly allow members to edit their own gender, while keeping membership
-- status, division and directory visibility admin-controlled.
grant update (gender) on public.profiles to authenticated;

comment on column public.profiles.gender is
  'Private account attribute used to select the member default avatar; not exposed in the public directory.';

notify pgrst, 'reload schema';
