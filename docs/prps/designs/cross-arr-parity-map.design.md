# Cross-Arr Parity Map — Design (issue #14)

> Phase 2 UX & Onboarding · priority medium · parent #6 · related #24 (API Adapter Layer), #34 (Ecosystem Expansion)
> Single input to `/ycc:prp-plan`. Self-contained. All paths repo-relative.

## 1. Summary

Ship a visual, read-only **Cross-Arr Parity Map** that shows which configuration entities
(custom formats, quality profiles, quality definitions, delay profiles, metadata profiles) each
Arr app (Radarr / Sonarr / Lidarr) supports, and **flags the "same API shape, different domain
semantics" cases** the boolean capability grid hides (e.g. Lidarr audio-only qualities, Radarr-only
custom-format `quality_modifier`, delay-profile default-id divergence).

The design is **additive** on top of the existing capability registry
`packages/praxrr-app/src/lib/shared/arr/capabilities.ts` — it **never duplicates** the boolean
support facts. Entity support status is **derived** from `supportsArrSyncSurface(...)` via an
explicit total entity→surface bridge; only the `native` vs `shared` refinement and the
semantic-difference prose are net-new authored data.

It delivers **three of the issue's four components this PR** — parity matrix, semantic warnings, and
profile compatibility (on the standalone page) — and cleanly **defers** the inline profile-editor
indicator and apply-time interactive migration hints behind interfaces this PR establishes.

The winning approach is a **Live Parity Map — DB-Augmented Capability Registry**: the static matrix
and semantic catalog render with zero network round-trip from `$shared/arr/`, and per-profile
compatibility is computed live from the PCD cache by **reusing the exact
`qualityProfiles/list.ts` algorithm** (extracted once, delegated), so the map stays correct as PCD
ops change rather than showing misleading static full-parity.

---

## 2. Problem & Goals

### Why it matters (from issue #14)

Radarr, Sonarr, and Lidarr expose similar-looking APIs, but their **domain semantics diverge**. Users
building curated config (PCDs) have no way to see, before applying, that a config that "looks
portable" will behave differently — or be silently skipped — on another app. Concretely, the repo
already encodes these divergences but scatters them across ~7 server-only files, invisible to the
user:

- Lidarr qualities are **audio** (FLAC/MP3/AAC, `resolution:0`), fully disjoint from Radarr/Sonarr
  **video** qualities (`$sync/mappings.ts` `QUALITIES`; migration `20260216_enforce_native_lidarr_quality_mappings.ts`).
- Custom-format condition support is a **Lidarr whitelist**; `quality_modifier` is **Radarr-only**,
  `release_type` is **Sonarr-only**; indexer-flag **bit values differ per app**
  (`$sync/customFormats/transformer.ts`, `$sync/mappings.ts`).
- Delay-profile defaulting differs: Radarr/Sonarr write fixed `id=1`; Lidarr resolves the untagged
  lowest-`order` default at runtime (`$sync/delayProfiles/syncer.ts`).
- Metadata profiles are **Lidarr-only**; automated **upgrades** are **Radarr-only**; **rename** is
  unsupported on Lidarr (`capabilities.ts`).

### Goals

1. **Parity matrix** — entity × app grid with tri-state status (`native` / `shared` / `unsupported`).
2. **Semantic warnings** — a curated, per-`arr_type` catalog of shared-shape/divergent-semantics
   facts, lifted from the scattered server code into one client-importable module.
3. **Profile compatibility** — "which Arr apps can use this quality profile," computed live from the
   linked PCD, reusing the existing algorithm (not a reimplementation).
4. **Inform, never block** — everything is a badge/card/warning; nothing gates config.

### Non-functional goals

- **Single source of truth**: support facts are derived from `capabilities.ts`; the compatibility
  algorithm has exactly one implementation.
- **Cross-Arr Semantic Validation Policy compliance** (mandatory; see §4).
- Contract-first `/api/v1/*`; Svelte 5 legacy-event mode; Prettier per `.prettierrc.json`.

---

## 3. Non-Goals (explicitly deferred)

