# Technical Specifications: trash-guide-sync-ux

## Executive Summary

The TRaSH Guide Sync backend stores entities in `trash_guide_entity_cache` keyed by source ID.
Entity listing pages (custom-formats, quality-profiles) currently operate within a single PCD
database scope, selected via URL-based tab navigation (`/custom-formats/{databaseId}`). The UX layer
needs to surface TRaSH-sourced entities alongside PCD entities across all listing pages, introduce
source-scoped filtering, and extend the Arr sync configuration UI to include TRaSH sources as a peer
selection target for quality profiles. The recommended approach is to introduce a unified "data
source" abstraction that wraps both PCD databases and TRaSH sources, use URL search params for
filter persistence, and build a reusable `SourceFilter` component.

## Architecture Design

### Component Diagram

```
+-------------------------------------------+
|  Entity Listing Page (e.g. custom-formats) |
|                                           |
|  +---------------------------------------+|
|  | SourceTabs (PCD dbs + TRaSH sources)  ||
|  +---------------------------------------+|
|  | ActionsBar                            ||
|  |  [SearchAction] [SourceFilter] [View] ||
|  +---------------------------------------+|
|  | TableView / CardView                  ||
|  |   (unified entity rows w/ source badge)||
|  +---------------------------------------+|
+-------------------------------------------+
         |                    |
   +-----v------+    +-------v--------+
   | PCD Cache   |    | TRaSH Entity   |
   | (in-memory  |    | Cache (SQLite  |
   |  SQLite)    |    |  app DB)       |
   +-------------+    +----------------+
```

### Filter State Management

**Recommendation: URL search params** for source filtering, **localStorage** for view preference
persistence (already established pattern).

- **Source filter**: `?source=pcd:{id}` or `?source=trash:{id}` or `?source=all`. Persisted in URL
  for shareability and browser back/forward navigation. Falls back to localStorage-stored last
  selection if no URL param is present.
- **Search query**: Already persisted via `getPersistentSearchStore` to localStorage by key. No
  change needed.
- **View mode**: Already persisted via `createDataPageStore` to localStorage. No change needed.

Rationale: The existing Tabs component already uses `href`-based navigation for database switching
(`/custom-formats/{databaseId}`). Source filtering via URL params follows this same pattern. The
page load function can read URL params to determine which entities to load from which data source.

### Data Flow

```
1. Page load (server):
   +page.server.ts reads params.databaseId OR url.searchParams.source
   -> Loads PCD databases via pcdManager.getAll()
   -> Loads TRaSH sources via trashGuideManager.listSources()
   -> Loads entities from selected source(s)
   -> Returns { databases, trashSources, entities, currentSource }

2. Client:
   +page.svelte receives data
   -> Builds unified source tabs from databases + trashSources
   -> createDataPageStore manages search/view
   -> SourceFilter component applies client-side source sub-filtering
   -> TableView/CardView render entities with source badges
```

### New Components

- **`SourceFilter`**: Reusable dropdown/toggle that lets users filter visible entities by source
  type (`All`, `PCD: {name}`, `TRaSH: {name}`). Placed in ActionsBar alongside SearchAction. Emits
  selected source IDs. Used on custom-formats, quality-profiles, and potentially delay-profiles
  listing pages.

- **`SourceBadge`**: Small inline indicator showing which data source an entity comes from. Used in
  table/card row renders. Wraps existing `Badge` component with source-type-specific variant.

- **`SourceTabs`**: Extended version of existing database Tabs pattern that renders both PCD
  databases and TRaSH sources as tabs. Replaces current `data.databases.map(db => ...)` tab
  generation.

### Integration Points

- **`pcdManager`** (existing) <-> **Load functions**: Already provides `getAll()` and `getCache()`.
  No changes to the PCD layer.
- **`trashGuideManager`** (existing) <-> **Load functions**: Already provides `listSources()` and
  `getSource()`. Entity data comes from `trashGuideEntityCacheQueries`.
- **`createDataPageStore`** (existing) <-> **Filtering**: The store already supports `searchKeys`
  and debounced queries. Source filtering is layered on top as an additional filter dimension.
