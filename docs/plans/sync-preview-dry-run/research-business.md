# Business Logic Research: sync-preview-dry-run

## Executive Summary

Sync Preview / Dry-Run enables Praxrr users to see exactly what a sync operation would create, update, or delete on their Arr instances before any changes are applied. The existing sync pipeline already follows a clear fetch-from-PCD, transform-to-Arr, push-to-Arr pattern across four section types (quality profiles with custom formats, delay profiles, media management, metadata profiles), and the preview feature can be implemented by intercepting the pipeline after the transform step, diffing the transformed payload against live Arr state, and returning the diff without executing writes. This is the highest-priority user-facing feature: it addresses the most dangerous failure mode in Arr config management (silent, unreviewed changes) and no competitor currently offers it.

## User Stories

### Primary User: Praxrr Admin (Single Instance)

- As a Praxrr admin with a single Radarr instance, I want to preview what changes a sync will make to my quality profiles and custom formats so that I can verify correctness before applying changes that could affect my library's download behavior.
- As a Praxrr admin, I want to see field-level diffs (e.g., "score changed from 100 to 150 on custom format 'HDR10+'") so that I can understand the impact of upstream PCD changes before they reach my Arr instance.
- As a Praxrr admin, I want to know which custom formats will be created, which will be updated, and which quality profiles will change their quality ordering, cutoff, or format scores, so I can catch misconfiguration before it propagates.

### Primary User: Praxrr Admin (Multi-Instance)

- As a Praxrr admin managing multiple Arr instances (e.g., Radarr, Sonarr, Lidarr), I want to preview sync changes per-instance so that I can confirm each instance receives the correct configuration for its type.
- As a Praxrr admin with multi-database sync, I want the preview to show namespace-suffixed entities grouped by database so I can verify that cross-database isolation is working correctly.
- As a Praxrr admin, I want to preview changes across all my instances at once so I can do a single review pass before confirming a batch sync.

### Secondary User: API Consumer

- As an API consumer, I want a `?dry_run=true` flag on sync endpoints so that I can programmatically verify what changes would occur without executing them.
- As an automation engineer, I want the dry-run response to be machine-parseable (structured JSON with create/update/delete arrays and field-level diffs) so I can build approval workflows or CI/CD gates around sync operations.

### Secondary User: Praxrr Admin (Post-PCD-Update)

- As a Praxrr admin who just pulled a PCD database update, I want to see what the auto-triggered sync would change on my instances so I can decide whether to let it proceed or investigate first.
- As a Praxrr admin, I want a warning if the preview shows deletions (via cleanup) of quality profiles that are currently assigned to media items, so I can avoid breaking my library.

## Business Rules

### Core Rules

1. **Same Code Path for Preview and Execute**: The preview must use the identical fetch-from-PCD and transform-to-Arr logic that the actual sync uses. This prevents preview/execute drift. The divergence point is at the push step: preview compares the transformed payload against live Arr state; execute sends the payload to the Arr API.

2. **Entity Matching by Suffixed Name**: Custom formats and quality profiles are matched between PCD and Arr by their namespace-suffixed name (PCD name + zero-width Unicode suffix). Delay profiles are matched by their resolved target ID (default profile). Media management and naming configs are matched by their singleton config ID. Metadata profiles are matched by suffixed name.

3. **Change Classification**: Every entity in the preview must be classified as one of:
   - **Create**: Transformed PCD entity has no matching entity on the Arr instance (by suffixed name or ID)
   - **Update**: Transformed PCD entity matches an existing Arr entity but one or more fields differ
   - **No Change**: Transformed PCD entity matches and all fields are identical
   - **Delete** (cleanup only): Arr entity exists but is not in the expected set (only shown when cleanup preview is requested)

4. **Field-Level Diff for Updates**: When an entity is classified as "update," the preview must show which fields changed and their before/after values. This applies to:
   - Quality profiles: quality ordering, cutoff, upgradeAllowed, format scores, language, minFormatScore, cutoffFormatScore, minUpgradeFormatScore
   - Custom formats: specifications list (conditions), includeCustomFormatWhenRenaming
   - Delay profiles: protocol settings, delays, bypass flags
   - Media management: each sub-section (naming fields, quality definition sizes, media settings fields)
   - Metadata profiles: primary/secondary album types, release statuses

