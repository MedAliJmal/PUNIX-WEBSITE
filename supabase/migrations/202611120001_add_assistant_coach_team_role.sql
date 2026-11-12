-- Add Assistant Coach as a supported PUNIX team roster role.
-- Existing roster assignments remain unchanged.
alter table public.team_members
  drop constraint if exists team_members_member_role_check;

alter table public.team_members
  add constraint team_members_member_role_check
  check (member_role in ('captain','player','coach','assistant_coach','manager','substitute'));

notify pgrst, 'reload schema';
