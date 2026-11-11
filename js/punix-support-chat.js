(() => {
  const config = window.PUNIX_SUPABASE_CONFIG;
  if (!window.supabase || !config?.url || !config?.publishableKey || document.getElementById('pnx-support-launcher')) return;
  const db = window.supabase.createClient(config.url, config.publishableKey);
  const storageKey = 'punix-support-session-v1';
  const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const root = document.createElement('div');
  root.innerHTML = `
    <button class="pnx-support-launcher" id="pnx-support-launcher" type="button" aria-expanded="false"><span class="pnx-support-icon">✉</span> LIVE SUPPORT</button>
    <section class="pnx-support-panel" id="pnx-support-panel" aria-label="PUNIX live support" hidden>
      <header class="pnx-support-head"><div><strong>PUNIX SUPPORT</strong><small>Send us a message — our team will reply here.</small></div><button class="pnx-support-close" id="pnx-support-close" type="button" aria-label="Close chat">×</button></header>
      <div class="pnx-support-body" id="pnx-support-body">
        <p class="pnx-support-intro">Welcome to PUNIX. Tell us how we can help and a team member will get back to you.</p>
        <form class="pnx-support-form" id="pnx-support-start">
          <label>YOUR NAME<input name="name" maxlength="80" autocomplete="name" required placeholder="Name"></label>
          <label>EMAIL <span style="font-weight:400;letter-spacing:0">(optional — for follow-up)</span><input name="email" type="email" maxlength="254" autocomplete="email" placeholder="you@example.com"></label>
          <label>HOW CAN WE HELP?<textarea name="message" maxlength="2000" required placeholder="Write your message…"></textarea></label>
          <button class="pnx-support-submit" type="submit">START CONVERSATION ↗</button>
        </form>
        <p class="pnx-support-note">Your chat is private to you and the PUNIX support team. Save this browser to return to the conversation.</p>
        <p class="pnx-support-error" id="pnx-support-error" role="status"></p>
      </div>
    </section>`;
  document.body.appendChild(root);
  const launcher = root.querySelector('#pnx-support-launcher');
  const panel = root.querySelector('#pnx-support-panel');
  const body = root.querySelector('#pnx-support-body');
  const errorBox = root.querySelector('#pnx-support-error');
  let session = null;
  let poller = null;
  let busy = false;
  try { session = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { session = null; }

  function showError(message='') { errorBox.textContent = message; }
  function openChat() { panel.hidden = false; launcher.setAttribute('aria-expanded','true'); if(session?.id && session?.token) renderThread(); }
  function closeChat() { panel.hidden = true; launcher.setAttribute('aria-expanded','false'); }
  launcher.addEventListener('click', () => panel.hidden ? openChat() : closeChat());
  root.querySelector('#pnx-support-close').addEventListener('click', closeChat);

  function renderMessages(messages) {
    const old = body.querySelector('.pnx-support-thread');
    const thread = document.createElement('div');
    thread.className = 'pnx-support-thread';
    thread.innerHTML = messages.map(m => `<article class="pnx-support-message ${m.sender_type==='visitor'?'is-visitor':'is-admin'}">${safe(m.body)}<small>${m.sender_type==='visitor'?'YOU':'PUNIX SUPPORT'} · ${new Date(m.created_at).toLocaleString()}</small></article>`).join('') || '<p class="pnx-support-intro">Your conversation is ready. Send us a message whenever you need help.</p>';
    if(old) old.replaceWith(thread); else {
      const form = body.querySelector('#pnx-support-start');
      if(form) form.remove();
      const intro = body.querySelector('.pnx-support-intro'); if(intro) intro.remove();
      body.insertBefore(thread, body.querySelector('.pnx-support-note'));
    }
    body.scrollTop = body.scrollHeight;
  }
  async function renderThread() {
    if(!session?.id || !session?.token) return;
    const {data,error} = await db.rpc('punix_support_history',{p_conversation_id:session.id,p_access_token:session.token});
    if(error) { showError('Could not load this conversation. Please refresh or start a new chat.'); return; }
    renderMessages(data || []);
    let composer = body.querySelector('.pnx-support-compose');
    if(!composer) {
      composer = document.createElement('form');
      composer.className='pnx-support-compose';
      composer.innerHTML='<textarea name="message" maxlength="2000" required aria-label="Your message" placeholder="Type a message…"></textarea><button type="submit" aria-label="Send message">➤</button>';
      panel.appendChild(composer);
      composer.addEventListener('submit',sendMessage);
    }
    showError('');
    if(!poller) poller=setInterval(renderThread,5000);
  }
  async function sendMessage(event) {
    event.preventDefault();
    const form=event.currentTarget, input=form.elements.message, message=input.value.trim();
    if(!message || busy) return;
    busy=true; form.querySelector('button').disabled=true;
    const {error}=await db.rpc('punix_support_send',{p_conversation_id:session.id,p_access_token:session.token,p_body:message});
    busy=false; form.querySelector('button').disabled=false;
    if(error){showError(error.message||'Message could not be sent.');return;}
    input.value=''; await renderThread();
  }
  root.querySelector('#pnx-support-start').addEventListener('submit',async event=>{
    event.preventDefault(); if(busy)return;
    const form=event.currentTarget, data=new FormData(form);
    const bytes=new Uint8Array(32); crypto.getRandomValues(bytes);
    const token=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    busy=true; const button=form.querySelector('button'); button.disabled=true; button.textContent='CONNECTING…';
    const {data:id,error}=await db.rpc('punix_support_start',{p_name:String(data.get('name')||'').trim(),p_email:String(data.get('email')||'').trim(),p_body:String(data.get('message')||'').trim(),p_access_token:token});
    busy=false; button.disabled=false; button.textContent='START CONVERSATION ↗';
    if(error){showError(error.message||'Could not start support chat.');return;}
    session={id,token}; try{localStorage.setItem(storageKey,JSON.stringify(session));}catch{}
    showError(''); await renderThread();
  });
  if(session?.id && session?.token) { launcher.setAttribute('aria-label','Open your PUNIX support conversation'); }
})();