# Feature Spec: TRaSH Guide Sync UX

## Executive Summary

This feature surfaces multi-source PCD data (Default PCD, Custom PCD, TRaSH Guides) across all
Praxrr entity listing pages and Arr sync configuration pages, enabling users to browse, filter,
search, and select entities by source. The implementation extends the existing per-database tab
navigation with an "All Sources" aggregated view, toggle-pill source filters in the ActionsBar,
source badges on entity cards/rows, and grouped-by-source sections on the Arr sync page. The
approach preserves the existing single-database workflow while adding cross-source capabilities
incrementally, using no external UI libraries -- only extending Praxrr's existing component library
(Badge, Tabs, ActionsBar, SearchAction, Toggle). Primary challenges include the PCD/TRaSH ID
namespace split (solved via separate route segments) and maintaining clean UX despite multiple data
persistence paths for sync selections.

## External Dependencies

### APIs and Services

No new external APIs or services required. All data sources are already implemented:

- **PCD Databases**: Loaded via `pcdManager.getAll()` and `pcdManager.getCache(id)` (in-memory
  SQLite caches)
- **TRaSH Guide Sources**: Loaded via `trashGuideManager.listSources()` with entities in
  `trash_guide_entity_cache` (app DB)
- **Existing API Endpoints**: All TRaSH Guide API endpoints already exist
  (`/api/v1/trash-guide/sources/*`)

### Libraries and SDKs

| Library | Version | Purpose                      | Installation |
| ------- | ------- | ---------------------------- | ------------ |
| None    | --      | No new dependencies required | --           |

All UI components will be built using existing Praxrr primitives (`Badge`, `Tabs`, `ActionsBar`,
`Toggle`, `SearchAction`, `DropdownSelect`). External UI libraries (Bits UI, shadcn-svelte) were
evaluated and rejected due to Svelte 5 runes dependency conflict with Praxrr's "Svelte 5, no runes"
convention.

### External Documentation

