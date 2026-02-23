# Pattern Research: pull-on-startup

## Architectural Patterns

**Startup Orchestration in One Place**: Praxrr keeps startup sequencing explicit in a single hook file; startup features should be inserted there with clear ordering and failure behavior.

- Example: `/packages/praxrr-app/src/hooks.server.ts`

**Job-Backed Background Work**: Long-running tasks are represented as typed jobs with centralized dispatch, persistence, and run history.

- Example: `/packages/praxrr-app/src/lib/server/jobs/dispatcher.ts`
- Example: `/packages/praxrr-app/src/lib/server/jobs/handlers/pcdSync.ts`

**Dedupe-Key Queueing**: Jobs are upserted by deterministic dedupe keys and dispatcher notifications are centralized.

- Example: `/packages/praxrr-app/src/lib/server/jobs/schedule.ts`
- Example: `/packages/praxrr-app/src/lib/server/db/queries/jobQueue.ts`

**Event-to-Section Fanout**: PCD pull emits sync events and section jobs are queued by trigger policy (`on_pull`, `on_change`, `schedule`).

- Example: `/packages/praxrr-app/src/lib/server/sync/processor.ts`

**Centralized PCD Write Pipeline**: Entity writes use operation writer + compile/validation pipeline instead of direct SQL mutation.

- Example: `/packages/praxrr-app/src/lib/server/pcd/ops/writer.ts`
- Example: `/packages/praxrr-app/src/lib/server/pcd/entities/delayProfiles/update.ts`

**Explicit Arr-Type Guardrails**: Capabilities and mapping dispatch are Arr-specific; unsupported cross-Arr behavior is rejected.

- Example: `/packages/praxrr-app/src/lib/shared/arr/capabilities.ts`
- Example: `/packages/praxrr-app/src/lib/server/sync/mappings.ts`

## Code Conventions

- Server modules use alias imports (`$db`, `$arr`, `$sync`, `$pcd`) and domain-scoped file layout.
- Naming is explicit and verb-oriented (`initializeJobs`, `recoverInterruptedSyncs`, `saveMediaManagementSync`).
- Entity modules are organized by domain and operation (`read/create/update/delete`) under `pcd/entities`.
- Registration patterns are side-effect based for handlers and sync sections.

## Error Handling

- Startup uses mixed criticality: hard-fail for critical invariants (encryption key), warn-and-continue for optional bootstraps.
- Job handlers return structured outcomes (`status`, `output`, `error`) instead of bubbling uncaught exceptions.
- Query/config helpers fail fast on invalid state and preserve explicit invariants.
- Logging uses structured `source` + `meta` with centralized secret sanitization.

## Testing Approach

- Unit tests target matching/mapping helpers and Arr-type semantic guards.
- Integration tests patch DB/query modules and validate queue/handler behavior.
- Existing test style uses deterministic fixtures with patch/restore isolation.
- Startup/pull-related validation should mirror jobs and Arr sync test patterns.

## Patterns to Follow

- Follow startup sequencing and non-blocking behavior from `/packages/praxrr-app/src/hooks.server.ts`.
- Reuse job queue patterns from `/packages/praxrr-app/src/lib/server/jobs/init.ts` and `/packages/praxrr-app/src/lib/server/db/queries/jobQueue.ts` for observability and retries.
- Reuse Arr-type gates from `/packages/praxrr-app/src/lib/server/sync/mappings.ts` and `/packages/praxrr-app/src/lib/shared/arr/capabilities.ts`.
- Persist selection updates through `/packages/praxrr-app/src/lib/server/db/queries/arrSync.ts` instead of introducing parallel state paths.
- Keep writes and validation in existing PCD pathways where entity-level updates are needed.
