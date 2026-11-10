-- PUNIX Media Center: channels, live status and homepage video library.
-- Run in Supabase SQL Editor. Safe to run once; all objects are idempotent.

create table if not exists public.punix_media_channels (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('twitch','kick','youtube')),
  channel_handle text not null check (char_length(channel_handle) between 1 and 120),
  display_name text not null check (char_length(display_name) between 1 and 80),
  game_name text null check (game_name is null or char_length(game_name) <= 80),
  is_active boolean not null default true,
  is_featured boolean not null default false,
  auto_import_videos boolean not null default true,
  sort_order integer not null default 0,
  is_live boolean not null default false,
  live_title text null,
  live_url text null,
  live_video_id text null,
  viewer_count integer null,
  thumbnail_url text null,
  live_started_at timestamptz null,
  last_checked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint punix_media_channels_platform_handle_unique unique (platform, channel_handle)
);

create table if not exists public.punix_media_videos (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid null references public.punix_media_channels(id) on delete set null,
  platform text not null check (platform in ('twitch','kick','youtube')),
  external_video_id text null,
  title text not null check (char_length(title) between 1 and 140),
  creator_name text not null check (char_length(creator_name) between 1 and 80),
  video_url text not null check (video_url ~* '^https://'),
  thumbnail_url text null check (thumbnail_url is null or thumbnail_url ~* '^https://'),
  published_at timestamptz null,
  is_featured boolean not null default false,
  is_published boolean not null default true,
  source text not null default 'manual' check (source in ('manual','auto')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists punix_media_channels_active_order_idx on public.punix_media_channels (is_active, sort_order);
create index if not exists punix_media_videos_published_order_idx on public.punix_media_videos (is_published, is_featured, sort_order, published_at desc);
create unique index if not exists punix_media_videos_external_unique on public.punix_media_videos (platform, external_video_id) where external_video_id is not null;

create table if not exists public.punix_media_sync_state (
  id integer primary key default 1 check (id = 1),
  last_synced_at timestamptz null,
  last_result jsonb not null default '{}'::jsonb
);
insert into public.punix_media_sync_state (id) values (1) on conflict (id) do nothing;

alter table public.punix_media_channels enable row level security;
alter table public.punix_media_videos enable row level security;
alter table public.punix_media_sync_state enable row level security;

revoke all on public.punix_media_channels from anon, authenticated;
revoke all on public.punix_media_videos from anon, authenticated;
revoke all on public.punix_media_sync_state from anon, authenticated;
grant select on public.punix_media_channels to anon, authenticated;
grant insert, update, delete on public.punix_media_channels to authenticated;
grant select on public.punix_media_videos to anon, authenticated;
grant insert, update, delete on public.punix_media_videos to authenticated;

drop policy if exists "Public read active PUNIX media channels" on public.punix_media_channels;
create policy "Public read active PUNIX media channels" on public.punix_media_channels
for select to anon, authenticated using (is_active = true);

drop policy if exists "Admins manage PUNIX media channels" on public.punix_media_channels;
create policy "Admins manage PUNIX media channels" on public.punix_media_channels
for all to authenticated using ((select private.has_role('admin')))
with check ((select private.has_role('admin')));

drop policy if exists "Public read published PUNIX videos" on public.punix_media_videos;
create policy "Public read published PUNIX videos" on public.punix_media_videos
for select to anon, authenticated using (is_published = true);

drop policy if exists "Admins manage PUNIX media videos" on public.punix_media_videos;
create policy "Admins manage PUNIX media videos" on public.punix_media_videos
for all to authenticated using ((select private.has_role('admin')))
with check ((select private.has_role('admin')));

revoke all on public.punix_media_sync_state from public, anon, authenticated;