5. **Per-Instance Scoping**: Preview is always scoped to a single Arr instance. Multi-instance preview is achieved by running per-instance previews in parallel (up to the existing CONCURRENCY_LIMIT of 3).

6. **Per-Section Scoping**: Preview can be scoped to specific section types (qualityProfiles, delayProfiles, mediaManagement, metadataProfiles) or can preview all configured sections for an instance.

7. **Arr Type Validation**: Per the Cross-Arr Semantic Validation Policy, the preview must validate that section support, quality definitions, language mappings, and condition transformations are correct for the specific `arr_type` of the target instance. The same `SUPPORTED_SYNC_SECTIONS` and `getUnsupportedSyncSectionReason` checks used in sync must apply during preview.

8. **Preview Staleness Detection**: A preview captures a snapshot of both PCD state and Arr state at a point in time. If either changes between preview generation and user confirmation, the preview is stale. The system must detect staleness by comparing timestamps or state hashes and require re-preview before allowing execution.

9. **Read-Only Remote Operations**: Preview must only perform GET requests against Arr APIs (getCustomFormats, getQualityProfiles, getDelayProfiles, getMediaManagementConfig, getNamingConfig, getQualityDefinitions, getMetadataProfiles). No POST, PUT, or DELETE requests during preview generation.

10. **No Database Side Effects**: Generating a preview must not modify `sync_status`, `should_sync`, `last_synced_at`, or any other sync state columns in the app database. It is a pure read operation from the perspective of both the app DB and the Arr instance.

### Edge Cases

- **Empty Sync Config**: If an instance has no sync selections configured for a section, the preview for that section should return an empty changeset (not an error). This matches the current sync behavior where `fetchFromPcd` returns empty arrays.

- **Missing PCD Cache**: If a database referenced by a sync selection has no compiled PCD cache (e.g., database was just linked but not yet compiled), the preview should report this as a warning per-database, not a hard failure. Other databases in the same sync should still preview.

- **Deleted Database Reference**: If a sync selection references a `database_id` that no longer exists (stale reference), the preview should skip that selection with a warning, matching the existing `fetchSyncBatchByDatabase` behavior.

- **Lidarr-Specific Condition Skipping**: Custom format conditions that are unsupported for Lidarr (language, source, resolution, etc.) are silently skipped during transform. The preview should surface these as informational notes so the user understands why a Lidarr custom format might have fewer specifications than expected.

- **Namespace Overflow**: When more than 5 databases are linked to a single instance, namespace suffixes use repeated zero-width spaces. Preview should display the database name rather than trying to render invisible suffix characters.

- **Quality Profile Assigned to Media**: When previewing cleanup/deletes, quality profiles that are assigned to media items on the Arr instance cannot be deleted (Arr returns HTTP 500). The preview should flag these as "delete blocked - assigned to media" so the user knows they will be skipped.

- **Concurrent Preview and Sync**: If a sync is already in_progress for a section when a preview is requested, the preview should still succeed (it only reads from Arr APIs). However, the preview result may be stale by the time the in-progress sync completes. The UI should warn about this.

- **API Connection Failure**: If the Arr instance is unreachable during preview, the error should be surfaced immediately. The preview cannot proceed without live Arr state. This is different from PCD-only operations which work offline.

- **Zero-Score Format Items**: Arr requires every custom format to appear in a quality profile's formatItems (even with score 0). The preview should not show these zero-score entries as "changes" unless the score actually changed from a non-zero value.

## Workflows

### Primary Workflow: Preview Single Instance Sync

