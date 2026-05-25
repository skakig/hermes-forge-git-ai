## What’s going wrong

The current agent did capture the Netlify failure, but the repair loop still has two major blind spots:

1. **The soft check is too weak.** The current `sanityCheck` only checks bracket balance and JSON. It will not catch `'''import ...` because that is balanced text but invalid TypeScript.
2. **The repair loop trusts the AI too much.** If the AI returns a corrupted file, Hermes skips only obvious structural issues. It does not run a real parser-style validation before pushing another commit.
3. **Diagnosis should produce deterministic fixes when logs are explicit.** In this case the log clearly says `src/hooks/useGameState.ts:1:2` and shows `'''import`. Hermes should route this into a precise repair step instead of asking the AI to infer everything.

## Best path forward

Build a local validation/repair pipeline inside Hermes before it pushes commits, then use Netlify/GitHub checks as the outer feedback loop.

```text
AI proposes edits
  -> Hermes validates edited files locally with soft checks
  -> if soft checks fail, Hermes asks AI to repair its own patch before committing
  -> commit only validated edits
  -> Netlify/GitHub runs full checks
  -> if checks fail, Hermes parses logs, patches, validates again, and repeats
  -> block only after max attempts with clear failure evidence
```

## Implementation plan

### 1. Replace the weak syntax gate with real soft checks

Add a stronger `validateFileContent` gate for files Hermes edits:

- For `.ts`, `.tsx`, `.js`, `.jsx`, use TypeScript’s parser via the `typescript` package already installed.
- Reject files with parse diagnostics before calling `putFile`.
- Add targeted corruption checks for common AI artifacts:
  - leading `'''`, ``` fences, or Markdown wrappers
  - files starting with `Here is...`
  - duplicate code-fence remnants
  - null bytes / replacement characters
- Keep JSON validation for `.json`.
- Add basic TOML/YAML heuristics for config files without adding heavy runtime dependencies.

This would have caught `'''import { useEffect }...` before the commit ever reached Netlify.

### 2. Add “repair the patch before commit”

If validation rejects an AI edit:

- Do not silently skip and continue.
- Feed Hermes the exact validation error plus the proposed broken file.
- Ask for a corrected full-file output once.
- Validate again.
- Only commit if the corrected file passes.
- If it still fails, move the loop to `blocked` with a clear reason instead of pushing broken code.

### 3. Parse explicit CI errors into repair targets

Enhance diagnosis so logs like this become deterministic repair context:

```text
/opt/build/repo/src/hooks/useGameState.ts:1:2: ERROR: Expected ";" but found "'import..."
1 | '''import { useEffect } from 'react';
```

Hermes should extract:

- file: `src/hooks/useGameState.ts`
- line: `1`
- column: `2`
- message: `Expected ";" but found...`
- visible snippet: `'''import...`

Then always include that file in `suspect_files`, even if the AI plan picked something else.

### 4. Make repair attempts build on the latest PR branch state

Keep the existing behavior of reading from the PR branch, but tighten it:

- Confirm suspect files exist on the PR branch.
- Prefer files mentioned in CI logs over prior suspect files.
- When the failure points to a Hermes-introduced syntax artifact, ask for a minimal revert/fix rather than another feature change.

### 5. Add agent self-improvement memory in the PR

Update `.hermes/plan.md` on every repair attempt with:

- latest failing check summary
- parsed root cause
- files changed in the repair
- validation results
- attempt count

This makes the PR explain what Hermes learned and how it improved the fix.

### 6. Improve dashboard visibility

In the loop UI, show a compact validation timeline:

- `Patch generated`
- `Soft checks failed: src/hooks/useGameState.ts:1:2 ...`
- `Patch repaired`
- `Soft checks passed`
- `Pushed commit`

That tells you whether the failure came from the repo itself or from Hermes producing invalid code.

## Why this is the right approach

Netlify should become the **outer truth source**, not the first validator. Hermes needs a cheap internal “preflight” layer before every commit so obvious syntax corruption is fixed immediately. Then the deployed checks handle deeper issues like missing packages, test failures, type errors, and runtime build configuration.

## What this will not solve immediately

This will not guarantee every PR passes on the first attempt. It will, however, prevent the worst class of failures: Hermes committing syntactically invalid files. For deeper failures, the loop will now have better evidence and a safer retry process.

## Files to change

- `src/lib/hermes.server.ts`
  - stronger validation
  - patch self-repair before commit
  - CI log error extraction
  - deterministic suspect-file override
  - `.hermes/plan.md` repair notes
- `src/lib/github-app.server.ts`
  - optionally improve Netlify log extraction if needed
- `src/components/forge/LoopControl.tsx`
  - show validation/repair evidence in the UI

No database migration is required if we store validation details in the existing `checks_payload` / `plan` JSON fields.