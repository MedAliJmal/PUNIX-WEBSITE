-- Fix tournament entry INSERT checks for authenticated non-staff users.
-- The previous policy queried public.tournaments directly. Its RLS policies
-- intentionally hide that table from ordinary members, causing EXISTS to
-- return false even for valid, open tournaments.
--
-- This narrowly scoped SECURITY DEFINER helper checks only whether the
-- supplied entry is eligible. It does not grant table SELECT access.

create or replace function private.can_submit_tournament_entry(
  p_tournament_id uuid,
  p_team_id uuid,
  p_team_name text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tournaments t
    where t.id = p_tournament_id
      and t.status = 'upcoming'
      and t.registration_open
      and (t.registration_deadline is null or t.registration_deadline > now())
      and (
        (
          t.entry_type = 'solo'
          and p_team_id is null
          and coalesce(p_team_name, '') = ''
        )
        or
        (
          t.entry_type = 'team'
          and p_team_id is null
          and char_length(btrim(coalesce(p_team_name, ''))) between 2 and 80
        )
        or
        (
          t.entry_type = 'team'
          and p_team_id is not null
          and coalesce(p_team_name, '') = ''
          and private.is_team_captain(
            p_team_id,
            (select auth.uid()),
            t.game_name
          )
        )
      )
  );
$$;

revoke all on function private.can_submit_tournament_entry(uuid, uuid, text)
  from public, anon;
grant execute on function private.can_submit_tournament_entry(uuid, uuid, text)
  to authenticated;

drop policy if exists "PUNIX users register themselves"
  on public.tournament_registrations;

create policy "PUNIX users register themselves"
on public.tournament_registrations
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and status = 'pending'
  and reviewed_at is null
  and reviewed_by is null
  and private.can_submit_tournament_entry(
    tournament_id,
    team_id,
    team_name
  )
);

notify pgrst, 'reload schema';
