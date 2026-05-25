
## Why every PR fails right now

Your screenshot shows the dice repo PR has 4 failed Netlify checks (`Deploy Preview failed`, `Pages changed`, `Header rules`, `Redirect rules`). The Hermes agent did everything correctly *except* the part that matters: it opened a PR with code Netlify can't build.

Looking at `hermes.server.ts` + `github-app.server.ts`, the real problems are:

1. **Hermes can't see why checks failed.** `listPRChecks` only captures check `name` + a one-line `summary`. The diagnose step gets fed `"netlify/farklerocks/deploy-preview: Deploy Preview failed."` — there's no build log, no stack trace, no annotation. The AI is guessing blindfolded, so the "repair" patch is random.
2. **The patcher edits files in isolation.** `runPatch` loops file-by-file, sending each file alone to the AI with no awareness of imports, types, or sibling files. The model invents APIs that don't exist, breaks types, or removes exports something else depends on.
3. **The planner picks "suspect files" without reading them.** `runPlan` chooses up to 5 paths from a one-paragraph repo brief, never opens them, then commands edits. Often the wrong files.
4. **No pre-flight check before pushing.** Hermes commits → Netlify builds → fails. There's no "does this even parse" gate.

So you're not doing anything wrong — the agent is shipping unvalidated guesses. Here's the path forward.

## Plan

### 1. Capture real failure evidence (highest impact)

Extend `listPRChecks` in `github-app.server.ts` to pull richer data per failing check:

- **GitHub check-runs**: also fetch `output.text` (full log body, up to 64KB) and `/check-runs/{id}/annotations` (file + line + message). This is what Lovable's own build checks return — should give us actionable info immediately.
- **External statuses (Netlify)**: for each failing status, fetch the `target_url` HTML and extract the deploy-log snippet, OR (better) if user adds a `NETLIFY_AUTH_TOKEN` secret, hit `https://api.netlify.com/api/v1/deploys/{id}/log` for the structured build log. Detect the deploy ID from the `target_url` pattern.
- Store the trimmed log (last ~6KB per failed check, tail-biased — errors are at the bottom) into `checks_payload.failure_logs`.

### 2. Make `runDiagnoseFailure` actually diagnose

Today it sees check names. Change it to:

- Include the **failure log excerpts** from step 1 in the prompt.
- **Read the current contents** of `suspect_files` from the PR branch AND `package.json`, `vite.config.*`, `netlify.toml`, `tsconfig.json`. Send them as context.
- Ask for a **structured patch** (path + full new contents per file) in a single tool call, not just a "diagnosis + file list" that then triggers another isolated patch round.

### 3. Coherent multi-file patching in one shot

Replace the current per-file loop in `runPatch` with a single AI call that:

- Receives **all** suspect files + their current contents together (cap total at ~40KB).
- Returns an array of `{ path, new_contents, changed, note }` so cross-file changes stay consistent.
- Falls back to per-file mode only if the bundle exceeds the size cap.

### 4. Cheap pre-flight before committing

Before `putFile` writes each edit, run a minimum sanity gate:

- **Syntax parse** for `.ts/.tsx/.js/.jsx` files (use TypeScript's `ts.createSourceFile` parser — runs fine on Workers, no FS needed). If a file doesn't parse, drop that edit and log it instead of pushing broken code.
- For `.json`, run `JSON.parse`. For `.toml`, basic bracket-balance check.

This alone will eliminate most "deploy failed because the build won't even compile" cycles.

### 5. Planner reads files before committing to suspects

In `runPlan`, after the model proposes `suspect_files`, fetch their contents and run a second AI pass that confirms/revises the list and produces a more concrete `proposed_change`. Roughly doubles the plan-phase cost but vastly improves hit rate.

### 6. Surface what happened in the dashboard

`CheckRunList` already shows checks. Add:

- A collapsible "Failure detail" per failed check showing the captured log excerpt.
- The diagnosis the AI produced for the current repair attempt (already stored in `loop.plan.hypothesis` after repair) — render it inline so you can tell whether the AI understood the failure.

### 7. Add a `NETLIFY_AUTH_TOKEN` secret prompt

When a loop's target repo has Netlify checks, prompt the user once via `add_secret` to provide a Netlify personal access token. Without it we can still scrape the public deploy log page; with it we get clean structured logs.

## Technical notes

- **Files to change**: `src/lib/github-app.server.ts` (richer check fetcher + Netlify log fetcher), `src/lib/hermes.server.ts` (rewrite `runPatch`, expand `runDiagnoseFailure`, add second pass in `runPlan`, add pre-flight parser), `src/components/forge/LoopControl.tsx` (show failure logs + diagnosis inline).
- **No DB migration needed** — `checks_payload` is already JSON.
- **TypeScript parser** is in the `typescript` package, already a transitive dep; safe on Cloudflare Workers (pure JS, no FS).
- **Token budget**: cap total context per AI call at ~60KB to stay within Gemini 2.5 Pro limits with room for reasoning.
- **Backwards compatible**: existing loops in-flight will just see better data on their next poll.

## What this won't fix

If the underlying Netlify config in the dice repo is itself broken (e.g. wrong publish dir, missing env var), Hermes still can't fix it on the first try — but with real logs it'll at least *report* "Netlify expects `dist/` but build outputs to `build/`" instead of randomly editing source files. After the next repair pass it should converge.

## Suggested order of execution

Steps 1 + 2 + 6 together give you the biggest win and are independently shippable — you'll immediately see *why* checks fail and what Hermes thinks about it. Then 3 + 4 to actually improve patch quality. Step 5 last (it's an optimization). Step 7 only if Netlify HTML scraping proves unreliable.
