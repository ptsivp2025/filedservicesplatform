# Field Service Platform — Manual Deployment Guide

This is the standalone how-to for getting this repository live: a Supabase project with the
core schema applied, and a Vercel project deployed from GitHub with the right environment
variables. Everything here is done manually in each service's own dashboard — no automated
Claude/MCP setup is used, by request.

The three services and how they relate:

| Service | Holds | Updates when |
|---|---|---|
| **GitHub** | Source code (this repo) | Every `git push` |
| **Vercel** | Build/deploy of the code from GitHub | Automatically on every push to the branch Vercel is watching (Project Settings → Git → Production Branch) |
| **Supabase** | Database schema + data | **Never automatically from a push.** Migration SQL must be run manually in the Supabase SQL Editor |

Pushing code to GitHub does **not** touch the database, and creating/updating the database does
**not** touch Vercel. Each step below is separate and must be done in order.

---

## 1. Supabase — create the project and apply the schema

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → **New Project**.
   - Name: anything (e.g. `field-service-platform`).
   - Region: closer to your users = lower latency (e.g. Singapore/`ap-southeast-1` for Indonesia).
   - Set a database password and save it somewhere — not otherwise needed for this app, but
     Supabase requires it.
2. Wait for the project to finish provisioning (a minute or two).
3. Open **SQL Editor → New query**. Run these files from `supabase/migrations/` in this repo,
   **one at a time, in this exact numeric order** (each one depends on tables/functions created
   by the ones before it):
   1. `supabase/migrations/001_core_schema.sql` — tables: `users`, `user_credentials`,
      `user_sessions`, `login_attempts`, `password_reset_otps`, `audit_trail`,
      `notifications`, `app_settings`, `rahasia_integrasi`.
   2. `supabase/migrations/002_core_functions.sql` — RLS helper functions
      (`jwt_claim`/`jwt_user_id`/`lingkup_semua`/etc.) and the trigger that freezes
      privileged `users` columns against direct client edits.
   3. `supabase/migrations/003_core_rls.sql` — enables Row Level Security and creates the
      policies for the tables above.
   4. `supabase/migrations/004_field_service_schema.sql` — the 12 Field Service (`fs_*`) tables:
      `fs_projects`, `fs_areas`, `fs_locations`, `fs_execution_points`, `fs_pic_assignments`,
      `fs_recurring_schedules`, `fs_execution_instances`, `fs_work_sessions`, `fs_gps_events`,
      `fs_evidence`, `fs_reviews`, `fs_project_settings`.
   5. `supabase/migrations/005_field_service_functions.sql` — Field Service enforcement
      functions, including the `SECURITY DEFINER` functions `fs_check_in`/`fs_check_out`/
      `fs_status_transition` that PIC check-in/check-out and status changes go through.
   6. `supabase/migrations/006_field_service_rls.sql` — enables Row Level Security and creates
      the policies for all `fs_*` tables above (must run after 005, since these policies call
      its functions).
   7. `supabase/migrations/007_field_service_technician.sql` — Technician check-in/check-out
      support: `fs_ensure_today_instance()` (materializes "today's" execution instance on demand
      from a Technician's active PIC assignment), the private `fs-evidence` storage bucket +
      RLS, and a `notes` column on `fs_work_sessions` for check-out notes.
   8. `supabase/migrations/008_app_releases.sql` — the `app_releases` table + public
      `app-releases` storage bucket used by Admin Panel → **App Rilis** (Android APK version
      history, see §6 below). Independent of the Field Service schema — safe to run any time
      after 001-003.
   9. `supabase/migrations/009_merek_storage.sql` — the `merek-files` storage bucket used by
      Admin Panel → **Dashboard Setting** for logo/background uploads. Without this, every
      upload there fails with "Tidak ada bucket penyimpanan yang bisa dipakai" — the bucket
      this feature has always depended on was never created by any earlier migration.
      Independent of the Field Service schema — safe to run any time after 001-003.
   10. `supabase/migrations/010_execution_point_floor.sql` — adds an optional `floor` column to
       `fs_execution_points`, so a Location with TVs spread across several floors ("Lantai 3",
       "GF", "Rooftop") can label them consistently instead of folding that into the free-text
       name.
   - Paste the whole file content into one query and click **Run** each time. All ten should
     complete with no errors.
4. Optional but recommended: **Advisors → Security** in the Supabase dashboard should show only
   informational "RLS enabled, no policy" notices for `user_credentials`, `user_sessions`,
   `login_attempts`, `password_reset_otps`, `rahasia_integrasi` — that's intentional (see the
   comment at the bottom of `003_core_rls.sql`), not a problem to fix. Under **Advisors →
   Performance** you may also see a warning that `fs_check_in`, `fs_check_out`,
   `fs_status_transition`, `fs_is_assigned`, `fs_effective_gps_radius`, and
   `fs_effective_evidence_min_count` are `SECURITY DEFINER` functions callable by `anon`/
   `authenticated` — that's also intentional and explained in the header comment of
   `006_field_service_rls.sql`.
