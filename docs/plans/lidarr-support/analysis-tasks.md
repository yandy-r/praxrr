> [!WARNING]
> Superseded on 2026-02-15 by the first-class Lidarr initiative plan in `docs/plans/enhance-lidarr-support/parallel-plan.md` (tracked by GitHub issue #130 and umbrella #13).
>
> This document captures the legacy Sonarr-reuse rollout model and is retained for historical context only. Do not use it for current implementation planning.

### Executive Summary

Use a three-phase plan: establish shared type/schema/mapping readiness, implement Lidarr support across media-management CRUD paths, then align sync/import-export and validate with focused tests. This ordering minimizes risk by resolving contract-level dependencies before route/entity changes. It also enables meaningful parallelism by splitting naming, quality-definitions, and media-settings streams while keeping shared dependency tasks explicit.

### Recommended Phase Structure

#### Phase 1: Foundation Contracts

- purpose: Ensure Lidarr is accepted in shared arr metadata, portable schemas, and mapping data needed by downstream flows.
- suggested tasks: update shared arr type/capability references, portable entity contracts, and Lidarr quality mapping availability.
- parallelization notes: contract/documentation updates and mapping updates can run concurrently.

#### Phase 2: CRUD and Route Enablement

- purpose: Enable Lidarr visibility and creation in naming, quality-definitions, and media-settings.
- suggested tasks: extend route loaders/actions and entity read/create/update/delete logic for Lidarr behavior in each section.
- dependencies: depends on Phase 1 contract/mapping readiness.

#### Phase 3: Integration Verification

- purpose: Reconcile sync behavior, portable import/export, and test coverage.
- suggested tasks: align syncer expectations, validate import/export entity handling, and add/update tests for Lidarr paths.
- integration focus: confirm no mismatch between UI capabilities and sync capability-gating.

### Task Granularity Guidance

- appropriate task sizes: 1-3 files per task, single layer per task.
- tasks to split: separate naming, quality-definitions, and media-settings into independent tasks.
- tasks to combine: couple portable schema updates with internal entity-type validation updates.

### Dependency Analysis

#### Independent Tasks

- shared arr metadata/capability updates.
- quality API mapping updates for Lidarr.
- docs/schema clarifications for portable Lidarr strategy.

#### Sequential Tasks

- foundation contracts -> entity helper updates -> route action updates.
- route/entity enablement -> sync/import-export reconciliation -> regression testing.

#### Potential Bottlenecks

- shared files touched by all streams: `/src/lib/shared/pcd/types.ts`, `/src/lib/shared/pcd/portable.ts`.
- sync metadata dependencies: `/src/lib/server/db/queries/arrSync.ts`.
- mapping dependencies: `quality_api_mappings` usage in quality-definition and sync paths.

### Suggested Task Template

- title format: `lidarr-support | <surface> | <action>`.
- dependency annotation format: `Depends on [T#]`.
- instruction completeness checklist: arrType validation, entity coverage, sync/import alignment, tests.
