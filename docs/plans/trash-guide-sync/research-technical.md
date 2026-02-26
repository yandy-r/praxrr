# Technical Specifications: trash-guide-sync

## Executive Summary

TRaSH Guides sync integrates as a new **data source provider** alongside the existing PCD system,
feeding TRaSH JSON data through a fetcher/transformer/cache pipeline that produces PCD-compatible
entities. The architecture follows the existing `$sync/` section-handler pattern for push-to-Arr
operations, the `$jobs/` queue for scheduling, and introduces a new `$lib/server/trashguide/` module
for pull-from-guides logic. The key architectural decision is whether TRaSH data flows into Praxrr
as a "virtual PCD database" (reusing the PCD cache layer) or as a parallel data source with its own
cache -- the recommendation is the former, as it maximizes reuse of existing sync infrastructure.

## Architecture Design

### Component Diagram

```
                    +-----------------------------+
                    |   TRaSH Guides Git Repo     |
                    |  (github.com/TRaSH-Guides)  |
                    +-------------+---------------+
                                  |
                         git clone / pull
                                  |
                    +-------------v---------------+
                    |   TrashGuideFetcher          |
                    |   $trashguide/fetcher.ts     |
                    |                             |
                    |  - Clone/pull TRaSH repo    |
                    |  - Detect changes (git diff)|
                    |  - Read JSON files from disk |
                    +-------------+---------------+
                                  |
                         raw JSON entities
                                  |
                    +-------------v---------------+
                    |   TrashGuideTransformer      |
                    |   $trashguide/transformer.ts |
                    |                             |
                    |  - Parse CF JSON -> PCD CF  |
                    |  - Parse QP JSON -> PCD QP  |
                    |  - Parse QD JSON -> PCD QD  |
                    |  - Parse Naming JSON -> PCD |
                    |  - Resolve trash_id refs    |
                    |  - Apply score profiles     |
                    +-------------v---------------+
                                  |
                         PCD-format entities
                                  |
                    +-------------v---------------+
                    |   TrashGuideCache            |
                    |   $trashguide/cache.ts       |
                    |                             |
                    |  - Build in-memory SQLite   |
                    |  - Same schema as PCDCache  |
                    |  - Queryable via Kysely     |
                    +-------------+---------------+
                                  |
                    +-------------v---------------+
                    |   Existing Sync Pipeline     |
                    |   $sync/processor.ts         |
                    |                             |
                    |  - Section handlers         |
                    |  - BaseSyncer subclasses    |
                    |  - Preview system           |
                    +-------------+---------------+
                                  |
                    +-------------v---------------+
                    |   Arr Instances              |
                    |   (Radarr / Sonarr / Lidarr) |
                    +-----------------------------+
```

### New Components

- **TrashGuideFetcher** (`$trashguide/fetcher.ts`): Manages the local clone of the TRaSH Guides
  repository. Responsible for initial clone, periodic pull, change detection via git diff, and
  reading raw JSON files from the cloned filesystem. Follows patterns from `$utils/git/` (uses same
  `clone`, `pull`, `checkForUpdates` primitives).

- **TrashGuideParser** (`$trashguide/parser.ts`): Parses raw TRaSH JSON files into typed
  intermediate representations. Handles the specific TRaSH JSON schemas (custom formats with
  `trash_id`/`trash_scores`/`specifications`, quality profiles with `items`/`formatItems`, quality
  sizes with `qualities` arrays, naming configs with `folder`/`file` variants).

- **TrashGuideTransformer** (`$trashguide/transformer.ts`): Converts parsed TRaSH entities into
  PCD-compatible SQL operations or directly into PCD cache-queryable format. Maps `trash_id`
  references to resolved entities. Applies score profiles (`default`, `german`, etc.) to custom
  format scores. This is the critical bridge between TRaSH data model and the existing PCD entity
  model.

- **TrashGuideManager** (`$trashguide/manager.ts`): High-level orchestration analogous to
  `PCDManager`. Manages lifecycle: link TRaSH source, sync/pull updates, compile cache, trigger
  downstream Arr syncs. Holds configuration for which score profile to use, which Arr type to
  target, etc.

- **TrashGuideCache** (`$trashguide/cache.ts`): Either an adapter over `PCDCache` or a thin wrapper
  that compiles TRaSH data into the same in-memory SQLite schema so existing sync section handlers
  (`QualityProfileSyncer`, `DelayProfileSyncer`, `MediaManagementSyncer`) work without modification.

- **TrashGuideJobHandler** (`$jobs/handlers/trashGuideSync.ts`): Job handler registered with
  `jobQueueRegistry` for scheduled TRaSH guide pulls. Follows the pattern of `pcdSync.ts`.

### Integration Points

