## What's actually happening

Your network log confirms the server function works and returns a valid GitHub authorize URL. The OAuth App is a classic OAuth App with the correct callback URL registered. So GitHub itself should accept the request.

The most likely cause of the "blank screen" is environment mixing:

- You're testing inside the **preview** iframe (`lovableproject.com`).
- The OAuth `redirect_uri` is hardcoded to the **published** URL (`hermes-forge-git-ai.lovable.app`) — it has to be, because GitHub only allows the one callback URL you registered.
- After GitHub redirects back, the callback runs on the published origin, stores the token, and redirects to `/dashboard/repos?connected=1` **on the published site**.
- If your session isn't valid on that origin, the dashboard guard bounces you to `/login`. If anything in the callback fails, it lands on `/dashboard/repos?error=…` — but the page currently **ignores those params silently**, so it just looks blank/unchanged.

Today the page has zero feedback for either success or failure, so we're flying blind.

## Plan

### 1. Surface OAuth result on `/dashboard/repos`

Edit `src/routes/dashboard.repos.tsx`:

- Add `validateSearch` for `connected?: "1"` and `error?: string`.
- On mount, read those params. If `error`, show a destructive `<Alert>` at the top with a human-readable message keyed off the code (`missing_code`, `bad_state`, `token_exchange`, `store`) and the raw code for debugging. If `connected=1`, show a success toast + green banner.
- Clean the query string after reading (so refresh doesn't re-fire).

This alone will tell us exactly which failure path you're hitting — no more guessing.

### 2. Add diagnostic logging in the callback

Edit `src/routes/auth.github.callback.ts`:

- `console.error` with a `[github-oauth-callback]` prefix on every early-return path, including the request URL, the GitHub error body (when token exchange fails), and the Supabase error (when the upsert fails).

These show up in `stack_modern--server-function-logs`, so after one more attempt I can read exactly why it failed.

### 3. Make the published-vs-preview boundary explicit

Edit `src/components/forge/RepoCard.tsx` area / the two Connect buttons in `dashboard.repos.tsx`:

- Detect `window.location.hostname` — if it's a `lovableproject.com` (preview) host, show a small note above the Connect button: "GitHub redirects back to the published site. [Open published dashboard ↗]" linking to `https://hermes-forge-git-ai.lovable.app/dashboard/repos`.
- This stops you from chasing a flow that's structurally going to bounce origins.

### 4. (Optional, only if step 1 reveals it's needed) Loosen the state TTL

The state token expires 10 minutes after issue. If you sit on the GitHub consent screen, you'll get `bad_state` on return. If step 1 shows that's the actual error, bump TTL to 30 minutes.

## Out of scope

- No DB changes.
- No changes to the server function that mints the URL — it's correct.
- No changes to the GitHub App credentials.

## Files

- Edited: `src/routes/dashboard.repos.tsx` (search schema + banners)
- Edited: `src/routes/auth.github.callback.ts` (logging only)

Once this ships, click Connect again on the **published site** (`hermes-forge-git-ai.lovable.app/dashboard/repos`), and either the green success banner appears or a red error banner tells us exactly which step failed — at which point I'll fix that specific step.