- **`arrSyncQueries`** (existing) <-> **Sync page**: The sync page `+page.server.ts` already loads
  `databasesWithProfiles`. TRaSH sources need to be loaded as a parallel data set and presented in
  the same QualityProfiles component.
- **`trashGuideSyncQueries`** (existing) <-> **Sync page**: Already provides
  `getConfigsByInstance()`, `getSelections()`, `setSelections()`. These are the persistence layer
  for TRaSH sync selections.

## Data Models

### Source Abstraction

A unified source type is needed client-side. The `databases/types.ts` file already defines
`UnifiedDatabaseItem` with a discriminated union (`type: 'pcd' | 'trash'`). This pattern should be
extended or reused for entity listing pages.

```typescript
// Proposed: shared source identifier type
type SourceRef =
  | { type: 'pcd'; id: number; name: string }
  | {
      type: 'trash';
      id: number;
      name: string;
      arrType: TrashGuideSupportedArrType;
    };
```

### Entity Source Decoration

PCD entities (`CustomFormatTableRow`, `QualityProfileTableRow`) do not currently carry source
information because they are scoped to a single database via the URL. When multiple sources are
loaded, each entity needs a source reference attached.

```typescript
// Extended entity row with source info
interface SourcedEntity<T> {
  source: SourceRef;
  entity: T;
}
```

### Query Changes

- **`trashGuideEntityCacheQueries.getBySourceAndType(sourceId, entityType)`**: Already exists.
  Returns `TrashGuideEntityCache[]` with `name`, `trashId`, `entityType`, `jsonData`.
- **`customFormatQueries.list(cache)`**: Already exists for PCD. Returns `CustomFormatTableRow[]`.
- **`qualityProfileQueries.list(cache, arrType?)`**: Already exists for PCD. Returns
  `QualityProfileTableRow[]`.
- **No new queries needed for phase 1.** Entity loading is already possible from both sources. The
  gap is only at the load function and UI layers.

### TRaSH Entity to Display Type Mapping

TRaSH entities stored in `trash_guide_entity_cache.json_data` use TRaSH-native schemas (e.g.,
`TrashGuideCustomFormatEntity`, `TrashGuideQualityProfileEntity`). These are structurally different
from PCD display types (`CustomFormatTableRow`, `QualityProfileTableRow`).

**Decision needed:** Either (a) define transformer functions that map TRaSH entities to PCD display
types for unified table rendering, or (b) create parallel TRaSH-specific table row types and teach
view components to handle both.

**Recommendation:** Option (a) -- transformer functions. This keeps view components simple and the
existing Column definitions reusable. The transformer handles the impedance mismatch.

## API Design

### Modified Endpoints

No existing API endpoints need filter parameter additions for the initial UX layer. The listing
pages use SvelteKit `load` functions (server-side data loading), not client-side API calls.

### Existing Relevant API Endpoints

- `GET /api/v1/trash-guide/sources` -- List all TRaSH sources. Already exists.
- `GET /api/v1/trash-guide/sources/{id}` -- Get single TRaSH source. Already exists.
- `GET /api/v1/trash-guide/sources/{id}/entities` -- List cached entities for a source. Already
  exists. Supports `?type=`, `?search=`, pagination.
- `GET /api/v1/trash-guide/sources/{id}/sync` -- Trigger sync. Already exists.

### New Endpoints (if any)

None required for phase 1. Load functions handle data fetching.

**Phase 2 consideration:** If client-side lazy loading of TRaSH entities is needed (e.g., for large
entity sets), a unified `/api/v1/entities` endpoint with `?source=pcd:{id}&source=trash:{id}`
filters could be introduced. But the initial implementation should use load functions.

### Response Format Changes

None for existing endpoints. The TRaSH entity cache API already returns sufficient data. For the
sync page, the load function needs to be extended to include TRaSH source quality profiles alongside
PCD quality profiles.

## UI Component Design

### Source Filter Component

**Location:** `packages/praxrr-app/src/lib/client/ui/actions/SourceFilter.svelte`