- **`$utils/git/`** <-> **TrashGuideFetcher**: Reuses existing git primitives (`clone`, `pull`,
  `checkForUpdates`, `getStatus`) with TRaSH repo URL
- **`$pcd/database/cache.ts`** <-> **TrashGuideCache**: Either extends `PCDCache` or wraps it; the
  sync pipeline queries the same `PCDDatabase` Kysely interface
- **`$sync/processor.ts`** <-> **TrashGuideManager**: `triggerSyncs()` with `event: 'on_pull'` after
  TRaSH guide data is refreshed, same pattern as `pcdManager.triggerPullSync()`
- **`$jobs/schedule.ts`** <-> **TrashGuideManager**: New `scheduleTrashGuideSyncForSource()`
  function following the `schedulePcdSyncForDatabase()` pattern
- **`$db/queries/`** <-> **New query modules**: `trashGuideSources.ts` and `trashGuideSync.ts` for
  persistence of TRaSH guide source configuration and sync state
- **`$sync/registry.ts`** <-> **Existing section handlers**: No changes needed -- TRaSH data feeds
  into the same PCD cache that section handlers already query

### Data Flow: Pull Cycle

1. Job dispatcher fires `trashguide.sync` job
2. `TrashGuideFetcher.pull()` executes `git pull` on local TRaSH repo clone
3. `TrashGuideFetcher.detectChanges()` uses `git diff` to identify changed JSON files
4. `TrashGuideParser.parseChangedFiles()` reads and parses only changed files (or all on first run)
5. `TrashGuideTransformer.transform()` converts parsed entities to PCD operations
6. `TrashGuideCache.rebuild()` compiles fresh in-memory SQLite from transformed data
7. `triggerSyncs({ event: 'on_pull' })` fires for all instances configured to sync on pull

### Data Flow: Push Cycle (Sync to Arr)

Same as existing PCD sync -- the TRaSH guide cache is registered as a "database" in the cache
registry, so `QualityProfileSyncer.fetchFromPcd()` queries it transparently via the existing
`getCache(databaseId)` path.

## Data Models

### New Tables

#### `trash_guide_sources`

| Column             | Type       | Constraints                  | Description                                                 |
| ------------------ | ---------- | ---------------------------- | ----------------------------------------------------------- |
| `id`               | `INTEGER`  | `PRIMARY KEY AUTOINCREMENT`  | Source ID                                                   |
| `name`             | `TEXT`     | `NOT NULL UNIQUE`            | User-friendly name (e.g., "TRaSH Guides")                   |
| `repository_url`   | `TEXT`     | `NOT NULL`                   | Git URL (default: `https://github.com/TRaSH-Guides/Guides`) |
| `branch`           | `TEXT`     | `NOT NULL DEFAULT 'master'`  | Git branch                                                  |
| `local_path`       | `TEXT`     | `NOT NULL`                   | Where repo is cloned locally                                |
| `arr_type`         | `TEXT`     | `NOT NULL`                   | Target Arr type: `radarr`, `sonarr`                         |
| `score_profile`    | `TEXT`     | `NOT NULL DEFAULT 'default'` | TRaSH score profile to apply (e.g., `default`, `german`)    |
| `sync_strategy`    | `INTEGER`  | `NOT NULL DEFAULT 0`         | 0=manual, >0=auto-check every X minutes                     |
| `auto_pull`        | `INTEGER`  | `NOT NULL DEFAULT 0`         | 0=notify only, 1=auto-pull                                  |
| `enabled`          | `INTEGER`  | `NOT NULL DEFAULT 1`         | Master on/off                                               |
| `last_synced_at`   | `DATETIME` |                              | Last successful sync timestamp                              |
| `last_commit_hash` | `TEXT`     |                              | Last synced commit hash for change detection                |
| `created_at`       | `DATETIME` | `DEFAULT CURRENT_TIMESTAMP`  |                                                             |
| `updated_at`       | `DATETIME` | `DEFAULT CURRENT_TIMESTAMP`  |                                                             |

**Design note**: Each `trash_guide_sources` row corresponds to a specific `arr_type` (Radarr vs
Sonarr) because the JSON files are organized per-app in the TRaSH repo (`docs/json/radarr/` vs
`docs/json/sonarr/`). A user wanting both Radarr and Sonarr TRaSH syncing would create two sources.

#### `trash_guide_sync_config`

