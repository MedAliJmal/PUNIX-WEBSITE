# PUNIX authentication email templates

These HTML templates are designed for the Supabase Auth email-template editor. They are **not activated automatically** by committing them to this repository.

## Templates

| File | Supabase template |
|---|---|
| `confirm-signup.html` | Confirm signup |
| `reset-password.html` | Reset password |
| `change-email.html` | Change email address |
| `invite-user.html` | Invite user |

## Apply them in Supabase

1. Open your Supabase project dashboard.
2. Go to **Authentication → Email Templates**.
3. Open each matching template.
4. Copy the complete HTML from the corresponding file in this folder into the template editor.
5. Set the subject lines:
   - Confirm signup: `Verify your email | PUNIX`
   - Reset password: `Reset your password | PUNIX`
   - Change email: `Confirm your new email | PUNIX`
   - Invite user: `You are invited to PUNIX`
6. Save each template and send test emails.

The templates use Supabase's `{{ .ConfirmationURL }}` variable for the action link. Keep that variable intact.

## Branding and security notes

- The design uses the PUNIX logo hosted at `https://punix.pages.dev/assets/images/punix-logo-original.png`.
- These templates remove Supabase product branding from the **email body**, but do not change the actual sender address or the authentication link hostname.
- A PUNIX sender address requires a configured custom SMTP provider and verified sending domain.
- A branded authentication link hostname requires Supabase custom-domain configuration and DNS setup.
- Do not place service-role keys, SMTP passwords, or other private credentials in this repository or in browser JavaScript.
