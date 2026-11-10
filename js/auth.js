(() => {
  const config = window.PUNIX_SUPABASE_CONFIG;
  const message = document.querySelector('#auth-message');
  const form = document.querySelector('#auth-form');
  const submit = document.querySelector('#auth-submit');
  const captchaBox = document.querySelector('#turnstile-container');
  if (!window.supabase || !config || !config.url?.startsWith('https://') || config.url.includes('YOUR_PROJECT') || !config.publishableKey || config.publishableKey.includes('YOUR_')) {
    message.textContent = 'Setup required: check your Supabase URL and publishable key in js/supabase-config.js.';
    message.classList.add('error'); form.querySelectorAll('input,button').forEach(el => el.disabled = true); return;
  }
  if (!config.turnstileSiteKey || config.turnstileSiteKey.includes('YOUR_')) {
    message.textContent = 'Setup required: add your Cloudflare Turnstile site key in js/supabase-config.js.';
    message.classList.add('error'); form.querySelectorAll('input,button').forEach(el => el.disabled = true); return;
  }

  const client = window.supabase.createClient(config.url, config.publishableKey);
  let mode = 'signup'; let captchaToken = ''; let widgetId = null;
  const nameInput = document.querySelector('#display-name');
  const nameLabel = document.querySelector('#name-label');
  const genderInput = document.querySelector('#gender');
  const genderLabel = document.querySelector('#gender-label');
  const emailInput = document.querySelector('#email');
  const password = document.querySelector('#password');
  const title = document.querySelector('#auth-title');
  const intro = document.querySelector('.auth-intro');
  const tabs = document.querySelector('.auth-switch');
  const forgotLink = document.querySelector('#forgot-password-link');
  const avatarChoice = document.querySelector('#auth-avatar-choice');
  const avatarPreview = document.querySelector('#auth-avatar-preview');
  const avatarTitle = document.querySelector('#auth-avatar-title');
  const avatarDescription = document.querySelector('#auth-avatar-description');

  function updateGenderAvatar() {
    const gender = genderInput.value;
    if (!gender || !['male', 'female'].includes(gender)) {
      avatarChoice.hidden = true;
      return;
    }
    avatarPreview.src = `assets/images/punix-avatar-${gender}.svg`;
    avatarPreview.alt = `PUNIX ${gender} default avatar`;
    avatarTitle.textContent = gender === 'male' ? 'PUNIX MALE AVATAR' : 'PUNIX FEMALE AVATAR';
    avatarDescription.textContent = 'This avatar will be used on your member profile. You can upload a different image later.';
    avatarChoice.hidden = false;
  }
  genderInput.addEventListener('change', updateGenderAvatar);

  function setMessage(text, isError = false) { message.textContent = text; message.classList.toggle('error', isError); }
  function updateSubmit() { submit.disabled = !captchaToken; }
  function resetCaptcha() { captchaToken = ''; updateSubmit(); if (window.turnstile && widgetId !== null) window.turnstile.reset(widgetId); }
  function setMode(nextMode) {
    mode = nextMode;
    const signingUp = mode === 'signup';
    const signingIn = mode === 'signin';
    tabs.hidden = mode === 'forgot';
    document.querySelectorAll('[data-mode]').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
    nameLabel.hidden = !signingUp;
    nameInput.required = signingUp;
    genderLabel.hidden = !signingUp;
    genderInput.required = signingUp;\n    avatarChoice.hidden = !signingUp;\n    updateGenderAvatar();
    password.closest('label').hidden = mode === 'forgot';
    password.required = mode !== 'forgot';
    emailInput.required = true;
    forgotLink.hidden = !signingIn;
    intro.textContent = signingUp
      ? 'Create your member account, connect with the community, and apply for creator partnership.'
      : signingIn ? 'Sign in to access your PUNIX member account.' : 'Enter the email address linked to your PUNIX account. We will send you a secure password-reset link.';
    title.innerHTML = signingUp ? 'JOIN THE<br><span>NETWORK.</span>' : signingIn ? 'WELCOME<br><span>BACK.</span>' : 'RESET YOUR<br><span>PASSWORD.</span>';
    submit.innerHTML = signingUp ? 'CREATE ACCOUNT <span>↗</span>' : signingIn ? 'SIGN IN <span>↗</span>' : 'SEND RESET LINK <span>↗</span>';
    setMessage(''); resetCaptcha();
  }
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
  forgotLink.addEventListener('click', event => { event.preventDefault(); setMode('forgot'); });

  function renderCaptcha() {
    if (!window.turnstile || widgetId !== null) return;
    widgetId = window.turnstile.render(captchaBox, {
      sitekey: config.turnstileSiteKey,
      callback: token => { captchaToken = token; setMessage('Verification complete. You can continue.'); updateSubmit(); },
      'expired-callback': () => { captchaToken = ''; updateSubmit(); setMessage('Security check expired. Please verify again.', true); },
      'error-callback': () => { captchaToken = ''; updateSubmit(); setMessage('Security check unavailable. Refresh the page and try again.', true); }
    });
  }
  const captchaWait = setInterval(() => { if (window.turnstile) { clearInterval(captchaWait); renderCaptcha(); } }, 150);

  client.auth.getSession().then(({ data }) => {
    if (data.session) {
      setMessage(`Already signed in as ${data.session.user.email}. Redirecting to your profile…`);
      window.location.assign(new URL('profile.html', window.location.href).href);
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!captchaToken) { setMessage('Please complete human verification first.', true); return; }
    submit.disabled = true;
    const email = emailInput.value.trim().toLowerCase();
    const token = captchaToken;
    try {
      if (mode === 'forgot') {
        setMessage('Sending your password-reset email…');
        const redirectTo = `${window.location.origin}${window.location.pathname.replace(/auth\.html$/, 'reset-password.html')}`;
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo, captchaToken: token });
        if (error) throw error;
        setMessage('If an account exists for this email, a password-reset link has been sent. Check your inbox and spam folder.');
      } else if (mode === 'signup') {
        setMessage('Creating your account…');
        const displayName = nameInput.value.trim();
        const gender = genderInput.value;
        if (!['male', 'female'].includes(gender)) throw new Error('Please select your gender.');
        const { data, error } = await client.auth.signUp({ email, password: password.value, options: { captchaToken: token, data: { display_name: displayName, gender }, emailRedirectTo: `${window.location.origin}${window.location.pathname.replace(/auth\.html$/, 'auth.html')}` } });
        if (error) throw error;
        setMessage(data.session ? 'Account created. You are signed in.' : 'Account created. Check your email to confirm your address, then sign in.');
      } else {
        setMessage('Signing you in…');
        const { data, error } = await client.auth.signInWithPassword({ email, password: password.value, options: { captchaToken: token } });
        if (error) throw error;
        setMessage('Signed in successfully. Redirecting to your profile…');
        // Keep the member experience consistent: a successful login opens the member profile.
        window.location.assign(new URL('profile.html', window.location.href).href);
        return;
      }
    } catch (error) {
      setMessage(error.message || 'Something went wrong. Please try again.', true);
    } finally { resetCaptcha(); }
  });
})();
