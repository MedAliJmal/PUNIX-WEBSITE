-- PUNIX Google OAuth profile metadata compatibility
-- The existing auth trigger already assigns member/admin roles securely via the private whitelist.
-- Google commonly supplies full_name/name rather than display_name; use those fields for new profiles.

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  approved_role text;
  safe_name text;
begin
  select w.role into approved_role
  from private.admin_whitelist w
  where w.email = lower(btrim(new.email));

  safe_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(coalesce(new.email, 'PUNIX Member'), '@', 1)
  );
  safe_name := left(safe_name, 60);

  insert into public.profiles (id, display_name)
  values (new.id, safe_name)
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, coalesce(approved_role, 'member'))
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;
