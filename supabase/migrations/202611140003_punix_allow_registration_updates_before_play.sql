-- PUNIX: ALLOW REGISTRATION APPROVALS INTO PRE-GENERATED EMPTY BRACKETS
-- The bracket may exist from tournament creation. That alone must not lock
-- registration review. Freeze roster changes only after a match has started
-- or a result/advancement has been recorded.

create or replace function private.block_approval_after_bracket_generation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status
     and (
       (new.status = 'confirmed' and old.status is distinct from 'confirmed')
       or (old.status = 'confirmed' and new.status is distinct from 'confirmed')
     )
     and exists (
       select 1
       from public.tournament_matches m
       where m.tournament_id = new.tournament_id
         and (
           m.status <> 'scheduled'
           or m.winner_registration_id is not null
           or m.score_a is not null
           or m.score_b is not null
         )
     ) then
    raise exception 'This tournament has started. Approved entries can no longer be changed.';
  end if;

  -- If an approved entry is rejected before play begins, free its opening
  -- bracket slot. The AFTER status-review trigger will then synchronize the
  -- bracket and place other approved entries into available positions.
  if old.status = 'confirmed'
     and new.status is distinct from 'confirmed' then
    update public.tournament_matches m
       set participant_a_id = case
             when m.participant_a_id = old.id then null
             else m.participant_a_id
           end,
           participant_b_id = case
             when m.participant_b_id = old.id then null
             else m.participant_b_id
           end
     where m.tournament_id = old.tournament_id
       and m.bracket_section = 'winners'
       and m.round_number = 1
       and m.status = 'scheduled'
       and (m.participant_a_id = old.id or m.participant_b_id = old.id);
  end if;

  return new;
end;
$$;

revoke all on function private.block_approval_after_bracket_generation() from public, anon, authenticated;

drop trigger if exists punix_block_approval_after_bracket_generation
  on public.tournament_registrations;

create trigger punix_block_approval_after_bracket_generation
before update of status on public.tournament_registrations
for each row
execute function private.block_approval_after_bracket_generation();

notify pgrst, 'reload schema';
