-- Allow a rejected applicant to request a fresh membership review.
-- Only the signed-in owner of a rejected profile can call this function.

create or replace function public.reapply_membership()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  update public.profiles
  set membership_status = 'pending',
      is_public = false,
      membership_reviewed_at = null,
      membership_reviewed_by = null,
      updated_at = now()
  where id = v_user_id
    and membership_status = 'rejected';

  if not found then
    raise exception 'Only rejected applicants can reapply'
      using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.reapply_membership() from public, anon;
grant execute on function public.reapply_membership() to authenticated;

comment on function public.reapply_membership() is
  'Allows the authenticated owner of a rejected PUNIX profile to resubmit for membership review.';
