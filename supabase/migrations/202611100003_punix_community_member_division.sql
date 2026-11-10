-- PUNIX COMMUNITY MEMBER AS THE DEFAULT DIRECTORY DIVISION.
-- Existing divisions are preserved; only future profiles default to community.

alter table public.profiles
  alter column directory_division set default 'community';

alter table public.profiles
  drop constraint if exists profiles_directory_division_check;

alter table public.profiles
  add constraint profiles_directory_division_check
  check (directory_division in ('community', 'creators', 'competitive'));

-- Normalize any legacy NULL values without changing existing creator/player assignments.
update public.profiles
set directory_division = 'community'
where directory_division is null;

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

  if p_status is null or p_status not in ('approved', 'rejected', 'pending') then
    raise exception 'Invalid membership status'
      using errcode = '22023';
  end if;

  if p_status = 'approved' and (p_division is null or p_division not in ('community', 'creators', 'competitive')) then
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

comment on column public.profiles.directory_division is
  'PUNIX directory category: community, creators (streamers), or competitive players.';

notify pgrst, 'reload schema';
