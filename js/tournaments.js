(() => {
 const $=id=>document.getElementById(id),cfg=window.PUNIX_SUPABASE_CONFIG;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const date=v=>v?new Date(v).toLocaleString([],{dateStyle:'medium',timeStyle:'short'}):'TO BE ANNOUNCED';
 const formats={single_elimination:'SINGLE ELIMINATION',double_elimination:'DOUBLE ELIMINATION',round_robin:'ROUND ROBIN',swiss:'SWISS',custom:'CUSTOM FORMAT'};
 if(!window.supabase||!cfg?.url||!cfg?.publishableKey){$('tournament-status').textContent='PUNIX connection is not configured.';return;}
 const db=window.PUNIX_SUPABASE_CLIENT||(window.PUNIX_SUPABASE_CLIENT=window.supabase.createClient(cfg.url,cfg.publishableKey));let events=[],filter='all',active=null,session=window.PUNIX_AUTH_SESSION||null;
 let bracketRefreshTimer=null;
 async function renderBracket(id){
  const host=$('tournament-bracket-grid');
  const mr=await db.from('public_tournament_matches').select('*').eq('tournament_id',id).order('round_number').order('match_number');
  if(mr.error){host.innerHTML='<p class="tournament-status">The live bracket is temporarily unavailable.</p>';return;}
  const matches=mr.data||[];$('match-count').textContent=matches.length+' MATCHES';
  const sectionNames={winners:'WINNERS BRACKET',losers:'LOSERS BRACKET',grand_final:'GRAND FINAL',grand_final_reset:'GRAND FINAL RESET'};
  const sections={};matches.forEach(m=>{const key=m.bracket_section||'winners';(sections[key] ||= []).push(m);});
  const order=['winners','losers','grand_final','grand_final_reset'];
  host.innerHTML=matches.length?order.filter(key=>sections[key]?.length).map(key=>{
   const rows=sections[key].sort((a,b)=>a.round_number-b.round_number||a.match_number-b.match_number);
   const rounds={};rows.forEach(m=>{(rounds[m.round_number] ||= []).push(m);});
   const divider=key==='losers'&&sections.winners?.length?'<div class="bracket-structure-divider" aria-hidden="true"><span>UPPER BRACKET</span><i></i><span>LOWER BRACKET</span></div>':'';
   const heading=key==='winners'?'UPPER BRACKET · WINNERS':key==='losers'?'LOWER BRACKET · LOSERS':sectionNames[key];
   return divider+'<section class="bracket-lane bracket-lane-'+key+'"><h3>'+heading+'</h3><div class="bracket-lane-rounds">'+Object.keys(rounds).sort((a,b)=>Number(a)-Number(b)).map(round=>'<div class="bracket-round"><h4>'+(key==='grand_final'||key==='grand_final_reset'?'FINAL':'ROUND '+round)+'</h4>'+rounds[round].map(m=>'<article class="bracket-match"><small>MATCH '+m.match_number+' · '+esc(m.status.toUpperCase())+'</small><div class="bracket-side '+(m.winner_registration_id===m.participant_a_id?'winner':'')+'"><span>'+esc(m.participant_a_name||(m.status==='completed'&&m.participant_b_id?'BYE':'TBD'))+'</span><b>'+(m.score_a??'—')+'</b></div><div class="bracket-side '+(m.winner_registration_id===m.participant_b_id?'winner':'')+'"><span>'+esc(m.participant_b_name||(m.status==='completed'&&m.participant_a_id?'BYE':'TBD'))+'</span><b>'+(m.score_b??'—')+'</b></div></article>').join('')+'</div>').join('')+'</div></section>';
  }).join(''):'<p class="tournament-status">The tournament bracket has not been published yet.</p>';
 }
 function watchPublicBracket(id){if(bracketRefreshTimer)clearInterval(bracketRefreshTimer);renderBracket(id);bracketRefreshTimer=setInterval(()=>{if(active?.id===id)renderBracket(id);},10000);}
 function renderList(){const q=$('tournament-search').value.trim().toLowerCase();const rows=events.filter(t=>(filter==='all'||t.status===filter)&&(t.title+' '+t.game_name).toLowerCase().includes(q));
 $('tournament-grid').innerHTML=rows.map(t=>'<a class="tournament-card" href="tournaments.html?id='+encodeURIComponent(t.id)+'"><div class="tournament-card-top"><span>'+esc(t.game_name.toUpperCase())+'</span><span class="tournament-state '+esc(t.status)+'">'+esc(t.status.toUpperCase())+'</span></div><h3>'+esc(t.title)+'</h3>'+(session?.user?.id?'<p>'+esc(t.description||'A new competitive challenge hosted by PUNIX.')+'</p><div class="tournament-card-bottom"><span>'+esc(formats[t.format]||t.format)+'</span><span>'+(t.prize_pool?esc(t.prize_pool):'OPEN COMPETITION')+'</span></div><span class="tournament-card-link">VIEW EVENT DETAILS ↗</span>':'<span class="tournament-card-link">MEMBER ACCESS REQUIRED · SIGN IN TO VIEW ↗</span>')+'</a>').join('');
 $('tournament-count').textContent=rows.length+' / '+events.length+' EVENTS';$('tournament-status').hidden=Boolean(rows.length);if(!rows.length)$('tournament-status').textContent=events.length?'No tournaments match these filters yet.':'No tournaments have been announced yet. Check back soon.';}
 async function loadList(){$('tournament-status').hidden=false;const view=session?.user?.id?'public_tournaments':'public_tournament_directory';const order=session?.user?.id?'starts_at':'title';const r=await db.from(view).select('*').order(order,{ascending:true,nullsFirst:false});if(r.error){$('tournament-status').textContent='Could not load events. Please refresh or contact PUNIX support.';return;}events=r.data||[];renderList();}
 async function showDetail(id){if(!session?.user?.id){active=events.find(x=>x.id===id)||null;if(!active){$('tournament-status').textContent='This tournament could not be found.';return;}$('tournament-grid').hidden=true;$('tournament-toolbar').hidden=true;$('tournament-search').closest('.tournament-search-row').hidden=true;$('tournament-status').hidden=true;$('tournament-detail').hidden=false;$('detail-auth-gate').hidden=false;$('tournament-detail-grid').hidden=true;$('tournament-entries').hidden=true;$('tournament-bracket').hidden=false;$('tournament-detail-top').hidden=true;$('detail-auth-gate').querySelector('h2').innerHTML='FOLLOW THE <span>BRACKET.</span>';$('detail-auth-gate').querySelector('p:not(.tournament-kicker)').textContent='The live tournament bracket is public. Create a free PUNIX account or sign in to view full event details and register.';const next='tournaments.html?id='+encodeURIComponent(id);$('detail-auth-link').href='auth.html?redirect='+encodeURIComponent(next);history.replaceState(null,'','tournaments.html?id='+encodeURIComponent(id));watchPublicBracket(id);$('tournament-detail').scrollIntoView({behavior:'smooth',block:'start'});return;}const t=events.find(x=>x.id===id);if(!t){$('tournament-status').textContent='This tournament could not be found.';return;}$('detail-auth-gate').hidden=true;$('tournament-detail-top').hidden=false;$('tournament-detail-grid').hidden=false;$('tournament-entries').hidden=false;$('tournament-bracket').hidden=false;active=t;$('tournament-grid').hidden=true;$('tournament-toolbar').hidden=true;$('tournament-search').closest('.tournament-search-row').hidden=true;$('tournament-status').hidden=true;$('tournament-detail').hidden=false;
 $('detail-status').textContent=t.status.toUpperCase();$('detail-status').className='tournament-state '+t.status;$('detail-game').textContent=t.game_name.toUpperCase()+' / '+(formats[t.format]||t.format);$('detail-title').textContent=t.title;$('detail-description').textContent=t.description||'PUNIX competitive event.';
 const facts=[['START',date(t.starts_at)],['REGISTRATION CLOSES',date(t.registration_deadline)],['ENTRY TYPE',t.entry_type.toUpperCase()],['MAX ENTRIES',t.max_participants||'UNLIMITED'],['PRIZE POOL',t.prize_pool||'NOT ANNOUNCED'],['FORMAT',formats[t.format]||t.format]];
 $('detail-facts').innerHTML=facts.map(x=>'<div class="detail-fact"><span>'+esc(x[0])+'</span><strong>'+esc(x[1])+'</strong></div>').join('');$('detail-rules').hidden=!t.rules;$('detail-rules').textContent=t.rules||'';
 const er=await db.from('public_tournament_registrations').select('*').eq('tournament_id',id).order('created_at');const entries=er.data||[];$('entry-count').textContent=entries.length+' CONFIRMED';
 $('tournament-entries-list').innerHTML=entries.length?entries.map((e,i)=>{const players=Array.isArray(e.roster_public)?e.roster_public:[];const lineup=players.map(p=>(p.role==='substitute'?'SUB':'STARTER')+' · '+esc(p.in_game_name)).join(' / ');return '<div class="tournament-entry">'+(e.team_logo_url?'<img class="tournament-entry-logo" src="'+esc(e.team_logo_url)+'" alt="'+esc(e.display_name)+' logo" loading="lazy">':'<span class="tournament-entry-logo-placeholder">'+esc((e.display_name||'T').slice(0,2).toUpperCase())+'</span>')+'<div><strong>'+String(i+1).padStart(2,'0')+' / '+esc(e.display_name)+'</strong>'+(lineup?'<small>'+esc(lineup)+'</small>':'<small>'+esc(e.in_game_name)+'</small>')+'</div></div>';}).join(''):'<p class="tournament-status">Confirmed entries will appear here.</p>';
 watchPublicBracket(id);
 await setupRegistration(t);history.replaceState(null,'','tournaments.html?id='+encodeURIComponent(id));$('tournament-detail').scrollIntoView({behavior:'smooth',block:'start'});}
 function buildRosterFields(t){
  const host=$('registration-roster-members'),min=Math.max(1,Number(t.min_team_size)||5),max=Math.max(min,Number(t.max_team_size)||min),subs=Math.max(0,Number(t.max_substitutes)||0);
  let html='';
  for(let i=1;i<max;i++){
   const required=i<min;
   html+='<div class="registration-roster-player"><strong>STARTER '+(i+1)+(required?' · REQUIRED':' · OPTIONAL')+'</strong><div class="registration-roster-inputs"><label>DISCORD USERNAME<input data-roster-role="starter" data-roster-index="'+i+'" data-roster-field="discord" maxlength="80" minlength="2" '+(required?'required':'')+' placeholder="Discord username"></label><label>IN-GAME NAME<input data-roster-role="starter" data-roster-index="'+i+'" data-roster-field="ign" maxlength="60" minlength="2" '+(required?'required':'')+' placeholder="Player name"></label></div></div>';
  }
  for(let i=1;i<=subs;i++){
   html+='<div class="registration-roster-player registration-roster-sub"><strong>SUBSTITUTE '+i+' · OPTIONAL</strong><div class="registration-roster-inputs"><label>DISCORD USERNAME<input data-roster-role="substitute" data-roster-index="'+i+'" data-roster-field="discord" maxlength="80" minlength="2" placeholder="Discord username"></label><label>IN-GAME NAME<input data-roster-role="substitute" data-roster-index="'+i+'" data-roster-field="ign" maxlength="60" minlength="2" placeholder="Player name"></label></div></div>';
  }
  host.innerHTML=html;
  $('registration-roster-summary').textContent=min===max?min+' STARTERS · UP TO '+subs+' SUBS':min+'–'+max+' STARTERS · UP TO '+subs+' SUBS';
  $('registration-roster-help').textContent='You are the captain and count as one starter. Fill the required starter slots; extra starters and substitutes are optional.';
 }
 async function setupRegistration(t){
  const form=$('registration-form'),note=$('registration-note'),teamField=$('registration-team-field'),teamNameInput=$('registration-team-name'),discordInput=$('registration-discord'),ignInput=$('registration-ign'),discordLabel=$('registration-discord-label'),ignLabel=$('registration-ign-label'),rosterField=$('registration-roster-field'),logoField=$('registration-logo-field'),logoInput=$('registration-team-logo');
  if(!form||!note||!teamField||!teamNameInput||!discordInput||!ignInput||!discordLabel||!ignLabel||!rosterField||!logoField||!logoInput){if(note)note.textContent='The tournament form is incomplete or out of date. Please refresh the page; if this continues, contact PUNIX support.';return;}
  form.hidden=true;
  const authState=await db.auth.getSession();session=authState.data?.session||window.PUNIX_AUTH_SESSION||session||null;window.PUNIX_AUTH_SESSION=session;
  if(authState.error&&!session){note.textContent='Could not verify your PUNIX session. Please reload the page and try again.';return;}
  if(t.status!=='upcoming'||!t.registration_open||(t.registration_deadline&&new Date(t.registration_deadline)<=new Date())){note.textContent='Registration is currently closed.';return;}
  if(!session?.user?.id){note.innerHTML='Sign in with your PUNIX account to enter. <a href="auth.html">MEMBER ACCESS ↗</a>';return;}
  const existing=await db.from('tournament_registrations').select('status').eq('tournament_id',t.id).eq('user_id',session.user.id).in('status',['pending','confirmed']).maybeSingle();
  if(existing.data){note.textContent='Your entry status: '+existing.data.status.toUpperCase()+'. Contact PUNIX admins if you need help.';return;}
  if(t.entry_type==='team'){
   teamField.hidden=false;teamNameInput.required=true;rosterField.hidden=false;logoField.hidden=false;buildRosterFields(t);
  }else{
   teamField.hidden=true;teamNameInput.required=false;teamNameInput.value='';rosterField.hidden=true;logoField.hidden=true;logoInput.value='';$('registration-logo-preview').hidden=true;$('registration-roster-members').innerHTML='';
  }
  discordLabel.hidden=false;ignLabel.hidden=false;discordInput.required=true;ignInput.required=true;discordInput.disabled=false;ignInput.disabled=false;
  discordLabel.querySelector('span').textContent=t.entry_type==='team'?'CAPTAIN DISCORD USERNAME':'DISCORD USERNAME';
  ignLabel.querySelector('span').textContent=t.entry_type==='team'?'CAPTAIN IN-GAME NAME':'IN-GAME NAME';
  discordInput.placeholder='Discord username';ignInput.placeholder=t.entry_type==='team'?'Captain in-game name':'Your player name';
  note.textContent=t.entry_type==='team'?'Register your independent team as captain. Add the required starters and any substitutes. Teammates do not need PUNIX accounts; PUNIX will review the full roster.':'Enter your Discord and in-game name so PUNIX can contact you.';
  form.hidden=false;
 }
 $('registration-form').addEventListener('submit',async e=>{
  e.preventDefault();
  if(!active||!session?.user?.id){$('registration-note').textContent='Your PUNIX session has expired. Please sign in again.';return;}
  const form=$('registration-form'),note=$('registration-note'),submit=$('registration-submit'),logoInput=$('registration-team-logo');
  const teamName=active.entry_type==='team'?$('registration-team-name').value.trim():'';
  const discord=$('registration-discord').value.trim(),ign=$('registration-ign').value.trim();
  if((active.entry_type==='team'&&teamName.length<2)||discord.length<2||ign.length<2){note.textContent='Please enter the team name (for team events), captain Discord username and captain in-game name.';return;}
  const logoUrl=active.entry_type==='team'?logoInput.value.trim():'';
  if(logoUrl){try{const parsed=new URL(logoUrl);if(parsed.protocol!=='https:'||logoUrl.length>500){throw new Error();}}catch{note.textContent='Enter a valid HTTPS image URL (maximum 500 characters).';return;}}
  const roster=[];
  if(active.entry_type==='team'){
   const min=Math.max(1,Number(active.min_team_size)||5),max=Math.max(min,Number(active.max_team_size)||min),subMax=Math.max(0,Number(active.max_substitutes)||0);
   const rows=[...$('registration-roster-members').querySelectorAll('.registration-roster-player')];
   for(const row of rows){
    const role=row.querySelector('[data-roster-role]').dataset.rosterRole;
    const d=row.querySelector('[data-roster-field="discord"]').value.trim();
    const n=row.querySelector('[data-roster-field="ign"]').value.trim();
    const required=role==='starter'&&Number(row.querySelector('[data-roster-index]').dataset.rosterIndex)<min;
    if(!d&&!n){if(required){note.textContent='Please complete all required starter slots.';return;}continue;}
    if(d.length<2||n.length<2){note.textContent='Complete both Discord username and in-game name for every added player.';return;}
    roster.push({role,discord_handle:d,in_game_name:n});
   }
   const starters=1+roster.filter(x=>x.role==='starter').length,subs=roster.filter(x=>x.role==='substitute').length;
   if(starters<min||starters>max){note.textContent='This event requires between '+min+' and '+max+' starting players, including you as captain.';return;}
   if(subs>subMax){note.textContent='This event allows up to '+subMax+' substitutes.';return;}
  }
  const payload={tournament_id:active.id,user_id:session.user.id,team_id:null,team_name:teamName,in_game_name:ign,discord_handle:discord,roster,team_logo_url:logoUrl};
  submit.disabled=true;note.textContent='Submitting your entry…';
  try{
   const r=await db.from('tournament_registrations').insert(payload);if(r.error)throw r.error;form.reset();form.hidden=true;note.textContent='Entry submitted with your roster'+(logoUrl?' and team logo URL':'')+'. Your registration is now pending PUNIX admin confirmation.';
  }
  catch(err){const message=err?.message||'Unexpected connection error. Please try again.';note.textContent='Entry not submitted: '+message;if(/already registered|duplicate|appears more than once/i.test(message)){window.alert('Registration blocked: '+message);}}
  finally{submit.disabled=false;}
 });
 $('registration-team-logo').addEventListener('input',()=>{const value=$('registration-team-logo').value.trim(),wrap=$('registration-logo-preview'),img=$('registration-logo-preview-img');if(!value){wrap.hidden=true;img.removeAttribute('src');return;}try{const u=new URL(value);if(u.protocol!=='https:'||value.length>500)throw new Error();img.src=u.href;wrap.hidden=false;}catch{wrap.hidden=true;img.removeAttribute('src');}});
 $('detail-back-link').addEventListener('click',()=>{$('back-to-tournaments').click();});
 $('back-to-tournaments').addEventListener('click',()=>{history.replaceState(null,'','tournaments.html');if(bracketRefreshTimer){clearInterval(bracketRefreshTimer);bracketRefreshTimer=null;}active=null;$('tournament-detail').hidden=true;$('tournament-grid').hidden=false;$('tournament-toolbar').hidden=false;$('tournament-search').closest('.tournament-search-row').hidden=false;window.scrollTo({top:0,behavior:'smooth'});});
 document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>{x.classList.toggle('is-active',x===b);x.setAttribute('aria-pressed',String(x===b));});renderList();}));$('tournament-search').addEventListener('input',renderList);
 async function boot(){const r=await db.auth.getSession();session=r.data?.session||window.PUNIX_AUTH_SESSION||null;window.PUNIX_AUTH_SESSION=session;await loadList();const id=new URLSearchParams(location.search).get('id');if(id)showDetail(id);}db.auth.onAuthStateChange((_e,next)=>{session=next||null;window.PUNIX_AUTH_SESSION=session;Promise.resolve().then(async()=>{await loadList();const id=new URLSearchParams(location.search).get('id');if(id)await showDetail(id);else if(active)await setupRegistration(active);});});boot();
})();