# Practices Research: Sync Preview Reviewed-Plan Binding

## Executive Summary

Issue #234 should be implemented as a narrow integrity layer around the existing preview and sync
primitives, not as a second planner or write engine. `generatePreview()` already provides the one
ordered, explicit-Arr read/transform path, and each concrete syncer already owns its domain-specific
PCD resolution, Arr reads, normalization, and diff construction. The safest maintainable change is to
capture versioned canonical evidence while that path runs, keep the binding private in
`SyncPreviewStore`, regenerate the same evidence for the exact apply subset, and enter the existing
write path only after an all-section match.

The implementation should add one small review-binding module, a private store envelope, a dedicated
reviewed execution entry point, and focused evidence capture in the four syncers. It should reuse
`SyncPreviewResult`, `SyncPreviewSectionResult`, `SYNC_SECTION_ORDER`, `getSection()`, the existing
preview-config parsers, per-Arr clients, section diff strategies, TTL rules, and actual-outcome
handling. It should not persist raw plans, reconstruct writes from display diffs, add a generic event
framework, introduce a canonical-JSON dependency, or make ordinary scheduled/manual/canary syncs
pretend to be reviewed applies.

One existing primitive must not be reused unchanged: `executeSyncJob()` calls
`setSectionsStatusPending()` before `claimSync()`, and those unconditional updates can overwrite an
existing `in_progress` status. The reviewed path needs a claim-before-revalidate boundary that never
resets another claim, validates all selected sections before the first mutation, and preserves the
exact reviewed `arrType`, section order, section config, TTL, and planned-versus-confirmed outcome
separation.

## Existing Reusable Code

