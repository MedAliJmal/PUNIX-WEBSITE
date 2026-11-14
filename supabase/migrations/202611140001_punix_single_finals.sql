-- PUNIX: use a single Lower Bracket Final and a single Grand Final.
-- Remove legacy reset rows and stop creating/routing to a Grand Final Reset.

delete from public.tournament_matches
where bracket_section='grand_final_reset'
  and status='scheduled'
  and winner_registration_id is null
  and score_a is null
  and score_b is null;

update public.tournament_matches
set winner_to_match_id=null, winner_to_slot=null
where bracket_section='grand_final';

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
begin
  select * into t from public.tournaments where id=p_tournament_id for update;
  if not found or t.format <> 'double_elimination' or t.status not in ('draft','upcoming','live') then return 0; end if;

  select count(*) filter(where status='confirmed'), count(*) filter(where status='pending')
    into v_confirmed,v_pending
  from public.tournament_registrations where tournament_id=p_tournament_id;

  select count(*) into v_existing from public.tournament_matches where tournament_id=p_tournament_id;
  -- During testing, allow a clean conversion from an unplayed single-elimination
  -- bracket. Never erase live/completed matches or recorded scores.
  if v_existing>0
     and exists(select 1 from public.tournament_matches m where m.tournament_id=p_tournament_id and m.bracket_section='winners')
     and not exists(select 1 from public.tournament_matches m where m.tournament_id=p_tournament_id
       and (m.status<>'scheduled' or m.winner_registration_id is not null or m.score_a is not null or m.score_b is not null)) then
    delete from public.tournament_matches where tournament_id=p_tournament_id;
    v_existing:=0;
  end if;
  if v_existing>0 and not exists(select 1 from public.tournament_matches m where m.tournament_id=p_tournament_id and m.bracket_section='losers') then
    raise exception 'This tournament already has played matches. The bracket cannot be converted automatically.';
  end if;
  if v_existing=0 then
    n := greatest(4,coalesce(t.max_participants,0),v_confirmed);
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
        values(p_tournament_id,w_rounds+r,i,'scheduled','losers','Losers · Round '||r)
        returning id into v_match;
        v_map:=v_map||jsonb_build_object('l:'||r||':'||i,v_match);
      end loop;
    end loop;

    insert into public.tournament_matches(tournament_id,round_number,match_number,status,bracket_section,bracket_label)
    values(p_tournament_id,w_rounds+l_rounds+1,1,'scheduled','grand_final','Grand Final')
    returning id into v_gf;
    v_map:=v_map||jsonb_build_object('gf',v_gf);

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

  -- Once registration is closed and every application is reviewed, resolve
  -- genuine byes only after every feeder match for that slot has finished.
  if not t.registration_open and coalesce(v_pending,0)=0 then
    loop
      update public.tournament_matches m
         set status='completed',
             winner_registration_id=coalesce(m.participant_a_id,m.participant_b_id)
       where m.tournament_id=p_tournament_id
         and m.bracket_section in ('winners','losers')
         and m.status='scheduled'
         and ((m.participant_a_id is null) <> (m.participant_b_id is null))
         and not exists (
           select 1 from public.tournament_matches feeder
           where feeder.tournament_id=p_tournament_id
             and (feeder.winner_to_match_id=m.id or feeder.loser_to_match_id=m.id)
             and feeder.status<>'completed'
         );
      get diagnostics v_existing = row_count;
      update public.tournament_matches m
         set status='completed',winner_registration_id=null
       where m.tournament_id=p_tournament_id
         and m.bracket_section in ('winners','losers')
         and m.status='scheduled'
         and m.participant_a_id is null and m.participant_b_id is null
         and not exists (
           select 1 from public.tournament_matches feeder
           where feeder.tournament_id=p_tournament_id
             and (feeder.winner_to_match_id=m.id or feeder.loser_to_match_id=m.id)
             and feeder.status<>'completed'
         );
      get diagnostics v_confirmed = row_count;
      exit when v_existing=0 and v_confirmed=0;
    end loop;
  end if;

  return (select count(*)::integer from public.tournament_matches where tournament_id=p_tournament_id);
end;
$$;

revoke all on function private.sync_punix_double_elimination_bracket(uuid) from public, anon, authenticated;

create or replace function private.route_punix_double_elimination_result()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_loser uuid; v_format text;
begin
  select t.format into v_format from public.tournaments t where t.id=new.tournament_id;
  if v_format <> 'double_elimination' then return new; end if;
  if new.status <> 'completed' or new.winner_registration_id is null then return new; end if;
  if old.winner_registration_id is not distinct from new.winner_registration_id and old.status='completed' then return new; end if;
  v_loser:=case when new.winner_registration_id=new.participant_a_id then new.participant_b_id else new.participant_a_id end;
  if new.bracket_section='grand_final' then
    -- One decisive Grand Final; there is no reset match.
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

revoke all on function private.route_punix_double_elimination_result() from public, anon, authenticated;

notify pgrst, 'reload schema';
