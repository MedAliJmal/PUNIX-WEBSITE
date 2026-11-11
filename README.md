# PUNIX Website — Starter Homepage

A responsive, premium dark esports/creator homepage built with plain HTML, CSS and JavaScript.

## Run locally (Windows)

1. Extract the ZIP file.
2. Open Visual Studio Code.
3. Choose **File → Open Folder** and select `PUNIX-WEBSITE`.
4. Open `index.html`.
5. Recommended: install the **Live Server** extension in VS Code.
6. Right-click `index.html` and choose **Open with Live Server**.

If you do not want to install an extension, double-click `index.html` in File Explorer. It should open in your browser. Live Server is better while editing because it refreshes the page automatically.

## First edits to make

- The official PUNIX logo is stored at `assets/images/punix-logo-original.png` and is used in the header, footer, member access page and subtle brand watermarks. Keep this file as the source of truth; do not replace it with a recreated mark.
- Replace the sample image URLs in `css/style.css` with your own approved images.
- Replace `https://discord.com/` with your real Discord invite URL.
- Replace `contact@punix.gg` with your real contact email.
- Add real creator profiles, team details and news before launch.

## Project structure

- `index.html` — homepage content and sections
- `css/style.css` — colors, layout, typography and responsive styles
- `js/main.js` — mobile navigation, scroll reveals and dynamic year
- `assets/images/` — place your local images here

The Google Fonts and sample photography use external URLs, so an internet connection is needed for those assets. The page layout and interactions still work locally without them.


## Kick creator hub

The homepage now includes a **PUNIX WATCH** section with two tabs:

- **LIVE NOW**: official Kick embedded players. Add creators in `js/main.js` under `PUNIX_KICK_CREATORS`.
- **LATEST VIDEOS**: manually curated video cards. Add title, creator, date, Kick video URL and thumbnail in `PUNIX_KICK_VIDEOS`.

Example creator entry:

```js
const PUNIX_KICK_CREATORS = [
  { name: "Creator Display Name", username: "kick_username", game: "VALORANT" },
];
```

Example video entry:

```js
const PUNIX_KICK_VIDEOS = [
  {
    title: "Ranked grind — best moments",
    creator: "Creator Display Name",
    date: "NEW VIDEO",
    url: "https://kick.com/USERNAME/videos/VIDEO_ID",
    thumbnail: "assets/images/video-thumbnail.jpg"
  },
];
```

This first version intentionally does not scrape Kick or expose API credentials in browser code. Livestreams use Kick's official public embed player. The latest-video gallery is updated by adding approved video links and thumbnails to the configuration. Fully automatic live status/video discovery would need a small server-side integration with Kick's official API and its required authorization.


## Supabase authentication and secure roles (first implementation)

This build adds a member registration/sign-in page at `auth.html` with Cloudflare Turnstile human verification, plus a database migration for secure roles and partnership applications. The public homepage now links to member access. The migration is the source of truth for authorization; hiding a page or button is not security.

### Roles

- `member`: assigned automatically to every new account. Can manage their own basic profile, submit partnership applications, and view their own applications.
- `admin`: only assigned when the signup email is present in the private admin whitelist. Can read applications and approve/reject them.
- `super_admin`: same review access plus permission to manage the whitelist through controlled SQL operations.

The `private.admin_whitelist` table is in a non-exposed schema. Browser clients have no grants on it. `public.user_roles` is read-only to signed-in users and has RLS; there are no client-side role write permissions. Application and profile tables also have RLS.

### Setup steps

1. Create a project at https://supabase.com/ and open its **SQL Editor**.
2. Run the complete SQL file `supabase/migrations/202611030001_punix_auth_and_roles.sql`.
3. Before founder accounts sign up, add their exact email addresses to the whitelist. Replace the examples with the real founder emails and run: 

```sql
insert into private.admin_whitelist (email, role) values
  ('founder1@your-domain.com', 'super_admin'),
  ('founder2@your-domain.com', 'super_admin');
```

