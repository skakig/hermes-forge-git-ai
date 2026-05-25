
## Goal

Stop Hermes from ever committing corrupted source again, stop it from reporting `ERROR` on a PR that actually merged, and give it a research step so it can validate fixes against an authoritative external source (e.g. official Farkle rules) instead of guessing.

## Problem recap (from the screenshots)

1. PR #5 (`gameLogic.ts`) and commit `1d02eb4` (`useGameState.ts`) both still contain stray `'''` at line 1 and at EOF. My previous `sanityCheck` was supposed to reject these — clearly the gate is not actually running, or the AI's repair output is bypassing it.
2. PR #5 got **merged** anyway (auto-merge or human), yet the Forge UI shows "Last loop ended in ERROR" — the loop's terminal state is derived only from CI checks, not from PR merge state.
3. No mechanism exists for the agent to fetch external truth (game rules, API docs, RFCs) before changing behavior, so its "fix" is plausible-but-wrong.

## What changes

### A. Make `sanityCheck` actually unbypassable (`src/lib/hermes.server.ts`)

Add a single `validateProposedFile(path, content)` that runs on **every** file write path — initial patch, repair patch, and the post-repair re-check — with no early returns:

- Hard reject when the first non-whitespace token of any `.ts/.tsx/.js/.jsx/.json/.md/.css` file is `'''`, ``` ``` ```, `"""`, or any line whose trimmed form equals one of those.
- Hard reject when the **last** non-whitespace line is `'''`, ``` ``` ```, or `"""`.
- Hard reject prose preambles (`Here is`, `Sure!`, `Below is`, `Certainly`).
- For `.ts/.tsx/.js/.jsx`: run a real parser via the TypeScript compiler API (`ts.transpileModule` with `noEmit: true`) and reject on any syntax diagnostic. The current heuristic check is too weak — `'''` is a SyntaxError to a real parser, so this catches it deterministically.
- Log every rejection into `plan.validation_notes` with file path, rule that fired, and a 200-char excerpt of the offending region.

Then wire it so the commit path **cannot** call `putFile` without the validator returning `ok: true`. If repair also fails validation twice, transition the loop to `blocked` with a structured reason — never push the bad file.

### B. Fix loop terminal-state detection (`src/lib/hermes.server.ts`)

After CI failure, before flipping to `error`, re-query the PR:
- If `pr.merged === true` or `pr.state === "closed"` with merge_commit, transition to `completed` (with a note that CI failed but human merged).
- If `pr.state === "open"` and checks failed and attempts < max, continue to `repair_patch`.
- Only set `error` / `blocked` when none of the above apply.

Surface the distinction in `LoopControl.tsx`: the amber "Last loop ended in ERROR" banner becomes green "Merged with failing checks · review needed" when that path fires.

### C. Add a `research` phase before `patch` (`src/lib/hermes.server.ts`)

New optional phase inserted between `plan` and `draft_pr` that runs only when the plan's `proposed_change` mentions domain rules (game logic, protocol, spec, algorithm). It:

1. Asks the AI to produce 1-3 web search queries grounding the fix (e.g. "official Farkle scoring rules hot dice").
2. Calls the **Firecrawl** connector (`search` + `scrape` of the top 2 results in markdown).
3. Stores the distilled rules under `plan.research = { queries, sources: [{url, title, summary}], rules_extracted }`.
4. Includes `rules_extracted` verbatim in the system prompt for the patch step, so the AI patches **against** the documented rules instead of inventing behavior.

Requires the Firecrawl connector — I'll surface a one-time "Connect Firecrawl" prompt in the Forge ritual card if `FIRECRAWL_API_KEY` is not present, and fall back to skipping the phase when absent.

### D. UI: research + validation panels (`src/components/forge/LoopControl.tsx`)

- New collapsible "Research" panel under the diagnosis card showing the queries Hermes ran and the cited source URLs.
- The existing "Pre-commit validation" panel already exists; tighten it to show the rule name that fired (e.g. `LEADING_TRIPLE_QUOTE`, `TS_PARSE_ERROR`) so you can tell at a glance why a file was blocked.

## Files touched

- `src/lib/hermes.server.ts` — validator, terminal-state fix, research phase, prompt wiring
- `src/components/forge/LoopControl.tsx` — research panel, merged-with-failing-checks state, tightened validation labels
- (No DB migration — everything fits in existing `plan` / `checks_payload` JSON)

## Out of scope this round

- Touching `src/utils/gameLogic.ts` / `src/hooks/useGameState.ts` in the target repo — once Hermes is hardened and has research, you re-ignite a loop with the bug report "Selecting non-scoring dice should Farkle per official rules" and let the agent do it correctly.
- Auto-revert of the already-merged broken PR #5 in the target repo (manual revert in GitHub is faster).

## Acceptance

- A loop that tries to write `'''import ...` is blocked at validation, attempts one repair, and either commits a clean file or transitions to `blocked` — no `'''` ever reaches GitHub.
- A loop whose PR gets merged despite failing CI shows as `completed (merged with failing checks)`, not `ERROR`.
- A loop targeting a game-logic bug shows a "Research" panel citing the official rules source URL, and the patch prompt contains the extracted rules.
