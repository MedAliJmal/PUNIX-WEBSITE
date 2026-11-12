/* PUNIX live news hubs. Feeds are refreshed on page load, every 15 minutes, and when a stale tab becomes visible. */
document.addEventListener('DOMContentLoaded', () => {
  const page = document.querySelector('[data-live-hub]');
  if (!page) return;
  const type = page.dataset.liveHub;
  if (type === 'games') { initFreeGames(); initTunesfOfficial(); }
  if (type === 'esports') initTunisiaEsports();
  const grid = document.getElementById('live-grid');
  const status = document.getElementById('live-status');
  const search = document.getElementById('live-search');
  const refresh = document.getElementById('live-refresh');
  const more = document.getElementById('live-more');
  const filters = [...document.querySelectorAll('[data-live-filter]')];
  const feeds = type === 'games' ? [
    {name:'IGN',url:'https://feeds.feedburner.com/ign/all'},
    {name:'PC Gamer',url:'https://www.pcgamer.com/rss/'},
    {name:'GameSpot',url:'https://www.gamespot.com/feeds/news/'},
    {name:'TGTV · TUNISIA ESPORTS',url:'https://tgtv.tn/category/esports/feed/'},
    {name:'VLR.gg · TUNISIA VALORANT',url:'https://vlr.gg/rss',tunisiaOnly:true}
  ] : [
    {name:'Esports Insider',url:'https://esportsinsider.com/feed'},
    {name:'Dot Esports',url:'https://dotesports.com/feed'},
    {name:'HLTV',url:'https://www.hltv.org/rss/news'},
    {name:'VLR.gg · VALORANT ESPORTS',url:'https://vlr.gg/rss'}
  ];
  const refreshEvery = 15 * 60 * 1000;
  let stories = [], active = 'all', visibleCount = 12, lastUpdated = 0, loading = false;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch (_) { return ''; } };
  const plain = value => { const el = document.createElement('div'); el.innerHTML = String(value || ''); return (el.textContent || '').replace(/\s+/g,' ').trim(); };
  const classify = item => {
    const text = (item.title+' '+item.description+' '+(item.categories||[]).join(' ')).toLowerCase();
    if (type === 'games') {
      if (item.source === 'TGTV · TUNISIA ESPORTS') return 'tunisia';
      if (item.source === 'VLR.gg · TUNISIA VALORANT') return 'tunisia';
      if (/release|launch|out now|coming soon|early access|date announced|pre.?order/.test(text)) return 'releases';
      if (/update|patch|season|hotfix|maintenance|balance|dlc|expansion/.test(text)) return 'updates';
      return 'industry';
    }
    if (/roster|transfer|signs|signed|joins|leaves|coach|player move/.test(text)) return 'rosters';
    if (/business|investment|acquisition|industry|partnership|sponsor|company/.test(text)) return 'industry';
    return 'tournaments';
  };
  function render() {
    const term = (search.value || '').trim().toLowerCase();
    const items = stories.filter(item => (active === 'all' || item.category === active) && (!term || (item.title+' '+item.description+' '+item.source).toLowerCase().includes(term)));
    const shown = items.slice(0, visibleCount);
    grid.innerHTML = shown.length ? shown.map(item => {
      const image = safeUrl(item.image);
      const img = image ? '<img src="'+esc(image)+'" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">' : '';
      const date = item.date && !Number.isNaN(new Date(item.date).getTime()) ? new Date(item.date).toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'}) : 'LATEST';
      return '<article class="pnx-live-card"><a class="pnx-live-card-image" href="'+esc(item.link)+'" target="_blank" rel="noopener noreferrer">'+img+'<span>'+esc(item.category.toUpperCase())+'</span></a><div class="pnx-live-card-content"><div class="pnx-live-card-meta"><span>'+esc(item.source)+'</span><span>'+esc(date)+'</span></div><h3>'+esc(item.title)+'</h3><p>'+esc(item.description || 'Open the publisher article to read the full story.')+'</p><a class="pnx-live-read" href="'+esc(item.link)+'" target="_blank" rel="noopener noreferrer">READ FULL STORY <span>↗</span></a></div></article>';
    }).join('') : '<div class="pnx-live-empty">No stories match this filter. Try another category or refresh the feed.</div>';
    more.hidden = items.length <= visibleCount;
    const time = lastUpdated ? new Date(lastUpdated).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
    status.textContent = stories.length ? 'SHOWING '+shown.length+' OF '+items.length+' STORIES · LAST SYNC '+time+' · AUTO-REFRESH 15 MIN' : status.textContent;
  }
  async function fetchFeed(feed) {
    const url = 'https://api.rss2json.com/v1/api.json?rss_url='+encodeURIComponent(feed.url)+'&count=30';
    const response = await fetch(url, {cache:'no-store'});
    if (!response.ok) throw new Error(feed.name+' unavailable');
    const data = await response.json();
    if (data.status !== 'ok' || !Array.isArray(data.items)) throw new Error(feed.name+' returned no items');
    return data.items.map(item => ({
      title:plain(item.title), description:plain(item.description || item.content).slice(0,300),
      link:safeUrl(item.link), image:safeUrl(item.thumbnail || item.enclosure?.link || ''),
      source:feed.name, date:item.pubDate, categories:item.categories || []
    })).filter(item => item.title && item.link).filter(item => {
      if (!feed.tunisiaOnly) return true;
      return /\b(tunisia|tunisian|tunisie|tunisien|tunisienne|carthage|north africa)\b/i.test(item.title+' '+item.description+' '+(item.categories||[]).join(' '));
    }).map(item => ({...item,category:classify(item)}));
  }
  async function load(force=false) {
    if (loading || (!force && Date.now()-lastUpdated < refreshEvery)) return;
    loading = true; refresh.disabled = true;
    status.innerHTML = '<i class="pnx-live-spinner"></i> CHECKING THE LATEST STORIES FROM '+feeds.length+' SOURCES…';
    const results = await Promise.allSettled(feeds.map(fetchFeed));
    const received = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    if (received.length) {
      const seen = new Set();
      stories = received.filter(item => {
        const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g,'').slice(0,100);
        if (seen.has(key)) return false; seen.add(key); return true;
      }).sort((a,b) => new Date(b.date || 0)-new Date(a.date || 0));
      lastUpdated = Date.now(); visibleCount = 12; render();
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed) status.textContent += ' · '+failed+' SOURCE(S) TEMPORARILY UNAVAILABLE';
    } else if (!stories.length) {
      status.textContent = 'NEWS FEEDS ARE TEMPORARILY UNAVAILABLE. Please try refreshing in a moment.';
      grid.innerHTML = '<div class="pnx-live-empty">We could not reach the news feeds right now. The sources may be rate-limited or temporarily offline. Use Refresh Now to retry.</div>';
    } else {
      status.textContent = 'UPDATE FAILED · SHOWING THE LAST SUCCESSFUL FEED';
    }
    loading = false; refresh.disabled = false;
  }
  filters.forEach(button => button.addEventListener('click', () => {
    filters.forEach(item => item.classList.toggle('is-active', item === button));
    active = button.dataset.liveFilter; visibleCount = 12; render();
  }));
  search.addEventListener('input', () => { visibleCount = 12; render(); });
  more.addEventListener('click', () => { visibleCount += 12; render(); });
  refresh.addEventListener('click', () => load(true));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now()-lastUpdated >= refreshEvery) load(true);
  });
  load(true);
  window.setInterval(() => { if (!document.hidden) load(true); }, refreshEvery);
});


