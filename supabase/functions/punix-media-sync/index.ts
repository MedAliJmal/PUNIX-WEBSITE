import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const env = (name: string) => Deno.env.get(name) || "";

async function fetchJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

async function twitchToken() {
  const id = env("TWITCH_CLIENT_ID"), secret = env("TWITCH_CLIENT_SECRET");
  if (!id || !secret) return null;
  const url = new URL("https://id.twitch.tv/oauth2/token");
  url.searchParams.set("client_id", id); url.searchParams.set("client_secret", secret); url.searchParams.set("grant_type", "client_credentials");
  const data = await fetchJson(url.toString(), { method: "POST" });
  return data.access_token as string;
}
async function kickToken() {
  const id = env("KICK_CLIENT_ID"), secret = env("KICK_CLIENT_SECRET");
  if (!id || !secret) return null;
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret });
  const data = await fetchJson("https://id.kick.com/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  return data.access_token as string;
}

async function saveVideo(db: any, row: Record<string, unknown>) {
  const { data: existing } = await db.from("punix_media_videos").select("id").eq("platform", row.platform).eq("external_video_id", row.external_video_id).maybeSingle();
  if (existing?.id) await db.from("punix_media_videos").update(row).eq("id", existing.id);
  else await db.from("punix_media_videos").insert(row);
}

async function syncTwitch(db: any, channel: any, token: string, now: string) {
  const headers = { "Client-Id": env("TWITCH_CLIENT_ID"), Authorization: `Bearer ${token}` };
  const userData = await fetchJson(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(channel.channel_handle)}`, { headers });
  const user = userData.data?.[0];
  if (!user) { await db.from("punix_media_channels").update({ is_live:false, last_checked_at:now }).eq("id",channel.id); return "channel_not_found"; }
  const streamData = await fetchJson(`https://api.twitch.tv/helix/streams?user_id=${encodeURIComponent(user.id)}`, { headers });
  const stream = streamData.data?.[0] || null;
  await db.from("punix_media_channels").update({ is_live:!!stream, live_title:stream?.title || null, live_url:stream ? `https://twitch.tv/${channel.channel_handle}` : null, live_video_id:null, viewer_count:stream?.viewer_count ?? null, thumbnail_url:stream?.thumbnail_url?.replace('{width}','640').replace('{height}','360') || null, live_started_at:stream?.started_at || null, last_checked_at:now }).eq("id",channel.id);
  if (channel.auto_import_videos) {
    const videoData = await fetchJson(`https://api.twitch.tv/helix/videos?user_id=${encodeURIComponent(user.id)}&first=5&sort=time&type=archive`, { headers });
    for (const v of (videoData.data || [])) await saveVideo(db, { channel_id:channel.id, platform:"twitch", external_video_id:v.id, title:v.title || "Twitch video", creator_name:channel.display_name, video_url:v.url, thumbnail_url:(v.thumbnail_url || "").replace('%{width}','640').replace('%{height}','360') || null, published_at:v.created_at || null, source:"auto", is_published:true, sort_order:0 });
  }
  return stream ? "live" : "offline";
}

async function syncKick(db: any, channel: any, token: string, now: string) {
  const headers = { Authorization: `Bearer ${token}` };
  const slug = String(channel.channel_handle || '').trim().replace(/^@/, '').toLowerCase();
  if (!slug) throw new Error('Kick channel handle is empty. Enter the Kick username without @.');

  // Resolve the channel first so we can use its stable broadcaster_user_id.
  const channelsData = await fetchJson(`https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(slug)}`, { headers });
  const found = channelsData.data?.[0];
  if (!found) {
    await db.from('punix_media_channels').update({ is_live:false, live_title:null, live_url:null, live_video_id:null, viewer_count:null, last_checked_at:now, live_check_status:'checked' }).eq('id',channel.id);
    return 'channel_not_found';
  }

  const broadcasterId = found.broadcaster_user_id;
  if (!broadcasterId) throw new Error('Kick returned the channel but no broadcaster_user_id.');

  // IMPORTANT: Kick's V2 livestream endpoint does not support the
  // broadcaster_user_id filter. V1 still supports it. The previous V2
  // request could return an empty/unfiltered result and falsely mark a live
  // channel as offline.
  const streamsData = await fetchJson(`https://api.kick.com/public/v1/livestreams?broadcaster_user_id=${encodeURIComponent(broadcasterId)}`, { headers });
  const stream = streamsData.data?.[0] || null;
  const channelStream = found.stream || null;
  const isLive = !!stream || channelStream?.is_live === true;
  const title = stream?.stream_title || (isLive ? (found.stream_title || channelStream?.title || null) : null);
  const liveUrl = isLive ? `https://kick.com/${slug}` : null;
  const viewerCount = stream?.viewer_count ?? (isLive ? channelStream?.viewer_count : null) ?? null;
  const thumbnail = stream?.thumbnail || (isLive ? channelStream?.thumbnail : null) || found.banner_picture || null;
  const startedAt = stream?.started_at || (isLive ? channelStream?.start_time : null) || null;

  const { error: updateError } = await db.from('punix_media_channels').update({
    channel_handle:slug,
    is_live:isLive,
    live_title:title,
    live_url:liveUrl,
    live_video_id:null,
    viewer_count:viewerCount,
    thumbnail_url:thumbnail,
    live_started_at:startedAt,
    last_checked_at:now,
    live_check_status:'checked'
  }).eq('id',channel.id);
  if (updateError) throw updateError;
  return isLive ? 'live' : 'offline';
}

