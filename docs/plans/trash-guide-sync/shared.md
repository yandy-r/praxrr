# Trash Guide Sync

Trash Guide Sync should plug into Praxrr's existing PCD-first lifecycle instead of creating a
parallel sync path. The core flow is TRaSH repo pull and parse, transformation into PCD-compatible
operations, cache compilation, then standard Arr sync triggering through existing section handlers.
`PCDManager`, the sync processor, and the job scheduler already provide most orchestration points
needed for this feature. The implementation focus is a TRaSH-specific adapter layer and metadata
persistence that reuses current scheduling, preview, and sync execution behavior.

## Relevant Files

- /packages/praxrr-app/src/hooks.server.ts: Startup bootstrapping and subsystem initialization
  order.
- /packages/praxrr-app/src/lib/server/pcd/core/manager.ts: PCD lifecycle orchestration and sync
  trigger handoff.
- /packages/praxrr-app/src/lib/server/pcd/database/cache.ts: In-memory cache build and SQL replay
  behavior.
- /packages/praxrr-app/src/lib/server/sync/processor.ts: Arr sync orchestration and event-driven
  section execution.
- /packages/praxrr-app/src/lib/server/sync/registry.ts: Section handler registration and lookup
  mechanism.
- /packages/praxrr-app/src/lib/server/jobs/schedule.ts: Job scheduling helpers and deduped enqueue
  behavior.
- /packages/praxrr-app/src/lib/server/jobs/queueTypes.ts: Job type contract for dispatcher
  integration.
- /packages/praxrr-app/src/lib/server/jobs/handlers/pcdSync.ts: Canonical job handler result/error
  handling pattern.
- /packages/praxrr-app/src/lib/server/db/queries/databaseInstances.ts: Typed query module and
  transactional query conventions.
- /packages/praxrr-app/src/lib/server/db/queries/arrSync.ts: Per-instance sync state and selection
  persistence.
- /packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts: Existing import-to-ops entrypoint
  for portable entities.
- /packages/praxrr-app/src/routes/api/v1/arr/cleanup/+server.ts: Existing Arr client route patterns
  and request handling.

## Relevant Tables

- database_instances: Linked source metadata, sync strategy, and lifecycle status.
- pcd_ops: Base/user operations store used for cache compilation.
- arr_sync_quality_profiles: Per-instance quality profile sync selections and status.
- arr_sync_quality_profiles_config: Trigger/schedule settings for quality profile sync.
- arr_sync_media_management: Per-instance media management sync selections and status.
- arr_sync_media_management_config: Trigger/schedule settings for media management sync.
- arr_database_namespaces: Namespace isolation to prevent multi-source naming collisions.
- trash_guide_sources: Planned TRaSH source metadata and git tracking state.
- trash_guide_sync_config: Planned per-instance TRaSH trigger/schedule settings.
- trash_guide_sync_selections: Planned per-section and per-item TRaSH selections.
- trash_guide_entity_cache: Planned parsed TRaSH JSON cache and change detection.

## Relevant Patterns

**Job Scheduling + Handler Contract**: Schedule helpers enqueue deduped jobs, handlers return typed
status/output/reschedule results. See
[/packages/praxrr-app/src/lib/server/jobs/schedule.ts](/packages/praxrr-app/src/lib/server/jobs/schedule.ts)
and
[/packages/praxrr-app/src/lib/server/jobs/handlers/pcdSync.ts](/packages/praxrr-app/src/lib/server/jobs/handlers/pcdSync.ts).

**PCD Manager Lifecycle**: Managers coordinate pull/import/compile then trigger downstream Arr sync
events. Example:
[/packages/praxrr-app/src/lib/server/pcd/core/manager.ts](/packages/praxrr-app/src/lib/server/pcd/core/manager.ts).

**Section Registry Flow**: Sync behavior is routed through registered section handlers rather than
hard-coded branching. See
[/packages/praxrr-app/src/lib/server/sync/registry.ts](/packages/praxrr-app/src/lib/server/sync/registry.ts)
and
[/packages/praxrr-app/src/lib/server/sync/processor.ts](/packages/praxrr-app/src/lib/server/sync/processor.ts).

**Typed Query Modules**: Each table gets a dedicated typed query module with transaction-scoped
mutations. Example:
[/packages/praxrr-app/src/lib/server/db/queries/databaseInstances.ts](/packages/praxrr-app/src/lib/server/db/queries/databaseInstances.ts).

## Relevant Docs

**/docs/plans/trash-guide-sync/feature-spec.md**: You _must_ read this when working on overall
architecture, business rules, and feature scope.

**/docs/plans/trash-guide-sync/research-technical.md**: You _must_ read this when implementing
fetch/parse/transform/cache/job integration.

**/docs/plans/trash-guide-sync/research-recommendations.md**: You _must_ read this when deciding
phasing, tradeoffs, and risk mitigations.

**/docs/plans/trash-guide-sync/research-external.md**: You _must_ read this when mapping TRaSH
schemas and upstream repository structure.

**/docs/plans/trash-guide-sync/research-ux.md**: You _must_ read this when building sync dashboards,
preview flows, and error states.

**/research/data-schema/synthesis/technical-design.md**: You _must_ read this when designing
TRaSH-to-PCD field mappings and adapter logic.
