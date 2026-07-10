# PR Review #255 — feat(sync): bind apply to reviewed preview

**Reviewed**: 2026-07-10T17:32:22+00:00
**Mode**: PR
**Author**: yandy-r
**Branch**: feat/sync-preview-reviewed-plan → main
**Decision**: APPROVE

## Summary

The reviewed-plan architecture and both fix passes now satisfy the reviewed target, exact-plan,
pending-sync, contract-fidelity, and bounded-resource guarantees. All 17 findings are fixed, the
final full validation passes, and no unresolved actionable review threads remain.

## Final Re-review

- **Reviewed head**: working tree after `ac7f8e69` follow-up fixes
- **Independent passes**: correctness, security, and maintainability/pattern fidelity
- **Finding status**: 17 Fixed, 0 Open, 0 Failed
- **Decision**: APPROVE for squash merge after the updated head's required CI checks pass

## Findings

### CRITICAL

No findings.

### HIGH

- **[F016]** `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts:535` — Pre-side-effect reviewed invalidations call `failSections`, consuming an initially pending ordinary signal and replacing its prior state with `failed` even though no snapshot, history, outcome, or Arr write occurred.
  - **Status**: Fixed
  - **Category**: Security
  - **Suggested fix**: Release every reviewed claim rejected before the first external/audit side effect so its exact prior pending/`should_sync` state is restored; reserve `failSections` for failures after side effects begin and add initially-pending invalidation coverage.
  - **Evidence**: Every post-claim validation/capability/evidence/preparation exit now calls `releaseSections`; execution tracks the first snapshot, sync, or history side effect and releases on earlier exceptions while retaining failure finalization afterward. Focused executor and DB-claim tests prove an initially pending row returns to `pending` with `should_sync=1` and no write-side evidence.

- **[F001]** `docs/api/v1/paths/sync.yaml:222` — The 500 contract advertises `ErrorResponse`, but the runtime returns `SyncPreviewApplyErrorResponse`, breaking generated-client type fidelity.
  - **Status**: Fixed
  - **Category**: Type Safety
  - **Suggested fix**: Declare `SyncPreviewApplyErrorResponse` for the unexpected 500 response, regenerate all API artifacts, and validate the runtime sample against the schema mapping.

- **[F002]** `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts:282` — Reviewed completion and failure unconditionally clear `should_sync`, so an ordinary trigger arriving after the reviewed claim is silently discarded.
  - **Status**: Fixed
  - **Category**: Correctness
  - **Suggested fix**: Preserve a concurrently raised `should_sync` signal by transitioning the row back to `pending`, and add completion/failure interleaving tests.

- **[F003]** `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts:412` — The private review binding does not cover the instance URL or a non-secret credential identity, and revalidation uses a second client; a same-type retarget with equivalent content could write to an unreviewed target.
  - **Status**: Fixed
  - **Category**: Security
  - **Suggested fix**: Bind a normalized target URL and non-secret credential fingerprint or revision, verify them after claim, and use the same explicitly typed client for revalidation and execution; add retarget and credential-rotation zero-write tests.

- **[F004]** `packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts:332` — A valid zero-config or all-skipped preview reaches binding construction with no eligible sections and becomes a generic 500.
  - **Status**: Fixed
  - **Category**: Completeness
  - **Suggested fix**: Represent an intentional non-applicable preview result while continuing to reject empty apply claims, and add zero-config plus all-skipped create tests.

- **[F015]** `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts:537` — Credential identity and the client are acquired by separate reads during apply, while preview creation binds a credential read performed after generation, so rotation between either pair can bind or execute with a credential different from `targetHash`.
  - **Status**: Fixed
  - **Category**: Security
  - **Suggested fix**: Load one authoritative credential snapshot and derive both the private target identity and client from it for preview creation and reviewed apply, reuse that exact client for evidence and writes, and add adversarial rotation-between-read tests for both paths.
  - **Evidence**: `getArrInstanceReviewClient` now returns one client/identity lease from a single credential-row snapshot; preview generation, target hashing, revalidation, and writes reuse that lease. Adversarial create/apply tests rotate the authoritative credential after acquisition and prove the bound v1 client/identity cannot be switched. Focused suites pass 74 tests and `deno task check` reports 0 errors/warnings.

### MEDIUM

- **[F013]** `packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts:345` — A preview whose every requested section failed is classified as non-applicable, persisted as `ready`, and returned with HTTP 200 instead of the documented failed 500 response.
  - **Status**: Fixed
  - **Category**: Correctness
  - **Suggested fix**: Restrict non-applicable completion to clean zero-section or all-skipped results, persist zero-eligible failed results as `status: failed`, return HTTP 500, and add route/store regression tests.
  - **Evidence**: The route now persists zero-eligible section failures as `status: failed` and returns 500; the store rejects failed/non-skipped non-applicable completions, with focused route/store tests covering failure, zero-section, and all-skipped outcomes.

