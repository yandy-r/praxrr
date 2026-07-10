# Task Structure Analysis: Canary Remaining-Target Preview Evidence

## Executive Summary

Implement issue #239 in three phases: establish the evidence contract and
persistence, enforce it in Canary orchestration, then expose and verify it
through API/UI surfaces. The critical path is runtime types → query codec →
coordinator policy → route/UI integration. OpenAPI source work, migration work,
and reference-schema parity can fan out after the version-1 names are frozen
because they touch disjoint files.

Tasks below own one to three files. “Parallel-safe” means file ownership is
disjoint in the single shared worktree; it does not permit concurrent
generators, formatters, commits, or graph updates. A coordinator should wait at
each phase boundary, reconcile types/tests, and then dispatch the next batch.

## Recommended Phase Structure

### Phase 1 — Contract and Persistence

1. **T1 Runtime evidence contract — Sequential seed**
   - Files: `packages/praxrr-app/src/lib/server/sync/canary/types.ts`,
     `packages/praxrr-app/src/lib/server/sync/canary/errors.ts`.
   - Define the versioned available/unavailable union, require it on rollout
     detail, simplify the gated start DTO, and add a typed preview-unavailable
     error/predicate. Freeze all names here.

2. **T2 Portable API source — Parallel-safe after T1**
   - Files: `docs/api/v1/schemas/canary.yaml`, `docs/api/v1/paths/canary.yaml`,
     `docs/api/v1/openapi.yaml`.
   - Model the real Canary preview payload, discriminator, required detail
     evidence, gated start response, and Proceed `409`. Reuse
     `SyncPreviewFailureReason`.

3. **T3 Evidence migration — Parallel-safe after T1**
   - Files:
     `packages/praxrr-app/src/lib/server/db/migrations/20260722_add_canary_preview_evidence.ts`,
     `packages/praxrr-app/src/lib/server/db/migrations.ts`,
     `packages/praxrr-app/src/tests/db/canaryMigration.test.ts`.
   - Add nullable `remaining_preview_evidence TEXT`, register it after 20260721,
     and prove legacy rows remain null through the real migration chain.

4. **T4 Reference schema parity — Parallel-safe after T1**
   - File: `packages/praxrr-app/src/lib/server/db/schema.sql`.
   - Document the current Canary tables and new evidence column. Migrations
     remain executable truth.

5. **T5 Strict persistence codec — Sequential after T1 + T3**
   - Files: `packages/praxrr-app/src/lib/server/db/queries/canaryRollouts.ts`,
     `packages/praxrr-app/src/tests/db/canaryQueries.test.ts`.
   - Strictly encode/decode evidence; make null, malformed, unsupported,
     duplicate, wrong-Arr, or target-mismatched data unavailable. Store evidence
     in the same guarded canary-outcome update and omit the heavy JSON from
     summaries.

Phase 1 exits when both evidence branches round-trip, corrupt/legacy rows fail
closed, and an `awaiting_confirmation` row cannot be written without
authoritative evidence.

### Phase 2 — Policy and User Surface

6. **T6 Evidence builder and promotion gate — Sequential after T5**
   - Files: `packages/praxrr-app/src/lib/server/sync/canary/coordinator.ts`,
     `packages/praxrr-app/src/tests/sync/canaryCoordinator.test.ts`.
   - Replace `catch { return [] }` with typed evidence, inspect section
     failures, enforce exact IDs, cardinality, and Arr type, persist the
     snapshot, and reject unavailable evidence before transition/enqueue.
     Preserve canary Sync History, stale-token guards, and Abort.

7. **T7 HTTP mapping — Parallel-safe after T6**
   - Files: `packages/praxrr-app/src/routes/api/v1/canary/rollouts/+server.ts`,
     `packages/praxrr-app/src/routes/api/v1/canary/rollouts/[id]/proceed/+server.ts`,
     `packages/praxrr-app/src/tests/routes/canary.test.ts`.
   - Return the persisted gated shape, map preview-unavailable to safe `409`,
     and prove no enqueue while preserving current 400/404/409/422 behavior.

8. **T8 Detail gate UI — Parallel-safe with T7**
   - File: `packages/praxrr-app/src/routes/canary/[id]/+page.svelte`.
   - Render available-with-changes, available-no-changes, and unavailable
     separately from confirmed canary diagnostics. Disable Proceed with
     accessible explanatory text; keep Abort and explicit non-rollback guidance
     enabled.

T7 exclusively owns `canary.test.ts` during this batch. T8 reports desired
source assertions rather than editing that shared test concurrently.

