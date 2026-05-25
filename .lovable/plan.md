## Goal
Make the Hermes `research` phase actually pull authoritative domain rules from the web (e.g. official Farkle rules) instead of relying solely on model training data.

## Steps

1. **Connect Firecrawl**
   - Use `standard_connectors--connect` with `connector_id: firecrawl` so `FIRECRAWL_API_KEY` is injected into the server runtime.

2. **Upgrade research phase in `src/lib/hermes.server.ts`**
   - Replace the existing optional Firecrawl branch with a real implementation:
     - Ask the model for 1–3 search queries grounded in the bug report + repo summary.
     - Call Firecrawl `search` (via REST against `https://api.firecrawl.dev/v2/search`) with `scrapeOptions: { formats: ['markdown'] }`, limit 3.
     - Distill the top results through the AI gateway into a `rules_extracted` block (concise bullet list, with source URLs).
     - Persist `plan.research = { queries, sources: [{url,title,summary}], rules_extracted, augmented: true }`.
   - If `FIRECRAWL_API_KEY` is missing, fall back to the current "model recall only" path and set `augmented: false` (already supported by the UI).
   - Inject `rules_extracted` verbatim into the patch system prompt (already wired).

3. **UI hint in `src/components/forge/LoopControl.tsx`**
   - When `FIRECRAWL_API_KEY` is unavailable, surface a small "Connect Firecrawl for web-verified rules" link inside the ritual card. Detect via a tiny serverFn `getResearchCapabilities` that returns `{ firecrawl: boolean }`.

4. **Verify**
   - Ignite a loop on the Farkle repo with bug report "Selecting non-scoring dice should bust the turn per official Farkle rules."
   - Confirm the Research panel shows queries, ≥1 source URL, `web-verified` badge, and that the merged PR's diff reflects the official rule (selected non-scoring dice → Farkle; all-6-scoring → hot dice reroll).

## Out of scope
- Touching `src/utils/gameLogic.ts` / `src/hooks/useGameState.ts` directly. Hermes does that after research.
- Reverting already-merged broken PR #5 (manual).
- Adding the SDK; using REST keeps the Worker bundle small and Worker-compatible.