```
Props:
  - sources: SourceRef[]           -- Available sources to filter by
  - selected: SourceRef[] | 'all'  -- Currently selected sources
  - onchange: (selected) => void   -- Callback when selection changes

Behavior:
  - Renders as an ActionButton with filter icon
  - On click, shows dropdown with checkboxes:
    [x] All Sources
    ---
    [x] Praxrr-DB (PCD)
    [ ] TRaSH Radarr (TRaSH)
    [x] TRaSH Sonarr (TRaSH)
  - "All Sources" acts as select/deselect all toggle
  - Each source shows type badge (PCD / TRaSH) and arrType badge if TRaSH
  - Selection persisted to localStorage with page-specific key
```

Follows the pattern of the existing `SearchFilterAction` component (hover-reveal dropdown with
checkboxes). The `SearchFilterAction` at
`packages/praxrr-app/src/routes/custom-formats/[databaseId]/components/SearchFilterAction.svelte` is
a direct precedent.

### Source Badge Component

**Location:** `packages/praxrr-app/src/lib/client/ui/badge/SourceBadge.svelte`

```
Props:
  - source: SourceRef

Renders:
  - For PCD: <Badge variant="neutral">PCD</Badge> <span>{source.name}</span>
  - For TRaSH: <Badge variant="accent">TRaSH</Badge> <Badge variant={arrType}>{Radarr|Sonarr}</Badge>
```

Uses existing `Badge` component variants (`neutral`, `accent`, `radarr`, `sonarr`).

### Search Enhancement

The existing `SearchAction` + `createDataPageStore` pattern handles text search. Source-aware search
requires:

1. **No change to SearchAction component.** It remains a text input.
2. **Filtering logic change in the page.** After text filtering, apply source filter as a second
   pass. This is already the pattern used in custom-formats where `filterFormats()` does custom
   multi-field filtering on top of the data page store.
3. **Source badge in search results.** Table/card views should show the source badge next to entity
   names when multiple sources are visible.

### Arr Sync Configuration Changes

The sync page at `/arr/[id]/sync` currently loads PCD databases and their quality profiles. TRaSH
sources need to be added as a parallel section.

**Current QualityProfiles.svelte structure:**

```
{#each databases as database}
  <h3>{database.name}</h3>
  {#each database.qualityProfiles as profile}
    <Toggle ... />
  {/each}
{/each}
```

**Extended structure:**

```
<!-- PCD Sources -->
{#each databases as database}
  <h3><Badge variant="neutral">PCD</Badge> {database.name}</h3>
  {#each database.qualityProfiles as profile}
    <Toggle ... />
  {/each}
{/each}

<!-- TRaSH Sources -->
{#each trashSources as source}
  <h3><Badge variant="accent">TRaSH</Badge> {source.name}</h3>
  {#each source.qualityProfiles as profile}
    <Toggle ... />
  {/each}
{/each}
```

The save action for TRaSH sync selections uses `trashGuideSyncQueries.setSelections()` instead of
`arrSyncQueries.saveQualityProfilesSync()`. This means the QualityProfiles component needs to track
two separate selection states and dispatch to two separate save endpoints.

**Key constraint:** `trashGuideSyncQueries.assertScope()` enforces that the instance `arr_type` must
match the source `arr_type`. The load function must filter TRaSH sources to only show those matching
the instance's type.

### Navigation Changes

**Tabs pattern change:** Entity listing pages currently use database tabs
(`/custom-formats/{databaseId}`). With multi-source support, tabs should expand to include TRaSH
sources.

**Option A (recommended for phase 1):** Keep existing URL structure. Add TRaSH sources as additional
tabs with a distinct URL segment: `/custom-formats/trash/{sourceId}`. The load function
distinguishes PCD vs TRaSH by presence of `trash` in the path.

**Option B:** Replace tabs with a source selector dropdown when more than 3 total sources exist.
This prevents tab overflow.

**Recommendation:** Option A first, with responsive dropdown fallback (the Tabs component already
supports this via `responsive` prop). If > 5 sources, collapse to dropdown automatically.

