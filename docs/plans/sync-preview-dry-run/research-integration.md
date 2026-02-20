# Integration Research: sync-preview-dry-run

This document maps the concrete API endpoints, database tables, PCD cache access patterns, and Arr client methods relevant to implementing the sync preview/dry-run feature. The goal is to inform endpoint design, query reuse, and client interaction without duplicating the broader feature spec.

## API Endpoints

### Existing Related Endpoints

| Method | Path | Purpose | File |
|--------|------|---------|------|
| POST | `/api/v1/arr/cleanup` | Scan or execute cleanup of stale configs | `routes/api/v1/arr/cleanup/+server.ts` |
| GET | `/api/v1/arr/library` | Fetch Arr library with profiles and scores | `routes/api/v1/arr/library/+server.ts` |
| DELETE | `/api/v1/arr/library` | Invalidate library cache | `routes/api/v1/arr/library/+server.ts` |
| GET | `/api/v1/arr/library/episodes` | Sonarr episode-level data | `routes/api/v1/arr/library/episodes/+server.ts` |
| GET | `/api/v1/arr/releases` | Interactive search releases | `routes/api/v1/arr/releases/+server.ts` |
| GET | `/api/v1/openapi.json` | Serve parsed OpenAPI YAML as JSON | `routes/api/v1/openapi.json/+server.ts` |
| GET | `/api/v1/health` | Health check | `routes/api/v1/health/` |
| POST | `/api/v1/entity-testing/evaluate` | CF/release parsing evaluation | `routes/api/v1/entity-testing/` |
| Various | `/api/v1/pcd/*` | PCD export/import and entity CRUD | `routes/api/v1/pcd/` |

### Cleanup Scan/Execute Pattern (Strongest Precedent)

The cleanup endpoint at `/api/v1/arr/cleanup` is the closest architectural precedent for preview/apply. It uses a two-phase pattern within a single POST:

1. **Scan phase** (`action: 'scan'`): Fetches remote state from Arr (GETs only), reads sync config from DB, reads PCD cache, computes what is stale. Returns a `CleanupScanResult` with `staleCustomFormats[]` and `staleQualityProfiles[]`.
2. **Execute phase** (`action: 'execute'`): Receives the scan result back from the client and performs deletions. The client passes `scanResult` to the execute call.

