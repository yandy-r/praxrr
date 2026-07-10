# Documentation Research: Sync Preview Reviewed-Plan Binding

## Architecture Docs

- **Required — `docs/site/src/content/docs/app/sync-pipeline.md`:** The most focused current
  architecture guide. It documents the read-only preview path, normal job-backed execution path,
  section ordering, explicit per-`arr_type` dispatch, and the `generatePreview()`/`arrSync.ts`
  integration points that issue #234 must bind without creating a sibling-Arr fallback.
- **Required — `docs/site/src/content/docs/app/architecture.md`:** Establishes the runtime boundary
  between `/api/v1`, the PCD cache, job queue, sync pipeline, and Arr APIs, and reiterates that
  OpenAPI schemas, validators, and handlers must remain aligned.
- **Required — `docs/plans/sync-history/design.md`:** Its authoritative critique resolutions explain
  why Sync History takes a best-effort pre-sync preview and why planned `EntityChange` evidence is
  not write confirmation. Issue #234 must preserve that separation: rejected review evidence must
  not create a run or outcomes.
- **Nice-to-have — `docs/ARCHITECTURE.md`:** Broad PCD/app-database/module map and value-guard
  background. Useful context for desired-state materialization, but less precise than the dedicated
  sync-pipeline guide for this feature.
- **Nice-to-have — `docs/features/link-bridge-sync.md`:** Concise product-to-runtime map for linked
  PCDs, Arr instances, per-section configuration, and `arr.sync.*` jobs.

## API Docs

- **Required — `docs/api/v1/paths/sync.yaml`:** Current contract for create/get/delete/apply preview.
  It presently says Apply reruns the normal sync path using current saved configuration and defines
  409 lifecycle conflicts plus a 422 age-staleness response. This prose and response contract must
  be revised for reviewed binding, exact config reuse, and typed evidence invalidation.
- **Required — `docs/api/v1/schemas/sync.yaml`:** Defines `SyncPreviewApplyRequest`,
  `SyncPreviewApplyResponse`, `SyncPreviewApplyErrorResponse`, lifecycle states, section outcomes,
  and the public preview result. Private hashes/bindings must not be added to the public result;
  typed safe invalidation belongs in the apply-error schema.
- **Required — `docs/api/v1/openapi.yaml`:** Registers all three sync-preview paths and sync schemas.
  Any new invalidation schemas must also be registered here so generation and bundling can resolve
  them.
- **Required — `docs/api/README.md`:** Declares `docs/api/v1/openapi.yaml` the contract source and
  `packages/praxrr-app/src/routes/api/v1/**` the runtime source.
- **Nice-to-have — `docs/api/errors.md`:** General status-code and sanitized `{ "error": "..." }`
  conventions. Use it as background while keeping issue #234's closed codes and bounded fields in
  the sync schema itself.

## Development Guides

- **Required — `CLAUDE.md`:** Governs contract-first API changes, Svelte 5 without runes, alerts,
  formatting, exact config-name fidelity, and the Cross-Arr Semantic Validation / Portable Contract
  Fidelity / Arr Cutover guardrails. The explicit-`arr_type`, no-fallback, fail-fast checklist is
  directly applicable to every reviewed section.
- **Required — `docs/site/src/content/docs/app/development.md`:** Documents the monorepo layout and
  contract-first order: edit OpenAPI, run `deno task generate:api-types`, then implement. It also
  identifies `packages/praxrr-app/src/lib/api/v1.d.ts` as the generated app contract.
- **Required — `deno.json`:** The executable workflow is
  `deno task generate:api-types` for `packages/praxrr-app/src/lib/api/v1.d.ts`, followed by
  `deno task bundle:api` for the portable package. `deno task test`, `lint`, and `check` are the
  application gates.
- **Required — `scripts/bundle-api.ts`:** Documents and implements bundling the modular YAML into
  `packages/praxrr-api/openapi.json` and copying the generated app declarations into
  `packages/praxrr-api/types.ts`. These generated artifacts must move with the source contract.
- **Required — `docs/site/src/content/docs/app/testing.md`:** Defines focused file execution,
  test-directory layout, APP_BASE_PATH isolation, and the application/OpenAPI pre-merge gates.
- **Nice-to-have — `docs/CONTRIBUTING.md`:** Short contributor command and UI-convention summary.
- **Nice-to-have — `docs/DEVELOPMENT.md`:** GitHub Flow, release, and conventional-commit guidance;
  it adds little implementation detail for the reviewed binding.

## README Files

