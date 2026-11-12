/* PUNIX live news hubs. Feeds are refreshed on page load, every 15 minutes, and when a stale tab becomes visible. */
document.addEventListener('DOMContentLoaded', () => {
  const page = document.querySelector('[data-live-hub]');
  if (!page) return;
  const type = page.dataset.liveHub;
  const grid = document.getElementById('live-grid');
  const status = document.getElementById('live-status');
  const search = document.getElementById('live-search');
  const refresh = document.getElementById('live-refresh');
  const more = document.getElementById('live-more');
  const filters = [...document.querySelectorAll('[data-live-filter]')];
  const feeds = type === 'games' ? [
    {name:'IGN',url:'https://feeds.feedburner.com/ign/all'},
    {name:'PC Gamer',url:'https://www.pcgamer.com/rss/'},
    {name:'GameSpot',url:'https://www.gamespot.com/feeds/news/'}
  ] : [
    {name:'Esports Insider',url:'https://esportsinsider.com/feed'},
    {name:'Dot Esports',url:'https://dotesports.com/feed'},
    {name:'HLTV',url:'https://www.hltv.org/rss/news'}
  ];
  const refreshEvery = 15 * 60 * 1000;
  let stories = [], active = 'all', visibleCount = 12, lastUpdated = 0, loading = false;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch (_) { return ''; } };
  const plain = value => { const el = document.createElement('div'); el.innerHTML = String(value || ''); return (el.textContent || '').replace(/\s+/g,' ').trim(); };
  const classify = item => {
    const text = (item.title+' '+item.description+' '+(item.categories||[]).join(' ')).toLowerCase();
    if (type === 'games') {
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
      const img = image ? '<img src="'+esc(image)+'" alt="" loading="lazy" referrerpolicy="no-referrer">' : '';
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
    })).filter(item => item.title && item.link).map(item => ({...item,category:classify(item)}));
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
