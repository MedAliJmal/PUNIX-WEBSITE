(() => {
 const cfg=window.PUNIX_SUPABASE_CONFIG, status=document.getElementById('invite-status'), details=document.getElementById('invite-details');
 const token=new URLSearchParams(location.search).get('token');
 const setStatus=(text,error=false)=>{status.textContent=text;status.classList.toggle('error',error);};
 if(!token||!/^[0-9a-f-]{36}$/i.test(token)){setStatus('This invitation link is invalid.',true);return;}
 if(!window.supabase||!cfg?.url||!cfg?.publishableKey){setStatus('PUNIX connection is not configured.',true);return;}
 const db=window.supabase.createClient(cfg.url,cfg.publishableKey);
 const redirect='team-invite.html?token='+encodeURIComponent(token);
 async function init(){
   const {data,error}=await db.rpc('punix_get_team_invitation',{p_token:token});
   if(error)throw error;
   const invitation=data?.[0];
   if(!invitation){setStatus('This invitation has expired, been revoked or already been used. Ask the captain for a new link.',true);return;}
   document.getElementById('invite-team-name').textContent=invitation.team_name;
   document.getElementById('invite-game').textContent=invitation.game_name;
   document.getElementById('invite-captain').textContent='Invited by '+invitation.captain_name+'. This invitation expires '+new Date(invitation.expires_at).toLocaleString()+'.';
   details.hidden=false;
   const {data:{session},error:sessionError}=await db.auth.getSession();if(sessionError)throw sessionError;
   if(!session){
     const link=document.getElementById('sign-in-invite');link.href='auth.html?redirect='+encodeURIComponent(redirect);link.hidden=false;
     setStatus('Create a PUNIX account or sign in to accept this invitation.');
   }else{
     document.getElementById('accept-invite-button').hidden=false;
     setStatus('You are signed in as '+session.user.email+'. Accept to join this roster.');
   }
 }
 document.getElementById('accept-invite-button').addEventListener('click',async()=>{
   const button=document.getElementById('accept-invite-button');button.disabled=true;setStatus('Accepting invitation…');
   const {error}=await db.rpc('punix_accept_team_invitation',{p_token:token});
   if(error){setStatus(error.message||'Could not accept invitation.',true);button.disabled=false;return;}
   setStatus('Welcome to the team. Redirecting to your team dashboard…');
   location.assign('my-team.html');
 });
 init().catch(error=>{console.error('PUNIX team invitation:',error);setStatus(error.message||'Could not load this invitation.',true);});
})();