-- PUNIX member profile fields. Run once in Supabase SQL Editor.
alter table public.profiles
  add column if not exists avatar_url text not null default '',
  add column if not exists bio text not null default '',
  add column if not exists twitch_url text not null default '',
  add column if not exists kick_url text not null default '',
  add column if not exists youtube_url text not null default '',
  add column if not exists tiktok_url text not null default '';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_bio_length_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_bio_length_check check (char_length(bio) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_avatar_url_https_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_avatar_url_https_check check (avatar_url = '' or avatar_url ~* '^https://');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_twitch_url_https_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_twitch_url_https_check check (twitch_url = '' or twitch_url ~* '^https://');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_kick_url_https_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_kick_url_https_check check (kick_url = '' or kick_url ~* '^https://');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_youtube_url_https_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_youtube_url_https_check check (youtube_url = '' or youtube_url ~* '^https://');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_tiktok_url_https_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_tiktok_url_https_check check (tiktok_url = '' or tiktok_url ~* '^https://');
  end if;
end $$;
