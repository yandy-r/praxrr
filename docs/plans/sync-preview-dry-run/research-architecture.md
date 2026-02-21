# Architecture Research: sync-preview-dry-run

## System Overview

Praxrr's sync pipeline transforms PCD (Praxrr Config Database) desired state into Arr API payloads and pushes them to remote Arr instances (Radarr, Sonarr, Lidarr). The pipeline is organized around four sync "sections" (qualityProfiles, delayProfiles, mediaManagement, metadataProfiles), each with a handler/syncer/transformer pattern registered in a section registry. The sync-preview feature needs to intercept between the transform and push phases to diff transformed payloads against current Arr remote state, returning a preview of creates, updates, and deletes without executing any mutations.

## Relevant Components

### Sync Module (Core Pipeline)

- `/packages/praxrr-app/src/lib/server/sync/base.ts`: Abstract `BaseSyncer` class defining the fetch/transform/push template method. All concrete syncers override `sync()` rather than using the three-phase template, making the base class primarily a holder for `client`, `instanceId`, and `instanceName`.
- `/packages/praxrr-app/src/lib/server/sync/types.ts`: Core type definitions -- `SyncResult`, `ProcessSyncsResult`, `InstanceSyncResult`, `SectionType`, `SectionHandler`, `BaseSyncer` interface.
- `/packages/praxrr-app/src/lib/server/sync/registry.ts`: Section registry (`Map<SectionType, SectionHandler>`) with `registerSection()`, `getSection()`, `getAllSections()`. Handlers self-register on import.
- `/packages/praxrr-app/src/lib/server/sync/processor.ts`: Orchestrator -- `processPendingSyncs()`, `syncInstance()`, `triggerSyncs()`. Handles concurrency (limit 3), schedule evaluation, pending sync grouping by instance, and section claim/complete/fail lifecycle.
- `/packages/praxrr-app/src/lib/server/sync/namespace.ts`: Zero-width Unicode suffix system for multi-database name isolation. `getNamespaceSuffix(index)` returns invisible characters appended to CF/QP names.
- `/packages/praxrr-app/src/lib/server/sync/mappings.ts`: Arr API constants -- qualities, languages, sources, resolutions, indexer flags per arr type. `SyncArrType = Exclude<ArrType, 'all'>`. Section ordering via `SYNC_SECTION_ORDER`.
- `/packages/praxrr-app/src/lib/server/sync/cleanup.ts`: Two-phase scan/execute pattern for stale item removal. `scanForStaleItems()` returns `CleanupScanResult` (list of stale CFs/QPs); `deleteStaleItems()` executes removals. This is a direct architectural precedent for preview's scan-then-act pattern.
- `/packages/praxrr-app/src/lib/server/sync/utils.ts`: Cron scheduling (`calculateNextRun`) and `recoverInterruptedSyncs`.
- `/packages/praxrr-app/src/lib/server/sync/index.ts`: Public module exports.

### Quality Profiles Section

- `/packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts`: `QualityProfileSyncer` -- the most complex syncer. Overrides `sync()` entirely. Pipeline: `fetchSyncBatchByDatabase()` groups selections by database with namespace suffixes, then per-database: syncs CFs via `syncCustomFormats()`, refreshes full CF list, gets quality API mappings, syncs QPs via `syncQualityProfiles()`. Each QP is created or updated based on suffixed name match in `existingMap`.
- `/packages/praxrr-app/src/lib/server/sync/qualityProfiles/transformer.ts`: `transformQualityProfile()` converts PCD profile to `ArrQualityProfilePayload`. `fetchQualityProfileFromPcd()` queries PCD cache for profile data including qualities, groups, languages, CF scores. `getReferencedCustomFormatNames()` and `getQualityApiMappings()` are key query helpers.
- `/packages/praxrr-app/src/lib/server/sync/qualityProfiles/handler.ts`: `SectionHandler` implementation wrapping `arrSyncQueries` for status transitions. Self-registers via `registerSection()`.

### Custom Formats Section

- `/packages/praxrr-app/src/lib/server/sync/customFormats/syncer.ts`: `syncCustomFormats()` function (not class-based) -- fetches existing CFs from Arr, transforms each PCD CF, creates/updates by suffixed name match. Returns `Map<string, number>` (PCD name -> Arr ID) needed by QP syncer.
- `/packages/praxrr-app/src/lib/server/sync/customFormats/transformer.ts`: `transformCustomFormatWithDiagnostics()` converts PCD conditions to `ArrCustomFormatSpecification[]`. `fetchCustomFormatFromPcd()` loads a single CF with all conditions from PCD cache. Handles Lidarr-specific condition filtering.

