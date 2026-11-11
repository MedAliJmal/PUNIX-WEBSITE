-- PUNIX LATEST UPDATE IMAGE STORAGE
-- Publicly readable update artwork; uploads and changes restricted to PUNIX admins.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('latest-update-images', 'latest-update-images', true, 5242880, array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "PUNIX latest update images are publicly readable" on storage.objects;
create policy "PUNIX latest update images are publicly readable"
on storage.objects for select to anon, authenticated
using (bucket_id = 'latest-update-images' and (select private.has_role('admin')));

drop policy if exists "PUNIX admins upload latest update images" on storage.objects;
create policy "PUNIX admins upload latest update images"
on storage.objects for insert to authenticated
with check (bucket_id = 'latest-update-images' and (select private.has_role('admin')));

drop policy if exists "PUNIX admins update latest update images" on storage.objects;
create policy "PUNIX admins update latest update images"
on storage.objects for update to authenticated
using (bucket_id = 'latest-update-images' and (select private.has_role('admin')))
with check (bucket_id = 'latest-update-images' and (select private.has_role('admin')));

drop policy if exists "PUNIX admins delete latest update images" on storage.objects;
create policy "PUNIX admins delete latest update images"
on storage.objects for delete to authenticated
using (bucket_id = 'latest-update-images');
