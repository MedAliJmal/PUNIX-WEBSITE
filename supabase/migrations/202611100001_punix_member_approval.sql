-- PUNIX MEMBER APPROVAL
-- Existing profiles are grandfathered as approved. New signup-trigger-created
-- profiles receive the default status 'pending'.
-- Only admins can review membership through the protected RPC below.

alter table public.profiles
  add column if not exists membership_status text not null default 'pending',
  add column if not exists membership_reviewed_at timestamptz,
  add column if not exists membership_reviewed_by uuid references auth.users(id) on delete set null;

alter table public.profiles
  drop constraint if exists profiles_membership_status_check;

alter table public.profiles
  add constraint profiles_membership_status_check
  check (membership_status in ('pending', 'approved', 'rejected'));

-- The only existing PUNIX member is the founder. Preserve all existing profile
-- visibility/division settings, but grandfather existing profiles as approved.
update public.profiles
set membership_status = 'approved'
where membership_status = 'pending';

create index if not exists profiles_membership_status_idx
  on public.profiles (membership_status);

-- Authenticated members may edit personal/profile content only.
-- Membership status, directory visibility, and division are admin-controlled.
revoke update on public.profiles from authenticated;
revoke update (is_public, directory_division, membership_status, membership_reviewed_at, membership_reviewed_by)
  on public.profiles from authenticated;
grant update (
  display_name,
  avatar_url,
  bio,
  twitch_url,
  kick_url,
  youtube_url,
  tiktok_url,
  updated_at
) on public.profiles to authenticated;

-- Admin-only review operation. The private.has_role('admin') helper also
-- recognizes super_admin accounts, as defined by the existing role migration.
create or replace function public.admin_review_member(
  p_user_id uuid,
  p_status text,
  p_division text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce((select private.has_role('admin')), false) then
    raise exception 'Administrator access required'
      using errcode = '42501';
  end if;

  if p_status not in ('approved', 'rejected', 'pending') then
    raise exception 'Invalid membership status'
      using errcode = '22023';
  end if;

  if p_status = 'approved' and p_division not in ('creators', 'competitive') then
    raise exception 'Choose a valid division when approving a member'
      using errcode = '22023';
  end if;

  update public.profiles
  set membership_status = p_status,
      directory_division = case
        when p_status = 'approved' then p_division
        else directory_division
      end,
      is_public = (p_status = 'approved'),
      membership_reviewed_at = now(),
      membership_reviewed_by = (select auth.uid()),
      updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'Profile not found'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_review_member(uuid, text, text) from public, anon;
grant execute on function public.admin_review_member(uuid, text, text) to authenticated;

-- Keep the existing public-safe projection unchanged, but expose approved
-- members only. Existing opt-in visibility is preserved.
create or replace view public.public_member_directory
with (security_barrier = true)
as
select
  p.id,
  p.display_name,
  p.avatar_url,
  p.bio,
  p.twitch_url,
  p.kick_url,
  p.youtube_url,
  p.tiktok_url,
  p.directory_division,
  p.created_at
from public.profiles p
where p.is_public = true
  and p.membership_status = 'approved';

revoke all on public.public_member_directory from public, anon, authenticated;
grant select on public.public_member_directory to anon, authenticated;

comment on column public.profiles.membership_status is
  'PUNIX membership review state: pending, approved, or rejected.';
comment on function public.admin_review_member(uuid, text, text) is
  'Admin-only RPC for approving, rejecting, or returning a PUNIX membership to pending.';

notify pgrst, 'reload schema';
