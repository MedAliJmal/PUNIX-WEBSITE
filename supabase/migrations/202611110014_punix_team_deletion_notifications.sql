-- PUNIX: notify every roster member when an admin deletes a team.
-- Runs BEFORE the team row is deleted, while its name and roster are still available.
-- Existing team_members cascade and tournament history behavior remain unchanged.

create or replace function private.notify_team_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications
    (user_id, notification_type, title, body, link, metadata)
  select
    tm.user_id,
    'team_deleted',
    'TEAM REMOVED',
    'The PUNIX team "' || old.team_name || '" has been removed. You are now free to join another team.',
    '/teams.html',
    jsonb_build_object(
      'team_id', old.id,
      'team_name', old.team_name,
      'game_name', old.game_name
    )
  from public.team_members tm
  where tm.team_id = old.id;

  return old;
end;
$$;

revoke all on function private.notify_team_deleted() from public, anon, authenticated;

drop trigger if exists punix_notify_team_deleted on public.teams;
create trigger punix_notify_team_deleted
  before delete on public.teams
  for each row
  execute function private.notify_team_deleted();

-- A team deletion has already notified every roster member above.
-- Skip the normal per-member cascade notifications to avoid duplicate
-- captain notifications when the team_members rows are cascade-deleted.
create or replace function private.notify_team_roster_change()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_team_id uuid; v_actor uuid; v_name text; v_body text;
begin
  v_team_id := case when tg_op = 'DELETE' then old.team_id else new.team_id end;
  v_actor := auth.uid();

  if tg_op = 'DELETE' and not exists (
    select 1 from public.teams t where t.id = v_team_id
  ) then
    return old;
  end if;

  select t.team_name into v_name from public.teams t where t.id = v_team_id;
  v_body := case when tg_op = 'INSERT' then 'A member was added to ' || coalesce(v_name,'your team') || '.'
                 when tg_op = 'DELETE' then 'A member was removed from ' || coalesce(v_name,'your team') || '.'
                 else 'A team member role or roster order changed for ' || coalesce(v_name,'your team') || '.' end;

  perform private.notify_team_captains(v_team_id, 'TEAM ROSTER UPDATED', v_body, 'team_roster', '/teams.html', v_actor);

  if tg_op = 'DELETE' then
    if old.member_role = 'captain' then
      insert into public.notifications(user_id,notification_type,title,body,link,metadata)
      values(old.user_id,'team_roster','TEAM ROLE UPDATED','Your captain role or team membership changed for '||coalesce(v_name,'your team')||'.','/teams.html',jsonb_build_object('team_id',v_team_id));
    end if;
  elsif tg_op = 'UPDATE' then
    if old.member_role = 'captain' and (new.member_role <> 'captain' or new.user_id <> old.user_id) then
      insert into public.notifications(user_id,notification_type,title,body,link,metadata)
      values(old.user_id,'team_roster','TEAM ROLE UPDATED','Your captain role or team membership changed for '||coalesce(v_name,'your team')||'.','/teams.html',jsonb_build_object('team_id',v_team_id));
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.notify_team_roster_change() from public, anon, authenticated;

notify pgrst, 'reload schema';