/* Official TUNESF news is mirrored into a small JSON snapshot by GitHub Actions. */
function initTunesfOfficial() {
  const grid = document.getElementById('tunesf-official-grid');
  const status = document.getElementById('tunesf-sync-status');
  if (!grid || !status) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safe = value => { try { const u = new URL(value); return u.protocol === 'https:' && /(^|\.)tunesf\.com$/i.test(u.hostname) ? u.href : ''; } catch (_) { return ''; } };
  const dateLabel = value => {
    if (!value) return 'LATEST';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? 'LATEST' : d.toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'});
  };
  async function sync() {
    try {
      const response = await fetch('data/tunesf-news.json?ts='+Date.now(), {cache:'no-store'});
      if (!response.ok) throw new Error('Snapshot unavailable');
      const data = await response.json();
      if (!Array.isArray(data.articles) || !data.articles.length) throw new Error('No verified articles');
      const cards = data.articles.slice(0,6).filter(item => item.title && safe(item.url));
      if (!cards.length) throw new Error('No valid article links');
      grid.innerHTML = cards.map((item,index) => {
        const url = safe(item.url);
        const date = item.date || '';
        const meta = index === 0 ? 'LATEST OFFICIAL UPDATE' : 'FEDERATION NEWS';
        return '<article class="pnx-tunesf-card '+(index===0?'pnx-tunesf-featured':'')+'"><div class="pnx-tunesf-card-meta"><span>'+meta+'</span><time>'+esc(dateLabel(date))+'</time></div><h3>'+esc(item.title)+'</h3><p>'+esc(item.description || 'Official update published by the Tunisian Esports Federation.')+'</p><a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">READ OFFICIAL UPDATE ↗</a></article>';
      }).join('');
      const checked = data.updated_at ? new Date(data.updated_at) : null;
      status.textContent = 'AUTO-SYNC · '+(checked && !Number.isNaN(checked.getTime()) ? 'UPDATED '+checked.toLocaleString(undefined,{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : 'LATEST PUBLISHED STORIES');
    } catch (_) {
      status.textContent = 'SYNC TEMPORARILY UNAVAILABLE · LAST PUBLISHED STORIES SHOWN';
    }
  }
  sync();
}

/* Live PC game giveaways: full-game offers only, with source attribution. */
function initFreeGames() {
  const grid = document.getElementById('free-games-grid');
  if (!grid) return;
  const updated = document.getElementById('free-games-updated');
  const search = document.getElementById('free-games-search');
  const refresh = document.getElementById('free-games-refresh');
  const filters = [...document.querySelectorAll('[data-free-filter]')];
  let offers = [], active = 'all', busy = false, lastSync = 0;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safe = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch (_) { return ''; } };
  const platformOf = value => {
    const p = String(value || '').toLowerCase();
    if (p.includes('steam')) return 'steam';
    if (p.includes('epic')) return 'epic';
    if (p.includes('gog')) return 'gog';
    return 'other';
  };
  const dateLabel = value => {
    if (!value || String(value).toUpperCase() === 'N/A') return 'Check offer page';
    const d = new Date(String(value).replace(' ','T')+'Z');
    if (Number.isNaN(d.getTime())) return 'Check offer page';
    return 'Ends '+d.toLocaleString([], {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  };
  function render() {
    const term = (search.value || '').trim().toLowerCase();
    const filtered = offers.filter(o => (active === 'all' || o.platform === active) && (!term || (o.title+' '+o.description+' '+o.platforms).toLowerCase().includes(term)));
    grid.innerHTML = filtered.length ? filtered.map(o => {
      const image = safe(o.thumbnail || o.image);
      const platformLabel = o.platform === 'epic' ? 'EPIC GAMES STORE' : o.platform === 'steam' ? 'STEAM' : o.platform === 'gog' ? 'GOG' : (o.platforms || 'PC').toUpperCase();
      const worth = o.worth && o.worth !== 'N/A' ? o.worth : 'FREE';
      const claim = safe(o.open_giveaway_url);
      return '<article class="pnx-free-card"><div class="pnx-free-image">'+(image ? '<img src="'+esc(image)+'" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">' : '')+'<span class="pnx-free-platform">'+esc(platformLabel)+'</span><span class="pnx-free-price">WAS '+esc(worth)+'</span></div><div class="pnx-free-content"><div class="pnx-free-meta"><span>FULL GAME GIVEAWAY</span><span>'+esc(dateLabel(o.end_date))+'</span></div><h3>'+esc(o.title)+'</h3><p>'+esc(o.description || 'Limited-time full game giveaway. Check the offer page for redemption details.')+'</p><div class="pnx-free-bottom"><span class="pnx-free-tag">100% OFF</span>'+(claim ? '<a href="'+esc(claim)+'" target="_blank" rel="noopener noreferrer">CLAIM FREE GAME ↗</a>' : '<span>OFFER LINK UNAVAILABLE</span>')+'</div></div></article>';
    }).join('') : '<div class="pnx-live-empty">No active offers found for this selection right now. Check back later or view all platforms.</div>';
    updated.textContent = lastSync ? 'LAST CHECK '+new Date(lastSync).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})+' · REFRESHES EVERY 15 MIN' : 'WAITING FOR GIVEAWAY DATA';
  }
  async function load(force=false) {
    if (busy || (!force && Date.now()-lastSync < 15*60*1000)) return;
    busy = true; refresh.disabled = true; updated.textContent = 'CHECKING ACTIVE GIVEAWAYS…';
    try {
      const response = await fetch('https://www.gamerpower.com/api/giveaways?platform=pc&type=game&sort-by=date', {cache:'no-store'});
      if (!response.ok) throw new Error('Giveaway service unavailable');
      const data = await response.json();
      if (!Array.isArray(data) || !data.length) {
        offers = [];
      } else {
        const seen = new Set();
        offers = data.filter(o => {
          if (String(o.type || '').toLowerCase() !== 'game' || String(o.status || '').toLowerCase() !== 'active') return false;
          const end = o.end_date && String(o.end_date).toUpperCase() !== 'N/A' ? new Date(String(o.end_date).replace(' ','T')+'Z') : null;
          if (end && !Number.isNaN(end.getTime()) && end.getTime() < Date.now()) return false;
          const key = String(o.id || o.title).toLowerCase();
          if (seen.has(key)) return false; seen.add(key); return true;
        }).map(o => ({...o,platform:platformOf(o.platforms)}));
      }
      lastSync = Date.now(); render();
    } catch (error) {
      updated.textContent = 'GIVEAWAY FEED TEMPORARILY UNAVAILABLE';
      if (!offers.length) grid.innerHTML = '<div class="pnx-live-empty">We could not load the giveaway feed right now. Please try again later, or visit <a href="https://www.gamerpower.com/" target="_blank" rel="noopener noreferrer">GamerPower</a> directly.</div>';
    } finally {
      busy = false; refresh.disabled = false;
    }
  }
  filters.forEach(button => button.addEventListener('click', () => {
    filters.forEach(b => b.classList.toggle('is-active', b === button));
    active = button.dataset.freeFilter; render();
  }));
  search.addEventListener('input', render);
  refresh.addEventListener('click', () => load(true));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now()-lastSync >= 15*60*1000) load(true); });
  window.setInterval(() => { if (!document.hidden) load(true); }, 15*60*1000);
  load(true);
}