1. User navigates to `/arr/[id]/sync` page for a specific Arr instance.
2. User clicks "Preview Sync" button (new UI element alongside existing "Sync Now" buttons).
3. System validates the instance is enabled and reachable (testConnection or lightweight GET).
4. For each configured section (quality profiles, delay profiles, media management, metadata profiles):
   a. System fetches PCD data using the same `fetchFromPcd` / `fetchSyncBatchByDatabase` logic.
   b. System transforms PCD data to Arr format using the same `transformToArr` / `transformQualityProfile` / `transformCustomFormat` logic.
   c. System fetches current state from Arr instance using read-only API calls (GET endpoints).
   d. System computes diff between transformed PCD data and live Arr state.
5. System returns structured preview result containing per-section changesets.
6. UI renders the preview in a diff-style view showing creates (green), updates (yellow with field diffs), no-changes (gray/collapsed), and potential deletes (red, if cleanup preview requested).
7. User reviews the preview and either:
   a. Clicks "Apply" to execute the sync (using the same sync pipeline).
   b. Clicks "Cancel" to discard the preview.
   c. Navigates away (preview is discarded; dirty-tracking should warn).

### Secondary Workflow: Preview All Instances

1. User navigates to a "Sync Overview" or "Preview All" view (new route or existing instances list enhancement).
2. System iterates over all enabled instances with sync configurations.
3. For each instance, system generates a preview (same as single-instance workflow steps 3-5).
4. UI presents a summary table: instance name, section, creates/updates/deletes counts.
5. User can expand any instance to see detailed diffs.
6. User can confirm sync for individual instances or all at once.

### Secondary Workflow: API Dry-Run

1. API consumer sends POST to `/api/v1/arr/sync/preview` (new endpoint) with body: `{ instanceId: number, sections?: SectionType[] }`.
2. System generates preview using the same logic as the UI workflow.
3. System returns JSON response with structured changeset.
4. Alternatively, existing sync trigger endpoints accept `?dry_run=true` query parameter.

### Staleness Handling Workflow

1. System generates preview and records a `previewGeneratedAt` timestamp plus a hash of the PCD cache state (based on the latest ops batch ID or cache build timestamp).
2. When user clicks "Apply," the system checks:
   a. Has the PCD cache been recompiled since the preview? (Compare batch IDs.)
   b. Has the Arr instance state changed? (Optional: compare a lightweight signature like count + last-modified of remote CFs/QPs.)
3. If stale: system shows a warning with the option to re-preview or force-apply.
4. If fresh: system proceeds with sync execution.

### Partial Sync Handling Workflow

1. Preview shows changes across multiple sections (e.g., quality profiles and media management).
2. User wants to apply only quality profiles changes but skip media management.
3. User selects which sections to apply via checkboxes in the preview UI.
4. System executes sync only for selected sections, respecting the existing section ordering (quality profiles before delay profiles, etc.).

## Domain Model

### Key Entities

- **ArrInstance**: A configured connection to a Radarr, Sonarr, or Lidarr instance. Identified by `id`, typed by `type` (radarr/sonarr/lidarr). Has `url`, encrypted `api_key`, `enabled` flag. Source: `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`.

- **SyncConfig**: Per-instance, per-section configuration stored across multiple tables (`arr_sync_quality_profiles`, `arr_sync_quality_profiles_config`, `arr_sync_delay_profiles_config`, `arr_sync_media_management`, `arr_sync_metadata_profiles_config`). Stores trigger type (manual/on_pull/on_change/schedule), cron expression, and sync status (idle/pending/in_progress/failed). Source: `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`.

- **ProfileSelection**: Links an instance to a specific quality profile in a specific PCD database. Has `instance_id`, `database_id`, `profile_name`. Source: same as SyncConfig.

- **PCDCache**: In-memory SQLite database compiled from PCD operations. Contains the resolved state of all entities (quality profiles, custom formats, delay profiles, naming configs, quality definitions, media settings, metadata profiles). Keyed by `database_id`. Source: `packages/praxrr-app/src/lib/server/pcd/database/cache.ts`.

- **Namespace**: Zero-width Unicode suffix system that allows multiple PCD databases to coexist on a single Arr instance. Managed via `arr_namespaces` table mapping `(instance_id, database_id) -> namespace_index`. Source: `packages/praxrr-app/src/lib/server/sync/namespace.ts`.

