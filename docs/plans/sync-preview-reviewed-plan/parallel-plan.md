# Sync Preview Reviewed-Plan Binding Implementation Plan

Bind Sync Preview Apply to the exact instance, Arr family, selected sections, effective configuration,
desired PCD evidence, live Arr evidence, and material plan the operator reviewed. The implementation
adds a private versioned binding to the existing TTL store, captures deterministic per-section PCD,
Arr, and plan fingerprints through the current preview path, and introduces a reviewed executor that
claims and validates every selected section before any write-side effect. Typed API/UI recovery names
the invalidating evidence and requires regeneration while preserving explicit cross-Arr dispatch,
planned-versus-confirmed outcome separation, and ordinary sync behavior.

## Critically Relevant Files and Documentation

- `docs/plans/sync-preview-reviewed-plan/feature-spec.md`: Scope, decisions, taxonomy, and acceptance.
- `docs/plans/sync-preview-reviewed-plan/shared.md`: Verified architecture, patterns, and dependencies.
- `CLAUDE.md`: Contract-first, Svelte, cross-Arr, and portable-contract rules.
- `docs/api/v1/paths/sync.yaml`: Sync Preview path contract source.
- `docs/api/v1/schemas/sync.yaml`: Sync Preview schema contract source.
- `docs/api/v1/openapi.yaml`: Modular contract registration source.
- `packages/praxrr-app/src/lib/server/sync/preview/store.ts`: TTL lifecycle and private envelope owner.
- `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`: Shared preview materialization.
- `packages/praxrr-app/src/lib/server/sync/base.ts`: Reviewed config/evidence context seam.
- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`: First-write execution boundary.
- `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`: Conditional section claims/configs.
- `packages/praxrr-app/src/lib/server/sync/mappings.ts`: Explicit Arr support and section order.
- `packages/praxrr-app/src/lib/server/pcd/snapshots/fingerprint.ts`: Fingerprint precedent.
- `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/apply/+server.ts`: Apply adapter.
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte`: Recovery UI.
- `packages/praxrr-app/src/tests/base/syncPreviewRouteHardening.test.ts`: Existing acceptance seam.
- `packages/praxrr-app/src/tests/sync/syncEntityOutcomes.test.ts`: Confirmed outcome separation.
- `docs/site/src/content/docs/app/sync-pipeline.md`: Permanent architecture documentation.
- `ROADMAP.md`: Required issue #234 delivery record.

## Implementation Plan

### Phase 1: Contract and Integrity Foundations

#### Task 1.1: Define the reviewed invalidation API contract Depends on [none]

**READ THESE BEFORE TASK**

- `docs/api/v1/paths/sync.yaml`
- `docs/api/v1/schemas/sync.yaml`
- `docs/api/v1/openapi.yaml`
- `docs/plans/sync-preview-reviewed-plan/feature-spec.md`

**Instructions**

Files to Modify

- `docs/api/v1/paths/sync.yaml`
- `docs/api/v1/schemas/sync.yaml`
- `docs/api/v1/openapi.yaml`

Define a closed invalidation contract for `pcd_drift`, `arr_drift`, `pcd_and_arr_drift`,
`scope_drift`, and `unverifiable_review`, with bounded changed sections/evidence,
`regenerateRequired: true`, safe recovery text, and nullable stale warning. Document 422 for reviewed
evidence invalidation, 409 for lifecycle/active claims, and 404 for missing/evicted preview. Preserve
the existing matched write-time failure response on 500 with confirmed outcomes/history when present;
keep it distinct from pre-write 422 invalidation and from an unexpected sanitized 500 error response.
Document that transient `sectionConfigs` are bound reviewed execution state. Keep private hashes,
configs, and raw evidence out of every public schema.

#### Task 1.2: Implement deterministic private review bindings Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/pcd/snapshots/fingerprint.ts`
- `packages/praxrr-app/src/lib/server/sync/preview/types.ts`
- `packages/praxrr-app/src/lib/server/sync/preview/sectionDiffs.ts`
- `docs/plans/sync-preview-reviewed-plan/feature-spec.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/sync/preview/reviewBinding.ts`
- `packages/praxrr-app/src/tests/base/syncPreviewReviewBinding.test.ts`