- [PatternFly Filters Design Guidelines](https://www.patternfly.org/patterns/filters/design-guidelines/):
  Toggle group filter patterns
- [Carbon Design System Filtering](https://carbondesignsystem.com/patterns/filtering/): Interactive
  vs batch filtering
- [NNGroup Filter Categories and Values](https://www.nngroup.com/articles/filter-categories-values/):
  Faceted search best practices
- [W3C WAI-ARIA Checkbox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/): Accessibility
  for filter controls

## Business Requirements

### User Stories

**Primary User: Self-Hoster Managing Multiple Sources**

- As a self-hoster, I want to see which data source each entity came from when browsing custom
  formats so that I can understand my configuration landscape across Default PCD, custom PCDs, and
  TRaSH Guides
- As a self-hoster, I want to filter entity lists by source database so that I can focus on entities
  from a specific source without visual noise from other sources
- As a self-hoster, I want to select TRaSH Guide quality profiles directly from the Arr sync
  configuration page so that I can sync TRaSH-sourced profiles to my Arr instances alongside PCD
  profiles
- As a self-hoster, I want a unified "All Sources" view so that I can search for any entity
  regardless of which database it belongs to

**Secondary User: Power User with Custom + TRaSH Sources**

- As a power user, I want batch operations (select multiple entities from different sources for
  sync) so that I can efficiently configure which profiles to push to my Arr instances
- As a power user, I want clear visual indicators (badges, colors) showing the origin of each entity
  so that I never accidentally modify a TRaSH-sourced entity thinking it is my custom one
- As a power user, I want source filter state to persist per-page so that returning to a page
  restores my previous filter configuration

**Tertiary User: New User with Only TRaSH Guides**

- As a new user who only uses TRaSH Guides, I want the custom formats and quality profiles pages to
  show TRaSH content without requiring a PCD database link so that I can browse what TRaSH provides
  before syncing

### Business Rules

1. **Source Identity Persistence**: Every entity must carry its source identity (PCD database ID or
   TRaSH source ID) through the UI. Entities from different sources with the same name must show
   source badges to disambiguate.
   - Validation: Source ID must resolve to an existing database or TRaSH source
   - Exception: None; orphaned entities should not be displayed

2. **TRaSH Source Arr Type Scoping**: Each TRaSH source is locked to a single `arr_type`. TRaSH
   entities should only appear in sync configurations for matching Arr instance types.
   - Validation: `trash_guide_sync_config` enforces `ai.type = s.arr_type` via JOIN
   - Exception: PCD databases are Arr-agnostic at storage level; filtered at query time

3. **Read-Only TRaSH Entities**: TRaSH Guide entities are read-only base ops. The UI must suppress
   edit/delete actions and offer "Duplicate to My Database" instead.
   - Validation: `canWriteToBase` returns false for TRaSH-backed sources
   - Exception: User ops (local overrides) on top of TRaSH base data are allowed

4. **TRaSH Entity Types Supported**: TRaSH provides `custom_format`, `quality_profile`,
   `quality_size`, and `naming`. These map to: Custom Formats page, Quality Profiles page, Quality
   Definitions (media management), and Naming (media management). Delay profiles and media settings
   are PCD-only.
   - Validation: Only entity types present in TRaSH source cache are surfaced
   - Exception: TRaSH sources with zero entities of a type do not appear as tabs on that page

5. **Sync Selection Dual Persistence**: PCD entity sync selections persist via `arrSyncQueries`
   (e.g., `arr_sync_quality_profiles`). TRaSH entity sync selections persist via
   `trashGuideSyncQueries` (`trash_guide_sync_config`, `trash_guide_sync_selections`). The UI
   unifies presentation but dispatches saves to the correct backend.
   - Validation: Each selection carries `{ type: 'pcd' | 'trash', sourceId, profileName }`
   - Exception: None; mixed save paths must be transparent to the user

6. **Single-Source Graceful Degradation**: Users with only one PCD database and no TRaSH sources see
   the existing single-database UX unchanged. The "All Sources" tab and source filter pills are
   hidden when only one source exists.

### Edge Cases

| Scenario                                    | Expected Behavior                                                                         | Notes                                   |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------- |
| Single database, no TRaSH                   | No "All" tab, no source badges, no filters. Identical to current UX                       | Graceful degradation                    |
| TRaSH source syncing in background          | "Syncing..." badge on source tab; data browsable with stale indicator                     | Background sync does not block browsing |
| Same entity name across sources             | Both shown with source badges in "All" view; sync page warns about namespace              | Namespace suffixes handle at sync time  |
| TRaSH source deleted while selected in sync | Cascade delete removes sync selections; UI refreshes to remove source                     | `ON DELETE CASCADE` on FKs              |
| Multiple TRaSH sources for same Arr type    | Both appear as separate tabs and sync sections                                            | Different score profiles or branches    |
| All filters yield zero results              | Empty state with "No [entity type] match your current filters" + "Clear all filters" link | Follows existing EmptyState pattern     |
| 300+ CFs across sources in "All" view       | Progressive rendering via existing `createProgressiveList({ pageSize: 30 })`              | Virtual scrolling already built         |
| TRaSH source has zero CFs                   | Does not appear as tab on Custom Formats page                                             | Filtered by entity type availability    |

### Success Criteria

- [ ] Custom formats page shows entities from both PCD databases and TRaSH sources with clear source
      indicators
- [ ] Quality profiles page shows entities from both PCD databases and TRaSH sources with clear
      source indicators
- [ ] Entity listing tabs include both PCD database tabs and TRaSH source tabs with visual
      distinction
- [ ] "All Sources" tab aggregates entities from all sources with source badges on each item
- [ ] Source filter toggle pills allow filtering by individual source within the "All Sources" view
- [ ] Arr sync config page shows TRaSH quality profiles alongside PCD quality profiles for selection
- [ ] Arr sync config page shows TRaSH naming/quality definitions in media management dropdowns
- [ ] Source filter state persists per-page via localStorage
- [ ] TRaSH entities are visually read-only (no edit/delete buttons) on entity listing pages
- [ ] "Select All" per database group works on sync page
- [ ] Empty/disabled TRaSH sources show appropriate states
- [ ] No regression in existing single-database entity browsing or sync configuration flows
- [ ] Filter controls are keyboard accessible with proper ARIA attributes
- [ ] Mobile responsive: filters collapse appropriately below 768px

## Technical Specifications

### Architecture Overview

```text
+-------------------------------------------+
|  Entity Listing Page (e.g. custom-formats) |
|                                           |
|  +---------------------------------------+|
|  | SourceTabs (PCD dbs + TRaSH sources)  ||
|  | [All] [Praxrr-DB] [TRaSH Radarr] ... ||
|  +---------------------------------------+|
|  | ActionsBar                            ||
|  |  [Search] [SourceFilter] [ViewToggle] ||
|  +---------------------------------------+|
|  | TableView / CardView                  ||
|  |   (entities w/ SourceBadge per row)   ||
|  +---------------------------------------+|
+-------------------------------------------+
         |                    |
   +-----v------+    +-------v--------+
   | PCD Cache   |    | TRaSH Entity   |
   | (in-memory  |    | Cache (SQLite  |
   |  SQLite)    |    |  app DB)       |
   +-------------+    +----------------+

+-------------------------------------------+
|  Arr Sync Config (/arr/[id]/sync)         |
|                                           |
|  +-- Quality Profiles Section -----------+|
|  | PCD Databases                         ||
|  |   [Praxrr-DB] Toggle grid + SyncFooter|
|  |   [Custom-DB] Toggle grid + SyncFooter|
|  | TRaSH Guide Sources                   ||
|  |   [TRaSH Radarr] Toggle grid + Footer ||
|  +---------------------------------------+|
+-------------------------------------------+
```

### Data Models

#### Source Reference Type (New Shared Type)

```typescript
// packages/praxrr-app/src/lib/shared/sources/types.ts
type SourceRef =
  | { type: 'pcd'; id: number; name: string }
  | { type: 'trash'; id: number; name: string; arrType: string };
```

#### Sourced Entity Wrapper (New Shared Type)

```typescript
// Extends existing display types with source metadata
interface SourcedEntity<T> {
  source: SourceRef;
  entity: T;
}
```

#### Display Type Extensions

Existing `CustomFormatTableRow` and `QualityProfileTableRow` in `$shared/pcd/display.ts` need
optional source metadata fields:

| Field                | Type               | Description                     |
| -------------------- | ------------------ | ------------------------------- |
| `sourceDatabaseId`   | `number`           | Source database/TRaSH source ID |
| `sourceDatabaseName` | `string`           | Human-readable source name      |
| `sourceType`         | `'pcd' \| 'trash'` | Discriminator for source type   |

No new database tables required. All data already exists in `database_instances`,
`trash_guide_sources`, `trash_guide_entity_cache`, and PCD in-memory caches.

### API Design

No new API endpoints required. All data loading uses SvelteKit `load` functions (server-side).

#### Modified Load Functions

- **`/custom-formats/+page.server.ts`**: Add `trashGuideManager.listSources()` to load data; extend
  redirect logic
- **`/custom-formats/[databaseId]/+page.server.ts`**: Return `trashSources` alongside `databases`
  for tab generation
- **`/quality-profiles/+page.server.ts`**: Same pattern as custom-formats
- **`/arr/[id]/sync/+page.server.ts`**: Load TRaSH sources matching instance `arr_type`; build TRaSH
  profiles alongside PCD profiles

#### New Routes

- **`/custom-formats/trash/[sourceId]/+page.server.ts`**: TRaSH CF listing load (queries
  `trash_guide_entity_cache`)
- **`/custom-formats/all/+page.server.ts`**: Aggregated all-source CF listing (queries all PCD
  caches + TRaSH caches)
- **`/quality-profiles/trash/[sourceId]/+page.server.ts`**: TRaSH QP listing load
- **`/quality-profiles/all/+page.server.ts`**: Aggregated all-source QP listing

### System Integration

#### Files to Create

- `packages/praxrr-app/src/lib/shared/sources/types.ts` -- Shared `SourceRef` type and helpers
- `packages/praxrr-app/src/lib/shared/sources/transform.ts` -- TRaSH entity to PCD display type
  transformers
- `packages/praxrr-app/src/lib/client/ui/actions/SourceFilter.svelte` -- Reusable source filter
  dropdown (follows `SearchFilterAction` pattern)
- `packages/praxrr-app/src/lib/client/ui/badge/SourceBadge.svelte` -- Source type indicator badge
  (wraps existing `Badge`)
- `packages/praxrr-app/src/routes/custom-formats/trash/[sourceId]/+page.server.ts` -- TRaSH CF
  listing load
- `packages/praxrr-app/src/routes/custom-formats/trash/[sourceId]/+page.svelte` -- TRaSH CF listing
  page
- `packages/praxrr-app/src/routes/custom-formats/all/+page.server.ts` -- All-source CF aggregation
  load
- `packages/praxrr-app/src/routes/custom-formats/all/+page.svelte` -- All-source CF listing page
- `packages/praxrr-app/src/routes/quality-profiles/trash/[sourceId]/+page.server.ts` -- TRaSH QP
  listing load
- `packages/praxrr-app/src/routes/quality-profiles/trash/[sourceId]/+page.svelte` -- TRaSH QP
  listing page
- `packages/praxrr-app/src/routes/quality-profiles/all/+page.server.ts` -- All-source QP aggregation
  load
- `packages/praxrr-app/src/routes/quality-profiles/all/+page.svelte` -- All-source QP listing page

#### Files to Modify

- `packages/praxrr-app/src/lib/shared/pcd/display.ts` -- Add source metadata fields to entity
  display types
- `packages/praxrr-app/src/lib/client/ui/badge/Badge.svelte` -- Add `trash` variant
- `packages/praxrr-app/src/routes/custom-formats/+page.server.ts` -- Add
  `trashGuideManager.listSources()` to load
- `packages/praxrr-app/src/routes/custom-formats/+page.svelte` -- Extend redirect logic for TRaSH
  sources
- `packages/praxrr-app/src/routes/custom-formats/[databaseId]/+page.svelte` -- Merge TRaSH sources
  into tab list with badges
- `packages/praxrr-app/src/routes/custom-formats/[databaseId]/views/TableView.svelte` -- Optional
  source badge column
- `packages/praxrr-app/src/routes/custom-formats/[databaseId]/views/CardView.svelte` -- Optional
  source badge
- `packages/praxrr-app/src/routes/quality-profiles/+page.server.ts` -- Add TRaSH source loading
- `packages/praxrr-app/src/routes/quality-profiles/+page.svelte` -- Extend redirect logic
- `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/+page.svelte` -- Merge TRaSH sources
  into tabs
- `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/views/TableView.svelte` -- Source
  badge column
- `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/views/CardView.svelte` -- Source
  badge
- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts` -- Load TRaSH sources and quality
  profiles
- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte` -- Manage TRaSH sync selection state
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/QualityProfiles.svelte` -- Add TRaSH
  profile groups with badges
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/MediaManagement.svelte` -- TRaSH
  naming/quality definitions options

## UX Considerations

### User Workflows

#### Primary Workflow: Multi-Source Entity Browsing

1. **Navigate to Custom Formats page**
   - User: Clicks "Custom Formats" in sidebar
   - System: Loads all PCD databases and TRaSH sources. Redirects to last-used database tab (or
     first available). Tabs show PCD databases and TRaSH sources with source-type icons. "All" tab
     appears as first option when 2+ sources exist.

2. **Switch to "All Sources" view**
   - User: Clicks the "All" tab
   - System: Displays unified list of all custom formats across all sources. Each entity has a
     SourceBadge showing its database name. SourceFilter appears in ActionsBar.

3. **Filter by source**
   - User: Clicks SourceFilter in ActionsBar, unchecks "TRaSH Radarr"
   - System: Immediately filters list to show only PCD entities. Result count updates: "Showing 47
     of 203 custom formats". Filter state saved to localStorage.

4. **Search within filtered view**
   - User: Types "BR-DISK" in search
   - System: Filters within the source-filtered list. Shows matching entities with source badges.

5. **View TRaSH-specific entities**
   - User: Clicks a TRaSH source tab directly
   - System: Shows only TRaSH entities from that source. SourceFilter hides (single source). "New"
     button hidden (read-only).

#### Primary Workflow: Arr Sync Configuration with Source Filtering

1. **Navigate to Arr sync page**
   - User: Goes to Arr instance > Sync
   - System: Loads PCD databases AND compatible TRaSH sources. Quality Profiles section shows groups
     under "PCD Databases" and "TRaSH Guide Sources" headers.

2. **Select TRaSH profiles for sync**
   - User: In TRaSH Guide Sources section, toggles quality profiles on/off
   - System: Shows TRaSH badge on each profile. "Select All" link at group header. Separate
     SyncFooter for TRaSH selections.

3. **Save and sync**
   - User: Clicks Save/Sync on TRaSH section
   - System: Persists to `trash_guide_sync_selections` via `trashGuideSyncQueries.setSelections()`.
     PCD save path remains separate via `arrSyncQueries.saveQualityProfilesSync()`.

#### Error Recovery Workflow

1. **TRaSH source sync failed**
   - System: Shows "Stale" badge on TRaSH source tab. Alert: "Failed to sync TRaSH Guide data. Last
     successful sync: [date]."
   - User: Clicks "Retry Sync" or continues browsing stale data

2. **Source deleted while viewing**
   - System: Redirects to "All" or first available tab. Shows alert: "Database [name] is no longer
     available."

### UI Patterns

| Component            | Pattern                                                  | Notes                                                                    |
| -------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| Source tabs          | Extended Tabs with icon badges                           | PCD icon for databases, TRaSH icon for TRaSH sources                     |
| Source filter        | Toggle pills in ActionsBar (2-4 sources) / Dropdown (5+) | Follows SearchFilterAction hover-popover pattern                         |
| Source badges        | Small colored Badge per entity                           | `accent` for PCD, `trash` variant for TRaSH, Arr-type badges for scoping |
| Sync source groups   | Collapsible sections with headers                        | "PCD Databases" / "TRaSH Guide Sources" headers                          |
| Select all per group | Link at group header                                     | "Select All" / "Deselect All" per database                               |
| Result count         | "Showing X of Y" text above content                      | Only when filters active or in "All" view                                |
| Empty filtered state | EmptyState with "Clear all filters" CTA                  | Follows existing EmptyState.svelte pattern                               |
| Mobile filters       | Collapse to dropdown at < 768px                          | Follows existing Tabs/SearchAction responsive patterns                   |

### Accessibility Requirements

- Toggle pills: `aria-pressed="true|false"`, keyboard Space/Enter to toggle, Tab to navigate between
- Source filter group: `role="group"` with `aria-label="Filter by source"`
- Source badges: Text labels + icons (not color-only per WCAG 1.4.1)
- Result count: `role="status"` with `aria-live="polite"` for filter change announcements
- Select All checkbox: `aria-checked="mixed"` for partial selection
- Touch targets: >= 44x44 CSS pixels on all filter controls
- Focus management: Do not auto-move focus on filter changes; manage focus on chip removal

### Performance UX

- **Loading States**: No additional loading needed for filter toggle (client-side, synchronous). Tab
  switch uses SvelteKit preload. Background TRaSH sync shows "Syncing..." badge.
- **Large Lists**: Existing `createProgressiveList({ pageSize: 30 })` and `Table pageSize={50}`
  handle 200+ items.
- **Optimistic Updates**: Not needed for filter operations (synchronous). Sync operations use
  existing spinner pattern.
- **Error Feedback**: Inline error cards with recovery actions. Toast for background errors via
  existing `alertStore.add()`.

## Recommendations

### Implementation Approach

**Recommended Strategy**: Layered incremental approach preserving existing per-database tab
navigation while adding cross-source capabilities.

**Phasing**:

1. **Phase 1 - Source Awareness**: Source badges on entity listings; TRaSH sources as additional
   tabs on CF/QP pages; TRaSH profiles in Arr sync selection; source metadata on display types
2. **Phase 2 - Cross-Source Views**: "All Sources" aggregated tab; SourceFilter component with
   multi-select; server-side multi-cache aggregation utility; filter state localStorage persistence
3. **Phase 3 - Polish**: Mobile responsive filter collapse; keyboard shortcuts; grouped-by-source
   view mode; database health indicators in sidebar; batch operations across sources

### Technology Decisions

| Decision                     | Recommendation                                       | Rationale                                                                                                               |
| ---------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| TRaSH entity routes          | Separate `/trash/[sourceId]` routes                  | Clean separation of PCD (in-memory cache) vs TRaSH (app DB) load logic; mirrors `/databases/trash/[id]` pattern         |
| Filter state management      | localStorage-backed per-page stores                  | Matches existing `customFormatsSearchFilter` pattern; URL params for tab selection, localStorage for filter preferences |
| TRaSH entity display mapping | Shared display row type (superset of fields)         | Keeps view components source-agnostic; optional fields for source-specific data                                         |
| Sync page TRaSH sections     | Separate sections with independent SyncFooter        | PCD and TRaSH sync persist to different tables with different APIs; visual separation matches data architecture         |
| Source filter component      | Filter pills (2-4 sources) adaptive to dropdown (5+) | Optimal for expected 2-5 source count; follows SearchFilterAction pattern                                               |
| External dependencies        | None (extend existing components)                    | Svelte 5 runes conflict eliminates Bits UI/shadcn-svelte; existing primitives are sufficient                            |

### Quick Wins

- **Source badges on entity cards/tables**: Adding a Badge with database name immediately shows
  provenance
- **TRaSH databases in Arr sync tabs**: Extending sync page load to include TRaSH sources unblocks
  the core sync UX
- **Activate unused SearchStore filter APIs**: The `setFilter`/`removeFilter` methods are already
  built but unused on entity pages

### Future Enhancements

- **Cross-source entity comparison**: Diff view comparing same-named entity across sources
- **Smart three-way conflict resolution**: Show previous TRaSH, new TRaSH, and user version
  side-by-side
- **TRaSH Guide group taxonomy as filter**: TRaSH CF groups ("Unwanted", "HDR Formats") as
  first-class filters
- **Quick-apply presets**: Pre-built "Select all TRaSH HD Bluray + WEB profiles" buttons (inspired
  by Recyclarr templates)
- **Virtual scrolling**: Only needed if performance measurements show degradation with 300+ entities

## Risk Assessment

### Technical Risks

| Risk                                            | Likelihood | Impact | Mitigation                                                                                                    |
| ----------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| Performance with 300+ entities in "All Sources" | Medium     | Medium | Existing `createProgressiveList` with virtual scrolling; measure before optimizing                            |
| PCD/TRaSH ID namespace collision in routes      | High       | High   | Use separate route segments (`/trash/[sourceId]`) not composite IDs; mirrors existing `/databases/trash/[id]` |
| Breaking existing single-database workflows     | Low        | High   | Per-database tabs remain default landing; "All Sources" is additive; feature-flag with source count check     |
| Dual save path complexity on sync page          | Medium     | Medium | Separate SyncFooter components per source type; clear visual grouping with headers                            |
| Stale TRaSH cache data during background sync   | Medium     | Medium | "Syncing..." badge; `invalidateAll()` after sync; browsable stale data                                        |
| Filter state management complexity              | Medium     | Low    | Per-page localStorage keys; no global state; simple `SearchStore.filters` API                                 |

### Integration Challenges

- **Multi-cache query aggregation**: Must iterate all PCD caches + TRaSH entity cache for "All
  Sources" view. Existing sync page `+page.server.ts` already demonstrates this pattern (lines
  125-172).
- **TRaSH entity mutability indicators**: Entity detail pages need "read-only" indicator with
  "Duplicate to My Database" CTA replacing edit button.
- **Dirty tracking isolation**: Filter changes must NOT trigger dirty state. SourceFilter state must
  be isolated from the `dirty` store.
- **navScope interaction**: When user sets navScope to "Radarr", only Radarr-scoped TRaSH sources
  should appear in entity tabs.

### Security Considerations

- No new security surface. All data remains server-side with existing authentication.
- Filter state in localStorage is non-sensitive (source IDs and preferences only).

## Task Breakdown Preview

### Phase 1: Source Awareness

**Focus**: Make source provenance visible across existing pages; enable TRaSH profiles in sync
selection

**Tasks**:

- Source metadata types (`SourceRef`, display type extensions)
- Source badge components (`SourceBadge.svelte`, `Badge` `trash` variant)
- TRaSH sources in entity page tabs (CF + QP pages)
- TRaSH routes (`/custom-formats/trash/[sourceId]`, `/quality-profiles/trash/[sourceId]`)
- TRaSH display type transformers (TRaSH entity cache -> PCD display types)
- TRaSH profiles in Arr sync page (load + QualityProfiles component + save path)
- TRaSH naming/quality definitions in MediaManagement component

**Parallelization**: Source types + Badge work can run parallel with route creation and sync page
integration

### Phase 2: Cross-Source Views

**Focus**: Unified "All Sources" view with filtering

**Dependencies**: Phase 1 completion (source types and TRaSH routes required)

**Tasks**:

- "All Sources" route for CF (`/custom-formats/all`)
- "All Sources" route for QP (`/quality-profiles/all`)
- Multi-cache aggregation utility function
- SourceFilter component (toggle pills / dropdown hybrid)
- Filter state localStorage persistence
- Result count indicator
- Updated redirect logic (handle "All" as landing option)

### Phase 3: Polish

**Focus**: Responsive, accessible, delightful

**Dependencies**: Phase 2 completion

**Tasks**:

- Mobile responsive filter collapse (< 768px)
- Keyboard shortcuts for filter toggling
- Grouped-by-source view mode
- Database health indicators in sidebar
- Collapsible source groups on sync page (accordion with counts)
- Empty state enhancements with filter-aware messaging
- Accessibility audit (ARIA attributes, focus management, screen reader testing)
- E2E tests for multi-source workflows

## Decisions Needed

Before proceeding to implementation planning, clarify:

1. **Default Landing Page**
   - Options: Default to "All Sources" vs. last-used database tab
   - Impact: "All Sources" provides complete view but may overwhelm single-database users
   - Recommendation: Default to last-used database tab (matches existing `localStorage` redirect
     pattern). "All Sources" available as explicit first tab.

2. **TRaSH Entity Detail Pages**
   - Options: (a) Full detail page at `/custom-formats/trash/[sourceId]/[trashId]`, (b) Read-only
     summary modal, (c) Link to TRaSH Guide website
   - Impact: Full detail pages add significant work; modal is lighter
   - Recommendation: Phase 1 uses (c) link to TRaSH website; Phase 2+ adds (a) read-only detail
     pages

3. **Source Filter Scope**
   - Options: Per-page (CF filters independent from QP filters) vs. global (one filter everywhere)
   - Impact: Global reduces clicks but may confuse when different pages have different sources
   - Recommendation: Per-page (matches existing per-page search state pattern)

4. **Sync Page Source Ordering**
   - Options: PCD databases first vs. TRaSH sources first
   - Impact: Determines visual hierarchy and what users see first
   - Recommendation: PCD databases first (user's own data takes priority over external
     recommendations)

5. **Disabled Source Visibility**
   - Options: Show disabled sources with muted styling vs. hide completely
   - Impact: Showing provides awareness; hiding reduces clutter
   - Recommendation: Hide from entity tabs and sync selection; show on databases page with disabled
     indicator

## Research References

For detailed findings, see:

- [research-external.md](./research-external.md): UI component libraries, SvelteKit filter patterns,
  competitor analysis, accessibility patterns
- [research-business.md](./research-business.md): User stories, domain model, existing codebase
  integration, workflow analysis
- [research-technical.md](./research-technical.md): Architecture design, component hierarchy, API
  contracts, route design decisions
- [research-ux.md](./research-ux.md): User workflows, filter patterns, competitive analysis,
  accessibility requirements
- [research-recommendations.md](./research-recommendations.md): Implementation strategy, phasing,
  risk assessment, alternative approaches
