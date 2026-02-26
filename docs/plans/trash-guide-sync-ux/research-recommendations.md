# Recommendations: trash-guide-sync-ux

## Executive Summary

The UX layer for multi-source PCD data should adopt a **filter chips approach** (Option A/D hybrid)
using the existing `Tabs` component for database switching and a new `SourceFilterBar` component for
cross-source views. The current architecture already separates entity pages by `[databaseId]` route
segments with database-scoped tabs, so the most practical path extends this pattern with an optional
"All Sources" aggregated view and per-entity source badges. The primary risk is performance
degradation with 200+ custom formats across multiple databases and TRaSH sources rendered in a
single list; this is mitigated by the existing `createProgressiveList` virtual scrolling and the
`createDataPageStore` debounced search infrastructure.

## Implementation Recommendations

### Recommended Approach

The recommended strategy uses a **layered approach** that preserves the existing per-database tab
navigation while adding cross-source capabilities incrementally:

1. **Preserve existing per-database routing**: The `[databaseId]` route segments
   (`/custom-formats/[databaseId]`, `/quality-profiles/[databaseId]`) stay as the primary entity
   browsing UX. Each tab already maps to a single database via `pcdManager.getAll()`. TRaSH sources
   get their own tabs alongside PCD databases.

2. **Add "All Sources" aggregated tab**: A new first tab option ("All") loads entities from all
   databases and TRaSH sources into a single unified list. Entities carry source metadata (database
   name, source type badge) so users can distinguish provenance at a glance.

3. **Source filter chips in the ActionsBar**: When viewing "All Sources", filter chips appear in the
   `ActionsBar` allowing users to toggle visibility per source. This uses the existing
   `SearchStore.setFilter`/`removeFilter` API which is already built into the search store but
   currently unused on entity pages.

4. **Source indicator badges on entities**: Every entity row/card gets a small `Badge` indicating
   its source database. The existing `Badge` component already supports `variant` options including
   `accent`, `neutral`, `radarr`, `sonarr` -- a new `source` rendering mode uses the database name
   as label with color coding.

5. **Arr sync page integration**: The `QualityProfiles.svelte` sync component already iterates over
   `databases` (from `pcdManager.getAll()`) and renders profiles grouped by database with toggle
   checkboxes. TRaSH-sourced databases need to appear here with their quality profiles available for
   selection.

### Technology Choices

| Component                | Recommendation                                                          | Rationale                                                                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source filter state      | `SearchStore.filters` + `localStorage`                                  | Existing `SearchStore` has `setFilter`/`removeFilter`/`clearFilters` APIs and `filterCount` derived store; currently unused on entity pages but fully wired           |
| Source badge component   | Extend existing `Badge.svelte` with new variants                        | `Badge` already handles `radarr`/`sonarr`/`accent`/`neutral`; add database-specific color generation from name hash                                                   |
| Cross-source aggregation | Server-side in `+page.server.ts` via multi-cache queries                | Each database cache is an independent SQLite instance; the server `load` function queries all caches and merges results with source metadata before sending to client |
| Filter persistence       | `localStorage` per page via `SEARCH_FILTER_STORAGE_KEY` pattern         | Custom formats page already uses `localStorage.setItem('customFormatsSearchFilter', ...)` for search field preferences; source filters follow same pattern            |
| Progressive rendering    | Existing `createProgressiveList`                                        | Already used in `CardView.svelte` with `pageSize: 30` IntersectionObserver-based virtual scrolling; handles 200+ items without DOM bloat                              |
| Dropdown multi-select    | Extend existing `DropdownSelect.svelte` or build `SourceFilterDropdown` | `DropdownSelect` supports single-select; multi-select variant needed for "filter by sources" with checkboxes                                                          |

### Phasing Strategy

