## Audit findings

The GitHub App is installed in GitHub, but Hermes has **zero linked installation rows** in the database. That means GitHub knows the App is installed, while Hermes does not yet know which installation belongs to your logged-in account.

The current install button starts the GitHub App install flow correctly, but when the App is already installed GitHub sends you to the GitHub App/settings surface instead of giving Hermes a reliable `installation_id` handoff. The existing fallback, **Re-sync from GitHub**, is the right idea but server logs show it currently fails with `Invalid character`, which points to private-key/JWT parsing or key formatting during App-level API calls.

Also confirmed:
- `github_installations`: 0 rows
- `repositories`: 0 rows
- `loops`: 0 rows
- `activity_events`: 0 rows
- Topbar “Connected” is still static UI, not real status
- Activity realtime is coded client-side, but the database table is not enabled for realtime publication
- Settings is still mock UI

## Phase 2 implementation plan

### 1. Make installed-but-unlinked GitHub Apps recoverable

Replace the confusing “Install” dead-end with a recovery-first flow:

- Keep the GitHub install button, but rename/copy it so users understand it may open GitHub if already installed.
- Add a primary **Find installed GitHub App** action that calls the App installations API and lists installations Hermes can see.
- If the App is already installed for your GitHub user/org, show **Link this installation**.
- If App-level listing fails, show a precise diagnostic instead of a blank or generic error.

### 2. Fix GitHub App private-key handling

Harden the server-side GitHub App JWT signer so it accepts common private-key secret formats:

- Raw PEM with actual newlines
- PEM pasted with escaped `\n`
- PEM wrapped in quotes
- Base64-ish whitespace variants

Then surface exact failures:
- Missing `GITHUB_APP_ID`
- Missing `GITHUB_APP_PRIVATE_KEY`
- Invalid private key format
- GitHub App ID/private key mismatch
- GitHub API permission/revoked installation failure

This should address the `Invalid character` error from the App installation listing path.

### 3. Add a real live connection status indicator

Replace the hardcoded Topbar “Connected” pill with a live status component:

- Green: installation linked, token mint works, repos readable
- Yellow: installation linked but token/repo read has an error
- Red: no linked installation or app cannot authenticate
- Gray: checking/unknown

The status will reuse/extend `checkInstallationHealth`, auto-refresh periodically, and link to `/dashboard/repos` for remediation.

### 4. Improve repository page diagnostics

On `/dashboard/repos`:

- Show the health card even when not connected, so it explains why there are no repos.
- Show `listInstallationRepos` errors explicitly, not just an empty repo state.
- Make “Re-sync from GitHub” more prominent when the database has no installation but GitHub likely does.
- After a successful claim, immediately refresh installation health, repos, and connected repo counts.

### 5. Enable real-time activity properly

Add the database publication needed for realtime updates:

- Enable realtime for `activity_events`
- Keep RLS user-scoped, so users only receive their own events

The existing `ActivityLog` subscription will then work as intended.

### 6. Replace mock Settings with working controls/diagnostics

Make `/dashboard/settings` a real operational page:

- GitHub App status card with the same live health checks
- Hermes API status card that tests whether `HERMES_API_URL` and `HERMES_API_KEY` are configured and reachable
- Background mode status that honestly says whether scheduling is implemented yet
- Direct links/actions back to Repositories and Activity for troubleshooting

No fake “Billing manage” or “Enabled” badges unless backed by real data.

### 7. Validation

After implementation:

- Check database rows again after linking
- Check server logs for GitHub signer/listing errors
- Verify the Topbar status changes based on health result
- Verify the repo page can list GitHub installations and link one
- Verify activity realtime table is published

## Technical changes

Expected files/code areas:

- `src/lib/github-app.server.ts` — normalize PEM/private key parsing and clearer GitHub App API errors
- `src/lib/github-app.functions.ts` — add/extend diagnostics, installation discovery, health status, settings checks
- `src/components/forge/InstallationHealth.tsx` — support disconnected diagnostics and richer status messages
- `src/components/forge/Topbar.tsx` — replace static “Connected” with live status
- `src/routes/dashboard.repos.tsx` — make re-sync/recovery the main path for already-installed apps
- `src/routes/dashboard.settings.tsx` — replace mock settings with real health/config cards
- Database migration — enable realtime publication for `activity_events`

## What you should do after this ships

Open the published dashboard, not the preview iframe, then:

1. Go to **Repositories**
2. Click **Find installed GitHub App / Re-sync from GitHub**
3. Link the `skakig` installation shown by GitHub
4. Confirm the Topbar dot turns green and repositories appear

The GitHub App setup URL you showed is correct: `https://hermes-forge-git-ai.lovable.app/auth/github/callback`. The missing piece is Hermes linking the already-installed GitHub installation to your app account and proving it can mint/read with the App credentials.