| Column           | Type      | Constraints                                                 | Description                                          |
| ---------------- | --------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| `instance_id`    | `INTEGER` | `NOT NULL`                                                  | FK to `arr_instances.id`                             |
| `source_id`      | `INTEGER` | `NOT NULL`                                                  | FK to `trash_guide_sources.id`                       |
| `trigger`        | `TEXT`    | `NOT NULL DEFAULT 'none'`                                   | `none`, `manual`, `on_pull`, `on_change`, `schedule` |
| `cron`           | `TEXT`    |                                                             | Cron expression for schedule trigger                 |
| `next_run_at`    | `TEXT`    |                                                             | Next scheduled run                                   |
| `sync_status`    | `TEXT`    | `NOT NULL DEFAULT 'idle'`                                   | `idle`, `pending`, `in_progress`, `failed`           |
| `last_error`     | `TEXT`    |                                                             | Last sync error                                      |
| `last_synced_at` | `TEXT`    |                                                             | Last successful sync                                 |
| `should_sync`    | `INTEGER` | `NOT NULL DEFAULT 0`                                        | Pending sync flag (legacy compat)                    |
|                  |           | `PRIMARY KEY (instance_id, source_id)`                      |                                                      |
|                  |           | `FK instance_id -> arr_instances(id) ON DELETE CASCADE`     |                                                      |
|                  |           | `FK source_id -> trash_guide_sources(id) ON DELETE CASCADE` |                                                      |

#### `trash_guide_sync_selections`

| Column         | Type      | Constraints                                                     | Description                                                                           |
| -------------- | --------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `instance_id`  | `INTEGER` | `NOT NULL`                                                      | FK to `arr_instances.id`                                                              |
| `source_id`    | `INTEGER` | `NOT NULL`                                                      | FK to `trash_guide_sources.id`                                                        |
| `section_type` | `TEXT`    | `NOT NULL`                                                      | `qualityProfiles`, `customFormats`, `qualityDefinitions`, `naming`, `mediaManagement` |
| `item_name`    | `TEXT`    | `NOT NULL`                                                      | Entity name or `*` for "all"                                                          |
|                |           | `PRIMARY KEY (instance_id, source_id, section_type, item_name)` |                                                                                       |
|                |           | `FK instance_id -> arr_instances(id) ON DELETE CASCADE`         |                                                                                       |
|                |           | `FK source_id -> trash_guide_sources(id) ON DELETE CASCADE`     |                                                                                       |

#### `trash_guide_entity_cache`

| Column         | Type       | Constraints                                                 | Description                                                  |
| -------------- | ---------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| `id`           | `INTEGER`  | `PRIMARY KEY AUTOINCREMENT`                                 |                                                              |
| `source_id`    | `INTEGER`  | `NOT NULL`                                                  | FK to `trash_guide_sources.id`                               |
| `trash_id`     | `TEXT`     | `NOT NULL`                                                  | TRaSH UUID identifier                                        |
| `entity_type`  | `TEXT`     | `NOT NULL`                                                  | `custom_format`, `quality_profile`, `quality_size`, `naming` |
| `name`         | `TEXT`     | `NOT NULL`                                                  | Entity display name                                          |
| `json_data`    | `TEXT`     | `NOT NULL`                                                  | Full raw JSON blob                                           |
| `file_path`    | `TEXT`     | `NOT NULL`                                                  | Source file path in repo                                     |
| `content_hash` | `TEXT`     | `NOT NULL`                                                  | SHA-256 of file content for change detection                 |
| `fetched_at`   | `DATETIME` | `DEFAULT CURRENT_TIMESTAMP`                                 |                                                              |
|                |            | `UNIQUE (source_id, trash_id)`                              |                                                              |
|                |            | `FK source_id -> trash_guide_sources(id) ON DELETE CASCADE` |                                                              |

**Index**: `idx_trash_guide_entity_cache_type ON trash_guide_entity_cache(source_id, entity_type)`

### Schema Migrations

- **Migration N**: `create_trash_guide_sources` -- Creates `trash_guide_sources` table
- **Migration N+1**: `create_trash_guide_sync_tables` -- Creates `trash_guide_sync_config`,
  `trash_guide_sync_selections`, `trash_guide_entity_cache` tables with indexes
- **Migration N+2**: `add_trash_guide_job_types` -- No DDL needed; job types are string-based in
  `job_queue`

### Virtual PCD Integration

The most elegant integration approach is to have each `trash_guide_sources` row create a synthetic
`database_instances` entry (or be stored alongside PCD databases in a shared lookup) so existing
sync infrastructure treats TRaSH data as "just another database." The alternative is to keep TRaSH
sources separate but have the sync pipeline query both PCD and TRaSH caches. The recommendation is
Option A (virtual PCD database) because:

1. No changes needed to `$sync/processor.ts`, section handlers, or preview system
2. Namespace suffixes work automatically via `arr_database_namespaces`
3. Sync selections use existing `arr_sync_quality_profiles` table
4. Job scheduling reuses `scheduleArrSyncForInstance()`

