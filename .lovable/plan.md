# Hermes audit — where we are, what's blocking real self-improvement

## What's already shipped and working

- **`validateProposedFile` (unbypassable pre-commit gate)** — catches `'''`, `"""`, and ` ``` ` at the start, end, or any standalone line; markdown fences; chat preambles; null bytes; broken JSON; unbalanced brackets; and a first-line JS/TS shape check. Runs at three points: after the AI edit, after the one-shot repair, and one final belt-and-braces call immediately before `putFile`.
- **One-shot repair** — when a file is rejected, Hermes sends the exact rule name + message back to the AI and re-validates the response before pushing.
- **Merged-PR reconciliation** — when CI fails, `runChecksPending` asks GitHub if the PR was merged anyway. If yes → `completed` with a "merged with failures" banner instead of `ERROR`.
- **Research phase** — sits between `plan` and `draft_pr`. Produces a rules brief with cited sources; when the Firecrawl connector is linked the top query is scraped via the Lovable gateway and the markdown appended. Rules go verbatim into the patch system prompt.
- **UI** — research panel with source links, merged-with-failures banner, validator rule names, "Connect Firecrawl" hint on the ritual card, per-loop repair counter, failure-log expansion.
- **Durable worker** — `pg_cron` drives phase transitions; per-loop `phase_running` lock kills the parallel-poller race. `runDraftPr` uses a stable branch name and recovers from `gh_422`.

## What's still going wrong (the two problems from your last run)

1. **Stray `'''` shipped in older PRs** — those PRs (#5, commit 1d02eb4) predate the strict validator. Every NEW run should get caught. There is nothing more to fix in the validator itself; we just need a clean run to confirm.
2. **Farkle rule fix was structurally incomplete** — the agent's plan phase locked in a suspect-file list (`useGameState.ts`, `gameLogic.ts`) that didn't include the scoring-validation module. Its "proposed change" was already too narrow before the patch phase ran. Even a perfect patch can't fix what isn't in scope.

The Hermes loop's real weakness right now is not code emission. It's **planning depth**: the agent commits to a shallow file list too early, so the patch phase optimizes a fix that can't actually address the bug.

## The plan — three focused upgrades

### 1. Deeper planning: `plan` phase reads code before locking scope

Today `runPlan` sees only the audit brief + goals + bug report. It picks suspect files by pattern-matching filenames from the audit. That's why it missed the scoring validator on the Farkle bug.

Change `runPlan` to:

- After the AI returns an initial hypothesis, do a second AI turn where the model is shown the actual contents of the top 3 candidate files it just named, plus a search-derived shortlist of any file whose text contains keywords from the bug report ("farkle", "bust", "score", "selection", etc.).
- Then have the model finalize `suspect_files` (up to 5) with the option to swap files based on what it just read.

This is one extra AI call per loop; the payoff is a suspect list that reflects reality, not filename guesses.

### 2. Bug-report-driven grep-first candidate discovery

Add a small deterministic step before `runPlan`: for each significant term in `bug_report` (nouns ≥ 4 chars, dedup, drop stopwords), grep the repo tree for files whose contents contain that term. Feed the top 8 hits into the plan phase alongside the audit brief.

This is a repository-side signal the AI cannot invent — it forces the model to consider the files that actually mention the buggy concept, even if their filenames don't advertise it.

### 3. Post-patch spec verification: does the diff satisfy the rules brief?

Right now `runPatch` writes files and moves on. Add a `runVerify` step between `commit` and `ready` that:

- Reads the final contents of every touched file from the branch.
- Sends them + the research brief to the AI with one question: *"Does this diff actually implement rules 1..N, or does it skip any?"*
- If the model says a rule is not implemented, add a PR comment listing the gap and (a) go back to `patch` with the rules-gap message as the new failure log, up to the same `max_attempts` budget, or (b) mark the loop `blocked` with a clear explanation.

This is the closed-loop verification that turns "the agent shipped a plausible diff" into "the agent shipped a diff that satisfies the spec". It's the piece missing today that let PR #5 ship a half-fix.

## Files that will change

- `src/lib/hermes.server.ts`
  - `runPlan`: two-stage plan (hypothesize → read candidates → refine scope).
  - New helper `discoverCandidateFiles(tree, bugReport)`: keyword-based grep over the audit tree.
  - New phase runner `runVerify`; add `"verify"` to `phaseOrder`.
- `src/components/forge/LoopControl.tsx`: add `verify` to the phase progress list with a label like "Verifying spec compliance".
- `supabase/migrations/*` (new): add `verify` to any phase enum / check constraint if one exists on `loops.phase`, otherwise no schema change needed.
- `src/lib/hermes.functions.ts`: no changes.

## Not doing (kept out of scope on purpose)

- Running the actual TypeScript compiler or a bundler inside the Worker to catch build errors pre-commit. The Worker runtime doesn't ship tsc, and we've already committed to Netlify's build as the ground truth via the CI feedback loop.
- Rewriting the patch phase — it's fine. The problem is upstream (scope) and downstream (verification), not in the edit itself.
- Adding a separate "test writer" phase. Worth doing later, but only after we prove the plan/verify loop closes the gap on the Farkle-style half-fixes.

## Success criteria

Re-ignite on `dice-strategy-oracle` with the same Farkle bug report. We expect to see:

1. `research` phase produces a rules brief citing official Farkle rules (Firecrawl now connected).
2. `plan` phase's final `suspect_files` includes the scoring validation module, not just the state hook.
3. `verify` phase either confirms every rule is implemented, or bounces back to `patch` with a specific gap.
4. Loop ends `completed` (green), not `ERROR`, whether or not the PR is auto-merged.

If any of those fail we have a concrete diagnostic instead of "the PR looks reasonable but the game is still broken."
