-- PUNIX MEMBER NOTIFICATIONS
-- In-app notification inbox for event launches and team/captain activity.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_type text not null check (char_length(notification_type) between 2 and 60),
  title text not null check (char_length(title) between 2 and 120),
  body text not null default '' check (char_length(body) <= 500),
  link text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz null
);
create index if not exists notifications_user_created_idx
  on public.notifications(user_id, created_at desc);
create index if not exists notifications_user_unread_idx
  on public.notifications(user_id, created_at desc) where read_at is null;

alter table public.notifications enable row level security;
revoke all on public.notifications from public, anon, authenticated;
grant select, update on public.notifications to authenticated;
drop policy if exists "Members read their own notifications" on public.notifications;
create policy "Members read their own notifications"
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "Members mark their own notifications read" on public.notifications;
create policy "Members mark their own notifications read"
  on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
-- No client insert/delete permission: notifications are created only by trusted triggers.

create or replace function private.notify_tournament_launch()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_title text; v_body text;
begin
  if new.status = 'upcoming' then
    if tg_op = 'INSERT' then
      v_title := 'NEW PUNIX EVENT: ' || new.title;
      v_body := new.game_name || ' tournament is now announced. Open the event page for details and registration.';
      insert into public.notifications(user_id, notification_type, title, body, link, metadata)
      select p.id, 'event_launch', v_title, v_body,
             '/tournaments.html?id=' || new.id::text,
             jsonb_build_object('tournament_id', new.id, 'game_name', new.game_name)
      from public.profiles p;
    elsif old.status is distinct from new.status then
      v_title := 'NEW PUNIX EVENT: ' || new.title;
      v_body := new.game_name || ' tournament is now announced. Open the event page for details and registration.';
      insert into public.notifications(user_id, notification_type, title, body, link, metadata)
      select p.id, 'event_launch', v_title, v_body,
             '/tournaments.html?id=' || new.id::text,
             jsonb_build_object('tournament_id', new.id, 'game_name', new.game_name)
      from public.profiles p;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.notify_tournament_launch() from public, anon, authenticated;
drop trigger if exists punix_notify_tournament_launch on public.tournaments;
create trigger punix_notify_tournament_launch
  after insert or update of status on public.tournaments
  for each row execute function private.notify_tournament_launch();

create or replace function private.notify_team_captains(p_team_id uuid, p_title text, p_body text, p_type text, p_link text, p_actor uuid)
returns void language plpgsql security definer set search_path=''
as $$
begin
  insert into public.notifications(user_id, notification_type, title, body, link, metadata)
  select distinct tm.user_id, p_type, p_title, p_body, p_link,
         jsonb_build_object('team_id', p_team_id)
  from public.team_members tm
  where tm.team_id = p_team_id
    and tm.member_role = 'captain'
    and tm.user_id is distinct from p_actor;
end;
$$;
revoke all on function private.notify_team_captains(uuid,text,text,text,text,uuid) from public, anon, authenticated;

create or replace function private.notify_team_roster_change()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_team_id uuid; v_actor uuid; v_name text; v_body text;
begin
  v_team_id := case when tg_op = 'DELETE' then old.team_id else new.team_id end;
  v_actor := auth.uid();
  select t.team_name into v_name from public.teams t where t.id = v_team_id;
  v_body := case when tg_op = 'INSERT' then 'A member was added to ' || coalesce(v_name,'your team') || '.'
                 when tg_op = 'DELETE' then 'A member was removed from ' || coalesce(v_name,'your team') || '.'
                 else 'A team member role or roster order changed for ' || coalesce(v_name,'your team') || '.' end;
  perform private.notify_team_captains(v_team_id, 'TEAM ROSTER UPDATED', v_body, 'team_roster', '/teams.html', v_actor);
  -- If the previous captain was removed or demoted, notify that captain too.
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
drop trigger if exists punix_notify_team_roster_change on public.team_members;
create trigger punix_notify_team_roster_change
  after insert or update or delete on public.team_members
  for each row execute function private.notify_team_roster_change();

