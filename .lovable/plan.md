
# Hermes Forge — Audit & Roadmap

## What I found (ground truth)

I checked the database and the wiring:

- `github_installations` — **0 rows**
- `repositories` — **0 rows**
- `loops` — **0 rows**
- `activity_events` — **0 rows**

So despite GitHub saying "Installed," **nothing was ever recorded on our side**. Every empty card, every dead button, and every "install the GitHub App" message is downstream of that one fact.

Then I walked the code:

1. **Topbar "Connected" pill is hardcoded** (`src/components/forge/Topbar.tsx`) — it always says "Connected" with a GitHub icon. No green/red/yellow dot, no live status, no link to anything. It's a sticker.
2. **Install callback handoff is fragile.** GitHub redirects to `/auth/github/callback?installation_id=…`, which bounces to `/dashboard/repos?pending_install=…`. The repos page then calls `recordInstallation` via the user's session. If the user isn't logged in at that moment (or the Supabase session hasn't hydrated yet), `requireSupabaseAuth` 401s, the `useEffect` strips the query param, and the install ID is lost forever. No retry, no "finish install" button. That's why your DB is empty.
3. **Settings is a mockup.** "Background mode: Enabled," "Hermes API: Configure," "Billing: Manage" — none of those buttons do anything. The Hermes API URL/key are only env vars; there's no UI to set or verify them.
4. **Goals are flat tags.** No cadence ("run every 6h"), no scope ("only `src/**`"), no PR style ("draft vs ready"), no priority. The agent can't act agentically because it has no policy.
5. **Loops are fire-once.** `startHermesLoop` kicks one run; `pollLoopStatus` is only called when something pulls it. There's no scheduler, no cron, no "keep improving until merged," no resume on failure. That contradicts the "continuous check → suggest → re-learn → improve → PR" promise.
6. **Activity is reactive-only.** Events are inserted by server fns but there's no realtime subscription on the client — the log only refreshes on navigation.
7. **No PR feedback loop.** When a PR merges or gets review comments, nothing flows back into the agent. Truly agentic systems learn from reviews.

---

## Roadmap (phased, shippable)

### Phase 1 — Unblock the install (1 patch, gets you a working dashboard today)

**Goal:** Get a row into `github_installations` and prove the whole chain works.

1. **Persist `pending_install` across auth.** When the callback hits `/dashboard/repos?pending_install=X`:
   - Stash the ID in `sessionStorage` before the auth guard can redirect to `/login`.
   - On any subsequent dashboard render, if `sessionStorage` has a pending install and the user is now authenticated, call `recordInstallation` and clear it.
2. **Surface a "Finish install" recovery card** on `/dashboard/repos` when a pending install exists but recording failed. One button → retries `recordInstallation`. No more silent loss.
3. **Manual reconciliation fallback.** Add a `reconcileInstallationsForUser` server fn that calls `GET /user/installations` using the user's GitHub OAuth token (we already have `user_github_credentials`) and imports any installation the App can see. Wire a "Re-sync from GitHub" button next to "Install GitHub App."
4. **Verify the GitHub App's Setup URL** points to `https://hermes-forge-git-ai.lovable.app/auth/github/callback` (this is the published, stable URL — preview URLs change per build and will break the round-trip).

### Phase 2 — Make the dashboard tell the truth

1. **Real connection status in the Topbar.** Replace the hardcoded pill with a small component that subscribes to `getGithubConnection` + `checkInstallationHealth`:
   - **Green dot** — installation linked, token mints, repos accessible.
   - **Yellow dot** — linked but health check has warnings (no repos granted, rate limited).
   - **Red dot** — not installed, token mint failed, or GitHub returned 4xx/5xx.
   - **Grey dot** — checking.
   Clicking opens `/dashboard/repos` with the health card expanded.
2. **Realtime activity feed.** Enable `supabase_realtime` on `activity_events` and subscribe in `ActivityLog.tsx`. New events appear without refresh.
3. **Working Settings page.** Replace the static rows with real controls:
   - Hermes API URL/key field with a "Test connection" button (calls a new `pingHermes` server fn).
   - Background mode toggle that's actually persisted on `profiles`.
   - GitHub App: show installation account, "Manage on GitHub" link, "Uninstall" instructions.
   - Notification preferences.

### Phase 3 — Make it actually agentic

1. **Rich goals, not tag soup.** Promote `goals` rows to carry:
   - `cadence` — `on_push` / `every_6h` / `daily` / `weekly` / `manual`
   - `scope` — glob patterns (`src/**`, `!**/*.test.ts`)
   - `pr_style` — `draft` / `ready_for_review`
   - `max_open_prs_per_repo` — backpressure so the agent doesn't spam.
   - `priority` — int, used as tiebreaker.
2. **Continuous loop scheduler.** A `tick-forge` route under `src/routes/api/public/cron/tick-forge.ts`, signature-verified, called every 5–15 min by Supabase pg_cron. It:
   - Finds repos whose goals are due (per cadence).
   - Skips repos with `max_open_prs_per_repo` already at limit.
   - Calls `startHermesLoop` for the next one.
   - Polls in-flight loops via `pollLoopStatus`.
3. **PR feedback ingestion.** Add `/api/public/webhooks/github` (HMAC-verified using the App webhook secret) to receive `pull_request`, `pull_request_review`, and `check_run` events. On review comments, write an `activity_events` row and (Phase 4) feed the comment text back into the next loop's prompt as "previous review feedback."
4. **Loop policy** on the dashboard's `LoopControl`: "Run until merged" / "One pass only" / "Until human stops."

### Phase 4 — Best-on-the-planet polish

1. **Per-repo health page** — last loop, last PR, success rate, average cycle time, language stats.
2. **Cost meter** — track tokens used per loop (Hermes returns this), show $/PR.
3. **Diff preview before opening PR** — Hermes returns the patch; show it in a Monaco viewer with "Approve & open PR" / "Reject with note." The note becomes a constraint on the retry.
4. **Memory bank per repo** — a `repo_memory` table the agent reads at the start of each loop ("the team prefers `zod` over `yup`," "don't touch `src/legacy/**`"). Reviewers can append to it directly from PR comments via a slash command (`/forge remember …`).
5. **Multi-agent runes** — different agent personas for `docs`, `tests`, `perf`, `security`. Each goal binds to a rune.
6. **Slack/Discord/email digests** — daily "here's what Hermes shipped" summary.
7. **Audit log of agent reasoning** — store every prompt/response pair (encrypted) so a human can review why the agent made a change.
8. **Branch protection awareness** — if the default branch requires reviews, auto-request from CODEOWNERS.
9. **Failure auto-recovery** — if `npm test` fails in CI on a Hermes PR, the next loop reads the CI log and tries to fix.

---

## What I'd build first (recommended order)

1. Phase 1 (install unblock) — **today, one patch.** Without this nothing else matters.
2. Phase 2 truth-in-UI — connection dot, realtime activity, real settings.
3. Phase 3.1 + 3.2 — rich goals + cron scheduler. This is what makes it "agentic" instead of "click ignite, wait, refresh."
4. Phase 3.3 — webhook ingestion. Closes the learning loop.
5. Phase 4 in the order that matches your users' loudest pain.

---

## Tell me

- **Approve Phase 1 to ship now?** It's a focused patch (~3 files) and will turn your "Installed" banner on GitHub into an actual working dashboard.
- **For Phase 3 cadence:** is daily a sensible default, or do you want every-push (webhook-triggered) as the default?
- **For Phase 4 cost meter:** does Hermes return token usage in its API response today, or do we need to estimate?
