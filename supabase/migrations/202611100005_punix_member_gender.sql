-- PUNIX REQUIRED GENDER FIELD
-- Signup collects gender as auth user metadata; profile.js persists it to this column.
-- Existing accounts remain valid and can choose a value when editing their profile.

alter table public.profiles
  add column if not exists gender text;

alter table public.profiles
  drop constraint if exists profiles_gender_check;

alter table public.profiles
  add constraint profiles_gender_check
  check (gender is null or gender in ('male', 'female'));

-- Permit members to update their own gender while keeping membership controls protected.
grant update (gender) on public.profiles to authenticated;

comment on column public.profiles.gender is
  'Member-selected gender: male or female. Required by the account creation form.';

notify pgrst, 'reload schema';
