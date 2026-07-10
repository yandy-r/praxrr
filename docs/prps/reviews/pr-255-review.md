# PR Review #255 — feat(sync): bind apply to reviewed preview

**Reviewed**: 2026-07-10T17:32:22+00:00
**Mode**: PR
**Author**: yandy-r
**Branch**: feat/sync-preview-reviewed-plan → main
**Decision**: REQUEST CHANGES

## Summary

The reviewed-plan architecture is well covered and passes type checking, tests, build, and
changed-file formatting, but four high-severity gaps can still violate contract fidelity or the
exact reviewed target/pending-sync guarantees. All findings below must be resolved before merge.

## Findings

### CRITICAL

No findings.

### HIGH

- **[F001]** `docs/api/v1/paths/sync.yaml:222` — The 500 contract advertises `ErrorResponse`, but the runtime returns `SyncPreviewApplyErrorResponse`, breaking generated-client type fidelity.
  - **Status**: Open
  - **Category**: Type Safety
  - **Suggested fix**: Declare `SyncPreviewApplyErrorResponse` for the unexpected 500 response, regenerate all API artifacts, and validate the runtime sample against the schema mapping.

- **[F002]** `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts:282` — Reviewed completion and failure unconditionally clear `should_sync`, so an ordinary trigger arriving after the reviewed claim is silently discarded.
  - **Status**: Open
  - **Category**: Correctness
  - **Suggested fix**: Preserve a concurrently raised `should_sync` signal by transitioning the row back to `pending`, and add completion/failure interleaving tests.

- **[F003]** `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts:412` — The private review binding does not cover the instance URL or a non-secret credential identity, and revalidation uses a second client; a same-type retarget with equivalent content could write to an unreviewed target.
  - **Status**: Open
  - **Category**: Security
  - **Suggested fix**: Bind a normalized target URL and non-secret credential fingerprint or revision, verify them after claim, and use the same explicitly typed client for revalidation and execution; add retarget and credential-rotation zero-write tests.

- **[F004]** `packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts:332` — A valid zero-config or all-skipped preview reaches binding construction with no eligible sections and becomes a generic 500.
  - **Status**: Open
  - **Category**: Completeness
  - **Suggested fix**: Represent an intentional non-applicable preview result while continuing to reject empty apply claims, and add zero-config plus all-skipped create tests.

### MEDIUM

- **[F005]** `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts:492` — Expiry is checked only before version detection and materialization, so a receipt can expire during validation and still cross the write boundary.
  - **Status**: Open
  - **Category**: Security
  - **Suggested fix**: Re-check the deadline after revalidation and immediately before the first side effect; add an expiry-during-materialization zero-write test.

- **[F006]** `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts:595` — `captureChanges()` repeats ordinary PCD/Arr reads after reviewed materialization and can record history evidence that differs from the frozen executed plan.
  - **Status**: Open
  - **Category**: Performance
  - **Suggested fix**: Flatten the already revalidated materialized preview into history changes instead of running a second preview read.

- **[F007]** `packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts:359` — An empty transient metadata selection is previewed as eligible without a prepared execution context, then reviewed apply rejects it as unverifiable.
  - **Status**: Open
  - **Category**: Correctness
  - **Suggested fix**: Mark the empty selection skipped/ineligible or prepare a validated no-op context, with create/apply coverage.

- **[F008]** `packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts:628` — The reviewed path duplicates the large custom-format/quality-profile writer and already differs from ordinary response validation, aggregation, logging, and accounting.
  - **Status**: Open
  - **Category**: Maintainability
  - **Suggested fix**: Extract shared payload-oriented write primitives and feed them from both ordinary and reviewed materialization paths.

- **[F009]** `packages/praxrr-app/src/lib/server/sync/preview/store.ts:44` — The documented lifecycle excludes the receipt-owned `applying -> ready` release transition that runtime performs outside the transition matrix.
  - **Status**: Open
  - **Category**: Maintainability
  - **Suggested fix**: Model and validate the receipt-owned release transition explicitly so documentation, tests, and runtime share one state-machine definition.

- **[F010]** `packages/praxrr-app/src/lib/server/sync/preview/store.ts:323` — Selected-section validation permits reordered subsets, allowing execution order to differ from the reviewed binding order.
  - **Status**: Open
  - **Category**: Security
  - **Suggested fix**: Require selected sections to preserve their relative order in `binding.sections`, or canonicalize to binding order, and add reordered request tests.

### LOW

- **[F011]** `docs/plans/sync-preview-reviewed-plan/feature-spec.md:192` — The feature-spec example renders `changedEvidence` as a string although the runtime/OpenAPI contract requires an array.
  - **Status**: Open
  - **Category**: Completeness
  - **Suggested fix**: Change the example to `"changedEvidence": ["arr"]`.

- **[F012]** `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte:772` — The regeneration action introduces legacy `on:click` syntax despite the repository’s Svelte 5 `onclick` convention.
  - **Status**: Open
  - **Category**: Pattern Compliance
  - **Suggested fix**: Use `onclick={handleRegenerate}`.

