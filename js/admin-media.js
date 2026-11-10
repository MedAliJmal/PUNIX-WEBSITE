/* PUNIX Media Manager — admin-only CRUD */
(() => {
  const $ = (id) => document.getElementById(id);
  const gate = $('media-gate');
  const app = $('media-app');
  const cfg = window.PUNIX_SUPABASE_CONFIG;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  if (!window.supabase || !cfg?.url || !cfg?.publishableKey) { gate.textContent = 'SUPABASE IS NOT CONFIGURED. Keep your existing js/supabase-config.js file in place.'; gate.classList.add('is-error'); return; }
  const db = window.supabase.createClient(cfg.url, cfg.publishableKey);
  let channels = [], videos = [];
  function message(text, error=false) { gate.hidden = false; gate.textContent = text; gate.classList.toggle('is-error', error); }
  function clearChannel() { $('channel-id').value=''; $('channel-form').reset(); $('channel-active').checked=true; $('channel-auto-import').checked=true; $('channel-order').value='0'; $('channel-form-title').textContent='ADD CREATOR CHANNEL'; $('save-channel-btn').textContent='SAVE CHANNEL'; }
  function clearVideo() { $('video-id').value=''; $('video-form').reset(); $('video-published').checked=true; $('video-order').value='0'; $('video-form-title').textContent='ADD A VIDEO'; $('save-video-btn').textContent='SAVE VIDEO'; }
  function renderChannels() {
    $('admin-channel-list').innerHTML = channels.length ? channels.map(c => `<div class="pnx-media-admin-row"><div class="pnx-media-row-main"><strong>${esc(c.display_name)} ${c.is_live ? '<span style="color:#ff6d6d">● LIVE</span>' : '<span style="color:#8a949a">● OFFLINE</span>'}</strong><small>${esc(c.platform.toUpperCase())} · ${esc(c.channel_handle)}${c.game_name ? ' · '+esc(c.game_name) : ''} · ${c.is_active ? 'VISIBLE' : 'HIDDEN'}${c.is_featured ? ' · FEATURED' : ''}</small></div><div class="pnx-media-row-actions"><button type="button" data-edit-channel="${esc(c.id)}">EDIT</button><button type="button" class="danger" data-delete-channel="${esc(c.id)}">DELETE</button></div></div>`).join('') : '<p>No creator channels added yet.</p>';
    $('admin-channel-list').querySelectorAll('[data-edit-channel]').forEach(b => b.addEventListener('click', () => editChannel(b.dataset.editChannel)));
    $('admin-channel-list').querySelectorAll('[data-delete-channel]').forEach(b => b.addEventListener('click', () => deleteChannel(b.dataset.deleteChannel)));
  }
  function renderVideos() {
    $('admin-video-list').innerHTML = videos.length ? videos.map(v => `<div class="pnx-media-admin-row"><div class="pnx-media-row-main"><strong>${esc(v.title)}</strong><small>${esc(v.platform.toUpperCase())} · ${esc((v.content_kind||'video').toUpperCase())} · ${esc(v.creator_name)} · ${v.source === 'auto' ? 'AUTO-IMPORTED' : 'MANUAL'} · ${v.is_published ? 'PUBLISHED' : 'HIDDEN'}${v.is_featured ? ' · FEATURED' : ''}<br>${esc(v.video_url)}</small></div><div class="pnx-media-row-actions"><button type="button" data-edit-video="${esc(v.id)}">EDIT</button><button type="button" class="danger" data-delete-video="${esc(v.id)}">DELETE</button></div></div>`).join('') : '<p>No videos added yet.</p>';
    $('admin-video-list').querySelectorAll('[data-edit-video]').forEach(b => b.addEventListener('click', () => editVideo(b.dataset.editVideo)));
    $('admin-video-list').querySelectorAll('[data-delete-video]').forEach(b => b.addEventListener('click', () => deleteVideo(b.dataset.deleteVideo)));
  }
  async function loadAll() {
    message('LOADING MEDIA DATA…');
    const [c,v] = await Promise.all([
      db.from('punix_media_channels').select('*').order('sort_order',{ascending:true}).order('created_at',{ascending:false}),
      db.from('punix_media_videos').select('*').order('is_featured',{ascending:false}).order('sort_order',{ascending:true}).order('published_at',{ascending:false})
    ]);
    if (c.error || v.error) { message('MEDIA TABLES NOT READY. Run the PUNIX Media SQL migration in Supabase, then refresh this page. '+(c.error?.message||v.error?.message||''), true); return; }
    channels=c.data||[]; videos=v.data||[]; renderChannels(); renderVideos(); message('MEDIA MANAGER READY.');
  }
  function editChannel(id) {
    const c=channels.find(x=>x.id===id); if(!c)return;
    $('channel-id').value=c.id; $('channel-platform').value=c.platform; $('channel-handle').value=c.channel_handle; $('channel-display-name').value=c.display_name; $('channel-game').value=c.game_name||''; $('channel-order').value=c.sort_order||0; $('channel-featured').checked=!!c.is_featured; $('channel-active').checked=!!c.is_active; $('channel-auto-import').checked=!!c.auto_import_videos; $('channel-form-title').textContent='EDIT CREATOR CHANNEL'; $('save-channel-btn').textContent='UPDATE CHANNEL'; window.scrollTo({top:0,behavior:'smooth'});
  }
  function editVideo(id) {
    const v=videos.find(x=>x.id===id); if(!v)return;
    $('video-id').value=v.id; $('video-platform').value=v.platform; $('video-title').value=v.title; $('video-creator').value=v.creator_name; $('video-url').value=v.video_url; $('video-thumbnail').value=v.thumbnail_url||''; $('video-kind').value=v.content_kind||'video'; $('video-order').value=v.sort_order||0; $('video-featured').checked=!!v.is_featured; $('video-published').checked=!!v.is_published; $('video-form-title').textContent='EDIT VIDEO'; $('save-video-btn').textContent='UPDATE VIDEO'; window.scrollTo({top:0,behavior:'smooth'});
  }
  async function deleteChannel(id) { if(!confirm('Delete this creator channel?'))return; const {error}=await db.from('punix_media_channels').delete().eq('id',id); if(error){message(error.message,true);return;} await loadAll(); }
  async function deleteVideo(id) { if(!confirm('Delete this video?'))return; const {error}=await db.from('punix_media_videos').delete().eq('id',id); if(error){message(error.message,true);return;} await loadAll(); }
  $('channel-form').addEventListener('submit', async e => {
    e.preventDefault();
    const handle=$('channel-handle').value.trim().replace(/^@/,'');
    const payload={platform:$('channel-platform').value,channel_handle:handle,display_name:$('channel-display-name').value.trim(),game_name:$('channel-game').value.trim()||null,sort_order:Number($('channel-order').value)||0,is_featured:$('channel-featured').checked,is_active:$('channel-active').checked,auto_import_videos:$('channel-auto-import').checked};
    const id=$('channel-id').value; const result=id?await db.from('punix_media_channels').update(payload).eq('id',id):await db.from('punix_media_channels').insert(payload);
    if(result.error){message(result.error.message,true);return;} clearChannel(); await loadAll();
  });
  $('video-form').addEventListener('submit', async e => {
    e.preventDefault();
    const url=$('video-url').value.trim(); try { const parsed=new URL(url); if(parsed.protocol!=='https:')throw new Error(); } catch { message('Enter a valid HTTPS video URL.',true); return; }
    const thumb=$('video-thumbnail').value.trim(); if(thumb){try{if(new URL(thumb).protocol!=='https:')throw new Error();}catch{message('Thumbnail must be a valid HTTPS URL.',true);return;}}
    const payload={platform:$('video-platform').value,content_kind:$('video-kind').value,title:$('video-title').value.trim(),creator_name:$('video-creator').value.trim(),video_url:url,thumbnail_url:thumb||null,sort_order:Number($('video-order').value)||0,is_featured:$('video-featured').checked,is_published:$('video-published').checked,source:'manual'};
    const id=$('video-id').value; const result=id?await db.from('punix_media_videos').update(payload).eq('id',id):await db.from('punix_media_videos').insert(payload);
    if(result.error){message(result.error.message,true);return;} clearVideo(); await loadAll();
  });
  $('clear-channel-btn').addEventListener('click',clearChannel); $('clear-video-btn').addEventListener('click',clearVideo); $('refresh-media').addEventListener('click',loadAll);
  $('media-sync-btn').addEventListener('click',async()=>{message('CHECKING CONNECTED PLATFORMS…');const {data,error}=await db.functions.invoke('punix-media-sync',{body:{source:'admin'}});if(error){message('SYNC FAILED: '+error.message+'. Confirm the Edge Function is deployed and configured.',true);return;}if(data?.skipped){message(data.message||'SYNC SKIPPED: a check ran within the last 90 seconds.');await loadAll();return;}const rows=data?.results||[];const kick=rows.filter(r=>r.platform==='kick');const detail=kick.map(r=>'KICK / '+r.channel+': '+r.result).join(' | ');message((data?.message||'SYNC REQUEST COMPLETED.')+(detail?' — '+detail:''),kick.some(r=>String(r.result).startsWith('error')||r.result==='missing_api_secrets'));await loadAll();});
  async function boot() {
    const {data:{session},error}=await db.auth.getSession();
    if(error||!session){message('ACCESS DENIED. Please log in with a PUNIX administrator account.',true);return;}
    const {data:role,error:roleError}=await db.from('user_roles').select('role').eq('user_id',session.user.id).maybeSingle();
    if(roleError||!['admin','super_admin'].includes(role?.role)){message('ACCESS DENIED. This page is restricted to PUNIX administrators.',true);return;}
    gate.hidden=true; app.hidden=false; await loadAll();
  }
  boot();
})();
