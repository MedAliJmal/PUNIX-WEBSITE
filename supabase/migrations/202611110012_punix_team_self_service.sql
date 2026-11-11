-- PUNIX TEAM SELF-SERVICE, INVITATIONS AND SAFE DELETION
-- Additive migration: keeps the existing teams, team_members, tournament and notification tables.

create table if not exists public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_by uuid null references auth.users(id) on delete set null,
  accepted_at timestamptz null
);

create index if not exists team_invitations_team_status_idx
  on public.team_invitations(team_id,status,created_at desc);

alter table public.team_invitations enable row level security;
revoke all on public.team_invitations from public, anon, authenticated;
-- All invitation access is through the narrowly-scoped SECURITY DEFINER RPCs below.

create or replace function public.punix_create_team(
  p_team_name text,
  p_game_name text,
  p_division text default 'open',
  p_description text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_team_id uuid;
  v_name text := btrim(coalesce(p_team_name,''));
  v_game text := btrim(coalesce(p_game_name,''));
  v_division text := coalesce(p_division,'open');
  v_description text := btrim(coalesce(p_description,''));
begin
  if v_user is null then raise exception 'Please sign in to create a team.' using errcode='42501'; end if;
  if v_name !~ '^.{2,80}$' or v_game !~ '^.{2,60}$' then
    raise exception 'Team name must be 2–80 characters and game name 2–60 characters.' using errcode='22023';
  end if;
  if v_division not in ('men','women','mixed','open') then
    raise exception 'Choose a valid team division.' using errcode='22023';
  end if;
  if char_length(v_description)>500 then raise exception 'Team description must be 500 characters or fewer.' using errcode='22023'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_user) then
    raise exception 'Your PUNIX profile is not ready yet. Please complete account setup first.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text,0));
  if exists(select 1 from public.team_members tm where tm.user_id=v_user) then
    raise exception 'You are already part of a team. Leave or delete that team before creating another one.';
  end if;
  if exists(select 1 from public.teams t where lower(t.game_name)=lower(v_game) and lower(t.team_name)=lower(v_name)) then
    raise exception 'A team with this name already exists for this game.';
  end if;

  insert into public.teams(team_name,game_name,division,status,description)
  values(v_name,v_game,v_division,'active',v_description)
  returning id into v_team_id;

  insert into public.team_members(team_id,user_id,member_role,display_order)
  values(v_team_id,v_user,'captain',0);

  return v_team_id;
end;
$$;
revoke all on function public.punix_create_team(text,text,text,text) from public,anon;
grant execute on function public.punix_create_team(text,text,text,text) to authenticated;

create or replace function public.punix_my_team_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_team_id uuid;
  v_is_captain boolean := false;
  v_result jsonb;
