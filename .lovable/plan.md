## Plan

1. **Correct the GitHub authorization URL**
   - The URL you pasted uses a `client_id` starting with `Ov23…`, which is a GitHub App-style client ID, not a classic OAuth App client ID.
   - Update the app so it no longer starts a broken classic OAuth flow with GitHub App credentials.

2. **Use the proper GitHub App install flow for “Connect repo”**
   - Change the Connect repo / Install Hermes button to send users to GitHub’s app installation URL instead of `/login/oauth/authorize` when the configured credential is a GitHub App.
   - Keep the existing OAuth callback route intact for classic OAuth App credentials, so the app still supports that path if the credentials are swapped later.

3. **Add a clear configuration guard**
   - If the app cannot build a valid GitHub install URL because the GitHub App slug/name is missing, show a visible error instead of redirecting to a blank/broken GitHub page.
   - Request the missing backend secret only if needed, using a secure secret field.

4. **Improve diagnostics**
   - Add focused server logging for which GitHub flow is selected: OAuth App vs GitHub App install.
   - Keep user-facing errors on `/dashboard/repos` so future failures land as readable messages instead of looking broken.

## Technical details

- Edit `src/lib/github-oauth.functions.ts` to detect `GITHUB_OAUTH_CLIENT_ID` prefixes like `Ov23` and return a GitHub App installation URL when appropriate.
- Add support for a `GITHUB_APP_SLUG` secret/env var for URLs like `https://github.com/apps/<slug>/installations/new`.
- Edit `src/routes/dashboard.repos.tsx` only as needed to surface the new “missing GitHub App slug” error cleanly.
- No database changes are needed.