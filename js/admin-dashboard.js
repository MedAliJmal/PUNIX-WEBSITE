(() => {
  const $ = (id) => document.getElementById(id);
  const gate = $('dashboard-gate');
  const app = $('admin-app');
  const config = window.PUNIX_SUPABASE_CONFIG;
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  if (!window.supabase || !config?.url || !config?.publishableKey) {
    gate.textContent = 'SUPABASE IS NOT CONFIGURED. Check your existing js/supabase-config.js file.';
    return;
  }

  const db = window.supabase.createClient(config.url, config.publishableKey);
  let currentSection = 'overview';

  function showGate(message, isError = false) {
    gate.textContent = message;
    gate.classList.toggle('is-error', isError);
    gate.hidden = false;
    app.hidden = true;
  }

  function openSection(name) {
    currentSection = ['teams', 'updates'].includes(name) ? name : 'overview';
    $('overview-section').hidden = currentSection !== 'overview';
    $('teams-section').hidden = currentSection !== 'teams';
    $('updates-section').hidden = currentSection !== 'updates';
    document.querySelectorAll('.pnx-admin-nav-item').forEach((button) => {
      const active = button.dataset.section === currentSection;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    if (currentSection === 'teams') history.replaceState(null, '', '#teams');
    else if (currentSection === 'updates') history.replaceState(null, '', '#updates');
    else history.replaceState(null, '', '#overview');
    if (currentSection === 'updates') loadUpdates();
  }

  async function countRows(table, filters = []) {
    let query = db.from(table).select('id', { count: 'exact', head: true });
    filters.forEach(([column, value]) => { query = query.eq(column, value); });
    const { count, error } = await query;
    if (error) return null;
    return count ?? 0;
  }

  async function loadStats() {
    const ids = ['stat-members', 'stat-teams', 'stat-active-teams', 'stat-roster'];
    ids.forEach((id) => { $(id).textContent = '…'; });
    const [members, teams, activeTeams, roster] = await Promise.all([
      countRows('profiles'),
      countRows('teams'),
      countRows('teams', [['status', 'active']]),
      countRows('team_members')
    ]);
    $('stat-members').textContent = members === null ? '—' : members.toLocaleString();
    $('stat-teams').textContent = teams === null ? '—' : teams.toLocaleString();
    $('stat-active-teams').textContent = activeTeams === null ? '—' : activeTeams.toLocaleString();
    $('stat-roster').textContent = roster === null ? '—' : roster.toLocaleString();
    await loadRecentTeams();
  }

  async function loadRecentTeams() {
    const target = $('recent-teams');
    const { data, error } = await db.from('teams').select('id,team_name,game_name,division,status').order('created_at', { ascending: false }).limit(5);
    if (error) {
      target.innerHTML = '<p class="pnx-recent-empty">Team data is unavailable. Open Team Management to review the database response.</p>';
      return;
    }
    if (!data?.length) {
      target.innerHTML = '<p class="pnx-recent-empty">No teams have been created yet. Create your first team from Team Management.</p>';
      return;
    }
    target.innerHTML = data.map((team) => `<article class="pnx-recent-row"><div><strong>${escapeHtml(team.team_name)}</strong><small>${escapeHtml(team.game_name)} · ${escapeHtml(String(team.division || '').toUpperCase())}</small></div><span class="pnx-recent-status">${escapeHtml(String(team.status || '').toUpperCase())}</span></article>`).join('');
  }

  const updateFields = ['update-id','update-title','update-category','update-summary','update-date','update-order','update-image','update-link','update-link-label','update-published'];
  function clearUpdateForm() {
    $('update-form').reset();
    $('update-id').value = '';
    $('update-order').value = '0';
    $('update-published').checked = true;
    $('update-date').value = new Date().toISOString().slice(0,10);
    $('update-editor-title').textContent = 'ADD AN UPDATE';
    $('save-update-btn').innerHTML = 'PUBLISH UPDATE <span>↗</span>';
    $('update-form-message').textContent = '';
  }
  function safeContentUrl(value, allowLocal = true) {
    const v = String(value || '').trim();
    if (!v) return '';
    if (allowLocal && (/^(assets\/|\.\/|\.\.\/|\/)/.test(v) || v.startsWith('#'))) return v;
    try { const u = new URL(v); return u.protocol === 'https:' ? v : ''; } catch { return ''; }
  }
  async function loadUpdates() {
    const target = $('admin-updates-list');
    target.innerHTML = '<p class="pnx-recent-empty">Loading updates…</p>';
    const { data, error } = await db.from('latest_updates').select('*').order('display_order',{ascending:true}).order('published_at',{ascending:false});
    if (error) { target.innerHTML = '<p class="pnx-recent-empty">Could not load updates. Make sure the Latest Updates SQL migration has been run.</p>'; return; }
    if (!data?.length) { target.innerHTML = '<p class="pnx-recent-empty">No updates yet. Add your first homepage update using the editor.</p>'; return; }
    target.innerHTML = data.map(item => `<article class="pnx-admin-update-row"><div class="pnx-admin-update-top"><div><strong>${escapeHtml(item.title)}</strong><br><small>${escapeHtml(String(item.category||'').toUpperCase())} · ${escapeHtml(item.published_at||'')}</small></div><span class="pnx-update-status ${item.is_published?'':'is-draft'}">${item.is_published?'PUBLISHED':'DRAFT'}</span></div><p>${escapeHtml(item.summary)}</p><div class="pnx-update-actions"><button type="button" data-edit-update="${escapeHtml(item.id)}">EDIT</button><button type="button" data-toggle-update="${escapeHtml(item.id)}">${item.is_published?'UNPUBLISH':'PUBLISH'}</button><button type="button" class="delete" data-delete-update="${escapeHtml(item.id)}">DELETE</button></div></article>`).join('');
    target.querySelectorAll('[data-edit-update]').forEach(btn => btn.addEventListener('click', () => {
      const item = data.find(x => x.id === btn.dataset.editUpdate); if (!item) return;
      $('update-id').value=item.id; $('update-title').value=item.title||''; $('update-category').value=item.category||''; $('update-summary').value=item.summary||''; $('update-date').value=item.published_at||new Date().toISOString().slice(0,10); $('update-order').value=item.display_order??0; $('update-image').value=item.image_url||''; $('update-link').value=item.link_url||''; $('update-link-label').value=item.link_label||''; $('update-published').checked=Boolean(item.is_published); $('update-editor-title').textContent='EDIT UPDATE'; $('save-update-btn').innerHTML='SAVE CHANGES <span>↗</span>'; $('update-form-message').textContent='Editing selected update.'; $('update-form').scrollIntoView({behavior:'smooth',block:'start'});
    }));
    target.querySelectorAll('[data-toggle-update]').forEach(btn => btn.addEventListener('click', async () => {
      const item=data.find(x=>x.id===btn.dataset.toggleUpdate); if(!item)return;
      const {error}=await db.from('latest_updates').update({is_published:!item.is_published}).eq('id',item.id);
      if(error) alert('Could not change publish status: '+error.message); else loadUpdates();
    }));
    target.querySelectorAll('[data-delete-update]').forEach(btn => btn.addEventListener('click', async () => {
      const item=data.find(x=>x.id===btn.dataset.deleteUpdate); if(!item||!confirm(`Delete “${item.title}”?`))return;
      const {error}=await db.from('latest_updates').delete().eq('id',item.id);
      if(error) alert('Could not delete update: '+error.message); else { if($('update-id').value===item.id)clearUpdateForm(); loadUpdates(); }
    }));
  }
  async function saveUpdate(event) {
    event.preventDefault();
    const id=$('update-id').value;
    const image=safeContentUrl($('update-image').value);
    const link=safeContentUrl($('update-link').value);
    if ($('update-image').value.trim() && !image) { $('update-form-message').textContent='Image must be an HTTPS URL or a local assets path.'; return; }
    if ($('update-link').value.trim() && !link) { $('update-form-message').textContent='Button link must be HTTPS or a local page/anchor.'; return; }
    const payload={title:$('update-title').value.trim(),category:$('update-category').value.trim(),summary:$('update-summary').value.trim(),published_at:$('update-date').value,display_order:Number($('update-order').value||0),image_url:image,link_url:link,link_label:$('update-link-label').value.trim(),is_published:$('update-published').checked};
    $('save-update-btn').disabled=true; $('update-form-message').textContent='Saving…';
    const result=id?await db.from('latest_updates').update(payload).eq('id',id):await db.from('latest_updates').insert(payload);
    $('save-update-btn').disabled=false;
    if(result.error){$('update-form-message').textContent='Save failed: '+result.error.message;return;}
    clearUpdateForm(); $('update-form-message').textContent='Update saved successfully.'; loadUpdates();
  }

  async function boot() {
    try {
      const { data: { session }, error: sessionError } = await db.auth.getSession();
      if (sessionError || !session?.user?.id) {
        showGate('ACCESS RESTRICTED — Sign in with a PUNIX administrator account to continue.', true);
        return;
      }
      const { data: role, error: roleError } = await db.from('user_roles').select('role').eq('user_id', session.user.id).maybeSingle();
      if (roleError || !['admin', 'super_admin'].includes(role?.role)) {
        showGate('ACCESS DENIED — This control dashboard is available only to PUNIX admins.', true);
        return;
      }
      gate.hidden = true;
      app.hidden = false;
      document.querySelectorAll('[data-section]').forEach((button) => button.addEventListener('click', () => openSection(button.dataset.section)));
      document.querySelectorAll('[data-open-section="teams"]').forEach((button) => button.addEventListener('click', () => openSection('teams')));
      $('update-form').addEventListener('submit', saveUpdate);
      $('cancel-update-btn').addEventListener('click', clearUpdateForm);
      $('refresh-updates').addEventListener('click', loadUpdates);
      clearUpdateForm();
      $('refresh-stats').addEventListener('click', loadStats);
      const initial = location.hash === '#teams' ? 'teams' : location.hash === '#updates' ? 'updates' : 'overview';
      openSection(initial);
      await loadStats();
    } catch (error) {
      showGate('Could not verify administrator access. Refresh the page or sign in again.', true);
    }
  }

  db.auth.onAuthStateChange((_event, session) => {
    if (!session) showGate('SESSION ENDED — Sign in with a PUNIX administrator account to continue.', true);
  });
  boot();
})();
