# Pattern Research: trash-guide-sync

## Architectural Patterns

**Job scheduling + handler/reschedule loop**: Scheduled work is driven by dedicated `schedule*`
helpers that dedupe by `dedupeKey`, compute the next `runAt`, and notify the dispatcher, while the
matching handler validates the payload, checks whether the job is due, calls the sync manager, and
returns a `JobHandlerResult` with `status`/`output`/`rescheduleAt` so retries/auto-skip logic stay
in sync with the queue.

- Example: `packages/praxrr-app/src/lib/server/jobs/schedule.ts:18`
- Example: `packages/praxrr-app/src/lib/server/jobs/handlers/pcdSync.ts:1`

**PCD manager + sync processor / section registry**: `PCDManager` orchestrates clone/pull, manifest
validation, dependency processing, ops import, cache compile, and finally calls `triggerSyncs`,
while the sync processor evaluates scheduled configs, gathers pending sections from the registry,
and streams `triggerSyncs({ event: 'on_pull' })` so section handlers run sequentially per instance.

- Example: `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:1`
- Example: `packages/praxrr-app/src/lib/server/sync/processor.ts:1`
- Example: `packages/praxrr-app/src/lib/server/sync/registry.ts:1`

## Code Conventions

- **Typed query modules**: Each table has a `<table>Queries` export that defines row types, accepts
  camelCase inputs, emits snake_case SQL, and wraps mutations inside explicit transactions to roll
  back on failure.
  - Example: `packages/praxrr-app/src/lib/server/db/queries/databaseInstances.ts:1`

- **Lightweight, type-safe helpers**: Helpers prefer `import type` for interfaces, `const`
  functions, and `as const` arrays to keep inferred tuples narrow before passing to shared
  utilities.
  - Example: `packages/praxrr-app/src/lib/server/jobs/schedule.ts:1`

## Error Handling

- **Job handlers log + translate failures**: `pcd.sync` wraps the entire flow in `try/catch`, logs
  the error with metadata, and normalizes the response into a `JobHandlerResult` to surface
  `status`, `error`, and `rescheduleAt`.
  - Example: `packages/praxrr-app/src/lib/server/jobs/handlers/pcdSync.ts:42`

- **Managers roll back partial work**: `PCDManager.link` and friends catch errors during
  clone/insert/compile, delete any partially created DB row, remove the local clone, and rethrow
  after logging so callers can report upstream.
  - Example: `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:41`

## Testing Approach

Job-handler tests import the handler file for side-effect registration, stub `config` plus query
helpers via patch/restore helpers, fabricate job records, and assert that the handler returns the
expected `JobHandlerResult` (skipped, failure, etc.) while keeping resource sanitization off to
allow shared globals.

- Example: `packages/praxrr-app/src/tests/jobs/pullOnStartupJob.test.ts:1`

## Patterns to Follow

- **Section handler + event trigger**: The research doc explicitly calls out reusing the section
  handler registry/trigger flow (`docs/plans/trash-guide-sync/research-technical.md:419`), so any
  TRaSH-based section should call `registerSection()` and let `triggerSyncs` drive downstream work
  rather than reinventing the fan-out.
  - Example: `packages/praxrr-app/src/lib/server/sync/registry.ts:35`
  - Example: `packages/praxrr-app/src/lib/server/sync/processor.ts:1`

- **Job handler contract + registration**: Align with the documented job-handler pattern
  (`docs/.../research-technical.md:423`) by returning `JobHandlerResult`, handling `rescheduleAt`,
  and importing the handler from `jobs/handlers/index.ts` so it registers on startup.
  - Example: `packages/praxrr-app/src/lib/server/jobs/handlers/pcdSync.ts:1`
  - Example: `packages/praxrr-app/src/lib/server/jobs/handlers/index.ts:1`

- **PCD manager lifecycle**: Treat the TRaSH manager like an analog of `PCDManager`
  (link/unlink/sync + cache triggers) per the doc’s guidance (`docs/.../research-technical.md:425`).
  - Example: `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:1`

- **Query-module pattern**: New tables get a `<table>Queries` module with typed operations, prepared
  SQL, and helper methods as described in the doc (`docs/.../research-technical.md:427`).
  - Example: `packages/praxrr-app/src/lib/server/db/queries/databaseInstances.ts:1`

- **Event trigger reuse**: Documented advice (`docs/.../research-technical.md:431`) is to call
  `triggerSyncs({ event: 'on_pull' })` after the data refresh; that happens inside the sync
  processor, so the TRaSH manager should simply call `triggerSyncs` instead of copying its logic.
  - Example: `packages/praxrr-app/src/lib/server/sync/processor.ts:1`

By following these concrete patterns, the TRaSH sync feature stays consistent with the rest of the
codebase while reusing the existing job, query, manager, and sync ecosystems.
