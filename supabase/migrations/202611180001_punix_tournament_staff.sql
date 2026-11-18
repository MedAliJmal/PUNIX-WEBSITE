-- PUNIX TOURNAMENT-SCOPED STAFF
-- Staff are assigned per event. They never receive global website-admin privileges.

create table if not exists public.tournament_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (tournament_id, user_id)
);

create index if not exists tournament_staff_assignments_user_idx
  on public.tournament_staff_assignments(user_id, tournament_id);

alter table public.tournament_staff_assignments enable row level security;
revoke all on public.tournament_staff_assignments from public, anon, authenticated;
grant select on public.tournament_staff_assignments to authenticated;

create or replace function private.can_manage_tournament(p_tournament_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.has_role('admin'), false)
    or exists (
      select 1
      from public.tournament_staff_assignments a
      where a.tournament_id = p_tournament_id
        and a.user_id = (select auth.uid())
    );
$$;
revoke all on function private.can_manage_tournament(uuid) from public, anon;
grant execute on function private.can_manage_tournament(uuid) to authenticated;

drop policy if exists "PUNIX admins manage tournament staff assignments" on public.tournament_staff_assignments;
create policy "PUNIX admins manage tournament staff assignments"
on public.tournament_staff_assignments
for all to authenticated
using ((select private.has_role('admin')))
with check ((select private.has_role('admin')));

drop policy if exists "Tournament staff read their own assignments" on public.tournament_staff_assignments;
create policy "Tournament staff read their own assignments"
on public.tournament_staff_assignments
for select to authenticated
using (user_id = (select auth.uid()));

