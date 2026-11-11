-- PUNIX: notify signed-in members when a creator goes live or new content is published.
-- Recipients are existing PUNIX profiles. Notifications link back to the relevant
-- homepage section so the current notification center can open them safely.

create or replace function private.notify_punix_creator_live()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications
    (user_id, notification_type, title, body, link, metadata)
  select
    p.id,
    'creator_live',
    'PUNIX CREATOR IS LIVE',
    coalesce(new.display_name, 'A PUNIX creator') || ' is live on ' ||
      upper(new.platform) || coalesce(' — ' || nullif(new.live_title, ''), '') || '.',
    '/index.html#watch',
    jsonb_build_object(
      'channel_id', new.id,
      'creator_name', new.display_name,
      'platform', new.platform,
      'game_name', new.game_name,
      'stream_title', new.live_title,
      'stream_url', new.live_url
    )
  from public.profiles p;

  return new;
end;
$$;

revoke all on function private.notify_punix_creator_live() from public, anon, authenticated;

drop trigger if exists punix_notify_creator_live on public.punix_media_channels;
create trigger punix_notify_creator_live
  after update of is_live on public.punix_media_channels
  for each row
  when (new.is_live is true and old.is_live is distinct from true)
  execute function private.notify_punix_creator_live();


create or replace function private.notify_punix_latest_update_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_published is distinct from true then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.is_published is true then
      return new;
    end if;
  end if;

  insert into public.notifications
    (user_id, notification_type, title, body, link, metadata)
  select
    p.id,
    'content_published',
    'NEW PUNIX UPDATE',
    coalesce(nullif(new.category, ''), 'PUNIX') || ': ' || new.title ||
      coalesce(' — ' || nullif(new.summary, ''), ''),
    '/index.html#news',
    jsonb_build_object(
      'update_id', new.id,
      'category', new.category,
      'title', new.title,
      'published_at', new.published_at
    )
  from public.profiles p;

  return new;
end;
$$;

revoke all on function private.notify_punix_latest_update_published() from public, anon, authenticated;

drop trigger if exists punix_notify_latest_update_published on public.latest_updates;
create trigger punix_notify_latest_update_published
  after insert or update of is_published on public.latest_updates
  for each row
  execute function private.notify_punix_latest_update_published();


create or replace function private.notify_punix_video_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_published is distinct from true then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.is_published is true then
      return new;
    end if;
  elsif new.source = 'auto' then
    -- Avoid notifying everyone about old back-catalogue videos imported on first sync.
    if new.published_at is null or new.published_at < now() - interval '2 hours' then
      return new;
    end if;
  end if;

  insert into public.notifications
    (user_id, notification_type, title, body, link, metadata)
  select
    p.id,
    'content_published',
    'NEW PUNIX CONTENT',
    coalesce(nullif(new.creator_name, ''), 'A PUNIX creator') ||
      ' published ' || coalesce(nullif(new.title, ''), 'new content') ||
      ' on ' || upper(new.platform) || '.',
    '/index.html#watch',
    jsonb_build_object(
      'video_id', new.id,
      'creator_name', new.creator_name,
      'platform', new.platform,
      'content_kind', new.content_kind,
      'video_url', new.video_url
    )
  from public.profiles p;

  return new;
end;
$$;

revoke all on function private.notify_punix_video_published() from public, anon, authenticated;

drop trigger if exists punix_notify_video_published on public.punix_media_videos;
create trigger punix_notify_video_published
  after insert or update of is_published on public.punix_media_videos
  for each row
  execute function private.notify_punix_video_published();

notify pgrst, 'reload schema';