### Phase 3 — Generated Artifacts and Closeout

9. **T9 Generated API artifacts — Sequential after T2 + T8**
   - Files: `packages/praxrr-app/src/lib/api/v1.d.ts`,
     `packages/praxrr-api/openapi.json`, `packages/praxrr-api/types.ts`.
   - Run repository generation/export once and verify the generated union
     matches runtime names.

10. **T10 UI assertion closeout — Sequential after T7 + T8**
    - Files: `packages/praxrr-app/src/tests/routes/canary.test.ts`,
      `packages/praxrr-app/src/routes/canary/[id]/+page.svelte`.
    - Add only missing accessibility/source assertions for disabled Proceed and
      enabled Abort. Skip if T7 already covers them.

11. **T11 Documentation — Parallel-safe after behavior passes**
    - Files: `ROADMAP.md`,
      `docs/internal-docs/automation-transparency-audit.md`.
    - Mark #239 implemented and close the audit gap only after focused tests
      pass.

## Task Granularity Recommendations

- Pair production logic with its focused test, except for mechanical
  schema/generated work.
- Keep T5 persistence separate from T6 orchestration so decoder defects and
  policy defects remain independently diagnosable.
- Keep authored OpenAPI (T2) separate from generated outputs (T9); never
  hand-shape generated files.
- Do not edit `selection.ts`, the rollout job handler, Abort route,
  notifications, or preview failure vocabulary unless a focused test proves a
  required mismatch.
- Assert exact instance IDs, uniqueness, explicit `arrType`, section failures,
  safe reason codes, and zero enqueue. Array shape alone is not meaningful
  evidence.

## Dependency Analysis

```text
T1 ─┬─ T2 ─────────────────────────────── T9
    ├─ T3 ─┐
    ├─ T4  ├─ T5 ─ T6 ─┬─ T7 ─┬─ T10
    └──────┘            └─ T8 ─┘
                               └─ T11
```

The primary bottleneck is T5: both durable read behavior and atomic write
behavior must exist before T6 can authorize promotion. T6 is the second
bottleneck because routes and UI consume its final DTO and errors. T9 is
intentionally late to avoid repeated generated-file churn.

Evidence validation happens before `markRollingOut`, but status and
`state_token` must still be atomically rechecked by the final SQL update.
Enqueue occurs only after that update succeeds. Abort must remain independent of
evidence availability.

## File-to-Task Mapping

| Area                                    | Task             |
| --------------------------------------- | ---------------- |
| Canary runtime types/errors             | T1               |
| OpenAPI source YAML                     | T2               |
| Migration, registration, migration test | T3               |
| Reference schema                        | T4               |
| Rollout query codec/query tests         | T5               |
| Coordinator/coordinator tests           | T6               |
| Start/Proceed routes and route tests    | T7               |
| Canary detail Svelte UI                 | T8, optional T10 |
| Generated API artifacts                 | T9               |
| ROADMAP/audit documentation             | T11              |

## Optimization Opportunities

- Fan out T2, T3, and T4 immediately after T1; their files do not overlap.
- Stub `generateInstancePreviews` at the coordinator seam for deterministic
  unreachable, unauthorized, partial, zero-change, and exact-target tests.
- Reuse `classifyPreviewFailure()` for thrown errors and
  `buildPreviewFailure('sectionErrors', arrType)` for returned partial failures.
- Use one-pass maps/sets to reject duplicate, missing, extra, or wrong-Arr
  previews; preserve ordering only for display.
- Run focused tests inside tasks, but serialize API generators, repository
  formatting, full checks, and `graphify update .` at phase boundaries.

## Implementation Strategy Recommendations

Use migration-first persistence and contract-first HTTP design. The column
remains nullable for legacy/in-progress rows, while the query layer converts
absence or invalidity to a safe unavailable read model. Never reuse the generic
JSON-array parser's `[]` fallback for authorizing evidence.

Build evidence from exactly the persisted `remainingTargets`. “Available”
requires one unique preview per target, matching rollout Arr type, with no
failed section. Thrown batches use safe typed classification; returned partials
use the closed section-error reason. Store the snapshot with the canary gate
decision and preserve confirmed canary output and Sync History independently.

In the shared worktree, assign exclusive file ownership before every parallel
batch. Agents must not run formatters, generators, commits, or graph updates
independently. After each batch, the coordinator reviews changed paths, resolves
cross-file types centrally, and runs the relevant focused suite. Final
validation is serialized: migration/query/coordinator/route tests, API
generation drift, `deno task check`, `deno task lint`, `git diff --check`, then
`graphify update .`.
