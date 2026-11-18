-- PUNIX: automatically complete decisive BO1 / BO3 / BO5 results.
-- This ensures score-only result entry cannot leave a decided match scheduled,
-- which would prevent the bracket advancement triggers from running.

create or replace function private.auto_complete_punix_match_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target integer;
begin
  if new.participant_a_id is null
     or new.participant_b_id is null
     or new.score_a is null
     or new.score_b is null
     or new.best_of not in (1, 3, 5) then
    return new;
  end if;

  v_target := ceil(new.best_of::numeric / 2)::integer;

  if new.score_a >= v_target and new.score_b < v_target then
    new.winner_registration_id := new.participant_a_id;
    new.status := 'completed';
  elsif new.score_b >= v_target and new.score_a < v_target then
    new.winner_registration_id := new.participant_b_id;
    new.status := 'completed';
  end if;

  return new;
end;
$$;

revoke all on function private.auto_complete_punix_match_result() from public, anon, authenticated;

drop trigger if exists punix_auto_complete_match_result on public.tournament_matches;
create trigger punix_auto_complete_match_result
before insert or update on public.tournament_matches
for each row
execute function private.auto_complete_punix_match_result();

-- Repair already-entered decisive scores that were left in SCHEDULED/LIVE state.
-- Updating winner + status fires the existing single/double-elimination routers.
update public.tournament_matches m
set winner_registration_id = case
      when m.score_a >= ceil(m.best_of::numeric / 2)::integer
       and m.score_b < ceil(m.best_of::numeric / 2)::integer
        then m.participant_a_id
      when m.score_b >= ceil(m.best_of::numeric / 2)::integer
       and m.score_a < ceil(m.best_of::numeric / 2)::integer
        then m.participant_b_id
      else m.winner_registration_id
    end,
    status = 'completed'
where m.participant_a_id is not null
  and m.participant_b_id is not null
  and m.score_a is not null
  and m.score_b is not null
  and (
    (m.score_a >= ceil(m.best_of::numeric / 2)::integer
      and m.score_b < ceil(m.best_of::numeric / 2)::integer)
    or
    (m.score_b >= ceil(m.best_of::numeric / 2)::integer
      and m.score_a < ceil(m.best_of::numeric / 2)::integer)
  )
  and (m.status <> 'completed' or m.winner_registration_id is distinct from case
      when m.score_a >= ceil(m.best_of::numeric / 2)::integer
       and m.score_b < ceil(m.best_of::numeric / 2)::integer then m.participant_a_id
      else m.participant_b_id
    end);

notify pgrst, 'reload schema';
