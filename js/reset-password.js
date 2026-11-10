(() => {
  const config = window.PUNIX_SUPABASE_CONFIG;
  const form = document.querySelector('#reset-password-form');
  const message = document.querySelector('#reset-message');
  const submit = document.querySelector('#reset-submit');
  const password = document.querySelector('#new-password');
  const confirm = document.querySelector('#confirm-password');
  if (!window.supabase || !config?.url || !config?.publishableKey) {
    message.textContent = 'Supabase configuration is unavailable. Please contact the PUNIX team.';
    message.classList.add('error'); submit.disabled = true; return;
  }
  const client = window.supabase.createClient(config.url, config.publishableKey);
  let recoveryReady = false;
  const setMessage = (text, error = false) => { message.textContent = text; message.classList.toggle('error', error); };

  client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' || session) {
      recoveryReady = true;
      setMessage('Recovery link verified. Choose your new password.');
      submit.disabled = false;
    }
  });

  client.auth.getSession().then(({ data, error }) => {
    if (error) { setMessage(error.message, true); return; }
    if (data.session) {
      recoveryReady = true;
      setMessage('Recovery link verified. Choose your new password.');
      submit.disabled = false;
    } else {
      setMessage('This reset link is invalid or has expired. Return to Log In and request a new one.', true);
      submit.disabled = true;
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!recoveryReady) { setMessage('Please open the latest password-reset link from your email.', true); return; }
    if (password.value.length < 8) { setMessage('Your password must contain at least 8 characters.', true); return; }
    if (password.value !== confirm.value) { setMessage('The passwords do not match.', true); return; }
    submit.disabled = true; setMessage('Updating your password…');
    const { error } = await client.auth.updateUser({ password: password.value });
    if (error) {
      setMessage(error.message || 'Could not update your password.', true);
      submit.disabled = false; return;
    }
    await client.auth.signOut();
    setMessage('Password updated successfully. You can now log in with your new password.');
    form.reset();
    window.setTimeout(() => { window.location.href = 'auth.html'; }, 1800);
  });
})();