| Existing symbol                                                                                                                                                  | Exact path                                                                                                        | Reuse in #234                                                                             | Constraint                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generatePreview(input)`                                                                                                                                         | `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`                                                 | Canonical ordered regeneration path for preview-time and apply-time evidence              | Pass the exact selected subset and stored config; never allow empty/omitted sections to re-expand during reviewed apply                            |
| `GeneratePreviewInput.sectionConfigs`                                                                                                                            | `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`                                                 | Carries the reviewed unsaved form state into both evidence runs                           | Normalize, clone, and retain server-side; do not replace with newly saved config                                                                   |
| `SYNC_SECTION_ORDER`                                                                                                                                             | `packages/praxrr-app/src/lib/server/sync/mappings.ts`                                                             | Existing deterministic section order and total section registry                           | Apply may narrow the reviewed list but must not add or silently reorder sections                                                                   |
| `isSyncPreviewArrType(value)`                                                                                                                                    | `packages/praxrr-app/src/lib/server/sync/preview/types.ts`                                                        | One concrete `radarr`/`sonarr`/`lidarr` gate                                              | Re-read the instance and require exact equality with the reviewed type; no sibling fallback                                                        |
| `getUnsupportedSyncSectionReason()` / `resolveSyncSectionAvailability()`                                                                                         | `packages/praxrr-app/src/lib/server/sync/mappings.ts`                                                             | Existing static and version-aware per-Arr eligibility checks                              | A changed capability is scope/unverifiable drift, not a newly successful skip                                                                      |
| `getSection(type)` and registered `SectionHandler`s                                                                                                              | `packages/praxrr-app/src/lib/server/sync/registry.ts`                                                             | Existing section dispatch, syncer factories, and status operations                        | Keep feature logic out of a new parallel registry                                                                                                  |
| `BaseSyncer.setPreviewConfig()`, `getPreviewConfig()`, `clearPreviewConfig()`                                                                                    | `packages/praxrr-app/src/lib/server/sync/base.ts`                                                                 | Existing override channel for reviewed config                                             | Use the same override during reviewed execution and always clear it in `finally`                                                                   |
| `getQualityProfilesSyncConfig()`                                                                                                                                 | `packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts`                                               | Already makes quality-profile preview and sync batch resolution override-aware            | `sync()` already reaches it through `fetchSyncBatches()`; protect this parity with a test                                                          |
| `getDelayProfilesSyncConfig()`                                                                                                                                   | `packages/praxrr-app/src/lib/server/sync/delayProfiles/syncer.ts`                                                 | Existing parser/fallback for reviewed delay config                                        | Change `sync()` to call it instead of `arrSyncQueries.getDelayProfilesSync()` directly                                                             |
| `getMediaManagementSyncConfig()`                                                                                                                                 | `packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts`                                               | Existing parser/fallback for naming, quality-definition, and media-settings selections    | Change `sync()` to call it instead of the direct saved-config query                                                                                |
| `getMetadataProfilesSyncConfig()`                                                                                                                                | `packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts`                                              | Existing Lidarr-only parser/fallback for metadata selection                               | Change `sync()` to call it and retain the explicit `getLidarrClient()` gate                                                                        |
| `diffEntityCollection()` / `diffSingletonEntity()`                                                                                                               | `packages/praxrr-app/src/lib/server/sync/preview/sectionDiffs.ts`                                                 | Existing material plan generation, namespace matching, remote IDs, stable change ordering | Do not reconstruct execution payloads from their display-oriented `EntityChange` output                                                            |
| `CUSTOM_FORMAT_ARRAY_KEY_STRATEGIES`, `QUALITY_PROFILE_ARRAY_KEY_STRATEGIES`, `QUALITY_DEFINITION_ARRAY_KEY_STRATEGIES`, `METADATA_PROFILE_ARRAY_KEY_STRATEGIES` | `packages/praxrr-app/src/lib/server/sync/preview/sectionDiffs.ts`                                                 | Proven semantic identity rules for order-insensitive collections                          | Reuse the identity concepts in evidence projection; do not globally sort every array                                                               |
| `SyncPreviewStore`, `derivePreviewStatus()`, `evaluatePreviewStaleness()`                                                                                        | `packages/praxrr-app/src/lib/server/sync/preview/store.ts`                                                        | Existing private TTL lifecycle and warning/block policy                                   | Extend the stored entry privately; make generation completion and ready-to-apply claim atomic                                                      |
| `resolveEligibleSections(snapshot)`                                                                                                                              | `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/apply/+server.ts`                                 | Existing successful/non-skipped subset rule                                               | Preserve the exact resolved list through claim, revalidation, and execution                                                                        |
| `_handleSyncPreviewApplyRequest()` dependency seam                                                                                                               | `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/apply/+server.ts`                                 | Existing route-level test injection for progress checks, execution, and clock             | Replace the reviewed executor dependency as an object input; keep HTTP mapping out of core logic                                                   |
| `getSectionsInProgress()`                                                                                                                                        | `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`                                                     | Useful advisory early rejection for UI-friendly 409s                                      | It is not the authoritative claim and cannot close the race by itself                                                                              |
| `SectionHandler.claimSync()`                                                                                                                                     | `packages/praxrr-app/src/lib/server/sync/types.ts` and four section handlers                                      | Existing compare-and-set (`pending -> in_progress`) primitive                             | Reviewed apply needs all selected claims before validation; do not precede it with unconditional pending resets                                    |
| `SyncEntityOutcome` / `SyncJobResult`                                                                                                                            | `packages/praxrr-app/src/lib/server/sync/types.ts`, `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts` | Preserve actual write outcomes and `syncHistoryId` after validation succeeds              | Drift rejection returns neither outcomes nor a fabricated history record                                                                           |
| `sha256Hex(data)`                                                                                                                                                | `packages/praxrr-app/src/lib/server/pcd/snapshots/fingerprint.ts`                                                 | Proven Web Crypto SHA-256 implementation pattern                                          | Do not import sync review code from the snapshot domain solely for this helper; keep a local helper or extract a truly shared utility deliberately |
| `SyncPreviewPanel.handleApply()` / `hasApplyPermission`                                                                                                          | `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte`                                 | Existing apply error display, local preview state, confirmation, and apply disabling      | Add typed invalidation handling, retain the old diff, disable retry, and direct regeneration                                                       |
| `SyncPreviewTrigger.handleCreatePreview()`                                                                                                                       | `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewTrigger.svelte`                               | Existing recovery action and exact form-state submission                                  | Keep regeneration as the only recovery from drift                                                                                                  |

