### Executive Summary

Use a three-phase plan: foundation first, resilience second, UI/docs third. Keep parser and schema/query work parallel early, then converge on reconciliation and startup integration. Split tasks by bounded file scope and explicit dependencies to maximize parallel throughput while keeping risky integration points controlled.

### Recommended Phase Structure

#### Phase 1: Core Provisioning

- purpose: deliver source-aware env instance reconciliation at startup.
- suggested tasks: parser module + tests, migration + query updates, reconciliation implementation, startup integration.
- parallelization notes: parser and migration/query tasks are independent; reconciliation waits on both.

#### Phase 2: Validation and Resilience

- purpose: optional connection validation and improved diagnostics.
- suggested tasks: add validation env flag/config wiring, run per-instance connectivity checks with timeout/retry policy, log outcomes without startup abort.
- dependencies: depends on Phase 1 reconciliation entry point and query contracts.

#### Phase 3: UI and Documentation

- purpose: expose env-managed provenance and operating model clearly.
- suggested tasks: list badge + settings restrictions, docs for env config and startup behavior.
- integration focus: consume `source` from backend and align UI messaging with startup logs.

### Task Granularity Guidance

- Split parser work into scanning/grouping, validation/coercion, and tests.
- Keep migration file and migration registration in a separate task from query surface changes.
- Separate UI list indicators from settings edit restrictions if they touch different modules.

### Dependency Analysis

#### Independent Tasks

- parser implementation and parser-focused tests.
- migration file creation and schema documentation update.
- docs draft preparation after behavior is settled.

#### Sequential Tasks

- reconciliation logic depends on parser output contracts and query/migration updates.
- startup integration depends on reconciliation API completion.
- UI restrictions depend on backend exposure of source field.

#### Potential Bottlenecks

- `packages/praxrr-app/src/hooks.server.ts` as a shared startup integration file.
- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts` as a central contract surface.
- schema migration version ordering in `packages/praxrr-app/src/lib/server/db/migrations.ts`.

### Suggested Task Template

- title format: `phaseX: concise objective (area)`.
- dependency annotation format: `Depends on [task-id list]` or `Depends on [none]`.
- instruction completeness checklist: files scoped, behavior specified, edge cases listed, verification criteria included.
