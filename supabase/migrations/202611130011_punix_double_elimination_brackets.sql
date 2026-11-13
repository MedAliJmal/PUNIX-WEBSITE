-- PUNIX DOUBLE-ELIMINATION BRACKET SUPPORT
-- Adds explicit bracket lanes and progression links while retaining existing match rows.
alter table public.tournament_matches
  add column if not exists bracket_section text not null default 'winners'
    check (bracket_section in ('winners','losers','grand_final','grand_final_reset')),
  add column if not exists bracket_label text,
  add column if not exists winner_to_match_id uuid references public.tournament_matches(id) on delete set null,
  add column if not exists winner_to_slot text check (winner_to_slot in ('a','b')),
  add column if not exists loser_to_match_id uuid references public.tournament_matches(id) on delete set null,
  add column if not exists loser_to_slot text check (loser_to_slot in ('a','b'));

create or replace function private.sync_punix_double_elimination_bracket(p_tournament_id uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  t public.tournaments%rowtype;
  n integer;
  k integer := 0;
  w_rounds integer;
  w_size integer;
  l_rounds integer;
  l_size integer;
  r integer;
  i integer;
  v_existing integer;
  v_confirmed integer;
  v_pending integer;
  v_entry uuid;
  v_match uuid;
  v_map jsonb := '{}'::jsonb;
  v_key text;
  v_target_key text;
  v_target uuid;
  v_slot text;
  v_gf uuid;
  v_reset uuid;
begin
  select * into t from public.tournaments where id=p_tournament_id for update;
  if not found or t.format <> 'double_elimination' or t.status not in ('draft','upcoming','live') then return 0; end if;

  select count(*) filter(where status='confirmed'), count(*) filter(where status='pending')
    into v_confirmed,v_pending
  from public.tournament_registrations where tournament_id=p_tournament_id;

  select count(*) into v_existing from public.tournament_matches where tournament_id=p_tournament_id;
  if v_existing=0 then
    n := greatest(2,coalesce(t.max_participants,0),v_confirmed);
    n := least(512,n);
    while (1 << k) < n loop k:=k+1; end loop;
    n := 1 << k;
    w_rounds:=k;

    -- Winners bracket
    w_size:=n/2;
    for r in 1..w_rounds loop
      for i in 1..w_size loop
        insert into public.tournament_matches(tournament_id,round_number,match_number,status,bracket_section,bracket_label)
        values(p_tournament_id,r,i,'scheduled','winners','Winners · Round '||r)
        returning id into v_match;
        v_map:=v_map||jsonb_build_object('w:'||r||':'||i,v_match);
      end loop;
      w_size:=w_size/2;
    end loop;

    -- Losers bracket: two rounds for each winners-bracket round after the first.
    l_rounds:=greatest(0,2*w_rounds-2);
    for r in 1..l_rounds loop
      l_size:=n / (1 << ((r+3)/2));
      for i in 1..l_size loop
        insert into public.tournament_matches(tournament_id,round_number,match_number,status,bracket_section,bracket_label)
        values(p_tournament_id,r,i,'scheduled','losers','Losers · Round '||r)
        returning id into v_match;
        v_map:=v_map||jsonb_build_object('l:'||r||':'||i,v_match);
      end loop;
    end loop;

    insert into public.tournament_matches(tournament_id,round_number,match_number,status,bracket_section,bracket_label)
    values(p_tournament_id,1,1,'scheduled','grand_final','Grand Final')
    returning id into v_gf;
    v_map:=v_map||jsonb_build_object('gf',v_gf);
    insert into public.tournament_matches(tournament_id,round_number,match_number,status,bracket_section,bracket_label)
    values(p_tournament_id,1,1,'scheduled','grand_final_reset','Grand Final Reset (if necessary)')
    returning id into v_reset;
    v_map:=v_map||jsonb_build_object('gfr',v_reset);

    -- Winners advance to the next winners round; first-round losers enter Losers R1.
    for r in 1..w_rounds loop
      w_size:=n/(1<<r);
      for i in 1..w_size loop
        v_key:='w:'||r||':'||i;
        if r<w_rounds then
          v_target_key:='w:'||(r+1)||':'||((i+1)/2);
          v_target:=(v_map->>v_target_key)::uuid;
          v_slot:=case when mod(i,2)=1 then 'a' else 'b' end;
          update public.tournament_matches set winner_to_match_id=v_target,winner_to_slot=v_slot
          where id=(v_map->>v_key)::uuid;
        else
          update public.tournament_matches set winner_to_match_id=v_gf,winner_to_slot='a'
          where id=(v_map->>v_key)::uuid;
        end if;
        if r=1 then
          v_target_key:='l:1:'||((i+1)/2);
          v_target:=(v_map->>v_target_key)::uuid;
          v_slot:=case when mod(i,2)=1 then 'a' else 'b' end;
        else
          v_target_key:='l:'||(2*r-2)||':'||i;
          v_target:=(v_map->>v_target_key)::uuid;
          v_slot:='b';
        end if;
        update public.tournament_matches set loser_to_match_id=v_target,loser_to_slot=v_slot
        where id=(v_map->>v_key)::uuid;
      end loop;
    end loop;

    -- Losers bracket winners alternate between same-index and paired-index rounds.
    for r in 1..l_rounds loop
      l_size:=n / (1 << ((r+3)/2));
      for i in 1..l_size loop
        v_key:='l:'||r||':'||i;
        if r=l_rounds then
          update public.tournament_matches set winner_to_match_id=v_gf,winner_to_slot='b'
          where id=(v_map->>v_key)::uuid;
        elsif mod(r,2)=1 then
          v_target_key:='l:'||(r+1)||':'||i;
          v_target:=(v_map->>v_target_key)::uuid;
          update public.tournament_matches set winner_to_match_id=v_target,winner_to_slot='a'
          where id=(v_map->>v_key)::uuid;
        else
          v_target_key:='l:'||(r+1)||':'||((i+1)/2);
          v_target:=(v_map->>v_target_key)::uuid;
          v_slot:=case when mod(i,2)=1 then 'a' else 'b' end;
          update public.tournament_matches set winner_to_match_id=v_target,winner_to_slot=v_slot
          where id=(v_map->>v_key)::uuid;
        end if;
      end loop;
    end loop;
    update public.tournament_matches set winner_to_match_id=v_reset,winner_to_slot='a'
    where id=v_gf;
    update public.tournament_matches set bracket_label='Grand Final Reset (if necessary)'
    where id=v_reset;
  end if;

  -- Fill confirmed registrations into free opening Winners Bracket positions.
  for v_entry in
    select r.id from public.tournament_registrations r
    where r.tournament_id=p_tournament_id and r.status='confirmed'
      and not exists(select 1 from public.tournament_matches m where m.tournament_id=p_tournament_id
        and m.bracket_section='winners' and m.round_number=1
        and (m.participant_a_id=r.id or m.participant_b_id=r.id))
    order by r.reviewed_at asc nulls last,r.created_at asc,r.id
  loop
    select m.id into v_match from public.tournament_matches m
    where m.tournament_id=p_tournament_id and m.bracket_section='winners'
      and m.round_number=1 and m.status='scheduled'
      and (m.participant_a_id is null or m.participant_b_id is null)
    order by m.match_number
    limit 1 for update;
    if not found then raise exception 'The Double Elimination bracket has no free opening slots. Increase maximum participants.'; end if;
    update public.tournament_matches set
      participant_a_id=case when participant_a_id is null then v_entry else participant_a_id end,
      participant_b_id=case when participant_a_id is not null then v_entry else participant_b_id end
    where id=v_match;
  end loop;

  return (select count(*)::integer from public.tournament_matches where tournament_id=p_tournament_id);
end;
$$;
revoke all on function private.sync_punix_double_elimination_bracket(uuid) from public,anon,authenticated;

create or replace function private.route_punix_double_elimination_result()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_loser uuid;
begin
  if new.status <> 'completed' or new.winner_registration_id is null then return new; end if;
  if old.winner_registration_id is not distinct from new.winner_registration_id and old.status='completed' then return new; end if;
  v_loser:=case when new.winner_registration_id=new.participant_a_id then new.participant_b_id else new.participant_a_id end;

  if new.bracket_section='grand_final' then
    if new.winner_registration_id=new.participant_b_id then
      update public.tournament_matches set participant_a_id=new.participant_a_id,participant_b_id=new.participant_b_id,status='scheduled',winner_registration_id=null,score_a=null,score_b=null
      where id=new.winner_to_match_id;
    else
      update public.tournament_matches set status='completed',winner_registration_id=null
      where id=new.winner_to_match_id;
    end if;
    return new;
  end if;

  if new.winner_to_match_id is not null then
    update public.tournament_matches set
      participant_a_id=case when new.winner_to_slot='a' then new.winner_registration_id else participant_a_id end,
      participant_b_id=case when new.winner_to_slot='b' then new.winner_registration_id else participant_b_id end
    where id=new.winner_to_match_id;
  end if;
  if v_loser is not null and new.loser_to_match_id is not null then
    update public.tournament_matches set
      participant_a_id=case when new.loser_to_slot='a' then v_loser else participant_a_id end,
      participant_b_id=case when new.loser_to_slot='b' then v_loser else participant_b_id end
    where id=new.loser_to_match_id;
  end if;
  return new;
end;
$$;
revoke all on function private.route_punix_double_elimination_result() from public,anon,authenticated;
-- Keep the existing single-elimination tree advancement trigger. The new router
-- handles only double-elimination matches.
create or replace function private.route_punix_double_elimination_result()
returns trigger language plpgsql security definer set search_path = ''
as $
declare v_loser uuid; v_format text;
begin
  select t.format into v_format from public.tournaments t where t.id=new.tournament_id;
  if v_format <> 'double_elimination' then return new; end if;
  if new.status <> 'completed' or new.winner_registration_id is null then return new; end if;
  if old.winner_registration_id is not distinct from new.winner_registration_id and old.status='completed' then return new; end if;
  v_loser:=case when new.winner_registration_id=new.participant_a_id then new.participant_b_id else new.participant_a_id end;
  if new.bracket_section='grand_final' then
    if new.winner_registration_id=new.participant_b_id then
      update public.tournament_matches set participant_a_id=new.participant_a_id,participant_b_id=new.participant_b_id,status='scheduled',winner_registration_id=null,score_a=null,score_b=null
      where id=new.winner_to_match_id;
    else
      update public.tournament_matches set status='completed',winner_registration_id=null
      where id=new.winner_to_match_id;
    end if;
    return new;
  end if;
  if new.winner_to_match_id is not null then
    update public.tournament_matches set
      participant_a_id=case when new.winner_to_slot='a' then new.winner_registration_id else participant_a_id end,
      participant_b_id=case when new.winner_to_slot='b' then new.winner_registration_id else participant_b_id end
    where id=new.winner_to_match_id;
  end if;
  if v_loser is not null and new.loser_to_match_id is not null then
    update public.tournament_matches set
      participant_a_id=case when new.loser_to_slot='a' then v_loser else participant_a_id end,
      participant_b_id=case when new.loser_to_slot='b' then v_loser else participant_b_id end
    where id=new.loser_to_match_id;
  end if;
  return new;
end;
$;
revoke all on function private.route_punix_double_elimination_result() from public,anon,authenticated;
drop trigger if exists punix_route_double_elimination_result on public.tournament_matches;
create trigger punix_route_double_elimination_result
after update of winner_registration_id,status on public.tournament_matches
for each row execute function private.route_punix_double_elimination_result();

create or replace function private.try_auto_generate_punix_bracket()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_format text;
begin
  if tg_table_name='tournaments' then v_id:=new.id; else v_id:=new.tournament_id; end if;
  select format into v_format from public.tournaments where id=v_id;
  if v_format='double_elimination' then
    perform private.sync_punix_double_elimination_bracket(v_id);
  elsif v_format='single_elimination' then
    perform private.sync_punix_single_elimination_bracket(v_id);
  end if;
  return new;
end;
$$;
revoke all on function private.try_auto_generate_punix_bracket() from public,anon,authenticated;

drop trigger if exists punix_auto_bracket_on_registration_close on public.tournaments;
drop trigger if exists punix_auto_bracket_after_application_review on public.tournament_registrations;
drop trigger if exists punix_auto_bracket_on_tournament_change on public.tournaments;
create trigger punix_auto_bracket_on_tournament_change
after insert or update of format,registration_open,status,max_participants on public.tournaments
for each row execute function private.try_auto_generate_punix_bracket();
create trigger punix_auto_bracket_after_application_review
after update of status on public.tournament_registrations
for each row execute function private.try_auto_generate_punix_bracket();

-- Backfill testing tournaments already configured as Double Elimination.
do $$
declare x uuid;
begin
  for x in select id from public.tournaments where format='double_elimination' and status in ('draft','upcoming','live')
  loop perform private.sync_punix_double_elimination_bracket(x); end loop;
end $$;
notify pgrst,'reload schema';