create or replace function private.notify_team_details_change()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if (old.team_name,old.game_name,old.division,old.status,old.logo_url,old.description)
     is distinct from
     (new.team_name,new.game_name,new.division,new.status,new.logo_url,new.description) then
    perform private.notify_team_captains(new.id, 'TEAM DETAILS UPDATED',
      'Your team details or status were updated. Review the latest team information.',
      'team_update', '/teams.html', auth.uid());
  end if;
  return new;
end;
$$;
revoke all on function private.notify_team_details_change() from public, anon, authenticated;
drop trigger if exists punix_notify_team_details_change on public.teams;
create trigger punix_notify_team_details_change
  after update on public.teams
  for each row execute function private.notify_team_details_change();

create or replace function private.notify_tournament_entry_status()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_tournament text; v_team text; v_title text; v_body text;
begin
  if new.status is distinct from old.status and new.status in ('confirmed','rejected','withdrawn') then
    select t.title into v_tournament from public.tournaments t where t.id=new.tournament_id;
    v_team := nullif(new.team_name,'');
    v_title := case new.status when 'confirmed' then 'TOURNAMENT ENTRY APPROVED'
                when 'rejected' then 'TOURNAMENT ENTRY NOT APPROVED'
                else 'TOURNAMENT ENTRY CANCELLED' end;
    v_body := coalesce(v_team,new.in_game_name) || ' · ' || coalesce(v_tournament,'PUNIX tournament') ||
      case new.status when 'confirmed' then ' — your entry is confirmed.'
                      when 'rejected' then ' — your entry was not approved. Contact PUNIX if you need clarification.'
                      else ' — the entry was withdrawn. You may apply again if registration is open.' end;
    insert into public.notifications(user_id,notification_type,title,body,link,metadata)
    values(new.user_id,'tournament_entry',v_title,v_body,'/tournaments.html?id='||new.tournament_id::text,
           jsonb_build_object('registration_id',new.id,'tournament_id',new.tournament_id,'status',new.status));
  end if;
  return new;
end;
$$;
revoke all on function private.notify_tournament_entry_status() from public, anon, authenticated;
drop trigger if exists punix_notify_tournament_entry_status on public.tournament_registrations;
create trigger punix_notify_tournament_entry_status
  after update of status on public.tournament_registrations
  for each row execute function private.notify_tournament_entry_status();

create or replace function private.notify_tournament_match_change()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_tournament text; v_body text;
begin
  if tg_op = 'INSERT' then
    select t.title into v_tournament from public.tournaments t where t.id=new.tournament_id;
    v_body := 'A match update is available for ' || coalesce(v_tournament,'your tournament') || '. Check the schedule or results.';
    insert into public.notifications(user_id,notification_type,title,body,link,metadata)
    select distinct r.user_id, 'tournament_match', 'TOURNAMENT MATCH UPDATE', v_body,
           '/tournaments.html?id=' || new.tournament_id::text,
           jsonb_build_object('match_id',new.id,'tournament_id',new.tournament_id)
    from public.tournament_registrations r
    where r.id in (new.participant_a_id,new.participant_b_id)
      and r.status = 'confirmed';
  elsif (old.scheduled_at,old.status,old.score_a,old.score_b,old.winner_registration_id)
        is distinct from
        (new.scheduled_at,new.status,new.score_a,new.score_b,new.winner_registration_id) then
    select t.title into v_tournament from public.tournaments t where t.id=new.tournament_id;
    v_body := 'A match update is available for ' || coalesce(v_tournament,'your tournament') || '. Check the schedule or results.';
    insert into public.notifications(user_id,notification_type,title,body,link,metadata)
    select distinct r.user_id, 'tournament_match', 'TOURNAMENT MATCH UPDATE', v_body,
           '/tournaments.html?id=' || new.tournament_id::text,
           jsonb_build_object('match_id',new.id,'tournament_id',new.tournament_id)
    from public.tournament_registrations r
    where r.id in (new.participant_a_id,new.participant_b_id)
      and r.status = 'confirmed';
  end if;
  return new;
end;
$$;
revoke all on function private.notify_tournament_match_change() from public, anon, authenticated;
drop trigger if exists punix_notify_tournament_match_change on public.tournament_matches;
create trigger punix_notify_tournament_match_change
  after insert or update on public.tournament_matches
  for each row execute function private.notify_tournament_match_change();

notify pgrst, 'reload schema';
