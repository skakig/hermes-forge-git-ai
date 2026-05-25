## What's broken

The agent successfully audited the repo, made a correct plan ("end turn on a Farkle after hot dice in `useGameLogic.ts`"), and opened draft PR #1. But the dashboard shows **FAILED** and no code was ever written, because of a client-side race condition we created — not a GitHub or AI failure.

Two pollers run in parallel every 5s on the active loop:
- `useQuery({ refetchInterval: 5000 })` on `listLoops`
- a separate `setInterval(5000)` calling `pollLoopStatus`

Each call to `pollLoopStatus` re-runs the current phase from scratch. Phases routinely take longer than 5s (Gemini audit + plan + 3 GitHub round-trips for draft_pr). With no per-loop lock, phases run concurrently:
- Concurrent `runPlan` → 6+ "Plan ready" entries in your activity feed.
- Concurrent `runDraftPr` → two `createBranch` calls hit GitHub. One wins (PR #1 created), the other gets **422 "Reference already exists"** or **422 "PR already exists for that branch"**. The losing call throws → `catch` in `pollLoopStatus` flips the whole loop to `status=failed`. Phases 4–7 (`patch`, `commit`, `ready`) never run, so your `useGameLogic.ts` is never actually edited.

## Plan

### 1. Acquire a per-loop phase lock (server-side, atomic)

Add two columns to `loops`:
- `phase_running boolean not null default false`
- `phase_started_at timestamptz null`

In `pollLoopStatus`, before running a phase, do a conditional UPDATE:

```
update loops
   set phase_running = true, phase_started_at = now()
 where id = $1 and phase_running = false
returning *;
```

If no row comes back, another worker holds the lock → return early (no error, no retry, no activity event). On success, run the phase, then release the lock in a `finally` block (`phase_running = false`). Also release stale locks > 90s old on acquisition so a crashed worker can't wedge the loop forever.

This is the real fix. Even if both pollers fire, only one phase ever runs.

### 2. Conditional phase advancement

When writing the result, also gate on the phase we started from:

```
update loops set phase = $next, ... where id = $1 and phase = $expected;
```

Belt-and-suspenders against any other source of duplicate runs.

### 3. Auto-chain phases inside a single poll

Right now each phase needs its own poll cycle (~5s per phase × 7 phases = 35s minimum, often longer). Inside `pollLoopStatus`, after a successful phase, immediately loop and run the next phase too — up to a soft cap (e.g. 4 phases or 25s wall clock per request, whichever comes first), then return. This makes a healthy loop finish in ~1 request instead of 7, and removes most of the window where racing is even possible.

### 4. Kill the redundant client poller

Remove the `setInterval` in `LoopControl` — `loopsQuery` already refetches every 5s, and we'll explicitly call `pollFn` once per refetch when the loop is still running. One poller, not two.

### 5. Make `runDraftPr` itself idempotent

Belt #3:
- Use a stable branch name based on `loop.id` (e.g. `forge/auto-${loop.id.slice(0,8)}`) instead of `Date.now()`. If `createBranch` returns 422 "Reference already exists" AND we already wrote a `pr_number` on the loop, treat it as success and move on. If it returns 422 because of the branch but we have no PR yet, fetch the existing branch SHA and continue.
- If `createPullRequest` returns 422 "A pull request already exists for…", fetch the existing PR and use its number/url instead of failing.

### 6. Friendlier error surface

When a phase truly fails (not a benign 422), the activity event already shows the cause. Leave the loop in `phase=error` but also display the **last successful PR url** in the dashboard's failed-loop card so the user can see "the draft PR exists, only the patch phase failed" — and add a **Resume** button that resets `phase_running=false` and rewinds `phase` to the failed one so the user can retry without re-igniting.

## What this gets you

After the fix, igniting on `skakig/dice-strategy-oracle` with the Farkle bug report should:
1. Audit (1 Gemini call)
2. Plan ("end turn on Farkle after hot dice in useGameLogic.ts")
3. Open draft PR (the one you already see)
4. **Edit `useGameLogic.ts` for real** via Gemini's `apply_edit` tool call → commit on the branch
5. Post a summary comment on the PR
6. Flip PR from draft → ready for review

End-to-end in ~30–60s, no double-runs, no 422s, real diff in the PR for you to review and merge.

## Out of scope

- Re-trying failed AI phases (next iteration; for now Resume button is enough).
- Multi-file refactors that need cross-file reasoning beyond the 5-file-per-phase cap.
- Webhook-driven progression (everything still poll-driven from the dashboard).