Files to Modify

- `packages/praxrr-app/src/lib/server/sync/preview/types.ts`

Add closed internal binding/evidence types, explicit bounded canonicalization, Web Crypto SHA-256,
domain separation by version/Arr type/section/evidence class, immutable config cloning, binding
construction, and subset comparison. Keep independent PCD, Arr, and plan hashes. Preserve semantic
array order, sort only true sets with explicit comparators, and fail closed on unsupported,
non-finite, missing, unknown-version, or plan-only ambiguity. Mutation tests must prove source-specific
classification, key-order stability, semantic-order sensitivity, exact section subsets, and no raw
evidence leakage.

#### Task 1.3: Add safe all-selected section claims Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`
- `packages/praxrr-app/src/lib/server/sync/types.ts`
- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/tests/jobs/reviewedSyncClaims.test.ts`

Files to Modify

- `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`

Add the smallest transaction/helper that acquires the exact selected section rows without first
forcing them to pending and without overwriting another `in_progress` run. Harden every ordinary
`set*StatusPending` query so it is conditional and cannot reset `in_progress`; otherwise a normal sync
started after a reviewed claim could steal it. Acquisition must be all-or-none in deterministic section
order and release/failure must affect only claims owned by this reviewed request. Avoid a schema
migration unless ownership cannot be represented safely with current rows; if a migration becomes
necessary, stop and surface that design contradiction before proceeding. Cover active-claim
preservation, partial acquisition rollback, exact section scope, release paths, and both interleavings
for every section: reviewed-after-normal and normal-after-reviewed.

### Phase 2: Store, Evidence Plumbing, and Generated Contracts

#### Task 2.1: Make preview completion and apply claim atomic Depends on [1.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/sync/preview/store.ts`
- `packages/praxrr-app/src/tests/base/syncPreviewRouteHardening.test.ts`
- `packages/praxrr-app/src/lib/server/sync/preview/reviewBinding.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/tests/base/syncPreviewStore.test.ts`

Files to Modify

- `packages/praxrr-app/src/lib/server/sync/preview/store.ts`

Extend private `StoredPreview` with the immutable binding without changing public GET data. Add one
atomic generation-completion operation that installs the ready result and binding together, and one
atomic apply-claim operation that checks expiry, ready state, binding version/coverage, exact selected
subset, performs `ready -> applying`, and returns an opaque ownership receipt. Add receipt-checked
release for pre-write DB claim conflicts (`applying -> ready`) and receipt-checked terminal completion/
invalidation so a stale caller cannot transition a newer owner. Preserve timestamps, capacity, cleanup,
and terminal semantics. Missing legacy/test binding state must fail closed. Tests must prove conflict
release, TTL/evidence invalidation, execution failure, success, duplicate requests, and exceptions never
strand a preview in `applying`.

#### Task 2.2: Add optional evidence capture to preview materialization Depends on [1.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/sync/base.ts`
- `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`
- `packages/praxrr-app/src/lib/server/sync/preview/types.ts`
- `packages/praxrr-app/src/lib/server/sync/preview/reviewBinding.ts`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/lib/server/sync/base.ts`
- `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`
- `packages/praxrr-app/src/lib/server/sync/preview/types.ts`

Introduce a narrow optional evidence recorder/preparation context that concrete syncers populate beside
their authoritative reads and transformations. It must freeze the validated desired payload/material
plan and relevant current-value guards so reviewed writers consume exactly what was validated rather
than rereading changed PCD/config/mappings after comparison. `generatePreview()` must keep the public
result unchanged for drift/history/MCP callers while internal create/revalidation callers can obtain
private evidence, normalized configs, and the prepared execution context. Attach and clear all contexts
in `finally`; preserve exact order, explicit client/type, partial generation, and no-write behavior.

#### Task 2.3: Regenerate and validate portable API artifacts Depends on [1.1]

**READ THESE BEFORE TASK**

- `docs/api/README.md`
- `scripts/bundle-api.ts`
- `packages/praxrr-app/src/tests/base/bundleApiContract.test.ts`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/lib/api/v1.d.ts`
- `packages/praxrr-api/openapi.json`
- `packages/praxrr-api/types.ts`