- **Required — `packages/praxrr-api/README.md`:** Confirms the published package contains the bundled
  OpenAPI 3.1 document and generated TypeScript `components` types, making the portable artifacts
  part of the contract-fidelity surface.
- **Nice-to-have — `README.md`:** Product framing for PCD-to-Arr sync and links to architecture,
  contribution, development, and OpenAPI documentation.
- **Nice-to-have — `docs/README.md`:** Documentation index; useful when deciding whether the shipped
  behavior also needs a permanent guide update.
- **Nice-to-have — `packages/praxrr-schema/README.md`:** Deeper PCD layer/value-guard model. Useful
  when defining desired-evidence projections, although issue #234 does not change the schema.

## Must-Read Documents

Required before implementation, in recommended order:

1. `docs/plans/sync-preview-reviewed-plan/feature-spec.md` — authoritative scope, decisions, typed
   drift taxonomy, zero-write invariants, and file inventory.
2. `CLAUDE.md` — mandatory cross-Arr, portable-contract, Svelte, and API rules.
3. `ROADMAP.md` — records #234 as the open Sync Preview plan-binding evidence gap and requires the
   delivery entry/checklist to distinguish reviewed intent from confirmed outcomes.
4. `docs/site/src/content/docs/app/sync-pipeline.md` — current preview/execution architecture.
5. `docs/api/v1/paths/sync.yaml`, `docs/api/v1/schemas/sync.yaml`, and
   `docs/api/v1/openapi.yaml` — the contract-first change surface.
6. `packages/praxrr-app/src/lib/server/sync/preview/types.ts` and
   `packages/praxrr-app/src/lib/server/sync/preview/store.ts` — inline docs define the supported Arr
   narrowing, ephemeral TTL store, lifecycle matrix, immutable timestamps, and cleanup behavior.
7. `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts` and
   `packages/praxrr-app/src/lib/server/sync/base.ts` — inline docs define ordered read-only preview,
   partial-failure accumulation, transient `sectionConfigs`, and the preview-config seam that
   reviewed execution must reuse and clear.
8. `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts` and
   `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/apply/+server.ts` — current
   execution, status-reset/claim, outcome/history correlation, lifecycle/age checks, and the exact
   route dependency seam to replace with reviewed execution.
9. `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte` — existing
   confirmation, loading, stale-warning, alert-store, and planned-vs-confirmed UI behavior.
10. `packages/praxrr-app/src/tests/base/syncPreviewRouteHardening.test.ts`,
    `packages/praxrr-app/src/tests/base/syncPreviewDiff.test.ts`, and
    `packages/praxrr-app/src/tests/base/syncPreviewQualityProfilesMap.test.ts` — existing contract,
    eligibility, staleness, diff-normalization, and quality-profile mapping regression patterns.
11. `packages/praxrr-app/src/tests/sync/syncEntityOutcomes.test.ts` and
    `packages/praxrr-app/src/tests/base/bundleApiContract.test.ts` — prove actual-write outcomes stay
    separate from preview intent and that the portable bundled OpenAPI remains resolvable.

Nice-to-have after the required set:

- `docs/site/src/content/docs/guides/syncing-profiles.md` — current operator promise and recovery
  language; it should be checked for a post-implementation wording update.
- `docs/plans/issue-21/design.md` — background for Transparent Automation's planned-change
  narration and its deliberate separation from post-apply evidence.
- `docs/plans/sync-history/design.md` — deeper audit/history rationale beyond the required
  evidence-separation sections.

## Documentation Gaps

- The permanent user guide `docs/site/src/content/docs/guides/syncing-profiles.md` currently presents
  Preview as a dry-run before “Sync now”; it does not document that Apply binds and revalidates the
  reviewed instance, Arr type, section subset, transient config, PCD state, and live Arr state.
- `docs/site/src/content/docs/app/sync-pipeline.md` documents preview and execution as separate paths
  but has no reviewed-apply validation/claim phase or all-selected-before-any-write invariant.
- `docs/api/v1/paths/sync.yaml` currently documents execution from current saved configuration, which
  conflicts with the feature decision to retain and reuse exact reviewed `sectionConfigs`.
- `SyncPreviewApplyErrorResponse` has only `error` and `staleWarning`; there is no closed machine-safe
  code/evidence/changed-sections/regeneration contract yet.
- The store's inline lifecycle matrix is documented, but there is no dedicated store unit test file;
  relevant lifecycle/TTL assertions are embedded in route-hardening coverage.
- No permanent documentation describes which material PCD and live Arr fields contribute to each
  section's reviewed-evidence projection. Keep the binding private, but document projection ownership
  beside the implementation so future syncer changes cannot silently omit write-relevant fields.
