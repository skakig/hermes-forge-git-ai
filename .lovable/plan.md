## What's actually happening

The screenshot is the **published** site (`hermes-forge-git-ai.lovable.app`). The in-app agent we built lives only in the preview build — published is still serving the old worker that calls an external Hermes API. That's why ignite fails with:

> `Invalid URL: HERMES_API_URL=https://kqhznlbpkxheyrgyqnvm.supabase.co/loops`

Two compounding problems:

1. **Stale published build.** The new 7-phase in-app agent (Lovable AI + GitHub API) was deployed to preview, not production.
2. **Malformed secret value.** The `HERMES_API_URL` secret was saved with the literal text `HERMES_API_URL=` glued to the front of the URL (full env-file line pasted as the value). Even on the old build it would have failed `new URL(...)`.
3. **Stale references remain in code.** `src/lib/github-app.functions.ts` (`checkHermesHealth`) and `src/routes/dashboard.settings.tsx` still mention `HERMES_API_URL` / `HERMES_API_KEY`. The new in-app agent doesn't need either.

## Plan

1. **Remove dead external-Hermes code path**
   - Delete `checkHermesHealth` from `src/lib/github-app.functions.ts` (no longer meaningful — agent runs in-app via Lovable AI).
   - Update `src/routes/dashboard.settings.tsx` to drop the `HERMES_API_URL` / `HERMES_API_KEY` row and replace it with a "Hermes engine: in-app (Lovable AI · Gemini 2.5 Pro)" status line.

2. **Delete the now-unused secrets**
   - `HERMES_API_URL` and `HERMES_API_KEY` from project secrets (so nothing on the server can accidentally read a malformed value again).

3. **Harden the ignite error surface**
   - In `pollLoopStatus` (`src/lib/hermes.functions.ts`), the `phase_failed` toast currently just bubbles `e.message`. Add a friendlier wrapper so the UI shows "Audit phase failed: …" instead of a raw stack. Already partially done — verify it doesn't truncate the real cause.
   - Confirm `runPhase` properly throws on missing `LOVABLE_API_KEY` with a clear hint.

4. **Republish**
   - After the code changes land, publish so `hermes-forge-git-ai.lovable.app` actually serves the in-app agent. Then ignite on `skakig/dice-strategy-oracle` with the dice-bug report and watch the 7 phases advance.

## Validation

- Settings page shows the new "in-app engine" line, no HERMES_API_URL row.
- A fresh ignite from the published URL advances past `audit → plan → draft_pr` and creates a draft PR on the repo within ~60s.
- No more `Invalid URL: HERMES_API_URL=...` events in `activity_events`.

## Out of scope

- Re-introducing any external Hermes service.
- Changes to the agent's prompting / patch logic (that's the next iteration once we confirm it runs end-to-end).
