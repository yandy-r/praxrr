### Executive Summary

The plan should maximize reuse of existing PCD and sync infrastructure while separating backend
plumbing, API exposure, and UI work into parallelizable streams. The critical dependency chain is
transformer correctness before cache-driven sync orchestration. Task design should keep each unit
scoped to 1-3 files and include explicit dependency labels.

### Recommended Phase Structure

#### Phase 1: Foundation and Source Ingestion

- purpose: establish TRaSH source persistence, fetch/parse pipeline, and base operation import path.
- suggested tasks: create migrations + query modules, implement fetcher/parser/types, implement
  initial transformer for custom formats, wire manager lifecycle and source metadata storage.
- parallelization notes: migrations/query modules and fetcher/parser can run in parallel; manager
  wiring waits on both.

#### Phase 2: Expanded Entity Mapping and API Surface

- purpose: support quality profiles/definitions/naming and expose source CRUD/sync/entity listing
  endpoints.
- suggested tasks: extend transformer coverage, add id mapping/cache logic, implement route handlers
  and validation, connect manual sync endpoint to job dispatch.
- dependencies: requires Phase 1 schema and manager foundations.

#### Phase 3: Scheduling, Sync Triggering, and UX Integration

- purpose: complete automated sync scheduling and connect preview/status UX paths.
- suggested tasks: add `trashguide.sync` job type + handler + schedule function, trigger on-pull
  sync events, wire UI status/selection/preview flows, finalize notifications and telemetry hooks.
- integration focus: reuse current `sync/processor` and section registry; avoid alternate sync
  execution paths.

### Task Granularity Guidance

- appropriate task sizes: 1-3 files per task with a single technical objective.
- tasks to split: transformer by entity family (CF/QP/QD/naming), UI by screen (sources, selections,
  previews).
- tasks to combine: queue type + handler registration in same deliverable because they share
  ownership.

### Dependency Analysis

#### Independent Tasks

- schema/query module development and parser type modeling.
- API DTO/validation drafting and UI mock structure.
- test scaffolding for parser/transformer.

#### Sequential Tasks

- migration -> query modules -> manager persistence wiring.
- parser/transformer -> ops import -> cache compile -> sync trigger.
- source CRUD APIs -> selection APIs -> scheduler wiring.

#### Potential Bottlenecks

- shared scheduler and queue files (`jobs/schedule.ts`, `jobs/queueTypes.ts`).
- cache compile/import path correctness and runtime performance.
- mapping consistency for `trash_id` across entities and selections.

### Suggested Task Template

- title format: `trash-guide-sync: <scope>`.
- dependency annotation format: `Depends on [task-id,...]`.
- instruction completeness checklist: objective, touched files, constraints, acceptance criteria,
  and verification target.
