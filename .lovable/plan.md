## Audit findings

1. **The current GitHub App URL is definitely invalid**
   - `https://github.com/apps/hermes-forge-git-ai` returns 404.
   - So `https://github.com/apps/hermes-forge-git-ai/installations/new` will also always 404.
   - Making the repository public does not fix this; the broken URL is for the GitHub App identity/slug, not for the repo.

2. **The app is mixing two different GitHub auth models**
   - The current secret `GITHUB_OAUTH_CLIENT_ID` looks like a GitHub App OAuth client ID (`Ov23...`).
   - The code detects that and redirects to the GitHub App installation flow.
   - But the callback handler only supports classic OAuth callback parameters: `code` + `state`.
   - GitHub App installation callbacks usually return `installation_id`, `setup_action`, and `state`, not an OAuth `code`.
   - Result: even if the App URL were fixed, the current callback would still not complete a proper GitHub App installation flow.

3. **Repo listing currently depends on a user OAuth token, not a GitHub App installation token**
   - `listGithubRepos` reads `user_github_credentials.access_token` and calls `GET /user/repos`.
   - That can work for classic OAuth, but it is not the correct model for a GitHub App install.
   - For a GitHub App, the app needs an installation id, then it creates short-lived installation access tokens to list and write to selected repositories.

4. **The dashboard is still partially demo/mock behavior**
   - `/dashboard/repos` was updated to list real repos once a user token exists.
   - But the home dashboard still shows hardcoded repo cards, stats, PRs, activity, goals, and loop simulation.
   - `LoopControl` only simulates phases in the browser; it does not call the Hermes agent.
   - `src/lib/hermes.server.ts` has a `startLoop` helper, but nothing currently wires repo selection + credentials + goals into a real server function.

5. **The agent cannot reliably operate yet**
   - The Hermes API helper expects `repoFullName`, `githubToken`, `goals`, and `branch`.
   - There is no safe end-to-end flow that selects a repository, stores it, loads active goals, gets the correct GitHub credential/token, calls Hermes, stores a loop row, and updates activity/PR state.

## Recommended direction

Use **one GitHub integration model**, not both. For a professional “install app, select repos, agent opens PRs” product, use the **GitHub App installation model**.

This gives better UX and security:
- Users install the App on selected repos.
- Access can be scoped per repo/org.
- Tokens are short-lived and generated server-side.
- The agent can read/write branches and open PRs without storing broad long-lived user OAuth tokens.

## Plan

### 1. Fix GitHub App configuration and make failures explicit

- Keep `Connect repo` as a GitHub App install flow.
- Add a server-side `getGithubConnectionStatus` function that checks whether required GitHub App secrets/config are present:
  - app slug
  - app id
  - private key
  - client id/client secret only if OAuth identity is still needed
- On `/dashboard/repos`, show a professional setup/error state if the GitHub App slug is invalid or missing, instead of sending users to a GitHub 404.
- Keep the current published-domain callback warning, but make the messaging specific to GitHub App installation.

Important external setup that must be true in GitHub:
- The GitHub App must exist.
- The GitHub App’s public slug must match `https://github.com/apps/<slug>`.
- If the app is private, the installing GitHub account must own or have access to it.
- The GitHub App Setup URL should be:
  - `https://hermes-forge-git-ai.lovable.app/auth/github/callback`

### 2. Add GitHub App installation persistence

Create/adjust backend tables for GitHub App installations, separate from user OAuth credentials:

```text
github_installations
- id
- user_id
- installation_id
- account_login
- account_type
- target_type
- permissions jsonb
- repository_selection
- created_at
- updated_at

repositories
- user_id
- github_id
- installation_id
- owner
- name
- full_name
- private
- default_branch
- status
```

RLS/security:
- Users can read their own repositories and installation metadata.
- Writes that sync GitHub data happen only server-side.
- Private keys/tokens never reach the browser.

### 3. Rewrite the GitHub callback to support App installation callbacks

Update `/auth/github/callback` so it handles both cases safely:

- If URL has `installation_id` + `setup_action`:
  - verify signed `state`
  - store/update the installation record for the authenticated user from the state
  - generate an installation token server-side
  - fetch installed repositories from GitHub
  - upsert repositories into the database
  - redirect to `/dashboard/repos?connected=1`

- If URL has `code`:
  - either keep current OAuth support as a legacy fallback, or remove it once the App flow is confirmed.

### 4. Generate installation access tokens server-side

Add a server-only GitHub App helper that:

- signs a GitHub App JWT using the App ID/private key
- exchanges it for an installation access token via GitHub’s API
- uses that token to:
  - list installation repositories
  - read repo metadata
  - later create branches/commits/PRs or hand the short-lived token to the Hermes agent

### 5. Wire repository cards to real installed repositories

Update `/dashboard/repos` so the repo grid comes from the database/GitHub App install, not OAuth `/user/repos`:

- Before connection: show `Connect repo`.
- During setup errors: show actionable configuration status.
- After installation: show installed repos only.
- Add refresh/sync button to re-fetch installation repos.
- Repo cards should be selectable and should store/select the active repo for the loop workflow.

### 6. Wire the agent loop end-to-end

Add a protected server function like `startHermesLoop`:

- input: selected repository id/full_name + goals + optional branch
- validates the repo belongs to the current user
- finds the matching GitHub installation
- generates a short-lived installation token
- calls Hermes API with:
  - `repoFullName`
  - `githubToken`
  - `goals`
  - `branch`
- stores a `loops` row with `hermes_run_id`
- creates initial `activity_events`
- returns the loop status to the UI

Then update `LoopControl` to call this real function instead of running a fake timer.

### 7. Replace dashboard mocks with real data

- Dashboard stats should count actual connected repos, loops, open/finished PRs, and recent events.
- `ActivityLog` should read `activity_events`.
- `PRList` should read stored loop/PR data, or query GitHub PRs for installed repos.
- `GoalsPanel` should persist user goals instead of local state only.

### 8. Add professional UX and recovery states

- Clear “Connected”, “Needs reconnect”, “No repos selected”, “GitHub App misconfigured”, and “Agent failed to start” states.
- Never redirect to GitHub if the app URL cannot be validated locally.
- Add “Manage GitHub installation” link after connection:
  - `https://github.com/settings/installations/<installation_id>` where applicable, or the app install/manage URL.
- Add retry buttons for sync and loop start.

### 9. Validate the full happy path

Test these flows:

1. Logged-out user cannot start GitHub install.
2. Logged-in user clicks Connect repo.
3. GitHub opens the correct App install page, not 404.
4. User selects one public repo.
5. Callback stores installation + repos.
6. Repo appears in `/dashboard/repos`.
7. User selects repo and starts a loop.
8. Hermes receives the repo + GitHub token.
9. UI shows loop status/activity instead of mock progress.

## Technical notes

- This will require adding GitHub App secrets that are not currently listed, especially `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY`.
- We should not ask for or store these in code. They should be stored securely as backend secrets.
- The existing `GITHUB_APP_SLUG` appears to be wrong or points to a GitHub App that is not public/accessible.
- The current `user_github_credentials` table can remain temporarily for legacy OAuth fallback, but the production path should move to installation-based credentials.
- No changes should be made to generated backend client files or route tree files.