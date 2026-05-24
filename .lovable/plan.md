# Audit results

## What's actually happening

1. **"Sign in" works correctly.** The button goes to `/login`, you sign in, and you're redirected to `/dashboard/repos` — which is the Forge's **Repositories** page (not your GitHub repo). The title at the top says "Repositories" and it lists repos from your GitHub App. It's easy to misread as "your GitHub repo," but it's the Hermes dashboard.

2. **The real bug: the install never gets recorded.** I checked the `github_installations` table — it's empty, even though GitHub says "Installed". Here's why:

   - Our app sends you to `https://github.com/apps/hermes-forge/installations/new?state=…`
   - You pick repos, GitHub redirects you to the **Setup URL** configured on the GitHub App: `https://hermes-forge-git-ai.lovable.app/auth/github/callback?installation_id=135291302&setup_action=install`
   - That route (`src/routes/auth.github.callback.ts`) is the **OAuth code handler** — it expects `?code=…&state=…`. Seeing no `code`, it bails with `?error=missing_code` and never writes to the database.
   - Result: dashboard keeps showing "Install GitHub App" instead of your repos, because `getGithubConnection` returns `null`.

3. **Bonus problem:** GitHub did NOT forward our signed `state` on the install redirect (the URL you pasted has no `state` param). So even the existing `/api/github/install/callback` route would have rejected it with `bad_state`. We need to identify the user from their logged-in session, not from `state`.

# The fix

Make `/auth/github/callback` handle **both** flows, and identify the user from their app session instead of relying on `state` for App installs.

## Changes

1. **`src/routes/auth.github.callback.ts`** — branch on params:
   - If `installation_id` is present → redirect to `/dashboard/repos?pending_install={id}` (don't try to write to DB from the server route, since we have no session token there).
   - If `code` is present → keep the existing OAuth code-exchange path as a fallback.
   - If neither → redirect with `?error=missing_callback_params`.

2. **`src/lib/github-app.functions.ts`** — add `recordInstallation`:
   - `createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])`
   - Input: `{ installation_id: number }`
   - Calls `getInstallationToken(installation_id)` + probes `/installation/repositories` to pull `owner.login` / `owner.type` for the label (same logic as the old install callback).
   - Upserts into `github_installations` keyed on `(user_id, installation_id)`.
   - Returns `{ ok: true, account_login }`.

3. **`src/routes/dashboard.repos.tsx`** — handle `?pending_install`:
   - Extend `validateSearch` to read `pending_install`.
   - On mount, if present, call `recordInstallation` via `useServerFn`, then `navigate({ to: "/dashboard/repos", search: {}, replace: true })` and invalidate the `["github"]` query so the repo list loads.
   - Toast success / error.

4. **Delete `src/routes/api.github.install.callback.ts`** — superseded; keeps routing surface clean.

## Why this works

- The user is already logged into the app when GitHub redirects them back, so `requireSupabaseAuth` on `recordInstallation` gets the right `userId` from their Supabase session — no signed `state` needed.
- GitHub's Setup URL on the App stays at `/auth/github/callback` (matches what's configured today; no GitHub-side change required).
- Future re-installs / settings changes that hit the same URL just re-upsert the row.

## Technical notes

- `getInstallationToken` already works (`src/lib/github-app.server.ts`), so the probe for `account_login` is reused as-is.
- No DB migration needed — `github_installations` already exists with the right shape.
- No new secrets needed.
- After this lands: install the app once more from the dashboard's "Install" button (or just visit `https://hermes-forge-git-ai.lovable.app/auth/github/callback?installation_id=135291302&setup_action=install` while logged in) — the row will be written and your repos will appear.