If Option A is chosen, `trash_guide_sources` is a metadata-only table and the actual entity data
lives in the PCD cache compiled from transformed TRaSH JSON. The `trash_guide_entity_cache` table
serves as a persistent intermediate cache to avoid re-parsing all 207+ JSON files on every startup.

## API Design

### New Endpoints

#### `GET /api/v1/trash-guide/sources`

Returns all configured TRaSH guide sources.

**Response** `200 OK`:

```json
{
  "sources": [
    {
      "id": 1,
      "name": "TRaSH Guides (Radarr)",
      "repositoryUrl": "https://github.com/TRaSH-Guides/Guides",
      "branch": "master",
      "arrType": "radarr",
      "scoreProfile": "default",
      "syncStrategy": 60,
      "autoPull": true,
      "enabled": true,
      "lastSyncedAt": "2026-02-25T12:00:00Z",
      "lastCommitHash": "abc123",
      "status": {
        "hasUpdates": false,
        "entityCounts": {
          "customFormats": 207,
          "qualityProfiles": 25,
          "qualitySizes": 1,
          "naming": 1
        }
      }
    }
  ]
}
```

#### `POST /api/v1/trash-guide/sources`

Link a new TRaSH guide source.

**Request**:

```json
{
  "name": "TRaSH Guides (Radarr)",
  "repositoryUrl": "https://github.com/TRaSH-Guides/Guides",
  "branch": "master",
  "arrType": "radarr",
  "scoreProfile": "default",
  "syncStrategy": 60,
  "autoPull": true
}
```

**Response** `201 Created`: Full source object.

**Errors**: `409 Conflict` if name already exists, `422 Unprocessable Entity` for invalid arrType.

#### `PUT /api/v1/trash-guide/sources/:id`

Update source configuration.

#### `DELETE /api/v1/trash-guide/sources/:id`

Unlink source, delete local clone and cached entities.

#### `POST /api/v1/trash-guide/sources/:id/sync`

Trigger manual sync (pull + reparse + recompile).

**Response** `200 OK`:

```json
{
  "success": true,
  "hasUpdates": true,
  "commitsBehind": 3,
  "entitiesUpdated": 12
}
```

#### `GET /api/v1/trash-guide/sources/:id/entities`

List available entities from a TRaSH source, optionally filtered by type.

**Query params**: `?type=custom_format&search=BR-DISK`

**Response** `200 OK`:

```json
{
  "entities": [
    {
      "trashId": "ed38b889b31be83fda192888e2286d83",
      "type": "custom_format",
      "name": "BR-DISK",
      "scores": { "default": -10000, "german": -35000 },
      "filePath": "docs/json/radarr/cf/br-disk.json"
    }
  ]
}
```

#### `GET /api/v1/trash-guide/sources/:id/quality-profiles`

List available quality profiles from a TRaSH source with full detail.

#### `GET /api/v1/trash-guide/sources/:id/score-profiles`

List available score profiles (extracted by scanning all `trash_scores` keys across CFs).

**Response** `200 OK`:

```json
{
  "scoreProfiles": ["default", "german", "french-vostfr", "french-multi"]
}
```

### Modified Endpoints

- **`GET /api/v1/sync/instances/:id/config`**: Extend response to include TRaSH guide sync
  selections alongside PCD selections. The response already returns per-section configurations;
  TRaSH selections would appear under the same sections with a `sourceType: 'trash_guide'`
  discriminator.

- **`PUT /api/v1/sync/instances/:id/config`**: Accept TRaSH guide source references in sync
  selection payloads.

### Error Handling

All endpoints follow existing patterns:

- `400 Bad Request` for malformed input
- `404 Not Found` for missing source/entity IDs
- `409 Conflict` for duplicate names
- `422 Unprocessable Entity` for semantic validation failures (e.g., wrong arrType)
- `500 Internal Server Error` with structured error body `{ "error": "message" }`

## System Constraints

### Performance

- **TRaSH repo size**: The Guides repo is ~92.5% Markdown; JSON files are small (1-10KB each). Total
  JSON payload is approximately 2-5MB. Parsing 200+ CF files + 25 QP files should complete in <1
  second.
- **Git clone size**: Full clone may be 100-200MB due to history. Use `--depth 1` shallow clone to
  reduce to ~20-30MB. For updates, `git pull --ff-only` is fast.
- **Cache compilation**: Transforming TRaSH JSON to PCD SQL and building the in-memory SQLite should
  be <2 seconds based on existing PCD cache build benchmarks.
- **Startup impact**: Cache is built lazily on first access or eagerly during
  `pcdManager.initialize()`. TRaSH sources should follow the same eager initialization pattern.
- **Memory**: Each in-memory SQLite cache is ~1-5MB. Adding one TRaSH cache per source is
  negligible.

### Concurrency

