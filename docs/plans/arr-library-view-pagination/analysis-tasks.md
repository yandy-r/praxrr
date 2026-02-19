# Task Structure Analysis: arr-library-view-pagination

## Executive Summary

The implementation should be split into contract-first phases so UI integration depends on a stable API payload. Baseline work can be parallelized across API schema/docs, cache key refactors, and UI control scaffolding once metadata fields are fixed. The highest-risk coupling is cache invalidation coherence across server/client layers.

## Recommended Phase Structure

### Phase 1: Contract and Foundations

**Purpose**: Define and implement paginated API contract and metadata shape.
**Suggested Tasks**:

- Add query validation and pagination metadata in API handler.
- Update OpenAPI path and schema documents.
- Align API type usage/tests with new contract.
  **Parallelization**: 2-3 tasks can run in parallel after contract fields are agreed.

### Phase 2: UI State and Cache Integration

**Purpose**: Wire page/pageSize state into route logic, controls, and cache behavior.
**Suggested Tasks**:

- Update page route to send page/query params and handle metadata.
- Add pagination controls and summary behavior.
- Refactor client/server caches to page-aware keying and invalidation.
  **Dependencies**: Phase 1 payload contract.
  **Parallelization**: 2 independent tasks (UI controls vs cache refactor) with one integration task.

### Phase 3: Validation and Hardening

**Purpose**: Prove correctness and prevent regressions.
**Suggested Tasks**:

- Add backend tests for validation and metadata.
- Extend E2E flow for pagination UX and error states.
- Verify Arr-type parity and capability behavior remains intact.
  **Dependencies**: Phase 2 integrated behavior.

## Task Granularity Recommendations

### Appropriate Task Sizes

- `Implement query validation and metadata in /arr/library API` (1 file).
- `Update OpenAPI arr path/schema for pagination` (2 files).
- `Add page/pageSize state + URL sync in library page route` (1 file).
- `Refactor library cache key model` (1 file).
- `Add backend pagination parity tests` (1 file).

### Tasks to Split

- UI integration work should split into route-state updates and action-bar/control updates.
- Cache changes should split into server-cache and client-cache tasks to reduce conflict.

### Tasks to Combine

- OpenAPI path + schema updates should remain one task to preserve contract fidelity.

## Dependency Analysis

### Independent Tasks (Can Run in Parallel)

- Contract docs update and initial API validation scaffolding.
- Client cache key refactor and server cache key refactor.

### Sequential Dependencies

- API metadata contract must complete before route pagination rendering can finalize.
- Route integration should complete before E2E assertions are stabilized.

### Potential Bottlenecks

- `packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts` as central integration point.
- Cache invalidation logic because both GET and DELETE behaviors rely on the same key model.

## File-to-Task Mapping

### Files to Create

| File            | Suggested Task | Phase | Dependencies |
| --------------- | -------------- | ----- | ------------ |
| None (baseline) | N/A            | N/A   | N/A          |

### Files to Modify

| File                                                              | Suggested Task                                       | Phase | Dependencies |
| ----------------------------------------------------------------- | ---------------------------------------------------- | ----- | ------------ |
| `/packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts`                       | Add pagination query parsing, slicing, metadata      | 1     | none         |
| `/docs/api/v1/paths/arr.yaml`                                     | Add pagination query contract docs                   | 1     | none         |
| `/docs/api/v1/schemas/arr.yaml`                                   | Add response metadata schema fields                  | 1     | none         |
| `/packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte`                       | Add page/pageSize state, URL sync, metadata handling | 2     | Phase 1      |
| `/packages/praxrr-app/src/routes/arr/[id]/library/components/LibraryActionBar.svelte` | Add/adjust pagination controls integration           | 2     | Phase 1      |
| `/packages/praxrr-app/src/lib/client/stores/libraryCache.ts`                          | Add page/query-aware keying                          | 2     | none         |
| `/packages/praxrr-app/src/lib/server/utils/cache/cache.ts`                            | Add page/query-aware keying and invalidation support | 2     | none         |
| `/packages/praxrr-app/src/tests/base/lidarrApiParity.test.ts`                         | Add pagination validation/metadata tests             | 3     | Phase 2      |
| `/packages/praxrr-app/src/tests/e2e/specs/2.40-lidarr-core-flow.spec.ts`              | Add pagination UI flow coverage                      | 3     | Phase 2      |

## Optimization Opportunities

### Maximize Parallelism

- Run docs/schema task and cache-key refactors in parallel with API core changes.
- Prepare test scaffolding while UI integration is underway, then finalize assertions after merge.

### Minimize Risk

- Keep API contract stable before UI behavior tuning.
- Isolate cache refactor commits to simplify rollback/debug if stale-page issues appear.

## Implementation Strategy Recommendations

- Use contract-first implementation order: API + docs, then UI integration, then tests.
- Keep filtering/sorting deterministic on server before slicing to avoid page inconsistency.
- Preserve Arr-specific semantic handling and existing capability guards throughout.