## Validation Results

| Check      | Result                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------- |
| Type check | Pass — `deno task check`, 0 errors and 0 warnings                                         |
| Lint       | Partial — all PR files pass Prettier/Markdownlint; repo-wide lint finds 56 baseline files |
| Tests      | Pass — `deno task test`, 2,232 passed                                                     |
| Build      | Pass — `deno task build`                                                                  |

## Files Reviewed

- `ROADMAP.md` (Modified)
- `docs/api/v1/openapi.yaml` (Modified)
- `docs/api/v1/paths/sync.yaml` (Modified)
- `docs/api/v1/schemas/sync.yaml` (Modified)
- `docs/plans/sync-preview-reviewed-plan/analysis-code.md` (Added)
- `docs/plans/sync-preview-reviewed-plan/analysis-context.md` (Added)
- `docs/plans/sync-preview-reviewed-plan/analysis-tasks.md` (Added)
- `docs/plans/sync-preview-reviewed-plan/feature-spec.md` (Added)
- `docs/plans/sync-preview-reviewed-plan/parallel-plan.md` (Added)
- `docs/plans/sync-preview-reviewed-plan/research-architecture.md` (Added)
- `docs/plans/sync-preview-reviewed-plan/research-business.md` (Added)
- `docs/plans/sync-preview-reviewed-plan/research-docs.md` (Added)
- `docs/plans/sync-preview-reviewed-plan/research-external.md` (Added)
- `docs/plans/sync-preview-reviewed-plan/research-integration.md` (Added)
- `docs/plans/sync-preview-reviewed-plan/research-patterns.md` (Added)
- `docs/plans/sync-preview-reviewed-plan/research-practices.md` (Added)
- `docs/plans/sync-preview-reviewed-plan/research-recommendations.md` (Added)
- `docs/plans/sync-preview-reviewed-plan/research-security.md` (Added)
- `docs/plans/sync-preview-reviewed-plan/research-technical.md` (Added)
- `docs/plans/sync-preview-reviewed-plan/research-ux.md` (Added)
- `docs/plans/sync-preview-reviewed-plan/shared.md` (Added)
- `docs/site/src/content/docs/app/sync-pipeline.md` (Modified)
- `docs/site/src/content/docs/guides/syncing-profiles.md` (Modified)
- `packages/praxrr-api/openapi.json` (Modified)
- `packages/praxrr-api/types.ts` (Modified)
- `packages/praxrr-app/src/lib/api/v1.d.ts` (Modified)
- `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts` (Modified)
- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts` (Modified)
- `packages/praxrr-app/src/lib/server/pcd/resolved/liveDiff.ts` (Modified)
- `packages/praxrr-app/src/lib/server/sync/base.ts` (Modified)
- `packages/praxrr-app/src/lib/server/sync/delayProfiles/syncer.ts` (Modified)
- `packages/praxrr-app/src/lib/server/sync/drift/check.ts` (Modified)
- `packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts` (Modified)
- `packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts` (Modified)
- `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts` (Modified)
- `packages/praxrr-app/src/lib/server/sync/preview/reviewBinding.ts` (Added)
- `packages/praxrr-app/src/lib/server/sync/preview/store.ts` (Modified)
- `packages/praxrr-app/src/lib/server/sync/preview/types.ts` (Modified)
- `packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts` (Modified)
- `packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts` (Modified)
- `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/apply/+server.ts` (Modified)
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte` (Modified)
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewTrigger.svelte` (Modified)
- `packages/praxrr-app/src/tests/base/bundleApiContract.test.ts` (Modified)
- `packages/praxrr-app/src/tests/base/syncPreviewReviewBinding.test.ts` (Added)
- `packages/praxrr-app/src/tests/base/syncPreviewRouteHardening.test.ts` (Modified)
- `packages/praxrr-app/src/tests/base/syncPreviewStore.test.ts` (Added)
- `packages/praxrr-app/src/tests/e2e/specs/sync-preview-reviewed-plan.spec.ts` (Added)
- `packages/praxrr-app/src/tests/jobs/arrSyncVersionGate.test.ts` (Modified)
- `packages/praxrr-app/src/tests/jobs/lidarrMetadataProfilesSync.test.ts` (Modified)
- `packages/praxrr-app/src/tests/jobs/reviewedSyncClaims.test.ts` (Added)
- `packages/praxrr-app/src/tests/jobs/reviewedSyncExecution.test.ts` (Added)
- `packages/praxrr-app/src/tests/sync/delayProfilesReviewedEvidence.test.ts` (Added)
- `packages/praxrr-app/src/tests/sync/mediaManagementReviewedEvidence.test.ts` (Added)
- `packages/praxrr-app/src/tests/sync/qualityProfilesReviewedEvidence.test.ts` (Added)
- `packages/praxrr-app/src/tests/sync/syncEntityOutcomes.test.ts` (Modified)