## Modularity Design

### 1. Pure review-binding core

Add `packages/praxrr-app/src/lib/server/sync/preview/reviewBinding.ts`. It should own only:

- versioned canonical evidence values;
- SHA-256 hashing with explicit domain separators;
- construction of a private per-section binding;
- subset comparison and typed invalidation classification; and
- the typed `SyncPreviewReviewInvalidatedError`.

It must not import SvelteKit, database queries, Arr clients, the global preview store, or the job
queue. Keeping it pure makes canonical stability and fail-closed behavior directly testable.

### 2. Evidence capture at the existing read boundary

Extend `BaseSyncer` with a narrowly typed preview evidence sink, attached and cleared by
`generatePreview()`. Each concrete syncer records the normalized desired/config inputs and live Arr
inputs it already reads. Evidence capture belongs beside those reads because only the section syncer
knows whether array order, remote IDs, mappings, namespaces, schema fallbacks, or omitted fields are
material.

Do not create a second set of “evidence reader” services that queries PCD and Arr independently. That
would duplicate the most failure-prone domain logic and could disagree with the displayed preview.

### 3. Private lifecycle envelope

Keep `SyncPreviewResult` as the public DTO. Extend `StoredPreview` in `store.ts` with a private
`reviewBinding`. Add store operations that make these invariants unrepresentable:

- a new preview cannot become `ready` without a binding;
- an expired or non-ready preview cannot be claimed;
- two apply requests cannot both claim the same preview; and
- a claimed invalidated preview becomes terminal and cannot return to `ready`.

The store should return immutable copies of the binding to core execution, never serialize it from
the GET route.

### 4. Dedicated reviewed execution boundary

Add `executeReviewedSyncJob(input)` adjacent to `executeSyncJob()` in
`jobs/handlers/arrSync.ts`. It should visibly order the steps:

1. reload and bind the exact instance and concrete `arrType`;
2. acquire all selected section claims without overwriting `in_progress`;
3. re-check TTL/lifecycle at the final safe point;
4. regenerate evidence for every exact selected section with stored configs;
5. compare all sections and fail the whole request before writes on any mismatch;
6. execute the existing per-section syncers using the same stored configs; and
7. complete/fail/release only claims owned by this reviewed request.

Ordinary `executeSyncJob()` remains unchanged for scheduled, system, canary, and unreviewed manual
callers. Avoid an optional `reviewBinding?` parameter whose absence means “continue anyway.”

### 5. Thin HTTP and UI adapters

The apply route continues to parse/allowlist the body, resolve eligible sections, perform an advisory
in-progress check, atomically claim the preview, and map typed core results to 404/409/422/500. It
must not calculate hashes or re-read Arr itself.

`SyncPreviewPanel.svelte` should only interpret the generated typed response. On invalidation it
keeps the reviewed diff visible, sets local apply permission false, shows evidence-specific safe
copy, and points to the existing Preview Sync trigger. It must not auto-regenerate or auto-apply.

## Shared Versus Feature-Specific Code

### Reuse/shared

- Arr-type narrowing, section order/capability checks, section registry, clients, and syncers.
- Existing preview diffing and semantic array identity strategies.
- Existing preview-config parsers in each syncer.
- Existing TTL constants and lifecycle semantics.
- Existing actual outcome/history machinery after the validation boundary.
- Existing OpenAPI-first generation (`docs/api/v1`, `generate:api-types`, `bundle:api`).

### Feature-specific

- `SyncPreviewReviewBinding`, evidence classes, binding schema version, and domain-separated hashes.
- The evidence recorder/sink and per-section evidence projections.
- Atomic preview `completeGeneration`/`claimReadyForApply` operations.
- `executeReviewedSyncJob` and its typed invalidation result/error.
- The invalidated apply response and UI recovery state.

Do not promote review binding into a generic “workflow authorization” framework until a second real
consumer demonstrates the same lifecycle and evidence semantics. The snapshot rollback fingerprint,
startup metadata matching, and health degradation signature solve different contracts and should not
be forced behind one configurable hashing abstraction.

## KISS Assessment

