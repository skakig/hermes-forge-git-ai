# Wire up real GitHub App + Phase 1+2+3

## Values
- Slug: `hermes-forge` → install URL `https://github.com/apps/hermes-forge/installations/new`
- App ID: `3844871`
- Client ID: `Iv23liQAecxBFtH8Vf14`

## Secrets I'll request (secure form)
**New:**
- `GITHUB_APP_PRIVATE_KEY` — full `.pem` contents (including BEGIN/END lines), from https://github.com/settings/apps/hermes-forge → Private keys → Generate
- `GITHUB_APP_ID` — `3844871`

**Update existing:**
- `GITHUB_OAUTH_CLIENT_ID` → `Iv23liQAecxBFtH8Vf14`
- `GITHUB_OAUTH_CLIENT_SECRET` → generate new on same App settings page
- `GITHUB_APP_SLUG` → `hermes-forge`

## Verify in App settings before pasting
- Callback URL: `https://hermes-forge-git-ai.lovable.app/api/github/oauth/callback`
- Setup URL: `https://hermes-forge-git-ai.lovable.app/api/github/install/callback` + "Redirect on update" ✓
- Webhook: OFF
- Permissions: Contents R/W, Pull requests R/W, Metadata R, Issues R
- Installable on: Any account

## Build steps

**DB migration**
- New `github_installations` table: `user_id`, `installation_id` (bigint), `account_login`, `account_type`, timestamps. RLS = own rows.

**Phase 1 — Real GitHub**
- Server route `/api/github/install/callback`: capture `installation_id`, upsert row, redirect to `/dashboard/repos`
- `RepoCard` "Connect": link to `https://github.com/apps/hermes-forge/installations/new?state=<user_id>`
- Server fn `listInstallationRepos`: sign JWT (`GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY`, RS256), exchange for installation token, fetch `/installation/repositories`
- `dashboard.repos.tsx`: render live repos; "Add" inserts into `repositories`
- Hide install card when installation exists

**Phase 2 — Real Hermes loop**
- Server fn `startHermesLoop`: insert `loops` row, POST to `HERMES_API_URL` with installation token + repo + goals
- Server fn `pollLoopStatus`: update phase/PR, insert `activity_events`
- `LoopControl`: replace fake animation with TanStack Query polling

**Phase 3 — Dashboard from real data**
- Stats: counts from `loops`, `repositories`, `activity_events`
- `ActivityLog`: query + realtime subscribe to `activity_events`
- `PRList`: `loops` where `pr_url is not null`
- `GoalsPanel`: CRUD on `goals`

## Technical notes
- JWT signing uses Web Crypto `crypto.subtle.importKey`/`sign` (Worker-compatible, no Node `jsonwebtoken` package needed)
- All Supabase writes use `requireSupabaseAuth` middleware; installation callback uses `supabaseAdmin` because GitHub redirect has no session
- `state` param carries `user_id` through install round-trip
