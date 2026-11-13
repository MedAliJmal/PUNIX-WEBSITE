(() => {
  const config = window.PUNIX_SUPABASE_CONFIG;
  if (!window.supabase || !config?.url || !config?.publishableKey || document.getElementById('pnx-support-root')) return;
  const db = window.supabase.createClient(config.url, config.publishableKey);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let activeUser = null;
  let supportSession = null;
  let poller = null;
  let notificationPoller = null;
  let busy = false;
  let root = null;

  function stopPolling() { if (poller) clearInterval(poller); poller = null; if (notificationPoller) clearInterval(notificationPoller); notificationPoller = null; }
  function removeWidget() {
    stopPolling();
    root?.remove();
    root = null;
    activeUser = null;
    supportSession = null;
  }
  function makeWidget(user) {
    removeWidget();
    activeUser = user;
    const storageKey = 'punix-support-session-v2:' + user.id;
    try { supportSession = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { supportSession = null; }
    if (!supportSession || supportSession.userId !== user.id) supportSession = null;

    root = document.createElement('div');
    root.id = 'pnx-support-root';
    root.innerHTML = `
      <style>.pnx-support-unread{display:none;position:absolute;top:-7px;right:-7px;min-width:19px;height:19px;padding:0 5px;border-radius:20px;background:#e34b4b;color:#fff;border:2px solid #080d10;font:800 10px/15px Inter,Arial,sans-serif;text-align:center;box-sizing:border-box;box-shadow:0 0 0 3px rgba(227,75,75,.15)}.pnx-support-unread.is-visible{display:block}.pnx-support-unread.is-dot{min-width:11px;width:11px;height:11px;padding:0;line-height:7px}</style>
      <button class="pnx-support-launcher" id="pnx-support-launcher" type="button" aria-expanded="false"><span class="pnx-support-icon">✉</span> LIVE SUPPORT <span class="pnx-support-unread" id="pnx-support-unread" aria-label="Unread support reply"></span></button>
      <section class="pnx-support-panel" id="pnx-support-panel" aria-label="PUNIX live support" hidden>
        <header class="pnx-support-head"><div><strong>PUNIX SUPPORT</strong><small>Account support · Replies appear here.</small></div><button class="pnx-support-close" id="pnx-support-close" type="button" aria-label="Close chat">×</button></header>
        <div class="pnx-support-body" id="pnx-support-body">
          <p class="pnx-support-intro">Welcome back. Send a message to the PUNIX support team.</p>
          <form class="pnx-support-form" id="pnx-support-start">
            <label>YOUR NAME<input name="name" maxlength="80" autocomplete="name" required placeholder="Name"></label>
            <label>ACCOUNT EMAIL<input name="email" type="email" maxlength="254" readonly></label>
            <label>HOW CAN WE HELP?<textarea name="message" maxlength="1000" required placeholder="Write your message…"></textarea></label>
            <button class="pnx-support-submit" type="submit">START CONVERSATION ↗</button>
          </form>
          <p class="pnx-support-note">Only your signed-in PUNIX account and the support team can access this conversation.</p>
          <p class="pnx-support-error" id="pnx-support-error" role="status"></p>
        </div>
      </section>`;
    document.body.appendChild(root);
    const launcher = root.querySelector('#pnx-support-launcher');
    const panel = root.querySelector('#pnx-support-panel');
    const body = root.querySelector('#pnx-support-body');
    const errorBox = root.querySelector('#pnx-support-error');
    const unreadBadge = root.querySelector('#pnx-support-unread');
    const seenKey = 'punix-support-last-admin-read-v1:' + user.id;
    function setUnread(count) { unreadBadge.textContent = count > 9 ? '9+' : String(count); unreadBadge.classList.toggle('is-visible', count > 0); launcher.setAttribute('aria-label', count ? `Live support, ${count} unread reply${count===1?'':'s'}` : 'Live support'); }
    function markAdminRead(messageId) { if (!messageId) return; try { localStorage.setItem(seenKey, messageId); } catch {} setUnread(0); }
    async function refreshUserNotification() {
      if (!supportSession?.id) {
        const { data, error } = await db.from('support_conversations').select('id').eq('user_id', user.id).eq('status', 'open').order('last_message_at', {ascending:false}).limit(1);
        if (error || !data?.length) { setUnread(0); return; }
        supportSession = {id:data[0].id,userId:user.id};
        try { localStorage.setItem(storageKey,JSON.stringify(supportSession)); } catch {}
      }
      const { data, error } = await db.rpc('punix_support_history',{p_conversation_id:supportSession.id});
      if (error || !Array.isArray(data)) return;
      const latestAdmin = [...data].reverse().find(message => message.sender_type === 'admin');
      let lastSeen = ''; try { lastSeen = localStorage.getItem(seenKey) || ''; } catch {}
      if (panel.hidden && latestAdmin?.id && latestAdmin.id !== lastSeen) setUnread(1);
      else if (!panel.hidden && latestAdmin?.id) markAdminRead(latestAdmin.id);
      else if (!latestAdmin) setUnread(0);
    }
    const form = root.querySelector('#pnx-support-start');
    form.elements.email.value = user.email || '';
    form.elements.name.value = String(user.user_metadata?.display_name || user.user_metadata?.full_name || user.user_metadata?.name || '').slice(0,80);

    function showError(message='') { errorBox.textContent = message; }
    function openChat() {
      panel.hidden = false;
      launcher.setAttribute('aria-expanded','true');
      if (supportSession?.id) renderThread();
      else loadExistingOrStart();
      refreshUserNotification();
    }
    function closeChat() { panel.hidden = true; launcher.setAttribute('aria-expanded','false'); }
    launcher.addEventListener('click', () => panel.hidden ? openChat() : closeChat());
    root.querySelector('#pnx-support-close').addEventListener('click', closeChat);

    function renderMessages(messages) {
      let thread = body.querySelector('.pnx-support-thread');
      if (!thread) {
        thread = document.createElement('div');
        thread.className = 'pnx-support-thread';
        const startForm = body.querySelector('#pnx-support-start');
        if (startForm) startForm.remove();
        const intro = body.querySelector('.pnx-support-intro');
        if (intro) intro.remove();
        body.insertBefore(thread, body.querySelector('.pnx-support-note'));
      }
      thread.innerHTML = messages.map(m => `<article class="pnx-support-message ${m.sender_type==='visitor'?'is-visitor':'is-admin'}">${safe(m.body)}<small>${m.sender_type==='visitor'?'YOU':'PUNIX SUPPORT'} · ${new Date(m.created_at).toLocaleString()}</small></article>`).join('') || '<p class="pnx-support-intro">Your conversation is ready. Send us a message whenever you need help.</p>';
      body.scrollTop = body.scrollHeight;
    }
    async function loadExistingOrStart() {
      if (supportSession?.id) { await renderThread(); return; }
      const { data, error } = await db.from('support_conversations').select('id,status').eq('user_id',user.id).eq('status','open').order('last_message_at',{ascending:false}).limit(1);
      if (error) { showError('Could not load your support history. Please try again.'); return; }
      if (data?.length) {
        supportSession = {id:data[0].id,userId:user.id};
        try { localStorage.setItem(storageKey,JSON.stringify(supportSession)); } catch {}
        await renderThread();
      } else {
        const startForm = body.querySelector('#pnx-support-start');
        if (startForm) startForm.hidden = false;
      }
    }
    let renderThreadPromise = null;
    async function renderThread() {
      if (renderThreadPromise) return renderThreadPromise;
      renderThreadPromise = (async () => {
        if (!supportSession?.id || supportSession.userId !== user.id) return;
        const {data,error} = await db.rpc('punix_support_history',{p_conversation_id:supportSession.id});
        if (error) {
          supportSession = null;
          try { localStorage.removeItem(storageKey); } catch {}
          showError('Your previous chat could not be loaded. Start a new conversation below.');
          const startForm = body.querySelector('#pnx-support-start');
          if (startForm) startForm.hidden = false;
          body.querySelectorAll('.pnx-support-compose').forEach(node => node.remove());
          return;
        }
        renderMessages(data || []);
        const latestAdmin = [...(data || [])].reverse().find(message => message.sender_type === 'admin');
        if (latestAdmin?.id) markAdminRead(latestAdmin.id);
        // Keep exactly one composer even if polling and user actions overlap.
        let composers = Array.from(panel.querySelectorAll('.pnx-support-compose'));
        let composer = composers.shift() || null;
        composers.forEach(node => node.remove());
        if (!composer) {
          composer = document.createElement('form');
          composer.className='pnx-support-compose';
          composer.innerHTML='<textarea name="message" maxlength="1000" required aria-label="Your message" placeholder="Type a message…"></textarea><button type="submit" aria-label="Send message">➤</button>';
          panel.appendChild(composer);
          composer.addEventListener('submit',sendMessage);
        }
        const {data:conv} = await db.from('support_conversations').select('status').eq('id',supportSession.id).maybeSingle();
        composer.hidden = conv?.status === 'closed';
        showError('');
        if (!poller) poller=setInterval(()=>{if(!panel.hidden) renderThread();},5000);
      })().finally(() => { renderThreadPromise = null; });
      return renderThreadPromise;
    }
    async function sendMessage(event) {
      event.preventDefault();
      const composer=event.currentTarget, input=composer.elements.message, message=input.value.trim();
      if(!message || busy) return;
      busy=true; composer.querySelector('button').disabled=true;
      const {error}=await db.rpc('punix_support_send',{p_conversation_id:supportSession.id,p_body:message});
      busy=false; composer.querySelector('button').disabled=false;
      if(error){showError(error.message||'Message could not be sent.');return;}
      input.value=''; await renderThread();
    }
    notificationPoller = setInterval(refreshUserNotification, 5000);
    refreshUserNotification();
    form.addEventListener('submit',async event=>{
      event.preventDefault(); if(busy)return;
      const data=new FormData(form);
      busy=true; const button=form.querySelector('button'); button.disabled=true; button.textContent='CONNECTING…';
      const {data:id,error}=await db.rpc('punix_support_start',{
        p_name:String(data.get('name')||'').trim(),
        p_email:user.email || '',
        p_body:String(data.get('message')||'').trim()
      });
      busy=false; button.disabled=false; button.textContent='START CONVERSATION ↗';
      if(error){showError(error.message||'Could not start support chat.');return;}
      supportSession={id,userId:user.id};
      try{localStorage.setItem(storageKey,JSON.stringify(supportSession));}catch{}
      showError(''); await renderThread();
    });
  }

  async function syncAuth() {
    const {data,error} = await db.auth.getSession();
    if (error || !data.session?.user) { removeWidget(); return; }
    const user=data.session.user;
    if (activeUser?.id !== user.id) makeWidget(user);
  }
  db.auth.onAuthStateChange((event,session) => {
    if (!session?.user) removeWidget();
    else if (activeUser?.id !== session.user.id) makeWidget(session.user);
  });
  syncAuth();
})();