The smallest complete design is one private binding per preview with three versioned hashes per
successful section: desired/PCD+config, live Arr, and rendered plan. Recompute them through the same
preview path for the exact selected subset and compare before writes. This is enough to name PCD
versus Arr drift while catching transformation nondeterminism.

Keep these choices simple:

- one binding schema version (`1`) and one explicit canonical format;
- one evidence sink interface with `record(section, source, key, value)`;
- one pure comparator returning a discriminated result;
- one dedicated reviewed executor;
- one private in-memory envelope using the existing TTL; and
- one typed recovery response.

Overengineering risks to reject:

- durable plan/envelope tables, migrations, cleanup jobs, or multi-version readers when process-local
  expiry is intentionally fail-closed;
- replaying stored Arr HTTP payloads or building a command/event-sourcing engine;
- a generic reflection-based serializer that silently stringifies unsupported values;
- a pluggable hashing strategy or external canonical-JSON package;
- a second registry of section adapters mirroring `getSection()`;
- owner-token/lease infrastructure broader than needed to make reviewed claims safe in the documented
  single-process deployment;
- refactoring every syncer into prepare/apply phases before the acceptance tests prove it necessary;
- parallel revalidation of sections whose clients, mappings, or dependency order may interact; and
- automatic diff refresh in the invalidation error, which bypasses the explicit review workflow.

The one deliberately non-trivial requirement is all-section pre-write validation. It should not be
weakened into “validate each section immediately before its writes,” because that allows section one
to mutate Arr before section two is discovered stale.

## Abstraction Versus Repetition

Centralize mechanics that must be byte-for-byte identical:

- canonical scalar/object handling and rejection of unsupported values;
- domain separation and SHA-256 encoding;
- binding construction, schema version, and comparison;
- selected-section subset validation; and
- stale-reason classification.

Keep domain projections explicit per section even when that repeats a few calls. Quality profiles,
delay profiles, media management, and Lidarr metadata do not share the same semantic identities or
Arr fields. Four small explicit recording blocks are safer than a generic “strip volatile keys and
sort arrays” function.

Reuse the existing array-key strategies as guidance or extract narrowly named key selectors if both
diffing and evidence canonicalization need the exact same identity. Do not reuse `diff.ts`'s defaults
blindly: its `null`/missing equivalence and ignored volatile fields are display-diff policy, while
review evidence must preserve any distinction that can change a write. Similarly, do not use
`createStartupMetadataFingerprint()` as the security boundary: it can coerce unsupported values to
strings, optionally sort all arrays, and returns canonical text rather than a versioned,
domain-separated digest.

## Interface Signatures and Extension Points

Recommended shapes (names may be adjusted, but the invariants should remain explicit):

```ts
export type SyncPreviewEvidenceClass = 'pcd' | 'arr';

export interface SyncPreviewSectionEvidenceHash {
  readonly section: SyncPreviewSection;
  readonly pcdHash: string;
  readonly arrHash: string;
  readonly planHash: string;
}

export interface SyncPreviewReviewBinding {
  readonly version: 1;
  readonly instanceId: number;
  readonly arrType: SyncPreviewArrType;
  readonly sections: readonly SyncPreviewSection[];
  readonly sectionConfigs: Readonly<
    Partial<Record<SyncPreviewSection, unknown>>
  >;
  readonly evidence: Readonly<
    Partial<Record<SyncPreviewSection, SyncPreviewSectionEvidenceHash>>
  >;
}

export interface SyncPreviewEvidenceSink {
  record(
    section: SyncPreviewSection,
    source: SyncPreviewEvidenceClass,
    key: string,
    value: unknown
  ): void;
}

export type ReviewedEvidenceComparison =
  | { readonly kind: 'match' }
  | {
      readonly kind: 'invalidated';
      readonly reason:
        'pcd_drift' | 'arr_drift' | 'pcd_and_arr_drift' | 'unverifiable_review';
      readonly changedEvidence: readonly SyncPreviewEvidenceClass[];
    };

export function compareReviewedEvidence(
  expected: SyncPreviewReviewBinding,
  actual: SyncPreviewReviewBinding,
  sections: readonly SyncPreviewSection[]
): ReviewedEvidenceComparison;
```

