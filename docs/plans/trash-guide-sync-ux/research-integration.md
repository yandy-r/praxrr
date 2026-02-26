# Integration Research: trash-guide-sync-ux

## API Endpoints

### Existing Related Endpoints

- **GET /api/v1/trash-guide/sources**: lists every TRaSH source (`trashGuideManager.listSources()`)
  returning arr type, score profile, auto-pull/sync strategy state, entity counts, and last sync
  metadata for UI population.
- **POST /api/v1/trash-guide/sources**: validates `name`, `repositoryUrl`, `arrType`, optional
  `branch`, `scoreProfile`, `autoPull`, `enabled`, and `syncStrategy`, calls
  `trashGuideManager.createSource()`, and maps conflict/validation/fetch/transform errors to
  409/422/502/422 responses.
- **GET /api/v1/trash-guide/sources/{id}**: resolves `id` via `_helpers.parseSourceId`, calls
  `trashGuideManager.getSource(id)`, and returns 404 for `TrashGuideSourceNotFoundError`.
- **PUT /api/v1/trash-guide/sources/{id}**: allows patching the same fields as POST (plus branch),
  optionally re-clones when the repo changes, and surfaces the same set of domain errors through
  `trashGuideManager.updateSource(id, payload)`.
- **DELETE /api/v1/trash-guide/sources/{id}**: removes the DB row and on-disk clone via
  `trashGuideManager.deleteSource(id)` after validating `id`.
- **GET /api/v1/trash-guide/sources/{id}/entities**: pages through `trash_guide_entity_cache` for
  the source, applying optional `type`, `search`, and `arrType` filters (arr type must match the
  source), enforcing cursor/offset pagination with 1-200 limit, and returning parsed JSON plus
  scores/group metadata depending on entity type.
- **POST /api/v1/trash-guide/sources/{id}/sync**: validates the source exists, checks the job queue
  for existing `trashguide.sync:{sourceId}` dedupe keys, enqueues/reschedules a job via
  `jobQueueQueries.upsertScheduled()`, notifies the dispatcher, and returns conflict metadata if a
  sync is already running.

### Route Organization

All TRaSH Guide routes live under `packages/praxrr-app/src/routes/api/v1/trash-guide/sources`. CRUD
routes are implemented directly in the `+server.ts` files at the base and `[id]` segments, with
shared validation/logging helpers in `_helpers.ts`. Subdirectories `[id]/entities` and `[id]/sync`
host their own `+server.ts` files for entity browsing and manual sync triggering, keeping
filtering/pagination logic separate. Error translation and logging rely on
`logTrashGuideRouteError`, while authentication/authorization is handled globally in
`packages/praxrr-app/src/hooks.server.ts` via `$auth/middleware.ts` (routes inherit 401/redirect
behavior). Consequently, the API surface reuses shared services (`trashGuideManager`,
`trashGuideEntityCacheQueries`, `trashGuideSourcesQueries`, job queue abstractions) without
introducing route-local middleware.

## Database

### Relevant Tables

- **trash_guide_sources**: persistence for every TRaSH repository (name, repository URL, branch,
  local clone path, arr type, score profile, sync strategy, auto-pull, enabled flag, last
  commit/sync timestamps).
- **trash_guide_sync_config**: per-arr-instance × source rows defining sync trigger
  (`none`/`manual`/`on_pull`/`on_change`/`schedule`), cron expression, next-run timestamp, current
  `sync_status`, `last_error`, `last_synced_at`, and a `should_sync` flag.
- **trash_guide_sync_selections**: records each saved selection (section type such as
  `qualityProfiles`/`customFormats`/`qualityDefinitions`/`naming`/`mediaManagement` plus
  `item_name`) for a given arr instance and TRaSH source.
- **trash_guide_entity_cache**: caches parsed TRaSH entities (`custom_format`, `quality_profile`,
  `quality_size`, `naming`) with `trash_id`, `name`, serialized JSON, file path, content hash, and
  fetch timestamp; serves listing APIs and UI.