## Codebase Changes

### Files to Create

- `/packages/praxrr-app/src/lib/client/ui/actions/SourceFilter.svelte` -- Reusable source filter
  dropdown component
- `/packages/praxrr-app/src/lib/client/ui/badge/SourceBadge.svelte` -- Source type indicator badge
- `/packages/praxrr-app/src/lib/shared/sources/types.ts` -- Shared source reference types
- `/packages/praxrr-app/src/lib/shared/sources/transform.ts` -- TRaSH entity to PCD display type
  transformers
- `/packages/praxrr-app/src/routes/custom-formats/trash/[sourceId]/+page.server.ts` -- TRaSH custom
  formats listing load function
- `/packages/praxrr-app/src/routes/custom-formats/trash/[sourceId]/+page.svelte` -- TRaSH custom
  formats listing page
- `/packages/praxrr-app/src/routes/quality-profiles/trash/[sourceId]/+page.server.ts` -- TRaSH
  quality profiles listing load function
- `/packages/praxrr-app/src/routes/quality-profiles/trash/[sourceId]/+page.svelte` -- TRaSH quality
  profiles listing page

### Files to Modify

- `/packages/praxrr-app/src/routes/custom-formats/+page.server.ts` -- Add
  `trashGuideManager.listSources()` to load
- `/packages/praxrr-app/src/routes/custom-formats/+page.svelte` -- Extend redirect logic to include
  TRaSH sources
- `/packages/praxrr-app/src/routes/custom-formats/[databaseId]/+page.svelte` -- Add source badge to
  tab generation, merge TRaSH sources into tabs list
- `/packages/praxrr-app/src/routes/quality-profiles/+page.server.ts` -- Add
  `trashGuideManager.listSources()` to load
- `/packages/praxrr-app/src/routes/quality-profiles/+page.svelte` -- Extend redirect logic
- `/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/+page.svelte` -- Add source badge,
  merge TRaSH sources into tabs
- `/packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts` -- Load TRaSH sources and their
  quality profiles for the instance's arr_type
- `/packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte` -- Manage TRaSH sync selection state
  alongside PCD state
- `/packages/praxrr-app/src/routes/arr/[id]/sync/components/QualityProfiles.svelte` -- Render TRaSH
  source profiles section, dual save path
- `/packages/praxrr-app/src/routes/custom-formats/[databaseId]/views/TableView.svelte` -- Add
  optional source badge column
- `/packages/praxrr-app/src/routes/custom-formats/[databaseId]/views/CardView.svelte` -- Add
  optional source badge
- `/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/views/TableView.svelte` -- Add
  optional source badge column
- `/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/views/CardView.svelte` -- Add
  optional source badge

## Technical Decisions

### Decision 1: Unified vs Separate Listing Routes for TRaSH Entities

- **Options:**
  - A: Create separate `/custom-formats/trash/[sourceId]` routes for TRaSH entity listings
  - B: Extend existing `/custom-formats/[databaseId]` to accept both PCD and TRaSH IDs via a type
    discriminator
  - C: Create a unified `/custom-formats` route that loads all sources and filters client-side

- **Recommendation:** Option A
- **Rationale:** Keeps PCD and TRaSH load logic cleanly separated. PCD entities come from in-memory
  SQLite caches; TRaSH entities come from app DB `trash_guide_entity_cache`. Mixing them in a single
  route param would require complex type detection. Separate routes also allow TRaSH-specific UI
  affordances (e.g., showing TRaSH ID, score profiles) without polluting PCD views. Tabs can link
  across both route trees seamlessly since the Tabs component accepts arbitrary `href` values.

### Decision 2: Source Filter State Persistence

- **Options:**
  - A: URL search params (`?source=trash:1,pcd:2`)
  - B: Svelte store + localStorage
  - C: Component-level state only (reset on navigation)

