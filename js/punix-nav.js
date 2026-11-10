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
  const adminLinks = header.querySelectorAll('[data-nav="admin"]');
  const showAdminLinks = (show) => adminLinks.forEach(link => {
    link.classList.toggle('pnx-admin-visible', Boolean(show));
    if (show) link.removeAttribute('aria-hidden');
    else link.setAttribute('aria-hidden', 'true');
  });

  // Default to hidden. Only reveal after Supabase confirms an admin role.
  showAdminLinks(false);

  const config = window.PUNIX_SUPABASE_CONFIG;
  if (!window.supabase || !config?.url || !config?.publishableKey) return;

  const client = window.supabase.createClient(config.url, config.publishableKey);
  const renderMemberLink = (signedIn) => {
    if (!memberLink) return;
    memberLink.href = signedIn ? 'profile.html' : 'auth.html';
    memberLink.innerHTML = signedIn
      ? 'MY PROFILE <span aria-hidden="true">↗</span>'
      : 'LOG IN <span aria-hidden="true">↗</span>';
    memberLink.setAttribute('aria-label', signedIn ? 'Open my profile' : 'Member access');
  };

  let roleCheckId = 0;
  const updateNavigation = async (session) => {
    const currentCheck = ++roleCheckId;
    const signedIn = Boolean(session?.user?.id);
    renderMemberLink(signedIn);
    if (guestRegisterLink) guestRegisterLink.hidden = signedIn;
    showAdminLinks(false);
    if (!signedIn) return;

    try {
      const { data, error } = await client
        .from('user_roles')
        .select('role')
        .eq('user_id', session.user.id)
        .maybeSingle();
      if (currentCheck !== roleCheckId) return;
      const isAdmin = !error && ['admin', 'super_admin'].includes(data?.role);
      showAdminLinks(isAdmin);
    } catch (_) {
      // Fail closed: a failed role lookup must never expose the admin link.
      if (currentCheck === roleCheckId) showAdminLinks(false);
    }
  };

  client.auth.getSession().then(({ data, error }) => {
    if (!error) updateNavigation(data.session);
    else updateNavigation(null);
  }).catch(() => updateNavigation(null));

  client.auth.onAuthStateChange((_event, session) => {
    updateNavigation(session);
  });
});
