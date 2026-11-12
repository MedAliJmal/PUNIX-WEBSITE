/* PUNIX Anime Radar: combines public RSS feeds through RSS2JSON. */
document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('anime-news-grid');
  if (!grid) return;
  const status = document.getElementById('anime-feed-status');
  const search = document.getElementById('anime-news-search');
  const loadMore = document.getElementById('anime-load-more');
  const refresh = document.getElementById('anime-refresh');
  const filters = [...document.querySelectorAll('[data-anime-filter]')];
  const feeds = [
    {name:'Anime News Network',url:'https://www.animenewsnetwork.com/all/rss.xml?ann-edition=us'},
    {name:'Anime Corner',url:'https://animecorner.me/feed/'},
    {name:'Crunchyroll News',url:'https://cr-news-api-service.prd.crunchyrollsvc.com/v1/en-US/rss'},
    {name:'MyAnimeList',url:'https://myanimelist.net/rss/news.xml'}
  ];
  let stories = [], activeFilter = 'all', visibleCount = 12, lastUpdated = 0, loading = false;
  const refreshEvery = 15 * 60 * 1000;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch (_) { return ''; } };
  const plainText = value => { const node = document.createElement('div'); node.innerHTML = String(value || ''); return (node.textContent || '').replace(/\s+/g,' ').trim(); };
  const classify = item => {
    const text = (item.title+' '+item.description+' '+(item.categories||[]).join(' ')).toLowerCase();
    if (/manga|manhwa|webtoon|light novel/.test(text)) return 'manga';
    if (/business|industry|studio|box office|licens|production|company|market/.test(text)) return 'industry';
    return 'anime';
  };
  const filtered = () => stories.filter(item => {
    const categoryOk = activeFilter === 'all' || item.category === activeFilter;
    const term = (search?.value || '').trim().toLowerCase();
    const searchOk = !term || (item.title+' '+item.description+' '+item.source).toLowerCase().includes(term);
    return categoryOk && searchOk;
  });
  function render() {
    const items = filtered();
    const visible = items.slice(0, visibleCount);
    grid.innerHTML = visible.length ? visible.map(item => {
      const image = safeUrl(item.image);
      const imageHtml = image ? '<img src="'+escapeHtml(image)+'" alt="" loading="lazy" referrerpolicy="no-referrer">' : '';
      const date = item.date && !Number.isNaN(new Date(item.date).getTime()) ? new Date(item.date).toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'}) : 'LATEST';
      return '<article class="pnx-anime-news-card"><a class="pnx-anime-news-image" href="'+escapeHtml(item.link)+'" target="_blank" rel="noopener noreferrer">'+imageHtml+'<span>'+escapeHtml(item.category.toUpperCase())+'</span></a><div class="pnx-anime-news-content"><div class="pnx-anime-news-meta"><span>'+escapeHtml(item.source)+'</span><span>'+escapeHtml(date)+'</span></div><h3>'+escapeHtml(item.title)+'</h3><p>'+escapeHtml(item.description || 'Open the original article for the full story.')+'</p><a class="pnx-anime-read" href="'+escapeHtml(item.link)+'" target="_blank" rel="noopener noreferrer">READ ORIGINAL STORY <span>↗</span></a></div></article>';
    }).join('') : '<div class="pnx-anime-empty">No stories match this search right now. Try another filter or refresh the feed.</div>';
    loadMore.hidden = items.length <= visibleCount;
    status.textContent = stories.length ? 'SHOWING '+visible.length+' OF '+items.length+' STORIES · UPDATED '+new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : status.textContent;
  }
  async function fetchFeed(feed) {
    const endpoint = 'https://api.rss2json.com/v1/api.json?rss_url='+encodeURIComponent(feed.url);
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error('Feed request failed');
    const payload = await response.json();
    if (payload.status !== 'ok' || !Array.isArray(payload.items)) throw new Error('Feed unavailable');
    return payload.items.map(item => {
      const image = item.thumbnail || item.enclosure?.link || '';
      const link = safeUrl(item.link);
      return {title:plainText(item.title),description:plainText(item.description || item.content).slice(0,360),link,image,source:feed.name,date:item.pubDate,categories:item.categories||[],category:classify({title:item.title,description:item.description,categories:item.categories||[]})};
    }).filter(item => item.title && item.link);
  }
  async function load(force = false) {
    if (loading || (!force && Date.now() - lastUpdated < refreshEvery)) return;
    loading = true;
    status.innerHTML = '<span class="pnx-anime-loader"></span> LOADING THE LATEST ANIME STORIES…';
    refresh.disabled = true;
    const results = await Promise.allSettled(feeds.map(fetchFeed));
    const merged = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
    const seen = new Set();
    const freshStories = merged.filter(item => {
      const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g,'').slice(0,90);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).sort((a,b) => new Date(b.date || 0) - new Date(a.date || 0));
    refresh.disabled = false;
    loading = false;
    if (!freshStories.length) {
      status.textContent = stories.length ? 'UPDATE FAILED · SHOWING THE LAST SUCCESSFUL FEED' : 'THE LIVE FEED IS TEMPORARILY UNAVAILABLE.';
      if (stories.length) { render(); return; }
      grid.innerHTML = '<div class="pnx-anime-empty">We could not connect to the news feeds. You can still visit the publishers directly: <a href="https://www.animenewsnetwork.com/" target="_blank" rel="noopener noreferrer">Anime News Network</a>, <a href="https://animecorner.me/" target="_blank" rel="noopener noreferrer">Anime Corner</a> and <a href="https://www.crunchyroll.com/news" target="_blank" rel="noopener noreferrer">Crunchyroll News</a>. Please try refreshing in a moment.</div>';
      loadMore.hidden = true;
      return;
    }
    stories = freshStories;
    lastUpdated = Date.now();
    visibleCount = 12;
    status.textContent = 'CONNECTED · '+stories.length+' STORIES COLLECTED FROM '+results.filter(r=>r.status==='fulfilled').length+' SOURCES';
    render();
  }
  filters.forEach(button => button.addEventListener('click', () => {
    filters.forEach(item => item.classList.toggle('is-active', item === button));
    activeFilter = button.dataset.animeFilter;
    visibleCount = 12; render();
  }));
  search?.addEventListener('input', () => { visibleCount = 12; render(); });
  loadMore.addEventListener('click', () => { visibleCount += 12; render(); });
  refresh.addEventListener('click', () => load(true));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastUpdated >= refreshEvery) load(true); });
  load(true);
  window.setInterval(() => { if (!document.hidden) load(true); }, refreshEvery);
});
