# Business Logic Research: trash-guide-sync-ux

## Executive Summary

Praxrr currently serves entity listing pages (custom formats, quality profiles, delay profiles,
media management) scoped to individual PCD databases via tab navigation, with no integration of
TRaSH Guide sources into those views. The sync configuration page (`/arr/[id]/sync`) already
aggregates profiles from all PCD databases but has no awareness of TRaSH Guide sources. This feature
must unify both data source types across all entity-facing UI pages while preserving the
per-database isolation model for editing and the cross-database aggregation model for sync
selection.

## User Stories

### Primary User: Self-Hoster Managing Multiple Sources

- As a self-hoster, I want to see which data source each entity came from when browsing custom
  formats so that I can understand my configuration landscape across Default PCD, custom PCDs, and
  TRaSH Guides.
- As a self-hoster, I want to filter entity lists by source database so that I can focus on entities
  from a specific source without visual noise from other sources.
- As a self-hoster, I want to select TRaSH Guide quality profiles directly from the Arr sync
  configuration page so that I can sync TRaSH-sourced profiles to my Arr instances alongside PCD
  profiles.

### Secondary User: Power User with Custom + TRaSH Sources

- As a power user, I want to compare entities across sources (e.g., see both my custom "HD Bluray"
  profile and the TRaSH equivalent side-by-side) so that I can make informed decisions about which
  to sync.
- As a power user, I want batch operations (select multiple entities from different sources for
  sync) so that I can efficiently configure which profiles to push to my Arr instances.
- As a power user, I want clear visual indicators (badges, colors) showing the origin of each entity
  so that I never accidentally modify a TRaSH-sourced entity thinking it is my custom one.

### Tertiary User: New User with Only TRaSH Guides

- As a new user who only uses TRaSH Guides, I want the custom formats and quality profiles pages to
  show TRaSH content without requiring a PCD database link so that I can browse and understand what
  TRaSH provides before syncing.

## Business Rules

### Core Rules

1. **Source Identity Persistence**: Every entity must carry its source identity (PCD database ID or
   TRaSH source ID) through the UI. This is currently tracked via `database_instances.id` for PCD
   entities and `trash_guide_sources.id` for TRaSH entities.
   - Validation: Source ID must resolve to an existing database or TRaSH source.
   - Exception: None; orphaned entities should not be displayed.

2. **Cross-Source Name Uniqueness**: Entity names are unique within a single PCD database cache but
   may collide across databases/sources. The sync pipeline handles this via invisible namespace
   suffixes at sync time.
   - Validation: Display names do not include namespace suffixes; they appear as authored.
   - Exception: When two entities from different sources share the same name, the UI must show a
     source indicator to disambiguate.

3. **TRaSH Source Arr Type Scoping**: Each TRaSH source is locked to a single `arr_type` (radarr or
   sonarr). TRaSH entities should only appear in sync configurations for matching Arr instance
   types.
   - Validation: `trash_guide_sync_config` enforces `ai.type = s.arr_type` via JOIN.
   - Exception: PCD databases are Arr-agnostic at the storage level; their entities are filtered at
     query time by Arr capabilities.

4. **Read-Only TRaSH Entities**: TRaSH Guide entities are imported as base ops and should not be
   directly editable through the standard entity edit forms. They can only be overridden via user
   ops.
   - Validation: `canWriteToBase` returns false for TRaSH-backed databases (if exposed as PCD
     caches) or the write path is blocked entirely.
   - Exception: User ops (local overrides) on top of TRaSH base data are allowed.

5. **Sync Selection Aggregation**: The sync config page must present entities from all compatible
   sources (PCD databases + TRaSH sources) grouped by source. The existing pattern in
   `QualityProfiles.svelte` iterates `databases` array and groups profiles under database headers.
   - Validation: Each selection carries `{ databaseId | sourceId, profileName }`.
   - Exception: Delay profiles and media management currently use single-selection (one
     database+config), not multi-select. Whether TRaSH provides delay profiles or media management
     configs needs to be verified per entity type.

