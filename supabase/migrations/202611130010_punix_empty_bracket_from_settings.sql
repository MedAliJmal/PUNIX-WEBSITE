-- PUNIX: CREATE THE EMPTY BRACKET FROM TOURNAMENT SETTINGS
-- Brackets exist for draft/upcoming/live single-elimination tournaments even
-- when no one has registered or been approved yet. max_participants determines
-- the bracket size; without a limit, a minimum two-slot bracket is shown.

create or replace function private.sync_punix_single_elimination_bracket(p_tournament_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_confirmed integer := 0;
  v_pending integer := 0;
  v_current_capacity integer := 0;
  v_target_capacity integer := 2;
  v_first_round_matches integer;
  v_round integer := 2;
  v_round_size integer;
  v_existing_matches integer;
  v_match_id uuid;
  v_slot_a boolean;
  v_entry uuid;
begin
  select * into v_tournament
  from public.tournaments
  where id = p_tournament_id
  for update;

  if not found
     or v_tournament.format <> 'single_elimination'
     or v_tournament.status not in ('draft', 'upcoming', 'live') then
    return 0;
  end if;

  select
    count(*) filter (where r.status = 'confirmed'),
    count(*) filter (where r.status = 'pending')
  into v_confirmed, v_pending
  from public.tournament_registrations r
  where r.tournament_id = p_tournament_id;

  select coalesce(max(m.match_number), 0)
    into v_current_capacity
  from public.tournament_matches m
  where m.tournament_id = p_tournament_id
    and m.round_number = 1;

  v_current_capacity := v_current_capacity * 2;
  v_target_capacity := greatest(
    2,
    v_current_capacity,
    coalesce(v_tournament.max_participants, 0),
    v_confirmed
  );

  -- Round up to a power of two without changing any existing match positions.
  v_target_capacity := greatest(2, v_current_capacity, coalesce(v_tournament.max_participants, 0), v_confirmed);
  v_first_round_matches := greatest(1, v_current_capacity / 2);
  while v_first_round_matches * 2 < v_target_capacity loop
    v_first_round_matches := v_first_round_matches * 2;
  end loop;
  v_target_capacity := v_first_round_matches * 2;

  if v_target_capacity > 512 then
    raise exception 'This tournament exceeds the supported 512 bracket slots.';
  end if;

  -- Remove entries that are no longer approved, but only from unplayed matches.
  update public.tournament_matches m
     set participant_a_id = case
           when m.participant_a_id is not null and exists (
             select 1 from public.tournament_registrations r
             where r.id = m.participant_a_id and r.status = 'confirmed'
           ) then m.participant_a_id else null end,
         participant_b_id = case
           when m.participant_b_id is not null and exists (
             select 1 from public.tournament_registrations r
             where r.id = m.participant_b_id and r.status = 'confirmed'
           ) then m.participant_b_id else null end,
         score_a = null,
         score_b = null,
         winner_registration_id = null
   where m.tournament_id = p_tournament_id
     and m.round_number = 1
     and m.status = 'scheduled'
     and (
       (m.participant_a_id is not null and not exists (
         select 1 from public.tournament_registrations r
         where r.id = m.participant_a_id and r.status = 'confirmed'
       ))
       or
       (m.participant_b_id is not null and not exists (
         select 1 from public.tournament_registrations r
         where r.id = m.participant_b_id and r.status = 'confirmed'
       ))
     );

  -- Create any newly required first-round positions. Existing positions remain stable.
  select coalesce(max(m.match_number), 0)
    into v_existing_matches
  from public.tournament_matches m
  where m.tournament_id = p_tournament_id
    and m.round_number = 1;

  if v_existing_matches < v_first_round_matches then
    for i in (v_existing_matches + 1)..v_first_round_matches loop
      insert into public.tournament_matches (
        tournament_id, round_number, match_number, status
      ) values (p_tournament_id, 1, i, 'scheduled');
    end loop;
  end if;

  -- Extend the later rounds in-place as the bracket grows.
  v_round_size := v_first_round_matches / 2;
  while v_round_size >= 1 loop
    select coalesce(max(m.match_number), 0)
      into v_existing_matches
    from public.tournament_matches m
    where m.tournament_id = p_tournament_id
      and m.round_number = v_round;

    if v_existing_matches < v_round_size then
      for i in (v_existing_matches + 1)..v_round_size loop
        insert into public.tournament_matches (
          tournament_id, round_number, match_number, status
        ) values (p_tournament_id, v_round, i, 'scheduled');
      end loop;
    end if;

    v_round := v_round + 1;
    v_round_size := v_round_size / 2;
  end loop;

  -- Add every newly approved entry to a randomly selected free first-round side.
  -- The tournament row lock serializes approvals so two entries cannot take one slot.
  for v_entry in
    select r.id
    from public.tournament_registrations r
    where r.tournament_id = p_tournament_id
      and r.status = 'confirmed'
      and not exists (
        select 1
        from public.tournament_matches m
        where m.tournament_id = p_tournament_id
          and m.round_number = 1
          and (m.participant_a_id = r.id or m.participant_b_id = r.id)
      )
    order by r.reviewed_at asc nulls last, r.created_at asc, r.id
  loop
    select m.id, (m.participant_a_id is null)
      into v_match_id, v_slot_a
    from public.tournament_matches m
    where m.tournament_id = p_tournament_id
      and m.round_number = 1
      and m.status = 'scheduled'
      and (m.participant_a_id is null or m.participant_b_id is null)
    order by random()
    limit 1
    for update;

    if not found then
      raise exception 'No free bracket position is available for this approved entry.';
    end if;

    if v_slot_a then
      update public.tournament_matches
         set participant_a_id = v_entry
       where id = v_match_id;
    else
      update public.tournament_matches
         set participant_b_id = v_entry
       where id = v_match_id;
    end if;
  end loop;

  -- Keep byes provisional while registration is open or any application is pending.
  -- Once registration is closed and all applications are reviewed, resolve byes.
  if not v_tournament.registration_open and coalesce(v_pending, 0) = 0 then
    update public.tournament_matches
       set status = 'completed',
           winner_registration_id = coalesce(participant_a_id, participant_b_id)
     where tournament_id = p_tournament_id
       and round_number = 1
       and status = 'scheduled'
       and ((participant_a_id is null) <> (participant_b_id is null));

    update public.tournament_matches
       set status = 'completed',
           winner_registration_id = null
     where tournament_id = p_tournament_id
       and round_number = 1
       and status = 'scheduled'
       and participant_a_id is null
       and participant_b_id is null;

  end if;

  return (select count(*)::integer
          from public.tournament_matches
          where tournament_id = p_tournament_id);
end;
$$;

revoke all on function private.sync_punix_single_elimination_bracket(uuid) from public, anon, authenticated;

create or replace function private.try_auto_generate_punix_bracket()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tournament_id uuid;
begin
  if tg_table_name = 'tournaments' then
    v_tournament_id := new.id;
  else
    v_tournament_id := new.tournament_id;
  end if;

  perform private.sync_punix_single_elimination_bracket(v_tournament_id);
  return new;
end;
$$;

revoke all on function private.try_auto_generate_punix_bracket() from public, anon, authenticated;

drop trigger if exists punix_auto_bracket_on_registration_close on public.tournaments;
create trigger punix_auto_bracket_on_registration_close
after insert or update
on public.tournaments
for each row
execute function private.try_auto_generate_punix_bracket();

drop trigger if exists punix_auto_bracket_after_application_review on public.tournament_registrations;
create trigger punix_auto_bracket_after_application_review
after insert or update of status
on public.tournament_registrations
for each row
execute function private.try_auto_generate_punix_bracket();

-- Backfill every existing draft/upcoming/live single-elimination tournament,
-- including tournaments with zero registrations.
do $$
declare
  v_tournament_id uuid;
begin
  for v_tournament_id in
    select t.id
    from public.tournaments t
    where t.format = 'single_elimination'
      and t.status in ('draft', 'upcoming', 'live')
  loop
    perform private.sync_punix_single_elimination_bracket(v_tournament_id);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