- **Sync locking**: Follow existing `claimSync`/`completeSync`/`failSync` state machine in
  `arrSyncQueries`. The `sync_status` column with atomic claim
  (`UPDATE WHERE sync_status = 'pending'`) prevents double-processing.
- **Git operations**: TRaSH repo pull must be serialized per source (same as PCD). Use the
  `dedupeKey` pattern in job queue: `trashguide.sync:{sourceId}`.
- **Cache rebuild**: Follow `$pcd/database/compiler.ts` pattern -- build new cache first, then
  atomically swap in the registry. Old cache is closed after swap.
- **Parallel instance syncs**: The existing `CONCURRENCY_LIMIT = 3` in `processor.ts` handles this.
  TRaSH-sourced syncs go through the same pipeline.

### Error Resilience

- **Partial fetch failure**: If git pull fails, keep the existing cached data and report the error.
  Don't invalidate working cache on transient failures.
- **Invalid JSON**: Skip individual malformed files, log warnings, continue with valid entities.
  Track `parseErrors` count in sync result.
- **Transform failures**: Per-entity try/catch during transformation. A single bad custom format
  should not block all other CFs from syncing.
- **Arr API failures**: Already handled by existing `BaseSyncer.sync()` error handling and
  `handler.failSync()`.
- **Retry logic**: Reuse job queue reschedule mechanism (`rescheduleAt` in `JobHandlerResult`).
  Failed TRaSH syncs are retried at next scheduled interval.
- **Schema drift**: If TRaSH JSON schema changes, the parser should fail loudly for unknown
  structures but gracefully handle additive changes (new fields are ignored).

### Existing Patterns to Follow

- **Section handler pattern** (`$sync/qualityProfiles/handler.ts`): Registration via
  `registerSection()`, implements `SectionHandler` interface
- **Job handler pattern** (`$jobs/handlers/pcdSync.ts`): Register with `jobQueueRegistry`, return
  `JobHandlerResult` with optional `rescheduleAt`
- **PCD Manager pattern** (`$pcd/core/manager.ts`): Singleton class with `link`, `unlink`, `sync`,
  `initialize`, `getCache` lifecycle
- **Query module pattern** (`$db/queries/databaseInstances.ts`): Static query class with prepared
  statements, exports from module-level singleton
- **Migration pattern** (`$db/migrations/*.ts`): Named export `migration` with `version`, `name`,
  `up` SQL string
- **Event trigger pattern** (`$sync/processor.ts`): `triggerSyncs({ event: 'on_pull' })` after data
  refresh

## Codebase Changes

### Files to Create

- `/packages/praxrr-app/src/lib/server/trashguide/index.ts`: Public API re-exports
- `/packages/praxrr-app/src/lib/server/trashguide/manager.ts`: TrashGuideManager orchestration
  (analogous to PCDManager)
- `/packages/praxrr-app/src/lib/server/trashguide/fetcher.ts`: Git clone/pull + file reading for
  TRaSH repo
- `/packages/praxrr-app/src/lib/server/trashguide/parser.ts`: JSON parsing for TRaSH-specific
  schemas (CF, QP, QD, naming)
- `/packages/praxrr-app/src/lib/server/trashguide/transformer.ts`: TRaSH -> PCD entity
  transformation
- `/packages/praxrr-app/src/lib/server/trashguide/cache.ts`: Cache builder (either wraps PCDCache or
  builds independent in-memory DB)
- `/packages/praxrr-app/src/lib/server/trashguide/types.ts`: TypeScript interfaces for TRaSH JSON
  schemas
- `/packages/praxrr-app/src/lib/server/db/queries/trashGuideSources.ts`: Query module for
  `trash_guide_sources` table
- `/packages/praxrr-app/src/lib/server/db/queries/trashGuideSync.ts`: Query module for sync
  config/selections tables
- `/packages/praxrr-app/src/lib/server/db/queries/trashGuideEntityCache.ts`: Query module for entity
  cache table
- `/packages/praxrr-app/src/lib/server/db/migrations/YYYYMMDD_create_trash_guide_tables.ts`:
  Migration for all new tables
- `/packages/praxrr-app/src/lib/server/jobs/handlers/trashGuideSync.ts`: Job handler for scheduled
  TRaSH guide sync
- `/packages/praxrr-app/src/routes/api/v1/trash-guide/sources/+server.ts`: GET/POST sources
- `/packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/+server.ts`: GET/PUT/DELETE
  source by ID
- `/packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/sync/+server.ts`: POST trigger
  sync
- `/packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/entities/+server.ts`: GET
  entities
- `/packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/quality-profiles/+server.ts`: GET
  quality profiles
- `/packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/score-profiles/+server.ts`: GET
  score profiles

### Files to Modify

- `/packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`: Add `'trashguide.sync'` to `JobType`
  union