6. **TRaSH Entity Types Supported**: TRaSH sources provide: `custom_format`, `quality_profile`,
   `quality_size`, and `naming`. These map to the entity pages: Custom Formats, Quality Profiles,
   Quality Definitions (media management), and Naming (media management).
   - Validation: Only entity types present in `TRASHGUIDE_ENTITY_TYPES` should be surfaced.
   - Exception: TRaSH does not provide delay profiles or media settings, so those pages need no
     TRaSH integration.

### Edge Cases

- **Empty Sources**: A TRaSH source that has been linked but not yet synced (or failed sync) will
  have zero entities. The UI should show the source tab/section but indicate it has no content yet.
- **Disabled Sources**: Both PCD databases and TRaSH sources have an `enabled` flag. Disabled
  sources should still appear in the databases list page but may be excluded from entity listing
  tabs and sync selections. Current behavior shows all databases regardless of enabled state.
- **Overlapping Entity Names**: When a TRaSH "HD Bluray" CF and a PCD "HD Bluray" CF exist, the
  listing page must show both with source indicators. The sync page must allow selecting one or both
  (namespace suffixes handle deduplication at sync time).
- **TRaSH Source Deletion Mid-Sync**: If a TRaSH source is unlinked while its entities are selected
  in a sync config, the sync should fail gracefully. The `trash_guide_sync_config` has CASCADE
  deletes on the source FK.
- **Multiple TRaSH Sources for Same Arr Type**: A user could link two TRaSH sources for Radarr
  (e.g., different branches or score profiles). Both should appear as separate sources in entity
  listings and sync selection.

## Workflows

### Current Flow: Viewing Custom Formats

1. User navigates to `/custom-formats`.
2. Server loads all PCD databases via `pcdManager.getAll()`.
3. Client-side redirect to `/custom-formats/[databaseId]` (last-selected or first).
4. Server loads CFs from the selected database's PCD cache.
5. Database tabs (`Tabs` component) allow switching between PCD databases.
6. No TRaSH source data is visible.

### Current Flow: Configuring Arr Sync

1. User navigates to `/arr/[id]/sync`.
2. Server loads all PCD databases and queries each for quality profiles, delay profiles, naming,
   quality definitions, and media settings (filtered by instance `arr_type`).
3. UI renders sections: Media Management, Quality Profiles, Delay Profiles (and Metadata Profiles
   for Lidarr).
4. Quality Profiles section groups profiles under database name headers with Toggle components.
5. Media Management uses SearchDropdown with `{dbName} / {configName}` format.
6. Delay Profiles uses the same SearchDropdown pattern (single selection).
7. No TRaSH source data is available for selection.

### Proposed Flow: Viewing Custom Formats with Source Filtering

1. User navigates to `/custom-formats`.
2. Server loads PCD databases AND TRaSH sources.
3. Client-side redirect to `/custom-formats/[sourceType]-[sourceId]` or similar.
4. Tabs now include both PCD database tabs and TRaSH source tabs (with visual distinction via
   badges/icons).
5. Optionally, an "All Sources" tab could show a merged view with source indicators on each entity.
6. Source badges (PCD/TRaSH + source name) appear on entity cards/rows.
7. Search filters across the current source's entities.

### Proposed Flow: Configuring Arr Sync with TRaSH Sources

1. User navigates to `/arr/[id]/sync`.
2. Server loads PCD databases AND TRaSH sources matching the instance's `arr_type`.
3. Quality Profiles section now has additional database groups for each compatible TRaSH source,
   with TRaSH badge indicators.
4. Media Management dropdowns include TRaSH naming configs and quality definitions alongside PCD
   options.
5. TRaSH sections include entity count badges so users understand scope.
6. Selections are persisted to `trash_guide_sync_selections` (for TRaSH) and
   `arr_sync_quality_profiles` (for PCD) as appropriate.

