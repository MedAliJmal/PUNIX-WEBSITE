-- PUNIX SECURITY HARDENING
-- 1) Restrict latest-update image deletion to administrators.
-- 2) Require a team's captain to submit team tournament registrations.
-- 3) Allow members to update only the read_at field on their own notifications.
--
-- Safe to apply after the existing PUNIX auth/roles, tournament and notification
-- migrations. Existing rows and stored files are not modified.

-- 1. Latest-update image deletion: match the admin-only upload/update policies.
drop policy if exists "PUNIX admins delete latest update images" on storage.objects;
create policy "PUNIX admins delete latest update images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'latest-update-images'
  and (select private.has_role('admin'))
);

-- 2. Team tournament registrations: only the registered captain may submit
-- an entry on behalf of their team. Solo registration remains unchanged.
drop policy if exists "PUNIX users register themselves" on public.tournament_registrations;

create policy "PUNIX users register themselves"
on public.tournament_registrations
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and status = 'pending'
  and reviewed_at is null
  and reviewed_by is null
  and exists (
    select 1
    from public.tournaments t
    where t.id = tournament_id
      and t.status = 'upcoming'
      and t.registration_open
      and (t.registration_deadline is null or t.registration_deadline > now())
      and (
        (t.entry_type = 'solo' and team_id is null)
        or (
          t.entry_type = 'team'
          and team_id is not null
          and private.is_team_captain(
            team_id,
            (select auth.uid()),
            t.game_name
          )
        )
      )
  )
);

-- 3. Notification inbox: retain row-level ownership checks, but grant only
-- column-level UPDATE permission for read_at. Members cannot rewrite the
-- notification title, body, link, type, metadata, owner or creation time.
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

drop policy if exists "Members mark their own notifications read" on public.notifications;
create policy "Members mark their own notifications read"
on public.notifications
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

notify pgrst, 'reload schema';