- **trash_id_mappings**: stores mappings from TRaSH `trash_id` to Arr entity names (grouped by arr
  type and entity type) to detect renames/removals during sync.
- **arr_instances** (referenced via FKs): existing Arr instance catalog that ties
  `trash_guide_sync_config`/`trash_guide_sync_selections` to specific Radarr/Sonarr instances.

### Schema Details

- Migration `20260226_create_trash_guide_tables.ts` creates the TRaSH tables plus indexes:
  `idx_trash_guide_sync_config_next_run_at`, `idx_trash_guide_sync_selections_source_instance`,
  `idx_trash_guide_entity_cache_type`, and `idx_trash_id_mappings_arr_type_trash_id`. It also
  rewrites `pcd_ops` so `source` accepts the new `trashguide` enum value.
- `trash_guide_sources.id` is the FK target for every other TRaSH table (`trash_guide_sync_config`,
  `trash_guide_sync_selections`, `trash_guide_entity_cache`, `trash_id_mappings`) with
  `ON DELETE CASCADE`, ensuring cleanup when sources are deleted.
- `trash_guide_sync_config.instance_id` and `trash_guide_sync_selections.instance_id` reference
  `arr_instances.id`, and every `trashGuideSyncQueries` helper runs
  `assertScope(instanceId, sourceId)` (joining `arr_instances` and `trash_guide_sources`) to ensure
  the arr instance’s `type` equals the source’s `arr_type`, preventing cross-app writes.
- `trash_guide_entity_cache` enforces `UNIQUE (source_id, trash_id, entity_type)` so
  `replaceSourceCache()` can delete all rows for a source and repopulate deterministically; the
  `content_hash` field powers `trashGuideEntityCacheQueries.hasContentChanged()` and the parser
  pipeline to detect updates.
- `trash_guide_sync_config` tracks scheduling metadata (trigger, cron, next run, sync status) used
  by `jobQueueHelpers.scheduleTrashGuideSyncSources()` and `trashGuideSyncHandler`; indexes ensure
  `next_run_at` lookups are efficient.
- `trash_guide_sync_selections` stores every section/item selection; `setSelections()` deduplicates
  entries per `(section_type, item_name)` pair while enforcing non-empty names.
- `trash_id_mappings` stores arr-type-aware mappings so `transformTrashGuideEntities` can return
  diffs (`created`, `renamed`, `removed`) that feed the sync processor; the index on
  `(arr_type, trash_id)` supports quick lookups.

## External Services

- **Git remotes (GitHub/GitLab or any git host)**: each TRaSH source is a git repo cloned under
  `${config.paths.data}/trashguide`. `fetchTrashGuideSource()` wraps `$utils/git` helpers (`clone`,
  `checkout`, `pull`), uses optional PAT credentials for private repos, validates metadata paths
  (`metadata.json`) per source arr type, and surfaces `TrashGuideFetcherError` categories for
  metadata/branch/auth/network problems.
- **TRaSH Guide repositories**: the parser (`parseTrashGuideEntities`) consumes their JSON
  (`custom_formats`, `quality_profiles`, `naming`, etc.) as defined in `metadata.json` and writes
  normalized entities to `trash_guide_entity_cache` and `trash_id_mappings`. Ensuring metadata paths
  exist and arr-type compatibility is central to job success.
- **Radarr/Sonarr instances**: stored via `arr_instances`/`arr_instance_credentials` (API keys
  encrypted with `ARR_CREDENTIAL_MASTER_KEY`). When TRaSH data changes,
  `trashGuideManager.triggerPullSync()` marks matching sync configs and calls
  `$sync/processor.triggerSyncs()`, which in turn uses `arrInstanceClients` to talk to Radarr/Sonarr
  APIs. TRaSH sources supply selection lists that determine what the sync processors push to each
  instance (quality profiles, custom formats, etc.).

## Internal Services