### Decision Points When Sources Overlap

- **Same-name entity from two sources**: Show both with source indicator. User decides which to
  sync.
- **PCD entity overridden by user ops**: Show as PCD entity with "customized" indicator. TRaSH
  equivalent (if exists) shows separately.
- **TRaSH source disabled**: Hide from sync selection but keep in entity browsing with "disabled"
  state.

## Domain Model

### Key Entities

- **DatabaseInstance** (`database_instances` table): A PCD repository link. Has `id`, `name`,
  `repository_url`, `enabled`, `sync_strategy`. Provides entities via in-memory SQLite PCD caches.
- **TrashGuideSource** (`trash_guide_sources` table): A TRaSH Guide repository link scoped to one
  `arr_type`. Has `id`, `name`, `repository_url`, `branch`, `arr_type`, `score_profile`, `enabled`.
  Provides entities via `trash_guide_entity_cache` table.
- **UnifiedDatabaseItem** (client type in `databases/types.ts`): Discriminated union of `pcd` and
  `trash` types used on the databases listing page. This pattern is the blueprint for unified source
  representation.
- **PCD Cache** (in-memory SQLite): Per-database entity store. Queried via entity-specific modules
  under `$pcd/entities/`.
- **TrashGuideEntityCache** (`trash_guide_entity_cache` table): Stores parsed TRaSH entities with
  `source_id`, `trash_id`, `entity_type`, `name`, `json_data`.
- **TrashGuideSyncConfig** (`trash_guide_sync_config` table): Per instance-source sync configuration
  with trigger, status, and cron.
- **TrashGuideSyncSelection** (`trash_guide_sync_selections` table): Per instance-source entity
  selections with `section_type` and `item_name`.
- **ArrSyncQualityProfile** (via `arrSyncQueries`): Current PCD-only quality profile sync selection
  with `databaseId` and `profileName`.

### State Transitions

- **TRaSH Source Created** -> **Entities Parsed** -> **Cache Populated** -> **Entities Visible in
  UI**
- **TRaSH Sync Config Exists** -> **Entity Selected** -> **Sync Triggered** -> **Entities Pushed to
  Arr**
- **Source Disabled** -> **Entities Hidden from Sync Selection** (browsing still possible)
- **Source Unlinked** -> **All Related Sync Configs/Selections Cascade Deleted** -> **Entities
  Removed from UI**

## Existing Codebase Integration

### Related Files

- `/packages/praxrr-app/src/routes/databases/+page.svelte`: Already implements unified PCD+TRaSH
  listing via `UnifiedDatabaseItem`. The pattern of `pcdToUnifiedItem` and `trashToUnifiedItem`
  mappers is the canonical approach for multi-source unification.
- `/packages/praxrr-app/src/routes/databases/types.ts`: Defines `UnifiedDatabaseItem` discriminated
  union and mapper functions.
- `/packages/praxrr-app/src/routes/custom-formats/[databaseId]/+page.svelte`: Per-database CF
  listing with database tabs. Needs TRaSH source tabs added.
- `/packages/praxrr-app/src/routes/custom-formats/[databaseId]/+page.server.ts`: Loads CFs from PCD
  cache. Needs TRaSH entity cache integration.
- `/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/+page.svelte`: Per-database QP
  listing. Same pattern as CF page.
- `/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/+page.server.ts`: Loads QPs from
  PCD cache.
- `/packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte`: Sync config page. Quality profiles,
  delay profiles, and media management selection.
- `/packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts`: Loads entities from all PCD
  databases. Needs TRaSH source aggregation.
- `/packages/praxrr-app/src/routes/arr/[id]/sync/components/QualityProfiles.svelte`: Multi-database
  quality profile toggle grid. Most directly needs TRaSH source groups added.
