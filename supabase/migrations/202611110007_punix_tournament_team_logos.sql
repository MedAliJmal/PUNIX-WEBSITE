-- PUNIX INDEPENDENT TOURNAMENT TEAM LOGOS
-- Public can view confirmed team logos; applicants can upload only into their own
-- folder for an open team tournament. PUNIX admins can remove stored files.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('tournament-team-logos','tournament-team-logos',true,3145728,array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "PUNIX tournament team logos are publicly readable" on storage.objects;
create policy "PUNIX tournament team logos are publicly readable" on storage.objects for select to anon,authenticated using (bucket_id='tournament-team-logos');
drop policy if exists "Applicants upload their own tournament team logo" on storage.objects;
create policy "Applicants upload their own tournament team logo" on storage.objects for insert to authenticated with check (
 bucket_id='tournament-team-logos' and (storage.foldername(name))[2]=(select auth.uid())::text
 and exists (select 1 from public.tournaments t where t.id=((storage.foldername(name))[1])::uuid and t.entry_type='team' and t.status='upcoming' and t.registration_open and (t.registration_deadline is null or t.registration_deadline>now()))
);
drop policy if exists "PUNIX admins delete tournament team logos" on storage.objects;
create policy "PUNIX admins delete tournament team logos" on storage.objects for delete to authenticated using (bucket_id='tournament-team-logos' and (select private.has_role('admin')));
alter table public.tournament_registrations add column if not exists team_logo_url text not null default '';
alter table public.tournament_registrations drop constraint if exists tournament_registrations_team_logo_url_https;
alter table public.tournament_registrations add constraint tournament_registrations_team_logo_url_https check (team_logo_url='' or team_logo_url ~* '^https://');
drop view if exists public.public_tournament_matches;
drop view if exists public.public_tournament_registrations;
create view public.public_tournament_registrations with (security_barrier=true) as
select r.id,r.tournament_id,r.team_id,r.in_game_name,r.status,r.created_at,
 case when r.team_name<>'' then r.team_name when r.team_id is not null then tm.team_name else r.in_game_name end as display_name,
 r.team_name,
 case when coalesce(r.team_name,'')<>'' then jsonb_build_array(jsonb_build_object('role','starter','in_game_name',r.in_game_name)) || coalesce((select jsonb_agg(jsonb_build_object('role',p.player->>'role','in_game_name',p.player->>'in_game_name') order by p.ordinality) from jsonb_array_elements(r.roster) with ordinality as p(player,ordinality)),'[]'::jsonb) else '[]'::jsonb end as roster_public,
 r.team_logo_url
from public.tournament_registrations r left join public.teams tm on tm.id=r.team_id where r.status='confirmed';
create view public.public_tournament_matches with (security_barrier=true) as
select m.id,m.tournament_id,m.round_number,m.match_number,m.participant_a_id,m.participant_b_id,m.score_a,m.score_b,m.winner_registration_id,m.scheduled_at,m.status,a.display_name as participant_a_name,b.display_name as participant_b_name
from public.tournament_matches m left join public.public_tournament_registrations a on a.id=m.participant_a_id left join public.public_tournament_registrations b on b.id=m.participant_b_id;
revoke all on public.public_tournament_registrations,public.public_tournament_matches from public,anon,authenticated;
grant select on public.public_tournament_registrations,public.public_tournament_matches to anon,authenticated;
notify pgrst,'reload schema';