- **Inline profile-editor "Usable by" indicator** ("when editing a quality profile, show which Arr
  apps can use it"). The issue's literal "when editing" surface is **deferred**. This PR ships the
  reusable `CompatibilityBadges.svelte` component and renders per-profile compatibility on the
  standalone `/parity-map` page (a disclosed _partial_ fulfillment of component 3). Wiring the badge
  into the quality-profile editor's own `+page.server.ts` load is a drop-in follow-up.
- **Apply-time interactive migration hints** ("when a user tries to apply a config across incompatible
  apps, explain why and suggest alternatives"). MVP delivers the **data** for both halves — "explain
  why" (semantic-difference `detail` prose) and "suggest alternatives" (`suggestion` field, §5.3) —
  and renders them on the standalone page's warning cards. The **interactive apply/sync-path wiring**
  (an `alertStore.add('warning', …)` emitted when a user scopes/applies a profile to an incompatible
  app) is **deferred**. See §8.
- **Populating the empty `UNSUPPORTED_SYNC_SECTION_REASONS` / `UNSUPPORTED_MEDIA_MANAGEMENT_SUBSECTION_REASONS`
  maps** in `$sync/mappings.ts` from the shared catalog (the convergence plan so the parity map and
  the sync runtime share one truth). Deferred to keep this PR focused and avoid the camelCase↔snake_case
  bridge coupling; recorded as plan-of-record in §8.
- **Server-side consolidation** of the scattered semantic facts (`transformer.ts`, `delayProfiles/syncer.ts`,
  `mappings.ts`) into the shared catalog as the sync runtime's source.
- **DB-backed quality-name-level augmentation** of the matrix beyond per-profile verdicts (e.g.
  per-`quality_definitions` min/max/preferred-size diffs).
- **Ecosystem expansion** to Readarr/Whisparr (#34) and the #24 API Adapter Layer consuming the
  endpoint.
- **Pre-login / setup-wizard availability** (would require adding the route to `PUBLIC_PATHS` in
  `packages/praxrr-app/src/lib/server/utils/auth/middleware.ts`).

---

## 4. Cross-Arr Semantic Validation Compliance

This design honors the **MANDATORY** Cross-Arr Semantic Validation Policy structurally, not by
convention.

### Required checklist (Arr-touching change)

- [x] **API semantics verified per Arr app involved.** Every matrix cell resolves per explicit
      `arr_type` through `supportsArrSyncSurface(type, surface)` / `supportsArrWorkflow(...)`. The
      semantic-differences catalog is authored **per `arr_type`** (each entry names the exact apps it
      applies to) — never inferred from shared API shape.
- [x] **Schema/field mappings validated per Arr app involved.** Per-profile compatibility uses the
      **QUALITIES-filtered** reader: a `quality_api_mappings` row counts only when its `api_name` is
      present in `QUALITIES[arrType]` (mirroring `list.ts:66-82`), excluding transitional
      pre-`20260216` Sonarr-cloned Lidarr rows. `arr_type` is filtered by the known `ARR_APP_TYPES`
      set (the column is unconstrained `VARCHAR`, verified in `packages/praxrr-schema/ops/0.schema.sql`).
- [x] **Read/write/sync dispatch resolves by explicit `arr_type` (no implicit sibling fallback).** The
      support axis is derived from `capabilities.ts` per app; the compatibility predicate iterates
      `ARR_APP_TYPES` explicitly; the endpoint **fails fast with 400** on an unknown/`'all'`/invalid
      `databaseId` — no defaulting to a sibling app.
- [x] **Migration/import/export mappings defined per Arr app and fail-fast on ambiguity.** The
      `PARITY_ENTITY_TO_SYNC_SURFACE` bridge is a **total** `Record` (TS totality = compile-time
      fail-fast on an unmapped entity). `quality_definitions` is bridged **explicitly** to
      `media_management` (it is a media-management **subsection**, not a sync surface — verified: it is
      absent from `ARR_SYNC_SURFACES` and lives under `BASE_SYNC_MEDIA_MANAGEMENT_SUBSECTIONS`,
      `mappings.ts:27`). A test pins the parity axis to the server subsection taxonomy (§9).

### Anti-drift guarantees

- **Support cannot diverge from `capabilities.ts`** because it is _computed from_ it, not copied — no
  fourth boolean map (satisfies CLAUDE.md "define identifiers once").
- The authored `native`/`shared` refinement is grounded in **schema-observable fact** (per-app
  dedicated tables vs `arr_type`-discriminated shared tables) and pinned by a
  `PARITY_NON_REGRESSION_CHECK` as-const-satisfies-literal block (mirroring `capabilities.ts:168`).
- The compatibility algorithm has **one implementation** (`compatibility.ts`), consumed by both
  `list.ts` and the endpoint/page.

---

## 5. Data Model

### 5.1 Entity support axis (derived, not duplicated) — `$shared/arr/parity.ts`

New client-importable module. It **adds an entity axis** on top of the existing capability booleans;
it does **not** re-declare them.

```ts
// ParityEntity: the issue's five entities. quality_definitions is added explicitly
// because it is a media-management SUBSECTION, not an ArrSyncSurface.
export type ParityEntity =
  | 'custom_formats'
  | 'quality_profiles'
  | 'quality_definitions'
  | 'delay_profiles'
  | 'metadata_profiles';

export const PARITY_ENTITIES = [
  'custom_formats',
  'quality_profiles',
  'quality_definitions',
  'delay_profiles',
  'metadata_profiles',
] as const satisfies readonly ParityEntity[];

export type ArrEntitySupportStatus = 'native' | 'shared' | 'unsupported';

// TOTAL bridge → compile-time fail-fast on any unmapped entity.
export const PARITY_ENTITY_TO_SYNC_SURFACE = {
  custom_formats: 'custom_formats',
  quality_profiles: 'quality_profiles',
  quality_definitions: 'media_management', // subsection of media_management
  delay_profiles: 'delay_profiles',
  metadata_profiles: 'metadata_profiles',
} as const satisfies Record<ParityEntity, ArrSyncSurface>;

// The ONLY authored layer: native = per-app dedicated table; absence = shared table.
export const NATIVE_ENTITY_APPS: Record<
  ParityEntity,
  ReadonlySet<ArrAppType>
> = {
  custom_formats: new Set(), // shared arr_type-discriminated table
  quality_profiles: new Set(), // shared arr_type-discriminated table
  quality_definitions: new Set(['radarr', 'sonarr', 'lidarr']), // per-app *_quality_definitions tables
  delay_profiles: new Set(), // shared table (no arr_type column at all)
  metadata_profiles: new Set(['lidarr']), // Lidarr-only lidarr_metadata_profiles
};

export function getEntitySupportStatus(
  type: ArrAppType,
  entity: ParityEntity
): ArrEntitySupportStatus {
  const surface = PARITY_ENTITY_TO_SYNC_SURFACE[entity];
  if (!supportsArrSyncSurface(type, surface)) return 'unsupported';
  return NATIVE_ENTITY_APPS[entity].has(type) ? 'native' : 'shared';
}
```

**Resulting matrix** (derived, verified against `capabilities.ts`):

| entity              | radarr      | sonarr      | lidarr |
| ------------------- | ----------- | ----------- | ------ |
| custom_formats      | shared      | shared      | shared |
| quality_profiles    | shared      | shared      | shared |
| quality_definitions | native      | native      | native |
| delay_profiles      | shared      | shared      | shared |
| metadata_profiles   | unsupported | unsupported | native |

**Taxonomy rubric (RESOLVED — sign off in OQ1):**

- **native** = the app has a **dedicated per-app table** for the entity
  (`radarr_/sonarr_/lidarr_quality_definitions`; Lidarr-only `lidarr_metadata_profiles`).
- **shared** = an **`arr_type`-discriminated shared table** (`custom_formats`, `quality_profiles`,
  `delay_profiles`).
- **unsupported** = `supportsArrSyncSurface(type, surface) === false` (**derived**, never authored).

Deliberate decision: Lidarr `quality_profiles`/`quality_definitions` are **not** modeled as `native`
just because their values (audio) are disjoint — that value divergence is surfaced as a **semantic
warning** (§5.3), keeping the status rubric purely schema-shape-driven. `quality_definitions` is
`native` for all three because each app owns a dedicated table.

**Non-regression pin** (mirrors `capabilities.ts:168`): a `PARITY_NON_REGRESSION_CHECK` as-const
literal pins every `(entity × app)` verdict; a `void` block forces it at type-check time.

### 5.2 Semantic-differences catalog — `$shared/arr/semanticDifferences.ts`

Net-new authored prose (the empty `UNSUPPORTED_*_REASONS` maps at `mappings.ts:37,39` prove there is
no existing home). Each entry carries **source-file cross-reference comments** as the primary
anti-drift defense.

```ts
export type ParityScope = ParityEntity | ArrWorkflowSurface; // allows upgrades/rename warnings

export interface ArrSemanticDifference {
  id: string; // stable slug, e.g. 'delay-profile-default-resolution'
  scope: ParityScope; // entity or workflow the divergence belongs to
  apps: ArrAppType[]; // apps the note applies to (per arr_type, never inferred)
  severity: 'info' | 'warning';
  summary: string; // one-line headline
  detail: string; // "explain why" prose
  suggestion?: string; // "suggest alternatives" (migration-hint copy)
  sourceRefs: string[]; // repo-relative file[:symbol] anchors for drift audits
}

export const ARR_SEMANTIC_DIFFERENCES: ArrSemanticDifference[] = [/* … */];
```

**Concrete catalog entries** (seeded from verified server facts):

1. `delay-profile-default-resolution` — scope `delay_profiles`, apps `[radarr, sonarr, lidarr]`,
   **warning**. _Radarr/Sonarr write into the fixed default profile `id=1`; Lidarr resolves the
   active default at runtime (untagged profile with lowest `order`, fallback `id=1`) and merges the
   existing remote profile's id/order/tags. Applying the same PCD delay config targets a different
   profile on Lidarr._ suggestion: _Verify the Lidarr default delay profile after sync; do not assume
   id=1._ sourceRefs: `$sync/delayProfiles/syncer.ts:resolveTargetDelayProfile`.
2. `metadata-profiles-lidarr-only` — scope `metadata_profiles`, apps `[lidarr]`, **info**. _Only
   Lidarr has metadata profiles (`lidarr_metadata_profiles`); Radarr/Sonarr reject the section,
   enforced at capabilities, sync mappings, the route guard, and hard SQL `type='lidarr'` guards._
   sourceRefs: `capabilities.ts:LIDARR_CAPABILITIES.sync.metadata_profiles`,
   `$db/queries/arrSync.ts`.
3. `lidarr-quality-definitions-audio` — scope `quality_definitions`, apps `[radarr, sonarr, lidarr]`,
   **warning**. _`radarr_/sonarr_quality_definitions` carry resolution-based video qualities;
   `lidarr_quality_definitions` carry audio formats (`resolution:0`). Definitions cannot be shared
   across video and audio apps._ sourceRefs: `$sync/mappings.ts:QUALITIES`,
   `db/migrations/20260216_enforce_native_lidarr_quality_mappings.ts`.
4. `lidarr-quality-names-disjoint` — scope `quality_profiles`, apps `[radarr, sonarr, lidarr]`,
   **warning**. _A quality profile's enabled quality names must map through
   `quality_api_mappings ∩ QUALITIES[arrType]`; Lidarr's set is audio-only and disjoint from
   Radarr/Sonarr video, so a video-quality profile is not usable by Lidarr._ suggestion: _Use the
   per-profile compatibility view or maintain app-specific profiles._ sourceRefs:
   `$pcd/entities/qualityProfiles/list.ts`, `db/migrations/20260216_…ts`.
5. `custom-format-condition-support` — scope `custom_formats`, apps `[radarr, sonarr, lidarr]`,
   **warning**. _Lidarr supports only `release_title`, `release_group`, `indexer_flag`, `size`
   conditions; others are skipped. `quality_modifier` is Radarr-only; `release_type` is Sonarr-only.
   Indexer-flag bit values differ per app (internal=32 Radarr vs 8 Sonarr/Lidarr; scene=128 Radarr vs
   16 Sonarr/Lidarr). Language specs are effectively Lidarr-unsupported._ sourceRefs:
   `$sync/customFormats/transformer.ts:LIDARR_SUPPORTED_CONDITION_TYPES`, `$sync/mappings.ts:INDEXER_FLAGS`.
6. `upgrades-radarr-only` — scope `upgrades` (workflow), apps `[radarr]`, **info**. _Automated upgrade
   searches are implemented only for Radarr; Sonarr/Lidarr have `upgrades=false`._ sourceRefs:
   `capabilities.ts:workflows.upgrades`, `$upgrades/processor.ts`.
7. `rename-unsupported-lidarr` — scope `rename` (workflow), apps `[radarr, sonarr]`, **info**. _The
   rename workflow is supported by Radarr/Sonarr, not Lidarr (`rename=false`)._ sourceRefs:
   `capabilities.ts:workflows.rename`.
8. `profile-language-collapse` — scope `quality_profiles`, apps `[radarr, sonarr, lidarr]`, **info**.
   _Only Radarr profiles carry a real language; Sonarr and Lidarr profile language collapses to
   'Original' (id -2) at sync time._ sourceRefs: `$sync/mappings.ts:getLanguageForProfile`.

### 5.3 Per-profile compatibility (live, DB-derived)

`ProfileCompatibility { profileName: string; compatibleArrTypes: ArrAppType[]; basis: 'enabled-qualities' }`.

Computed by the **single extracted predicate** (§6.2). It derives compatibility from a profile's
**enabled** quality names mapped through `quality_api_mappings ∩ QUALITIES[arrType]`, with the
zero-enabled **arr-specific-score fallback** — exactly the `list.ts:59-163` semantics required by
CLAUDE.md's Arr Cutover Guardrails. It **never** trusts `quality_profile_custom_formats.arr_type='all'`
scores.

**enabled=1 caveat (surfaced in UI copy, per MUST-RESOLVE):** because compatibility is built from
**enabled** qualities plus the arr-specific-score fallback, a profile whose _incompatible_ qualities
are merely **disabled** reads as compatible, and an all-disabled profile hinges entirely on the
fallback. The `basis: 'enabled-qualities'` field drives verdict copy ("Usable by … based on enabled
qualities"), so verdicts are not over-trusted. This is a known collision with the guardrail wording
("profiles with all qualities disabled must still be considered against app-compatible quality
names") that the extracted predicate inherits from `list.ts`; the doc surfaces it rather than
silently changing behavior (OQ2).

---

## 6. Architecture

### 6.1 Component / data-flow sketch

```
                         STATIC TIER (client-importable, zero DB)
  $shared/arr/capabilities.ts ──derive──▶ $shared/arr/parity.ts (getEntitySupportStatus)
                                              │
  $shared/arr/semanticDifferences.ts ─────────┤
                                              ▼
                                   routes/parity-map/parityRows.ts (pure, Svelte-free)
                                              │
   ┌──────────────────────────────────────────┼───────────────────────────────────────┐
   ▼                                           ▼                                        ▼
routes/parity-map/ParityMatrix.svelte   SemanticDifferences.svelte      $ui/parity/CompatibilityBadges.svelte
   (Table.svelte + Badge status chips)   (warning cards, grouped)         (Usable by: Radarr · Sonarr chips)
   ▲                                                                                    ▲
   └───────────────── routes/parity-map/+page.svelte (legacy Svelte 5) ────────────────┘
                                              ▲
                    +page.server.ts load ─── reads optional ?databaseId= ───┐
                                                                            ▼
                         LIVE TIER (server-only, per databaseId)   pcdManager.getCache(id)
                                              │                             │
        $pcd/entities/qualityProfiles/compatibility.ts ◀── delegates ── list.ts (unchanged behavior)
        (computeCompatibleProfileNames / computeProfileCompatibility)
                                              ▲
   GET /api/v1/compatibility/parity/+server.ts (contract-first, static tier module-cached,
      DB tier only when ?databaseId= present; fail-fast 400 on invalid/unknown id)
```

Both the **page load** and the **API endpoint** consume the _same_ server helper
`computeProfileCompatibility(cache)` — compatibility is computed in exactly one place.

### 6.2 New shared + server modules

- `packages/praxrr-app/src/lib/shared/arr/parity.ts` — entity axis, tri-state derivation,
  non-regression pin (§5.1).
- `packages/praxrr-app/src/lib/shared/arr/semanticDifferences.ts` — catalog (§5.2).
- `packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/compatibility.ts` — the **single**
  compatibility surface, extracted verbatim from `list.ts:59-163`:
  - `computeCompatibleProfileNames(cache, arrType): Promise<Set<string>>` — lines 59-159 logic
    (QUALITIES-filtered mappings, enabled-quality intersection, arr-specific-score fallback).
  - `computeProfileCompatibility(cache): Promise<ProfileCompatibility[]>` — iterates `ARR_APP_TYPES`,
    inverts to per-profile `compatibleArrTypes[]`, sets `basis: 'enabled-qualities'`.
- `packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/list.ts` — **modified** to delegate:
  `const compatible = await computeCompatibleProfileNames(cache, arrType); profiles = profiles.filter(p => compatible.has(p.name));`
  Behavior-preserving; covered by a delegation-equivalence test (§9).

### 6.3 API v1 endpoint (contract-first)

`GET /api/v1/compatibility/parity` — optional `?databaseId=<id>`. Auth-gated by the global `/api`
handle (NOT added to `PUBLIC_PATHS`). Static tier module-cached (mirroring
`routes/api/v1/openapi.json/+server.ts`). PCD cache touched **only** when `databaseId` is present.

Response (`ParityMapResponse`):

```jsonc
{
  "entities": [
    "custom_formats",
    "quality_profiles",
    "quality_definitions",
    "delay_profiles",
    "metadata_profiles",
  ],
  "apps": ["radarr", "sonarr", "lidarr"],
  "matrix": {
    "radarr": { "custom_formats": "shared", "...": "..." },
    "sonarr": {},
    "lidarr": {},
  },
  "semanticDifferences": [
    {
      "id": "...",
      "scope": "...",
      "apps": [],
      "severity": "warning",
      "summary": "",
      "detail": "",
      "suggestion": "",
      "sourceRefs": [],
    },
  ],
  "profiles": [
    {
      "profileName": "HD Bluray",
      "compatibleArrTypes": ["radarr", "sonarr"],
      "basis": "enabled-qualities",
    },
  ], // ONLY when ?databaseId= present
}
```

Errors: `{ error: string }` — **400** on invalid/unknown `databaseId` (fail-fast, no sibling
fallback), **401** unauthenticated, **500** server error. **RESOLVED (OQ3):** `profiles` is present
**iff** `?databaseId=` is explicitly supplied; there is **no auto-resolve** of a linked DB. The page
and endpoint are symmetric — the page reads the same explicit `?databaseId=` from its own URL and
offers a database picker that navigates to `/parity-map?databaseId=<id>`.

**Contract-first steps** (mirroring the repo pipeline, `docs/api/v1/openapi.yaml` → generate → implement):

1. Author `docs/api/v1/paths/compatibility.yaml` (`getCompatibilityParity`, tag `compatibility`).
2. Author `docs/api/v1/schemas/compatibility.yaml` (`ParityMapResponse`, `ParityMatrixCell` or nested
   map, `ArrSemanticDifference`, `ProfileCompatibility`; reuse `ErrorResponse`).
3. Register in `docs/api/v1/openapi.yaml`: path `$ref`, each schema under `components.schemas` (note:
   `bundle-api.ts` only loads a schema file referenced by ≥1 root entry), and a `tags` entry.
4. `deno task generate:api-types` → regen `packages/praxrr-app/src/lib/api/v1.d.ts`, then **scrub the
   ~3300-line openapi-typescript version noise** (MEMORY: `v1dts-generator-drift`; CI does not gate
   it) so the diff is reviewable.
5. Implement `+server.ts` importing `components['schemas']['ParityMapResponse']` (mirror
   `routes/api/v1/arr/library/+server.ts`).
6. Re-run `deno run -A scripts/bundle-api.ts` for the JSR mirror
   (`packages/praxrr-api/openapi.json` + `packages/praxrr-api/types.ts`).

### 6.4 UI page, route, nav, color/icon

- **Route:** `packages/praxrr-app/src/routes/parity-map/+page.svelte` (top-level, no `databaseId`
  route param) + `+page.server.ts` load. Page shell mirrors `routes/settings/general/+page.svelte`:
  `<svelte:head><title>Parity Map - Praxrr</title></svelte:head>` + inline `h1`/`p` header. No shared
  PageHeader component exists.
- **Nav:** append **one** object to `NAV_REGISTRY` in
  `packages/praxrr-app/src/lib/server/navigation/registry.ts` under `ensureGroupId('overview')`,
  `href: '/parity-map'`, `arrScope: scopeAll`, `mobilePriority: 'medium'`, `hasChildren: false`,
  `iconKey: 'LayoutGrid'`, `emoji: '🗺️'`, and **`requiredFeature` UNSET** (the map is app-agnostic;
  setting it would hide the page under the arr-scope selector). The sidebar + mobile nav render from
  the registry generically — no `+layout.svelte`/`pageNav.svelte`/`resolver.ts` edits.
- **Icon (must-do):** import `LayoutGrid` from `lucide-svelte` and add it to `NAV_ICON_MAP` in
  `packages/praxrr-app/src/lib/client/navigation/iconMap.ts` (currently only 10 icons; an
  unregistered `iconKey` makes `resolveNavIcon` return `undefined` and the icon **silently vanishes**).
- **Matrix rendering:** `$ui/table/Table.svelte` with `Column<ParityRow>[]` and a
  `<svelte:fragment slot="cell" let:row let:column>` switch on `column.key` (`radarr`/`sonarr`/`lidarr`)
  rendering `<Badge>` status chips: **success=native, info=shared, warning=unsupported**. App-column
  headers use `getArrAppMetadata(type).label` + logo (`$lib/client/assets/{Radarr.svg,Sonarr.svg,Lidarr.png}`)
  - `var(--arr-<type>-color)` (`app.css:357-359`). Mirror `media-management/[databaseId]/quality-definitions/views/TableView.svelte`.
- **Svelte convention (must-do):** the repo uses Svelte 5 **legacy-event** mode — `export let`, `$:`,
  `on:click` directive, `$store`, `createEventDispatcher`. **No runes, no `onclick` attributes**
  (the task note is wrong for this repo; verified against `Badge.svelte`/`Button.svelte`/`Table.svelte`).
- **Prettier (must-do):** 2-space indent, single quotes, semicolons, es5 trailing commas, ~120 width
  (`.prettierrc.json` — NOT the tabs/100w in CLAUDE.md). Run `deno task format` before finishing. Do
  not copy tab indentation from older legacy components.

---

## 7. File-Level Plan (build order)

| #   | Path                                                                               | New/Mod        | Purpose                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `packages/praxrr-app/src/lib/shared/arr/parity.ts`                                 | New            | `ParityEntity` axis, tri-state derivation from `supportsArrSyncSurface` via total bridge, `NATIVE_ENTITY_APPS`, `getEntitySupportStatus`, `PARITY_NON_REGRESSION_CHECK`. |
| 2   | `packages/praxrr-app/src/lib/shared/arr/semanticDifferences.ts`                    | New            | `ArrSemanticDifference` type + `ARR_SEMANTIC_DIFFERENCES` catalog with `suggestion` + `sourceRefs`.                                                                      |
| 3   | `packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/compatibility.ts` | New            | Single compatibility surface: `computeCompatibleProfileNames` + `computeProfileCompatibility`, extracted verbatim from `list.ts:59-163`.                                 |
| 4   | `packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/list.ts`          | Mod            | Delegate to `computeCompatibleProfileNames` (behavior-preserving).                                                                                                       |
| 5   | `docs/api/v1/paths/compatibility.yaml`                                             | New            | `getCompatibilityParity` operation, tag `compatibility`.                                                                                                                 |
| 6   | `docs/api/v1/schemas/compatibility.yaml`                                           | New            | `ParityMapResponse`, `ArrSemanticDifference`, `ProfileCompatibility` schemas.                                                                                            |
| 7   | `docs/api/v1/openapi.yaml`                                                         | Mod            | Register path `$ref`, component schema `$refs`, `tags` entry.                                                                                                            |
| 8   | `packages/praxrr-app/src/lib/api/v1.d.ts`                                          | Regen          | `deno task generate:api-types`; scrub tool-version noise.                                                                                                                |
| 9   | `packages/praxrr-app/src/routes/api/v1/compatibility/parity/+server.ts`            | New            | `GET` handler: static tier module-cached + DB tier via `computeProfileCompatibility` when `?databaseId=`; fail-fast 400.                                                 |
| 10  | `packages/praxrr-app/src/routes/parity-map/parityRows.ts`                          | New            | Pure, Svelte-free matrix-row builder from `parity.ts` (unit-testable).                                                                                                   |
| 11  | `packages/praxrr-app/src/lib/client/ui/parity/CompatibilityBadges.svelte`          | New            | Reusable "Usable by: … " chip row (legacy Svelte); drop-in for the deferred inline editor.                                                                               |
| 12  | `packages/praxrr-app/src/routes/parity-map/ParityMatrix.svelte`                    | New            | Entity × app matrix via `Table.svelte` + status `Badge`s + per-app colored headers/logos.                                                                                |
| 13  | `packages/praxrr-app/src/routes/parity-map/SemanticDifferences.svelte`             | New            | Warning cards grouped by scope; renders `detail` + `suggestion`.                                                                                                         |
| 14  | `packages/praxrr-app/src/routes/parity-map/+page.svelte`                           | New            | Page shell composing matrix + semantic cards + (when DB linked) profile-compat table via `CompatibilityBadges`.                                                          |
| 15  | `packages/praxrr-app/src/routes/parity-map/+page.server.ts`                        | New            | Load: static tier always; reads optional `?databaseId=`, calls `computeProfileCompatibility(cache)`; DB picker options.                                                  |
| 16  | `packages/praxrr-app/src/lib/client/navigation/iconMap.ts`                         | Mod            | Import + register `LayoutGrid` in `NAV_ICON_MAP`.                                                                                                                        |
| 17  | `packages/praxrr-app/src/lib/server/navigation/registry.ts`                        | Mod            | Append one `overview` nav entry (`/parity-map`, `arrScope: all`, no `requiredFeature`).                                                                                  |
| 18  | `packages/praxrr-app/src/tests/arr/parityMap.test.ts`                              | New            | Per-`arr_type` tri-state truth table, bridge totality, axis↔subsection consistency, catalog invariants.                                                                  |
| 19  | `packages/praxrr-app/src/tests/pcd/qualityProfileCompatibility.test.ts`            | New            | Extracted-predicate + list.ts delegation-equivalence with in-memory `quality_api_mappings` fixture.                                                                      |
| 20  | `packages/praxrr-app/src/tests/routes/parityMapApi.test.ts`                        | New            | Endpoint status + shape + contract types (static and `?databaseId=` paths, 400 on bad id).                                                                               |
| 21  | `packages/praxrr-api/openapi.json`, `packages/praxrr-api/types.ts`                 | Regen          | `deno run -A scripts/bundle-api.ts` (JSR mirror).                                                                                                                        |
| 22  | `scripts/test.ts`                                                                  | Mod (optional) | Add `parity` alias to the aliases map for convenience.                                                                                                                   |

---

## 8. MVP Scope (this PR) vs Deferred

### MVP (this PR)

- **Parity matrix** — static, derived from `capabilities.ts` via `parity.ts`; standalone `/parity-map`
  page with `Table.svelte` + status `Badge`s + per-app color/icon.
- **Semantic warnings** — `semanticDifferences.ts` catalog (8 concrete entries covering delay
  profiles, metadata profiles, quality definitions, quality profiles/language, custom formats,
  upgrades, rename) rendered as warning cards, each showing `detail` ("explain why") and `suggestion`
  ("suggest alternatives").
- **Profile compatibility (standalone page)** — live per-profile `compatibleArrTypes` from the linked
  PCD (`?databaseId=`), via the **single extracted** `computeProfileCompatibility`, rendered with the
  reusable `CompatibilityBadges.svelte`; UI copy states "based on enabled qualities."
- **Contract-first API** — `GET /api/v1/compatibility/parity` (static tier + optional DB tier).
- **`list.ts` refactor** to delegate to the one compatibility surface (behavior-preserving, test-pinned).
- **Nav + icon wiring**, tests, format/lint/type-check green.

### Deferred (follow-up issues)

- **Inline quality-profile-editor "Usable by" indicator** — wire `CompatibilityBadges.svelte` into the
  editor's own `+page.server.ts` load using `computeProfileCompatibility` (no client round-trip, same
  algorithm). Component ships now; integration deferred.
- **Apply-time interactive migration hints** — emit `alertStore.add('warning', …)` from the shared
  catalog's `detail`/`suggestion` when a user scopes/applies a profile to an incompatible app; wire
  into the sync/apply flow (`routes/arr/[id]/sync/+page.server.ts` actions). Relates to #24.
- **Consolidate sync-runtime reasons** — populate the empty `UNSUPPORTED_SYNC_SECTION_REASONS` /
  `UNSUPPORTED_MEDIA_MANAGEMENT_SUBSECTION_REASONS` maps (`mappings.ts:37,39`) from the shared catalog
  via an explicit **camelCase `SectionType` ↔ snake_case `ParityEntity`** bridge with **fail-fast on
  ambiguity** (note: `custom_formats` has no `SectionType`; `quality_definitions` is a subsection).
  Plan-of-record convergence so the client catalog and sync runtime share one truth.
- **Server-side semantic-fact consolidation** (`transformer.ts`/`syncer.ts`/`mappings.ts` → shared
  catalog as sync's source).
- **DB-backed quality-name-level matrix augmentation** (per-`quality_definitions` size diffs, etc.).
- **Ecosystem expansion** (#34 Readarr/Whisparr) and **#24 adapter layer** consuming the endpoint.
- **Pre-login/setup-wizard availability** (add route to `PUBLIC_PATHS`).

---

## 9. Testing Strategy

Bare `Deno.test` + `@std/assert`, no framework. Run: `deno task test packages/praxrr-app/src/tests/arr/parityMap.test.ts`
(or add a `parity` alias in `scripts/test.ts` and run `deno task test parity`). Endpoint tests need
the `/// <reference path="../../app.d.ts" />` line (with the `eslint-disable-next-line` comment).
Verify handlers with `deno task lint` + `deno task check` (route dir is excluded from `deno fmt`).

### `tests/arr/parityMap.test.ts` (pure module — mirror `resolveArrTargets.test.ts` / `lidarrCapabilityGates.test.ts`)

- **Per-`arr_type` tri-state truth table:** assert `getEntitySupportStatus(app, entity)` for every
  `(entity × app)` with a 3rd message arg (e.g. `metadata_profiles` → `unsupported/unsupported/native`;
  `quality_definitions` → `native/native/native`; `custom_formats` → `shared/shared/shared`).
- **Bridge totality:** every `ParityEntity` has a `PARITY_ENTITY_TO_SYNC_SURFACE` mapping.
- **Axis ↔ capabilities consistency:** every `unsupported` cell equals
  `supportsArrSyncSurface(app, PARITY_ENTITY_TO_SYNC_SURFACE[entity]) === false` (guards against drift
  from `capabilities.ts`).
- **quality_definitions ↔ subsection pin (closes the future-app false-positive gap):** for each app,
  assert `getEntitySupportStatus(app, 'quality_definitions') !== 'unsupported'` **iff**
  `isMediaManagementSubsectionSupported(app, 'qualityDefinitions')` (imported from `$sync/mappings.ts`)
  — ties the parity axis to the server subsection taxonomy so a future app with `media_management=true`
  but no `qualityDefinitions` subsection fails the test.
- **Catalog invariants:** every `ARR_SEMANTIC_DIFFERENCES` entry references a valid `scope`
  (`ParityEntity` or `ArrWorkflowSurface`), has non-empty `apps` (all in `ARR_APP_TYPES`), non-empty
  `summary`/`detail`, and non-empty `sourceRefs`.
- **`parityRows.ts`:** row builder produces one row per `PARITY_ENTITIES` entry with correct
  per-app status.

### `tests/pcd/qualityProfileCompatibility.test.ts` (PCD-cache fixture — mirror `lidarrQualityMappingPrereqs.test.ts`)

- In-memory `Kysely<PCDDatabase>` over `@jsr/db__sqlite` `:memory:`; inline `CREATE TABLE
quality_api_mappings` + profile/qualities tables + rows per `arr_type`; `destroy()` in `finally`.
- Assert `computeCompatibleProfileNames`/`computeProfileCompatibility`: video-quality profile →
  `[radarr, sonarr]` not `lidarr`; audio-quality profile → `[lidarr]`; zero-enabled profile with an
  arr-specific score row → compatible via fallback; QUALITIES-filtered reader excludes a
  transitional pre-`20260216` Lidarr row.
- **Delegation-equivalence:** assert `list(cache, arrType)` returns the **same filtered profile set**
  before/after the refactor (load-bearing profile-filter path), covering both the enabled=1 path and
  the zero-enabled arr-specific-score fallback (`list.ts:135-159`).

### `tests/routes/parityMapApi.test.ts` (endpoint — mirror `uiPreferencesApi.test.ts`)

- `import { GET } from '../../routes/api/v1/compatibility/parity/+server.ts'`;
  `type GetEvent = Parameters<typeof GET>[0]`.
- No `databaseId` → 200 with `matrix` + `semanticDifferences`, **no** `profiles`.
- Valid `?databaseId=` (patched cache via `setCache`/`deleteCache` from `$pcd/database/registry.ts`) →
  200 with `profiles`.
- Invalid/unknown `databaseId` → 400 `{ error }` (fail-fast).
- Type response as `components['schemas']['ParityMapResponse']` to stay locked to the contract.

---

## 10. Risks & Mitigations

| Risk                                                                                                                  | Mitigation                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Multi-source drift** (a 4th boolean support map).                                                                   | Support is **derived** from `supportsArrSyncSurface`, never copied; only `native`/`shared` is authored and pinned by `PARITY_NON_REGRESSION_CHECK` + the axis↔capabilities consistency test.                                             |
| **Semantic catalog is hand-authored prose** with no automated tie to sync code.                                       | Per-entry `sourceRefs` cross-reference comments; structural-validity tests; recorded convergence plan (populate `UNSUPPORTED_*_REASONS` from the catalog). The consistency check binds only the family tri-state, not prose — disclosed. |
| **`quality_definitions` latent false-positive** (derived from coarser `media_management` for a future app).           | Bridge maps it explicitly to `media_management` **and** the subsection-pin test ties it to `isMediaManagementSubsectionSupported(app, 'qualityDefinitions')`; refine the bridge when a future app lacks the subsection.                  |
| **`list.ts` refactor regresses profile-list filtering** (load-bearing).                                               | Delegation-only change + delegation-equivalence test asserting identical output pre/post, including the fallback path.                                                                                                                   |
| **enabled=1 semantics** — disabled incompatible qualities read as compatible.                                         | `basis: 'enabled-qualities'` field drives "based on enabled qualities" UI copy; predicate never trusts `arr_type='all'` scores; collision with guardrail wording disclosed (OQ2).                                                        |
| **`quality_api_mappings.arr_type` unconstrained `VARCHAR`**; older DBs carry pre-`20260216` transitional Lidarr rows. | QUALITIES-filtered reader (`api_name ∈ QUALITIES[arrType]`) + filter `arr_type` by `ARR_APP_TYPES`; fail-fast 400 on `'all'`/unknown/invalid `databaseId`; no sibling fallback.                                                          |
| **`v1.d.ts` regen noise** (~3300 lines, CI ungated).                                                                  | Regenerate deliberately and scrub to a reviewable diff.                                                                                                                                                                                  |
| **Nav icon silently vanishes** if `iconKey` unregistered.                                                             | Register `LayoutGrid` in `NAV_ICON_MAP`; leave `requiredFeature` unset.                                                                                                                                                                  |
| **Svelte convention mismatch** (task note says runes/`onclick`).                                                      | New components use legacy `export let`/`$:`/`on:click`/`createEventDispatcher`, matching `Badge`/`Button`/`Table`.                                                                                                                       |
| **Prettier config confusion** (CLAUDE.md tabs/100w is wrong).                                                         | Follow `.prettierrc.json` (2-space/single-quote/semi/es5/~120w); `deno task format`.                                                                                                                                                     |
| **Bundled spec omission** — a schema file not `$ref`d by ≥1 root entry is dropped by `bundle-api.ts`.                 | Register every `compatibility.yaml` schema under root `components.schemas`; re-run `bundle-api.ts`.                                                                                                                                      |

---

## 11. Open Questions

1. **Taxonomy sign-off (OQ1):** Confirm the schema-shape rubric — `quality_profiles`/`quality_definitions`
   for Lidarr are `shared`/`native` per **table shape** (with audio disjointness surfaced as a
   semantic _warning_), rather than reclassifying them as `native` because their _values_ diverge. The
   design assumes shape-driven status; a reviewer preferring value-driven status would change the
   `quality_profiles` Lidarr cell to `native`.
2. **enabled=1 policy (OQ2):** The extracted predicate inherits `list.ts` semantics — a profile whose
   incompatible qualities are merely _disabled_ reads as compatible, and all-disabled profiles hinge
   on the arr-specific-score fallback. Confirm this is the intended live verdict (matching current
   `list.ts` behavior) versus CLAUDE.md's "all-disabled profiles must still be considered against
   app-compatible quality names." MVP preserves current behavior and surfaces "based on enabled
   qualities" copy; changing it would be a separate behavior change to `list.ts`.
3. **DB-tier surfacing (RESOLVED — confirm):** `profiles` is returned **iff** `?databaseId=` is
   explicitly supplied (no auto-resolve); the page mirrors this with a database picker. Confirm no
   auto-resolve of the "primary" linked DB is desired for onboarding ergonomics.
4. **`ProfileCompatibility` payload size:** for PCDs with many profiles, confirm returning all
   per-profile verdicts inline is acceptable, or whether the endpoint should paginate/lazy-load
   (MVP returns all; profiles count is typically small).