1. **Phase 1 - MVP (Source Awareness)**: Add source badges to entity listings; make TRaSH databases
   appear as tabs on CF/QP pages; add source metadata to `CustomFormatTableRow` /
   `QualityProfileTableRow` types; update Arr sync page to include TRaSH databases in profile
   selection.
2. **Phase 2 - Cross-Source View**: Add "All Sources" aggregated tab on CF and QP pages; implement
   `SourceFilterBar` component with multi-select filter chips; server-side multi-cache query
   aggregation; filter state persistence in `localStorage`.
3. **Phase 3 - Polish and Navigation**: Database health indicators in sidebar; smart defaults
   (remember last filter); keyboard shortcuts for filter toggling; grouped-by-source view mode;
   batch operations across sources.

### Quick Wins

- **Source badges on entity cards/tables**: Adding a `Badge` with the database name to each entity
  row takes ~1 hour and immediately tells users which database an entity came from. Impact: high
  clarity for multi-database users.
- **TRaSH databases in Arr sync tabs**: The sync page `QualityProfiles.svelte` already iterates over
  a `databases` array -- extending `+page.server.ts` to include TRaSH-backed databases (if they have
  caches) makes TRaSH quality profiles selectable for sync. Impact: unblocks the core TRaSH sync UX.
- **Persist last-used database tab per page**: Already partially implemented
  (`localStorage.setItem('customFormatsDatabase', ...)` and
  `localStorage.setItem('qualityProfilesDatabase', ...)`). Verify it works correctly when database
  count changes. Impact: reduces clicks.

## Improvement Ideas

### Related Features

- **Unified search with source indicators**: The `SearchAction` component currently searches within
  a single database's entities. Extending it to search across all databases (when "All Sources" tab
  is active) with source badges on results would provide instant cross-database discovery. This
  leverages the existing `debouncedQuery` store and `filterItems` API.
- **Database health indicators in sidebar navigation**: The `pageNav.svelte` sidebar already has
  group items with children. Adding a status dot (green/amber/red) next to database names in the nav
  would surface sync health without navigating to `/databases`. Data comes from
  `pcdManager.getCache(id)` availability and `trashGuideManager.listSources()` sync status.
- **Namespace suffix visibility**: When viewing "All Sources", entities from non-default databases
  have namespace suffixes. A toggle to show/hide namespace suffixes would reduce visual noise while
  preserving disambiguation.

### Future Enhancements

- **Smart defaults (remember last filter selection)**: Store per-page filter state in `localStorage`
  using the `SEARCH_FILTER_STORAGE_KEY` pattern already established on the custom formats page.
  Value: reduces cognitive load for users who consistently work with the same source subset.
  Complexity: low.
- **Keyboard shortcuts for filter toggling**: Bind `Ctrl+1`, `Ctrl+2`, etc. to toggle source filters
  in the ActionsBar. The existing `handleKeydown` pattern in `SearchAction.svelte` provides a
  reference. Value: power-user efficiency. Complexity: low-medium.
- **Grouped views (group entities by source)**: A view mode toggle between flat list and
  source-grouped accordion. Each group header shows the database name, entity count, and last sync
  timestamp. Uses the existing `CardGrid`/`Table` components with section headers. Value:
  organizational clarity. Complexity: medium.
- **Batch operations across sources**: Select entities from multiple sources and perform bulk clone,
  export, or tag operations. Requires checkbox column in `Table.svelte` (not currently supported)
  and batch action toolbar. Value: efficiency for power users. Complexity: medium-high.
- **Cross-source diff view**: Show how the same entity name exists differently across sources (e.g.,
  a "BR-DISK" CF from TRaSH vs. from a custom PCD). Value: conflict awareness. Complexity:
  medium-high.

## Risk Assessment

### Technical Risks