Run `deno task generate:api-types` and `deno task bundle:api`, inspect the generated diff, and rerun
both to prove determinism. Do not hand-edit generated outputs. Confirm the new apply invalidation enum,
required fields, statuses, and documented `sectionConfigs` remain identical across app declarations,
portable declarations, and bundled OpenAPI.

### Phase 3: Section-Specific Evidence and Config Fidelity

#### Task 3.1: Bind quality-profile evidence and reviewed config Depends on [2.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts`
- `packages/praxrr-app/src/tests/base/syncPreviewQualityProfilesMap.test.ts`
- `CLAUDE.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/tests/sync/qualityProfilesReviewedEvidence.test.ts`

Files to Modify

- `packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts`

Capture exact normalized selections, PCD/TRaSH material, namespaces, quality mappings, transformed
desired payloads, live custom formats/profiles, targeting IDs, material capability inputs, and final
plan. Return a frozen prepared write context/current-value guards and make reviewed writes consume it
without rereading PCD/config/mappings. Ensure validation and writes use the same effective reviewed
config. Tests must mutate each PCD/config/live/mapping class, preserve exact names and semantic order,
prove Radarr, Sonarr, and Lidarr dispatch independently, and confirm zero sibling fallback.

#### Task 3.2: Bind delay-profile evidence and reviewed config Depends on [2.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/sync/delayProfiles/syncer.ts`
- `packages/praxrr-app/src/tests/base/lidarrApiParity.test.ts`
- `CLAUDE.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/tests/sync/delayProfilesReviewedEvidence.test.ts`

Files to Modify

- `packages/praxrr-app/src/lib/server/sync/delayProfiles/syncer.ts`

Record the selected PCD/config material, transformed desired profile, explicit per-app target
resolution, live target profile, remote identity, and material capability inputs. Route reviewed
validation and writes through the preview-aware getter, freeze the desired payload/current-value guard,
and make reviewed writes consume it without rematerializing PCD. Clear it reliably. Cover PCD/config/
live mutations, exact-name preservation, transient config parity, deterministic evidence, and explicit
Radarr/Sonarr/Lidarr semantic differences without fallback.

#### Task 3.3: Bind media-management evidence and reviewed config Depends on [2.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts`
- `packages/praxrr-app/src/tests/arr/lidarrMediaManagement.test.ts`
- `CLAUDE.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/tests/sync/mediaManagementReviewedEvidence.test.ts`

Files to Modify

- `packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts`

Record independent naming, quality-definition, and media-settings selections, PCD/TRaSH source
identity, mappings, transformed desired values, matching live configs/definitions, remote IDs, and
material capability fields. Freeze each desired payload/current-value guard and make reviewed writes
consume it without rematerializing PCD. Reuse the reviewed config in validation and writes. Cover each
subsection alone and combined, missing/disabled selections, order-sensitive quality data, app-specific
unsupported fields, and explicit Arr dispatch.

#### Task 3.4: Bind Lidarr metadata evidence and reviewed config Depends on [2.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts`
- `packages/praxrr-app/src/tests/jobs/lidarrMetadataProfilesSync.test.ts`
- `CLAUDE.md`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts`
- `packages/praxrr-app/src/tests/jobs/lidarrMetadataProfilesSync.test.ts`

Record exact database/profile configuration, PCD row/namespace, transformed desired profile, live
Lidarr schema/profile state, target identity, and capability inputs. Use the same effective reviewed
config for validation and execution. Freeze the desired payload/current-value guard and make the
reviewed write consume it without rematerializing PCD. Define and test schema-null evidence explicitly,
and fail closed for Radarr/Sonarr rather than using shared-table or sibling semantics.

### Phase 4: Reviewed Execution and Route Integration

#### Task 4.1: Implement the all-section reviewed executor Depends on [1.3, 2.1, 3.1, 3.2, 3.3, 3.4]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`
- `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`
- `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`
- `packages/praxrr-app/src/tests/sync/syncEntityOutcomes.test.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/tests/jobs/reviewedSyncExecution.test.ts`