- **trashGuideManager**: orchestrates linking/updating/deleting sources (docker clone path under
  `config.paths.data/trashguide`), runs fetcher/parser/transformer, writes entity cache/mappings,
  ensures sync configs per compatible arr instance, updates sync metadata, and exposes
  `listSources()`, `getSource()`, `createSource()`, `updateSource()`, `deleteSource()`, `sync()`,
  and `checkForUpdates()`.
- **trashGuideEntityCacheQueries / trashIdMappingsQueries / trashGuideSourcesQueries**: server-side
  helpers for inserting/updating cache rows, retrieving entity lists, and keeping sources in sync.
  They are used by the API (`/entities`), manager, transformer, and future listing load functions.
- **trashGuideSyncQueries**: manages `trash_guide_sync_config` & `trash_guide_sync_selections`
  (CRUD, scope enforcement, pending flag, selection writes). The TRaSH UX must call
  `getConfigsByInstance()`, `getSelections()`, and `setSelections()` to align with existing Arr sync
  handlers.
- **Job system (`jobQueueQueries`, `jobDispatcher`, `jobRunHistoryQueries`, `jobQueueRegistry`)**:
  manual sync endpoint and the scheduler both rely on dedupe keys `trashguide.sync:{sourceId}`.
  `scheduleTrashGuideSyncSources()` (used by `jobs/schedule.ts` via `initializeJobs()` in
  `hooks.server.ts`) enqueues recurring syncs, while `trashGuideSyncHandler` validates payloads,
  checks git updates, retries on transient failures, and calls `trashGuideManager.sync()`, writing
  metadata via `trashGuideSourcesQueries.updateSyncMetadata()` and letting `triggerSyncs()` mark Arr
  sync configs pending.
- **Sync processor (`$sync/processor.ts` and section handlers)**: after TRaSH data changes,
  `trashGuideManager.triggerPullSync()` flips `should_sync` and calls
  `triggerSyncs({ event: 'on_pull' })`, which schedules the registered section handlers
  (`qualityProfiles`, `delayProfiles`, `mediaManagement`, `metadataProfiles`) to run against Arr
  instances using stored selections.

## Configuration

- `APP_BASE_PATH`: base of data/log/backups directories; TRaSH clones live under
  `${APP_BASE_PATH}/data/trashguide`.
- `AUTH`: controls global auth mode (on/local/off/oidc) enforced in `hooks.server.ts`; TRaSH routes
  inherit this guard.
- `ARR_CREDENTIAL_MASTER_KEY`, `ARR_CREDENTIAL_MASTER_KEY_VERSION`: decrypt Arr API keys so sync
  processors can talk to Radarr/Sonarr when applying TRaSH selections.
- `PULL_ON_START`, `PULL_ON_START_MAX_CONCURRENCY`, `PULL_ON_START_TIMEOUT_MS`: govern the startup
  pull job (`arr.pull.startup`) queued from `hooks.server.ts`; pull triggers may cascade into TRaSH
  syncs via `triggerSyncs()`.
- `PARSER_HOST`, `PARSER_PORT`: parser service used by other sync sections (even though TRaSH
  parsing is local, these must remain valid for the broader app).
- `packages/praxrr-app/src/lib/server/utils/config/config.ts`: defines the `config.paths` used by
  `TrashGuideManager` (data/logs/backups). Adjusting `APP_BASE_PATH` flows through this singleton.
- `packages/praxrr-app/src/lib/server/jobs/helpers/trashGuideSchedule.ts`: exposes the dedupe key
  logic and scheduling helper reused by both the scheduler and the manual `/sync` endpoint.
- `packages/praxrr-app/src/lib/server/jobs/handlers/trashGuideSync.ts`: canonical sync job handler
  that surfaces auto-pull logic, schedule validation, git update checks, parser/transformer error
  handling, reschedules on transient failures, and reports sync results.
- `packages/praxrr-app/src/lib/server/trashguide/types.ts` +
  `fetcher.ts`/`parser.ts`/`transformer.ts`: define the TRaSH domain model, metadata schema, and how
  parsed entities map to caches/mappings (the UX should align with the selectors/sections the
  transformers populate).
