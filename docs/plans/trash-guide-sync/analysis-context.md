### Executive Summary

Trash Guide Sync ingests TRaSH Guides JSON as a dedicated PCD source and reuses existing cache,
preview, and Arr sync infrastructure. The main work is a TRaSH adapter layer (`fetcher`, `parser`,
`transformer`, `manager`, `cache`) plus metadata persistence and job scheduling for
`trashguide.sync`. Planning should phase foundation first (source/linking/CF import), then profile
expansion, then automation and multi-instance polish.

### Architecture Context

- System Structure: Add `packages/praxrr-app/src/lib/server/trashguide/*` modules that produce a
  virtual TRaSH-backed PCD data source and feed existing job/cache/sync layers.
- Data Flow: `trashguide.sync` pulls TRaSH repo updates, parses entities, transforms to PCD base ops
  (`source=trash`), compiles cache, then triggers `triggerSyncs({ event: 'on_pull' })`.
- Integration Points: Initialize manager from startup hooks, register new job type + scheduler
  entry, persist source/sync metadata in new `trash_guide_*` tables, and expose CRUD/sync API
  routes.

### Critical Files Reference

- /packages/praxrr-app/src/hooks.server.ts: startup order and service initialization.
- /packages/praxrr-app/src/lib/server/pcd/core/manager.ts: lifecycle template for TRaSH manager
  behavior.
- /packages/praxrr-app/src/lib/server/jobs/schedule.ts: schedule registration and deduped enqueue
  flow.
- /packages/praxrr-app/src/lib/server/sync/processor.ts: sync orchestration and event-triggered
  execution.
- /packages/praxrr-app/src/lib/server/sync/registry.ts: section registration pattern reused by
  existing sync flow.
- /packages/praxrr-app/src/lib/server/db/queries/arrSync.ts: per-instance sync status and
  selections.
- /docs/plans/trash-guide-sync/research-technical.md: authoritative technical model for new tables
  and workflows.

### Patterns to Follow

- Job scheduling and handler contract: dedupe key + typed `JobHandlerResult`; example
  `/packages/praxrr-app/src/lib/server/jobs/schedule.ts` and
  `/packages/praxrr-app/src/lib/server/jobs/handlers/pcdSync.ts`.
- PCD manager lifecycle: pull/import/compile/trigger pattern; example
  `/packages/praxrr-app/src/lib/server/pcd/core/manager.ts`.
- Typed query modules per table: focused query files with transaction-safe mutations; example
  `/packages/praxrr-app/src/lib/server/db/queries/databaseInstances.ts`.
- Section trigger reuse: feed compiled TRaSH data into current sync sections instead of adding
  parallel sync logic.

### Cross-Cutting Concerns

- Security/perimeter: validate TRaSH metadata and schema; fail-fast for malformed payloads.
- Performance: shallow clone and entity cache to avoid full reparses; monitor cache compile time.
- Testing: mirror existing job-handler tests and verify idempotent import + preview-trigger
  behavior.

### Parallelization Opportunities

- Independent work areas: backend adapter + migrations, API route surface, UI sync
  dashboard/selection updates.
- Coordination hotspots: shared scheduler/queue files, mapping consistency between transformer
  output and preview/sync sections.

### Implementation Constraints

- Arr-type fidelity required: no cross-Arr mapping between Radarr and Sonarr data.
- Stable identity is `trash_id` + `arr_type`; names are not reliable identifiers.
- Must remain PCD-first: TRaSH data enters through ops/cache pipeline, not direct Arr writes.
- Conflict behavior must honor existing `conflict_strategy` model.

### Planning Recommendations

- Organize phases as foundation -> profile expansion -> automation.
- Start with schema + query modules, then adapter pipeline, then scheduling/routes/UI.
- Keep tasks small and file-scoped with explicit dependencies to maximize safe parallelism.