Files to Modify

- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`

Add object-based `executeReviewedSyncJob`. Reload the exact enabled instance, compare bound explicit
`arrType` and current capability, acquire every selected claim without the normal pending reset,
recheck expiry, regenerate all exact selected evidence with stored configs, and compare all sections
before snapshots, history capture, outcomes, or Arr writes. Mismatch/unavailability releases or fails
only owned claims and returns typed safe invalidation with zero write-side evidence. A full match runs
existing writers from frozen prepared execution contexts/current-value guards and preserves confirmed
outcomes/history/preview correlation. Add an adversarial seam that mutates PCD/config/mappings after
revalidation but before the writer boundary and prove no materially different payload is sent. Keep
ordinary scheduled/manual/canary behavior unchanged except for Task 1.3's conditional pending
hardening, and test both normal/reviewed concurrency interleavings. Document the residual external Arr
race accurately.

#### Task 4.2: Atomically persist and apply reviewed bindings Depends on [2.3, 4.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts`
- `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/apply/+server.ts`
- `packages/praxrr-app/src/tests/base/syncPreviewRouteHardening.test.ts`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts`
- `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/apply/+server.ts`
- `packages/praxrr-app/src/tests/base/syncPreviewRouteHardening.test.ts`

Install public result and private binding atomically at generation completion. Replace route-level
`get()`/`transition()` plus ordinary executor with the atomic store claim and reviewed executor. Preserve
body, eligibility, exact ordered subset, stale warning/block, advisory active-state, actual outcome, and
history behaviors. Map typed invalidation to generated 422 responses, lifecycle/claim conflicts to 409,
missing preview to 404, and unexpected sanitized failures to 500. Retain the invalidated old diff but
prevent reapply. Use the ownership receipt for every exit: a pre-write DB claim conflict releases the
preview back to `ready`; TTL/evidence/scope/unverifiable invalidation becomes terminal `failed`; matched
success/skipped becomes `applied`; matched write-time failure (including actual outcomes/history) and
unexpected execution failure become `failed`. Direct tests must assert exact instance/type/sections/
config forwarding, no executor call on preflight failure, no private binding serialization, every
typed/matched-write branch, and no exit leaves `applying` stranded.

### Phase 5: Recovery UI and Cross-Cutting Regression Proof

#### Task 5.1: Implement accessible regenerate-and-review recovery Depends on [4.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewTrigger.svelte`
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte`
- `docs/plans/sync-preview-reviewed-plan/research-ux.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/tests/e2e/specs/sync-preview-reviewed-plan.spec.ts`

Files to Modify

- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewTrigger.svelte`
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte`

Preserve exact transient form config in preview creation. Show “Validating reviewed preview…” without
optimistic execution, exhaustively map the generated evidence taxonomy, retain the invalidated diff
read-only, disable Apply, state “Nothing was applied,” focus a persistent `role="alert"`, and offer
“Generate a new preview.” Keep target Arr type and selected sections visible and preserve destructive
exact-name confirmation and supplemental `alertStore` feedback. Browser coverage must prove focus,
keyboard recovery, duplicate-submit prevention, retained diff, safe text, exact request subset/config,
successful regeneration, and narrow viewport behavior.

#### Task 5.2: Prove contract and planned/confirmed separation Depends on [4.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/tests/base/bundleApiContract.test.ts`
- `packages/praxrr-app/src/tests/sync/syncEntityOutcomes.test.ts`
- `packages/praxrr-app/src/tests/jobs/arrSyncVersionGate.test.ts`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/tests/base/bundleApiContract.test.ts`
- `packages/praxrr-app/src/tests/sync/syncEntityOutcomes.test.ts`
- `packages/praxrr-app/src/tests/jobs/arrSyncVersionGate.test.ts`

Assert portable schemas, generated declarations, runtime responses, and status mappings remain in
lockstep. Prove review evidence never becomes a confirmed entity outcome, pre-write rejection creates
no Sync History row, target/version changes become scope invalidation before mutation, and issue #232
success/partial/failure outcome behavior stays intact. Assert matched write-time failure remains the
existing 500 `SyncPreviewApplyResponse` with confirmed outcomes/history when present, distinct from 422
pre-write invalidation and sanitized unexpected failure.

### Phase 6: Documentation, Roadmap, and Verification

#### Task 6.1: Document reviewed validation and update the roadmap Depends on [5.1, 5.2]

**READ THESE BEFORE TASK**

- `docs/site/src/content/docs/app/sync-pipeline.md`
- `docs/site/src/content/docs/guides/syncing-profiles.md`
- `ROADMAP.md`
- `docs/plans/sync-preview-reviewed-plan/feature-spec.md`

**Instructions**

Files to Modify

- `docs/site/src/content/docs/app/sync-pipeline.md`
- `docs/site/src/content/docs/guides/syncing-profiles.md`
- `ROADMAP.md`

Document the private ephemeral binding, exact reviewed scope/config, atomic selected claims, separate
PCD/Arr revalidation, all-selected-before-any-write invariant, explicit Arr dispatch, zero-write
invalidation, regeneration UX, and residual external-writer race. Add the issue #234 delivery entry in
existing roadmap style and distinguish reviewed-plan authorization from #232 confirmed outcomes. Do
not claim durable persistence, upstream transactional writes, or merge status before merge.

#### Task 6.2: Run focused and broad quality gates Depends on [6.1]

**READ THESE BEFORE TASK**

- `docs/site/src/content/docs/app/testing.md`
- `deno.json`
- `CLAUDE.md`

**Instructions**

Format only intended files, regenerate API types/bundle twice for determinism, and run focused binding,
store, claim, syncer, reviewed executor, route, UI, contract, outcome, cross-Arr, drift/history/MCP
preview regressions. Then run `deno task check`, `deno task lint`, the reviewed-plan Playwright spec,
the relevant repository E2E scope, `deno task test`, `deno task check:dist-paths`, and
`git diff --check`. Run `graphify update .` after source changes and inspect graph/status output.
Fix each failure at its owning layer and rerun downstream gates; do not use a narrow pass to support
the broad zero-write or cross-Arr claims. If Graphify generated artifacts are gitignored/untracked,
keep the local generated verification artifact out of the commit and do not force-add it.

Perform the issue's manual checks as a separately recorded gate: generate a preview, mutate desired
PCD/config only, and verify PCD-specific zero-write invalidation plus the retained read-only diff and
regeneration flow; then generate a fresh preview, mutate live Arr state only, and verify the Arr-specific
equivalent. Confirm neither rejection creates Sync History or entity outcomes. If local Arr/PCD fixtures
make either check impossible, document the exact blocker and the automated proof that covers it.

## Advice

- Keep `SyncPreviewResult` public and the binding private; the GET route serializes snapshots directly.
- Do not hash summaries or display diffs as the sole authorization evidence. Bind full material inputs
  and a plan hash because writers can send fields the public diff omits.
- The route's `getSectionsInProgress()` check is advisory. The reviewed executor must own the exact
  all-selected claim and must never call `setSectionsStatusPending()` before it.
- Validate every selected section before snapshots, history capture, confirmed outcomes, or the first
  Arr mutation; later-section drift must still produce zero earlier writes.
- Preserve exact normalized transient `sectionConfigs` through revalidation and writers, clearing them
  in `finally`; silently reverting to saved config recreates the issue.
- Treat Radarr, Sonarr, and Lidarr as separate semantics even where API shapes resemble each other.
  Metadata profiles remain Lidarr-only and capability drift fails closed.
- Keep pre-write invalidation outside Sync History and entity outcomes. A matched plan authorizes an
  attempt; only actual Arr write results prove execution.
- The upstream Arr APIs do not establish a common conditional-write contract. Minimize the external
  race and use prepared values/value guards where possible, but do not claim full external atomicity.
- Plan artifacts and implementation already live in the dedicated issue worktree; implementation
  should use `--no-worktree` only to avoid creating a second worktree, not to move work into `main`.