- **SectionType**: One of `qualityProfiles`, `delayProfiles`, `mediaManagement`, `metadataProfiles`. Each section has a registered handler implementing the `SectionHandler` interface. Source: `packages/praxrr-app/src/lib/server/sync/types.ts`.

- **SectionHandler**: Registry-based handler providing section-specific sync operations (claim, complete, fail, createSyncer). Source: `packages/praxrr-app/src/lib/server/sync/registry.ts`.

- **BaseSyncer**: Abstract class defining the fetch-transform-push pattern. Each section type has a concrete implementation. Source: `packages/praxrr-app/src/lib/server/sync/base.ts`.

### Entity Types Per Arr App

| Entity              | Radarr                 | Sonarr                 | Lidarr                      |
| ------------------- | ---------------------- | ---------------------- | --------------------------- |
| Quality Profiles    | Yes                    | Yes                    | Yes                         |
| Custom Formats      | Yes                    | Yes                    | Yes (subset of conditions)  |
| Delay Profiles      | Yes (id=1)             | Yes (id=1)             | Yes (resolved default)      |
| Media Settings      | Yes                    | Yes                    | Yes (partial field support) |
| Naming              | Radarr-specific fields | Sonarr-specific fields | Lidarr-specific fields      |
| Quality Definitions | Yes                    | Yes                    | Yes (subset of mappings)    |
| Metadata Profiles   | No                     | No                     | Yes                         |

### Preview-Specific Domain Concepts

- **PreviewChangeset**: The result of comparing transformed PCD state against live Arr state for one section of one instance. Contains arrays of creates, updates, no-changes, and (optionally) deletes.

- **EntityDiff**: A single entity comparison result. For updates, includes field-level before/after values. For creates, includes the full entity that would be created. For deletes, includes the existing entity that would be removed.

- **PreviewSnapshot**: Metadata about when the preview was generated. Includes `generatedAt` timestamp, PCD cache state identifier (batch ID or build timestamp), and optionally an Arr state signature (entity counts).

### State Transitions

```
Preview Lifecycle:
  [none] -> generating -> ready -> (stale | applied | discarded)

  generating:  System is fetching PCD data, transforming, and diffing against Arr
  ready:       Preview is complete and displayed to user
  stale:       PCD or Arr state changed since preview was generated
  applied:     User confirmed and sync was executed successfully
  discarded:   User cancelled or navigated away
```

Note: Preview state is ephemeral (in-memory or session-scoped). It does not persist in the app database. Only the sync execution itself writes to the database (sync_status, last_synced_at, etc.).

## Existing Codebase Integration

### Current Sync Pipeline Analysis

The sync pipeline follows a consistent pattern across all four section types:

1. **Entry Points**: Sync can be triggered via:
   - Manual "Sync Now" button (routes to form action in `/arr/[id]/sync/+page.server.ts` which enqueues a job)
   - Event triggers (PCD pull/change via `triggerSyncs()` in `processor.ts`)
   - Scheduled cron via `evaluateScheduledSyncs()` in `processor.ts`
   - Job handler execution in `handlers/arrSync.ts`

2. **Processing Flow** (quality profiles as representative example):
   - `QualityProfileSyncer.sync()` orchestrates the full flow
   - `fetchSyncBatchByDatabase()` groups selections by database, resolves namespace suffixes, fetches PCD data
   - `syncCustomFormats()` transforms and pushes CFs first (creates or updates by suffixed name match)
   - After CFs are synced, refreshes full CF list from Arr to get resolved IDs
   - `syncQualityProfiles()` transforms QPs using `transformQualityProfile()` and pushes (create or update by suffixed name match)

3. **Key Architectural Insight**: The sync code already performs the "compare by name" operation internally. In `syncCustomFormats()` (line 79 of `customFormats/syncer.ts`), it checks `existingMap.has(suffixedName)` to decide create vs update. In `QualityProfileSyncer.syncQualityProfiles()` (line 329 of `qualityProfiles/syncer.ts`), it checks `existingMap.has(suffixedName)`. The preview feature needs to extract this comparison logic into a reusable diff function rather than letting it drive immediate API calls.