- `/packages/praxrr-app/src/lib/server/jobs/display.ts`: Add display name for `trashguide.sync` job
  type
- `/packages/praxrr-app/src/lib/server/jobs/schedule.ts`: Add `scheduleTrashGuideSyncForSource()`
  function, call it from `scheduleAllJobs()`
- `/packages/praxrr-app/src/lib/server/jobs/handlers/index.ts`: Import `trashGuideSync.ts` handler
- `/packages/praxrr-app/src/hooks.server.ts`: Initialize TrashGuideManager during startup sequence
  (after PCD init)
- `/packages/praxrr-app/src/lib/server/db/migrations.ts`: Import and register new migration
- `/packages/praxrr-app/src/lib/server/db/schema.sql`: Document new tables (reference only)
- `/packages/praxrr-app/deno.json`: Add `$trashguide/` path alias

### Dependencies

No new external dependencies required. The implementation uses:

- Existing `$utils/git/` for git operations
- Existing `@jsr/db__sqlite` + Kysely for in-memory cache
- Standard `Deno.readTextFile` / `Deno.readDir` for JSON parsing
- Standard `crypto.subtle.digest` for content hashing

## Technical Decisions

### Decision 1: Integration Model

- **Option A**: Virtual PCD Database -- TRaSH source creates a synthetic `database_instances` entry,
  transforms data into PCD ops, uses existing PCD cache
- **Option B**: Parallel Data Source -- TRaSH has its own cache registry, sync pipeline queries both
  PCD and TRaSH caches
- **Option C**: PCD Importer -- TRaSH data is imported as PCD base ops into a real PCD database on
  disk

- **Recommendation**: Option A
- **Rationale**: Maximizes reuse. The existing sync pipeline (`QualityProfileSyncer`,
  `DelayProfileSyncer`, etc.) queries `getCache(databaseId)` and transforms PCD data to Arr API
  payloads. If TRaSH data is compiled into the same PCD cache format, zero changes are needed in the
  sync pipeline, preview system, cleanup logic, or namespace management. The `database_instances`
  row would have a `source` column (or type discriminator) marking it as TRaSH-sourced, and
  `trash_guide_sources` stores TRaSH-specific metadata.

### Decision 2: Git Shallow Clone vs Full Clone

- **Option A**: Shallow clone (`--depth 1`)
- **Option B**: Full clone with history
- **Option C**: GitHub API tarball download (no git)

- **Recommendation**: Option A
- **Rationale**: The TRaSH repo is primarily Markdown documentation. We only need the latest JSON
  files. Shallow clone reduces storage from ~200MB to ~30MB. `git pull` on shallow clones works for
  forward-only updates. If the branch is force-pushed, a re-clone is needed (detectable by
  `git pull` failure).

### Decision 3: Change Detection Strategy

- **Option A**: Content hash comparison (SHA-256 of each JSON file)
- **Option B**: Git diff between last-synced commit and HEAD
- **Option C**: File modification timestamps

- **Recommendation**: Option B with Option A as fallback
- **Rationale**: `git diff --name-only <last_commit>..HEAD -- docs/json/` gives exact changed files
  with zero I/O overhead. Content hash is used as a secondary check during initial import or when
  commit history is unavailable (shallow clone limits).

### Decision 4: Score Profile Handling

- **Option A**: User selects score profile per TRaSH source (one profile applies to all CFs)
- **Option B**: User selects score profile per quality profile selection
- **Option C**: Store all score profiles, let user pick during sync selection

- **Recommendation**: Option A for initial implementation, with Option C as a follow-up
- **Rationale**: Simplest mental model -- "this TRaSH source uses the `default` scores." Most users
  will use `default`. The `score_profile` column on `trash_guide_sources` makes this a single
  config. Option C can be layered on later by allowing per-QP-selection score profile overrides.

### Decision 5: Per-Arr-Type Source Separation

- **Option A**: One source per `arr_type` (user creates separate sources for Radarr and Sonarr)
- **Option B**: One source for both, filter by arr_type at sync time

- **Recommendation**: Option A
- **Rationale**: TRaSH Guides data is organized per-app (`docs/json/radarr/`, `docs/json/sonarr/`).
  Custom formats, quality profiles, and quality definitions differ significantly between Radarr and
  Sonarr. A single source per arr_type avoids confusing UI where Radarr entities appear when
  configuring a Sonarr instance. This also aligns with the Cross-Arr Semantic Validation Policy.

## TRaSH Guides Data Model Reference

### Repository Structure

```
docs/json/
  radarr/
    cf/              # ~207 custom format JSON files
    cf-groups/       # ~20 CF group JSON files (collections)
    quality-profiles/ # ~25 quality profile JSON files
    quality-size/    # Quality definition files (e.g., movie.json)
    naming/          # Naming convention files
  sonarr/
    cf/              # Custom format JSON files
    cf-groups/       # CF group JSON files
    quality-profiles/ # Quality profile JSON files
    quality-size/    # Quality definition files
    naming/          # Naming convention files
```

