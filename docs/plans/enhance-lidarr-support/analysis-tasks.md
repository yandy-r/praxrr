# Task Structure Analysis: enhance-lidarr-support

## Executive Summary

Break implementation into three phases: data foundation, product cutover, and hardening. Build first-class Lidarr schema/contracts first, then switch runtime CRUD/API/sync paths, then complete cleanup/testing/docs. Keep each task scoped to a small file set and explicit dependencies.

## Recommended Phase Structure

### Phase 1: Data Foundation

**Purpose**: establish schema/types/contracts required for first-class Lidarr entities.
**Suggested Tasks**:

- Add `lidarr_*` media-management tables.
- Add/seed `quality_api_mappings` for `arr_type = 'lidarr'`.
- Extend portable/OpenAPI contracts for `lidarr_*`.
- Add migration scaffolding for deterministic/idempotent copy and conflict reporting.
  **Parallelization**: 2 streams (schema+migration, contract updates).

### Phase 2: Product and Sync Cutover

**Purpose**: switch behavior from reuse to first-class Lidarr entities.
**Suggested Tasks**:

- Implement dedicated Lidarr CRUD/list/get behavior in media-management entity modules.
- Update route handlers and import/export endpoints to use first-class Lidarr entities.
- Update sync resolver and rename propagation for Lidarr config names.
  **Dependencies**: Phase 1 complete.
  **Parallelization**: 3 streams with coordination on shared files.

### Phase 3: Hardening and Cleanup

**Purpose**: validate, remove compatibility branches, and finalize docs.
**Suggested Tasks**:

- Add regression tests for CRUD/sync/import-export/migration reruns.
- Remove reuse-specific behavior/messages after cutover is verified.
- Update architecture/API/operator docs.
  **Dependencies**: Phase 2 complete.

## Task Granularity Recommendations

### Appropriate Task Sizes

- “Add Lidarr tables + indexes” (1-2 schema files).
- “Add portable entity types for Lidarr” (1-2 contract files).
- “Wire Lidarr naming routes to dedicated helpers” (1-3 files).

### Tasks to Split

- “Switch all media-management routes + sync + import/export in one task” should be split by domain.

### Tasks to Combine

- Minor documentation updates can be combined after behavior is stable.

## Dependency Analysis

### Independent Tasks (Parallel)

- Portable/OpenAPI contract updates after schema entity naming is decided.
- Route updates per family (`naming`, `media-settings`, `quality-definitions`) after helper APIs are stable.

### Sequential Dependencies

- Schema/migration must precede runtime cutover.
- Entity helper changes must precede route/sync switching.
- Cutover must precede compatibility branch removal.

### Potential Bottlenecks

- `packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts` (shared by multiple domains).
- `packages/praxrr-app/src/lib/shared/pcd/portable.ts` and `docs/api/v1/schemas/pcd.yaml` contract alignment.

## File-to-Task Mapping

### Files to Create

| File                              | Suggested Task                   | Phase | Dependencies |
| --------------------------------- | -------------------------------- | ----- | ------------ |
| `/packages/praxrr-app/src/lib/server/db/migrations/*` | Add first-class Lidarr migration | 1     | none         |

### Files to Modify

| File                                                           | Suggested Task                        | Phase | Dependencies      |
| -------------------------------------------------------------- | ------------------------------------- | ----- | ----------------- |
| `/docs/pcdReference/0.schema.sql`                              | Add `lidarr_*` schema refs            | 1     | none              |
| `/packages/praxrr-app/src/lib/server/db/schema.sql`                                | Align runtime schema docs             | 1     | none              |
| `/packages/praxrr-app/src/lib/shared/pcd/portable.ts`                              | Add first-class Lidarr portable types | 1     | schema decisions  |
| `/docs/api/v1/schemas/pcd.yaml`                                | Document first-class Lidarr entities  | 1     | portable changes  |
| `/packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/**`              | Dedicated Lidarr CRUD/list/get        | 2     | phase 1           |
| `/packages/praxrr-app/src/routes/media-management/[databaseId]/**/+page.server.ts` | Route dispatch to Lidarr helpers      | 2     | entity helpers    |
| `/packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts`                     | Import support for `lidarr_*`         | 2     | phase 1           |
| `/packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`                     | Export support for `lidarr_*`         | 2     | phase 1           |
| `/packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts`               | Sync source cutover to `lidarr_*`     | 2     | helpers+migration |
| `/packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`                        | Rename/config propagation updates     | 2     | migration policy  |
| `/packages/praxrr-app/src/tests/arr/*`                                             | CRUD/sync/migration regressions       | 3     | phase 2           |

## Optimization Opportunities

### Maximize Parallelism

- Split by domain (`naming`, `media-settings`, `quality-definitions`) during route/helper updates.
- Run contract work in parallel with migration script drafting after schema naming is finalized.

### Minimize Risk

- Land migration + schema guards before route/sync cutover.
- Keep explicit logs for skipped/conflicted migration items.

## Implementation Strategy Recommendations

- Implement bottom-up: schema/contracts, then runtime helpers/routes/sync, then cleanup/tests/docs.
- Add regression tests immediately after each cutover chunk to prevent drift.
- Keep compatibility window short and remove fallback behavior once migration is validated.