4. **Cleanup Pipeline**: The cleanup system (`cleanup.ts`) already implements a preview-like pattern: `scanForStaleItems()` computes what would be deleted, then `deleteStaleItems()` executes. The `/api/v1/arr/cleanup` endpoint uses a two-phase scan/execute pattern that directly maps to preview/apply. This is the closest existing pattern to what sync preview needs.

### Patterns to Follow

- **Cleanup Scan/Execute Pattern**: `cleanup.ts` and the `/api/v1/arr/cleanup` route already implement a two-phase approach (scan result returned to client, client sends scan result back with execute action). The sync preview should follow this same pattern for API ergonomics.

- **Section Registry Pattern**: The `SectionHandler` interface and `registerSection()` registry provide a clean extension point. Preview can be added as an additional method on the handler interface, or preview logic can be implemented as a parallel function that reuses the handler's `createSyncer()` factory.

- **BaseSyncer Template Method**: The `BaseSyncer` class defines `fetchFromPcd()`, `transformToArr()`, `pushToArr()`. For preview, we need `fetchFromPcd()` and `transformToArr()` but replace `pushToArr()` with a `diffWithArr()` step. This suggests either:
  - Adding a `preview()` method alongside `sync()` on `BaseSyncer`
  - Creating a parallel `BasePreviewSyncer` that reuses fetch/transform but does diff instead of push
  - Passing a `mode: 'sync' | 'preview'` flag that controls whether `pushToArr()` or `diffWithArr()` is called

- **Job Queue Integration**: The existing job queue handles sync jobs via `arr.sync.*` job types. Preview could either:
  - Be a synchronous operation (no job queue, returns directly from API endpoint) since it is read-only
  - Use the job queue with a new `arr.sync.preview.*` job type for consistency and to avoid blocking the server

- **Concurrency Model**: The existing `CONCURRENCY_LIMIT = 3` for parallel instance processing and `processBatches()` utility should be reused if implementing multi-instance preview.

### Relevant Files

