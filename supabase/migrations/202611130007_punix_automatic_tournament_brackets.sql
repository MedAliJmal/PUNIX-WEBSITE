-- PUNIX AUTOMATIC BRACKET GENERATION
-- Generate a single-elimination draw when registration is closed and every
-- application has been reviewed. The last review can complete the conditions.

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
    if not (
      (old.registration_open is true and new.registration_open is false)
      or (
        old.status is distinct from new.status
        and new.status in ('upcoming', 'live')
        and new.registration_open is false
      )
    ) then
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

  -- Never replace or reshuffle an existing draw.
  if exists (
    select 1
    from public.tournament_matches m
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

  -- Wait for every pending application to be approved or rejected.
  -- Two or more approved entries are required for a bracket.
  if coalesce(v_pending, 0) = 0 and coalesce(v_confirmed, 0) >= 2 then
    perform public.admin_generate_tournament_bracket(v_tournament_id);
  end if;

  return new;
end;
$$;

revoke all on function private.try_auto_generate_punix_bracket() from public, anon, authenticated;

drop trigger if exists punix_auto_bracket_on_registration_close on public.tournaments;
create trigger punix_auto_bracket_on_registration_close
after update of registration_open, status
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
