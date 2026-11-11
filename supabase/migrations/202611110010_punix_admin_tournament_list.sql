-- PUNIX ADMIN TOURNAMENT LIST ACCESS
-- Provides a narrowly scoped admin-only list function so the control room
-- can retrieve every tournament (including drafts) without relying on the
-- browser's direct table SELECT/RLS path.

create or replace function public.admin_list_tournaments()
returns setof public.tournaments
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(private.has_role('admin'), false) then
    raise exception 'Administrator access required.'
      using errcode = '42501';
  end if;

  return query
    select t.*
    from public.tournaments as t
    order by t.created_at desc;
end;
$$;

revoke all on function public.admin_list_tournaments() from public, anon;
grant execute on function public.admin_list_tournaments() to authenticated;

notify pgrst, 'reload schema';