### Custom Format JSON Schema

```typescript
interface TrashCustomFormat {
  trash_id: string; // UUID identifier
  trash_scores: Record<string, number>; // e.g., { "default": -10000, "german": -35000 }
  trash_regex?: string; // regex101.com reference URL
  name: string; // Display name (e.g., "BR-DISK")
  includeCustomFormatWhenRenaming: boolean;
  specifications: TrashSpecification[];
}

interface TrashSpecification {
  name: string;
  implementation: string; // e.g., "ReleaseTitleSpecification", "LanguageSpecification"
  negate: boolean;
  required: boolean;
  fields: {
    value: string; // Regex pattern or language code
    exceptLanguage?: boolean; // For LanguageSpecification
  };
}
```

### Quality Profile JSON Schema

```typescript
interface TrashQualityProfile {
  trash_id: string;
  name: string;
  trash_description: string; // HTML formatted
  trash_url: string;
  group: number;
  upgradeAllowed: boolean;
  cutoff: string; // Quality tier name
  minFormatScore: number;
  cutoffFormatScore: number;
  minUpgradeFormatScore: number;
  language: string; // e.g., "original"
  items: TrashQualityItem[];
  formatItems: Record<string, string>; // CF name -> trash_id
}

interface TrashQualityItem {
  name: string; // Quality name or group name
  allowed: boolean;
  items?: string[]; // Sub-items for quality groups
}
```

### Quality Size JSON Schema

```typescript
interface TrashQualitySize {
  trash_id: string;
  type: string; // e.g., "movie", "series", "anime"
  qualities: TrashQualitySizeEntry[];
}

interface TrashQualitySizeEntry {
  quality: string; // e.g., "HDTV-720p"
  min: number; // GB
  preferred: number; // GB
  max: number; // GB
}
```

### Naming JSON Schema

```typescript
interface TrashNaming {
  folder: Record<string, string>; // variant -> template
  file: Record<string, string>; // variant -> template
}
```

## Relevant Files

### Sync Pipeline

- `/packages/praxrr-app/src/lib/server/sync/processor.ts`: Core sync orchestration;
  `processPendingSyncs()`, `triggerSyncs()`, `syncInstance()`
- `/packages/praxrr-app/src/lib/server/sync/base.ts`: `BaseSyncer` abstract class with
  fetch->transform->push pattern
- `/packages/praxrr-app/src/lib/server/sync/registry.ts`: Section handler registry;
  `registerSection()`, `getSection()`
- `/packages/praxrr-app/src/lib/server/sync/types.ts`: `SectionType`, `SectionHandler`, `SyncResult`
  interfaces
- `/packages/praxrr-app/src/lib/server/sync/mappings.ts`: Quality/language/source constant maps per
  arr_type
- `/packages/praxrr-app/src/lib/server/sync/namespace.ts`: Zero-width unicode namespace suffixes for
  multi-database sync
- `/packages/praxrr-app/src/lib/server/sync/cleanup.ts`: Stale item detection and deletion
- `/packages/praxrr-app/src/lib/server/sync/qualityProfiles/handler.ts`: Quality profiles section
  handler (pattern reference)
- `/packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts`: Quality profiles syncer with
  namespace-aware sync
- `/packages/praxrr-app/src/lib/server/sync/qualityProfiles/transformer.ts`: PCD -> Arr quality
  profile transformation

### Job System

- `/packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`: `JobType` union, `JobHandler` type,
  `JobHandlerResult`
- `/packages/praxrr-app/src/lib/server/jobs/dispatcher.ts`: `JobDispatcher` class with timer-based
  scheduling
- `/packages/praxrr-app/src/lib/server/jobs/queueService.ts`: `enqueueJob()`, `upsertScheduledJob()`
- `/packages/praxrr-app/src/lib/server/jobs/schedule.ts`: `scheduleAllJobs()`, per-feature
  scheduling functions
- `/packages/praxrr-app/src/lib/server/jobs/handlers/pcdSync.ts`: PCD sync job handler (pattern
  reference)
- `/packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`: Arr sync job handler (pattern
  reference)

### PCD System

- `/packages/praxrr-app/src/lib/server/pcd/core/manager.ts`: `PCDManager` with
  link/unlink/sync/initialize lifecycle
- `/packages/praxrr-app/src/lib/server/pcd/database/cache.ts`: `PCDCache` in-memory SQLite builder
- `/packages/praxrr-app/src/lib/server/pcd/database/compiler.ts`: `compile()`, `invalidate()` cache
  management