- `/packages/praxrr-app/src/routes/arr/[id]/sync/components/MediaManagement.svelte`: Database+config
  SearchDropdown for naming, quality definitions, and media settings.
- `/packages/praxrr-app/src/lib/server/trashguide/manager.ts`: `TrashGuideManager` class with
  `listSources()`, `getSource()`, entity lifecycle.
- `/packages/praxrr-app/src/lib/server/db/queries/trashGuideSources.ts`: CRUD for
  `trash_guide_sources` table.
- `/packages/praxrr-app/src/lib/server/db/queries/trashGuideSync.ts`: Sync config and selection CRUD
  for `trash_guide_sync_config` and `trash_guide_sync_selections`.
- `/packages/praxrr-app/src/lib/server/db/queries/trashGuideEntityCache.ts`: Entity cache CRUD.
- `/packages/praxrr-app/src/lib/server/trashguide/transformer.ts`: Transforms TRaSH parsed entities
  into portable format for PCD ops.
- `/packages/praxrr-app/src/lib/client/stores/dataPage.ts`: `createDataPageStore` with search, view
  toggle, and filtering.
- `/packages/praxrr-app/src/lib/client/stores/search.ts`: Search store with debouncing, filters, and
  persistence.
- `/packages/praxrr-app/src/lib/client/ui/navigation/tabs/Tabs.svelte`: Tab component with
  responsive mobile dropdown, icon support.
- `/packages/praxrr-app/src/lib/client/ui/badge/Badge.svelte`: Badge component with variants:
  accent, neutral, success, warning, danger, info, radarr, sonarr, lidarr.
- `/packages/praxrr-app/src/lib/client/ui/actions/ActionsBar.svelte`: Actions bar layout component.
- `/packages/praxrr-app/src/lib/client/ui/actions/SearchAction.svelte`: Search input wired to search
  store.
- `/packages/praxrr-app/src/lib/client/ui/actions/ViewToggle.svelte`: Table/card view toggle.
- `/packages/praxrr-app/src/lib/client/ui/toggle/Toggle.svelte`: Checkbox toggle used in sync
  selection grids.
- `/packages/praxrr-app/src/lib/client/ui/form/SearchDropdown.svelte`: Search dropdown used in media
  management sync config.
- `/packages/praxrr-app/src/lib/shared/pcd/display.ts`: Display types for entities
  (`CustomFormatTableRow`, `QualityProfileTableRow`).
- `/packages/praxrr-app/src/lib/shared/navigation/types.ts`: Navigation shell types.
- `/packages/praxrr-app/src/lib/client/stores/navScope.ts`: Arr-type scope store for filtering
  navigation items.

### Patterns to Follow

- **Discriminated Union for Source Types**: The `UnifiedDatabaseItem` pattern in
  `databases/types.ts` uses a `type: 'pcd' | 'trash'` discriminant. Extend this pattern for unified
  entity representations.
- **Database Tabs Pattern**: Entity listing pages (`custom-formats/[databaseId]`,
  `quality-profiles/[databaseId]`) map databases to tabs via
  `data.databases.map(db => ({ label: db.name, href, active }))`. TRaSH sources should be appended
  to this tab list with distinguishing icons or badges.
- **Data Page Store**: `createDataPageStore` provides search, view toggle, and item filtering. This
  is used on all entity listing pages and should continue to be used for unified entity lists.
- **Sync Section Component Pattern**: Each sync section (QualityProfiles, DelayProfiles,
  MediaManagement) is a standalone component with `databases` prop, `state` binding, dirty tracking,
  and `SyncFooter`. TRaSH sources should follow the same structural pattern.
- **SearchDropdown for Single Selection**: Media management uses `SearchDropdown` with
  `{dbName} / {configName}` labels. TRaSH options should use `{sourceName} / {configName}` with a
  TRaSH badge or prefix.
