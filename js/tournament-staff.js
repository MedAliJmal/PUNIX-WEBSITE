(() => {
 const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const cfg=window.PUNIX_SUPABASE_CONFIG;
 if(!window.supabase||!cfg?.url||!cfg?.publishableKey){$('staff-gate').textContent='Supabase is not configured.';return;}
 const db=window.PUNIX_SUPABASE_CLIENT||window.supabase.createClient(cfg.url,cfg.publishableKey);window.PUNIX_SUPABASE_CLIENT=db;
 let user=null,events=[],active=null,entries=[],matches=[],entryFilter='pending';
 const say=t=>{$('staff-event-message').textContent=t;};
 async function loadEvents(){
  $('staff-tournament-list').innerHTML='<p class="pnx-staff-empty">Loading assignments…</p>';
  const a=await db.from('tournament_staff_assignments').select('tournament_id').eq('user_id',user.id);
  if(a.error){$('staff-tournament-list').innerHTML='<p class="pnx-staff-empty">Could not load assignments: '+esc(a.error.message)+'</p>';return;}
  const ids=[...new Set((a.data||[]).map(x=>x.tournament_id))];
  if(!ids.length){events=[];$('staff-tournament-list').innerHTML='<p class="pnx-staff-empty">No tournaments have been assigned to your account yet. Contact a PUNIX website admin.</p>';return;}
  const t=await db.from('tournaments').select('id,title,game_name,format,best_of,status,registration_open').in('id',ids).order('created_at',{ascending:false});
  if(t.error){$('staff-tournament-list').innerHTML='<p class="pnx-staff-empty">Could not load assigned events: '+esc(t.error.message)+'</p>';return;}
  events=t.data||[];
  $('staff-tournament-list').innerHTML=events.map(x=>'<article class="pnx-staff-event-card"><div><h3>'+esc(x.title)+'</h3><p>'+esc(x.game_name)+' · '+esc(String(x.format).replace(/_/g,' ').toUpperCase())+' · BO'+x.best_of+' · '+esc(x.status.toUpperCase())+'</p><p>REGISTRATION '+(x.registration_open?'OPEN':'CLOSED')+'</p></div><button type="button" data-staff-open="'+x.id+'">MANAGE EVENT ↗</button></article>').join('')||'<p class="pnx-staff-empty">No accessible tournaments found.</p>';
  $('staff-tournament-list').querySelectorAll('[data-staff-open]').forEach(b=>b.addEventListener('click',()=>openEvent(b.dataset.staffOpen)));
 }
 function setTab(tab){['settings','entries','matches','activity'].forEach(x=>{$('staff-'+x+'-panel').hidden=x!==tab;});document.querySelectorAll('[data-staff-tab]').forEach(b=>b.classList.toggle('is-active',b.dataset.staffTab===tab));if(tab==='entries')loadEntries();if(tab==='matches')loadMatches();if(tab==='activity')loadActivity();}
 async function openEvent(id){
  const t=events.find(x=>x.id===id);if(!t)return;active=t;$('staff-workspace').hidden=false;$('staff-tournament-list').closest('.pnx-staff-section').hidden=true;
  $('staff-event-title').textContent=t.title;$('staff-event-meta').textContent=t.game_name+' · '+String(t.format).replace(/_/g,' ').toUpperCase()+' · BO'+t.best_of;
  $('staff-format').value=t.format;$('staff-best-of').value=String(t.best_of||1);$('staff-status').value=t.status;$('staff-registration-open').checked=!!t.registration_open;
  say('You are managing only this assigned tournament.');setTab('settings');window.scrollTo({top:0,behavior:'smooth'});
 }
 async function loadEntries(){
  const r=await db.from('tournament_registrations').select('id,team_name,in_game_name,discord_handle,roster,status,created_at').eq('tournament_id',active.id).eq('status',entryFilter).order('created_at');
  if(r.error){$('staff-entry-list').innerHTML='<p class="pnx-staff-empty">'+esc(r.error.message)+'</p>';return;}
  entries=r.data||[];
  $('staff-entry-list').innerHTML=entries.map(x=>'<article class="pnx-staff-row"><div><strong>'+esc(x.team_name||x.in_game_name)+'</strong><small>'+esc((x.team_name?'TEAM':'PLAYER')+' · '+(x.discord_handle||'No Discord')+' · '+x.status.toUpperCase())+'</small><small>'+esc((x.roster||[]).map(p=>(p.role||'starter')+': '+(p.in_game_name||'')).join(' / '))+'</small></div><div class="pnx-staff-row-actions">'+(entryFilter==='pending'?'<button data-entry-action="confirmed" data-entry-id="'+x.id+'">APPROVE</button><button class="is-danger" data-entry-action="rejected" data-entry-id="'+x.id+'">REJECT</button>':entryFilter==='confirmed'?'<button class="is-danger" data-entry-action="withdrawn" data-entry-id="'+x.id+'">REVOKE APPROVAL</button>':'')+'</div></article>').join('')||'<p class="pnx-staff-empty">No '+entryFilter+' registrations.</p>';
  $('staff-entry-list').querySelectorAll('[data-entry-action]').forEach(b=>b.addEventListener('click',async()=>{const action=b.dataset.entryAction;if(!confirm('Set this registration to '+action.toUpperCase()+'?'))return;const r=await db.from('tournament_registrations').update({status:action,reviewed_at:new Date().toISOString(),reviewed_by:user.id}).eq('id',b.dataset.entryId).eq('tournament_id',active.id);if(r.error){say('Could not update registration: '+r.error.message);return;}say('Registration updated.');await loadEntries();}));
 }
 async function loadMatches(){
  const r=await db.from('public_tournament_matches').select('*').eq('tournament_id',active.id).order('round_number').order('match_number');
  if(r.error){$('staff-match-list').innerHTML='<p class="pnx-staff-empty">'+esc(r.error.message)+'</p>';return;}
  matches=r.data||[];
  const bracketType=m=>{const label=String(m.bracket_label||'').toLowerCase();if(label.includes('upper'))return'upper';if(label.includes('lower'))return'lower';if(label.includes('final'))return'final';return'other';};
  const renderMatches=()=>{
   const q=$('staff-match-search').value.trim().toLowerCase(),bracket=$('staff-match-bracket').value,status=$('staff-match-status').value;
   const filtered=matches.filter(m=>{const names=[m.bracket_label,m.participant_a_name,m.participant_b_name,'round '+m.round_number,'match '+m.match_number,m.status].join(' ').toLowerCase();return(!q||names.includes(q))&&(bracket==='all'||bracketType(m)===bracket)&&(status==='all'||m.status===status);});
   $('staff-match-count').textContent=filtered.length+' OF '+matches.length+' MATCHES · SEARCH BY TEAM, PLAYER OR MATCH NUMBER';
   $('staff-match-list').innerHTML=filtered.map(m=>'<article class="pnx-staff-row pnx-staff-match-row"><div><strong>'+esc((m.bracket_label||'ROUND '+m.round_number).toUpperCase())+' · MATCH '+m.match_number+' · BO'+(m.best_of||active.best_of)+'</strong><small>'+esc(m.participant_a_name||'TBD')+' <b>'+(m.score_a??'—')+' : '+(m.score_b??'—')+'</b> '+esc(m.participant_b_name||'TBD')+' · '+esc(m.status.toUpperCase())+'</small></div><button type="button" data-match-edit="'+m.id+'">EDIT MATCH</button></article>').join('')||'<p class="pnx-staff-empty">'+(matches.length?'No matches match these filters.':'No bracket matches exist yet.')+'</p>';
   $('staff-match-list').querySelectorAll('[data-match-edit]').forEach(btn=>btn.addEventListener('click',()=>{const m=matches.find(x=>x.id===btn.dataset.matchEdit);if(!m)return;$('staff-match-id').value=m.id;$('staff-match-best-of').value=String(m.best_of||active.best_of);$('staff-match-round').value=m.round_number;$('staff-match-number').value=m.match_number;$('staff-match-a').value=m.participant_a_id||'';$('staff-match-b').value=m.participant_b_id||'';$('staff-score-a').value=m.score_a??'';$('staff-score-b').value=m.score_b??'';$('staff-match-winner').value=m.winner_registration_id||'';$('staff-match-status').value=m.status;$('staff-match-editor-title').textContent=(m.bracket_label||'ROUND '+m.round_number)+' · MATCH '+m.match_number+' — '+(m.participant_a_name||'TBD')+' vs '+(m.participant_b_name||'TBD');$('staff-match-form').scrollIntoView({behavior:'smooth',block:'center'});}));
  };
  $('staff-match-search').oninput=renderMatches;$('staff-match-bracket').onchange=renderMatches;$('staff-match-status').onchange=renderMatches;renderMatches();
  const er=await db.from('public_tournament_registrations').select('id,display_name').eq('tournament_id',active.id);
  const opts=(er.data||[]).map(x=>'<option value="'+x.id+'">'+esc(x.display_name)+'</option>').join('');
  $('staff-match-a').innerHTML='<option value="">TBD</option>'+opts;$('staff-match-b').innerHTML='<option value="">TBD</option>'+opts;$('staff-match-winner').innerHTML='<option value="">No winner</option>'+opts;
  $('staff-match-form').dataset.loaded='1';
 }
 async function loadActivity(){
  const r=await db.from('tournament_staff_activity').select('id,actor_user_id,action,record_id,before_data,after_data,created_at').eq('tournament_id',active.id).order('created_at',{ascending:false}).limit(100);
  if(r.error){$('staff-activity-list').innerHTML='<p class="pnx-staff-empty">'+esc(r.error.message)+'</p>';return;}
  $('staff-activity-list').innerHTML=(r.data||[]).map(x=>'<article class="pnx-staff-row"><div><strong>'+esc(x.action.toUpperCase().replace('.',' / '))+'</strong><small>'+esc(x.actor_user_id===user.id?'YOU':x.actor_user_id||'SYSTEM')+' · '+esc(new Date(x.created_at).toLocaleString())+'</small><small>RECORD '+esc(x.record_id||'—')+'</small></div></article>').join('')||'<p class="pnx-staff-empty">No activity recorded yet.</p>';
 }
 $('staff-settings-form').addEventListener('submit',async e=>{e.preventDefault();const p={format:$('staff-format').value,best_of:Number($('staff-best-of').value),status:$('staff-status').value,registration_open:$('staff-registration-open').checked,updated_at:new Date().toISOString()};const r=await db.from('tournaments').update(p).eq('id',active.id).select('id').maybeSingle();if(r.error){say('Could not save settings: '+r.error.message);return;}say('Tournament settings saved.');await loadEvents();});
 $('staff-match-form').addEventListener('submit',async e=>{e.preventDefault();const a=$('staff-match-a').value||null,b=$('staff-match-b').value||null,w=$('staff-match-winner').value||null,sa=$('staff-score-a').value,sb=$('staff-score-b').value;const p={tournament_id:active.id,best_of:Number($('staff-match-best-of').value),round_number:Number($('staff-match-round').value),match_number:Number($('staff-match-number').value),participant_a_id:a,participant_b_id:b,score_a:sa===''?null:Number(sa),score_b:sb===''?null:Number(sb),winner_registration_id:w,status:$('staff-match-status').value};if(![1,3,5].includes(p.best_of)){say('Match series must be BO1, BO3 or BO5.');return;}if(a&&a===b){say('A participant cannot play against itself.');return;}if([p.score_a,p.score_b].some(v=>v!==null&&(!Number.isInteger(v)||v<0))){say('Map wins must be non-negative whole numbers.');return;}const target=Math.ceil(p.best_of/2);if(p.status==='completed'&&(!a||!b||!w||(w!==a&&w!==b)||p.score_a===null||p.score_b===null)){say('A completed match requires two participants, both scores and a valid winner.');return;}if(p.status==='completed'&&((w===a&&(p.score_a!==target||p.score_b>=target))||(w===b&&(p.score_b!==target||p.score_a>=target)))){say('Invalid BO'+p.best_of+' result.');return;}const id=$('staff-match-id').value;const r=id?await db.from('tournament_matches').update(p).eq('id',id).eq('tournament_id',active.id):await db.from('tournament_matches').insert(p);if(r.error){say('Could not save match: '+r.error.message);return;}$('staff-match-id').value='';$('staff-match-form').reset();$('staff-match-editor-title').textContent='SELECT A MATCH TO EDIT';say('Match saved. The bracket advancement trigger has been notified.');await loadMatches();});
 $('staff-match-clear').addEventListener('click',()=>{$('staff-match-id').value='';$('staff-match-form').reset();$('staff-match-editor-title').textContent='SELECT A MATCH TO EDIT';});
 $('staff-refresh').addEventListener('click',loadEvents);$('staff-back').addEventListener('click',()=>{$('staff-workspace').hidden=true;$('staff-tournament-list').closest('.pnx-staff-section').hidden=false;active=null;});
 document.querySelectorAll('[data-staff-tab]').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.staffTab)));
 document.querySelectorAll('[data-entry-filter]').forEach(b=>b.addEventListener('click',()=>{entryFilter=b.dataset.entryFilter;document.querySelectorAll('[data-entry-filter]').forEach(x=>x.classList.toggle('is-active',x===b));loadEntries();}));
 async function boot(){
  const s=await db.auth.getSession();if(s.error||!s.data?.session?.user?.id){$('staff-gate').textContent='ACCESS RESTRICTED — Sign in with your PUNIX account.';return;}user=s.data.session.user;
  const role=await db.from('user_roles').select('role').eq('user_id',user.id).maybeSingle();
  if(['admin','super_admin'].includes(role.data?.role)){$('staff-gate').innerHTML='You are a website administrator. Use the <a href="admin.html#tournaments">main Admin Tournament Hub</a> to manage all events.';return;}
  const a=await db.from('tournament_staff_assignments').select('id').eq('user_id',user.id).limit(1);
  if(a.error){$('staff-gate').textContent='Tournament staff access is not configured yet. The PUNIX administrator must apply the tournament staff database migration.';return;}
  if(!a.data?.length){$('staff-gate').textContent='ACCESS DENIED — Your account has not been assigned to any tournament.';return;}
  $('staff-gate').hidden=true;$('staff-app').hidden=false;await loadEvents();
 }
 db.auth.onAuthStateChange((_e,s)=>{if(!s){location.href='auth.html?redirect='+encodeURIComponent('tournament-staff.html');}});
 boot();
})();