/* Dedicated Tunisian esports feed on the World Esports page. */
function initTunisiaEsports() {
  const grid = document.getElementById('tn-live-grid');
  const status = document.getElementById('tn-live-status');
  const refresh = document.getElementById('tn-live-refresh');
  if (!grid || !status || !refresh) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const plain = value => { const el = document.createElement('div'); el.innerHTML = String(value || ''); return (el.textContent || '').replace(/\s+/g,' ').trim(); };
  const safe = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch (_) { return ''; } };
  const tunesfSafe = value => { const url = safe(value); if (!url) return ''; try { return /(^|\.)tunesf\.com$/i.test(new URL(url).hostname) ? url : ''; } catch (_) { return ''; } };
  const localTerms = /\b(tunisia|tunisian|tunisie|tunisien|tunisienne|carthage|north africa)\b/i;
  let busy = false, lastSync = 0;
  function card(item) {
    const image = safe(item.image);
    const date = item.date && !Number.isNaN(new Date(item.date).getTime()) ? new Date(item.date).toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'}) : 'LATEST';
    return '<article class="pnx-live-card"><a class="pnx-live-card-image" href="'+esc(item.link)+'" target="_blank" rel="noopener noreferrer">'+(image ? '<img src="'+esc(image)+'" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">' : '')+'<span>'+esc(item.tag || 'TUNISIA')+'</span></a><div class="pnx-live-card-content"><div class="pnx-live-card-meta"><span>'+esc(item.source)+'</span><span>'+esc(date)+'</span></div><h3>'+esc(item.title)+'</h3><p>'+esc(item.description || 'Open the publisher article to read the full story.')+'</p><a class="pnx-live-read" href="'+esc(item.link)+'" target="_blank" rel="noopener noreferrer">READ FULL STORY <span>↗</span></a></div></article>';
  }
  async function rss(url, source, filterLocal) {
    const endpoint = 'https://api.rss2json.com/v1/api.json?rss_url='+encodeURIComponent(url)+'&count=30';
    const response = await fetch(endpoint,{cache:'no-store'});
    if (!response.ok) throw new Error(source+' unavailable');
    const data = await response.json();
    if (data.status !== 'ok' || !Array.isArray(data.items)) throw new Error(source+' returned no stories');
    return data.items.map(item => ({
      title:plain(item.title), description:plain(item.description || item.content).slice(0,300),
      link:safe(item.link), image:safe(item.thumbnail || item.enclosure?.link || ''),
      source, date:item.pubDate, tag:'TUNISIA'
    })).filter(item => item.title && item.link && (!filterLocal || localTerms.test(item.title+' '+item.description)));
  }
  async function official() {
    const response = await fetch('data/tunesf-news.json?ts='+Date.now(),{cache:'no-store'});
    if (!response.ok) throw new Error('TUNESF snapshot unavailable');
    const data = await response.json();
    if (!Array.isArray(data.articles)) throw new Error('TUNESF snapshot invalid');
    return data.articles.map(item => ({
      title:plain(item.title), description:plain(item.description).slice(0,300),
      link:tunesfSafe(item.url), image:safe(item.image), source:'TUNESF · OFFICIAL', date:item.date, tag:'OFFICIAL'
    })).filter(item => item.title && item.link);
  }
  async function load() {
    if (busy) return;
    busy = true; refresh.disabled = true;
    status.innerHTML = '<i class="pnx-live-spinner"></i> CHECKING TGTV, TUNESF AND TUNISIA-RELATED VALORANT STORIES…';
    const results = await Promise.allSettled([
      rss('https://tgtv.tn/category/esports/feed/','TGTV · TUNISIA',false),
      official(),
      rss('https://vlr.gg/rss','VLR.gg · TUNISIA VALORANT',true)
    ]);
    const items = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
    const seen = new Set();
    const unique = items.filter(item => {
      const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g,'').slice(0,100);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).sort((a,b) => new Date(b.date || 0)-new Date(a.date || 0));
    if (unique.length) {
      grid.innerHTML = unique.map(card).join('');
      lastSync = Date.now();
      const failed = results.filter(result => result.status === 'rejected').length;
      status.textContent = unique.length+' TUNISIAN STORIES · UPDATED '+new Date(lastSync).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})+(failed ? ' · '+failed+' SOURCE(S) TEMPORARILY UNAVAILABLE' : ' · ALL SOURCES CHECKED');
    } else {
      status.textContent = 'TUNISIAN NEWS SOURCES ARE TEMPORARILY UNAVAILABLE.';
      grid.innerHTML = '<div class="pnx-live-empty">No local stories could be loaded right now. Try refreshing, or visit the source websites below.</div>';
    }
    busy = false; refresh.disabled = false;
  }
  refresh.addEventListener('click',load);
  load();
  window.setInterval(() => { if (!document.hidden && Date.now()-lastSync >= 15*60*1000) load(); },15*60*1000);
}