| Risk                                                   | Likelihood | Impact | Mitigation                                                                                                                                                                                                     |
| ------------------------------------------------------ | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Performance with 200+ CFs in "All Sources" view        | Medium     | Medium | Existing `createProgressiveList` with `pageSize: 30` handles virtual scrolling; `Table.svelte` also supports `pageSize` prop for progressive rendering; debounced search prevents jank during filtering        |
| Filter state management complexity across pages        | Medium     | Low    | Use per-page `localStorage` keys following existing `customFormatsSearchFilter` pattern; keep filter state independent per page; no global filter state needed                                                 |
| Breaking existing single-database workflows            | Low        | High   | Per-database tabs remain the default landing experience; "All Sources" is additive, not replacing existing UX; redirect logic in `+page.svelte` preserves last-used database selection                         |
| Stale cache data when TRaSH source syncs in background | Medium     | Medium | Server `load` functions query caches at request time; `invalidateAll()` after sync operations already used in Arr sync page; add polling or SSE for background sync completion notification                    |
| Accessibility gaps with filter chips                   | Medium     | Medium | Use `role="group"` and `aria-pressed` on filter toggle buttons; ensure keyboard navigable (Tab/Enter/Space); color-independent indicators via icons per existing `Badge` component pattern                     |
| Mobile/responsive filter bar overflow                  | Medium     | Low    | Wrap filter chips in horizontal scroll container or collapse to `DropdownSelect` on mobile; existing `responsive` pattern in `Tabs.svelte` and `SearchAction.svelte` shows the approach (media query at 767px) |
| Entity name collisions in "All Sources" view           | Medium     | Medium | Namespace suffixes already prevent true collisions; display full namespaced name with optional "show clean names" toggle; sort by name+source to keep duplicates adjacent                                      |

### Integration Challenges

- **Multi-cache query aggregation**: Each PCD database has its own in-memory SQLite cache
  (`PCDCache`). Querying across caches requires iterating `pcdManager.getAll()`, calling
  `pcdManager.getCache(id)`, running entity queries per cache, and merging results with source
  metadata. This is a server-side concern in `+page.server.ts` -- the client receives a flat array.
  The existing Arr sync page `+page.server.ts` already does exactly this pattern (lines 125-172) --
  it iterates databases, gets caches, and builds `databasesWithProfiles`.
- **TRaSH databases in entity tabs**: The current entity listing pages
  (`/custom-formats/[databaseId]`) use `pcdManager.getAll()` to get databases for tabs. TRaSH
  sources use a separate `trashGuideManager.listSources()` API and have different IDs (from
  `trash_guide_sources` table vs. `database_instances` table). The tab system needs to handle both
  types, potentially with a unified `databaseId` that distinguishes source type (e.g., `pcd-1` vs
  `trash-2` or a unified route like `/custom-formats/source/[sourceType]/[id]`).
- **TRaSH entity mutability indicators**: TRaSH-sourced entities are read-only base ops. The entity
  detail pages (`/custom-formats/[databaseId]/[id]/general`) need to show a "read-only" indicator
  and offer "Duplicate to My Database" instead of direct editing. The existing `canWriteToBase`
  boolean partially addresses this but does not distinguish TRaSH-sourced read-only from PCD-sourced
  writable.
- **Dirty tracking with cross-source filters**: The `dirty` store tracks unsaved changes per page.
  Filter changes should NOT trigger dirty state -- they are view preferences, not data
  modifications. Ensure `SourceFilterBar` state is isolated from the `dirty` store.

## Alternative Approaches

### Option A: Filter Chips Above Entity Lists (Lightweight)

Small pill-shaped buttons above the entity table/card grid, one per source. Click to toggle
visibility. An "All" chip selects/deselects everything.

- **Pros**: Minimal UI footprint; familiar pattern (email, issue trackers); works well with existing
  `ActionsBar` layout; each chip can show entity count; easy to implement with existing `Badge`
  component
- **Cons**: Gets crowded with 5+ sources; no hierarchical grouping; filter state not immediately
  obvious when scrolled past; chips compete for space with search and view toggle on mobile
