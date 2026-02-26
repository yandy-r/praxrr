# Business Logic Research: trash-guide-sync

## Executive Summary

Praxrr already has a mature, battle-tested pipeline for pulling config data from PCD git
repositories, compiling it into an in-memory SQLite cache, and pushing it to Arr instances (Radarr,
Sonarr, Lidarr) via a job queue with cron/event triggers and bounded concurrency. A "TRaSH Guides
sync" feature would add a second upstream data source alongside the existing PCD repos. The core
business value is enabling self-hosters to adopt TRaSH-recommended custom formats, quality profiles,
naming, and quality definitions without manually transcribing settings -- in a way that integrates
with (rather than replaces) Praxrr's existing PCD ops model, user-override layer, and multi-instance
multi-database sync infrastructure.

## User Stories

### Primary User: Self-Hoster

- As a self-hoster, I want to **import TRaSH Guide recommended custom formats** into my PCD so that
  I get curated quality scoring without manually copying dozens of format definitions.
- As a self-hoster, I want to **import TRaSH Guide quality profiles** (e.g. "Remux + WEB 1080p") so
  I can get a battle-tested quality hierarchy and score configuration out of the box.
- As a self-hoster, I want to **import TRaSH Guide quality definitions** (size limits per quality)
  so my instances reject unreasonably large or small files.
- As a self-hoster, I want to **import TRaSH Guide naming conventions** so my library follows
  standardized, Plex/Emby/Jellyfin-friendly file naming.
- As a self-hoster, I want **scheduled auto-sync from TRaSH Guides** so that when the guide
  maintainers update a custom format regex or add a new CF, my instances automatically get those
  changes.
- As a self-hoster, I want to **preview what changes will be applied** before a TRaSH Guide sync
  pushes to my Arr instances, so I can verify nothing unexpected will happen.
- As a self-hoster, I want to **sync TRaSH Guide data to multiple Arr instances** (e.g. my 1080p
  Radarr and 4K Radarr) selectively.

### Secondary User: Power User

- As a power user, I want to **override specific TRaSH-sourced settings** (e.g. tweak a CF score)
  and have my overrides preserved when the guide updates upstream.
- As a power user, I want to **cherry-pick which TRaSH Guide entities to import** rather than take
  everything -- for example, import only the "Unwanted" CF group but not the "HDR" group.
- As a power user, I want to **combine TRaSH Guide data with my own PCD database** so TRaSH provides
  the base and I layer custom tweaks on top.
- As a power user, I want to **see conflict resolution** when a TRaSH update changes something I
  have overridden, with options to keep my override, accept the upstream change, or be asked each
  time.
- As a power user, I want to **run TRaSH Guide sync independently from PCD sync** -- they are
  separate upstream sources with potentially different schedules.

## Business Rules

### Core Rules

1. **TRaSH Guide data is a PCD data source, not a bypass**
   - TRaSH Guide JSON data must be ingested through the existing PCD ops pipeline (as base ops in a
     TRaSH-backed database_instance), not pushed directly to Arr instances.
   - Validation: All TRaSH data must pass through cache compilation before sync.
   - Exception: None. This ensures user ops, conflict detection, and preview infrastructure all
     work.

2. **TRaSH Guide data is keyed by `trash_id`**
   - Each TRaSH custom format and quality profile has a stable `trash_id` (hex hash). This must be
     stored as the stable identity key so updates are matched correctly across guide revisions.
   - Validation: Import rejects entities missing `trash_id`.
   - Exception: Quality definitions and naming configs do not use `trash_id` (they are singleton per
     arr_type).

3. **Arr-type specificity is mandatory**
   - TRaSH Guide data is organized by Arr type (Radarr vs Sonarr). Data for one Arr type must never
     be applied to another.
   - Validation: Each entity import must carry its `arr_type` and fail-fast if the target instance
     type does not match.
   - Exception: None. This aligns with the Cross-Arr Semantic Validation Policy in CLAUDE.md.

4. **User ops always win (override strategy)**
   - When TRaSH Guide updates conflict with existing user ops, the `conflict_strategy` on the
     database_instance governs behavior: `override` (re-create user op with new values), `align`
     (drop user op, accept upstream), `ask` (mark as `conflicted_pending`).
   - Validation: Conflict detection must use the existing PCD value-guard system.
   - Exception: None -- this reuses the existing PCD conflict architecture.