- **Recommendation:** Option B (localStorage-backed store)
- **Rationale:** URL params would make sense for a single flat listing, but entity pages already use
  URL path segments for source selection (tabs). Adding query params for sub-filtering within a tab
  would create two competing filter dimensions. A localStorage-backed store per page (like
  `customFormatsView` for view mode) is simpler and matches the existing pattern. The initial source
  tab selection (which source to view) stays URL-based; any cross-source filtering (if needed later)
  can be a client-side overlay.

### Decision 3: TRaSH Entity Display Type Mapping

- **Options:**
  - A: Map TRaSH entities to existing PCD display types (`CustomFormatTableRow`,
    `QualityProfileTableRow`) for unified rendering
  - B: Create parallel TRaSH-specific row types and dual-mode view components
  - C: Create a new shared row type that both PCD and TRaSH map into

- **Recommendation:** Option C
- **Rationale:** Option A forces TRaSH entities into PCD shapes that may not fit (PCD entities have
  `id` as integer from cache table, TRaSH uses `trashId` as UUID string). Option B doubles view
  component complexity. A shared display row type that captures the superset of fields needed for
  listing views (name, description, tags, source badge, entity type) keeps views simple while being
  source-agnostic. Fields specific to one source type are optional.

### Decision 4: Arr Sync Page -- Integrated vs Sectioned TRaSH Sources

- **Options:**
  - A: Interleave TRaSH quality profiles alongside PCD profiles in the same section with source
    badges
  - B: Separate "PCD Profiles" and "TRaSH Profiles" sections with distinct save buttons
  - C: Tabbed sub-sections within the Quality Profiles card

- **Recommendation:** Option B
- **Rationale:** PCD and TRaSH sync selections persist to completely different tables
  (`arr_sync_quality_profiles` vs `trash_guide_sync_selections`). They have different save endpoints
  and different sync triggers. Interleaving them visually but separating them logically would
  confuse users when save actions behave differently. Distinct sections with clear "PCD" / "TRaSH"
  headers and independent Save/Sync buttons match the existing sync page pattern where each entity
  type (Quality Profiles, Delay Profiles, Media Management) is its own card with its own SyncFooter.

### Decision 5: TRaSH Source Visibility in Entity Tabs

- **Options:**
  - A: Show all TRaSH sources alongside PCD databases in entity page tabs regardless of entity type
    availability
  - B: Only show TRaSH sources that have cached entities of the relevant type

- **Recommendation:** Option B
- **Rationale:** A TRaSH source with 0 custom formats should not appear as a tab on the
  custom-formats page. The `trashGuideEntityCacheQueries.getBySourceAndType()` query already
  supports filtering by entity type. The load function can check `entityCounts` from
  `TrashGuideSourceResponse` to determine visibility.

## Relevant Files

### Core Data Layer (Server)

- `/packages/praxrr-app/src/lib/server/db/queries/trashGuideSources.ts` -- TRaSH source CRUD queries
- `/packages/praxrr-app/src/lib/server/db/queries/trashGuideEntityCache.ts` -- TRaSH entity cache
  queries (getBySource, getBySourceAndType, searchByName)
- `/packages/praxrr-app/src/lib/server/db/queries/trashGuideSync.ts` -- TRaSH sync config and
  selection queries
- `/packages/praxrr-app/src/lib/server/db/queries/trashIdMappings.ts` -- TRaSH ID to entity name
  mapping queries
- `/packages/praxrr-app/src/lib/server/db/queries/arrSync.ts` -- PCD Arr sync queries (quality
  profiles, delay profiles, media management)
- `/packages/praxrr-app/src/lib/server/trashguide/manager.ts` -- TRaSH guide manager (listSources,
  getSource, sync)
- `/packages/praxrr-app/src/lib/server/trashguide/types.ts` -- TRaSH entity type definitions
  (TrashGuideCustomFormatEntity, TrashGuideQualityProfileEntity, etc.)
- `/packages/praxrr-app/src/lib/server/pcd/index.ts` -- PCD public API (pcdManager, getCache,
  canWriteToBase)

### Entity Listing Routes

- `/packages/praxrr-app/src/routes/custom-formats/+page.svelte` -- Custom formats root redirect page
- `/packages/praxrr-app/src/routes/custom-formats/[databaseId]/+page.server.ts` -- PCD custom
  formats listing load function