- **Effort**: Low (1-2 days for component + integration on CF page)

### Option B: Sidebar Faceted Navigation (Comprehensive but Heavy)

Add a collapsible filter panel to the left of the entity list, similar to e-commerce faceted search.
Shows source, arr_type, tags, and other filterable dimensions.

- **Pros**: Scales to many filter dimensions; shows available values with counts; can combine
  source + tag + arr_type filters; discoverable for new users
- **Cons**: Takes significant horizontal space; conflicts with existing sidebar navigation; heavy
  for a tool with typically 2-4 sources; over-engineered for current needs; complex implementation
- **Effort**: High (1-2 weeks; new component + layout rework)

### Option C: Tab-Based Source Switching (Simple, No Cross-Source)

Keep the existing per-database tabs as the only source switching mechanism. No unified "All Sources"
view.

- **Pros**: Zero new components needed; preserves existing UX exactly; simplest mental model; each
  tab is a complete view with its own search state; already implemented
- **Cons**: Cannot compare entities across sources; users must click through tabs to find an entity;
  no way to see the complete picture; does not satisfy the "unified search with source indicators"
  requirement
- **Effort**: Zero (already done)

### Option D: Dropdown Multi-Select with "All" Default (Balanced)

A single dropdown button in the `ActionsBar` that opens a checklist of sources. Default is "All
Sources". Users check/uncheck sources to filter.

- **Pros**: Compact -- single button regardless of source count; scales to many sources; "All"
  default means zero-click for common case; can show entity counts per source; fits naturally into
  `ActionsBar`
- **Cons**: Requires click to see available sources (less discoverable than chips); does not show
  active filter state at a glance; multi-select dropdown is a new component (though `DropdownSelect`
  is close)
- **Effort**: Medium (2-3 days for multi-select dropdown + integration)

### Recommendation

**Option A/D Hybrid**: Use filter chips (Option A) when there are 2-4 sources (typical case),
automatically switching to a dropdown multi-select (Option D) when source count exceeds a threshold
(4+). This adaptive approach uses the existing `ActionsBar` layout and scales without redesign.

Additionally, keep Option C (tab-based switching) as the default navigation model. The "All Sources"
aggregated view and filter chips are an enhancement layer on top. Users who prefer single-database
browsing continue using tabs unchanged.

The existing `SearchFilterAction.svelte` on the custom formats page already demonstrates the
pattern: a button in the ActionsBar that opens a hover popover with toggleable options. The source
filter can follow the exact same UX pattern, replacing "Search in..." with "Show sources..." and
listing databases/TRaSH sources with checkboxes.

## Task Breakdown Preview

### Phase 1: Foundation (Source Awareness)

**Task Group 1a: Source Metadata Types**

- Add `sourceDatabaseId` and `sourceDatabaseName` fields to `CustomFormatTableRow` and
  `QualityProfileTableRow` types in `$shared/pcd/display.ts`
- Add `sourceType: 'pcd' | 'trash'` discriminator to distinguish source provenance
- Update entity query functions (`customFormatQueries.list`, `qualityProfileQueries.list`) to return
  source metadata

**Task Group 1b: Source Badge on Entity Views**

- Add `Badge` with database name to `TableView.svelte` and `CardView.svelte` for custom formats
- Add same badge pattern to quality profiles `TableView.svelte` and `CardView.svelte`
- Use database name as badge label; `accent` variant for PCD, new `trash` variant for TRaSH sources

**Task Group 1c: TRaSH Databases in Entity Tabs**

- Update `/custom-formats/+page.server.ts` and `/custom-formats/[databaseId]/+page.server.ts` to
  include TRaSH-backed databases in the `databases` array returned for tab rendering
- Resolve the ID namespace issue: TRaSH source IDs come from `trash_guide_sources` table, PCD
  database IDs from `database_instances`; either use composite IDs (`pcd-1`, `trash-2`) or a unified
  ID registry