5. Create your first admin account (the `users` table starts empty, and the app can't create an
   admin from the UI since registration always creates a `guest`/pending account). In **SQL
   Editor**, run (replace the bracketed values):

   ```sql
   -- 1) Create the user row directly as admin (bypasses the client-side guard trigger
   --    because this runs as the Postgres owner, not as anon/authenticated). This is the
   --    "Admin" role in Account Settings — full access to both the core platform and
   --    Field Service (fs_is_provider_admin() reads role='admin' OR fs_role='PROVIDER_ADMIN').
   insert into public.users (username, full_name, role, access_level, fs_role)
   values ('admin@example.com', 'Nama Anda', 'admin', 'full', 'PROVIDER_ADMIN')
   returning id;
   ```

   Copy the returned `id`, then set its password (bcrypt hash — generate one at
   <https://bcrypt-generator.com/> with 10-12 rounds, or run `node -e "console.log(require('bcryptjs').hashSync('YourPassword123', 10))"`
   locally if you have Node + `bcryptjs` installed):

   ```sql
   insert into public.user_credentials (user_id, password_hash)
   values ('<the id from above>', '<the bcrypt hash>');
   ```

   You can now log in with `admin@example.com` / the password you hashed, once the app is
   deployed (step 3 below).

   **The other three roles** (User, Technician, View) don't need SQL — once logged in as
   Admin, create them from **Admin Panel → Account Settings → Tambah Akun**, picking the role
   from the four-way picker there. In particular, you need at least one **Technician** account
   before "Assign PIC" in Field Service → Assign PIC will have anyone to assign — that dropdown
   only lists Technician accounts (falls back to showing everyone if none exist yet).