- `/packages/praxrr-app/src/lib/server/pcd/database/registry.ts`: `getCache()`, `setCache()` cache
  registry
- `/packages/praxrr-app/src/lib/server/pcd/core/types.ts`: `Operation`, `CacheBuildStats`,
  `SyncResult` types

### Database

- `/packages/praxrr-app/src/lib/server/db/schema.sql`: Full schema reference (documentation only)
- `/packages/praxrr-app/src/lib/server/db/migrations.ts`: Migration runner and registration
- `/packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`: Arr sync query module (pattern
  reference)
- `/packages/praxrr-app/src/lib/server/db/queries/databaseInstances.ts`: PCD database instance
  queries (pattern reference)

### Git Utilities

- `/packages/praxrr-app/src/lib/server/utils/git/write.ts`: `clone()`, `pull()` git operations
- `/packages/praxrr-app/src/lib/server/utils/git/read.ts`: `checkForUpdates()`, `getStatus()` git
  queries

### Arr Clients

- `/packages/praxrr-app/src/lib/server/utils/arr/base.ts`: `BaseArrClient` with CF/QP/QD CRUD
  methods
- `/packages/praxrr-app/src/lib/server/utils/arr/types.ts`: Arr API payload types

### Shared Types

- `/packages/praxrr-app/src/lib/shared/pcd/types.ts`: PCD database schema types (Kysely interfaces)

### Startup

- `/packages/praxrr-app/src/hooks.server.ts`: Server initialization sequence

## Edgecases

- TRaSH repo force-pushes or branch resets will break shallow `git pull`; detect via error and
  re-clone
- Some TRaSH CFs have no `trash_scores.default` key; the transformer must handle missing score
  profiles gracefully (default to 0)
- TRaSH quality profiles reference CFs by `trash_id` in `formatItems` -- the transformer must
  resolve these to CF names before inserting into PCD cache
- TRaSH naming templates use Arr-native tokens (`{Movie CleanTitle}`) that must be passed through
  verbatim, not transformed
- Quality profile `cutoff` is a string (quality tier name), but the Arr API expects a numeric
  quality ID -- the transformer must resolve using the `QUALITIES` map from `$sync/mappings.ts`
- CF groups (`cf-groups/`) reference CFs by `trash_id` and link to quality profiles; these are
  metadata for UI grouping and should be parsed but not directly synced as separate entities
- TRaSH quality size `preferred` and `max` values are often set to extreme defaults (1999/2000 GB);
  the transformer should preserve these as-is since they represent "no limit"
- Namespace collisions: if a user links both a PCD database and a TRaSH source that define the same
  CF or QP name, the namespace suffix system handles this automatically -- each source gets its own
  suffix index
- Arr-type mismatch: if a TRaSH source is configured for `radarr` but selected for sync to a Sonarr
  instance, the sync handler must reject this at configuration time, not at sync time
- TRaSH `trash_id` values are not UUIDs but hex strings (32 chars); ensure the `trash_id` column
  uses `TEXT` not a UUID-specific type
- Language mappings differ between TRaSH profiles and PCD; the transformer must normalize using the
  existing `getLanguageForProfile()` function from `$sync/mappings.ts`

## Open Questions

1. **Should TRaSH guide source linking happen automatically on first startup?** -- Similar to the
   default PCD database auto-link in `hooks.server.ts`, should there be a
   `PRAXRR_DEFAULT_TRASH_GUIDE_URL` env variable?

2. **Should TRaSH quality profiles be composable with PCD user overrides?** -- If a user selects a
   TRaSH quality profile but wants to adjust a CF score, should they be able to create a PCD user op
   that overlays the TRaSH base? This would require the TRaSH data to flow through the PCD ops
   system (Option C integration model).

3. **How should Lidarr be handled?** -- TRaSH Guides does not currently provide Lidarr-specific
   data. Should the feature explicitly exclude Lidarr, or should the architecture accommodate future
   Lidarr guides?

4. **What is the UI/UX for selecting TRaSH entities?** -- The existing sync configuration UI selects
   PCD quality profiles by name. Should TRaSH entities be selectable in the same UI with a source
   type indicator, or should there be a separate TRaSH-specific configuration page?

5. **Should the persistent entity cache (`trash_guide_entity_cache`) be SQLite or
   filesystem-based?** -- SQLite is simpler for querying and atomic updates. Filesystem-based (one
   JSON file per entity) is simpler for debugging but harder to query. The recommendation is SQLite,
   consistent with the app's data storage patterns.

6. **How should preview/dry-run work for TRaSH guide syncs?** -- The existing `$sync/preview/`
   system generates diff previews before applying changes. TRaSH syncs should integrate with this
   system. If using the virtual PCD database approach (Option A), this comes for free.