- `/packages/praxrr-app/src/routes/custom-formats/[databaseId]/+page.svelte` -- PCD custom formats
  listing page (Tabs + ActionsBar + views)
- `/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/+page.server.ts` -- PCD quality
  profiles listing load function
- `/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/+page.svelte` -- PCD quality
  profiles listing page

### Sync Configuration Routes

- `/packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts` -- Arr sync page load function
  (loads PCD databases with profiles)
- `/packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte` -- Arr sync configuration page
  (manages all sync sections)
- `/packages/praxrr-app/src/routes/arr/[id]/sync/components/QualityProfiles.svelte` -- Quality
  profile multi-select with Toggle grid
- `/packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncFooter.svelte` -- Trigger/save/sync
  footer bar

### Databases Page

- `/packages/praxrr-app/src/routes/databases/+page.server.ts` -- Databases listing (already loads
  both PCD + TRaSH)
- `/packages/praxrr-app/src/routes/databases/+page.svelte` -- Unified databases listing UI
- `/packages/praxrr-app/src/routes/databases/types.ts` -- UnifiedDatabaseItem discriminated union
- `/packages/praxrr-app/src/routes/databases/trash/[id]/+page.svelte` -- TRaSH source detail page

### UI Components

- `/packages/praxrr-app/src/lib/client/ui/navigation/tabs/Tabs.svelte` -- Tab bar component
  (supports responsive mode, icons)
- `/packages/praxrr-app/src/lib/client/ui/actions/ActionsBar.svelte` -- Actions bar container
- `/packages/praxrr-app/src/lib/client/ui/actions/SearchAction.svelte` -- Search input component
- `/packages/praxrr-app/src/lib/client/ui/actions/ViewToggle.svelte` -- Table/cards view toggle
- `/packages/praxrr-app/src/lib/client/ui/badge/Badge.svelte` -- Badge component (supports radarr,
  sonarr, lidarr, accent, neutral variants)
- `/packages/praxrr-app/src/lib/client/ui/table/Table.svelte` -- Reusable data table with sorting,
  pagination, row actions
- `/packages/praxrr-app/src/lib/client/ui/table/types.ts` -- Column definition types
- `/packages/praxrr-app/src/lib/client/ui/toggle/Toggle.svelte` -- Toggle/checkbox component

### Stores

- `/packages/praxrr-app/src/lib/client/stores/dataPage.ts` -- Data page store (search + view +
  filtered items)
- `/packages/praxrr-app/src/lib/client/stores/search.ts` -- Search store with debounce, filters,
  persistent variants
- `/packages/praxrr-app/src/lib/client/stores/navScope.ts` -- Navigation scope store (Arr type
  filter)

### Shared Types

- `/packages/praxrr-app/src/lib/shared/pcd/display.ts` -- PCD display types (CustomFormatTableRow,
  QualityProfileTableRow)
- `/packages/praxrr-app/src/lib/shared/pcd/types.ts` -- PCD generated types (ArrType, ArrAppType)
- `/packages/praxrr-app/src/lib/shared/arr/capabilities.ts` -- Arr app metadata, capability checks

### TRaSH Guide API

- `/packages/praxrr-app/src/routes/api/v1/trash-guide/sources/+server.ts` -- TRaSH sources CRUD
  endpoint
- `/packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/+server.ts` -- Single TRaSH
  source endpoint
- `/packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/entities/+server.ts` -- TRaSH
  entity listing with pagination/filtering
- `/packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/sync/+server.ts` -- TRaSH sync
  trigger endpoint

## Architectural Patterns

- **Database-scoped routing**: Entity listing pages use `[databaseId]` path params to scope to a
  single PCD database. The load function validates the ID, loads the database cache, then queries
  entities from that cache. This pattern should be mirrored for TRaSH sources via `trash/[sourceId]`
  path segments.
