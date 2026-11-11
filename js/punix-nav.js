/* PUNIX shared navigation: session-aware account link and admin-only Team Management. */
document.addEventListener('DOMContentLoaded', () => {
  const header = document.querySelector('.pnx-site-header');
  if (!header) return;

  const toggle = header.querySelector('.pnx-menu-toggle');
  const nav = header.querySelector('.pnx-main-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    });
    nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
      nav.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    }));
  }

  const memberLink = header.querySelector('.pnx-nav-cta');
  const communityCta = document.querySelector('.pnx-community-cta');
  const communityCtaNote = document.querySelector('.pnx-community-cta-note');
  const discordInvite = 'https://discord.gg/P94NF5truS';
  const updateCommunityCta = signedIn => {
    if (!communityCta) return;
    communityCta.href = signedIn ? discordInvite : 'auth.html';
    communityCta.innerHTML = signedIn
      ? 'JOIN OUR DISCORD <span aria-hidden="true">↗</span>'
      : 'REGISTER <span aria-hidden="true">↗</span>';
    communityCta.setAttribute('aria-label', signedIn ? 'Join the PUNIX Discord community' : 'Register for a PUNIX member account');
    communityCta.target = signedIn ? '_blank' : '_self';
    communityCta.rel = signedIn ? 'noopener noreferrer' : '';
    if (communityCtaNote) communityCtaNote.textContent = signedIn
      ? 'You already have a PUNIX account. Continue the conversation on our Discord server.'
      : 'Create your PUNIX member account to get started.';
  };
  const adminLinks = header.querySelectorAll('[data-nav="admin"]');
  const showAdminLinks = show => adminLinks.forEach(link => {
    link.classList.toggle('pnx-admin-visible', Boolean(show));
    if (show) link.removeAttribute('aria-hidden');
    else link.setAttribute('aria-hidden', 'true');
  });

  // Keep registration hidden until Supabase confirms the visitor is signed out.
  updateCommunityCta(false);
  showAdminLinks(false);

  const config = window.PUNIX_SUPABASE_CONFIG;
  if (!window.supabase || !config?.url || !config?.publishableKey) {
    updateCommunityCta(false);
    return;
  }

  const client = window.PUNIX_SUPABASE_CLIENT || (window.PUNIX_SUPABASE_CLIENT = window.supabase.createClient(config.url, config.publishableKey));
  const renderMemberLink = signedIn => {
    if (!memberLink) return;
    memberLink.href = signedIn ? 'profile.html' : 'auth.html';
    memberLink.innerHTML = signedIn
      ? 'MY PROFILE <span aria-hidden="true">↗</span>'
      : 'LOG IN <span aria-hidden="true">↗</span>';
    memberLink.setAttribute('aria-label', signedIn ? 'Open my profile' : 'Member access');
  };

  // In-app member notifications. The database RLS policy limits every query to the signed-in member.
  let notificationUserId = null, notificationTimer = null;
  let notificationRoot = null, notificationList = null, notificationCount = null;
  const notificationEsc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function ensureNotificationCenter() {
    if (notificationRoot || !header.querySelector('.pnx-nav-actions')) return;
    const actions = header.querySelector('.pnx-nav-actions');
    notificationRoot = document.createElement('div');
    notificationRoot.className = 'pnx-notification-center';
    notificationRoot.innerHTML = '<button class="pnx-notification-toggle" type="button" aria-label="Notifications" aria-expanded="false"><span aria-hidden="true">♧</span><b class="pnx-notification-count" hidden>0</b></button><section class="pnx-notification-panel" hidden aria-label="Notifications"><div class="pnx-notification-heading"><strong>NOTIFICATIONS</strong><button type="button" class="pnx-notification-readall">MARK ALL READ</button></div><div class="pnx-notification-list"><p class="pnx-notification-empty">Sign in to see your notifications.</p></div></section>';
    actions.insertBefore(notificationRoot, actions.firstChild);
    notificationList = notificationRoot.querySelector('.pnx-notification-list');
    notificationCount = notificationRoot.querySelector('.pnx-notification-count');
    const toggle = notificationRoot.querySelector('.pnx-notification-toggle');
    const panel = notificationRoot.querySelector('.pnx-notification-panel');
    toggle.addEventListener('click', () => {
      const open = panel.hidden;
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      if (open) refreshNotifications();
    });
    notificationRoot.querySelector('.pnx-notification-readall').addEventListener('click', async () => {
      if (!notificationUserId) return;
      const { error } = await client.from('notifications').update({read_at:new Date().toISOString()}).eq('user_id', notificationUserId).is('read_at', null);
      if (error) { notificationList.innerHTML = '<p class="pnx-notification-empty">Could not update notifications. Please try again.</p>'; return; }
      refreshNotifications();
    });
    document.addEventListener('click', event => {
      if (!notificationRoot.contains(event.target)) {
        panel.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }
  async function refreshNotifications() {
    if (!notificationUserId || !notificationList) return;
    const [items, unread] = await Promise.all([
      client.from('notifications').select('id,title,body,link,created_at,read_at').eq('user_id', notificationUserId).order('created_at', {ascending:false}).limit(20),
      client.from('notifications').select('id', {count:'exact',head:true}).eq('user_id', notificationUserId).is('read_at', null)
    ]);
    if (items.error) { notificationList.innerHTML = '<p class="pnx-notification-empty">Notifications are temporarily unavailable.</p>'; return; }
    const total = unread.count || 0;
    notificationCount.textContent = total > 99 ? '99+' : String(total);
    notificationCount.hidden = total === 0;
    const rows = items.data || [];
    notificationList.innerHTML = rows.length ? rows.map(item => '<button type="button" class="pnx-notification-item '+(item.read_at?'':'is-unread')+'" data-notification-id="'+notificationEsc(item.id)+'" data-notification-link="'+notificationEsc(item.link||'')+'"><strong>'+notificationEsc(item.title)+'</strong><span>'+notificationEsc(item.body)+'</span><small>'+notificationEsc(new Date(item.created_at).toLocaleString())+'</small></button>').join('') : '<p class="pnx-notification-empty">You are all caught up. New PUNIX event announcements and team updates will appear here.</p>';
    notificationList.querySelectorAll('[data-notification-id]').forEach(button => button.addEventListener('click', async () => {
      const id = button.dataset.notificationId, link = button.dataset.notificationLink;
      await client.from('notifications').update({read_at:new Date().toISOString()}).eq('id',id).eq('user_id',notificationUserId);
      await refreshNotifications();
      if (link) { try { const target = new URL(link, window.location.origin); if (target.origin === window.location.origin) window.location.href = target.href; } catch (_) {} }
    }));
  }
  function setNotificationSession(session) {
    const nextId = session?.user?.id || null;
    if (nextId === notificationUserId) return;
    notificationUserId = nextId;
    if (notificationTimer) clearInterval(notificationTimer);
    ensureNotificationCenter();
    if (!notificationUserId) {
      notificationCount.hidden = true;
      notificationList.innerHTML = '<p class="pnx-notification-empty">Sign in to see your notifications.</p>';
      return;
    }
    refreshNotifications();
    notificationTimer = setInterval(refreshNotifications, 45000);
  }

  let roleCheckId = 0;
  const updateNavigation = async session => {
    window.PUNIX_AUTH_SESSION = session || null;
    setNotificationSession(session);
    const currentCheck = ++roleCheckId;
    const signedIn = Boolean(session?.user?.id);
    renderMemberLink(signedIn);
    updateCommunityCta(signedIn);
    showAdminLinks(false);
    if (!signedIn) return;

    try {
      const { data, error } = await client.from('user_roles')
        .select('role').eq('user_id', session.user.id).maybeSingle();
      if (currentCheck !== roleCheckId) return;
      showAdminLinks(!error && ['admin', 'super_admin'].includes(data?.role));
    } catch (_) {
      if (currentCheck === roleCheckId) showAdminLinks(false);
    }
  };

  client.auth.getSession().then(({ data, error }) => {
    updateNavigation(error ? null : data.session);
  }).catch(() => updateNavigation(null));

  client.auth.onAuthStateChange((_event, session) => updateNavigation(session));
});
