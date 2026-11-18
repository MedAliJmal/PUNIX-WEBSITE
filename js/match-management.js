(() => {
 const $=id=>document.getElementById(id);
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const cfg=window.PUNIX_SUPABASE_CONFIG;
 const db=window.PUNIX_SUPABASE_CLIENT||(window.PUNIX_SUPABASE_CLIENT=window.supabase&&cfg?.url&&cfg?.publishableKey?window.supabase.createClient(cfg.url,cfg.publishableKey):null);
 const params=new URLSearchParams(location.search),matchId=params.get('id');
 let match=null,tournament=null,entries=[],role='staff';
 const message=t=>{$('match-message').textContent=t;};
 const gate=t=>{$('match-access').textContent=t;$('match-access').hidden=false;$('match-workspace').hidden=true;};
 const bracketName=m=>{
  const section=String(m.bracket_section||'').toLowerCase(),label=String(m.bracket_label||'').toLowerCase();
  if(section==='winners'||label.includes('winner')||label.includes('upper'))return'UPPER BRACKET';
  if(section==='losers'||label.includes('loser')||label.includes('lower'))return'LOWER BRACKET';
  if(section.includes('final')||label.includes('final'))return(m.bracket_label||'GRAND FINAL').toUpperCase();
  return(m.bracket_label||'ROUND '+m.round_number).toUpperCase();
 };
 function fillSelect(id,selected,includeNone,label){
  const el=$(id),none=includeNone?'<option value="">'+label+'</option>':'';
  el.innerHTML=none+entries.map(e=>'<option value="'+esc(e.id)+'">'+esc(e.display_name)+'</option>').join('');
  el.value=selected||'';
 }
 async function loadMatch(){
  const r=await db.from('public_tournament_matches').select('*').eq('id',matchId).maybeSingle();
  if(r.error)throw new Error('Could not load this match: '+r.error.message);
  if(!r.data)throw new Error('This match does not exist or is not available.');
  match=r.data;
  const tr=await db.from('tournaments').select('id,title,game_name,best_of').eq('id',match.tournament_id).maybeSingle();
  if(tr.error)throw new Error('Could not load tournament details: '+tr.error.message);
  if(!tr.data)throw new Error('The tournament for this match could not be found.');
  tournament=tr.data;
  const er=await db.from('public_tournament_registrations').select('id,display_name').eq('tournament_id',match.tournament_id).order('display_name');
  if(er.error)throw new Error('Could not load participants: '+er.error.message);
  entries=er.data||[];
  render();
 }
 function render(){
  $('match-access').hidden=true;$('match-workspace').hidden=false;
  $('match-back').href=role==='admin'?'admin.html#tournaments':'tournament-staff.html';
  $('match-access-label').textContent=role==='admin'?'ADMIN MATCH ACCESS':'ASSIGNED STAFF MATCH ACCESS';
  $('match-tournament-name').textContent=(tournament.game_name||'PUNIX TOURNAMENT').toUpperCase()+' / '+tournament.title.toUpperCase();
  $('match-heading').textContent=bracketName(match)+' · MATCH '+match.match_number;
  $('match-subheading').textContent='ROUND '+match.round_number+' · '+(match.best_of||tournament.best_of||1)+' MAP SERIES · '+match.status.toUpperCase();
  $('match-state').textContent=match.status.toUpperCase();
  $('match-team-a').textContent=match.participant_a_name||'TBD';
  $('match-team-b').textContent=match.participant_b_name||'TBD';
  $('match-current-score-a').textContent=match.score_a??'—';
  $('match-current-score-b').textContent=match.score_b??'—';
  $('match-id-label').textContent='MATCH ID · '+match.id;
  $('match-best-of').value=String(match.best_of||tournament.best_of||1);
  $('match-round').value=match.round_number;
  $('match-number').value=match.match_number;
  fillSelect('match-participant-a',match.participant_a_id,true,'TBD');
  fillSelect('match-participant-b',match.participant_b_id,true,'TBD');
  fillSelect('match-winner',match.winner_registration_id,true,'NO WINNER YET');
  $('match-score-a').value=match.score_a??'';
  $('match-score-b').value=match.score_b??'';
  $('match-status').value=match.status;
  message('');
 }
 async function boot(){
  if(!db){gate('Supabase could not initialize. Please reload the page.');return;}
  if(!matchId){gate('No match was selected. Return to the tournament dashboard and click a match.');return;}
  const sr=await db.auth.getSession();
  const user=sr.data?.session?.user;
  if(sr.error||!user?.id){gate('ACCESS RESTRICTED — Sign in to manage this match.');return;}
  const ar=await db.from('user_roles').select('role').eq('user_id',user.id).in('role',['admin','super_admin']).limit(1);
  if(ar.error){gate('Could not verify administrator permissions: '+ar.error.message);return;}
  if(ar.data?.length)role='admin';
  else{
   const mr=await db.from('public_tournament_matches').select('tournament_id').eq('id',matchId).maybeSingle();
   if(mr.error||!mr.data){gate('This match is unavailable or could not be verified.');return;}
   const ass=await db.from('tournament_staff_assignments').select('id').eq('user_id',user.id).eq('tournament_id',mr.data.tournament_id).limit(1);
   if(ass.error||!ass.data?.length){gate('ACCESS DENIED — You are not assigned to manage this tournament match.');return;}
   role='staff';
  }
  try{await loadMatch();}catch(e){gate(e.message||'Could not load match details.');}
 }
 $('match-edit-form').addEventListener('submit',async e=>{
  e.preventDefault();
  if(!match||!tournament)return;
  const a=$('match-participant-a').value||null,b=$('match-participant-b').value||null,w=$('match-winner').value||null;
  const sa=$('match-score-a').value,sb=$('match-score-b').value;
  const p={tournament_id:match.tournament_id,best_of:Number($('match-best-of').value),round_number:Number($('match-round').value),match_number:Number($('match-number').value),participant_a_id:a,participant_b_id:b,score_a:sa===''?null:Number(sa),score_b:sb===''?null:Number(sb),winner_registration_id:w,status:$('match-status').value};
  if(![1,3,5].includes(p.best_of)){message('Match series must be BO1, BO3 or BO5.');return;}
  if(a&&a===b){message('A participant cannot play against itself.');return;}
  if([p.score_a,p.score_b].some(v=>v!==null&&(!Number.isInteger(v)||v<0))){message('Map wins must be non-negative whole numbers.');return;}
  const target=Math.ceil(p.best_of/2);
  // A decisive map score is enough to complete the match. This prevents a
  // saved winning score from remaining SCHEDULED and blocking bracket routing.
  if(a&&b&&p.score_a!==null&&p.score_b!==null){
   if(p.score_a===target&&p.score_b<target){p.winner_registration_id=a;p.status='completed';}
   else if(p.score_b===target&&p.score_a<target){p.winner_registration_id=b;p.status='completed';}
  }
  if(p.status==='completed'&&(!a||!b||!p.winner_registration_id||(p.winner_registration_id!==a&&p.winner_registration_id!==b)||p.score_a===null||p.score_b===null)){message('A completed match requires two participants, both scores and a valid winner.');return;}
  if(p.status==='completed'&&((p.winner_registration_id===a&&(p.score_a!==target||p.score_b>=target))||(p.winner_registration_id===b&&(p.score_b!==target||p.score_a>=target)))){message('Invalid BO'+p.best_of+' result. The winner must reach '+target+' map wins and the opponent must have fewer.');return;}
  if(p.status!=='completed'&&((p.score_a??0)>=target||(p.score_b??0)>=target)){message('A participant has reached the BO'+p.best_of+' winning score. Complete the match and select the winner.');return;}
  $('match-save').disabled=true;message('Saving changes…');
  const r=await db.from('tournament_matches').update(p).eq('id',match.id).eq('tournament_id',match.tournament_id).select('id').maybeSingle();
  $('match-save').disabled=false;
  if(r.error){message('Could not save match: '+r.error.message);return;}
  if(!r.data?.id){message('No match was updated. Refresh and verify your access.');return;}
  try{await loadMatch();message('Match saved. Bracket advancement rules have been applied.');}
  catch(err){message('The match was saved, but refreshing its details failed: '+(err.message||'Unknown error'));}
 });
 $('match-reload').addEventListener('click',async()=>{ $('match-reload').disabled=true;try{await loadMatch();}catch(e){message(e.message||'Could not reload match.');}finally{$('match-reload').disabled=false;}});
 boot().catch(e=>gate(e.message||'Unexpected error while opening the selected match.'));
})();