- **Tab-based source switching**: Databases render as tabs with `href` links. Tab click triggers a
  full page navigation via SvelteKit link. The active tab is determined by comparing
  `db.id === data.currentDatabase.id`. TRaSH source tabs can use the same mechanism with different
  href patterns.
- **createDataPageStore pattern**: All listing pages use this store factory for search + view state.
  It accepts `initialItems`, `storageKey`, `searchKeys`, and optional `searchKey` for persistence.
  Source filtering should compose with (not replace) this pattern.
- **SyncFooter pattern**: Every sync section (Quality Profiles, Delay Profiles, Media Management) is
  a card with a SyncFooter containing trigger toggles, save/sync buttons, and dirty tracking. TRaSH
  sync sections should follow this exact pattern.
- **UnifiedDatabaseItem pattern**: The databases page already unifies PCD and TRaSH items into a
  discriminated union for combined table/card rendering. This exact pattern applies to entity
  listing.
- **assertScope enforcement**: TRaSH sync queries enforce `ai.type = s.arr_type` in every join. The
  UI must filter TRaSH sources to only show those matching the Arr instance type.

## Edgecases

- TRaSH entities use `trashId` (32-char hex string) as identity, not integer IDs. Any entity detail
  navigation must use `trashId` + `sourceId` as the key, not `id`.
- TRaSH source `arr_type` is immutable after creation (`updateSource` throws `arr_type_mismatch`).
  The UI should not show TRaSH sources with mismatched arr_type in sync selection.
- PCD `quality_profile_custom_formats.arr_type` can be `'all'`, which applies to any Arr app. TRaSH
  quality profiles are always scoped to a single arr_type. The sync selection must account for this
  difference.
- The databases page already handles the case where both PCD and TRaSH sources are empty -- it shows
  a combined empty state. Entity pages should follow the same pattern.
- TRaSH `score_profile` filtering: A TRaSH source's `score_profile` determines which CF scores to
  apply. When showing quality profiles from TRaSH, the profile's `format_items` scores are
  pre-selected per the source's score profile. The UI should indicate which score profile is active.
- Entity name collisions across sources: PCD enforces case-insensitive unique names within a
  database. TRaSH entities may have names that collide with PCD entities. The sync pipeline handles
  this via namespacing, but the listing UI should visually distinguish same-named entities from
  different sources.
- `canWriteToBase` applies only to PCD databases. TRaSH entities are read-only from the user's
  perspective (synced from upstream, not editable). Clone/export actions should be disabled or
  adapted for TRaSH entities.
- The search store uses `getPersistentSearchStore` keyed by `customFormatsSearch:{databaseId}`. When
  TRaSH sources are added as tabs, the key should be `customFormatsSearch:trash:{sourceId}` to
  maintain separate search state per source.

## Open Questions

- Should batch operations (bulk toggle, bulk export) work across sources, or only within a single
  source? The current PCD batch operations are per-database. Cross-source batch operations add
  significant complexity.
- Should the entity detail pages (`/custom-formats/{databaseId}/{id}`) be created for TRaSH
  entities, or should TRaSH entities be view-only at the listing level with a link to the TRaSH
  Guide website?
- How should the "New" (create) button behave when viewing TRaSH entities? It does not make sense to
  create entities in a TRaSH source. Hide the button, or redirect to PCD creation?
- For the sync page, should TRaSH and PCD quality profiles share a single SyncFooter (combined
  save/sync action) or have independent footers? Independent is cleaner architecturally but adds
  visual clutter.
- Should the `navScope` store (which filters by Arr type) affect TRaSH source visibility? Currently
  navScope is used for the sidebar navigation. If the user sets navScope to "Radarr", should only
  Radarr TRaSH sources appear in entity listing tabs?

## Other Docs

- `/docs/plans/trash-guide-sync/` -- Backend implementation plan for TRaSH Guide Sync
- `/docs/ARCHITECTURE.md` -- Full codebase architecture documentation
- `/packages/praxrr-app/src/lib/server/trashguide/` -- TRaSH Guide server-side module
- `/packages/praxrr-app/src/routes/databases/types.ts` -- UnifiedDatabaseItem pattern reference
