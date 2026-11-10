-- PUNIX Latest Updates: admin-managed homepage news cards
create table if not exists public.latest_updates (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  category text not null default 'ANNOUNCEMENTS' check (char_length(category) between 1 and 40),
  summary text not null check (char_length(summary) between 1 and 300),
  image_url text not null default '',
  link_url text not null default '',
  link_label text not null default 'READ MORE',
  published_at date not null default current_date,
  display_order integer not null default 0 check (display_order between 0 and 999),
  is_published boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists latest_updates_public_order_idx on public.latest_updates (is_published, display_order, published_at desc);
alter table public.latest_updates enable row level security;
drop policy if exists "Public can read published latest updates" on public.latest_updates;
create policy "Public can read published latest updates" on public.latest_updates for select to anon, authenticated using (is_published = true);
drop policy if exists "Admins read all latest updates" on public.latest_updates;
create policy "Admins read all latest updates" on public.latest_updates for select to authenticated using ((select private.has_role('admin')));
drop policy if exists "Admins manage latest updates" on public.latest_updates;
create policy "Admins manage latest updates" on public.latest_updates for all to authenticated using ((select private.has_role('admin'))) with check ((select private.has_role('admin')));
revoke all on table public.latest_updates from anon, authenticated;
grant select on table public.latest_updates to anon, authenticated;
grant insert, update, delete on table public.latest_updates to authenticated;
notify pgrst, 'reload schema';
