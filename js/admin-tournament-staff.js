(() => {
 const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const cfg=window.PUNIX_SUPABASE_CONFIG;
 if(!window.supabase||!cfg?.url||!cfg?.publishableKey)return;
 const db=window.PUNIX_SUPABASE_CLIENT||window.supabase.createClient(cfg.url,cfg.publishableKey);window.PUNIX_SUPABASE_CLIENT=db;
 let profiles=[],roles=[],selectedTournament=null;
 async function ensurePanel(){
  let panel=$('tournament-staff-assign-panel');
  if(!panel){panel=document.createElement('section');panel.id='tournament-staff-assign-panel';panel.className='pnx-overview-panel pnx-tournament-secondary';panel.innerHTML='<div class="pnx-panel-top"><div><p class="pnx-admin-kicker">ACCESS CONTROL</p><h3>TOURNAMENT STAFF</h3><small>Only assigned accounts can manage this tournament. They receive no website-admin permissions. Share <a href="tournament-staff.html" target="_blank" rel="noopener">the staff workspace</a> with assigned members.</small></div></div><div class="pnx-staff-assign-controls"><label for="tournament-staff-search">FIND PUNIX ACCOUNT</label><input id="tournament-staff-search" type="search" placeholder="Search member display name…"><select id="tournament-staff-user"><option value="">Select a member</option></select><button id="tournament-staff-add" type="button" class="button">+ ASSIGN STAFF</button></div><div id="tournament-staff-current" class="pnx-admin-tournament-list"><p>Loading staff assignments…</p></div><p id="tournament-staff-message" class="pnx-member-review-message" role="status"></p>';
   $('tournament-details-panel').appendChild(panel);
   $('tournament-staff-search').addEventListener('input',renderOptions);
   $('tournament-staff-add').addEventListener('click',assign);
   $('tournament-staff-current').addEventListener('click',async e=>{const b=e.target.closest('[data-remove-staff]');if(!b)return;if(!confirm('Remove this account from this tournament?'))return;const r=await db.rpc('admin_set_tournament_staff',{p_tournament_id:selectedTournament,p_user_id:b.dataset.removeStaff,p_assign:false});if(r.error){note('Could not remove staff: '+r.error.message);return;}note('Tournament staff access removed.');await loadAssignments();});
  }
  panel.hidden=false;
 }
 function note(t){$('tournament-staff-message').textContent=t;}
 function renderOptions(){
  const q=($('tournament-staff-search').value||'').trim().toLowerCase();
  const opts=profiles.filter(p=>!roles.some(r=>r.user_id===p.id&&['admin','super_admin'].includes(r.role))&&(!q||String(p.display_name||'').toLowerCase().includes(q)||p.id.toLowerCase().includes(q))).slice(0,80);
  $('tournament-staff-user').innerHTML='<option value="">Select a member</option>'+opts.map(p=>'<option value="'+p.id+'">'+esc(p.display_name||'PUNIX Member')+' · '+p.id.slice(0,8)+'</option>').join('');
 }
 async function loadAssignments(){
  const r=await db.from('tournament_staff_assignments').select('user_id,created_at').eq('tournament_id',selectedTournament).order('created_at');
  if(r.error){$('tournament-staff-current').innerHTML='<p>Could not load assignments: '+esc(r.error.message)+'</p>';return;}
  $('tournament-staff-current').innerHTML=(r.data||[]).map(a=>{const p=profiles.find(x=>x.id===a.user_id);return '<article class="pnx-admin-entry"><div><strong>'+esc(p?.display_name||'PUNIX account')+'</strong><small>ACCOUNT '+esc(a.user_id)+'</small></div><button type="button" data-remove-staff="'+a.user_id+'">REMOVE ACCESS</button></article>';}).join('')||'<p class="pnx-recent-empty">No tournament staff assigned yet.</p>';
 }
 async function assign(){
  const id=$('tournament-staff-user').value;if(!id){note('Select a PUNIX account first.');return;}
  const r=await db.rpc('admin_set_tournament_staff',{p_tournament_id:selectedTournament,p_user_id:id,p_assign:true});
  if(r.error){note('Could not assign staff: '+r.error.message);return;}
  note('Staff member assigned to this tournament only.');$('tournament-staff-user').value='';await loadAssignments();
 }
 window.PUNIX_RENDER_TOURNAMENT_STAFF=async id=>{
  selectedTournament=id;await ensurePanel();
  if(!profiles.length){const [p,r]=await Promise.all([db.from('profiles').select('id,display_name').order('display_name'),db.from('user_roles').select('user_id,role')]);if(p.error){note('Could not load PUNIX accounts: '+p.error.message);return;}profiles=p.data||[];roles=r.data||[];renderOptions();}
  await loadAssignments();
 };
})();