4. In Supabase **Project Settings → API**, copy the Project URL and the publishable key (or legacy anon key). Put them in `url` and `publishableKey` in `js/supabase-config.js`. These are browser-safe keys only when RLS is correctly enabled. **Never put a service-role or secret key in frontend files.**
5. Create a Cloudflare account and add a **Turnstile** widget at https://dash.cloudflare.com/?to=/:account/turnstile. Add your local hostname (`localhost` / `127.0.0.1`) and eventual production hostname to the widget's allowed hostnames. Copy the **Sitekey** into `turnstileSiteKey` in `js/supabase-config.js`.
6. In Supabase **Authentication → Bot and Abuse Protection**, enable CAPTCHA protection, choose **Cloudflare Turnstile**, and paste the Turnstile **Secret key** into Supabase's CAPTCHA settings. The secret key belongs only in Supabase—not in your website files. Supabase validates the token on its auth endpoint.
7. In Supabase **Authentication → URL Configuration**, set your local development URL (for example `http://127.0.0.1:5500`) and add your eventual production domain to the allowed redirect URLs. Keep email confirmation enabled for production.
8. In Supabase **Authentication → Rate Limits**, review the default limits and tune them for your launch. Supabase already rate-limits auth endpoints; do not remove those limits. The built-in email sender is limited, so configure custom SMTP before public launch if you need reliable verification emails.
9. Serve the folder using VS Code Live Server and open `auth.html`. Register using one of the whitelisted founder emails; that account receives `super_admin` automatically. Other emails always receive `member`. The form requires a fresh Turnstile token for each signup or login attempt.

### Add an administrator later

A super admin should add an email using Supabase SQL Editor, not from the public registration form. For an account that has not registered yet:

```sql
insert into private.admin_whitelist (email, role)
values ('new-admin@example.com', 'admin');
```

For an account that already exists, add it to the whitelist and synchronize its role in the same controlled SQL session:

```sql
insert into private.admin_whitelist (email, role)
values ('existing-admin@example.com', 'admin')
on conflict (email) do update set role = excluded.role;

insert into public.user_roles (user_id, role)
select u.id, w.role
from auth.users u
join private.admin_whitelist w on w.email = lower(btrim(u.email))
where w.email = lower(btrim('existing-admin@example.com'))
on conflict (user_id) do update set role = excluded.role;
```

To revoke an admin, delete their whitelist row and change their existing role back to `member` in `public.user_roles` using their user ID from Authentication → Users. Removing the whitelist entry alone does not revoke an already assigned role.

### Current scope / next build step

This is the secure database foundation plus working signup/sign-in UI. The member dashboard, application submission form, admin review dashboard, and admin whitelist management interface are not built yet. They should be added next and must use the existing RLS policies. The homepage now explicitly presents both men's and women's competitive divisions. The whitelist is deliberately managed in the Supabase SQL Editor in this first phase; do not expose a client-side insert/update path for it.

### Human verification and abuse protection

- The authentication page renders Cloudflare Turnstile. A token is required for both sign-up and password sign-in, and is passed to Supabase Auth as `captchaToken`.
- Enable Turnstile in Supabase Auth settings and configure its secret there. Supabase performs server-side CAPTCHA verification; the website contains only the public sitekey.
- Turnstile tokens are short-lived and single-use. The page resets the widget after every attempt, so users must complete a fresh check.
- Keep Supabase Auth rate limits enabled. CAPTCHA does not replace rate limiting, email confirmation, RLS, monitoring, or admin MFA.
- For production, consider enabling MFA for administrators and setting up custom SMTP so email confirmation is reliable.

### Security notes

- The frontend uses only the Supabase publishable/anon key.
- Never expose `service_role`, secret keys, database passwords, or access tokens in HTML/JS.
- Keep the `private` schema out of the Supabase Data API's exposed schemas.
- Do not add client-side insert/update/delete grants on `user_roles` or `private.admin_whitelist`.
- Run and verify RLS tests before production launch.


## Google sign-in

The member access page includes **Continue with Google** using Supabase Auth. Google OAuth uses the same server-side signup trigger as email registration: new users receive the `member` role by default, while only emails already present in `private.admin_whitelist` receive an administrator role. The browser never assigns roles.

Before using Google sign-in, configure the provider once:

1. In Google Cloud Console, create an OAuth 2.0 **Web application** client. Add the Supabase Auth callback URL shown in **Supabase → Authentication → Providers → Google** as an authorized redirect URI. Copy the Google client ID and client secret into the Supabase Google provider settings (never into this repository).
2. In **Supabase → Authentication → URL Configuration**, add `https://punix.pages.dev/**` to the allowed redirect URLs and set `https://punix.pages.dev` as the Site URL. Keep your local development URL too if needed.
3. Enable the Google provider in Supabase. Google sign-in is then available from `https://punix.pages.dev/auth.html`.
4. To make a Google account an admin, add its exact Google email to `private.admin_whitelist` before its first sign-in. For an account that already exists, synchronize its role using the controlled SQL example in the auth section above.

Google's own account authentication and Supabase OAuth protections apply to this provider flow. Email/password registration and login continue to use Cloudflare Turnstile.
