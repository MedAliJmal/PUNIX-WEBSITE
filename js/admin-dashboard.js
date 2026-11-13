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
    currentSection = ['members', 'teams', 'updates', 'tournaments', 'sponsors', 'support'].includes(name) ? name : 'overview';
    $('overview-section').hidden = currentSection !== 'overview';
    $('members-section').hidden = currentSection !== 'members';
    $('teams-section').hidden = currentSection !== 'teams';
    $('updates-section').hidden = currentSection !== 'updates';
    $('tournaments-section').hidden = currentSection !== 'tournaments';
    $('sponsors-section').hidden = currentSection !== 'sponsors';
    $('support-section').hidden = currentSection !== 'support';
    document.querySelectorAll('.pnx-admin-nav-item').forEach((button) => {
      const active = button.dataset.section === currentSection;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    if (currentSection === 'members') history.replaceState(null, '', '#members');
    else if (currentSection === 'teams') history.replaceState(null, '', '#teams');
    else if (currentSection === 'updates') history.replaceState(null, '', '#updates');
    else if (currentSection === 'tournaments') history.replaceState(null, '', '#tournaments');
    else if (currentSection === 'sponsors') history.replaceState(null, '', '#sponsors');
    else if (currentSection === 'support') history.replaceState(null, '', '#support');
    else history.replaceState(null, '', '#overview');
    if (currentSection === 'members') loadMembers();
    if (currentSection === 'updates') loadUpdates();
    if (currentSection === 'tournaments') window.loadPunixTournamentsAdmin?.();
    if (currentSection === 'sponsors') loadSponsors();
    if (currentSection === 'support') loadSupportConversations();
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

  let cachedAccounts = [];
  let activeMembershipFilter = 'all';

  function renderMemberAccounts() {
    const target = $('admin-member-list');
    const search = ($('member-account-search')?.value || '').trim().toLowerCase();
    const profileAccounts = cachedAccounts.filter(member => member.has_profile);
    const counts = {
      all: cachedAccounts.length,
      pending: profileAccounts.filter(member => (member.membership_status || 'pending') === 'pending').length,
      approved: profileAccounts.filter(member => member.membership_status === 'approved').length,
      rejected: profileAccounts.filter(member => member.membership_status === 'rejected').length
    };
    document.querySelectorAll('[data-membership-filter]').forEach(button => {
      const filter = button.dataset.membershipFilter;
      button.setAttribute('aria-pressed', String(filter === activeMembershipFilter));
      const count = button.querySelector('[data-filter-count]');
      if (count) count.textContent = counts[filter] ?? 0;
    });
    const members = cachedAccounts.filter(member => {
      const status = member.has_profile ? (member.membership_status || 'pending') : 'no_profile';
      const matchesStatus = activeMembershipFilter === 'all' || status === activeMembershipFilter;
      const matchesSearch = [
        member.display_name, member.email, member.user_id, member.bio,
        member.membership_status, member.directory_division
      ].some(value => String(value || '').toLowerCase().includes(search));
      return matchesStatus && matchesSearch;
    });
    $('member-search-count').textContent = `SHOWING ${members.length} OF ${cachedAccounts.length} ACCOUNTS`;
    if (!members.length) {
      const emptyMessage = activeMembershipFilter === 'pending'
        ? 'No pending applications right now.'
        : activeMembershipFilter === 'all'
          ? 'No accounts match your search.'
          : `No ${activeMembershipFilter} accounts match your search.`;
      target.innerHTML = `<p class="pnx-recent-empty">${emptyMessage}</p>`;
      return;
    }
    target.innerHTML = members.map(member => {
      const status = member.membership_status || 'pending';
      const division = ['community', 'creators', 'competitive', 'management'].includes(member.directory_division) ? member.directory_division : 'community';
      const date = member.account_created_at ? new Date(member.account_created_at).toLocaleDateString() : '—';
      const lastSeen = member.last_sign_in_at ? new Date(member.last_sign_in_at).toLocaleString() : 'Never signed in';
      let avatarUrl = '';
      try {
        const parsedAvatar = new URL(member.avatar_url || '');
        if (parsedAvatar.protocol === 'https:') avatarUrl = parsedAvatar.href;
      } catch { /* Invalid or missing avatar URL: show placeholder. */ }
      const avatarPreview = member.has_profile ? (avatarUrl
        ? `<div class="pnx-admin-avatar-review"><img data-avatar-preview src="${escapeHtml(avatarUrl)}" alt="Applicant profile image" loading="lazy" referrerpolicy="no-referrer"><a href="${escapeHtml(avatarUrl)}" target="_blank" rel="noopener noreferrer">OPEN FULL IMAGE ↗</a></div>`
        : '<div class="pnx-admin-avatar-review is-empty"><span>NO PROFILE IMAGE</span></div>') : '';
      const actions = member.has_profile ? `
        <label>ASSIGN DIVISION
          <select data-member-division>
            <option value="community" ${division === 'community' ? 'selected' : ''}>Community Member</option>
            <option value="creators" ${division === 'creators' ? 'selected' : ''}>Streamer</option>
            <option value="competitive" ${division === 'competitive' ? 'selected' : ''}>Competitive Player</option>
            <option value="management" ${division === 'management' ? 'selected' : ''}>Management</option>
          </select>
        </label>
        <div class="pnx-update-actions">
          <button type="button" data-member-action="approved">${status === 'approved' ? 'SAVE DIVISION' : 'APPROVE'}</button>
          <button type="button" data-member-action="rejected" class="delete">REJECT</button>
          ${status !== 'pending' ? '<button type="button" data-member-action="pending">RETURN TO PENDING</button>' : ''}
        </div>` : '<p class="pnx-account-no-profile">No PUNIX profile is linked to this auth account.</p>';
      return `<article class="pnx-admin-member-card" data-member-id="${escapeHtml(member.user_id)}">
        ${avatarPreview}
        <div class="pnx-admin-member-info">
          <span class="pnx-admin-member-status status-${escapeHtml(status)}">${escapeHtml(status.replace('_',' ').toUpperCase())}</span>
          <h3>${escapeHtml(member.display_name || 'PUNIX Member')}</h3>
          <p class="pnx-account-email">${escapeHtml(member.email || 'No email address')}</p>
          <p>${escapeHtml(member.bio || 'No bio provided.')}</p>
          <small>ACCOUNT CREATED ${escapeHtml(date)} · LAST SIGN-IN ${escapeHtml(lastSeen)}</small>
          <small class="pnx-account-id">ID: ${escapeHtml(member.user_id)}</small>
        </div>
        <div class="pnx-admin-member-actions">${actions}</div>
      </article>`;
    }).join('');

    target.querySelectorAll('[data-avatar-preview]').forEach(image => image.addEventListener('error', () => {
      image.closest('.pnx-admin-avatar-review')?.classList.add('is-broken');
      image.remove();
    }, { once: true }));

    target.querySelectorAll('[data-member-action]').forEach(button => button.addEventListener('click', async () => {
      const card = button.closest('[data-member-id]');
      const userId = card?.dataset.memberId;
      const status = button.dataset.memberAction;
      const division = card?.querySelector('[data-member-division]')?.value || 'community';
      if (!userId) return;
      if (status === 'rejected' && !confirm('Reject this PUNIX membership request?')) return;
      button.disabled = true;
      $('member-review-message').textContent = 'Saving membership decision…';
      const { error: reviewError } = await db.rpc('admin_review_member', {
        p_user_id: userId,
        p_status: status,
        p_division: status === 'approved' ? division : null
      });
      if (reviewError) {
        $('member-review-message').textContent = 'Could not update membership: ' + reviewError.message;
        button.disabled = false;
        return;
      }
      $('member-review-message').textContent = 'Membership updated successfully.';
      await loadMembers();
    }));
  }

  async function loadMembers() {
    const target = $('admin-member-list');
    const message = $('member-review-message');
    target.innerHTML = '<p class="pnx-recent-empty">Loading all registered accounts…</p>';
    message.textContent = 'Retrieving account directory…';
    const { data, error } = await db.rpc('admin_list_accounts');
    if (error) {
      target.innerHTML = '<p class="pnx-recent-empty">Could not load accounts. Apply the latest member-approval SQL migration, including the admin account-list function.</p>';
      message.textContent = 'Account directory unavailable: ' + error.message;
      $('member-search-count').textContent = '—';
      return;
    }
    cachedAccounts = data || [];
    const counts = {
      pending: cachedAccounts.filter(m => m.membership_status === 'pending').length,
      approved: cachedAccounts.filter(m => m.membership_status === 'approved').length,
      rejected: cachedAccounts.filter(m => m.membership_status === 'rejected').length
    };
    message.textContent = `${cachedAccounts.length} accounts · ${counts.pending} pending · ${counts.approved} approved · ${counts.rejected} rejected`;
    renderMemberAccounts();
  }

  const updateImageFile = $('update-image-file');
  const updateImagePreview = $('update-image-preview');
  const updateImagePreviewImg = $('update-image-preview-img');
  let updateImageObjectUrl = '';
  function showUpdateImagePreview(url, fileName = '') {
    if (updateImageObjectUrl && updateImageObjectUrl !== url) URL.revokeObjectURL(updateImageObjectUrl);
    updateImageObjectUrl = String(url || '').startsWith('blob:') ? url : '';
    updateImagePreview.hidden = !url;
    if (url) updateImagePreviewImg.src = url;
    else updateImagePreviewImg.removeAttribute('src');
    $('update-image-file-name').textContent = fileName || (url ? 'Current image preview.' : 'No local image selected.');
  }
  updateImageFile.addEventListener('change', () => {
    const file = updateImageFile.files?.[0];
    if (!file) { showUpdateImagePreview($('update-image').value.trim()); return; }
    if (!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)) {
      updateImageFile.value = '';
      showUpdateImagePreview($('update-image').value.trim());
      $('update-form-message').textContent = 'Choose a PNG, JPG, WEBP or GIF image.';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      updateImageFile.value = '';
      showUpdateImagePreview($('update-image').value.trim());
      $('update-form-message').textContent = 'Update image must be 5 MB or smaller.';
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    showUpdateImagePreview(previewUrl, file.name);
  });
  $('update-image').addEventListener('input', () => {
    if (!updateImageFile.files?.length) showUpdateImagePreview($('update-image').value.trim());
  });
  $('remove-update-image').addEventListener('click', () => {
    updateImageFile.value = '';
    $('update-image').value = '';
    showUpdateImagePreview('');
    $('update-form-message').textContent = 'Image removed. Save the update to apply the change.';
  });
  async function uploadUpdateImage() {
    const file = updateImageFile.files?.[0];
    if (!file) return safeContentUrl($('update-image').value);
    const ext = ({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'})[file.type];
    const path = `latest-updates/${Date.now()}-${Math.random().toString(36).slice(2,9)}.${ext}`;
    const { error } = await db.storage.from('latest-update-images').upload(path, file, { contentType:file.type, cacheControl:'3600', upsert:false });
    if (error) throw error;
    const { data } = db.storage.from('latest-update-images').getPublicUrl(path);
    return data.publicUrl;
  }
  const updateFields = ['update-id','update-title','update-category','update-summary','update-date','update-order','update-image','update-link','update-link-label','update-published'];
  function clearUpdateForm() {
    $('update-form').reset();
    $('update-id').value = '';
    $('update-order').value = '0';
    $('update-published').checked = true;
    updateImageFile.value = '';
    $('update-image').value = '';
    showUpdateImagePreview('');
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
      $('update-id').value=item.id; $('update-title').value=item.title||''; $('update-category').value=item.category||''; $('update-summary').value=item.summary||''; $('update-date').value=item.published_at||new Date().toISOString().slice(0,10); $('update-order').value=item.display_order??0; $('update-image').value=item.image_url||''; updateImageFile.value=''; showUpdateImagePreview(item.image_url||''); $('update-link').value=item.link_url||''; $('update-link-label').value=item.link_label||''; $('update-published').checked=Boolean(item.is_published); $('update-editor-title').textContent='EDIT UPDATE'; $('save-update-btn').innerHTML='SAVE CHANGES <span>↗</span>'; $('update-form-message').textContent='Editing selected update.'; $('update-form').scrollIntoView({behavior:'smooth',block:'start'});
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
    const link=safeContentUrl($('update-link').value);
    if ($('update-link').value.trim() && !link) { $('update-form-message').textContent='Button link must be HTTPS or a local page/anchor.'; return; }
    $('save-update-btn').disabled=true; $('update-form-message').textContent='Uploading image and saving…';
    try {
      const image = await uploadUpdateImage();
      if ($('update-image').value.trim() && !image) throw new Error('Image must be an HTTPS URL or a local assets path.');
      const payload={title:$('update-title').value.trim(),category:$('update-category').value.trim(),summary:$('update-summary').value.trim(),published_at:$('update-date').value,display_order:Number($('update-order').value||0),image_url:image,link_url:link,link_label:$('update-link-label').value.trim(),is_published:$('update-published').checked};
      const result=id?await db.from('latest_updates').update(payload).eq('id',id):await db.from('latest_updates').insert(payload);
      if(result.error) throw result.error;
      clearUpdateForm(); $('update-form-message').textContent='Update saved successfully.'; loadUpdates();
    } catch(error) {
      $('update-form-message').textContent='Save failed: '+(error.message||'Unknown error');
    } finally { $('save-update-btn').disabled=false; }
  }


  // Sponsor management — logo uploads are stored in the public sponsor-logos bucket.
  const sponsorLogoFile = $('sponsor-logo-file');
  let sponsorLogoObjectUrl = '';
  function showSponsorLogoPreview(url, fileName = '') {
    if (sponsorLogoObjectUrl && sponsorLogoObjectUrl !== url) URL.revokeObjectURL(sponsorLogoObjectUrl);
    sponsorLogoObjectUrl = String(url || '').startsWith('blob:') ? url : '';
    $('sponsor-logo-preview').hidden = !url;
    if (url) $('sponsor-logo-preview-img').src = url;
    else $('sponsor-logo-preview-img').removeAttribute('src');
    $('sponsor-logo-file-name').textContent = fileName || (url ? 'Current logo preview.' : 'No logo selected.');
  }
  sponsorLogoFile.addEventListener('change', () => {
    const file = sponsorLogoFile.files?.[0];
    if (!file) { showSponsorLogoPreview($('sponsor-logo-url').value.trim()); return; }
    if (!['image/png','image/jpeg','image/webp','image/svg+xml'].includes(file.type)) {
      sponsorLogoFile.value = ''; showSponsorLogoPreview($('sponsor-logo-url').value.trim());
      $('sponsor-form-message').textContent = 'Choose a PNG, JPG, WEBP or SVG logo.'; return;
    }
    if (file.size > 5 * 1024 * 1024) {
      sponsorLogoFile.value = ''; showSponsorLogoPreview($('sponsor-logo-url').value.trim());
      $('sponsor-form-message').textContent = 'Logo must be 5 MB or smaller.'; return;
    }
    showSponsorLogoPreview(URL.createObjectURL(file), file.name);
    $('sponsor-logo-url').value = '';
    $('sponsor-form-message').textContent = '';
  });
  $('sponsor-logo-url').addEventListener('input', () => {
    if (!sponsorLogoFile.files?.length) showSponsorLogoPreview($('sponsor-logo-url').value.trim());
  });
  $('remove-sponsor-logo').addEventListener('click', () => {
    sponsorLogoFile.value = ''; $('sponsor-logo-url').value = ''; showSponsorLogoPreview('');
    $('sponsor-form-message').textContent = 'Logo removed. Save the sponsor to apply the change.';
  });
  async function uploadSponsorLogo() {
    const file = sponsorLogoFile.files?.[0];
    if (!file) {
      const value = $('sponsor-logo-url').value.trim();
      if (!value) return '';
      try { return new URL(value).protocol === 'https:' ? value : ''; } catch { return ''; }
    }
    const ext = ({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/svg+xml':'svg'})[file.type];
    const path = `sponsors/${crypto.randomUUID()}.${ext}`;
    const { error } = await db.storage.from('sponsor-logos').upload(path, file, {contentType:file.type,cacheControl:'3600',upsert:false});
    if (error) throw error;
    return db.storage.from('sponsor-logos').getPublicUrl(path).data.publicUrl;
  }
  function clearSponsorForm() {
    $('sponsor-form').reset(); $('sponsor-id').value = ''; $('sponsor-order').value = '0';
    $('sponsor-published').checked = true; sponsorLogoFile.value = ''; $('sponsor-logo-url').value = '';
    showSponsorLogoPreview(''); $('sponsor-editor-title').textContent = 'ADD A SPONSOR';
    $('save-sponsor-btn').innerHTML = 'SAVE SPONSOR <span>↗</span>';
    $('sponsor-form-message').textContent = '';
  }
  async function loadSponsors() {
    const target = $('admin-sponsors-list');
    target.innerHTML = '<p class="pnx-recent-empty">Loading sponsors…</p>';
    const {data,error} = await db.from('sponsors').select('*').order('display_order',{ascending:true}).order('created_at',{ascending:false});
    if (error) { target.innerHTML = '<p class="pnx-recent-empty">Could not load sponsors. Run the PUNIX sponsors SQL migration first.</p>'; return; }
    if (!data?.length) { target.innerHTML = '<p class="pnx-recent-empty">No sponsors added yet. Add your first partner using the editor.</p>'; return; }
    target.innerHTML = data.map(item => `<article class="pnx-admin-update-row"><div class="pnx-admin-update-top"><div><strong>${escapeHtml(item.name)}</strong><br><small>ORDER ${Number(item.display_order)||0} · ${item.is_featured?'FEATURED · ':''}${item.is_published?'VISIBLE':'HIDDEN'}</small></div><span class="pnx-update-status ${item.is_published?'':'is-draft'}">${item.is_published?'PUBLISHED':'HIDDEN'}</span></div>${item.logo_url?'<img class="pnx-admin-sponsor-thumb" src="'+escapeHtml(item.logo_url)+'" alt="">':'<p>No logo added.</p>'}<div class="pnx-update-actions"><button type="button" data-edit-sponsor="${escapeHtml(item.id)}">EDIT</button><button type="button" data-toggle-sponsor="${escapeHtml(item.id)}">${item.is_published?'HIDE':'PUBLISH'}</button><button type="button" class="delete" data-delete-sponsor="${escapeHtml(item.id)}">DELETE</button></div></article>`).join('');
    target.querySelectorAll('[data-edit-sponsor]').forEach(btn => btn.addEventListener('click', () => {
      const item=data.find(x=>x.id===btn.dataset.editSponsor); if(!item)return;
      $('sponsor-id').value=item.id; $('sponsor-name').value=item.name||''; $('sponsor-website').value=item.website_url||'';
      $('sponsor-logo-url').value=item.logo_url||''; sponsorLogoFile.value=''; showSponsorLogoPreview(item.logo_url||'');
      $('sponsor-order').value=item.display_order??0; $('sponsor-featured').checked=Boolean(item.is_featured);
      $('sponsor-published').checked=Boolean(item.is_published); $('sponsor-editor-title').textContent='EDIT SPONSOR';
      $('save-sponsor-btn').innerHTML='SAVE CHANGES <span>↗</span>'; $('sponsor-form-message').textContent='Editing selected sponsor.';
      $('sponsor-form').scrollIntoView({behavior:'smooth',block:'start'});
    }));
    target.querySelectorAll('[data-toggle-sponsor]').forEach(btn => btn.addEventListener('click', async () => {
      const item=data.find(x=>x.id===btn.dataset.toggleSponsor); if(!item)return;
      const {error}=await db.from('sponsors').update({is_published:!item.is_published}).eq('id',item.id);
      if(error) alert('Could not change sponsor visibility: '+error.message); else loadSponsors();
    }));
    target.querySelectorAll('[data-delete-sponsor]').forEach(btn => btn.addEventListener('click', async () => {
      const item=data.find(x=>x.id===btn.dataset.deleteSponsor); if(!item||!confirm(`Delete “${item.name}” from the sponsor list?`))return;
      const {error}=await db.from('sponsors').delete().eq('id',item.id);
      if(error) alert('Could not delete sponsor: '+error.message); else {
        const marker='/storage/v1/object/public/sponsor-logos/';
        if(item.logo_url?.includes(marker)){const path=item.logo_url.split(marker)[1];if(path)await db.storage.from('sponsor-logos').remove([decodeURIComponent(path)]);}
        if($('sponsor-id').value===item.id)clearSponsorForm(); loadSponsors();
      }
    }));
  }
  async function saveSponsor(event) {
    event.preventDefault();
    const website=$('sponsor-website').value.trim();
    if(website){try{if(new URL(website).protocol!=='https:')throw new Error();}catch{$('sponsor-form-message').textContent='Website must be a valid HTTPS URL.';return;}}
    $('save-sponsor-btn').disabled=true; $('sponsor-form-message').textContent='Uploading logo and saving sponsor…';
    try {
      const logo=await uploadSponsorLogo();
      if($('sponsor-logo-url').value.trim()&&!logo)throw new Error('Logo URL must be a valid HTTPS URL.');
      const payload={name:$('sponsor-name').value.trim(),website_url:website,logo_url:logo,display_order:Number($('sponsor-order').value||0),is_featured:$('sponsor-featured').checked,is_published:$('sponsor-published').checked};
      const id=$('sponsor-id').value;
      const result=id?await db.from('sponsors').update(payload).eq('id',id):await db.from('sponsors').insert(payload);
      if(result.error)throw result.error;
      clearSponsorForm(); $('sponsor-form-message').textContent='Sponsor saved successfully.'; loadSponsors();
    } catch(error) { $('sponsor-form-message').textContent='Save failed: '+(error.message||'Unknown error'); }
    finally { $('save-sponsor-btn').disabled=false; }
  }

  let supportAdminUserId = null;
  let selectedSupportConversation = null;
  let supportRealtimeChannel = null;
  const supportAdminSeenKey = 'punix-support-admin-seen-v1:';
  let supportAdminUnread = new Map();
  function updateSupportAdminBadge(count) {
    const label = count > 9 ? '9+' : String(count);
    const sidebarBadge = $('support-sidebar-unread');
    if (sidebarBadge) { sidebarBadge.textContent = label; sidebarBadge.hidden = count < 1; }
    window.PUNIX_REFRESH_SUPPORT_ALERT?.();
    const title = $('support-admin-count');
    if (title && count > 0) title.dataset.unread = `${count} UNREAD`;
    else if (title) delete title.dataset.unread;
  }

  async function loadSupportConversations() {
    const target = $('support-admin-list');
    if (!target) return;
    $('support-admin-message').textContent = 'Refreshing support inbox…';
    const { data, error } = await db.from('support_conversations')
      .select('id,visitor_name,visitor_email,status,last_message_at,created_at')
      .order('last_message_at', { ascending: false }).limit(100);
    if (error) {
      $('support-admin-message').textContent = 'Could not load support inbox. Run the PUNIX live support SQL migration first.';
      target.innerHTML = '<p class="pnx-recent-empty">Support database is not ready or access was denied.</p>';
      return;
    }
    const rows = data || [];
    const { data: recentMessages } = await db.from('support_messages').select('id,conversation_id,sender_type,created_at').order('created_at', {ascending:false}).limit(1000);
    const latestByConversation = new Map();
    (recentMessages || []).forEach(message => { if (!latestByConversation.has(message.conversation_id)) latestByConversation.set(message.conversation_id, message); });
    let unreadCount = 0;
    rows.forEach(row => {
      const latest = latestByConversation.get(row.id);
      let seen = ''; try { seen = localStorage.getItem(supportAdminSeenKey + row.id) || ''; } catch {}
      if (latest?.sender_type === 'visitor' && latest.id !== seen) unreadCount++;
    });
    updateSupportAdminBadge(unreadCount);
    const openCount = rows.filter(row => row.status === 'open').length;
    $('support-admin-count').textContent = `${openCount} OPEN · ${rows.length} TOTAL`;
    $('support-admin-message').textContent = rows.length ? 'Select a conversation to read and reply.' : 'Your support inbox is clear.';
    if (!rows.length) {
      target.innerHTML = '<p class="pnx-recent-empty">No visitor conversations yet. New chats will appear here.</p>';
      return;
    }
    target.innerHTML = rows.map(row => {
      const latest = latestByConversation.get(row.id);
      let seen = ''; try { seen = localStorage.getItem(supportAdminSeenKey + row.id) || ''; } catch {}
      const unread = latest?.sender_type === 'visitor' && latest.id !== seen;
      return `
      <button class="pnx-support-admin-row ${selectedSupportConversation === row.id ? 'is-selected' : ''} ${unread ? 'has-unread' : ''}" type="button" data-support-open="${escapeHtml(row.id)}">
        <span class="pnx-support-admin-row-top"><strong>${escapeHtml(row.visitor_name)}</strong><span class="pnx-support-admin-row-tags">${unread ? '<b class="pnx-support-new">NEW</b>' : ''}<span class="pnx-support-admin-badge ${row.status === 'closed' ? 'is-closed' : ''}">${escapeHtml(row.status.toUpperCase())}</span></span></span>
        <small>${escapeHtml(row.visitor_email || 'NO EMAIL PROVIDED')} · ${escapeHtml(new Date(row.last_message_at).toLocaleString())}</small>
      </button>`;
    }).join('');
    target.querySelectorAll('[data-support-open]').forEach(button => button.addEventListener('click', () => openSupportConversation(button.dataset.supportOpen)));
    if (selectedSupportConversation && rows.some(row => row.id === selectedSupportConversation)) {
      const selected = rows.find(row => row.id === selectedSupportConversation);
      $('support-toggle-status').textContent = selected.status === 'open' ? 'CLOSE & DELETE' : 'DELETE CONVERSATION';
    }
  }

  async function openSupportConversation(id) {
    selectedSupportConversation = id;
    const { data: conversation, error: conversationError } = await db.from('support_conversations')
      .select('id,visitor_name,visitor_email,status,created_at').eq('id', id).maybeSingle();
    if (conversationError || !conversation) {
      $('support-admin-message').textContent = 'Could not open this conversation.';
      return;
    }
    const { data: messages, error } = await db.from('support_messages')
      .select('id,sender_type,body,created_at').eq('conversation_id', id).order('created_at', { ascending: true }).limit(300);
    if (error) {
      $('support-admin-message').textContent = 'Could not load messages: ' + error.message;
      return;
    }
    $('support-thread-title').textContent = conversation.visitor_name || 'VISITOR';
    $('support-thread-meta').textContent = [conversation.visitor_email || 'No email provided', 'Started ' + new Date(conversation.created_at).toLocaleString()].join(' · ');
    $('support-admin-messages').innerHTML = (messages || []).map(message => `
      <article class="pnx-support-admin-message ${message.sender_type === 'admin' ? 'is-admin' : 'is-visitor'}">${escapeHtml(message.body)}<small>${message.sender_type === 'admin' ? 'PUNIX SUPPORT' : escapeHtml(conversation.visitor_name)} · ${escapeHtml(new Date(message.created_at).toLocaleString())}</small></article>`).join('') || '<p class="pnx-recent-empty">No messages in this conversation.</p>';
    $('support-admin-messages').scrollTop = $('support-admin-messages').scrollHeight;
    const latestVisitorMessage = [...(messages || [])].reverse().find(message => message.sender_type === 'visitor');
    if (latestVisitorMessage?.id) { try { localStorage.setItem(supportAdminSeenKey + id, latestVisitorMessage.id); } catch {} }
    $('support-admin-reply').hidden = conversation.status !== 'open';
    $('support-admin-reply-text').value = '';
    $('support-toggle-status').hidden = false;
    $('support-toggle-status').textContent = conversation.status === 'open' ? 'CLOSE & DELETE' : 'DELETE CONVERSATION';
    await loadSupportConversations();
  }

  async function sendSupportReply(event) {
    event.preventDefault();
    if (!selectedSupportConversation) return;
    const input = $('support-admin-reply-text');
    const body = input.value.trim();
    if (!body) return;
    const button = $('support-admin-reply').querySelector('button[type="submit"]');
    button.disabled = true;
    const { error } = await db.from('support_messages').insert({
      conversation_id: selectedSupportConversation, sender_type: 'admin',
      sender_id: supportAdminUserId, body
    });
    if (!error) {
      await db.from('support_conversations').update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', selectedSupportConversation);
      input.value = '';
      await openSupportConversation(selectedSupportConversation);
      $('support-admin-message').textContent = 'Reply sent.';
    } else {
      $('support-admin-message').textContent = 'Reply failed: ' + error.message;
    }
    button.disabled = false;
  }

  async function toggleSupportStatus() {
    if (!selectedSupportConversation) return;
    const conversationId = selectedSupportConversation;
    const button = $('support-toggle-status');
    button.disabled = true;
    const { error } = await db.rpc('punix_support_close_and_delete', { p_conversation_id: conversationId });
    button.disabled = false;
    if (error) {
      $('support-admin-message').textContent = 'Could not close and delete conversation: ' + error.message;
      return;
    }
    try { localStorage.removeItem(supportAdminSeenKey + conversationId); } catch {}
    selectedSupportConversation = null;
    $('support-thread-title').textContent = 'SELECT A CONVERSATION';
    $('support-thread-meta').textContent = 'Closed conversations are permanently deleted.';
    $('support-admin-messages').innerHTML = '<p class="pnx-recent-empty">This conversation and its messages were deleted.</p>';
    $('support-admin-reply').hidden = true;
    $('support-toggle-status').hidden = true;
    await loadSupportConversations();
    $('support-admin-message').textContent = 'Conversation permanently deleted. The user can start a new chat.';
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
      supportAdminUserId = session.user.id;
      document.querySelectorAll('[data-section]').forEach((button) => button.addEventListener('click', () => openSection(button.dataset.section)));
      document.querySelectorAll('[data-open-section="teams"]').forEach((button) => button.addEventListener('click', () => openSection('teams')));
      $('update-form').addEventListener('submit', saveUpdate);
      $('cancel-update-btn').addEventListener('click', clearUpdateForm);
      $('refresh-updates').addEventListener('click', loadUpdates);
      $('sponsor-form').addEventListener('submit', saveSponsor);
      $('cancel-sponsor-btn').addEventListener('click', clearSponsorForm);
      $('refresh-sponsors').addEventListener('click', loadSponsors);
      $('refresh-support').addEventListener('click', loadSupportConversations);
      $('support-admin-reply').addEventListener('submit', sendSupportReply);
      $('support-toggle-status').addEventListener('click', toggleSupportStatus);
      const supportNavNotification = $('support-nav-notification');
      supportNavNotification?.addEventListener('click', () => openSection('support'));
      supportRealtimeChannel = db.channel('punix-support-admin-inbox')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'support_conversations' }, () => { loadSupportConversations(); })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' }, payload => {
          loadSupportConversations();
          if (currentSection === 'support' && selectedSupportConversation === payload.new.conversation_id) openSupportConversation(selectedSupportConversation);
        })
        .subscribe();
      clearUpdateForm();
      $('refresh-stats').addEventListener('click', loadStats);
      $('refresh-members').addEventListener('click', loadMembers);
      $('member-account-search').addEventListener('input', renderMemberAccounts);
      document.querySelectorAll('[data-membership-filter]').forEach(button => {
        button.addEventListener('click', () => {
          activeMembershipFilter = button.dataset.membershipFilter || 'all';
          renderMemberAccounts();
        });
      });
      window.PUNIX_OPEN_SUPPORT_INBOX = () => openSection('support');
      const initial = location.hash === '#members' ? 'members' : location.hash === '#teams' ? 'teams' : location.hash === '#updates' ? 'updates' : location.hash === '#tournaments' ? 'tournaments' : location.hash === '#sponsors' ? 'sponsors' : location.hash === '#support' ? 'support' : 'overview';
      openSection(initial);
      await loadSupportConversations();
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
