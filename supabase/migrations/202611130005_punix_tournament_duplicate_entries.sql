-- PUNIX TOURNAMENT DUPLICATE REGISTRATION GUARD
-- Duplicate identities are scoped to one tournament. Rejected/withdrawn entries
-- do not reserve names; pending and confirmed entries do.

create or replace function private.prevent_tournament_duplicate_entries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_duplicate text;
  v_name text;
begin
  -- Serialize registration checks within this tournament to avoid concurrent
  -- submissions bypassing the duplicate check.
  perform pg_advisory_xact_lock(hashtextextended(new.tournament_id::text, 0));

  if new.status not in ('pending', 'confirmed') then
    return new;
  end if;

  -- A team name may be reused in another tournament, but not this one.
  if nullif(btrim(new.team_name), '') is not null then
    select r.team_name into v_duplicate
    from public.tournament_registrations r
    where r.tournament_id = new.tournament_id
      and r.id is distinct from new.id
      and r.status in ('pending', 'confirmed')
      and nullif(btrim(r.team_name), '') is not null
      and lower(regexp_replace(btrim(r.team_name), '\s+', ' ', 'g')) =
          lower(regexp_replace(btrim(new.team_name), '\s+', ' ', 'g'))
    limit 1;

    if v_duplicate is not null then
      raise exception 'This team name is already registered in this tournament. Please choose another team name.';
    end if;
  end if;

  -- Check the captain and every submitted roster member against active entries
  -- in this tournament. Discord is compared only with Discord; IGN with IGN.
  with candidate_players as (
    select nullif(lower(regexp_replace(btrim(new.discord_handle), '\s+', ' ', 'g')), '') as discord_value,
           nullif(lower(regexp_replace(btrim(new.in_game_name), '\s+', ' ', 'g')), '') as ign_value
    union all
    select nullif(lower(regexp_replace(btrim(p->>'discord_handle'), '\s+', ' ', 'g')), ''),
           nullif(lower(regexp_replace(btrim(p->>'in_game_name'), '\s+', ' ', 'g')), '')
    from jsonb_array_elements(case when jsonb_typeof(new.roster) = 'array' then new.roster else '[]'::jsonb end) p
  ),
  existing_players as (
    select r.discord_handle as discord_value, r.in_game_name as ign_value
    from public.tournament_registrations r
    where r.tournament_id = new.tournament_id
      and r.id is distinct from new.id
      and r.status in ('pending', 'confirmed')
    union all
    select p->>'discord_handle', p->>'in_game_name'
    from public.tournament_registrations r
    cross join lateral jsonb_array_elements(case when jsonb_typeof(r.roster) = 'array' then r.roster else '[]'::jsonb end) p
    where r.tournament_id = new.tournament_id
      and r.id is distinct from new.id
      and r.status in ('pending', 'confirmed')
  )
  select case
    when c.discord_value is not null and exists (
      select 1 from existing_players e
      where nullif(lower(regexp_replace(btrim(e.discord_value), '\s+', ' ', 'g')), '') = c.discord_value
    ) then 'Discord username'
    when c.ign_value is not null and exists (
      select 1 from existing_players e
      where nullif(lower(regexp_replace(btrim(e.ign_value), '\s+', ' ', 'g')), '') = c.ign_value
    ) then 'in-game name'
  end
  into v_duplicate
  from candidate_players c
  where (c.discord_value is not null and exists (
      select 1 from existing_players e
      where nullif(lower(regexp_replace(btrim(e.discord_value), '\s+', ' ', 'g')), '') = c.discord_value
    ))
     or (c.ign_value is not null and exists (
      select 1 from existing_players e
      where nullif(lower(regexp_replace(btrim(e.ign_value), '\s+', ' ', 'g')), '') = c.ign_value
    ))
  limit 1;

  if v_duplicate is not null then
    raise exception 'This % is already registered in this tournament (captain or roster). Please check the details and use unique player information.', v_duplicate;
  end if;

  -- Also reject duplicate player identities within the same team submission.
  with players as (
    select nullif(lower(regexp_replace(btrim(new.discord_handle), '\s+', ' ', 'g')), '') as discord_value,
           nullif(lower(regexp_replace(btrim(new.in_game_name), '\s+', ' ', 'g')), '') as ign_value
    union all
    select nullif(lower(regexp_replace(btrim(p->>'discord_handle'), '\s+', ' ', 'g')), ''),
           nullif(lower(regexp_replace(btrim(p->>'in_game_name'), '\s+', ' ', 'g')), '')
    from jsonb_array_elements(case when jsonb_typeof(new.roster) = 'array' then new.roster else '[]'::jsonb end) p
  )
  select 'Discord username' into v_duplicate
  from players
  where discord_value is not null
  group by discord_value having count(*) > 1
  limit 1;

  if v_duplicate is null then
    with players as (
      select nullif(lower(regexp_replace(btrim(new.in_game_name), '\s+', ' ', 'g')), '') as ign_value
      union all
      select nullif(lower(regexp_replace(btrim(p->>'in_game_name'), '\s+', ' ', 'g')), '')
      from jsonb_array_elements(case when jsonb_typeof(new.roster) = 'array' then new.roster else '[]'::jsonb end) p
    )
    select 'in-game name' into v_duplicate
    from players
    where ign_value is not null
    group by ign_value having count(*) > 1
    limit 1;
  end if;

  if v_duplicate is not null then
    raise exception 'The same % appears more than once in your team roster. Please correct the duplicate.', v_duplicate;
  end if;

  return new;
end;
$$;

revoke all on function private.prevent_tournament_duplicate_entries() from public, anon, authenticated;
drop trigger if exists punix_prevent_tournament_duplicate_entries on public.tournament_registrations;
create trigger punix_prevent_tournament_duplicate_entries
before insert or update of status, team_name, discord_handle, in_game_name, roster
on public.tournament_registrations
for each row execute function private.prevent_tournament_duplicate_entries();

notify pgrst, 'reload schema';
