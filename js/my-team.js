(() => {
  const cfg=window.PUNIX_SUPABASE_CONFIG;
  const byId=id=>document.getElementById(id);
  const message=byId('team-hub-message');
  const setMessage=(value,error=false)=>{message.textContent=value;message.classList.toggle('error',error);};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  if(!window.supabase||!cfg?.url||!cfg?.publishableKey){setMessage('PUNIX connection is not configured.',true);return;}
  const db=window.supabase.createClient(cfg.url,cfg.publishableKey);
  let teamId=null;
  let lastInviteUrl='';
  const division={men:"MEN'S TEAM",women:"WOMEN'S TEAM",mixed:'MIXED TEAM',open:'OPEN DIVISION'};
  const role={captain:'CAPTAIN',player:'PLAYER',coach:'COACH',manager:'MANAGER',substitute:'SUBSTITUTE'};
  function renderRoster(members){
    byId('my-team-count').textContent=members.length+' MEMBERS';
    byId('my-team-roster').innerHTML=members.map(m=>'<div class="my-team-person">'+(m.avatar_url?'<img src="'+esc(m.avatar_url)+'" alt="">':'<span class="my-team-avatar">'+esc((m.display_name||'P').slice(0,1).toUpperCase())+'</span>')+'<div><strong>'+esc(m.display_name)+'</strong><small>'+esc(role[m.member_role]||'PLAYER')+'</small></div></div>').join('');
  }
  function renderInvites(items){
    const host=byId('pending-invitations');
    if(!items.length){host.innerHTML='<p class="empty-roster">No pending invitations.</p>';return;}
    host.innerHTML=items.map(i=>'<div class="pending-invite"><div><strong>INVITATION LINK</strong><small>Expires '+new Date(i.expires_at).toLocaleString()+'</small></div><button type="button" data-revoke="'+esc(i.id)+'">REVOKE</button></div>').join('');
    host.querySelectorAll('[data-revoke]').forEach(button=>button.addEventListener('click',async()=>{
      button.disabled=true;
      const {error}=await db.rpc('punix_revoke_team_invitation',{p_invitation_id:button.dataset.revoke});
      if(error){setMessage(error.message,true);button.disabled=false;return;}
      setMessage('Invitation revoked.');await load();
    }));
  }
  async function load(){
    setMessage('Loading your team space…');
    const {data:{session},error:sessionError}=await db.auth.getSession();
    if(sessionError)throw sessionError;
    if(!session){window.location.replace('auth.html?redirect='+encodeURIComponent('my-team.html'));return;}
    const {data,error}=await db.rpc('punix_my_team_dashboard');
    if(error)throw error;
    if(!data?.team){
      byId('create-team-panel').hidden=false;byId('my-team-panel').hidden=true;
      setMessage('You are not currently in a team. Create one or accept an invitation to join a roster.');
      return;
    }
    const team=data.team;teamId=team.id;
    byId('create-team-panel').hidden=true;byId('my-team-panel').hidden=false;
    byId('my-team-name').textContent=team.team_name;
    byId('my-team-game').textContent=team.game_name;
    byId('my-team-division').textContent=division[team.division]||'OPEN DIVISION';
    byId('my-team-status').textContent=(team.status||'active').toUpperCase();
    byId('my-team-description').textContent=team.description||'No team description added.';
    renderRoster(data.members||[]);
    byId('captain-tools').hidden=!data.is_captain;
    if(data.is_captain)renderInvites(data.invitations||[]);
    setMessage(data.is_captain?'You are the captain of this team.':'You are a member of this team. Your captain manages invitations and team deletion.');
  }
  byId('create-team-form').addEventListener('submit',async event=>{
    event.preventDefault();const button=byId('create-team-button');button.disabled=true;setMessage('Creating your team…');
    try{
      const {data,error}=await db.rpc('punix_create_team',{p_team_name:byId('new-team-name').value.trim(),p_game_name:byId('new-team-game').value.trim(),p_division:byId('new-team-division').value,p_description:byId('new-team-description').value.trim()});
      if(error)throw error;
      setMessage('Team created. You are now its captain.');await load();
    }catch(error){setMessage(error.message||'Could not create the team.',true);}
    finally{button.disabled=false;}
  });
  byId('create-invite-button').addEventListener('click',async()=>{
    const button=byId('create-invite-button');button.disabled=true;setMessage('Generating a secure invitation…');
    try{
      const {data,error}=await db.rpc('punix_create_team_invitation',{p_team_id:teamId});if(error)throw error;
      lastInviteUrl=new URL('team-invite.html?token='+encodeURIComponent(data),window.location.href).href;
      byId('new-invite-url').value=lastInviteUrl;byId('new-invite-result').hidden=false;
      try{await navigator.clipboard.writeText(lastInviteUrl);setMessage('Invitation link generated and copied. It expires in 7 days.');}
      catch{setMessage('Invitation link generated. Copy it below and share it with your player.');}
      await load();
    }catch(error){setMessage(error.message||'Could not generate an invitation.',true);}
    finally{button.disabled=false;}
  });
  byId('copy-invite-button').addEventListener('click',async()=>{
    if(!lastInviteUrl)return;
    try{await navigator.clipboard.writeText(lastInviteUrl);setMessage('Invitation link copied.');}
    catch{byId('new-invite-url').select();setMessage('Select and copy the invitation link.');}
  });
  byId('delete-team-button').addEventListener('click',async()=>{
    if(!teamId||!window.confirm('Delete this team permanently? All members will be released and their PUNIX accounts and tournament history will remain.'))return;
    const button=byId('delete-team-button');button.disabled=true;setMessage('Deleting team and releasing its members…');
    try{const {error}=await db.rpc('punix_delete_team',{p_team_id:teamId});if(error)throw error;teamId=null;byId('my-team-panel').hidden=true;byId('create-team-panel').hidden=false;setMessage('Team deleted. All former members are now free to create or join another team.');}
    catch(error){setMessage(error.message||'Could not delete the team.',true);button.disabled=false;}
  });
  load().catch(error=>{console.error('PUNIX team hub:',error);setMessage(error.message||'Could not load your team space.',true);});
})();