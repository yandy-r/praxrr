## UX Design

### Before

- No parity surface exists today: `NAV_REGISTRY` has no `/parity-map` entry — closest overview item is `Databases` (`registry.ts:68-80`); nothing lets a user see cross-Arr support at a glance.
- Cross-Arr divergences are invisible in the UI: support facts live only in server code (`capabilities.ts` `supportsArrSyncSurface`, `capabilities.ts:302-305`); semantic gaps (Lidarr audio qualities, Radarr-only `quality_modifier`, delay-profile default divergence) are scattered across `$sync/*` with no client render path.
- No "which apps can use this profile" answer anywhere; quality-profile app-compat is computed server-side in `qualityProfiles/list.ts` purely to *filter* sync selection, never displayed.
- Per-app visual language already exists but is unused for a matrix: `Badge` supports `radarr/sonarr/lidarr` variants driving `var(--arr-<type>-color)` (`Badge.svelte:27-45`); colors defined `app.css:357-359`; logos `$lib/client/assets/{Radarr.svg,Sonarr.svg,Lidarr.png}`.
- DB-scoped pages use auto-redirect, not an inline picker: `/score-simulator` reads `data.databases`, restores `localStorage` id, `goto('/score-simulator/{id}')`, else renders `EmptyState` "No Databases Linked" (`score-simulator/+page.svelte:14-46`).

### After

- New top-level `/parity-map` page reachable from the **Overview** nav group (one appended `NAV_REGISTRY` entry, `iconKey: 'LayoutGrid'`, `arrScope: 'all'`), rendering with zero network round-trip.
- Entity × app **matrix** via `Table.svelte`: rows = 5 entities, app columns headed by `getArrAppMetadata(type).label` + logo + `var(--arr-<type>-color)`; each cell a tri-state `Badge` — **success=native, info=shared, warning=unsupported**.
- **Semantic-difference cards** grouped by scope render the 8 curated warnings (`detail` = "explain why", `suggestion` = "suggest alternatives"), severity → `Badge` `warning`/`info`.
- When `?databaseId=` is supplied, a per-profile **"Usable by"** compatibility table appears (reusable `CompatibilityBadges.svelte` chip row), copy states "based on enabled qualities."
- A **database picker** on the page navigates to `/parity-map?databaseId=<id>`; with no DBs linked the profile section shows an `EmptyState`, while the static matrix/warnings still render.
- Everything informs, never blocks — no save/dirty flow, no gating; matches read-only settings-style shell (`<svelte:head><title>` + inline `h1`/`p`).

### Interaction Changes

| Touchpoint | Before | After | Notes |
| --- | --- | --- | --- |
| Nav discovery | No parity item; Overview group has only Databases (`registry.ts:68-80`) | New Overview entry `href:'/parity-map'`, `arrScope:'all'`, `requiredFeature` UNSET so arr-scope selector never hides it | Sidebar/mobile render generically from registry; no layout edits |
| Nav icon | `NAV_ICON_MAP` has 10 icons, no `LayoutGrid` (`iconMap.ts`) | Register `LayoutGrid`; unregistered `iconKey` → `resolveNavIcon` returns `undefined` → icon silently vanishes | Must-do wiring |
| Support visibility | Server-only booleans, never rendered | `Table.svelte` matrix; tri-state cell via `<slot name="cell" let:row let:column>` switch on `column.key` → `<Badge variant=success|info|warning>` | `Badge.svelte:19-30` variant map |
| Per-app identity | Badge app variants unused for a grid | Column headers use label (`getArrAppMetadata`, `capabilities.ts:284`) + logo asset + `var(--arr-<type>-color)` (`app.css:357-359`) | Metadata carries label/iconKey, not logo path; logos imported as assets |
| Semantic gaps | Scattered `$sync/*` code, invisible | Warning cards grouped by scope, `detail`+`suggestion`, severity badge | Static tier, no DB call |
| Profile compat | Only filters sync UI (`qualityProfiles/list.ts`) | Rendered "Usable by: Radarr · Sonarr" chips when `?databaseId=` present | Same extracted predicate; copy notes enabled-qualities basis |
| DB selection | Auto-redirect + localStorage (`score-simulator/+page.svelte:14-26`) | Explicit picker → `/parity-map?databaseId=<id>`; symmetric with endpoint; no auto-resolve | Page + API both read explicit id |
| Empty DB state | `EmptyState` replaces whole page (`score-simulator/+page.svelte:33-41`) | Static matrix/warnings still render; only profile section shows empty/unpicked state | Matrix independent of DB |
| User feedback | n/a on parity | Read-only page; apply-time `alertStore.add('warning', …)` (`store.ts:19`) deferred to sync-flow follow-up | MVP surfaces prose in cards, not alerts |
| Convention | — | Svelte 5 legacy events (`export let`/`$:`/`on:click`), NOT runes/`onclick`; Prettier `.prettierrc.json` (2-space/single-quote/semi/~120w) | Matches `Badge`/`Button`/`Table` |