### Sync Scheduling Rules

1. **TRaSH Guide pull is a `pcd.sync` job**
   - The TRaSH Guide repository is linked as a `database_instance` with a git repository URL
     pointing to the TRaSH Guides repo (or a derived/transformed repo).
   - The existing `pcd.sync` job type, `sync_strategy` (interval in minutes), and `auto_pull` flag
     govern when TRaSH data is fetched.

2. **Downstream Arr sync uses existing `on_pull` trigger**
   - After a TRaSH Guide PCD sync completes, it triggers
     `triggerSyncs({ event: 'on_pull', databaseId })`, which fans out to all Arr instances
     configured with `on_pull` or `on_change` triggers.
   - This is already implemented in `PCDManager.sync()` via `this.triggerPullSync(databaseId)`.

3. **Independent scheduling per database**
   - TRaSH Guide database can have a different `sync_strategy` (e.g. every 360 minutes) than other
     PCD databases.
   - Multiple TRaSH databases are supported (e.g. one for Radarr guides, one for Sonarr).

### Conflict Resolution Rules

1. **Three strategies, per-database configurable**
   - `override`: Automatically regenerate user ops to match TRaSH upstream (user intent preserved,
     values updated).
   - `align`: Drop conflicting user ops, accept upstream as authoritative.
   - `ask`: Mark ops as `conflicted_pending`, surface in UI for manual resolution.

2. **Value guards detect conflicts**
   - The existing `evaluateValueGuardApply` / `evaluateValueGuardError` system in `cache.ts` already
     handles detecting when a user op's `WHERE old_value = ...` guard does not match the current
     compiled state. This mechanism works identically for TRaSH-sourced base ops.

3. **Group-level conflict resolution**
   - Operations created as a group (sharing a `groupId` in metadata) are resolved together. A
     conflict in one member conflicts the whole group.

### Multi-Instance Rules

1. **Per-instance section selection**
   - Each Arr instance independently selects which quality profiles (by name from PCD cache), delay
     profiles, naming configs, and quality definitions to sync from which database.
   - A single Arr instance can sync quality profiles from a TRaSH-backed database and delay profiles
     from a custom PCD database simultaneously.

2. **Namespace isolation for multi-database sync**
   - When multiple databases provide entities to the same Arr instance, the existing
     `arr_database_namespaces` table and invisible zero-width Unicode suffix system (`namespace.ts`)
     prevents name collisions.

3. **Instance concurrency limit is 3**
   - `processPendingSyncs` processes at most `CONCURRENCY_LIMIT = 3` instances in parallel, with
     sequential section processing within each instance.

### Edge Cases

- **TRaSH Guide repo structure changes**: If the TRaSH Guides team reorganizes their JSON structure,
  the importer must fail with clear errors rather than silently importing corrupted data. The
  manifest validation step catches this.
- **Partial guide availability**: If only Radarr custom formats are available but Sonarr ones are
  missing, the importer should succeed for available data and log warnings for missing data.
- **trash_id collision across arr_types**: The same `trash_id` can theoretically exist in both
  Radarr and Sonarr guides with different semantics. The stable identity key must include `arr_type`
  alongside `trash_id`.
- **Guide deprecation**: When TRaSH marks a custom format as deprecated/removed, the base op for it
  should be orphaned (existing `markBaseOrphaned` logic), and cleanup scan (`cleanup.ts`) should
  detect stale CFs on Arr instances.
- **Rate-limited GitHub API**: The existing git clone/pull infrastructure already handles GitHub API
  rate limiting with fallback to direct git operations.

## Workflows

### Primary Workflow: Scheduled Sync

1. **pcd.sync job fires** (`pcdSync.ts` handler, scheduled by `schedulePcdSyncForDatabase`).
2. Handler calls `pcdManager.sync(databaseId)`.
3. `PCDManager.sync()` calls `checkForUpdates()` (git fetch + rev-list).
4. If updates available: `pull()` -> `syncDependencies()` -> `importBaseOps()` (YAML entity
   deserialization) -> `seedBuiltInBaseOps()` -> `compile()` (rebuild in-memory SQLite cache).
