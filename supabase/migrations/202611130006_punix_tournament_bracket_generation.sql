-- PUNIX SINGLE-ELIMINATION BRACKET DRAW AND WINNER ADVANCEMENT
-- First-round draw order: earliest approval gets first pick; each entry is paired
-- with a randomly selected remaining approved entry. The final unpaired entry,
-- when odd, receives a bye. Later rounds are pre-created as TBD tree slots.

create or replace function private.advance_punix_tournament_bracket()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next_match public.tournament_matches%rowtype;
  v_sibling public.tournament_matches%rowtype;
  v_sibling_exists boolean := false;
  v_current_done boolean;
  v_sibling_done boolean;
  v_current_winner uuid;
  v_sibling_winner uuid;
  v_next_round integer;
  v_next_number integer;
  v_sibling_number integer;
  v_a uuid;
  v_b uuid;
  v_next_status text;
  v_next_winner uuid;
begin
  if tg_op = 'UPDATE' and old.winner_registration_id is distinct from new.winner_registration_id then
    -- A changed result invalidates every later match on this branch.
    with recursive descendants(round_number, match_number) as (
      select new.round_number + 1, ((new.match_number + 1) / 2)
      union all
      select d.round_number + 1, ((d.match_number + 1) / 2)
      from descendants d
      where exists (
        select 1 from public.tournament_matches x
        where x.tournament_id = new.tournament_id
          and x.round_number = d.round_number
          and x.match_number = d.match_number
      )
    )
    update public.tournament_matches x
       set participant_a_id = null,
           participant_b_id = null,
           score_a = null,
           score_b = null,
           winner_registration_id = null,
           status = 'scheduled'
     where x.tournament_id = new.tournament_id
       and (x.round_number, x.match_number) in (
         select round_number, match_number from descendants
       );
  end if;

  v_next_round := new.round_number + 1;
  v_next_number := ((new.match_number + 1) / 2);
  select * into v_next_match
  from public.tournament_matches
  where tournament_id = new.tournament_id
    and round_number = v_next_round
    and match_number = v_next_number;

  if not found then
    return new;
  end if;

  v_current_done := new.status = 'completed';
  v_current_winner := case when v_current_done then new.winner_registration_id else null end;

  if mod(new.match_number, 2) = 1 then
    v_sibling_number := new.match_number + 1;
  else
    v_sibling_number := new.match_number - 1;
  end if;

  select * into v_sibling
  from public.tournament_matches
  where tournament_id = new.tournament_id
    and round_number = new.round_number
    and match_number = v_sibling_number;
  v_sibling_exists := found;

  if v_sibling_exists then
    v_sibling_done := v_sibling.status = 'completed';
    v_sibling_winner := case when v_sibling_done then v_sibling.winner_registration_id else null end;
  else
    -- An unmatched final feeder advances as a bye once its own match is complete.
    v_sibling_done := true;
    v_sibling_winner := null;
  end if;

  if mod(new.match_number, 2) = 1 then
    v_a := v_current_winner;
    v_b := v_sibling_winner;
  else
    v_a := v_sibling_winner;
    v_b := v_current_winner;
  end if;

  v_next_status := 'scheduled';
  v_next_winner := null;
  if v_current_done and v_sibling_done then
    if (v_a is null) <> (v_b is null) then
      v_next_status := 'completed';
      v_next_winner := coalesce(v_a, v_b);
    elsif v_a is null and v_b is null then
      v_next_status := 'completed';
    end if;
  end if;

  update public.tournament_matches
     set participant_a_id = v_a,
         participant_b_id = v_b,
         score_a = null,
         score_b = null,
         winner_registration_id = v_next_winner,
         status = v_next_status
   where id = v_next_match.id;

  return new;
end;
$$;

revoke all on function private.advance_punix_tournament_bracket() from public, anon, authenticated;
drop trigger if exists punix_advance_tournament_bracket on public.tournament_matches;
create trigger punix_advance_tournament_bracket
after update of winner_registration_id, status
on public.tournament_matches
for each row
execute function private.advance_punix_tournament_bracket();


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
    raise exception 'Automatic bracket generation currently supports single-elimination tournaments only.';
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
  if v_count < 2 then
    raise exception 'At least two approved teams or players are required to generate the first round.';
  end if;

  -- Freeze registrations once the draw is made.
  update public.tournaments set registration_open = false, updated_at = now()
  where id = p_tournament_id;

  -- Earliest approved entry is selected first, then receives a random opponent
  -- from the remaining approved entries. Repeat until all entries are placed.
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
      v_a, v_b, case when v_b is null then 'completed' else 'scheduled' end
    );
    if v_b is null then
      update public.tournament_matches
         set winner_registration_id = v_a
       where tournament_id = p_tournament_id
         and round_number = 1
         and match_number = v_match_number;
    end if;
  end loop;

  v_round_matches := v_match_number;
  while v_round_matches > 1 loop
    v_round := v_round + 1;
    v_next_matches := (v_round_matches + 1) / 2;
    for i in 1..v_next_matches loop
      insert into public.tournament_matches (
        tournament_id, round_number, match_number, status
      ) values (p_tournament_id, v_round, i, 'scheduled');
      v_created := v_created + 1;
    end loop;
    v_round_matches := v_next_matches;
  end loop;

  -- Bye updates above can run before the next-round rows exist. Re-run the
  -- feeder updates now that the complete bracket tree has been created.
  update public.tournament_matches
     set status = 'scheduled', winner_registration_id = null
   where tournament_id = p_tournament_id and round_number = 1
     and participant_a_id is not null and participant_b_id is null;
  update public.tournament_matches
     set status = 'completed', winner_registration_id = participant_a_id
   where tournament_id = p_tournament_id and round_number = 1
     and participant_a_id is not null and participant_b_id is null;

  return v_match_number + v_created;
end;
$$;

revoke all on function public.admin_generate_tournament_bracket(uuid) from public, anon;
grant execute on function public.admin_generate_tournament_bracket(uuid) to authenticated;


create or replace function private.block_approval_after_bracket_generation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'confirmed' and old.status is distinct from 'confirmed'
     and exists (
       select 1 from public.tournament_matches m
       where m.tournament_id = new.tournament_id
     ) then
    raise exception 'The bracket has already been generated. New entries cannot be approved after the draw.';
  end if;
  return new;
end;
$$;

revoke all on function private.block_approval_after_bracket_generation() from public, anon, authenticated;
drop trigger if exists punix_block_approval_after_bracket_generation on public.tournament_registrations;
create trigger punix_block_approval_after_bracket_generation
before update of status on public.tournament_registrations
for each row
execute function private.block_approval_after_bracket_generation();

notify pgrst, 'reload schema';