6. Collect these four values from **Settings → API** (you'll need them for Vercel):
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **API Keys → anon / public** (legacy JWT-based key) → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **API Keys → service_role** (secret — never expose this to the browser) →
     `SUPABASE_SERVICE_ROLE_KEY`
   - **JWT Settings → Legacy JWT Secret** → `SUPABASE_JWT_SECRET`

---

## 2. GitHub — push the code to your own repo

This code is handed to you as a ZIP export, not pushed by Claude directly — you control which
GitHub account and repo it ends up in. From the extracted folder:

```
git init
git add .
git commit -m "Field Service Platform"
git branch -M main
git remote add origin https://github.com/<your-account>/<your-repo>.git
git push -u origin main
```

(If the folder already has a `.git` history from a previous push, skip `git init` and just
commit + push as usual.) Whichever branch you push here is the one you'll point Vercel's
**Production Branch** at in step 3.3 below.

---

## 3. Vercel — import the repo and deploy

1. In your Vercel account, **Add New... → Project**.
2. Select the repo you just pushed to in step 2. If it's not listed, click **Adjust GitHub App
   Permissions** on that screen → in GitHub, find the **Vercel** app under
   Settings → Applications → Installed GitHub Apps → **Configure** → add this repository →
   **Save** → go back to Vercel, it will now appear.
3. Confirm **Project Settings → Git → Production Branch** matches the branch you pushed
   (e.g. `main`) — a mismatch here is the most common reason a deploy shows old code.
4. In **Project Settings → Environment Variables**, add:

   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | from Supabase step 1.6 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Supabase step 1.6 |
   | `SUPABASE_SERVICE_ROLE_KEY` | from Supabase step 1.6 |
   | `SUPABASE_JWT_SECRET` | from Supabase step 1.6 |
   | `CRON_SECRET` | any random string you make up — Vercel Cron sends it automatically as `Authorization: Bearer <value>` to `/api/cron/materialize-instances` (see `vercel.json`), which runs daily at 00:00 UTC to pre-create today's execution instances for every active PIC assignment |
   | `APK_RELEASE_SECRET` | optional — only needed if you set up the Android APK pipeline in §6, must match the GitHub secret of the same name |

5. Deploy (or redeploy, if the first build already ran against `main` before you changed the
   branch).
6. Once live, open `https://<your-app>.vercel.app/api/auth/db-token-check` after logging in as
   the admin account from step 1.5 — this endpoint (admin-only) verifies
   `SUPABASE_JWT_SECRET` is wired correctly end-to-end (it issues a token and checks that
   PostgREST actually accepts its signature). `siap: true` in the response means the auth/RLS
   pipeline is fully connected.

---

## 4. What "live" gets you right now

At this point you have: login, session management, four account roles (Admin/User/Technician/
View, set from Admin Panel → Account Settings), generic notifications, **Location Master +
Assign PIC** (Field Service menu, Admin role) — create projects, areas, locations (GPS +
radius), execution points, assign Technician accounts as PIC — and **Technician GPS
check-in/check-out** (Tugas Saya menu, Technician role): a "Tugas Hari Ini" task list, GPS +
photo evidence check-in, and check-out with notes, validated server-side against the assigned
location's radius.

Not built yet: recurring schedule generation (a stand-in, `fs_ensure_today_instance()`,
materializes today's task on demand instead) and client review/verification — tracked in
`docs/field-service-architecture.md` §17.

## 6. Android APK for Technicians (Capacitor + GitHub Actions)

The web app is wrapped as a native Android app with [Capacitor](https://capacitorjs.com/) — the
APK is a thin WebView pointed at your **live Vercel URL** (`capacitor.config.ts` → `server.url`),
not a separate offline build. That's deliberate: this app has server-side API routes, cookies,
and sessions that a static export would break, and check-in/check-out already needs internet to
reach Supabase anyway. Every code change you deploy to Vercel reaches the APK immediately, no
rebuild needed — you only rebuild the APK when native config changes (permissions, app icon,
signing).

**Why this can't be built inside a Claude sandbox session:** compiling an Android app needs the
Android SDK, downloaded from `dl.google.com` — that host is blocked by the sandbox's network
policy. GitHub Actions runners have full internet access, so the APK is built there instead,
triggered manually from your repo's **Actions** tab.

### 6.1 One-time setup

1. **Edit `capacitor.config.ts`**: replace `https://GANTI-DENGAN-DOMAIN-VERCEL-KAMU.vercel.app`
   with your actual Vercel production URL, then commit.
2. **(Recommended) Generate a release signing key** — without this, GitHub Actions falls back to
   an Android **debug** key (fine for testing/demo, but every rebuild without it may prompt
   "app not installed" over an older copy, and it can't be published to Play Store later). From
   a machine with a JDK installed:
   ```bash
   keytool -genkeypair -v -keystore release.keystore -alias fieldservice \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
   Answer the prompts (name/org/etc. — anything), pick a strong keystore password and key
   password, then keep `release.keystore` somewhere safe **outside the repo** — anyone with this
   file can sign an APK that claims to be your app.
3. In your GitHub repo → **Settings → Secrets and variables → Actions**, add:
   | Secret | Value |
   |---|---|
   | `APP_URL` | Your Vercel production URL (e.g. `https://field-service-platform.vercel.app`) |
   | `APK_RELEASE_SECRET` | Any long random string you make up — also set as `APK_RELEASE_SECRET` in Vercel's env vars (step 3.4), must match exactly |
   | `ANDROID_KEYSTORE_BASE64` | `base64 -i release.keystore \| pbcopy` (or equivalent) — optional, skip to build unsigned/debug |
   | `ANDROID_KEYSTORE_PASSWORD` | The keystore password from step 2 |
   | `ANDROID_KEY_ALIAS` | `fieldservice` (or whatever alias you used) |
   | `ANDROID_KEY_PASSWORD` | The key password from step 2 |
4. Add `APK_RELEASE_SECRET` to Vercel too (same value as the GitHub secret) and redeploy —
   without it, `/api/app-releases` only accepts uploads from a logged-in Admin session, not from
   CI.

### 6.2 Building a release

1. Repo → **Actions** tab → **Build Android APK** → **Run workflow**.
2. Fill in **version_name** (e.g. `1.0.0`) and an optional changelog, run it.
3. The workflow builds the APK, uploads it as a workflow artifact (fallback if step 4 below is
   skipped), and — if `APP_URL`/`APK_RELEASE_SECRET` are set — POSTs it straight to
   `/api/app-releases`.
4. Open **Admin Panel → App Rilis** in the app: the new version appears with a download link.
   Share that link (or the file) with Technicians to install — they'll need to enable "install
   from unknown sources" once, since this isn't distributed via Play Store.

Manual/local uploads (e.g. you built the APK yourself from Android Studio) work the same way:
**Admin Panel → App Rilis → Upload Rilis Baru**, no GitHub Actions required.

## 7. Common issues

- **Login fails with no error / redirects to `/dashboard` immediately**: check
  `middleware.ts` — it only allows unauthenticated access to a fixed list of paths; if you're
  hitting something else, that's expected (not a bug).
- **"supabaseUrl is required" at build time**: an env var is missing. All five required ones in
  step 3.4 (everything except `APK_RELEASE_SECRET`, which is optional) must be set for the same
  environment (Production/Preview/Development) you're building for.
- **RLS silently returns empty results**: usually means `SUPABASE_JWT_SECRET` doesn't match
  between what's in Vercel and what Supabase actually has — re-check step 1.6/3.4 match exactly,
  then use the `/api/auth/db-token-check` endpoint from step 3.6 to confirm.
- **Build fails with "Module has no exported member" or "Cannot find module" for a file that
  shouldn't exist anymore** (e.g. `modal-brand-pic.tsx`, `modal-kelompok.tsx`): this means an
  older ZIP export was extracted on top of the folder without clearing it first — extracting a
  ZIP only adds/overwrites files, it never deletes ones a newer export removed. Fix: delete
  everything in the project folder *except* `node_modules` and `.env.local`, then re-extract the
  latest ZIP into the now-empty folder.
