What’s going on

- Hermes is currently a request-driven agent, not a real background worker. The dashboard calls `pollLoopStatus`, and that one web request tries to run several slow phases: audit, plan, create PR, ask AI to edit files, push commits, then mark the PR ready.
- That explains the waiting/reload behavior: GitHub may already have the PR/commits, but the dashboard only reflects success after the next poll/reload sees the database row updated.
- The failed GitHub checks in your screenshots are Netlify/deploy checks on the target repo. Hermes can create code changes, but right now it does not read CI/deploy failure logs, diagnose them, and push a corrective commit. So “PR created” does not mean “PR is correct and deployable.”
- The current patcher is also too shallow for true self-improvement: it picks up to 5 suspect files, asks the model to rewrite each file independently, and does not run tests/builds or inspect the resulting app before declaring the loop complete.

Best way to make this actually auto-improve

1. Replace request-driven polling with a durable job queue
   - Starting a loop should enqueue work and return immediately.
   - A worker endpoint processes one phase/job at a time with locks, retries, and persisted progress.
   - The dashboard becomes a live monitor, not the thing responsible for making Hermes run.

2. Add a CI/check feedback phase
   - After pushing commits, Hermes should poll GitHub check runs/statuses for the PR branch.
   - If checks fail, it should collect the failing check names and links/log excerpts where available.
   - The loop should not show “completed” until checks are green, explicitly blocked, or max repair attempts are exhausted.

3. Add a repair loop
   - New phases: `checks_pending`, `diagnose_failure`, `repair_patch`, `repair_commit`, then back to `checks_pending`.
   - Store `attempt_count`, `last_error`, and failed check metadata on the loop.
   - Cap attempts, for example 3 repair attempts per PR, so it does not thrash forever.

4. Improve code-edit quality
   - Instead of editing isolated files blindly, have Hermes read relevant neighboring files and config files: package.json, build config, deploy config, tests, and files referenced by failing logs.
   - Prefer small targeted patches and commit messages that explain the fix.
   - If no confident patch is possible, leave the PR open with a clear “needs human review” status rather than claiming success.

5. Make dashboard statuses honest
   - Split PR state from agent state:
     - PR opened
     - Commits pushed
     - Checks running
     - Checks failed; repairing
     - Ready for review
     - Blocked
   - Show the GitHub PR link even when the agent fails.
   - Add a “Resume/Retry repair” action for failed or blocked loops.

Technical implementation plan

- Database migration:
  - Add queue/job metadata, e.g. `loop_jobs` or equivalent columns on `loops`.
  - Add fields such as `attempt_count`, `max_attempts`, `last_error`, `checks_status`, `checks_payload`, `next_run_at`.
  - Keep RLS scoped to the authenticated user.

- Server functions/routes:
  - Keep `startHermesLoop` as the user-facing function that creates the loop and enqueues the first job.
  - Add a secured worker route under `/api/public/...` for scheduled/background processing, protected by a secret header.
  - Add server helpers to list PR check runs/statuses from GitHub.
  - Add phase runners for check polling and repair attempts.

- GitHub integration:
  - Fetch PR head SHA and associated check runs/statuses.
  - Treat Netlify/deploy failures as a first-class signal.
  - Store failing check names, URLs, conclusion, and summary in the loop activity.

- Dashboard:
  - Show the real phase/check state instead of only `completed`/`failed`.
  - Link directly to failed checks and the PR.
  - Add retry/resume for blocked loops.

Expected outcome

- Hermes will no longer depend on the browser tab being open or a manual reload to continue.
- The dashboard will show accurate progress while GitHub checks run.
- A failed Netlify check becomes input for another Hermes repair attempt instead of the endpoint marking the loop done.
- The system becomes a real self-improvement cycle: propose change, push PR, observe CI/deploy, repair, repeat until green or safely blocked.