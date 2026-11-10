-- Allow any authenticated PUNIX member to submit a team entry as captain.
-- A team can still enter only once per tournament because of the existing
-- unique index on (tournament_id, team_id).
drop policy if exists "PUNIX users register themselves" on public.tournament_registrations;

create policy "PUNIX users register themselves"
on public.tournament_registrations
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and status = 'pending'
  and reviewed_at is null
  and reviewed_by is null
  and exists (
    select 1
    from public.tournaments t
    where t.id = tournament_id
      and t.status = 'upcoming'
      and t.registration_open
      and (t.registration_deadline is null or t.registration_deadline > now())
      and (
        (t.entry_type = 'solo' and team_id is null)
        or (
          t.entry_type = 'team'
          and team_id is not null
          and exists (
            select 1
            from public.teams tm
            where tm.id = team_id
              and lower(tm.game_name) = lower(t.game_name)
              and tm.status in ('active', 'recruiting')
          )
        )
      )
  )
);

notify pgrst, 'reload schema';
