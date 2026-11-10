-- PUNIX Media Center V2: TikTok + Instagram content support.
-- Run AFTER 202611100001_punix_media_center.sql.
-- Existing rows and permissions are preserved.

alter table public.punix_media_channels
  drop constraint if exists punix_media_channels_platform_check;
alter table public.punix_media_channels
  add constraint punix_media_channels_platform_check
  check (platform in ('twitch','kick','youtube','tiktok','instagram'));

alter table public.punix_media_videos
  drop constraint if exists punix_media_videos_platform_check;
alter table public.punix_media_videos
  add constraint punix_media_videos_platform_check
  check (platform in ('twitch','kick','youtube','tiktok','instagram'));

alter table public.punix_media_videos
  add column if not exists content_kind text not null default 'video';

alter table public.punix_media_videos
  drop constraint if exists punix_media_videos_content_kind_check;
alter table public.punix_media_videos
  add constraint punix_media_videos_content_kind_check
  check (content_kind in ('video','clip','short','reel','post'));

alter table public.punix_media_channels
  add column if not exists live_check_status text not null default 'pending';

alter table public.punix_media_channels
  drop constraint if exists punix_media_channels_live_check_status_check;
alter table public.punix_media_channels
  add constraint punix_media_channels_live_check_status_check
  check (live_check_status in ('pending','checked','unsupported','error'));

create index if not exists punix_media_videos_platform_kind_idx
  on public.punix_media_videos (platform, content_kind, is_published, published_at desc);

comment on column public.punix_media_channels.live_check_status is
  'checked = supported platform checked; unsupported = no generally available official live-status API for this channel integration; pending/error = not yet checked or failed.';
comment on column public.punix_media_videos.content_kind is
  'Content format: video, clip, short, reel, or post.';