5. After compile: `triggerPullSync(databaseId)` -> `triggerSyncs({ event: 'on_pull' })`.
6. `triggerSyncs` fans out: for each Arr instance with `on_pull` trigger, enqueue per-section sync
   jobs.
7. Each section sync job: `handler.claimSync()` -> `syncer.sync()` (fetch from PCD cache, transform
   to Arr API format, push to Arr instance) -> `handler.completeSync()`.

### Secondary Workflow: On-Demand Sync

1. User clicks "Sync Now" in UI.
2. API endpoint calls `executeSyncJob(instanceId, sections, 'manual')`.
3. Same flow as step 7 above, but bypasses trigger/schedule checks.

### Setup Workflow: First-Time TRaSH Guide Configuration

1. User navigates to Databases page and clicks "Link Database".
2. User enters TRaSH Guides repo URL (or a Praxrr-maintained derivative), name, branch, and sync
   strategy.
3. `pcdManager.link()` is called: clone -> validate manifest -> process dependencies -> import base
   ops -> compile cache.
4. User navigates to Arr Instance sync settings.
5. User selects quality profiles and other entities from the TRaSH-backed database to sync.
6. User sets trigger (on_pull, on_change, schedule with cron, or manual).
7. Sync executes on next trigger or immediate manual trigger.

### Workflow: Preview Before Sync

1. User clicks "Preview" button on instance sync page.
2. API calls `generateInstancePreview(instanceId, sections)`.
3. Preview orchestrator creates read-only syncer instances, calls `generatePreview()` on each.
4. Each syncer fetches current Arr state and desired PCD state, computes diff.
5. Returns `SyncPreviewResult` with per-entity `EntityChange` (create/update/delete/unchanged) and
   `FieldChange` details.
6. UI shows diff. User clicks "Apply" to execute actual sync.

### Error Recovery

- **Failed PCD sync (git error)**: Job reschedules with backoff via `rescheduleAt`. Instance
  `last_synced_at` is not updated. Next scheduled run retries.
- **Failed Arr sync (API error)**: Section handler calls `failSync(instanceId, error)`.
  `sync_status` set to `'failed'`, `last_error` recorded. Job history records failure. User can
  retry via manual sync.
- **Failed cache compile**: `compileIfEnabled` logs error. If `failOnError=true` (during sync), sync
  result is `success: false`. Existing cache remains from last successful compile.
- **Interrupted syncs on restart**: `jobQueueQueries.recoverRunning()` resets in-flight jobs to
  `queued` status. `recoverInterruptedSyncs()` resets `in_progress` sync statuses back to `idle`.
- **Credential failure during Arr sync**: `arrSyncHandler` detects credential errors, auto-disables
  the instance, and returns a clear error message.

## Domain Model

### Key Entities

1. **database_instance** (`database_instances` table)
   - Represents a linked PCD repository (either custom or TRaSH-backed).
   - Key fields: `uuid`, `repository_url`, `local_path`, `sync_strategy`, `auto_pull`,
     `conflict_strategy`.
   - A TRaSH Guide source would be a database_instance with `repository_url` pointing to the TRaSH
     Guides repo (or a derivative).

2. **pcd_ops** (`pcd_ops` table)
   - Append-only operation log. Each entity (CF, QP, etc.) is represented as SQL ops.
   - `origin`: `base` (from repo/TRaSH) or `user` (local overrides).
   - `state`: `published`, `draft`, `superseded`, `dropped`, `orphaned`.
   - `source`: `repo` (from git), `local` (user-created), `import` (from entity YAML/JSON
     ingestion).
   - `content_hash`: For dedup and change detection.
   - `last_seen_in_repo_at`: For orphan detection when upstream removes an entity.

3. **PCDCache** (in-memory SQLite, `cache.ts`)
   - Compiled view of all ops for a database. Tables match PCD schema (quality_profiles,
     custom_formats, etc.).
   - Rebuilt on every sync/compile. Syncers read from cache, never from raw ops.

4. **arr_sync_quality_profiles** / **arr*sync*\*\_config** tables
   - Per-instance sync selections and trigger configuration.
   - `arr_sync_quality_profiles`: Many-to-many linking instance -> database -> profile_name.
   - Each config table has: `trigger`, `cron`, `sync_status`, `last_error`, `last_synced_at`.

