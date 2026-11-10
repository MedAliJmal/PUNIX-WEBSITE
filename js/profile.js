(() => {
  const config = window.PUNIX_SUPABASE_CONFIG;
  const message = document.querySelector('#profile-message');
  const form = document.querySelector('#profile-form');
  const saveButton = document.querySelector('#save-profile');
  const editButton = document.querySelector('#edit-profile');
  const cancelButton = document.querySelector('#cancel-edit');
  const view = document.querySelector('#profile-view');
  const signOutButton = document.querySelector('#sign-out');

  if (!window.supabase || !config || !config.url || !config.publishableKey) {
    message.textContent = 'Supabase configuration is missing. Check js/supabase-config.js.';
    message.classList.add('error');
    editButton.disabled = true;
    return;
  }

  const client = window.supabase.createClient(config.url, config.publishableKey);
  const fields = ['display_name','avatar_url','bio','twitch_url','kick_url','youtube_url','tiktok_url'];
  let currentUser = null;
  let savedProfile = {};

  const byId = id => document.getElementById(id);
  const setMessage = (text, error = false) => {
    message.textContent = text;
    message.classList.toggle('error', error);
  };

  function validOptionalUrl(value, label) {
    if (!value) return '';
    let parsed;
    try { parsed = new URL(value); }
    catch { throw new Error(`${label} must be a complete URL starting with https://`); }
    if (parsed.protocol !== 'https:') throw new Error(`${label} must start with https://`);
    return parsed.href;
  }

  const fieldIds = {
    display_name: 'display-name', avatar_url: 'avatar-url', bio: 'bio',
    twitch_url: 'twitch-url', kick_url: 'kick-url',
    youtube_url: 'youtube-url', tiktok_url: 'tiktok-url'
  };
  function readForm() {
    return Object.fromEntries(fields.map(field => [field, byId(fieldIds[field]).value.trim()]));
  }

  function fillForm(profile) {
    fields.forEach(field => { byId(fieldIds[field]).value = profile[field] || ''; });
  }

  function setLink(platform, value) {
    const link = byId(`view-${platform}`);
    const empty = byId(`empty-${platform}`);
    if (value) {
      link.href = value;
      link.textContent = value.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
      link.hidden = false;
      empty.hidden = true;
    } else {
      link.removeAttribute('href');
      link.hidden = true;
      empty.hidden = false;
    }
  }

  function renderProfile(profile) {
    const name = profile.display_name || 'PUNIX MEMBER';
    byId('preview-name').textContent = name;
    byId('view-display-name').textContent = name;
    byId('preview-bio').textContent = profile.bio || 'No bio added yet.';
    byId('view-bio').textContent = profile.bio || 'No bio added yet.';
    const status = profile.membership_status || 'pending';
    byId('view-membership-status').textContent = status === 'approved' ? 'Approved' : status === 'rejected' ? 'Not approved' : 'Pending review';
    byId('view-directory-visibility').textContent = status === 'approved' && profile.is_public ? 'Listed publicly' : 'Not listed';
    byId('view-directory-division').textContent = status === 'approved'
      ? (profile.directory_division === 'competitive' ? 'Competitive Players' : 'Creators / Streamers')
      : 'Assigned after approval';
    const statusBadge = document.querySelector('.profile-heading .member-status');
    if (statusBadge) statusBadge.textContent = status === 'approved' ? 'APPROVED MEMBER' : status === 'rejected' ? 'MEMBERSHIP NOT APPROVED' : 'PENDING APPROVAL';
    byId('avatar-fallback').textContent = name.charAt(0).toUpperCase();

    const avatar = profile.avatar_url || '';
    const img = byId('avatar-preview');
    if (avatar) {
      img.src = avatar;
      img.style.display = 'block';
      byId('avatar-fallback').style.display = 'none';
      byId('view-avatar').textContent = 'Avatar image connected';
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
      byId('avatar-fallback').style.display = 'block';
      byId('view-avatar').textContent = 'No avatar added';
    }

    ['twitch','kick','youtube','tiktok'].forEach(platform => setLink(platform, profile[`${platform}_url`] || ''));

    const socials = byId('preview-socials');
    socials.replaceChildren();
    const platforms = [['Twitch','twitch_url'],['Kick','kick_url'],['YouTube','youtube_url'],['TikTok','tiktok_url']];
    const connected = platforms.filter(([,field]) => profile[field]);
    if (!connected.length) {
      const empty = document.createElement('span');
      empty.textContent = 'No links added yet';
      socials.appendChild(empty);
    } else {
      connected.forEach(([label, field]) => {
        const a = document.createElement('a');
        a.href = profile[field];
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = `${label} ↗`;
        socials.appendChild(a);
      });
    }
  }

  function enterEditMode() {
    fillForm(savedProfile);
    view.hidden = true;
    form.hidden = false;
    editButton.hidden = true;
    setMessage('Make your changes, then save or cancel.');
    byId('display-name').focus();
  }

  function leaveEditMode() {
    fillForm(savedProfile);
    form.hidden = true;
    view.hidden = false;
    editButton.hidden = false;
  }

  async function init() {
    const { data: { session }, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!session) { window.location.replace('auth.html'); return; }
    currentUser = session.user;

    const { data, error } = await client.from('profiles')
      .select(fields.join(',') + ',created_at,is_public,directory_division,membership_status')
      .eq('id', currentUser.id)
      .single();
    if (error) throw error;

    savedProfile = { ...data };
    fillForm(savedProfile);
    renderProfile(savedProfile);
    byId('member-since').textContent = data.created_at
      ? new Date(data.created_at).toLocaleDateString(undefined, {month:'short', year:'numeric'})
      : '—';
    leaveEditMode();
    setMessage('Your member profile is up to date.');
  }

  editButton.addEventListener('click', enterEditMode);
  cancelButton.addEventListener('click', () => {
    leaveEditMode();
    setMessage('Changes discarded.');
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!currentUser) return;
    saveButton.disabled = true;
    cancelButton.disabled = true;
    setMessage('Saving your profile…');
    try {
      const values = readForm();
      const payload = {
        display_name: values.display_name,
        avatar_url: validOptionalUrl(values.avatar_url, 'Avatar URL'),
        bio: values.bio,
        twitch_url: validOptionalUrl(values.twitch_url, 'Twitch URL'),
        kick_url: validOptionalUrl(values.kick_url, 'Kick URL'),
        youtube_url: validOptionalUrl(values.youtube_url, 'YouTube URL'),
        tiktok_url: validOptionalUrl(values.tiktok_url, 'TikTok URL'),
        updated_at: new Date().toISOString()
      };
      if (!payload.display_name) throw new Error('Please enter a display name.');

      const { error } = await client.from('profiles').update(payload).eq('id', currentUser.id);
      if (error) throw error;

      savedProfile = { ...savedProfile, ...payload };
      renderProfile(savedProfile);
      leaveEditMode();
      setMessage('Profile saved successfully.');
    } catch (error) {
      setMessage(error.message || 'Could not save your profile.', true);
    } finally {
      saveButton.disabled = false;
      cancelButton.disabled = false;
    }
  });

  signOutButton.addEventListener('click', async () => {
    signOutButton.disabled = true;
    const { error } = await client.auth.signOut();
    if (error) {
      signOutButton.disabled = false;
      setMessage(error.message, true);
      return;
    }
    window.location.replace('auth.html');
  });

  init().catch(error => setMessage(error.message || 'Could not load your profile.', true));
})();