Store operations should be outcome-returning rather than throw for expected lifecycle races:

```ts
type ClaimPreviewForApplyResult =
  | { kind: 'claimed'; snapshot: SyncPreviewResult; binding: SyncPreviewReviewBinding }
  | { kind: 'missing' | 'expired' | 'not_ready' | 'unverifiable' };

completeGeneration(
  id: string,
  patch: SyncPreviewUpdatePatch,
  binding: SyncPreviewReviewBinding,
  nowMs?: number
): SyncPreviewResult | null;

claimReadyForApply(
  id: string,
  sections: readonly SyncPreviewSection[],
  nowMs?: number
): ClaimPreviewForApplyResult;
```

Use an object argument for reviewed execution so required fields cannot be misplaced:

```ts
export interface ExecuteReviewedSyncInput {
  readonly previewId: string;
  readonly instanceId: number;
  readonly arrType: SyncPreviewArrType;
  readonly sections: readonly SectionType[];
  readonly sectionConfigs: Readonly<Partial<Record<SectionType, unknown>>>;
  readonly expectedEvidence: Readonly<
    Partial<Record<SectionType, SyncPreviewSectionEvidenceHash>>
  >;
  readonly expiresAt: string;
}

export function executeReviewedSyncJob(
  input: ExecuteReviewedSyncInput
): Promise<SyncJobResult>;
```

The base syncer extension should remain preview-scoped and paired:

```ts
setPreviewEvidenceSink(sink: SyncPreviewEvidenceSink): void;
clearPreviewEvidenceSink(): void;
```

Attaching config/evidence and clearing both in one orchestrator `finally` is preferable to exposing
the sink to callers across the whole syncer lifetime. If implementation experience shows repeated
setup/cleanup, add one small `withPreviewContext(syncer, context, run)` helper; do not introduce a
general middleware pipeline.

## Testability Patterns and Anti-Patterns

### Recommended patterns

- Test `reviewBinding.ts` as pure functions with fixed clocks and fixtures: object-key reorder,
  semantically unordered collection reorder, meaningful array reorder, `null` versus absent where
  material, remote-ID change, plan-only change, unknown value rejection, and schema version mismatch.
- Use mutation tables: begin with one reviewed fixture, mutate exactly one PCD/config value or one Arr
  value, assert the exact typed reason and zero execution calls.
- Test subset preservation by previewing multiple sections and applying one; assert only that exact
  ordered subset reaches revalidation, claims, and sync.
- Test every concrete Arr type explicitly, including Lidarr-only metadata schema/null fallback and
  incompatible metadata on Radarr/Sonarr.
- Extend `_handleSyncPreviewApplyRequest` dependency injection with a reviewed executor spy. Assert
  invalidation returns the contract-safe 422 body and does not expose raw errors.
- Instantiate `SyncPreviewStore` per unit test for claim/TTL/concurrent apply cases; avoid shared global
  state except existing route integration fixtures with `finally` cleanup.
- Add focused config-parity tests proving all four `sync()` methods consume the same normalized
  override as `generatePreview()`.
- Add an execution-boundary test where a later section drifts; assert no earlier section writer,
  snapshot, history recorder, or outcome producer ran.
- Add a claim-race test proving an existing `in_progress` row is never reset to `pending` and no Arr
  read/write proceeds after the failed all-section claim.
- Keep canonical golden fixtures small and inspectable. Assert the canonical preimage/version as well
  as the final digest so a hash change explains which contract changed.
- Preserve existing `syncPreviewRouteHardening.test.ts`, `syncPreviewDiff.test.ts`, and section tests;
  add a focused `syncPreviewReviewedPlan.test.ts` instead of turning route tests into an end-to-end
  canonicalizer suite.

### Anti-patterns

- Mocking `generatePreview()` to return only a plan hash; that cannot prove PCD/Arr classification.
- Testing only summary counts; equal counts can hide different entities and field values.
- Using a writer spy only on the first section; later-section drift must prove zero writes globally.
- Snapshotting raw hashes without checking canonical input semantics.
- Reaching private syncer methods through type casts as the main evidence test strategy. Prefer a
  public narrow sink and observable records.
