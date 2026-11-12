(() => {
  const target=document.getElementById('pnx-sponsors-grid');
  const config=window.PUNIX_SUPABASE_CONFIG;
  if(!target||!window.supabase||!config?.url||!config?.publishableKey)return;
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const db=window.supabase.createClient(config.url,config.publishableKey);
  db.from('sponsors').select('id,name,logo_url,website_url,is_featured,display_order').eq('is_published',true).not('logo_url','is',null).neq('logo_url','').order('display_order',{ascending:true}).order('is_featured',{ascending:false}).then(({data,error})=>{
    if(error||!data?.length)return;
    target.dataset.count=String(data.length);
    target.innerHTML=data.map(item=>{
      const logo=escapeHtml(item.logo_url);
      const name=escapeHtml(item.name);
      const content=`<img src="${logo}" alt="${name}" loading="lazy"><span>${name}</span>`;
      return item.website_url?`<a class="pnx-sponsor-card ${item.is_featured?'is-featured':''}" href="${escapeHtml(item.website_url)}" target="_blank" rel="noopener noreferrer" aria-label="${name} — opens partner website">${content}</a>`:`<div class="pnx-sponsor-card ${item.is_featured?'is-featured':''}">${content}</div>`;
    }).join('');
  });
})();