- `/packages/praxrr-app/src/lib/server/sync/processor.ts`: Main sync orchestrator. `processPendingSyncs()` and `syncInstance()` are the key entry points. Preview would add a parallel `previewInstance()` function.
- `/packages/praxrr-app/src/lib/server/sync/base.ts`: `BaseSyncer` abstract class defining the fetch-transform-push pattern. Preview extends or parallels this.
- `/packages/praxrr-app/src/lib/server/sync/types.ts`: All sync type definitions. Preview types would be added here.
- `/packages/praxrr-app/src/lib/server/sync/registry.ts`: Section handler registry. May need extension for preview support.
- `/packages/praxrr-app/src/lib/server/sync/cleanup.ts`: Existing scan/execute pattern that directly informs preview design.
- `/packages/praxrr-app/src/lib/server/sync/namespace.ts`: Namespace suffix logic, critical for entity matching in preview.
- `/packages/praxrr-app/src/lib/server/sync/mappings.ts`: Arr-type-specific quality/language/source mappings, section support checks.
- `/packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts`: Most complex syncer. Preview must handle the multi-database batch flow, CF-before-QP ordering, and namespace suffixing.
- `/packages/praxrr-app/src/lib/server/sync/qualityProfiles/transformer.ts`: PCD-to-Arr transformation for quality profiles. Reused directly by preview.
- `/packages/praxrr-app/src/lib/server/sync/customFormats/syncer.ts`: CF sync with create/update detection by suffixed name. Preview extracts this matching logic.
- `/packages/praxrr-app/src/lib/server/sync/customFormats/transformer.ts`: PCD-to-Arr transformation for custom formats with Lidarr condition skipping. Reused directly by preview.
- `/packages/praxrr-app/src/lib/server/sync/delayProfiles/syncer.ts`: Delay profile sync with Lidarr default profile resolution. Preview must handle the same resolution logic.
- `/packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts`: Media management sync with three sub-sections (media settings, naming, quality definitions). Preview generates per-sub-section diffs.
- `/packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts`: Metadata profile sync with Lidarr schema normalization. Preview must use the same schema normalization.
- `/packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`: All sync config queries. Preview reads config but does not modify state.
- `/packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: Instance queries for validation and client creation.
- `/packages/praxrr-app/src/lib/server/utils/arr/base.ts`: `BaseArrClient` with all Arr API methods. Preview uses only GET methods.
- `/packages/praxrr-app/src/lib/server/pcd/database/cache.ts`: `PCDCache` class providing the compiled PCD state. Preview reads from this.
- `/packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`: Job handler for sync. Preview may add a parallel handler or bypass the job queue.
- `/packages/praxrr-app/src/lib/server/jobs/dispatcher.ts`: Job dispatcher. Relevant if preview uses the job queue.
- `/packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts`: Sync UI page server. Preview adds new form actions or API calls.
- `/packages/praxrr-app/src/routes/api/v1/arr/cleanup/+server.ts`: Cleanup API with scan/execute pattern. Direct pattern reference for preview API.
- `/packages/praxrr-app/src/lib/shared/arr/capabilities.ts`: Arr capabilities registry. Preview respects the same capability checks.
- `/packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`: Arr client factory with caching. Preview creates clients the same way.

## Success Criteria

- [ ] Preview generates an accurate diff for all four section types (quality profiles + CFs, delay profiles, media management, metadata profiles) that matches what the actual sync would do.
- [ ] Preview uses the same transformation code path as sync (no duplicated transform logic).
- [ ] Preview performs zero write operations against Arr APIs (GET only).
- [ ] Preview does not modify any app database state (sync_status, should_sync, etc.).
- [ ] Preview works correctly with multi-database namespace suffixing.
- [ ] Preview correctly handles Arr-type-specific differences (Lidarr condition skipping, Radarr-only language config, Sonarr-only release types, Lidarr metadata profiles).
- [ ] Preview result includes field-level diffs for updated entities.
- [ ] Preview API endpoint returns structured JSON suitable for both UI rendering and programmatic consumption.
- [ ] Stale preview detection prevents applying outdated diffs.
- [ ] Preview works for both single-instance and multi-instance scenarios.
- [ ] UI shows clear create/update/no-change/delete classification with appropriate visual treatment.
- [ ] API supports `dry_run` flag for programmatic use alongside UI preview.

## Open Questions

- **Preview Persistence**: Should preview results be persisted (in app DB or session storage) to support the apply-from-preview flow, or should the client hold the preview state in-memory? Persisting enables server-side staleness checks and multi-tab scenarios. In-memory is simpler but requires the client to re-send context on apply.

- **Cleanup Integration**: Should cleanup preview (stale entity detection) be part of the sync preview or remain a separate operation? Currently cleanup is a distinct flow via `/api/v1/arr/cleanup`. Combining them would give users a complete picture of what sync + cleanup would do.

- **Preview for Event-Triggered Syncs**: When a PCD pull triggers an `on_pull` sync, should the system automatically generate and display a preview instead of immediately syncing? This would be the most impactful UX change but requires intercepting the existing trigger flow.

- **Preview Granularity for Media Management**: Media management syncs three sub-sections (naming, quality definitions, media settings). Should the preview show these as three separate changesets or one combined changeset? The sub-sections are independent in the current sync code.

- **Deep Equality for Custom Format Specifications**: What level of structural comparison should determine whether a custom format is "changed"? A simple JSON equality check on the specifications array works but may be sensitive to field ordering. Should the diff engine normalize field ordering before comparison?

- **Preview Timeout**: Generating a preview requires multiple Arr API calls (GET custom formats, GET quality profiles, GET delay profiles, GET media management config, GET naming config, GET quality definitions, GET metadata profiles). For instances with many entities, this could be slow. Should there be a timeout, and what should the UX be if preview generation takes more than a few seconds?

- **Batch vs Streaming Preview**: For multi-instance preview, should the system generate all previews before returning, or stream results as each instance completes? Streaming enables faster first-render but adds complexity.
