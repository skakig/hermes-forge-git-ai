## Mission
Turn the marketing surface into a sellable product: real, distinct pages for **How it works**, **Features**, **Pricing**, plus a fixed **Connect a repository** CTA — all rendered in the existing cyber-desert / ember aesthetic at flagship-launch quality.

## Pages to ship

### 1. `/` — Landing (refined)
- Nav links rewired from `#how / #features / #pricing` (anchors that don't exist) to real routes `/how-it-works`, `/features`, `/pricing`.
- "Connect a repository" CTA → routes to `/dashboard/repos` (unauth users land on the sign-in screen first, then bounce to repos where the working OAuth button lives).
- Tighten the hero, add a "trusted by repos like" strip, an animated "loop" visualization band, and a final CTA section above the footer.

### 2. `/how-it-works` (new route)
Four-step ritual narrative — **Connect → Audit → Forge → Ship**. Each step gets:
- A large numbered glyph and ember-accented heading
- A short prose explanation
- A mini "what happens" panel (e.g. tree of files being audited, diff being written, PR being opened)
- A vertical ember timeline connecting all four steps with rune-grid backdrop
Closes with a CTA card → "Ignite the Forge".

### 3. `/features` (new route)
Twelve+ capability cards across three groups:
- **Autonomy** — background loops, goal alignment, multi-repo, scheduling
- **Craftsmanship** — clean branches, reasoned commits, critique reports, content QA
- **Trust & control** — scoped GitHub auth, PR-only writes, audit log, kill switch
Hero band uses a bento-grid layout (mixed sizes) so it feels editorial, not stock-cards.

### 4. `/pricing` (new route)
Three tiers in a desert-temple layout (center plan elevated):
- **Apprentice** — Free · 1 repo · 5 loops/mo · community goals
- **Forgemaster** — $29/mo · 10 repos · unlimited loops · priority queue · background mode
- **Sovereign** — $99/mo · unlimited repos · custom goals · SSO · audit export · priority support
Each card: feature checklist, plan-specific accent ring, "Start" button → `/dashboard/repos`. Below: short FAQ accordion (Stripe note: "Billing not wired yet — buttons route to onboarding").

## Shared chrome
- Extract the marketing header + footer into `src/components/marketing/MarketingShell.tsx` so all four public pages share identical nav with active states (TanStack `<Link>` + `activeProps`).
- Nav items: Home / How it works / Features / Pricing + right-side **Sign in** and ember **Ignite the Forge**.

## Visual system (no token drift)
Reuse existing tokens only: `ember-gradient`, `glass`, `rune-grid`, `text-glow`, `shadow-ember`, `drift`, `font-display`. Each page gets one distinct hero motif so they feel like a series, not a copy:
- How it works → vertical ember spine
- Features → bento grid w/ glowing rune corners
- Pricing → three obelisks rising from sand glow

## SEO
Per-page `head()` with unique title, description, og:title, og:description (route-architecture rule).

## Technical notes
- New route files: `src/routes/how-it-works.tsx`, `src/routes/features.tsx`, `src/routes/pricing.tsx`.
- New component: `src/components/marketing/MarketingShell.tsx` (header + footer + outlet-style children).
- `src/routes/index.tsx` updated to use MarketingShell and fixed CTAs.
- No backend changes; no new dependencies.