- Update the `Tabs` component data mapping to handle both source types

**Task Group 1d: TRaSH Profiles in Arr Sync Selection**

- Update `/arr/[id]/sync/+page.server.ts` to include TRaSH databases alongside PCD databases in the
  `databasesWithProfiles` array
- Ensure `QualityProfiles.svelte` renders TRaSH-sourced profiles with a distinctive badge so users
  know which are TRaSH-managed vs PCD-managed
- Verify `Toggle` selection state works correctly with TRaSH database IDs

**Parallel opportunities**: 1a and 1c can start in parallel since they touch different layers (types
vs. routes). 1b depends on 1a. 1d is independent and can run in parallel with all others.

### Phase 2: Core Implementation (Cross-Source Views)

**Task Group 2a: "All Sources" Aggregated Tab**

- Add new route `/custom-formats/all/+page.server.ts` that queries all caches and merges entities
  with source metadata
- Add same for `/quality-profiles/all/+page.server.ts`
- Add "All" as the first tab option in entity listing pages (conditional on having 2+ databases)
- Handle the redirect logic in `/custom-formats/+page.svelte` to optionally default to "All" or
  last-used database

**Task Group 2b: Source Filter Component**

- Create `SourceFilterAction.svelte` component following the pattern of `SearchFilterAction.svelte`
- Integrate into `ActionsBar` on custom formats and quality profiles pages (only when "All Sources"
  tab is active)
- Wire to `SearchStore.setFilter('sources', ...)` for reactive filtering
- Add localStorage persistence using `customFormatsSourceFilter` / `qualityProfilesSourceFilter`
  keys

**Task Group 2c: Server-Side Multi-Cache Aggregation**

- Create shared utility function `aggregateEntitiesAcrossCaches(entityType, queryFn)` that iterates
  PCD caches and TRaSH caches, runs a query function per cache, and merges results with source
  metadata
- Use in both `/custom-formats/all/+page.server.ts` and `/quality-profiles/all/+page.server.ts`
- Ensure entity IDs are unique across sources (prefix with source type + database ID)

**Dependencies**: 2a depends on 1c (tab integration). 2b depends on 1b (source badges). 2c depends
on 1a (type definitions).

### Phase 3: Integration and Testing

**Task Group 3a: Polish and Navigation**

- Add database count badges to sidebar navigation items (e.g., "Custom Formats (207)")
- Add source health dot indicators to database nav items
- Keyboard shortcut for filter toggling (optional)
- Grouped-by-source view mode toggle

**Task Group 3b: Mobile and Responsive**

- Ensure filter chips collapse to dropdown on mobile (< 767px breakpoint per existing pattern)
- Test "All Sources" tab scrolling performance with 200+ entities on mobile
- Verify touch targets meet 44px minimum for filter toggles

**Task Group 3c: Testing**

- Unit tests for multi-cache aggregation utility
- E2e tests for source filter toggle behavior
- E2e tests for tab switching between databases and "All Sources"
- Performance benchmarking with 5+ databases and 500+ total CFs

### Estimated Complexity

- **Total tasks**: ~20-25 discrete implementation tasks across all phases
- **Critical path**: Source metadata types (1a) -> Source badges (1b) -> "All Sources" tab (2a) ->
  Source filter component (2b)
- **Phase 1 estimate**: 3-5 days of focused development
- **Phase 2 estimate**: 4-6 days
- **Phase 3 estimate**: 3-5 days
- **Key parallelization**: Phase 1 tasks 1a/1c/1d can all run in parallel; Phase 2 tasks 2b/2c can
  run in parallel once 2a architecture is defined

## Key Decisions Needed

