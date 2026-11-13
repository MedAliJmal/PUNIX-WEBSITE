-- PUNIX FULL SINGLE-ELIMINATION BRACKET WITH EMPTY SLOTS
-- Uses max_participants as the bracket capacity when configured. Otherwise,
-- rounds up the confirmed entry count to the next power of two (minimum 2).

create or replace function public.admin_generate_tournament_bracket(p_tournament_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_entries uuid[];
  v_count integer;
  v_bracket_size integer := 2;
  v_first_round_matches integer;
  v_remaining integer;
  v_random_index integer;
  v_a uuid;
  v_b uuid;
  v_match_number integer := 0;
  v_round integer := 1;
  v_round_matches integer;
  v_next_matches integer;
  v_created integer := 0;
begin
  if not (private.has_role('admin') or private.has_role('super_admin')) then
    raise exception 'Only tournament administrators can generate a bracket.';
  end if;

  select * into v_tournament
  from public.tournaments
  where id = p_tournament_id
  for update;

  if not found then
    raise exception 'Tournament not found.';
  end if;
  if v_tournament.format <> 'single_elimination' then
    raise exception 'Full automatic brackets currently support single-elimination tournaments only.';
  end if;
  if exists (select 1 from public.tournament_matches where tournament_id = p_tournament_id) then
    raise exception 'A bracket already exists for this tournament. It will not be reshuffled.';
  end if;

  select array_agg(r.id order by r.reviewed_at asc nulls last, r.created_at asc, r.id)
    into v_entries
  from public.tournament_registrations r
  where r.tournament_id = p_tournament_id
    and r.status = 'confirmed';

  v_count := coalesce(array_length(v_entries, 1), 0);
  if v_count < 1 then
    raise exception 'At least one approved team or player is required to publish the bracket.';
  end if;

  -- The configured capacity determines the bracket size. With no capacity,
  -- create the smallest power-of-two bracket that fits the approved entries.
  v_bracket_size := 2;
  while v_bracket_size < greatest(coalesce(v_tournament.max_participants, 0), v_count) loop
    v_bracket_size := v_bracket_size * 2;
  end loop;

  if v_bracket_size > 512 then
    raise exception 'The bracket capacity exceeds the supported 512 slots.';
  end if;

  update public.tournaments
     set registration_open = false, updated_at = now()
   where id = p_tournament_id;

  v_first_round_matches := v_bracket_size / 2;

  -- Preserve the selected draw: earliest-approved entry first, random opponent.
  while coalesce(array_length(v_entries, 1), 0) > 0 loop
    v_remaining := array_length(v_entries, 1);
    v_a := v_entries[1];
    v_b := null;

    if v_remaining >= 2 then
      v_random_index := floor(random() * (v_remaining - 1))::integer + 2;
      v_b := v_entries[v_random_index];
    end if;

    v_entries := array_remove(v_entries, v_a);
    if v_b is not null then
      v_entries := array_remove(v_entries, v_b);
    end if;

    v_match_number := v_match_number + 1;
    insert into public.tournament_matches (
      tournament_id, round_number, match_number,
      participant_a_id, participant_b_id, status
    ) values (
      p_tournament_id, 1, v_match_number,
      v_a, v_b, 'scheduled'
    );
  end loop;

  -- Create every remaining first-round match as an empty slot.
  while v_match_number < v_first_round_matches loop
    v_match_number := v_match_number + 1;
    insert into public.tournament_matches (
      tournament_id, round_number, match_number, status
    ) values (p_tournament_id, 1, v_match_number, 'scheduled');
  end loop;

  -- Pre-create the complete tree through the final.
  v_round_matches := v_first_round_matches;
  while v_round_matches > 1 loop
    v_round := v_round + 1;
    v_next_matches := v_round_matches / 2;
    for i in 1..v_next_matches loop
      insert into public.tournament_matches (
        tournament_id, round_number, match_number, status
      ) values (p_tournament_id, v_round, i, 'scheduled');
      v_created := v_created + 1;
    end loop;
    v_round_matches := v_next_matches;
  end loop;

  -- Empty-vs-empty matches are completed with no winner, so real byes can
  -- flow through the bracket tree without blocking later rounds.
  update public.tournament_matches
     set status = 'completed', winner_registration_id = null
   where tournament_id = p_tournament_id
     and round_number = 1
     and participant_a_id is null
     and participant_b_id is null;

  -- A single participant in a first-round match receives an automatic bye.
  update public.tournament_matches
     set status = 'completed', winner_registration_id = participant_a_id
   where tournament_id = p_tournament_id
     and round_number = 1
     and ((participant_a_id is not null and participant_b_id is null)
       or (participant_a_id is null and participant_b_id is not null));

  return (v_first_round_matches * 2 - 1);
end;
$$;

revoke all on function public.admin_generate_tournament_bracket(uuid) from public, anon;
grant execute on function public.admin_generate_tournament_bracket(uuid) to authenticated;

-- Permit the automatic trigger to retry when an admin saves tournament details.
-- pg_trigger_depth prevents recursion when bracket generation itself closes registration.
create or replace function private.try_auto_generate_punix_bracket()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tournament_id uuid;
  v_format text;
  v_status text;
  v_registration_open boolean;
  v_pending integer;
  v_confirmed integer;
begin
  if tg_table_name = 'tournaments' then
    if pg_trigger_depth() > 1 or new.registration_open is true then
      return new;
    end if;
    v_tournament_id := new.id;
  else
    v_tournament_id := new.tournament_id;
  end if;

  select t.format, t.status, t.registration_open
    into v_format, v_status, v_registration_open
  from public.tournaments t
  where t.id = v_tournament_id
  for update;

  if not found
     or v_registration_open
     or v_format <> 'single_elimination'
     or v_status not in ('upcoming', 'live') then
    return new;
  end if;

  if exists (
    select 1 from public.tournament_matches m
    where m.tournament_id = v_tournament_id
  ) then
    return new;
  end if;

  select
    count(*) filter (where r.status = 'pending'),
    count(*) filter (where r.status = 'confirmed')
  into v_pending, v_confirmed
  from public.tournament_registrations r
  where r.tournament_id = v_tournament_id;

  if coalesce(v_pending, 0) = 0 and coalesce(v_confirmed, 0) >= 1 then
    perform public.admin_generate_tournament_bracket(v_tournament_id);
  end if;

  return new;
end;
$$;

revoke all on function private.try_auto_generate_punix_bracket() from public, anon, authenticated;

drop trigger if exists punix_auto_bracket_on_registration_close on public.tournaments;
create trigger punix_auto_bracket_on_registration_close
after update of registration_open, status, description
on public.tournaments
for each row
execute function private.try_auto_generate_punix_bracket();

drop trigger if exists punix_auto_bracket_after_application_review on public.tournament_registrations;
create trigger punix_auto_bracket_after_application_review
after update of status
on public.tournament_registrations
for each row
execute function private.try_auto_generate_punix_bracket();

notify pgrst, 'reload schema';