- **Toggle Grid for Multi-Selection**: Quality profiles use a grid of `Toggle` components grouped by
  database. TRaSH sources should add additional database groups with TRaSH badges.
- **localStorage Persistence**: Selected database tab and search state are persisted via
  localStorage keys like `customFormatsDatabase`, `qualityProfilesView`, etc.

### Components to Leverage

- **Badge** (`$ui/badge/Badge.svelte`): Use `variant="accent"` for TRaSH indicators (already used on
  databases page). Use `variant="neutral"` with `mono` for PCD indicators.
- **Tabs** (`$ui/navigation/tabs/Tabs.svelte`): Already supports icons on tabs. Add TRaSH-specific
  icons to distinguish source tabs.
- **Table/TableView**: Existing table components support custom cell rendering via slots. Add a
  source column or badge overlay.
- **CardView**: Existing card components can be extended with source badges in the header area.
- **DatabaseAvatar** (`databases/components/DatabaseAvatar.svelte`): Avatar component that generates
  consistent visuals from name/URL. Could be reused for source identification.
- **ActionsBar**: Container for search, filter, and view toggle actions. Source filter dropdown
  could be added here.
- **SearchFilterAction** (`custom-formats/[databaseId]/components/SearchFilterAction.svelte`):
  Existing search filter toggle for CF pages. Source filtering could follow a similar dropdown
  pattern.

## Success Criteria

- [ ] Custom formats page shows entities from both PCD databases and TRaSH sources with clear source
      indicators.
- [ ] Quality profiles page shows entities from both PCD databases and TRaSH sources with clear
      source indicators.
- [ ] Entity listing tabs include both PCD database tabs and TRaSH source tabs with visual
      distinction.
- [ ] Arr sync config page shows TRaSH quality profiles alongside PCD quality profiles for
      selection.
- [ ] Arr sync config page shows TRaSH naming/quality definitions in media management dropdowns.
- [ ] Source filter/tab selection persists across page navigations via localStorage.
- [ ] TRaSH entities are visually read-only (no edit/delete buttons) on entity listing pages.
- [ ] Empty TRaSH sources show appropriate empty state messages.
- [ ] Disabled TRaSH sources are handled consistently with disabled PCD databases.
- [ ] No regression in existing PCD-only entity browsing or sync configuration flows.

## Open Questions

1. **Unified Entity Route Scheme**: Should TRaSH entity detail pages use a new route pattern (e.g.,
   `/custom-formats/trash-[sourceId]/[entityName]`) or reuse the existing `[databaseId]` pattern
   with a type prefix? The current `[databaseId]` route expects a numeric PCD database ID.

2. **TRaSH Entity Detail Views**: Should clicking a TRaSH entity from the listing page navigate to a
   detail view? If so, what level of detail is shown (read-only form vs. summary card)? TRaSH
   entities are stored as JSON blobs in `trash_guide_entity_cache`, not as compiled PCD cache rows.

3. **"All Sources" Merged View**: Is there value in an "All Sources" tab that merges entities from
   all databases and sources into a single filterable list? This adds complexity but provides a
   unified search experience.

4. **Sync Selection Persistence Model**: Should TRaSH entity sync selections be stored in the
   existing `arr_sync_quality_profiles` table (with a source type discriminant) or exclusively in
   `trash_guide_sync_selections`? The current tables are separate and would require UI-side
   unification.

5. **TRaSH Entities in Delay Profiles and Media Settings**: TRaSH provides `quality_size` and
   `naming` entities but not delay profiles or media settings. Should the media management section
   of the sync page include TRaSH quality definitions and naming configs, or is that handled
   differently since TRaSH data flows through the PCD ops transformer?

6. **Database Page Source Filter**: The databases listing page already shows a unified list. Should
   it also support filtering by source type (PCD vs. TRaSH)?

7. **Batch Operations Across Sources**: What specific batch operations are needed? Select-all within
   a source? Cross-source multi-select for sync? Bulk enable/disable?
