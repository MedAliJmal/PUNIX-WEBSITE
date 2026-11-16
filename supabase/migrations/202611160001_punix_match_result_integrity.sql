-- PUNIX: enforce valid BO1 / BO3 / BO5 match results in the database.
-- This protects tournament results even when they are written outside the admin UI.

create or replace function private.validate_punix_match_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_wins integer;
begin
  if new.best_of not in (1, 3, 5) then
    raise exception 'Match format must be BO1, BO3 or BO5.';
  end if;

  if new.participant_a_id is not null
     and new.participant_a_id = new.participant_b_id then
    raise exception 'A team/player cannot compete against itself.';
  end if;

  if new.winner_registration_id is not null
     and new.winner_registration_id is distinct from new.participant_a_id
     and new.winner_registration_id is distinct from new.participant_b_id then
    raise exception 'The selected winner must be one of the match participants.';
  end if;

  if new.score_a is not null and new.score_a < 0 then
    raise exception 'Map scores cannot be negative.';
  end if;

  if new.score_b is not null and new.score_b < 0 then
    raise exception 'Map scores cannot be negative.';
  end if;

  -- A one-sided or empty completed slot can represent an automatically
  -- resolved bye. Normal played matches must have two participants and a
  -- decisive, score-backed result.
  if new.status = 'completed'
     and new.participant_a_id is not null
     and new.participant_b_id is not null then
    if new.winner_registration_id is null
       or new.score_a is null
       or new.score_b is null then
      raise exception 'A completed match requires a winner and both map scores.';
    end if;

    v_target_wins := ceil(new.best_of::numeric / 2)::integer;

    if new.winner_registration_id = new.participant_a_id then
      if new.score_a <> v_target_wins or new.score_b >= v_target_wins then
        raise exception 'Invalid BO% result: the winner must reach % map wins and the opponent must have fewer.',
          new.best_of, v_target_wins;
      end if;
    else
      if new.score_b <> v_target_wins or new.score_a >= v_target_wins then
        raise exception 'Invalid BO% result: the winner must reach % map wins and the opponent must have fewer.',
          new.best_of, v_target_wins;
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.validate_punix_match_result() from public, anon, authenticated;

drop trigger if exists punix_validate_match_result on public.tournament_matches;
create trigger punix_validate_match_result
before insert or update on public.tournament_matches
for each row
execute function private.validate_punix_match_result();

notify pgrst, 'reload schema';
