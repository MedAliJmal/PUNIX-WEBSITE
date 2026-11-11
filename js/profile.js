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
  const fields = ['display_name','gender','avatar_url','bio','twitch_url','kick_url','youtube_url','tiktok_url'];
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
    display_name: 'display-name', gender: 'gender', avatar_url: 'avatar-url', bio: 'bio',
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
    byId('view-gender').textContent = profile.gender === 'male' ? 'Male' : profile.gender === 'female' ? 'Female' : 'Not set';
    byId('preview-bio').textContent = profile.bio || 'No bio added yet.';
    byId('view-bio').textContent = profile.bio || 'No bio added yet.';
    const status = profile.membership_status || 'pending';
    byId('view-membership-status').textContent = status === 'approved' ? 'Approved' : status === 'rejected' ? 'Not approved' : 'Pending review';
    byId('view-directory-visibility').textContent = status === 'approved' && profile.is_public ? 'Listed publicly' : 'Not listed';
    byId('view-directory-division').textContent = status === 'approved'
      ? (profile.directory_division === 'competitive' ? 'Competitive Player' : profile.directory_division === 'creators' ? 'Streamer' : 'Community Member')
      : 'Assigned after approval';
    byId('reapply-wrap').hidden = status !== 'rejected';
    const statusBadge = document.querySelector('.profile-heading .member-status');
    if (statusBadge) statusBadge.textContent = status === 'approved' ? 'APPROVED MEMBER' : status === 'rejected' ? 'MEMBERSHIP NOT APPROVED' : 'PENDING APPROVAL';
    byId('avatar-fallback').textContent = name.charAt(0).toUpperCase();

    const genderAvatar = ['male','female'].includes(profile.gender)
      ? new URL(`/assets/images/punix-avatar-${profile.gender}.png`, window.location.origin).href
      : '';
    const neutralAvatar = new URL('/assets/images/punix-logo-original.png', window.location.origin).href;
    const avatar = profile.avatar_url || genderAvatar || neutralAvatar;
    const img = byId('avatar-preview');
    if (avatar) {
      img.onerror = () => {
        img.onerror = null;
        img.style.display = 'none';
        byId('avatar-fallback').style.display = 'block';
        byId('view-avatar').textContent = 'Avatar image unavailable';
      };
      img.src = avatar;
      img.style.display = 'block';
      byId('avatar-fallback').style.display = 'none';
      byId('view-avatar').textContent = profile.avatar_url && profile.avatar_url !== genderAvatar && profile.avatar_url !== neutralAvatar ? 'Custom avatar connected' : genderAvatar ? 'Default PUNIX avatar' : 'PUNIX placeholder avatar';
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
    // Restore signup metadata into the profile row when older account-creation triggers omitted it.
    const signupGender = currentUser.user_metadata?.gender;
    const signupAvatar = currentUser.user_metadata?.avatar_url;
    const defaultAvatar = ['male','female'].includes(signupGender)
      ? new URL(`/assets/images/punix-avatar-${signupGender}.png`, window.location.origin).href
      : '';
    const avatarToSave = savedProfile.avatar_url || (typeof signupAvatar === 'string' && signupAvatar.startsWith(window.location.origin + '/assets/images/punix-avatar-') && signupAvatar.endsWith('.png') ? signupAvatar : defaultAvatar);
    const profilePatch = {};
    if (!savedProfile.gender && ['male', 'female'].includes(signupGender)) profilePatch.gender = signupGender;
    if (!savedProfile.avatar_url && avatarToSave) profilePatch.avatar_url = avatarToSave;
    if (Object.keys(profilePatch).length) {
      const { error: profileError } = await client.from('profiles').update(profilePatch).eq('id', currentUser.id);
      if (profileError) throw profileError;
      savedProfile = { ...savedProfile, ...profilePatch };
    }
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
        gender: values.gender,
        avatar_url: validOptionalUrl(values.avatar_url, 'Avatar URL') || new URL(`/assets/images/punix-avatar-${values.gender}.png`, window.location.origin).href,
        bio: values.bio,
        twitch_url: validOptionalUrl(values.twitch_url, 'Twitch URL'),
        kick_url: validOptionalUrl(values.kick_url, 'Kick URL'),
        youtube_url: validOptionalUrl(values.youtube_url, 'YouTube URL'),
        tiktok_url: validOptionalUrl(values.tiktok_url, 'TikTok URL'),
        updated_at: new Date().toISOString()
      };
      if (!payload.display_name) throw new Error('Please enter a display name.');
      if (!['male', 'female'].includes(payload.gender)) throw new Error('Please select your gender.');

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

  byId('reapply-application').addEventListener('click', async () => {
    const button = byId('reapply-application');
    button.disabled = true;
    setMessage('Submitting your application for another review…');
    const { error } = await client.rpc('reapply_membership');
    button.disabled = false;
    if (error) {
      setMessage(error.message || 'Could not submit your application again.', true);
      return;
    }
    savedProfile = { ...savedProfile, membership_status: 'pending', is_public: false };
    renderProfile(savedProfile);
    setMessage('Application resubmitted. Your membership is pending review.');
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