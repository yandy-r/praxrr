### Executive Summary

- Plan the work in three phases: contract alignment, runtime pipeline integration, and
  verification/operationalization.
- Keep tasks scoped to one subsystem where possible and annotate explicit dependencies to maximize
  safe parallel execution.
- Treat value-guard validation as the hard gate before rollout.

### Recommended Phase Structure

#### Phase 1: Migration Model and Contract Alignment

- purpose: lock down hybrid payload contract and migration expectations before runtime wiring.
- suggested tasks:
  - align portable schemas and OpenAPI docs for migration metadata.
  - update serialize/deserialize portability contract.
  - prepare migration runbook skeleton and verification criteria.
- parallelization notes: schema, serializer/deserializer updates, and docs drafting can proceed in
  parallel after payload shape agreement.

#### Phase 2: Runtime Migration Pipeline

- purpose: integrate hybrid source ingestion/export into manager/import/writer/cache lifecycle.
- suggested tasks:
  - add migration source detection and orchestration in manager/import paths.
  - funnel generated operations through writer/cache with preserved metadata and history.
  - ensure export paths can produce migration-compatible payloads for audits/backfills.
- dependencies: Phase 1 contract and metadata decisions.

#### Phase 3: Verification, Sync, and Runbook Integration

- purpose: prove correctness and operational safety for migration rollout.
- suggested tasks:
  - implement parity/guard tests across legacy and hybrid paths.
  - validate sync/job behavior after migration writes.
  - finalize runbook and rollback guidance.
- integration focus: ensure compile history, sync queueing, and operator documentation are
  consistent.

### Task Granularity Guidance

- appropriate task sizes: 1 subsystem per task; 1-3 files targeted per task.
- tasks to split: contract/schema work from runtime import wiring.
- tasks to combine: documentation updates with each phase’s completed behavior.

### Dependency Analysis

#### Independent Tasks

- portable schema and OpenAPI alignment.
- migration runbook drafting.
- serializer/deserializer metadata mapping.

#### Sequential Tasks

- manager/import runtime wiring depends on contract alignment.
- cache parity and value-guard test suites depend on runtime ingestion availability.
- sync and rollout validation depends on passing parity/guard checks.

#### Potential Bottlenecks

- shared changes in `importBaseOps.ts`, `writer.ts`, and `cache.ts`.
- contract synchronization across `portable.ts`, OpenAPI schemas, and route validation.
- value-guard correctness under complex update/delete transitions.

### Suggested Task Template

- title format: `pcd-data-migration: <action>`
- dependency annotation format: `Depends on [P#-T#,...]`
- instruction completeness checklist:
  - target files specified (1-3 files)
  - acceptance conditions clear
  - dependency list explicit
  - testing scope defined
