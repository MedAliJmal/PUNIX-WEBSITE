/* Load published PUNIX homepage updates from Supabase. */
document.addEventListener('DOMContentLoaded', async () => {
  const grid=document.getElementById('punix-latest-updates-grid');
  const config=window.PUNIX_SUPABASE_CONFIG;
  if(!grid||!window.supabase||!config?.url||!config?.publishableKey)return;
  const escapeHtml=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl=(value)=>{const v=String(value||'').trim();if(!v)return '';if(/^(assets\/|\.\/|\.\.\/|\/|#)/.test(v))return v;try{const u=new URL(v);return u.protocol==='https:'?v:''}catch{return ''}};
  try{
    const db=window.supabase.createClient(config.url,config.publishableKey);
    const {data,error}=await db.from('latest_updates').select('id,title,category,summary,image_url,link_url,link_label,published_at,display_order').eq('is_published',true).order('display_order',{ascending:true}).order('published_at',{ascending:false}).limit(6);
    if(error||!data?.length)return;
    grid.innerHTML=data.map(item=>{
      const image=safeUrl(item.image_url),link=safeUrl(item.link_url);
      const style=image?` style="background-image:linear-gradient(0deg,rgba(5,7,9,.55),transparent 75%),url('${escapeHtml(image)}')"`:'';
      const thumbClass=image?'news-thumb':'news-thumb news-thumb-one';
      const date=item.published_at?new Date(item.published_at+'T00:00:00').toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'}):'';
      const action=link?`<a href="${escapeHtml(link)}" class="text-link" ${/^https:\/\//.test(link)?'target="_blank" rel="noopener noreferrer"':''}>${escapeHtml(item.link_label||'READ MORE')} <span>↗</span></a>`:'';
      return `<article class="news-card reveal"><div class="${thumbClass}"${style}><span>${escapeHtml(String(item.category||'UPDATE').toUpperCase())}</span></div><div class="news-meta"><span>${escapeHtml(String(item.category||'UPDATE').toUpperCase())}</span><span>${escapeHtml(date)}</span></div><h3>${escapeHtml(item.title)}</h3><p class="pnx-home-update-summary">${escapeHtml(item.summary)}</p>${action}</article>`;
    }).join('');
    grid.querySelectorAll('.reveal').forEach(el=>el.classList.add('visible'));
  }catch(_){/* Keep the designed fallback cards if the public feed is unavailable. */}
});