- **TRaSH database ID namespace**: TRaSH sources have IDs from `trash_guide_sources` and PCD
  databases from `database_instances`. The current route structure uses
  `/custom-formats/[databaseId]` as a numeric PCD database ID. Options: (a) use composite string IDs
  like `pcd-1` and `trash-2` in routes, requiring route parameter parsing changes; (b) create a
  unified database registry that assigns globally unique numeric IDs; (c) use separate route
  namespaces like `/custom-formats/trash/[trashId]` mirroring the `/databases/trash/[id]` pattern
  already in place. Option (c) aligns with the existing pattern in `/databases/trash/[id]` and
  avoids breaking the current numeric ID assumption.

- **Default landing page**: Should entity listing pages default to "All Sources" or the last-used
  database tab? "All Sources" provides the most complete view but may overwhelm single-database
  users. The existing `localStorage`-based redirect (`customFormatsDatabase` key) suggests the
  codebase philosophy is "remember last choice." Recommend: default to last-used database, with "All
  Sources" available as an explicit tab choice.

- **Source filter scope**: Should source filters be page-level (different filters for custom formats
  vs. quality profiles) or app-level (one filter applies everywhere)? Page-level is simpler and
  aligns with the existing per-page search state (`customFormatsSearch:${databaseId}`). App-level
  would require a global store. Recommend: page-level.

- **Read-only indicators**: How prominently should TRaSH-sourced entities be marked as read-only?
  Options: (a) subtle badge only; (b) badge + disabled edit form fields; (c) badge + "Duplicate to
  Edit" CTA replacing the edit button. The feature spec calls for "read-only with
  duplicate-and-edit." Recommend: option (c) for entity detail pages, option (a) for list views.

## Open Questions

- Are there plans to support additional data source types beyond PCD repositories and TRaSH Guides
  (e.g., Configarr YAML, direct Arr instance import)? This impacts whether the source filtering
  architecture should be generic or TRaSH-specific.
- Should the "All Sources" view show entities from disabled databases/TRaSH sources, or only enabled
  ones? The current tabs only show databases returned by `pcdManager.getAll()`, which includes all
  linked databases regardless of enabled state.
- Is there a desired upper bound on the number of databases/TRaSH sources a user might link? This
  impacts whether filter chips (good for 2-6) or a dropdown (needed for 7+) should be the default.
- Should the Arr sync configuration page show source badges next to quality profile names in the
  toggle grid, or is the existing "grouped by database name" heading sufficient?

## Relevant Files

- `/packages/praxrr-app/src/routes/custom-formats/[databaseId]/+page.svelte`: Custom formats entity
  listing page with database tabs, search, view toggle, and filter options
- `/packages/praxrr-app/src/routes/custom-formats/[databaseId]/+page.server.ts`: Server-side data
  loading using `pcdManager.getAll()` for tabs and `customFormatQueries.list(cache)` for entities
- `/packages/praxrr-app/src/routes/custom-formats/[databaseId]/views/TableView.svelte`: Table
  rendering with columns, sorting, HTML cell rendering, and progressive loading via `pageSize={50}`
- `/packages/praxrr-app/src/routes/custom-formats/[databaseId]/views/CardView.svelte`: Card grid
  rendering with progressive loading via `createProgressiveList({ pageSize: 30 })`
- `/packages/praxrr-app/src/routes/custom-formats/[databaseId]/components/SearchFilterAction.svelte`:
  Existing hover-popover filter component for search field selection; pattern reference for source
  filter
- `/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/+page.svelte`: Quality profiles
  listing page (same tab+search+view pattern as custom formats)
- `/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/+page.server.ts`: Server-side QP
  loading (same `pcdManager.getAll()` + `pcdManager.getCache()` pattern)
- `/packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts`: Arr sync page server loading --
  demonstrates multi-cache iteration pattern across all databases to build `databasesWithProfiles`
- `/packages/praxrr-app/src/routes/arr/[id]/sync/components/QualityProfiles.svelte`: Quality profile
  selection for sync -- iterates `databases` array with toggle checkboxes grouped by database
