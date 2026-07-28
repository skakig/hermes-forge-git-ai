## Goal

Make loop status honestly reflect PR outcome: a PR that was merged is a success (even if some checks failed); a PR that's closed-without-merge or gone is an ERROR; failing checks on an open PR keep repairing until attempts are exhausted.

## Current behavior

`runChecksPending` only reconciles with merge state on the first failing-check tick. If checks fail again after repair attempts are exhausted, the loop is marked `failed / blocked` even when GitHub merged the PR in the meantime. There's also no reconciliation when the PR was closed without merging — that case looks identical to "checks failing".

## Changes (single file: `src/lib/hermes.server.ts`, `runChecksPending`)

1. **Reconcile PR state on every failing-checks branch, not just the first.**
   Move the `getPRState` call up so it runs before we decide between "diagnose & repair" and "give up / block". Use its result in three ways:

   - `prState.merged === true` → return `status: completed`, `phase: completed`, `checks_status: merged_with_failures` (existing branch, unchanged wording). Applies whether or not attempts are exhausted.
   - `prState.state === "closed" && !prState.merged` → return `status: failed`, `phase: blocked`, `checks_status: pr_closed`, `last_error: "PR #N was closed without merging"`, `comment_kind: error`. This is the only "actually rejected" terminal outcome.
   - Otherwise (PR still open) → keep existing behavior: diagnose_failure until `attempt_count >= max_attempts`, then `blocked / failure` with the current "Giving up after N repair attempts" message.

2. **Handle PR-not-found.**
   Extend `getPRState` (or wrap the call) so a 404 from GitHub surfaces as a distinct signal. On 404, return `status: failed`, `phase: blocked`, `checks_status: pr_missing`, `last_error: "PR #N no longer exists on GitHub"`. Do this by catching the `gh` error and inspecting the message for `404`; no new helper file needed.

3. **Fail-soft on transient reconciliation errors.**
   If `getPRState` throws for any other reason, log and fall through to the existing diagnose/repair path — don't crash the phase. (Already the case for the "before giving up" branch; keep that shape for the unified path.)

4. **No changes** to `runChecksPending`'s success or no-checks branches, to any other phase, or to the UI. The dashboard already renders `merged_with_failures` correctly; `pr_closed` and `pr_missing` will show through the existing `checks_status · <value>` line and `last_error` block without new components.

## Technical detail

- `runChecksPending` in `src/lib/hermes.server.ts` (lines ~1375–1530). Restructure the `failed.length > 0` block so `getPRState` is called first and its outcome drives one of three returns above. Keep `checks_payload` (with `failure_logs`) populated on every terminal return so the dashboard still shows the failing checks/logs when we mark `pr_closed` or `pr_missing`.
- `getPRState` in `src/lib/github-app.server.ts` (line 484) is unchanged; the 404 detection happens at the call site by catching and matching the thrown error's message. `gh()` already throws with the HTTP status embedded, so no new plumbing needed.
- No migration, no schema change, no new phase, no worker change.

## Verification

After edits, ignite a loop that produces a failing-check PR and:
- merge the PR manually → loop should flip to `completed / merged_with_failures`.
- close the PR without merging → loop should flip to `blocked / pr_closed`.
- leave PR open with failing checks → existing diagnose/repair path runs and, after `max_attempts`, ends `blocked / failure` as today.