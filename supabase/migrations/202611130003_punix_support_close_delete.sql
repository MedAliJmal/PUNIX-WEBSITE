-- PUNIX LIVE SUPPORT: DELETE CONVERSATION WHEN ADMIN CLOSES IT
-- Deleting the parent row cascades to support_messages, clearing the full transcript.
-- Only authenticated PUNIX admins may invoke this operation.

create or replace function public.punix_support_close_and_delete(
  p_conversation_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted_id uuid;
begin
  if auth.uid() is null
     or not (select private.has_role('admin') or private.has_role('super_admin')) then
    raise exception 'Only PUNIX administrators can close support conversations.';
  end if;

  delete from public.support_conversations
   where id = p_conversation_id
  returning id into v_deleted_id;

  if v_deleted_id is null then
    raise exception 'This support conversation no longer exists.';
  end if;
end;
$$;

revoke all on function public.punix_support_close_and_delete(uuid) from public, anon;
grant execute on function public.punix_support_close_and_delete(uuid) to authenticated;

notify pgrst, 'reload schema';