- `/packages/praxrr-app/src/routes/databases/+page.svelte`: Databases listing page showing unified
  view of PCD databases and TRaSH sources via `UnifiedDatabaseItem` type
- `/packages/praxrr-app/src/routes/databases/types.ts`: `UnifiedDatabaseItem` discriminated union
  type and conversion functions (`pcdToUnifiedItem`, `trashToUnifiedItem`)
- `/packages/praxrr-app/src/routes/databases/views/CardView.svelte`: Database card rendering with
  `TRaSH` badge, `arrType` badge, and entity count summary
- `/packages/praxrr-app/src/lib/client/stores/dataPage.ts`: `createDataPageStore` -- composable
  store for search, view toggle, and filtered items with localStorage persistence
- `/packages/praxrr-app/src/lib/client/stores/search.ts`: `SearchStore` with
  `setFilter`/`removeFilter`/`clearFilters` APIs (currently unused on entity pages but fully wired)
- `/packages/praxrr-app/src/lib/client/stores/navScope.ts`: `navScope` store for app-scoped arr_type
  filtering -- reference pattern for persistent scope-level filtering
- `/packages/praxrr-app/src/lib/client/ui/navigation/tabs/Tabs.svelte`: Tab component with
  responsive mobile dropdown mode
- `/packages/praxrr-app/src/lib/client/ui/actions/ActionsBar.svelte`: Actions bar with connected
  button group styling
- `/packages/praxrr-app/src/lib/client/ui/actions/SearchAction.svelte`: Search input with debounce,
  mobile modal, and active query badge
- `/packages/praxrr-app/src/lib/client/ui/badge/Badge.svelte`: Badge component with variant support
  (`accent`, `neutral`, `success`, `warning`, `danger`, `info`, `radarr`, `sonarr`, `lidarr`)
- `/packages/praxrr-app/src/lib/client/ui/dropdown/DropdownSelect.svelte`: Single-select dropdown
  with compact/responsive modes -- potential base for multi-select source filter
- `/packages/praxrr-app/src/lib/client/ui/table/Table.svelte`: Generic table component with sorting,
  responsive mobile card layout, and progressive rendering
- `/packages/praxrr-app/src/lib/client/ui/toggle/Toggle.svelte`: Toggle checkbox used in sync
  profile selection
- `/packages/praxrr-app/src/lib/shared/pcd/display.ts`: `CustomFormatTableRow` and
  `QualityProfileTableRow` type definitions (need source metadata extension)
- `/packages/praxrr-app/src/lib/server/pcd/core/manager.ts`: `PCDManager.getAll()` and `getCache()`
  -- central API for database enumeration and cache access
- `/packages/praxrr-app/src/lib/server/trashguide/manager.ts`: `TrashGuideManager.listSources()` --
  API for TRaSH source enumeration
- `/packages/praxrr-app/src/lib/client/ui/navigation/pageNav/pageNav.svelte`: Sidebar navigation
  with scope filtering and group rendering
- `/packages/praxrr-app/src/lib/client/ui/navigation/pageNav/navScopeSelector.svelte`: Arr type
  scope selector in sidebar -- reference for app-level filtering pattern

## External References

- [TRaSH Guides Repository](https://github.com/TRaSH-Guides/Guides) - Source of community-curated
  quality profiles and custom formats
- [docs/plans/trash-guide-sync/feature-spec.md](../trash-guide-sync/feature-spec.md) - Full TRaSH
  Guide Sync backend feature specification
- [docs/plans/trash-guide-sync/research-ux.md](../trash-guide-sync/research-ux.md) - Prior UX
  research on sync dashboard and preview patterns
- [docs/plans/trash-guide-sync/research-recommendations.md](../trash-guide-sync/research-recommendations.md) -
  Prior backend implementation recommendations
- [docs/plans/trash-guide-sync/research-architecture.md](../trash-guide-sync/research-architecture.md) -
  Architecture overview and data flow
