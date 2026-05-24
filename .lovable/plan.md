## Goal

Make `/dashboard/repos` searchable, filterable, and visually best-in-class — built from the "Raycast commander" prototype the user picked. Frontend-only; no backend or server-fn changes.

## Scope

Files touched:
- `src/routes/dashboard.repos.tsx` — wire state, filtering, sorting, render new layout
- `src/components/forge/RepoCard.tsx` — rewrite to match the prototype card (icon tile, "Forge" badge, updated metadata row, full-width gradient CTA)
- `src/components/forge/RepoCommandBar.tsx` *(new)* — sticky glass command bar (search input + ⌘K hint, filter chips, sort dropdown)

No edits to backend, server functions, Topbar, Sidebar, or InstallationHealthCard.

## Command bar

Sticky container (`sticky top-4 z-30`), `bg-card/80 backdrop-blur-xl border border-border/60 rounded-2xl`. Two stacked rows:

1. **Search row** — search icon, input bound to `query` state with live fuzzy match on `full_name` and `owner`. `⌘K` kbd hint on the right; global keyboard listener focuses the input on ⌘K / Ctrl+K and clears on Esc.
2. **Filter row** — pill chips: `All`, `In Forge`, `Not added`, `Private`, `Public`. Active chip uses `bg-primary text-primary-foreground`; inactive use `text-muted-foreground hover:bg-white/5`. Right side: shadcn `DropdownMenu` for sort — options: `Recently updated`, `Stars`, `Name (A→Z)`, `Recently pushed` (uses `pushed_at` if present, falls back to `updated_at`, else name).

## Header

Replace the current header block with the prototype version: serif uppercase "REPOSITORIES" + tracking, subtitle with orange dot + counts (`N total`, `M in forge`, filtered count when filters active), and Grid/Dense view toggle on the right. Existing top buttons (Re-sync from GitHub, Install GitHub App, Refresh) move into a small overflow row above the command bar so the new design stays clean.

## Card redesign

Rewrite `RepoCard` to match the prototype:
- Top: icon tile (rounded square, `bg-white/5 border border-border/60`, package/cube lucide icon — turns orange-tinted on hover or when added)
- Top-right: stars (mono, small) and, if added, an uppercase `FORGE` badge (`bg-primary/10 text-primary border-primary/20`)
- Title: `font-mono text-sm text-foreground truncate` (full_name)
- Meta row: private/lock chip when private, branch with git-branch icon, "updated …" relative time from `updated_at` when available
- Action button: full-width inside the card. Not-added → ember gradient (`bg-gradient-to-r from-primary to-amber-500 text-primary-foreground active:scale-[0.98]`). Added → `bg-white/5 text-muted-foreground` with check icon and `In The Forge` label, `cursor-default disabled`.

Card container gains `hover:border-primary/30 transition-all`.

## Dense view

When view = `dense`, render a single-column list of rows (icon tile + name + meta inline + smaller action button on the right) instead of the grid. Same data, tighter spacing.

## Filtering & sorting logic

In `ReposPage`, derive `visibleRepos` with `useMemo`:
1. Start from `repos` (already loaded from `listInstallationRepos`).
2. Apply filter chip:
   - `inForge` → `connectedIds.has(r.full_name)`
   - `notAdded` → `!connectedIds.has(r.full_name)`
   - `private` / `public` → by `r.private`
3. Apply query: case-insensitive substring on `full_name` and `owner`.
4. Sort by selected key. Default = `Recently updated` (by `updated_at` desc; falls back to name if missing).

Show filtered count in subtitle ("12 of 66"). When `visibleRepos.length === 0`, render an empty state (dashed circle + search icon, message, "Reset filters" link).

## Tokens / no raw colors

All new styles use existing semantic tokens (`bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`, `text-primary`, `bg-primary`). The gradient reuses the existing `ember-gradient` utility from `styles.css` where possible; if a new gradient is needed for the CTA, add a `--gradient-ember-cta` token in `src/styles.css` and reference it. No hex literals in component files.

## Out of scope

- No changes to `RepoCommandBar`'s logic touching backend data (purely client-side filter over the already-loaded repo list).
- No changes to add/claim/reconcile flows.
- Language detection — the prototype shows a "Language" chip but the API response doesn't currently include language, so I'll either omit that chip or wire it to a placeholder grouping. Confirm preference, otherwise it ships as omitted in v1.

## Validation

- Type-check via build pipeline.
- Visually confirm sticky command bar, ⌘K focus, filter switching, empty state, dense toggle in preview.