- Treating a thrown read error as `arr_drift` or `pcd_drift`. Ambiguous/unavailable evidence is
  `unverifiable_review`/validation failure.
- Using `Date.now()` directly in core/store tests or sleeping through TTL boundaries.
- Allowing legacy store fixtures without a binding to fall through to `executeSyncJob()`.
- Declaring UI success because an alert appeared without asserting Apply is disabled and the old diff
  remains inspectable after invalidation.

## Build Versus Depend

| Need                                   | Build or depend           | Recommendation                                                                                                          |
| -------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| SHA-256                                | Depend on platform        | Use Deno/Web Crypto, following the repository's `sha256Hex` pattern; no package                                         |
| Canonical evidence format              | Build narrowly            | Typed, versioned, fail-closed canonicalizer in `reviewBinding.ts`; explicit per-section collection identity             |
| Generic canonical JSON library         | Do not depend             | Adds ambiguous behavior and supply-chain surface for a small closed schema                                              |
| PCD/Arr data reads and transformations | Depend on existing code   | Run existing syncers through `generatePreview()`; do not duplicate readers                                              |
| Plan diff                              | Depend on existing code   | Reuse `diffEntityCollection()` / `diffSingletonEntity()` output for `planHash`                                          |
| Write execution                        | Depend on existing code   | Call existing syncer `sync()` only after full validation; do not replay display diffs                                   |
| Config normalization                   | Depend on existing code   | Reuse the four existing preview-config parsers/helpers and make `sync()` honor them                                     |
| TTL/lifecycle                          | Extend existing code      | Add binding-aware atomic methods to `SyncPreviewStore`; no database persistence                                         |
| Section dispatch/capabilities          | Depend on existing code   | Reuse registry, order, support, and version gates with exact Arr type                                                   |
| Concurrency                            | Extend minimally          | Add reviewed all-section claim semantics that never overwrite `in_progress`; defer generalized leases/distributed locks |
| API contracts                          | Depend on repo tooling    | Edit OpenAPI schemas/paths first, then run `generate:api-types` and `bundle:api`                                        |
| UI recovery                            | Extend existing component | Typed invalidation branch in `SyncPreviewPanel`; use existing trigger to regenerate                                     |
| Durable invalidation audit             | Do not build in #234      | No writes means no confirmed sync outcome/history row; a future audit event is separate scope                           |

## Open Questions

1. Are unsaved `sectionConfigs` intentionally executable after review? Current UI/API behavior implies
   yes; if not, Apply must require an exact saved-config match rather than silently substituting it.
2. Which normalized target identity fields beyond `instanceId` and exact `arrType` must be bound (URL,
   enabled state, credential fingerprint/version)? The answer should avoid storing secrets while
   preventing target replacement.
3. Can reviewed claims be implemented transactionally across the four existing config tables without
   schema changes, or is a minimal owner token required for safe release after revalidation failure?
4. Should saved config drift be reported as `pcd_drift`, `scope_drift`, or a distinct `config_drift`?
   It must remain distinguishable from live Arr drift and always require regeneration.
5. If desired and live inputs hash identically but `planHash` changes after a deployment, should the
   response remain `unverifiable_review` or use a dedicated `engine_changed` reason? Either must fail
   closed and keep the canonicalizer/engine version explicit.
6. Is temporary failure to fetch Arr version/schema always unverifiable, including the existing
   Lidarr metadata schema `null` fallback, or is that fallback itself a stable, explicitly recorded
   input? The chosen rule must be identical at preview and apply.
7. Does the reviewed path need stronger per-entity old-value guards to narrow the external Arr
   compare/write race in this issue, or is immediate in-boundary revalidation plus a documented
   residual race acceptable for the first increment?
8. Should invalidation use the existing terminal `failed` status or add a public `stale` status? A new
   status expands API/UI contracts; `failed` plus typed reason is the KISS default.
9. Is the current 10-minute store TTL intentionally shorter than the 30-minute hard block? Preserve it
   here, but UI wording should derive from `expiresAt` so it does not promise an unreachable window.