begin
  if v_user is null then raise exception 'Please sign in.' using errcode='42501'; end if;

  select tm.team_id, (tm.member_role='captain')
    into v_team_id,v_is_captain
  from public.team_members tm
  where tm.user_id=v_user
  order by (tm.member_role='captain') desc,tm.created_at
  limit 1;

  if v_team_id is null then
    return jsonb_build_object('team',null,'members','[]'::jsonb,'invitations','[]'::jsonb,'is_captain',false);
  end if;

  select jsonb_build_object(
    'team', (select jsonb_build_object('id',t.id,'team_name',t.team_name,'game_name',t.game_name,
      'division',t.division,'status',t.status,'logo_url',t.logo_url,'description',t.description,
      'created_at',t.created_at) from public.teams t where t.id=v_team_id),
    'members', coalesce((select jsonb_agg(jsonb_build_object(
      'user_id',p.id,'display_name',coalesce(p.display_name,'PUNIX MEMBER'),
      'avatar_url',p.avatar_url,'member_role',tm.member_role,'joined_at',tm.created_at
    ) order by (tm.member_role='captain') desc,tm.created_at)
      from public.team_members tm join public.profiles p on p.id=tm.user_id
      where tm.team_id=v_team_id),'[]'::jsonb),
    'invitations', case when v_is_captain then coalesce((
      select jsonb_agg(jsonb_build_object('id',i.id,'status',i.status,'created_at',i.created_at,
        'expires_at',i.expires_at,'invite_url','https://punix.pages.dev/team-invite.html?token='||i.token)
      order by i.created_at desc)
      from public.team_invitations i where i.team_id=v_team_id and i.status='pending' and i.expires_at>now()
    ),'[]'::jsonb) else '[]'::jsonb end,
    'is_captain',v_is_captain
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.punix_my_team_dashboard() from public,anon;
grant execute on function public.punix_my_team_dashboard() to authenticated;

create or replace function public.punix_create_team_invitation(p_team_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_token text := gen_random_uuid()::text;
begin
  if v_user is null then raise exception 'Please sign in.' using errcode='42501'; end if;
  if not exists(select 1 from public.team_members tm where tm.team_id=p_team_id and tm.user_id=v_user and tm.member_role='captain') then
    raise exception 'Only the team captain can invite members.' using errcode='42501';
  end if;
  if (select count(*) from public.team_members tm where tm.team_id=p_team_id)>=20 then
    raise exception 'This team has reached the 20-member limit.';
  end if;
  if (select count(*) from public.team_invitations i where i.team_id=p_team_id and i.status='pending' and i.expires_at>now())>=20 then
    raise exception 'You already have 20 pending invitations. Revoke an old link first.';
  end if;
  insert into public.team_invitations(team_id,invited_by,token,expires_at)
  values(p_team_id,v_user,v_token,now()+interval '7 days');
  return v_token;
end;
$$;
revoke all on function public.punix_create_team_invitation(uuid) from public,anon;
grant execute on function public.punix_create_team_invitation(uuid) to authenticated;

create or replace function public.punix_get_team_invitation(p_token text)
returns table(team_id uuid,team_name text,game_name text,captain_name text,expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id,t.team_name,t.game_name,coalesce(p.display_name,'PUNIX CAPTAIN'),i.expires_at
  from public.team_invitations i
  join public.teams t on t.id=i.team_id
  join public.profiles p on p.id=i.invited_by
  where i.token=p_token and i.status='pending' and i.expires_at>now()
    and t.status in ('active','recruiting')
  limit 1;
$$;
revoke all on function public.punix_get_team_invitation(text) from public;
grant execute on function public.punix_get_team_invitation(text) to anon,authenticated;

create or replace function public.punix_accept_team_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_inv public.team_invitations%rowtype;
  v_team_name text;
  v_team_id uuid;
begin
  if v_user is null then raise exception 'Create an account or sign in before accepting this invitation.' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text,0));

  select * into v_inv from public.team_invitations i
  where i.token=p_token for update;
  if not found or v_inv.status<>'pending' then raise exception 'This invitation is no longer available.'; end if;
  if v_inv.expires_at<=now() then
    update public.team_invitations set status='expired' where id=v_inv.id;
    raise exception 'This invitation has expired. Ask the captain for a new link.';
  end if;
  if not exists(select 1 from public.teams t where t.id=v_inv.team_id and t.status in ('active','recruiting')) then
    raise exception 'This team is no longer active.';
  end if;
  if exists(select 1 from public.team_members tm where tm.user_id=v_user) then
    raise exception 'You are already in a team. You must leave your current team before joining another.';
  end if;
  if (select count(*) from public.team_members tm where tm.team_id=v_inv.team_id)>=20 then
    raise exception 'This team has reached its 20-member limit.';
  end if;
  select t.team_name into v_team_name from public.teams t where t.id=v_inv.team_id;
  insert into public.team_members(team_id,user_id,member_role,display_order)
  values(v_inv.team_id,v_user,'player',coalesce((select max(display_order)+1 from public.team_members where team_id=v_inv.team_id),1));
  update public.team_invitations set status='accepted',accepted_by=v_user,accepted_at=now() where id=v_inv.id;

  insert into public.notifications(user_id,notification_type,title,body,link,metadata)
  select tm.user_id,'team_invitation','NEW TEAM MEMBER',coalesce((select display_name from public.profiles where id=v_user),'A player')||' joined '||v_team_name||'.','/teams.html',jsonb_build_object('team_id',v_inv.team_id)
  from public.team_members tm where tm.team_id=v_inv.team_id and tm.member_role='captain' and tm.user_id<>v_user;

  insert into public.notifications(user_id,notification_type,title,body,link,metadata)
  values(v_user,'team_invitation','WELCOME TO '||upper(v_team_name),'You have joined the team successfully.','/my-team.html',jsonb_build_object('team_id',v_inv.team_id));
  return v_inv.team_id;
end;
$$;
revoke all on function public.punix_accept_team_invitation(text) from public,anon;
grant execute on function public.punix_accept_team_invitation(text) to authenticated;

create or replace function public.punix_revoke_team_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := (select auth.uid());
begin
  update public.team_invitations i set status='revoked'
  where i.id=p_invitation_id and i.status='pending'
    and exists(select 1 from public.team_members tm where tm.team_id=i.team_id and tm.user_id=v_user and tm.member_role='captain');
  if not found then raise exception 'Invitation not found or you are not allowed to revoke it.' using errcode='42501'; end if;
end;
$$;
revoke all on function public.punix_revoke_team_invitation(uuid) from public,anon;
grant execute on function public.punix_revoke_team_invitation(uuid) to authenticated;

create or replace function public.punix_delete_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_team_name text;
begin
  if v_user is null then raise exception 'Please sign in.' using errcode='42501'; end if;
  if not exists(select 1 from public.team_members tm where tm.team_id=p_team_id and tm.user_id=v_user and tm.member_role='captain') then
    raise exception 'Only the team captain can delete this team.' using errcode='42501';
  end if;
  if exists(select 1 from public.tournament_registrations r where r.team_id=p_team_id and r.status in ('pending','confirmed')) then
    raise exception 'This team has a pending or confirmed tournament entry. Resolve or withdraw that entry before deleting the team.';
  end if;
  select t.team_name into v_team_name from public.teams t where t.id=p_team_id;
  if v_team_name is null then raise exception 'Team not found.'; end if;

  -- Notify every roster member before ON DELETE CASCADE releases them.
  insert into public.notifications(user_id,notification_type,title,body,link,metadata)
  select tm.user_id,'team_deleted','TEAM DISBANDED',v_team_name||' has been deleted by its captain. You are now free to create or join another team.','/teams.html',
    jsonb_build_object('team_id',p_team_id,'team_name',v_team_name)
  from public.team_members tm where tm.team_id=p_team_id;

  delete from public.teams where id=p_team_id;
  -- team_members and pending invitations cascade; tournament history remains,
  -- because tournament_registrations.team_id uses ON DELETE SET NULL.
end;
$$;
revoke all on function public.punix_delete_team(uuid) from public,anon;
grant execute on function public.punix_delete_team(uuid) to authenticated;

notify pgrst,'reload schema';
