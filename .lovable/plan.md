## Add GitHub OAuth + Hermes API secrets, then wire the connect flow

### Step 1 — Request secrets
Prompt you to securely enter:
- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `HERMES_API_URL`
- `HERMES_API_KEY`

### Step 2 — GitHub OAuth callback route
Create `src/routes/api/auth/github/callback.ts` (server route at `/auth/github/callback`) that:
- Reads `code` + `state` from the request
- Exchanges `code` for an access token at `https://github.com/login/oauth/access_token`
- Fetches the GitHub username via `https://api.github.com/user`
- Upserts `(user_id, access_token, github_username, scope)` into `user_github_credentials` via `supabaseAdmin`
- Redirects back to `/dashboard/repos?connected=1`

### Step 3 — "Connect GitHub" initiator
- Add a server fn `startGithubOAuth` (protected by `requireSupabaseAuth`) that returns the GitHub authorize URL with `client_id`, `redirect_uri=https://hermes-forge-git-ai.lovable.app/auth/github/callback`, `scope=repo read:user`, and a signed `state` (containing the user id)
- Wire the existing "Connect GitHub" button on `/dashboard/repos` (and Topbar if present) to call it and `window.location.assign` the result

### Step 4 — Hermes API adapter
Create `src/lib/hermes.server.ts` with a thin fetch wrapper that reads `HERMES_API_URL` + `HERMES_API_KEY` from `process.env` inside handlers (start-loop, get-status). Not wired to UI in this step — just the typed client ready for the loop control to call.

### Technical notes
- Callback URL to register in GitHub: `https://hermes-forge-git-ai.lovable.app/auth/github/callback`
- Token stays server-side only (`user_github_credentials`, no RLS policies → admin-only access)
- `state` is HMAC-signed with `SUPABASE_SERVICE_ROLE_KEY` to bind it to the user and prevent CSRF