async function syncYouTube(db: any, channel: any, apiKey: string, now: string) {
  const handle = channel.channel_handle;
  const channelParam = handle.startsWith("UC") ? `id=${encodeURIComponent(handle)}` : `forHandle=${encodeURIComponent(handle.startsWith('@') ? handle.slice(1) : handle)}`;
  const channelData = await fetchJson(`https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&${channelParam}&key=${encodeURIComponent(apiKey)}`);
  const ytChannel = channelData.items?.[0];
  if (!ytChannel) { await db.from("punix_media_channels").update({ is_live:false, last_checked_at:now }).eq("id",channel.id); return "channel_not_found"; }
  const channelId = ytChannel.id;
  const liveData = await fetchJson(`https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(channelId)}&eventType=live&type=video&maxResults=1&key=${encodeURIComponent(apiKey)}`);
  const live = liveData.items?.[0] || null;
  const liveVideoId = live?.id?.videoId || null;
  await db.from("punix_media_channels").update({ channel_handle:channelId, is_live:!!liveVideoId, live_title:live?.snippet?.title || null, live_url:liveVideoId ? `https://youtube.com/watch?v=${liveVideoId}` : null, live_video_id:liveVideoId, viewer_count:null, thumbnail_url:live?.snippet?.thumbnails?.high?.url || null, last_checked_at:now }).eq("id",channel.id);
  if (channel.auto_import_videos) {
    const uploads = ytChannel.contentDetails?.relatedPlaylists?.uploads;
    if (uploads) {
      const items = await fetchJson(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(uploads)}&maxResults=5&key=${encodeURIComponent(apiKey)}`);
      for (const item of (items.items || [])) {
        const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
        if (!videoId) continue;
        const thumb = item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || null;
        await saveVideo(db, { channel_id:channel.id, platform:"youtube", external_video_id:videoId, title:item.snippet?.title || "YouTube video", creator_name:channel.display_name, video_url:`https://www.youtube.com/watch?v=${videoId}`, thumbnail_url:thumb, published_at:item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt || null, source:"auto", is_published:true, sort_order:0 });
      }
    }
  }
  return liveVideoId ? "live" : "offline";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error:"Method not allowed" }, 405);
  try {
    const url = env("SUPABASE_URL");
    let serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    try { const keys = JSON.parse(env("SUPABASE_SECRET_KEYS") || "{}"); serviceKey = keys.default || serviceKey; } catch { /* legacy service role fallback */ }
    if (!url || !serviceKey) return json({ error:"Supabase server credentials are unavailable to this Edge Function." }, 500);
    const db = createClient(url, serviceKey, { auth:{ persistSession:false, autoRefreshToken:false } });
    const { data:state } = await db.from("punix_media_sync_state").select("last_synced_at").eq("id",1).maybeSingle();
    const last = state?.last_synced_at ? new Date(state.last_synced_at).getTime() : 0;
    if (Date.now() - last < 90000) return json({ ok:true, skipped:true, message:"Platform status was checked recently. The homepage will refresh again shortly." });
    const { data:channels, error } = await db.from("punix_media_channels").select("*").eq("is_active",true);
    if (error) throw error;
    const now = new Date().toISOString();
    const results: Array<{channel:string,platform:string,result:string}> = [];
    let twToken: string | null = null, kToken: string | null = null;
    for (const channel of (channels || [])) {
      try {
        let result = "not_configured";
        if (channel.platform === "twitch") {
          if (!env("TWITCH_CLIENT_ID") || !env("TWITCH_CLIENT_SECRET")) result = "missing_api_secrets";
          else { twToken ||= await twitchToken(); result = await syncTwitch(db,channel,twToken!,now); }
        } else if (channel.platform === "kick") {
          if (!env("KICK_CLIENT_ID") || !env("KICK_CLIENT_SECRET")) result = "missing_api_secrets";
          else { kToken ||= await kickToken(); result = await syncKick(db,channel,kToken!,now); }
        } else if (channel.platform === "youtube") {
          if (!env("YOUTUBE_API_KEY")) result = "missing_api_secrets";
          else result = await syncYouTube(db,channel,env("YOUTUBE_API_KEY"),now);
        } else if (channel.platform === "tiktok" || channel.platform === "instagram") {
          // Public creator live-state endpoints are not generally available for these integrations.
          // Keep the channel visible as a social profile; do not incorrectly mark it offline.
          await db.from("punix_media_channels").update({ live_check_status:"unsupported", last_checked_at:now }).eq("id",channel.id);
          result = "live_detection_not_available";
        }
        if (["live","offline","channel_not_found"].includes(result)) {
          await db.from("punix_media_channels").update({ live_check_status:"checked" }).eq("id",channel.id);
        }
        results.push({ channel:channel.display_name, platform:channel.platform, result });
      } catch (e) {
        await db.from("punix_media_channels").update({ live_check_status:"error", last_checked_at:now }).eq("id",channel.id);
        results.push({ channel:channel.display_name, platform:channel.platform, result:`error: ${String(e).slice(0,180)}` });
      }
    }
    await db.from("punix_media_sync_state").upsert({ id:1, last_synced_at:now, last_result:results });
    return json({ ok:true, checked:results.length, results, message:`Checked ${results.length} PUNIX channel(s).` });
  } catch (error) {
    return json({ error:String(error) }, 500);
  }
});