### Delay Profiles Section

- `/packages/praxrr-app/src/lib/server/sync/delayProfiles/syncer.ts`: `DelayProfileSyncer` -- syncs a single delay profile to the default profile (id=1 for Radarr/Sonarr, resolved at runtime for Lidarr). Inline transform (no separate transformer file). Uses `updateDelayProfile()` only (no create/delete).
- `/packages/praxrr-app/src/lib/server/sync/delayProfiles/handler.ts`: Section handler with `arrSyncQueries.getDelayProfilesSync()` for config check.

### Media Management Section

- `/packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts`: `MediaManagementSyncer` -- handles three sub-sections: media settings, naming, and quality definitions. Each follows GET-existing -> fetch-from-PCD -> merge-fields -> PUT-back pattern. Lidarr has field compatibility handling with `applyConfigUpdates()`.
- `/packages/praxrr-app/src/lib/server/sync/mediaManagement/handler.ts`: Section handler checking across all three sub-sections for `hasConfig`.

### Metadata Profiles Section (Lidarr-only)

- `/packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts`: `MetadataProfileSyncer` -- syncs a single metadata profile to Lidarr. Uses namespace suffix, schema normalization, create/update based on name match.
- `/packages/praxrr-app/src/lib/server/sync/metadataProfiles/handler.ts`: Section handler with Lidarr-specific sync queries.

### Arr Client Abstraction

- `/packages/praxrr-app/src/lib/server/utils/arr/base.ts`: `BaseArrClient` extends `BaseHttpClient`. Provides all Arr API methods: `getCustomFormats()`, `getQualityProfiles()`, `getDelayProfiles()`, `getQualityDefinitions()`, `getMediaManagementConfig()`, `getNamingConfig()`, and their create/update/delete counterparts.
- `/packages/praxrr-app/src/lib/server/utils/arr/factory.ts`: `createArrClient(type, url, apiKey)` factory. Maps `ArrType` to `RadarrClient`, `SonarrClient`, `LidarrClient`, `ChaptarrClient`.
- `/packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`: `getArrInstanceClient()` -- decrypts API key, caches client instances per `(instanceId, keyVersion)`. `ArrInstanceClientCache` is per-operation (created fresh for each sync batch).
- `/packages/praxrr-app/src/lib/server/utils/arr/clients/lidarr.ts`: `LidarrClient` extends `BaseArrClient` with `apiVersion = 'v1'` and Lidarr-specific endpoints (`getMetadataProfiles`, `getMetadataProfileSchema`).
- `/packages/praxrr-app/src/lib/server/utils/arr/types.ts`: All Arr API type definitions -- `ArrCustomFormat`, `ArrQualityProfilePayload`, `RadarrQualityProfile`, `ArrDelayProfile`, `ArrMediaManagementConfig`, `ArrNamingConfig`, `ArrQualityDefinition`, etc.

### PCD Cache System

- `/packages/praxrr-app/src/lib/server/pcd/index.ts`: Public API -- exports `pcdManager`, `getCache()`, `getCachedDatabaseIds()`, `PCDCache`.
- `/packages/praxrr-app/src/lib/server/pcd/database/cache.ts`: `PCDCache` class wrapping an in-memory SQLite database (Kysely `<PCDDatabase>`). `cache.kb` provides the typed query builder. All PCD fetch functions (in transformers) use `cache.kb` Kysely queries.
- `/packages/praxrr-app/src/lib/server/pcd/database/registry.ts`: `getCache(databaseId)` retrieves compiled cache by database ID.

### Job System

- `/packages/praxrr-app/src/lib/server/jobs/dispatcher.ts`: `JobDispatcher` -- timer-based job executor polling `jobQueueQueries.claimNextDue()`.
- `/packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`: Unified `arrSyncHandler` registered for `arr.sync`, `arr.sync.qualityProfiles`, etc. Creates Arr client, iterates sections, claims/syncs/completes.
- `/packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`: `JobType` union includes all sync types. `JobHandler` signature: `(job: JobQueueRecord) => Promise<JobHandlerResult>`.
- `/packages/praxrr-app/src/lib/server/jobs/queueService.ts`: `enqueueJob()` and `upsertScheduledJob()` for queue insertion.

