# Make the primary CTAs actually work

## The problem

"Ignite the Forge" and "Connect a repository" both link to `/dashboard/repos`. That route's parent (`src/routes/dashboard.tsx`) guards with `supabase.auth.getSession()` and, when there's no session, redirects to `/?redirect=/dashboard/repos`. The homepage has no sign-in UI, so the user lands on the marketing page again and the CTAs appear broken. There is no `/login` route in the app at all.

## What I'll build

### 1. New `/login` route (`src/routes/login.tsx`)
- Polished card matching the cyber-desert aesthetic (glass surface, ember accents, rune-grid backdrop).
- Tabs: **Sign in** and **Create account**.
- Email + password form using `supabase.auth.signInWithPassword` / `signUp`.
- "Continue with Google" button using `lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/login" })` (managed Lovable Cloud OAuth — no extra setup).
- Reads `?redirect=` search param; after successful auth navigates to that path (default `/dashboard/repos`).
- If already authenticated (`beforeLoad` session check), immediately redirect to the target.
- Inline error messaging via toast + form-level message.
- SEO `head()` with route-specific title/description.

### 2. New `/signup` route
- Thin wrapper that renders the same component pre-switched to the Create account tab, so the marketing nav can offer both entry points cleanly. (Same file, shared component.)

### 3. Wire CTAs through `/login`
- `src/routes/dashboard.tsx` `beforeLoad`: redirect unauthenticated users to `/login?redirect=<location.href>` instead of `/`.
- `src/components/marketing/MarketingShell.tsx`:
  - "Sign in" button → `/login`.
  - "Ignite the Forge" button → `/login?redirect=/dashboard/repos` (so a fresh visitor signs in and lands directly on the connect-repo screen).
- `src/routes/index.tsx`: same treatment for the hero "Ignite the Forge" / "Connect a repository" CTAs and the final-CTA band.
- `src/routes/pricing.tsx`: tier "Start" buttons → `/login?redirect=/dashboard/repos`.

### 4. Configure Google as a social provider
- Call `supabase--configure_social_auth` with `providers: ["google"]` so the first Google sign-in doesn't fail with "provider not enabled". No keys required from the user (managed by Lovable Cloud).

### 5. Auth state listener
- Small `useEffect` in the login component subscribing to `supabase.auth.onAuthStateChange` to navigate on `SIGNED_IN` (covers the OAuth return trip).

## Out of scope
- No changes to the GitHub OAuth flow itself, the Hermes API wrapper, or any dashboard pages beyond the redirect target. The GitHub "Connect repo" button on `/dashboard/repos` is already wired and will work the moment the user has a session.
- No password reset / email verification UI in this pass (email confirmation remains the Supabase default; if you want auto-confirm during testing, say the word).

## Files touched
- **New:** `src/routes/login.tsx`, `src/routes/signup.tsx`
- **Edited:** `src/routes/dashboard.tsx`, `src/components/marketing/MarketingShell.tsx`, `src/routes/index.tsx`, `src/routes/pricing.tsx`
- **Config:** enable Google social auth provider
