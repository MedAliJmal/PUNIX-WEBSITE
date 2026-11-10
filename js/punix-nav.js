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
  const guestRegisterLink = document.querySelector('.pnx-register-guest');
  const setGuestRegisterVisibility = visible => {
    if (!guestRegisterLink) return;
    guestRegisterLink.hidden = !visible;
    guestRegisterLink.setAttribute('aria-hidden', String(!visible));
  };
  const adminLinks = header.querySelectorAll('[data-nav="admin"]');
  const showAdminLinks = show => adminLinks.forEach(link => {
    link.classList.toggle('pnx-admin-visible', Boolean(show));
    if (show) link.removeAttribute('aria-hidden');
    else link.setAttribute('aria-hidden', 'true');
  });

  // Keep registration hidden until Supabase confirms the visitor is signed out.
  setGuestRegisterVisibility(false);
  showAdminLinks(false);

  const config = window.PUNIX_SUPABASE_CONFIG;
  if (!window.supabase || !config?.url || !config?.publishableKey) {
    setGuestRegisterVisibility(true);
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

  let roleCheckId = 0;
  const updateNavigation = async session => {
    window.PUNIX_AUTH_SESSION = session || null;
    const currentCheck = ++roleCheckId;
    const signedIn = Boolean(session?.user?.id);
    renderMemberLink(signedIn);
    setGuestRegisterVisibility(!signedIn);
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