### Database Queries

- `/packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`: Central sync configuration queries -- `getQualityProfilesSync()`, `getDelayProfilesSync()`, `getMediaManagementSync()`, `getMetadataProfilesSync()`, `getFullSyncData()`, `getSyncConfigStatus()`. Status lifecycle: `setStatusPending()`, `claim*Sync()`, `complete*Sync()`, `fail*Sync()`.
- `/packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: Instance CRUD.
- `/packages/praxrr-app/src/lib/server/db/queries/arrNamespaces.ts`: Namespace index management per `(instanceId, databaseId)`.

### Routes

- `/packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts`: Sync configuration UI -- loads databases with profiles, sync data. Actions: `saveQualityProfiles`, `syncQualityProfiles`, `saveDelayProfiles`, `syncDelayProfiles`, `saveMediaManagement`, `syncMediaManagement`, `saveMetadataProfiles`, `syncMetadataProfiles`.
- `/packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte`: Sync config page UI.
- `/packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncFooter.svelte`: Footer with trigger toggles, Save, and Sync Now buttons.
- `/packages/praxrr-app/src/routes/api/v1/arr/cleanup/+server.ts`: Cleanup API -- scan/execute pattern. Direct architectural precedent for preview API.

## Data Flow

### Current Sync Pipeline (Quality Profiles -- Most Complex)

```
1. TRIGGER (manual button | event | schedule)
   -> enqueueJob('arr.sync.qualityProfiles', { instanceId })
   -> JobDispatcher picks up job

2. JOB HANDLER (handlers/arrSync.ts)
   -> getArrInstanceClient(type, id, url)       [decrypt API key, create client]
   -> getSection('qualityProfiles')              [from registry]
   -> handler.claimSync(instanceId)              [atomic status transition]
   -> handler.createSyncer(client, instance)     [QualityProfileSyncer]
   -> syncer.sync()

3. QUALITY PROFILE SYNCER (qualityProfiles/syncer.ts)
   a. FETCH PHASE
      -> arrSyncQueries.getQualityProfilesSync(instanceId)    [get selections]
      -> Group selections by databaseId
      -> For each database:
         -> arrNamespaceQueries.getOrCreate(instanceId, dbId)  [namespace suffix]
         -> getCache(databaseId)                                [PCD cache]
         -> fetchQualityProfileFromPcd(cache, profileName)     [PCD query]
         -> getReferencedCustomFormatNames(cache, profileName) [CF dependencies]
         -> fetchCustomFormatFromPcd(cache, cfName)            [CF data]
      -> Result: DatabaseSyncBatch[] (profiles + CFs + suffix per database)

   b. TRANSFORM + PUSH (Custom Formats)
      -> For each batch:
         -> syncCustomFormats(client, instanceId, type, pcdFormats, suffix)
            -> client.getCustomFormats()                       [GET remote CFs]
            -> transformCustomFormatWithDiagnostics(pcdFormat)  [PCD -> Arr format]
            -> Apply namespace suffix to name
            -> Match by suffixed name:
               -> existingMap.has(name) ? client.updateCustomFormat() : client.createCustomFormat()
         -> Returns pcdFormatIdMap (PCD name -> Arr ID)

   c. TRANSFORM + PUSH (Quality Profiles)
      -> client.getCustomFormats()                              [refresh all CFs]
      -> getQualityApiMappings(cache, arrType)                  [quality name -> API name]
      -> client.getQualityProfiles()                            [GET remote QPs]
      -> For each profile:
         -> transformQualityProfile(pcdProfile, arrType, qualityMappings, pcdFormatIdMap, allFormatIdMap)
         -> Apply namespace suffix to name
         -> Match by suffixed name:
            -> existingMap.has(name) ? client.updateQualityProfile() : client.createQualityProfile()

4. COMPLETION
   -> handler.completeSync(instanceId)  or  handler.failSync(instanceId, error)
```

### Delay Profile Flow (Simpler)

```
1. Fetch sync config (databaseId, profileName)
2. Get PCD profile from cache
3. Resolve target profile (id=1 for Radarr/Sonarr, lowest-order untagged for Lidarr)
4. Transform PCD -> Arr delay profile format (inline)
5. client.updateDelayProfile(profileId, payload)  [always update, never create/delete]
```

### Media Management Flow (Three Sub-sections)

```
For each configured sub-section (mediaSettings, naming, qualityDefinitions):
1. GET existing config from Arr
2. Fetch PCD config by name + arr type
3. Merge PCD fields into existing config (preserving unmanaged fields)
4. PUT full config back to Arr
```

### Cleanup Scan/Execute Flow (Architectural Precedent)

```
SCAN PHASE:
1. Build expected CF/QP names from sync selections + namespace suffixes
2. Fetch all remote CFs/QPs from Arr
3. Anything not in expected set -> stale
4. Return CleanupScanResult { staleCustomFormats[], staleQualityProfiles[] }