5. **arr_database_namespaces** table
   - Per-(instance, database) namespace index for multi-database sync.
   - Invisible zero-width Unicode suffixes prevent name collisions.

6. **Section types** (sync pipeline)
   - `qualityProfiles`, `delayProfiles`, `mediaManagement`, `metadataProfiles`.
   - Each has: handler (registry), syncer (BaseSyncer subclass), transformer (PCD -> Arr API
     format).

### State Transitions

**PCD Sync Status** (per database_instance):

```
manual_or_scheduled -> checking_for_updates -> (no updates) -> idle
manual_or_scheduled -> checking_for_updates -> pulling -> importing_ops -> compiling_cache -> triggering_arr_syncs -> idle
```

**Arr Sync Status** (per instance per section, `sync_status` column):

```
idle -> pending (trigger fires / manual) -> in_progress (claimed) -> idle (success) OR failed (error)
```

**PCD Op States**:

```
published (active) -> superseded (replaced by newer op) -> dropped (user/align resolution)
published -> orphaned (upstream removed the entity)
```

**Job Queue States**:

```
queued -> running (claimed by dispatcher) -> success/failed/cancelled
queued -> running -> queued (rescheduled via rescheduleAt)
```

## Existing Codebase Integration

### Related Features (components that already solve the hard problems)

- `/packages/praxrr-app/src/lib/server/pcd/core/manager.ts`: `PCDManager.link()`, `.sync()`,
  `.initialize()` -- full PCD lifecycle orchestration. A TRaSH Guide repo is just another linked
  database.
- `/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`: YAML entity ingestion pipeline.
  Reads entity files from repo, deserializes into SQL ops, writes to `pcd_ops`, compiles cache.
  TRaSH JSON data needs an analogous deserializer.
- `/packages/praxrr-app/src/lib/server/pcd/database/cache.ts`: `PCDCache.build()` -- executes all
  ops in layer order (schema -> base -> tweaks -> user) into in-memory SQLite. Conflict detection
  via value guards happens here.
- `/packages/praxrr-app/src/lib/server/sync/processor.ts`: `processPendingSyncs()`,
  `triggerSyncs()`, `syncInstance()` -- orchestrates pushing PCD data to Arr instances.
- `/packages/praxrr-app/src/lib/server/sync/registry.ts`: Section handler registry pattern --
  extensible for new sync section types.
- `/packages/praxrr-app/src/lib/server/jobs/dispatcher.ts`: Timer-based job dispatcher with
  claim-based concurrency control.
- `/packages/praxrr-app/src/lib/server/jobs/schedule.ts`: `schedulePcdSyncForDatabase()` -- already
  schedules periodic PCD pulls.
- `/packages/praxrr-app/src/lib/server/jobs/handlers/pcdSync.ts`: PCD sync job handler -- checks for
  updates, auto-pulls if enabled, reschedules.
- `/packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`: Preview generation with
  per-section diff computation.
- `/packages/praxrr-app/src/lib/server/pcd/conflicts/`: Override and align conflict resolution
  strategies.
- `/packages/praxrr-app/src/lib/server/sync/namespace.ts`: Multi-database namespace isolation via
  zero-width Unicode suffixes.
- `/packages/praxrr-app/src/lib/server/sync/cleanup.ts`: Stale entity detection and deletion for Arr
  instances.
- `/packages/praxrr-app/src/lib/server/utils/git/write.ts`: Git clone, pull, fetch, checkout
  operations.
- `/packages/praxrr-app/src/lib/server/pcd/git/dependencies.ts`: Dependency resolution (schema
  cloning, version checking).

### Patterns to Follow

- **BaseSyncer pattern**: Each sync section extends `BaseSyncer` with `fetchFromPcd()`,
  `transformToArr()`, `pushToArr()`. TRaSH data flows through the same cache, so existing syncers
  work without modification.
- **SectionHandler registry**: Register handlers at import time via `registerSection()`. Each
  handler provides claim/complete/fail state machine, pending detection, and config checks.
- **Job queue pattern**: Jobs are records in `job_queue` with `dedupe_key` for idempotency,
  `cooldown_until` for rate limiting, and `rescheduleAt` for periodic rescheduling.