Key patterns to replicate:
- Instance lookup via `arrInstancesQueries.getById(instanceId)`
- Client creation via `getArrInstanceClient(instance.type as ArrType, instance.id, instance.url, { retries: 0 })`
- Client cleanup in `finally` block: `client.close()`
- Error handling: catch, extract message, return `json({ error: message }, { status: 500 })`
- File: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/api/v1/arr/cleanup/+server.ts`

### Route Organization in SvelteKit

API routes live under `packages/praxrr-app/src/routes/api/v1/`. Each directory contains a `+server.ts` with exported HTTP method handlers (`GET`, `POST`, `DELETE`, etc.). Dynamic route segments use `[paramName]` directories. The new preview routes should follow this structure:

```
routes/api/v1/sync/preview/+server.ts          -> POST (create preview)
routes/api/v1/sync/preview/[previewId]/+server.ts  -> GET, DELETE
routes/api/v1/sync/preview/[previewId]/apply/+server.ts -> POST
```

Common patterns across all existing endpoints:
- Import `json` from `@sveltejs/kit`
- Import `type { RequestHandler }` from `@sveltejs/kit`
- Validate required params early, return 400 on failure
- Look up instance, return 404 if missing
- Wrap in try/catch, return 500 with error message
- Use `satisfies` for type-checked response shapes against OpenAPI types

### OpenAPI Spec Structure

The OpenAPI spec is at `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/openapi.yaml` (version 3.1.0). It uses `$ref` to external files:
- Paths in `docs/api/v1/paths/*.yaml`
- Schemas in `docs/api/v1/schemas/*.yaml` or inline under `components/schemas`
- Served at runtime via `GET /api/v1/openapi.json` which reads the YAML and parses it
- Types generated via `deno task generate:api-types` -> `packages/praxrr-app/src/lib/api/v1.d.ts`

New preview endpoints need:
1. Path definitions in `docs/api/v1/paths/sync.yaml` (new file)
2. Schema definitions in `docs/api/v1/schemas/sync.yaml` (new file)
3. References added to `docs/api/v1/openapi.yaml` under `paths:`
4. Regenerated types after spec changes

## Database

### Relevant Tables

#### `arr_instances`
- **Purpose**: Stores Arr instance connections (Radarr, Sonarr, Lidarr)
- **Key columns**: `id`, `name`, `type` (radarr/sonarr/lidarr/chaptarr), `url`, `enabled`, `source` (ui/env)
- **Queries file**: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`
- **Key methods**: `getById(id)`, `getAll()`, `getEnabled()`, `getByType(type)`

#### `arr_sync_quality_profiles`
- **Purpose**: Many-to-many selections of which quality profiles to sync per instance
- **Key columns**: `instance_id`, `database_id`, `profile_name`
- **Primary key**: `(instance_id, database_id, profile_name)`
- **Created by**: Migration 046 (profile_name based, replaced profile_id)

#### `arr_sync_quality_profiles_config`
- **Purpose**: Per-instance trigger config and sync status for quality profiles
- **Key columns**: `instance_id` (PK), `trigger`, `cron`, `should_sync`, `next_run_at`, `sync_status`, `last_error`, `last_synced_at`
- **Sync status values**: `idle`, `pending`, `in_progress`, `failed`

#### `arr_sync_delay_profiles_config`
- **Purpose**: Single delay profile selection and trigger config per instance
- **Key columns**: `instance_id` (PK), `database_id`, `profile_name`, `trigger`, `cron`, `should_sync`, `next_run_at`, `sync_status`, `last_error`, `last_synced_at`

#### `arr_sync_media_management`
- **Purpose**: Media management sync config with three sub-sections per instance
- **Key columns**: `instance_id` (PK), `naming_database_id`, `naming_config_name`, `quality_definitions_database_id`, `quality_definitions_config_name`, `media_settings_database_id`, `media_settings_config_name`, `trigger`, `cron`, `should_sync`, `next_run_at`, `sync_status`, `last_error`, `last_synced_at`

#### `arr_sync_metadata_profiles_config`
- **Purpose**: Lidarr-only metadata profile sync config per instance
- **Key columns**: `instance_id` (PK), `database_id`, `profile_name`, `trigger`, `cron`, `should_sync`, `next_run_at`, `sync_status`, `last_error`, `last_synced_at`
- **Scoping**: All queries join against `arr_instances` to enforce `type = 'lidarr'`

#### `arr_database_namespaces`
- **Purpose**: Assigns unique namespace index per (Arr instance, database) pair for zero-width suffix generation
- **Key columns**: `instance_id`, `database_id`, `namespace_index`
- **Primary key**: `(instance_id, database_id)`
- **Unique constraint**: `(instance_id, namespace_index)`
- **Queries file**: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/arrNamespaces.ts`
- **Key methods**: `getOrCreate(instanceId, databaseId)`, `get(instanceId, databaseId)`, `getForInstance(instanceId)`

#### `database_instances`
- **Purpose**: Registered PCD database connections
- **Queries file**: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/databaseInstances.ts`
- **Key methods**: `getById(id)` (used to validate database still exists before sync)

### Key Queries in arrSync.ts

File: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`

**Read queries essential for preview**:

| Method | Returns | Purpose |
|--------|---------|---------|
| `getQualityProfilesSync(instanceId)` | `QualityProfilesSyncData` | Selections (databaseId + profileName pairs) and trigger config |
| `getDelayProfilesSync(instanceId)` | `DelayProfilesSyncData` | Single profile selection (databaseId, profileName) and trigger |
| `getMediaManagementSync(instanceId)` | `MediaManagementSyncData` | Three sub-section configs (naming, qualityDefs, mediaSettings) each with databaseId + configName |
| `getMetadataProfilesSync(instanceId)` | `MetadataProfilesSyncData` | Single profile selection (databaseId, profileName) and trigger |
| `getFullSyncData(instanceId)` | All four above combined | Calls all four getters |
| `getSyncConfigStatus(instanceId)` | Per-section trigger/cron/status | For checking sync_status before preview |

**Key types**:
- `ProfileSelection`: `{ databaseId: number; profileName: string }`
- `SyncConfig`: `{ trigger: SyncTrigger; cron: string | null; nextRunAt?: string | null }`
- `SyncTrigger`: `'manual' | 'on_pull' | 'on_change' | 'schedule'`

**Important**: Preview should NOT call any write queries (`save*`, `set*ShouldSync`, `set*StatusPending`, `claim*Sync`, `complete*Sync`, `fail*Sync`). Preview is strictly read-only against the app database.

## PCD Cache

### How PCD Cache Works

The PCD cache is an in-memory SQLite database per linked PCD database. It is built by replaying all PCD operations (schema, base, tweaks, user layers) into a fresh `:memory:` SQLite database.

**Architecture**:
- `PCDCache` class: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/database/cache.ts`
- Cache registry (global Map): `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/database/registry.ts`
- Public API: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/index.ts`

**Access pattern**:
```typescript
import { getCache, getCachedDatabaseIds } from '$pcd/index.ts';
const cache = getCache(databaseId); // returns PCDCache | undefined
```

**PCDCache query methods**:
- `cache.query<T>(sql, ...params): T[]` - Raw SQL, returns all rows
- `cache.queryOne<T>(sql, ...params): T | undefined` - Raw SQL, returns first row
- `cache.kb: Kysely<PCDDatabase>` - Kysely type-safe query builder
- `cache.isBuilt(): boolean` - Check if cache is ready
- `cache.validateSql(statements): ValidationResult` - Dry-run SQL validation

### How Syncers Access PCD Data

Each syncer follows this pattern:

1. Read sync config from app DB (e.g., `arrSyncQueries.getQualityProfilesSync(instanceId)`)
2. Extract `databaseId` from selections
3. Get PCD cache: `const cache = getCache(databaseId)`
4. If cache is missing, log warning and skip (not a hard failure)
5. Query entities from cache using entity-specific read functions

**Entity read functions used by syncers**:

| Section | Import | Function | Source File |
|---------|--------|----------|-------------|
| Quality Profiles | `$sync/qualityProfiles/transformer.ts` | `fetchQualityProfileFromPcd(cache, name, arrType)` | transformer.ts |
| Quality Profiles | `$sync/qualityProfiles/transformer.ts` | `getReferencedCustomFormatNames(cache, name, arrType)` | transformer.ts |
| Quality Profiles | `$sync/qualityProfiles/transformer.ts` | `getQualityApiMappings(cache, arrType)` | transformer.ts |
| Custom Formats | `$sync/customFormats/index.ts` | `fetchCustomFormatFromPcd(cache, formatName)` | customFormats/index.ts |
| Delay Profiles | `$pcd/entities/delayProfiles/index.ts` | `getByName(cache, profileName)` | PCD entities |
| Media Mgmt - Settings | `$pcd/entities/mediaManagement/media-settings/read.ts` | `getRadarrByName`, `getSonarrByName`, `getLidarrByName` | PCD entities |
| Media Mgmt - Naming | `$pcd/entities/mediaManagement/naming/read.ts` | `getRadarrByName`, `getSonarrByName`, `getLidarrByName` | PCD entities |
| Media Mgmt - QualDefs | `$pcd/entities/mediaManagement/quality-definitions/read.ts` | `getRadarrByName`, `getSonarrByName`, `getLidarrByName` | PCD entities |
| Metadata Profiles | Cache Kysely query in syncer | `cache.kb.selectFrom('lidarr_metadata_profiles')...` | metadataProfiles/syncer.ts |

### Data Available from PCD Cache

The PCD cache contains the full compiled state of a PCD database. Key tables queried during sync:

- `quality_profiles` - Profile definitions with qualities, cutoff, scores
- `quality_profile_custom_formats` - CF score assignments per profile
- `quality_profile_qualities` / `quality_profile_quality_groups` - Quality ordering
- `custom_formats` - Format definitions
- `custom_format_conditions` - CF condition specifications
- `delay_profiles` - Delay profile settings
- `radarr_naming` / `sonarr_naming` / `lidarr_naming` - Naming format configs
- `radarr_media_settings` / `sonarr_media_settings` / `lidarr_media_settings` - Media management settings
- `radarr_quality_definitions` / `sonarr_quality_definitions` / `lidarr_quality_definitions` - Quality size limits
- `quality_api_mappings` - Maps quality names to API names per arr_type
- `lidarr_metadata_profiles` + related type/status tables - Lidarr-only

## Arr Client

### BaseArrClient GET Methods

File: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/base.ts`

These are the read-only methods preview needs to fetch current remote state:

| Method | Returns | Endpoint | Preview Use Case |
|--------|---------|----------|------------------|
| `getCustomFormats()` | `ArrCustomFormat[]` | `/api/v3/customformat` | Compare against desired CFs |
| `getQualityProfiles()` | `RadarrQualityProfile[]` | `/api/v3/qualityprofile` | Compare against desired QPs |
| `getQualityDefinitions()` | `ArrQualityDefinition[]` | `/api/v3/qualitydefinition` | Compare against desired quality defs |
| `getDelayProfiles()` | `ArrDelayProfile[]` | `/api/v3/delayprofile` | Compare against desired delay profile |
| `getMediaManagementConfig()` | `ArrMediaManagementConfig` | `/api/v3/config/mediamanagement` | Compare media settings fields |
| `getNamingConfig()` | `ArrNamingConfig` | `/api/v3/config/naming` | Compare naming fields |
| `getTags()` | `ArrTag[]` | `/api/v3/tag` | Tag resolution (delay profiles) |
| `testConnection()` | `boolean` | `/api/v3/system/status` | Pre-flight connectivity check |

### LidarrClient Additional GET Methods

File: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/clients/lidarr.ts`

| Method | Returns | Endpoint | Preview Use Case |
|--------|---------|----------|------------------|
| `getMetadataProfiles()` | `LidarrMetadataProfileListResponse` | `/api/v1/metadataprofile` | Compare metadata profiles |
| `getMetadataProfileSchema()` | `LidarrMetadataProfileSchema` | `/api/v1/metadataprofile/schema` | Normalize metadata profile types |

Note: Lidarr overrides `apiVersion = 'v1'`, so all inherited base methods use `/api/v1/` automatically.

### Client Creation and Caching

File: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`

**Creation**:
```typescript
import { getArrInstanceClient, createArrInstanceClientCache } from '$arr/arrInstanceClients.ts';

// For single-instance operations (like cleanup and preview):
const client = await getArrInstanceClient(instance.type as ArrType, instance.id, instance.url, { retries: 0 });

// For multi-instance batch operations (like sync processor):
const clientCache = createArrInstanceClientCache();
const client = await getArrInstanceClient(type, id, url, undefined, clientCache);
```

**Key behaviors**:
- Decrypts API key from `arr_instance_credentials` table via `decryptArrInstanceApiKey()`
- Supports optional `ArrInstanceClientCache` (Map) for reuse across calls
- Invalidates cache entry on key version mismatch
- Factory function `createArrClient(type, url, apiKey, options)` in `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/factory.ts` dispatches to `RadarrClient`, `SonarrClient`, `LidarrClient`, or `ChaptarrClient`

**Client options**:
```typescript
interface ArrClientOptions {
  timeout?: number;
  retries?: number; // Cleanup uses { retries: 0 } for fail-fast
}
```

### Key Arr API Response Types

File: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/types.ts`

| Type | Description | Fields for Diffing |
|------|-------------|-------------------|
| `ArrCustomFormat` | CF with specs | `id`, `name`, `includeCustomFormatWhenRenaming`, `specifications[]` |
| `RadarrQualityProfile` | QP from arr | `id`, `name`, `upgradeAllowed`, `cutoff`, `cutoffFormatScore`, `minFormatScore`, `formatItems[]`, `items[]` |
| `QualityProfileFormatItem` | CF score in QP | `format` (id), `name`, `score` |
| `ArrDelayProfile` | Delay profile | `id`, `enableUsenet`, `enableTorrent`, `preferredProtocol`, `usenetDelay`, `torrentDelay`, `bypassIfHighestQuality`, `bypassIfAboveCustomFormatScore`, `minimumCustomFormatScore`, `order`, `tags[]` |
| `ArrMediaManagementConfig` | Media settings | `id`, `downloadPropersAndRepacks`, `enableMediaInfo`, plus many preserved fields |
| `ArrNamingConfig` | Union type | Radarr: `renameMovies`, `colonReplacementFormat`, `standardMovieFormat`, `movieFolderFormat`; Sonarr: `renameEpisodes`, `colonReplacementFormat` (int), `multiEpisodeStyle` (int), episode/season formats; Lidarr: `renameTracks`, `standardTrackFormat`, `multiDiscTrackFormat`, `artistFolderFormat` |
| `ArrQualityDefinition` | Quality sizes | `id`, `quality.id`, `quality.name`, `title`, `weight`, `minSize`, `maxSize`, `preferredSize` |
| `LidarrMetadataProfile` | Metadata profile | `id`, `name`, `primaryAlbumTypes[]`, `secondaryAlbumTypes[]`, `releaseStatuses[]` |

## Sync Pipeline Architecture

### Section Registry

File: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/sync/registry.ts`

All sync sections register via `registerSection(handler)`. Handlers implement `SectionHandler` interface:

```typescript
interface SectionHandler {
  readonly type: SectionType;
  setShouldSync(instanceId, value): void;
  setNextRunAt(instanceId, nextRunAt): void;
  claimSync(instanceId): boolean;
  completeSync(instanceId): void;
  failSync(instanceId, error): void;
  setStatusPending(instanceId): void;
  getPendingInstanceIds(): number[];
  getScheduledConfigs(): ScheduledConfig[];
  createSyncer(client, instance): BaseSyncer;
  hasConfig(instanceId): boolean;
}
```

Registered handlers: `qualityProfiles`, `delayProfiles`, `mediaManagement`, `metadataProfiles`

For preview, `hasConfig(instanceId)` is useful to determine which sections have configuration and should be previewed. `createSyncer()` is how the processor creates syncer instances.

### Supported Sections per Arr Type

File: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/sync/mappings.ts`

| Arr Type | Supported Sections |
|----------|--------------------|
| radarr | qualityProfiles, delayProfiles, mediaManagement |
| sonarr | qualityProfiles, delayProfiles, mediaManagement |
| lidarr | qualityProfiles, delayProfiles, mediaManagement, metadataProfiles |

Use `isSyncSectionSupported(arrType, section)` to validate.

### Namespace Suffix System

File: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/sync/namespace.ts`

- `getNamespaceSuffix(index)`: Returns zero-width Unicode character for index 1-5, repeating U+200B for overflow
- `stripNamespaceSuffix(name)`: Removes trailing namespace chars (for display)
- `hasNamespaceSuffix(name)`: Checks if name has namespace chars
- `getNamespaceIndex(name)`: Extracts index from suffixed name

Preview must strip suffixes for display names but use suffixed names for matching against remote state.

### Syncer Override Pattern

All four syncers override `sync()` entirely. They do NOT use the base class `fetchFromPcd()` / `transformToArr()` / `pushToArr()` template methods (those are implemented as no-ops). The actual logic is inlined in each syncer's `sync()`. This means preview cannot intercept at the base class level -- it must add separate `generatePreview()` methods that reuse the same internal helpers.

**Quality Profiles syncer** (`/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts`):
1. `fetchSyncBatchByDatabase()` - Groups selections by database, loads PCD profiles and CFs
2. For each batch: `syncCustomFormats()` - Creates/updates CFs on Arr
3. Refreshes full CF list from Arr
4. `getQualityMappings()` - Gets quality API mappings
5. `syncQualityProfiles()` - Creates/updates QPs using transform results

Preview reuse: Steps 1, 3, 4 are pure reads. Step 2's CF transform can be extracted. Step 5's `transformQualityProfile()` is already a pure function.

**Custom Formats syncer** (`/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/sync/customFormats/syncer.ts`):
- `transformCustomFormatWithDiagnostics(pcdFormat, instanceType)` returns `{ format, skippedConditions }` -- already a pure function

**Delay Profiles syncer** (`/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/sync/delayProfiles/syncer.ts`):
1. Read config, get cache, fetch PCD profile
2. `resolveTargetDelayProfile()` - GET delay profiles, find default
3. `transform(profile)` - Pure function, maps PCD fields to Arr format
4. PUT to Arr

Preview reuse: Steps 1-3 are all extractable. `transform()` is already pure.

**Media Management syncer** (`/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts`):
Three sub-sections, each: GET existing from Arr, fetch from PCD, merge/transform, PUT back.
- `mapPropersRepacks()` - Pure function
- `syncRadarrNaming()` / `syncSonarrNaming()` / `syncLidarrNaming()` - Each does GET + PCD fetch + merge
- Quality definitions: GET existing, map via `getQualityApiMappings()`, merge values

Preview reuse: All PCD reads and transforms are extractable. Need to separate "compute desired state" from "PUT to Arr".

**Metadata Profiles syncer** (`/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts`):
1. Read config, get PCD profile from cache
2. Resolve namespace suffix
3. GET schema from Lidarr, normalize
4. `buildPayload()` - Pure function combining PCD data with schema
5. GET existing remote profiles, match by suffixed name
6. Create or update

Preview reuse: Steps 1-4 are extractable. Step 5 is a GET.

## Configuration

### Environment Variables

No new environment variables needed for preview. Relevant existing ones:

| Variable | Default | Relevance |
|----------|---------|-----------|
| `PORT` | 6969 (dev) / 6868 (prod) | Server port |
| `AUTH` | `on` | Auth mode (preview follows same auth gates) |
| `PARSER_HOST` / `PARSER_PORT` | localhost:5000 | Not needed for preview |

### Concurrency and Timing

- `CONCURRENCY_LIMIT = 3` in processor.ts -- for parallel instance processing
- Preview should use same limit for multi-instance previews
- Cleanup uses `{ retries: 0 }` for fail-fast Arr connections -- preview should too
- PCD cache build is async, but cache reads are synchronous (in-memory SQLite)

### Sync Status States

Sync status column values and transitions:

```
idle -> pending -> in_progress -> idle (success)
                              -> failed (error)
                              -> pending (retry/re-trigger)
```

Preview MUST NOT modify these states. It reads them only via `getSyncConfigStatus(instanceId)` to check for in-progress syncs.

## Architectural Patterns

- **Scan/Execute Two-Phase**: Cleanup module establishes the pattern. `scanForStaleItems()` (read-only) returns a result, which is passed back for `deleteStaleItems()`. Preview/Apply mirrors this exactly.
- **Section Registry**: All sync sections use a registry pattern with `SectionHandler` interface. Preview can use `getAllSections()` and `handler.hasConfig(instanceId)` to discover what to preview.
- **Syncer-per-Section**: Each section has its own syncer class extending `BaseSyncer`. Preview adds parallel `generatePreview()` methods rather than modifying `sync()`.
- **Client Cache Pattern**: Multi-instance operations use `createArrInstanceClientCache()` to avoid re-creating clients per section within the same instance.
- **Namespace Suffixing**: Entity names are suffixed with zero-width Unicode chars for multi-database coexistence. All display must strip suffixes. All matching must use suffixed names.
- **PCD Cache Registry**: Global `Map<databaseId, PCDCache>` accessed via `getCache(databaseId)`. Missing cache is a warning, not an error.

## Edgecases

- Quality profile syncer groups selections by database, so a single instance may have profiles from multiple databases with different namespace suffixes
- The `syncCustomFormats()` function both transforms AND pushes CFs; for preview, only the transform step should be called
- Lidarr custom format conditions are partially unsupported -- some conditions are skipped silently during sync and should be noted (not shown as changes) in preview
- Lidarr delay profile default resolution uses `resolveTargetDelayProfile()` which GETs all profiles and finds the untagged lowest-order one, not hardcoded id=1
- Media management sync only touches specific fields on each config object; the rest are preserved. Diff must compare only managed fields.
- Metadata profiles use `getMetadataProfileSchema()` from Lidarr API which may fail; the syncer falls back to a hardcoded schema. Preview should do the same.
- Quality definitions in PCD use `0` for unlimited; Arr API uses `null`. The `maxSize === 0 -> null` and `preferredSize === 0 -> null` transformations must be applied before diff.
- The `allFormatIdMap` in QP sync includes CFs from ALL databases (after refresh). For preview, this means fetching remote CFs once, then computing what the full set would look like after CF creates/updates.
- `arr_sync_media_management` stores configs for three independent sub-sections (naming, quality definitions, media settings). Each can be independently configured or null.
- `arr_sync_metadata_profiles_config` is only valid for Lidarr instances -- all queries enforce `ai.type = 'lidarr'` join.

## Other Docs

- [Feature Spec](/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/sync-preview-dry-run/feature-spec.md): Full feature specification with data models, API design, UX, and phasing
- [Technical Research](/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/sync-preview-dry-run/research-technical.md): Architecture decisions, data model design, system constraints
- [Business Research](/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/sync-preview-dry-run/research-business.md): User stories, business rules, domain analysis
- [External Research](/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/sync-preview-dry-run/research-external.md): Arr API docs, diff library evaluation, IaC precedents
- [UX Research](/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/sync-preview-dry-run/research-ux.md): Diff visualization, multi-instance layout, confirmation patterns
- [Recommendations](/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/sync-preview-dry-run/research-recommendations.md): Phasing strategy, technology choices, risk assessment
- Radarr API docs: https://radarr.video/docs/api/
- Sonarr API docs: https://sonarr.tv/docs/api/
- Lidarr API docs: https://lidarr.audio/docs/api/
