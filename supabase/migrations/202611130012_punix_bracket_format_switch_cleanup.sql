-- PUNIX: safely rebuild the bracket when switching Double Elimination to Single Elimination.
-- Unplayed brackets can be rebuilt automatically. Played brackets are protected from data loss.

create or replace function private.try_auto_generate_punix_bracket()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_format text;
  v_has_double_sections boolean;
  v_has_played_matches boolean;
begin
  if tg_table_name = 'tournaments' then
    v_id := new.id;
  else
    v_id := new.tournament_id;
  end if;

  select t.format
    into v_format
  from public.tournaments t
  where t.id = v_id;

  if v_format = 'single_elimination' then
    select exists (
      select 1
      from public.tournament_matches m
      where m.tournament_id = v_id
        and m.bracket_section in ('losers', 'grand_final', 'grand_final_reset')
    ) into v_has_double_sections;

    if v_has_double_sections then
      select exists (
        select 1
        from public.tournament_matches m
        where m.tournament_id = v_id
          and (
            m.status <> 'scheduled'
            or m.winner_registration_id is not null
            or m.score_a is not null
            or m.score_b is not null
          )
      ) into v_has_played_matches;

      if v_has_played_matches then
        raise exception 'This Double Elimination bracket contains played matches. Clear or archive its match results before switching to Single Elimination.';
      end if;

      delete from public.tournament_matches
      where tournament_id = v_id;
    end if;

    perform private.sync_punix_single_elimination_bracket(v_id);
  elsif v_format = 'double_elimination' then
    perform private.sync_punix_double_elimination_bracket(v_id);
  end if;

  return new;
end;
$$;

revoke all on function private.try_auto_generate_punix_bracket() from public, anon, authenticated;

notify pgrst, 'reload schema';
