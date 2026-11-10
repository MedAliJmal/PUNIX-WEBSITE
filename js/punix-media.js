/* PUNIX Media Center — public homepage renderer */
(() => {
  const $ = (selector) => document.querySelector(selector);
  const config = window.PUNIX_SUPABASE_CONFIG;
  const featured = $('#pnx-featured-live');
  const channelList = $('#pnx-live-channel-list');
  const videoGrid = $('#pnx-video-grid');
  if (!featured || !channelList || !videoGrid) return;

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeHttps = (value) => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
  const platformLabel = (p) => ({twitch:'TWITCH',kick:'KICK',youtube:'YOUTUBE',tiktok:'TIKTOK',instagram:'INSTAGRAM'}[p] || String(p || 'MEDIA').toUpperCase());
  let channels = [];
  let videos = [];

  function embedUrl(channel) {
    const handle = String(channel.channel_handle || '').trim();
    if (channel.platform === 'twitch') {
      const parent = location.hostname || '127.0.0.1';
      return `https://player.twitch.tv/?channel=${encodeURIComponent(handle)}&parent=${encodeURIComponent(parent)}&autoplay=false&muted=true`;
    }
    if (channel.platform === 'kick') return `https://player.kick.com/${encodeURIComponent(handle)}?autoplay=false&muted=true`;
    if (channel.platform === 'youtube') {
      const videoId = channel.live_video_id || '';
      return videoId ? `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=0&mute=1` : `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(channel.channel_handle)}&autoplay=0`;
    }
    return '';
  }

  function renderFeatured(channel) {
    if (!channel) {
      featured.innerHTML = `<div class="pnx-media-empty"><span class="pnx-live-pulse"></span><strong>NO PUNIX STREAM IS LIVE RIGHT NOW</strong><p>Check back soon or explore the latest videos from our creators.</p></div>`;
      return;
    }
    const src = embedUrl(channel);
    const title = channel.live_title || `${channel.display_name} is live`;
    const url = safeHttps(channel.live_url) || (channel.platform === 'twitch' ? `https://twitch.tv/${encodeURIComponent(channel.channel_handle)}` : channel.platform === 'kick' ? `https://kick.com/${encodeURIComponent(channel.channel_handle)}` : `https://youtube.com/channel/${encodeURIComponent(channel.channel_handle)}/live`);
    featured.innerHTML = `<iframe class="pnx-live-player" src="${escapeHtml(src)}" title="${escapeHtml(title)}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe><div class="pnx-live-feature-meta"><div><h3>${escapeHtml(channel.display_name)}</h3><p>${escapeHtml(title)} · ${platformLabel(channel.platform)}${Number.isFinite(Number(channel.viewer_count)) && channel.viewer_count !== null ? ` · ${Number(channel.viewer_count).toLocaleString()} VIEWERS` : ''}</p></div><a class="pnx-live-pill" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><span class="pnx-live-pulse"></span> WATCH ON ${platformLabel(channel.platform)}</a></div>`;
  }

  function renderChannels() {
    const live = channels.filter(c => c.is_live && ['twitch','kick','youtube'].includes(c.platform));
    const selected = live.find(c => c.is_featured) || live[0] || null;
    renderFeatured(selected);
    if (!channels.length) {
      channelList.innerHTML = '<p class="pnx-media-muted">PUNIX creator channels will appear here once configured by an administrator.</p>';
      return;
    }
    channelList.innerHTML = channels.map(c => `<button type="button" class="pnx-live-channel${c.id === selected?.id ? ' is-selected' : ''}" data-channel-id="${escapeHtml(c.id)}"><span class="pnx-channel-avatar">${escapeHtml((c.display_name || 'P').trim().charAt(0).toUpperCase())}</span><span class="pnx-channel-copy"><strong>${escapeHtml(c.display_name)}</strong><small>${platformLabel(c.platform)}${c.game_name ? ` · ${escapeHtml(c.game_name)}` : ''}</small></span><span class="pnx-channel-state${c.is_live ? ' is-live' : ''}">${c.is_live ? '● LIVE' : (['tiktok','instagram'].includes(c.platform) ? 'SOCIAL' : 'OFFLINE')}</span></button>`).join('');
    channelList.querySelectorAll('[data-channel-id]').forEach(button => button.addEventListener('click', () => {
      const chosen = channels.find(c => c.id === button.dataset.channelId);
      if (chosen?.is_live) {
        renderFeatured(chosen);
        channelList.querySelectorAll('.pnx-live-channel').forEach(b => b.classList.toggle('is-selected', b === button));
      } else {
        const url = chosen?.platform === 'twitch' ? `https://twitch.tv/${chosen.channel_handle}` : chosen?.platform === 'kick' ? `https://kick.com/${chosen.channel_handle}` : chosen?.platform === 'youtube' ? `https://youtube.com/channel/${chosen?.channel_handle}` : chosen?.platform === 'tiktok' ? `https://www.tiktok.com/@${chosen.channel_handle.replace(/^@/,'')}` : `https://www.instagram.com/${chosen?.channel_handle.replace(/^@/,'')}/`;
        if (url) window.open(url, '_blank', 'noopener');
      }
    }));
  }

  function socialEmbed(video) {
    const raw = safeHttps(video.video_url);
    if (!raw) return '';
    try {
      const u = new URL(raw);
      if (video.platform === 'tiktok' && (u.hostname === 'www.tiktok.com' || u.hostname === 'tiktok.com')) {
        const m = u.pathname.match(/\/video\/(\d+)/);
        return m ? `https://www.tiktok.com/embed/v2/${m[1]}` : '';
      }
      if (video.platform === 'instagram' && (u.hostname === 'www.instagram.com' || u.hostname === 'instagram.com')) {
        const m = u.pathname.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
        return m ? `https://www.instagram.com/${m[1]}/${m[2]}/embed/` : '';
      }
    } catch {}
    return '';
  }

  function renderVideos() {
    if (!videos.length) {
      videoGrid.innerHTML = '<div class="pnx-media-empty pnx-video-empty"><span class="pnx-video-play">▶</span><strong>FRESH CONTENT, COMING UP.</strong><p>Admins can feature videos, clips, Shorts, TikToks and Instagram Reels here.</p></div>';
      return;
    }
    videoGrid.innerHTML = videos.map(v => {
      const url = safeHttps(v.video_url);
      const thumb = safeHttps(v.thumbnail_url);
      if (!url) return '';
      const embed = socialEmbed(v);
      const kind = String(v.content_kind || 'video').toUpperCase();
      const preview = embed
        ? `<div class="pnx-social-embed"><iframe src="${escapeHtml(embed)}" title="${escapeHtml(v.title)}" loading="lazy" allow="encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`
        : `<div class="pnx-video-thumb"${thumb ? ` style="background-image:url('${escapeHtml(thumb)}')"` : ''}><span class="pnx-video-play">▶</span></div>`;
      return `<article class="pnx-video-card${embed ? ' pnx-video-card-embed' : ''}">${preview}<div class="pnx-video-info"><div class="pnx-video-meta"><span>${escapeHtml(v.creator_name || 'PUNIX CREATOR')}</span><span>${platformLabel(v.platform)} · ${kind}</span></div><h3>${escapeHtml(v.title)}</h3><a class="pnx-video-open" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">OPEN ON ${platformLabel(v.platform)} ↗</a></div></article>`;
    }).join('') || '<p class="pnx-media-muted">No published videos yet.</p>';
  }

  async function loadMedia() {
    if (!window.supabase || !config?.url || !config?.publishableKey) {
      channelList.innerHTML = '<p class="pnx-media-muted">Media service is not configured. Keep your existing Supabase configuration in place.</p>';
      return;
    }
    const db = window.supabase.createClient(config.url, config.publishableKey);
    try {
      const [channelResult, videoResult] = await Promise.all([
        db.from('punix_media_channels').select('id,platform,channel_handle,display_name,game_name,is_featured,is_live,live_title,live_url,live_video_id,viewer_count,sort_order').eq('is_active', true).order('sort_order', {ascending:true}),
        db.from('punix_media_videos').select('id,platform,content_kind,title,creator_name,video_url,thumbnail_url,published_at,sort_order').eq('is_published', true).order('is_featured', {ascending:false}).order('sort_order', {ascending:true}).order('published_at', {ascending:false}).limit(9)
      ]);
      if (channelResult.error) throw channelResult.error;
      if (videoResult.error) throw videoResult.error;
      channels = channelResult.data || [];
      videos = videoResult.data || [];
      renderChannels();
      renderVideos();
    } catch (error) {
      channelList.innerHTML = '<p class="pnx-media-muted">Media data is not ready yet. An administrator needs to run the PUNIX Media migration in Supabase.</p>';
      console.warn('PUNIX media load:', error.message || error);
    }
  }

  async function requestSync() {
    if (!window.supabase || !config?.url || !config?.publishableKey) return;
    try {
      const db = window.supabase.createClient(config.url, config.publishableKey);
      await db.functions.invoke('punix-media-sync', {body:{source:'homepage'}});
    } catch (error) { console.info('PUNIX media sync will retry later:', error?.message || error); }
  }

  document.querySelectorAll('[data-pnx-media-tab]').forEach(tab => tab.addEventListener('click', () => {
    const target = tab.dataset.pnxMediaTab;
    document.querySelectorAll('[data-pnx-media-tab]').forEach(item => { const active = item === tab; item.classList.toggle('is-active', active); item.setAttribute('aria-selected', String(active)); });
    $('#pnx-live-panel').hidden = target !== 'live';
    $('#pnx-videos-panel').hidden = target !== 'videos';
  }));

  loadMedia();
  requestSync().then(() => loadMedia());
  window.setInterval(() => requestSync().then(loadMedia), 120000);
})();