- **[F014]** `packages/praxrr-app/src/lib/server/sync/delayProfiles/syncer.ts:362` — Invalid or partial transient configs for delay profiles, metadata profiles, and media management are treated as absent and silently fall back to saved configuration, so preview/apply can target state the request did not review.
  - **Status**: Fixed
  - **Category**: Correctness
  - **Suggested fix**: Track whether a transient override was explicitly supplied, fail closed when a provided override is invalid, preserve saved-config fallback only when no override exists, and add per-Arr invalid/partial override tests.
  - **Evidence**: `BaseSyncer` now tracks explicit override presence, the orchestrator propagates own-property overrides including null/undefined, and shared strict parsers are reused by the route and all affected syncers. OpenAPI and generated portable/app declarations define the same complete config shapes. Focused Radarr/Sonarr/Lidarr delay and media tests, Lidarr metadata tests, route rejection tests, and generated contract samples cover invalid/partial overrides without saved-config fallback.

- **[F017]** `packages/praxrr-app/src/lib/server/sync/preview/reviewBinding.ts:237` — The 16 MiB canonical limit is checked only after the complete clone and JSON string are allocated, and true-set cloning resets limits per element, so adversarial evidence can exhaust memory before rejection.
  - **Status**: Fixed
  - **Category**: Performance
  - **Suggested fix**: Enforce one incremental encoded aggregate budget during canonical traversal, share it across every element of a true set, abort before cloning or serializing beyond the limit, and add adversarial aggregate-size tests.
  - **Evidence**: Canonical traversal now accounts exact JSON fragment bytes before retaining each value, aborts at the shared 16 MiB budget, and clones true sets as one aggregate canonical value. Oversized canonical and true-set regression cases fail closed before final serialization; focused suites and type checking pass.

- **[F005]** `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts:492` — Expiry is checked only before version detection and materialization, so a receipt can expire during validation and still cross the write boundary.
  - **Status**: Fixed
  - **Category**: Security
  - **Suggested fix**: Re-check the deadline after revalidation and immediately before the first side effect; add an expiry-during-materialization zero-write test.

- **[F006]** `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts:595` — `captureChanges()` repeats ordinary PCD/Arr reads after reviewed materialization and can record history evidence that differs from the frozen executed plan.
  - **Status**: Fixed
  - **Category**: Performance
  - **Suggested fix**: Flatten the already revalidated materialized preview into history changes instead of running a second preview read.

- **[F007]** `packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts:359` — An empty transient metadata selection is previewed as eligible without a prepared execution context, then reviewed apply rejects it as unverifiable.
  - **Status**: Fixed
  - **Category**: Correctness
  - **Suggested fix**: Mark the empty selection skipped/ineligible or prepare a validated no-op context, with create/apply coverage.

- **[F008]** `packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts:628` — The reviewed path duplicates the large custom-format/quality-profile writer and already differs from ordinary response validation, aggregation, logging, and accounting.
  - **Status**: Fixed
  - **Category**: Maintainability
  - **Suggested fix**: Extract shared payload-oriented write primitives and feed them from both ordinary and reviewed materialization paths.

- **[F009]** `packages/praxrr-app/src/lib/server/sync/preview/store.ts:44` — The documented lifecycle excludes the receipt-owned `applying -> ready` release transition that runtime performs outside the transition matrix.
  - **Status**: Fixed
  - **Category**: Maintainability
  - **Suggested fix**: Model and validate the receipt-owned release transition explicitly so documentation, tests, and runtime share one state-machine definition.

- **[F010]** `packages/praxrr-app/src/lib/server/sync/preview/store.ts:323` — Selected-section validation permits reordered subsets, allowing execution order to differ from the reviewed binding order.
  - **Status**: Fixed
  - **Category**: Security
  - **Suggested fix**: Require selected sections to preserve their relative order in `binding.sections`, or canonicalize to binding order, and add reordered request tests.

### LOW

- **[F011]** `docs/plans/sync-preview-reviewed-plan/feature-spec.md:192` — The feature-spec example renders `changedEvidence` as a string although the runtime/OpenAPI contract requires an array.
  - **Status**: Fixed
  - **Category**: Completeness
  - **Suggested fix**: Change the example to `"changedEvidence": ["arr"]`.

- **[F012]** `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte:772` — The regeneration action introduces legacy `on:click` syntax despite the repository’s Svelte 5 `onclick` convention.
  - **Status**: Fixed
  - **Category**: Pattern Compliance
  - **Suggested fix**: Use `onclick={handleRegenerate}`.

## Validation Results

| Check      | Result                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------- |
| Type check | Pass — `deno task check`, 0 errors and 0 warnings                                         |
| Lint       | Partial — all PR files pass Prettier/Markdownlint; repo-wide lint finds 56 baseline files |
| Tests      | Pass — `deno task test`, 2,261 passed                                                     |
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