- **pcd_ops append-only pattern**: Write new ops rather than mutating existing ones. Use `state`
  transitions (`published` -> `superseded`/`dropped`/`orphaned`) for lifecycle.
- **Entity ingestion pattern** (`importBaseOps.ts`): Read entity source files -> validate stable
  identity conflicts -> compile intermediate cache -> deserialize each entity into SQL ops via
  `writeOperation` -> recompile final cache.
- **Conflict detection pattern** (`cache.ts`): Value guards in SQL ops check
  `WHERE column = old_value`. If the guard fails during cache build, the op is recorded as
  `conflicted` in `pcd_op_history`.

### Components to Leverage

1. **PCDManager** -- Link TRaSH repo as a database_instance; `sync()` handles git pull + base op
   import + cache compile + trigger downstream syncs.
2. **importBaseOps** -- Extend or create a parallel ingestion path for TRaSH JSON format (the
   current one reads YAML entity files from `entities/` directory).
3. **PCDCache.build()** -- No modifications needed; TRaSH data becomes base ops that compile like
   any other.
4. **triggerSyncs / processPendingSyncs** -- No modifications needed; the fan-out from PCD sync to
   Arr sync is already implemented.
5. **Job queue + scheduler** -- `schedulePcdSyncForDatabase()` already handles the TRaSH database
   scheduling.
6. **Preview orchestrator** -- Works out-of-the-box since it reads from compiled PCD cache.
7. **Conflict resolution** -- Override/align/ask strategies are already implemented per-database.
8. **Cleanup** -- `scanForStaleItems()` / `deleteStaleItems()` already detect and remove entities
   not in sync selections.

## Success Criteria

- [ ] Self-hoster can link a TRaSH Guides repository (or Praxrr derivative) as a PCD database
      instance.
- [ ] TRaSH custom formats, quality profiles, quality definitions, and naming configs are ingested
      as base ops in `pcd_ops`.
- [ ] `trash_id` is used as the stable identity key for all TRaSH-sourced entities.
- [ ] Scheduled auto-sync pulls TRaSH Guide updates on a configurable interval.
- [ ] After TRaSH sync, configured Arr instances automatically receive updated settings via
      `on_pull` trigger.
- [ ] User can preview changes before sync via the existing preview system.
- [ ] User ops (overrides) survive TRaSH Guide updates, with conflicts handled per
      `conflict_strategy`.
- [ ] Multi-instance sync works: different instances can sync different TRaSH profiles.
- [ ] Arr-type validation prevents cross-Arr misapplication of TRaSH data.
- [ ] Stale TRaSH entities (removed from guide) are detected and cleaned up.
- [ ] Feature works for Radarr and Sonarr at minimum; Lidarr if TRaSH Guides covers it.
- [ ] No modification required to existing sync pipeline (processor, registry, handlers, preview).

## Open Questions

- **Direct TRaSH repo vs derivative**: Should Praxrr consume the raw TRaSH Guides GitHub repo
  directly (requires parsing their JSON format) or a Praxrr-maintained derivative repo that
  pre-converts TRaSH data into PCD-compliant entity YAML? A derivative simplifies the ingestion but
  adds a maintenance burden.
- **Granularity of TRaSH entity selection**: Recyclarr allows selecting individual CFs by
  `trash_id`. Should Praxrr allow per-CF selection, or only offer TRaSH-defined groups/profiles as
  atomic units?
- **TRaSH Guide versioning**: TRaSH Guides uses a `trash_id` + revision system. Should Praxrr track
  the TRaSH revision alongside the `trash_id` for finer-grained conflict detection?
- **Quality score groups**: Recyclarr has a concept of CF score groups (e.g. "Unwanted", "HDR
  Formats", "Audio Advanced"). Should Praxrr expose these as first-class selection units in the UI?
- **Default auto-link for TRaSH**: Should new Praxrr installations automatically link a TRaSH Guides
  database (similar to how `PRAXRR_DEFAULT_DB_URL` auto-links the Praxrr-DB), or require explicit
  user opt-in?
- **Backwards compatibility with existing PCD workflows**: If a user already has custom formats
  defined in their PCD that overlap with TRaSH CFs, what happens when they also link TRaSH? Should
  the system detect and merge overlapping entities, or force the user to choose one source?
