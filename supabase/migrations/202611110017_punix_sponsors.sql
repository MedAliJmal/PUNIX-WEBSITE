-- PUNIX SPONSORS / PARTNERS
-- Public can view published partners. Only PUNIX admins can manage records and logo files.
create table if not exists public.sponsors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 90),
  logo_url text not null default '',
  website_url text not null default '',
  display_order integer not null default 0 check (display_order between 0 and 999),
  is_featured boolean not null default false,
  is_published boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sponsors_public_order_idx on public.sponsors (is_published, display_order, is_featured desc);
alter table public.sponsors enable row level security;
drop policy if exists "Public can read published sponsors" on public.sponsors;
create policy "Public can read published sponsors" on public.sponsors for select to anon, authenticated using (is_published = true);
drop policy if exists "Admins read all sponsors" on public.sponsors;
create policy "Admins read all sponsors" on public.sponsors for select to authenticated using ((select private.has_role('admin')));
drop policy if exists "Admins manage sponsors" on public.sponsors;
create policy "Admins manage sponsors" on public.sponsors for all to authenticated using ((select private.has_role('admin'))) with check ((select private.has_role('admin')));
revoke all on table public.sponsors from anon, authenticated;
grant select on table public.sponsors to anon, authenticated;
grant insert, update, delete on table public.sponsors to authenticated;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('sponsor-logos','sponsor-logos',true,5242880,array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict (id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "PUNIX sponsor logos are publicly readable" on storage.objects;
create policy "PUNIX sponsor logos are publicly readable" on storage.objects for select to anon, authenticated using (bucket_id='sponsor-logos');
drop policy if exists "PUNIX admins upload sponsor logos" on storage.objects;
create policy "PUNIX admins upload sponsor logos" on storage.objects for insert to authenticated with check (bucket_id='sponsor-logos' and (select private.has_role('admin')));
drop policy if exists "PUNIX admins update sponsor logos" on storage.objects;
create policy "PUNIX admins update sponsor logos" on storage.objects for update to authenticated using (bucket_id='sponsor-logos' and (select private.has_role('admin'))) with check (bucket_id='sponsor-logos' and (select private.has_role('admin')));
drop policy if exists "PUNIX admins delete sponsor logos" on storage.objects;
create policy "PUNIX admins delete sponsor logos" on storage.objects for delete to authenticated using (bucket_id='sponsor-logos' and (select private.has_role('admin')));
notify pgrst,'reload schema';
