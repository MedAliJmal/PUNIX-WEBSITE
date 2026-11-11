-- PUNIX TEAM LOGO STORAGE
-- Public read access for published team logos; only PUNIX admins can upload, replace or delete.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('team-logos', 'team-logos', true, 3145728, array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "PUNIX team logos are publicly readable" on storage.objects;
create policy "PUNIX team logos are publicly readable"
on storage.objects for select to anon, authenticated
using (bucket_id = 'team-logos');

drop policy if exists "PUNIX admins upload team logos" on storage.objects;
create policy "PUNIX admins upload team logos"
on storage.objects for insert to authenticated
with check (bucket_id = 'team-logos' and (select private.has_role('admin')));

drop policy if exists "PUNIX admins update team logos" on storage.objects;
create policy "PUNIX admins update team logos"
on storage.objects for update to authenticated
using (bucket_id = 'team-logos' and (select private.has_role('admin')))
with check (bucket_id = 'team-logos' and (select private.has_role('admin')));

drop policy if exists "PUNIX admins delete team logos" on storage.objects;
create policy "PUNIX admins delete team logos"
on storage.objects for delete to authenticated
using (bucket_id = 'team-logos' and (select private.has_role('admin')));

