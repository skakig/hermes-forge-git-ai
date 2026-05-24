# Hermes Forge — Make the agent actually work

Two parts: a quick cleanup of the lies in the UI, then the real build — an in-app autonomous agent that reads a repo, plans a fix, opens a draft PR, and iterates.

## Part 1 — UI cleanup (small, fast)

1. **Topbar** — remove the non-functional "Search repos, PRs, runes…" input. Keep the notification bell, connection status pill, and avatar. The Repositories page already has the real ⌘K command bar — that's the search surface.
2. **Sidebar "Background Mode"** — replace the hardcoded `Agent active · 3 loops running` with live data from `getDashboardStats` (`activeLoops` count). Hide the panel when count is 0 instead of lying. Pulse the dot only when count > 0.
3. **Ignite Loop dialog** — replace the bare "Choose repo" Select with a proper dialog: repo picker + a **Bug report / instructions** textarea (free-form, optional). That text becomes a per-loop steering message on top of the standing goals.

## Part 2 — The agent engine (the real work)

Build the agent inside this app as a series of TanStack server functions calling Lovable AI Gateway (Gemini 2.5 Pro by default) and the GitHub REST API via the existing GitHub App installation token. No external Hermes service.

### Engine architecture

The loop runs as **discrete phases**, each a server function call. The browser polls `pollLoopStatus` every few seconds and triggers the next phase. This sidesteps Cloudflare Workers' per-invocation CPU/time limits — each phase is a short, self-contained AI call.

```text
ignite ─► AUDIT ─► PLAN ─► DRAFT_PR ─► PATCH ─► COMMIT ─► READY ─► (await human)
                                          ▲                │
                                          └── iterate ◄────┘ (optional)
```

| Phase      | What runs server-side                                                                                                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit`    | GitHub API: list repo tree (capped at ~400 source files, skip lockfiles/dist/node_modules), fetch README + package.json + top-level config. Lovable AI summarizes the codebase: stack, structure, entry points. |
| `plan`     | Send: audit summary + active goals + per-loop bug report. Gemini 2.5 Pro returns a structured plan: hypothesis, suspect files (paths), proposed change in plain English, risk level.                            |
| `draft_pr` | Create branch `forge/auto-{ts}` from default branch via GitHub API. Open a **draft PR** with the plan as the body and a checklist of files it will touch. Save `pr_number` + `pr_url` to `loops`.               |
| `patch`    | For each suspect file: fetch contents, send to AI with the plan, get back a full replacement (or a structured diff via tool calling). Apply via GitHub Contents API (commits to branch).                       |
| `commit`   | Push a single squashable commit message: `fix: {short summary} · hermes`. Optionally append a follow-up comment on the PR explaining what changed.                                                              |
| `ready`    | Flip PR from draft → ready for review via GitHub API. Mark loop `status='completed'`. Log activity event.                                                                                                       |

### How the agent finds your dice-strategy bug

You ignite a loop on `skakig/dice-strategy-oracle` and paste into the bug report textarea:
> "Probability output looks wrong when rolling 3 or more dice — should be much lower than what it shows."

- `audit` finds the relevant source files (probability/odds/dice keywords get higher weight in the file ranker).
- `plan` produces something like: *"Hypothesis: the multiplier in `calculateOdds` uses addition where it should use multiplication for independent events. Suspect file: `src/lib/odds.ts`. Will write a failing test first, then fix."*
- `draft_pr` opens PR with that plan as the body — **you can stop here, comment, or let it continue**.
- `patch` rewrites the file. `commit` pushes. `ready` flips to ready-for-review.

You always get a draft PR with the agent's reasoning *before* it writes code, so nothing surprising lands.

### Frontend changes

- `LoopControl` → `IgniteDialog` modal with repo + bug-report textarea + active-goals preview.
- `LoopControl` phase list extended to the new 7 phases with live PR link as soon as `draft_pr` completes.
- New `ActiveLoopCard` on dashboard showing in-flight loops with progress + cancel button (cancel = mark `status='canceled'`, server fn stops on next phase poll).
- `PRList` already exists — will show the draft PRs automatically.

## Technical details

**Files to touch (Part 1):**
- `src/components/forge/Topbar.tsx` — remove search input
- `src/components/forge/Sidebar.tsx` — wire to `getDashboardStats`, hide-when-zero
- `src/components/forge/LoopControl.tsx` — split into dialog + per-loop bug textarea
- `src/routes/dashboard.index.tsx` — pass `activeLoops` to sidebar via context or duplicate query

**Files to touch (Part 2):**
- `src/lib/hermes.server.ts` — **replace** the external-API client with in-app phase runners (`runAudit`, `runPlan`, `runDraftPr`, `runPatch`, `runCommit`, `runReady`). Each uses Lovable AI Gateway + GitHub REST API.
- `src/lib/github-app.server.ts` — add helpers: `listRepoTree`, `getFileContents`, `createBranch`, `createOrUpdateFile`, `createPullRequest`, `updatePullRequest`, `addPRComment`.
- `src/lib/hermes.functions.ts` — `startHermesLoop` no longer calls external; just inserts loop row + phase=`audit` and returns. `pollLoopStatus` becomes the **driver**: reads the loop row, runs the next phase if status=`running`, persists result, returns updated state. Add `cancelLoop` server fn. Add per-loop `bug_report` input.
- `loops` table — add columns: `bug_report text`, `plan jsonb`, `suspect_files text[]`, `pr_is_draft boolean` (migration).
- AI calls use Lovable AI Gateway (`https://ai.gateway.lovable.dev/v1/chat/completions`) with `LOVABLE_API_KEY` (already in secrets). Default model `google/gemini-2.5-pro`; use tool-calling for structured plan + diff outputs.
- Deprecate `HERMES_API_URL` / `HERMES_API_KEY` secrets (leave in place, just stop reading them).

**Worker runtime constraints handled:**
- No `git clone`, no `child_process` — everything via GitHub REST API.
- Each phase is one server-fn invocation, bounded to a single AI call + a few HTTP calls. Stays well under Cloudflare CPU limits.
- The browser drives the loop forward via polling, which already happens every 4s in `LoopControl`.

**What I will NOT do in this pass (out of scope):**
- Multi-file refactors larger than ~5 files per loop (capped to keep PRs reviewable).
- Running real tests in CI inside the loop (we can add a follow-up phase later that calls a GitHub Actions workflow and waits).
- Embedding-based file search (we'll start with keyword + path heuristics; add embeddings later if precision is poor).
- Touching the Topbar search behavior for the dashboard pages other than Repositories.

## Validation

After implementation:
1. Sidebar reads 0 loops when none active, hides panel.
2. Topbar has no search input.
3. Ignite on `dice-strategy-oracle` with the bug-report message → within ~30s a draft PR exists on GitHub with the agent's plan as the body → within ~2 min the PR has a commit with the proposed fix → PR flips to ready-for-review.
4. Activity feed shows one event per phase transition.
5. Cancel button on an in-flight loop stops further phases.