EXECUTE PHASE:
1. Receive CleanupScanResult from client
2. Delete CFs first, then QPs
3. Handle HTTP 500 for in-use QPs (skip with warning)
```

## Integration Points

### Primary: New Preview API Endpoint

**Location**: `/packages/praxrr-app/src/routes/api/v1/arr/sync/preview/+server.ts` (new)

This follows the cleanup API pattern at `/api/v1/arr/cleanup/+server.ts`. The cleanup API is the closest existing precedent: it takes an `instanceId`, creates an Arr client, performs read-only operations (scan), and returns structured results. Preview should follow the same pattern but with richer diff output.

### Core Preview Logic Module

**Location**: `/packages/praxrr-app/src/lib/server/sync/preview/` (new directory)

The preview module needs to:

1. **Reuse existing fetch/transform code** -- `fetchSyncBatchByDatabase()` pattern from `QualityProfileSyncer`, `syncCustomFormats()` transform-only path, `transformQualityProfile()`, delay profile `transform()`, media management field merging, metadata profile `buildPayload()`.
2. **Fetch remote state** via existing `BaseArrClient` GET methods (read-only).
3. **Diff desired vs. remote** to produce create/update/delete actions with field-level changes.

### Key Functions to Extract or Reuse

The following functions contain the fetch+transform logic that preview needs, but they are currently tightly coupled to the push phase:

| Function/Method                                              | File                                 | What Preview Needs                                      | Current Coupling Issue                  |
| ------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------------- | --------------------------------------- |
| `QualityProfileSyncer.fetchSyncBatchByDatabase()`            | `qualityProfiles/syncer.ts:164`      | PCD data grouped by database with namespace suffixes    | Private method on class instance        |
| `syncCustomFormats()`                                        | `customFormats/syncer.ts:24`         | Transform-only path (needs existing CFs for ID mapping) | Performs create/update as side effect   |
| `transformQualityProfile()`                                  | `qualityProfiles/transformer.ts:74`  | Pure function, directly reusable                        | None -- already extracted               |
| `transformCustomFormatWithDiagnostics()`                     | `customFormats/transformer.ts:287`   | Pure function, directly reusable                        | None -- already extracted               |
| `fetchQualityProfileFromPcd()`                               | `qualityProfiles/transformer.ts:228` | Pure function, directly reusable                        | None -- already extracted               |
| `fetchCustomFormatFromPcd()`                                 | `customFormats/transformer.ts:336`   | Pure function, directly reusable                        | None -- already extracted               |
| `getReferencedCustomFormatNames()`                           | `qualityProfiles/transformer.ts:392` | Pure function, directly reusable                        | None -- already extracted               |
| `getQualityApiMappings()`                                    | `qualityProfiles/transformer.ts:375` | Pure function, directly reusable                        | None -- already extracted               |
| `DelayProfileSyncer.transform()`                             | `delayProfiles/syncer.ts:108`        | Private method, inline transform                        | Private method on class instance        |
| `MediaManagementSyncer.sync*()` methods                      | `mediaManagement/syncer.ts`          | GET + PCD fetch + merge logic                           | Private methods, tightly bound to class |
| `MetadataProfileSyncer` `buildPayload()` + schema resolution | `metadataProfiles/syncer.ts:147-161` | Module-level function, reusable                         | Schema fetch requires LidarrClient cast |

### Strategy: Selective Extraction

Rather than refactoring existing syncers (which are working and tested), the preview module should:

1. Import and reuse all exported transformer/PCD-query functions directly (they are already cleanly separated).
2. Duplicate the fetch-and-group orchestration logic (from `fetchSyncBatchByDatabase`) in a preview-specific context, since it is private and tightly coupled.
3. The delay profile `transform()` logic is simple enough to duplicate or extract to a shared utility.
4. For media management, the GET-merge pattern is specific enough that preview should call the same Arr GET endpoints and PCD queries, then diff the merged result against the fetched remote state.

### UI Integration

**Location**: `/packages/praxrr-app/src/routes/arr/[id]/sync/` (modify existing)

The SyncFooter component (`SyncFooter.svelte`) currently has "Sync Now" and "Save" buttons. Preview would add a "Preview" button that calls the new API endpoint and displays results in an inline diff view before allowing "Apply" (which triggers the existing sync flow).

### Cleanup Integration

The cleanup module (`cleanup.ts`) already identifies stale items (items that exist remotely but are not in the expected set). Preview should incorporate this information as "delete" actions in the preview output. The `scanForStaleItems()` function is directly reusable.

## Key Dependencies

### Internal Dependencies

- **PCD Cache** (`$pcd/index.ts`): `getCache(databaseId)` provides `PCDCache` with Kysely `<PCDDatabase>` query builder. All PCD data fetching flows through this.
- **Arr Sync Queries** (`$db/queries/arrSync.ts`): `getQualityProfilesSync()`, `getDelayProfilesSync()`, `getMediaManagementSync()`, `getMetadataProfilesSync()` provide sync configuration (selections, database IDs, profile names).
- **Arr Namespace Queries** (`$db/queries/arrNamespaces.ts`): `getOrCreate(instanceId, databaseId)` returns namespace index for suffix generation.
- **Arr Instance Queries** (`$db/queries/arrInstances.ts`): `getById(instanceId)` for instance metadata (type, url, name).
- **Arr Instance Clients** (`$arr/arrInstanceClients.ts`): `getArrInstanceClient()` for authenticated Arr API access.
- **Section Registry** (`sync/registry.ts`): `getSection(type).hasConfig(instanceId)` to check which sections have configuration.
- **Mappings** (`sync/mappings.ts`): `isSyncSectionSupported(arrType, section)` for per-Arr section support checking.

### External Libraries

- **Kysely**: Type-safe SQL query builder used by PCD cache system.
- **croner** (`Cron`): Cron expression parsing (used by `calculateNextRun`; not directly relevant to preview).
- **microdiff** (proposed in feature-spec.md): Lightweight deep diff library for JSON comparison (<1kb, zero deps). Will be used to diff transformed payloads against remote state.

### Arr API Endpoints Used (Read-Only for Preview)

| Endpoint                             | Client Method                             | Used By                                          |
| ------------------------------------ | ----------------------------------------- | ------------------------------------------------ |
| `GET /api/v3/customformat`           | `client.getCustomFormats()`               | QP syncer (CF sync + full refresh), cleanup scan |
| `GET /api/v3/qualityprofile`         | `client.getQualityProfiles()`             | QP syncer (existing map), cleanup scan           |
| `GET /api/v3/delayprofile`           | `client.getDelayProfiles()`               | Delay syncer (Lidarr target resolution)          |
| `GET /api/v3/config/mediamanagement` | `client.getMediaManagementConfig()`       | MM syncer (existing config for merge)            |
| `GET /api/v3/config/naming`          | `client.getNamingConfig()`                | MM syncer (existing config for merge)            |
| `GET /api/v3/qualitydefinition`      | `client.getQualityDefinitions()`          | MM syncer (existing definitions for merge)       |
| `GET /api/v1/metadataprofile`        | `lidarrClient.getMetadataProfiles()`      | Metadata syncer (existing profiles)              |
| `GET /api/v1/metadataprofile/schema` | `lidarrClient.getMetadataProfileSchema()` | Metadata syncer (schema normalization)           |

## Architectural Patterns

- **Section Registry Pattern**: All sync sections implement `SectionHandler` and self-register on import. The registry provides `hasConfig(instanceId)` which preview can use to determine which sections to include. Registered types: `qualityProfiles`, `delayProfiles`, `mediaManagement`, `metadataProfiles`.
- **Handler/Syncer/Transformer Separation**: Each section has up to three layers -- handler (status lifecycle + factory), syncer (orchestration), transformer (pure data conversion). Transformers are the most reusable for preview since they are pure functions. Syncers mix fetch+transform+push.
- **Namespace Suffix Isolation**: Multi-database support uses zero-width Unicode suffixes (`\u200B`, `\u200C`, etc.) appended to entity names. Preview must apply the same suffixing to correctly match remote names. Use `getNamespaceSuffix(index)` and `arrNamespaceQueries.getOrCreate()`.
- **Scan/Execute Two-Phase Pattern**: The cleanup module (`cleanup.ts`) and API (`/api/v1/arr/cleanup`) demonstrate a scan-then-act pattern. Preview naturally follows this: scan (preview) -> optional execute (sync). The cleanup API's `POST { instanceId, action: 'scan' | 'execute' }` structure is a direct template.
- **Batch-by-Database Grouping**: QP syncer groups selections by database, assigns namespace suffixes, then processes each batch. Preview must replicate this grouping to produce correct suffixed names.
- **Override-Not-Template**: Every concrete syncer overrides the base `sync()` method entirely rather than using the `fetchFromPcd()` -> `transformToArr()` -> `pushToArr()` template methods (which are all no-ops). The base class serves mainly as a property holder.
- **Per-Section Job Types**: Each section has its own job type (`arr.sync.qualityProfiles`, etc.) dispatched through the unified `arrSyncHandler`. Preview does not need the job system -- it should be synchronous request-response.

## Gotchas and Edge Cases

- **Base class template methods are dead code**: `BaseSyncer.fetchFromPcd()`, `transformToArr()`, and `pushToArr()` are abstract methods that all concrete syncers implement as no-ops because they override `sync()` directly. Preview should not attempt to use this template pattern.
- **Custom formats must sync before quality profiles**: QP sync depends on CF IDs. `syncCustomFormats()` returns a `pcdFormatIdMap` that `transformQualityProfile()` uses. Preview must replicate this ordering: first determine what CF creates/updates would yield (including simulated IDs for new CFs), then use those to transform QPs.
- **`allFormatIdMap` includes all databases' CFs**: After CF sync, the QP syncer re-fetches ALL CFs from Arr to build `allFormatIdMap`. For preview, this means remote CFs plus any CFs that would be created need to be in the map. New CFs will not have real Arr IDs yet, so preview may need synthetic IDs or can omit zero-score format items from the diff.
- **Delay profile sync is always update, never create**: The delay syncer only calls `updateDelayProfile()`. For preview, there is no "create" action for delay profiles -- it is always a diff against the existing default profile.
- **Media management sync preserves unmanaged fields**: The syncer GETs the full config, merges only managed fields, then PUTs the full object back. Preview diff should only show changes to managed fields, not the unchanged pass-through fields.
- **Lidarr metadata profile schema fetch can fail**: The syncer has a fallback schema (`METADATA_PROFILE_SCHEMA_FALLBACK`). Preview should handle this the same way.
- **Lidarr custom format condition filtering**: `LIDARR_SUPPORTED_CONDITION_TYPES` limits which conditions transform for Lidarr. CFs with all conditions filtered out are skipped entirely. Preview must replicate this behavior.
- **Namespace suffix detection for cleanup/stale items**: `hasNamespaceSuffix()` and `stripNamespaceSuffix()` are used to identify Praxrr-managed entities. Only suffixed entities are considered for cleanup actions in the preview.
- **`arrSyncQueries.getQualityProfilesSync()` returns selections with `databaseId` and `profileName`**: The selections reference may include stale references to deleted databases. The syncer already handles this (skips with warning). Preview should do the same.
- **Arr type-specific section support**: `isSyncSectionSupported(arrType, section)` gates which sections can sync. `metadataProfiles` is Lidarr-only. Preview must respect this.
- **Client caching is per-operation**: `createArrInstanceClientCache()` creates a fresh `Map` for each sync batch. Preview should create its own cache for the preview request lifecycle.
- **HTTP errors during Arr API calls**: The cleanup API disables retries (`{ retries: 0 }`) for fast failure. Preview should consider the same approach since it is a user-facing synchronous request.

## Other Docs

- `/docs/plans/sync-preview-dry-run/feature-spec.md`: Full feature specification including Phase 1 scope (QP+CF only), API contract, UI mockups, diff engine design.
- `/docs/plans/sync-preview-dry-run/research-technical.md`: Technical research on diff libraries, Terraform plan format, ArgoCD patterns.
- `/docs/plans/sync-preview-dry-run/research-ux.md`: UX research on preview presentation, inline diffs, action counts.
- `/docs/plans/sync-preview-dry-run/research-external.md`: External API documentation and Arr API behavior research.
- `/docs/plans/sync-preview-dry-run/research-business.md`: Business case and user persona research.
- `/docs/plans/sync-preview-dry-run/research-recommendations.md`: Cross-research synthesis and implementation recommendations.
- `/packages/praxrr-app/src/lib/server/utils/arr/README.md`: Arr client architecture notes.
