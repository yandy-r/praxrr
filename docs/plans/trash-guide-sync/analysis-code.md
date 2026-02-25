### Executive Summary

The codebase already has the lifecycle needed for TRaSH sync: manager-driven ingestion, job
scheduling/dispatch, cache compilation, and section-based Arr sync execution. Implementation should
add a TRaSH adapter service and new persistence/query modules while reusing `sync/processor` and
existing section handlers. The highest-risk areas are mapping stability (`trash_id`), Arr-type
isolation, and scheduler integration in shared files.

### Related Components

- /packages/praxrr-app/src/lib/server/pcd/core/manager.ts: source lifecycle template.
- /packages/praxrr-app/src/lib/server/pcd/database/cache.ts: compiled cache behavior and SQL replay.
- /packages/praxrr-app/src/lib/server/jobs/schedule.ts: scheduling entrypoint and dedupe semantics.
- /packages/praxrr-app/src/lib/server/jobs/handlers/pcdSync.ts: handler result/error pattern to
  mirror.
- /packages/praxrr-app/src/lib/server/jobs/queueTypes.ts: job union requiring `trashguide.sync`.
- /packages/praxrr-app/src/lib/server/sync/processor.ts: event-driven sync orchestration.
- /packages/praxrr-app/src/lib/server/sync/registry.ts: section registration and dispatch.
- /packages/praxrr-app/src/lib/server/db/queries/databaseInstances.ts: query module conventions.

### Implementation Patterns

**PCD-First Adapter**: Convert TRaSH JSON entities to portable/PCD ops and run through normal
compile/sync flow.

- Example: /docs/plans/trash-guide-sync/feature-spec.md:9
- Apply to: transformer, import path, cache integration.

**Job Scheduling + Handler Contract**: Add schedule helper and handler returning typed
status/reschedule output.

- Example: /packages/praxrr-app/src/lib/server/jobs/schedule.ts:18
- Apply to: scheduled sync and manual sync trigger.

**Section Registry Reuse**: Do not add parallel sync logic; feed new data into existing registered
sections.

- Example: /packages/praxrr-app/src/lib/server/sync/registry.ts:1
- Apply to: processor integration, preview path.

**Typed Query Modules**: One query module per new table with transactional writes.

- Example: /packages/praxrr-app/src/lib/server/db/queries/databaseInstances.ts:1
- Apply to: source metadata, selections, entity cache, id mapping persistence.

### Integration Points

#### Files to Create

- /packages/praxrr-app/src/lib/server/trashguide/index.ts: module exports.
- /packages/praxrr-app/src/lib/server/trashguide/manager.ts: lifecycle orchestration for TRaSH
  source.
- /packages/praxrr-app/src/lib/server/trashguide/fetcher.ts: git pull/clone and source read.
- /packages/praxrr-app/src/lib/server/trashguide/parser.ts: TRaSH JSON parsing and validation.
- /packages/praxrr-app/src/lib/server/trashguide/transformer.ts: TRaSH-to-PCD transformation.
- /packages/praxrr-app/src/lib/server/trashguide/cache.ts: cached parsed entity state.
- /packages/praxrr-app/src/lib/server/trashguide/types.ts: strict TRaSH types.
- /packages/praxrr-app/src/lib/server/db/queries/trashGuideSources.ts: source query helpers.
- /packages/praxrr-app/src/lib/server/db/queries/trashGuideSync.ts: sync config/selections query
  helpers.
- /packages/praxrr-app/src/lib/server/db/queries/trashGuideEntityCache.ts: entity cache query
  helpers.
- /packages/praxrr-app/src/lib/server/db/queries/trashIdMappings.ts: `trash_id` lookup helpers.
- /packages/praxrr-app/src/lib/server/jobs/handlers/trashGuideSync.ts: sync job handler.
- /packages/praxrr-app/src/routes/api/v1/trash-guide/sources/+server.ts: source list/create.
- /packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/+server.ts: source
  update/delete/get.
- /packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/sync/+server.ts: manual sync
  trigger.
- /packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/entities/+server.ts: entity
  listing.
- /packages/praxrr-app/src/lib/server/db/migrations/YYYYMMDD_create_trash_guide_tables.ts: table
  creation.

#### Files to Modify

- /packages/praxrr-app/src/lib/server/jobs/queueTypes.ts: add `trashguide.sync` type.
- /packages/praxrr-app/src/lib/server/jobs/schedule.ts: schedule helper for TRaSH sources.
- /packages/praxrr-app/src/lib/server/jobs/handlers/index.ts: register TRaSH handler.
- /packages/praxrr-app/src/hooks.server.ts: initialize TRaSH manager at startup.
- /packages/praxrr-app/src/lib/server/db/migrations.ts: include new migration.
- /packages/praxrr-app/deno.json: add `$trashguide/` alias.

### Conventions

- naming: keep `arr_type` explicit and include `trash_id` in identity handling.
- error handling: fail-fast validation with clear status codes and no silent fallback behavior.
- testing: target unit tests for parser/transformer and handler-level tests for scheduling + sync
  result paths.

### Gotchas and Warnings

- Never map TRaSH data across Arr families implicitly.
- Preserve stable identity with `trash_id`; CF names can change.
- Respect import ordering where profiles depend on custom formats.
- Handle missing score profiles (default score fallback) deterministically.
- Protect scheduler shared files from regressions by isolating new branches.

### Task Guidance by Area

- database: build `trash_guide_*` tables, indexes, and query modules first.
- api: add `/api/v1/trash-guide/sources*` CRUD/sync/list routes using typed query modules.
- ui: plan dashboard/selection/preview integration after API contracts are stable.