-- Main admins appoint and remove staff. A staff member cannot appoint anyone.
create or replace function public.admin_set_tournament_staff(
  p_tournament_id uuid,
  p_user_id uuid,
  p_assign boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(private.has_role('admin'), false) then
    raise exception 'Only PUNIX website administrators can assign tournament staff.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.tournaments t where t.id = p_tournament_id) then
    raise exception 'Tournament not found.';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'PUNIX account not found.';
  end if;
  if exists (
    select 1 from public.user_roles r
    where r.user_id = p_user_id and r.role in ('admin', 'super_admin')
  ) then
    raise exception 'Website administrators do not need tournament staff assignments.';
  end if;

  if p_assign then
    insert into public.tournament_staff_assignments(tournament_id, user_id, assigned_by)
    values (p_tournament_id, p_user_id, auth.uid())
    on conflict (tournament_id, user_id) do nothing;
  else
    delete from public.tournament_staff_assignments
    where tournament_id = p_tournament_id and user_id = p_user_id;
  end if;

  return true;
end;
$$;
revoke all on function public.admin_set_tournament_staff(uuid, uuid, boolean) from public, anon;
grant execute on function public.admin_set_tournament_staff(uuid, uuid, boolean) to authenticated;

-- Staff may see only assigned events and their registration/match data.
drop policy if exists "Tournament staff read assigned tournaments" on public.tournaments;
create policy "Tournament staff read assigned tournaments"
on public.tournaments for select to authenticated
using ((select private.can_manage_tournament(id)));

drop policy if exists "Tournament staff update assigned tournament settings" on public.tournaments;
create policy "Tournament staff update assigned tournament settings"
on public.tournaments for update to authenticated
using (
  (select private.can_manage_tournament(id))
  and not (select private.has_role('admin'))
)
with check (
  (select private.can_manage_tournament(id))
  and not (select private.has_role('admin'))
);

drop policy if exists "Tournament staff read assigned registrations" on public.tournament_registrations;
create policy "Tournament staff read assigned registrations"
on public.tournament_registrations for select to authenticated
using ((select private.can_manage_tournament(tournament_id)));

drop policy if exists "Tournament staff update assigned registrations" on public.tournament_registrations;
create policy "Tournament staff update assigned registrations"
on public.tournament_registrations for update to authenticated
using (
  (select private.can_manage_tournament(tournament_id))
  and not (select private.has_role('admin'))
)
with check (
  (select private.can_manage_tournament(tournament_id))
  and not (select private.has_role('admin'))
);

drop policy if exists "Tournament staff read assigned matches" on public.tournament_matches;
create policy "Tournament staff read assigned matches"
on public.tournament_matches for select to authenticated
using ((select private.can_manage_tournament(tournament_id)));

drop policy if exists "Tournament staff insert assigned matches" on public.tournament_matches;
create policy "Tournament staff insert assigned matches"
on public.tournament_matches for insert to authenticated
with check (
  (select private.can_manage_tournament(tournament_id))
  and not (select private.has_role('admin'))
);

drop policy if exists "Tournament staff update assigned matches" on public.tournament_matches;
create policy "Tournament staff update assigned matches"
on public.tournament_matches for update to authenticated
using (
  (select private.can_manage_tournament(tournament_id))
  and not (select private.has_role('admin'))
)
with check (
  (select private.can_manage_tournament(tournament_id))
  and not (select private.has_role('admin'))
);

-- A staff member may change event settings, but cannot rename/delete/re-own an event.
-- Bracket format is locked as soon as bracket rows exist.
create or replace function private.guard_tournament_staff_updates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(private.has_role('admin'), false) then
    return new;
  end if;

  if not exists (
    select 1 from public.tournament_staff_assignments a
    where a.tournament_id = old.id and a.user_id = auth.uid()
  ) then
    raise exception 'You are not assigned to this tournament.'
      using errcode = '42501';
  end if;

  if (to_jsonb(new) - array['format','best_of','registration_open','status','updated_at'])
     is distinct from
     (to_jsonb(old) - array['format','best_of','registration_open','status','updated_at']) then
    raise exception 'Tournament staff may only change format, default match series, registration status and event status.'
      using errcode = '42501';
  end if;

  if new.format is distinct from old.format
     and exists (select 1 from public.tournament_matches m where m.tournament_id = old.id) then
    raise exception 'Tournament format cannot be changed after the bracket has been generated.';
  end if;

  if new.best_of not in (1,3,5) then
    raise exception 'Default match series must be BO1, BO3 or BO5.';
  end if;

  return new;
end;
$$;
revoke all on function private.guard_tournament_staff_updates() from public, anon, authenticated;
drop trigger if exists punix_guard_tournament_staff_updates on public.tournaments;
create trigger punix_guard_tournament_staff_updates
before update on public.tournaments
for each row execute function private.guard_tournament_staff_updates();

-- Simple immutable audit trail for registration and match actions.
create table if not exists public.tournament_staff_activity (
  id bigint generated always as identity primary key,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  actor_user_id uuid null references auth.users(id) on delete set null,
  action text not null,
  record_id uuid null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists tournament_staff_activity_event_idx
  on public.tournament_staff_activity(tournament_id, created_at desc);
alter table public.tournament_staff_activity enable row level security;
revoke all on public.tournament_staff_activity from public, anon, authenticated;
grant select on public.tournament_staff_activity to authenticated;

drop policy if exists "Admins and assigned staff read event activity" on public.tournament_staff_activity;
create policy "Admins and assigned staff read event activity"
on public.tournament_staff_activity for select to authenticated
using ((select private.can_manage_tournament(tournament_id)));

create or replace function private.log_punix_tournament_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_tournament_id uuid;
  v_record_id uuid;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_tournament_id := case when tg_table_name = 'tournaments' then (v_new ->> 'id')::uuid else (v_new ->> 'tournament_id')::uuid end;
    v_record_id := (v_new ->> 'id')::uuid;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_tournament_id := (v_new ->> 'tournament_id')::uuid;
    v_record_id := (v_new ->> 'id')::uuid;
  else
    v_old := to_jsonb(old);
    v_tournament_id := (v_old ->> 'tournament_id')::uuid;
    v_record_id := (v_old ->> 'id')::uuid;
  end if;

  -- Skip child audit inserts during a parent tournament cascade delete.
  if not exists (select 1 from public.tournaments t where t.id = v_tournament_id) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  insert into public.tournament_staff_activity(
    tournament_id, actor_user_id, action, record_id, before_data, after_data
  ) values (
    v_tournament_id, auth.uid(), lower(tg_table_name) || '.' || lower(tg_op),
    v_record_id, v_old, v_new
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.log_punix_tournament_activity() from public, anon, authenticated;

drop trigger if exists punix_log_registration_activity on public.tournament_registrations;
create trigger punix_log_registration_activity
after insert or update or delete on public.tournament_registrations
for each row execute function private.log_punix_tournament_activity();

drop trigger if exists punix_log_match_activity on public.tournament_matches;
create trigger punix_log_match_activity
after insert or update or delete on public.tournament_matches
for each row execute function private.log_punix_tournament_activity();

drop trigger if exists punix_log_tournament_settings_activity on public.tournaments;
create trigger punix_log_tournament_settings_activity
after update on public.tournaments
for each row execute function private.log_punix_tournament_activity();


-- Keep staff updates limited to the operational fields exposed in their workspace.
create or replace function private.guard_tournament_staff_registration_updates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $
begin
  if coalesce(private.has_role('admin'), false) then
    return new;
  end if;
  if not exists (
    select 1 from public.tournament_staff_assignments a
    where a.tournament_id = old.tournament_id and a.user_id = auth.uid()
  ) then
    raise exception 'You are not assigned to this tournament.'
      using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['status','reviewed_at','reviewed_by'])
     is distinct from
     (to_jsonb(old) - array['status','reviewed_at','reviewed_by']) then
    raise exception 'Tournament staff may only review registration status.'
      using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and (new.reviewed_by is distinct from auth.uid() or new.reviewed_at is null) then
    raise exception 'A registration review must record the reviewing staff account and time.';
  end if;
  return new;
end;
$;
revoke all on function private.guard_tournament_staff_registration_updates() from public, anon, authenticated;
drop trigger if exists punix_guard_tournament_staff_registration_updates on public.tournament_registrations;
create trigger punix_guard_tournament_staff_registration_updates
before update on public.tournament_registrations
for each row execute function private.guard_tournament_staff_registration_updates();

-- Staff edit existing bracket rows; bracket generation and row creation remain
-- controlled by the existing PUNIX bracket-generation routines.
drop policy if exists "Tournament staff insert assigned matches" on public.tournament_matches;


-- Staff cannot move a match into another event or alter bracket routing metadata.
create or replace function private.guard_tournament_staff_match_updates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $
begin
  if coalesce(private.has_role('admin'), false) then
    return new;
  end if;
  if not exists (
    select 1 from public.tournament_staff_assignments a
    where a.tournament_id = old.tournament_id and a.user_id = auth.uid()
  ) then
    raise exception 'You are not assigned to this tournament.'
      using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['best_of','participant_a_id','participant_b_id','score_a','score_b','winner_registration_id','scheduled_at','status','updated_at'])
     is distinct from
     (to_jsonb(old) - array['best_of','participant_a_id','participant_b_id','score_a','score_b','winner_registration_id','scheduled_at','status','updated_at']) then
    raise exception 'Tournament staff may only edit match participants, series, schedule, scores and result status.'
      using errcode = '42501';
  end if;
  return new;
end;
$;
revoke all on function private.guard_tournament_staff_match_updates() from public, anon, authenticated;
drop trigger if exists punix_guard_tournament_staff_match_updates on public.tournament_matches;
create trigger punix_guard_tournament_staff_match_updates
before update on public.tournament_matches
for each row execute function private.guard_tournament_staff_match_updates();

-- Match participants and winners must belong to the same tournament, and must
-- be approved entries. This prevents cross-event IDs being injected via the API.
create or replace function private.validate_punix_match_entry_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $
begin
  if new.participant_a_id is not null and not exists (
    select 1 from public.tournament_registrations r
    where r.id = new.participant_a_id
      and r.tournament_id = new.tournament_id
      and r.status = 'confirmed'
  ) then
    raise exception 'Participant A must be an approved entry in this tournament.';
  end if;
  if new.participant_b_id is not null and not exists (
    select 1 from public.tournament_registrations r
    where r.id = new.participant_b_id
      and r.tournament_id = new.tournament_id
      and r.status = 'confirmed'
  ) then
    raise exception 'Participant B must be an approved entry in this tournament.';
  end if;
  if new.winner_registration_id is not null and not exists (
    select 1 from public.tournament_registrations r
    where r.id = new.winner_registration_id
      and r.tournament_id = new.tournament_id
      and r.status = 'confirmed'
  ) then
    raise exception 'The winner must be an approved entry in this tournament.';
  end if;
  return new;
end;
$;
revoke all on function private.validate_punix_match_entry_scope() from public, anon, authenticated;
drop trigger if exists punix_validate_match_entry_scope on public.tournament_matches;
create trigger punix_validate_match_entry_scope
before insert or update on public.tournament_matches
for each row execute function private.validate_punix_match_entry_scope();

notify pgrst, 'reload schema';
