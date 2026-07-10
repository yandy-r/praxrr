# Pattern Research: Sync Preview Reviewed-Plan Binding

## Architectural Patterns

### Contract-first OpenAPI with generated mirrors

The repository treats `docs/api/v1/openapi.yaml` and its referenced path/schema fragments as the
source contract. Sync Preview is split between `docs/api/v1/paths/sync.yaml` (`preview`,
`previewById`, `previewApply`) and `docs/api/v1/schemas/sync.yaml` (`SyncPreviewResult`,
`SyncPreviewApplyResponse`, `SyncPreviewApplyErrorResponse`). Runtime code consumes generated
`components` types from `packages/praxrr-app/src/lib/api/v1.d.ts`; the distributable mirror is
generated into `packages/praxrr-api/openapi.json` and `packages/praxrr-api/types.ts` by
`scripts/bundle-api.ts`.

Issue #234 should follow that direction exactly: define the stable invalidation reason taxonomy and
422 response in OpenAPI first, regenerate with `deno task generate:api-types`, rebuild the package
mirror with `deno task bundle:api`, then type the route and Svelte handling from generated
`components`. Private fingerprints, hashes, configs, and claims must not be added to
`SyncPreviewResult` or any GET response.

### Public snapshot plus private store envelope

`packages/praxrr-app/src/lib/server/sync/preview/store.ts` already keeps preview state process-local
and bounded by TTL. `SyncPreviewStore` owns a private `Map<string, StoredPreview>`, while its public
methods return only `SyncPreviewResult`. `derivePreviewStatus()`, `evaluatePreviewStaleness()`, and
`PREVIEW_STATUS_TRANSITIONS` centralize expiry and lifecycle behavior.

The reviewed binding belongs beside `StoredPreview`, not in the public DTO in
`preview/types.ts`. Extend the store with atomic operations such as `completeGeneration(...)` and
`claimReadyForApply(...)` rather than composing `get()`, `updateResult()`, and `transition()` in the
route. The atomic claim should check expiry, exact lifecycle, binding presence/version, and selected
subset before the single `ready -> applying` transition. Missing private state after restart or
eviction must fail closed and require regeneration.

### One read/transform path, dedicated reviewed execution boundary

`packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts` already provides the ordered,
read-only `generatePreview(input)` path. It resolves the exact sections, creates one explicitly typed
Arr client/cache, applies `sectionConfigs`, calls each registered syncer's `generatePreview()`, and
clears transient config in `finally`. Evidence collection should be attached to this path so preview
and apply revalidation cannot acquire data through divergent readers.

Execution should still have a distinct `executeReviewedSyncJob(input)` next to `executeSyncJob()` in
`packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`. An optional flag on the ordinary job
would incorrectly extend reviewed semantics to schedule, system, canary, and unreviewed manual runs.
The reviewed entry point should reload the instance, verify the exact stored type/scope, claim every
selected section, regenerate all selected evidence, compare all sections, and only then cross the
first-write boundary.

### Explicit Arr and section dispatch

Arr behavior is deliberately closed and explicit:

- `isSyncPreviewArrType()` in `preview/types.ts` accepts only `radarr`, `sonarr`, and `lidarr`.
- `toSyncArrType()` in both `preview/orchestrator.ts` and `jobs/handlers/arrSync.ts` rejects unknown
  types instead of falling back.
- `createArrClient()` in `server/utils/arr/factory.ts` uses a total constructor record and throws on
  an unknown type.
- `SUPPORTED_SYNC_SECTIONS`, `getUnsupportedSyncSectionReason()`, and
  `resolveSyncSectionAvailability()` in `sync/mappings.ts` encode per-Arr section/capability rules.
- `getSection()` in `sync/registry.ts` dispatches through the registered section handlers.

Reviewed apply must re-read the instance and require exact equality with the preview's `instanceId`
and `arrType`. It must pass the exact ordered selected subset through claim, revalidation, and
execution; no sibling-Arr client, mapping, config, or handler fallback is acceptable.

### Fingerprint and value-guard model

`packages/praxrr-app/src/lib/server/pcd/snapshots/fingerprint.ts` is the strongest local fingerprint
precedent. `canonicalRecordForRow()` defines the canonical preimage, `computeStateFingerprint()`
requires an explicitly ordered row set, and `sha256Hex()` uses Web Crypto SHA-256. Its tests in
`src/tests/pcd/snapshots/fingerprint.test.ts` prove empty, null-fallback, forced-state, ordering, and
mutation behavior.

The PCD writer also establishes the compare-before-mutate principle. Value-guarded operations include
the expected current values in their `WHERE` clauses, and `pcd/migration/valueGuardGate.ts` plus
`pcd/ops/writer.ts` fail deterministically on mismatches. Characterization tests such as
`src/tests/pcd/scoring/buildScoringOpsCharacterization.test.ts` assert the old-value guards.

The reviewed binding should reuse these concepts, not these domain-specific representations: closed
versioned projections, deterministic ordering, Web Crypto SHA-256, and comparison before writes.
Keep separate domain-tagged hashes for desired PCD/config evidence, live Arr evidence, and the
rendered plan so `pcd_drift`, `arr_drift`, and combined drift remain distinguishable. A later
write-time re-read needs an immediate old-value guard or reuse of the revalidated prepared value.

### Claims as compare-and-transition guards

`SectionHandler.claimSync()` is implemented by conditional `pending -> in_progress` updates in
`packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`. This is the correct claim shape. However,
`executeSyncJob()` currently calls `setSectionsStatusPending()` first, and the pending setters are
unconditional; they can overwrite an existing `in_progress` claim. `getSectionsInProgress()` in the
apply route is therefore only an advisory preflight, not an authoritative concurrency guard.

Reviewed execution needs an all-selected claim that never calls those unconditional pending setters,
never partially proceeds, and never releases or fails work it did not acquire. Preview single-use is
a separate atomic store claim. Both claims must succeed before revalidation; every selected section
must match before the first snapshot, history record, outcome, or Arr mutation.

## Code Conventions

- Use strict TypeScript discriminated unions and readonly evidence structures. Exhaustive `switch`
  statements already appear in preview summary/section handling and are preferable to stringly typed
  fallbacks.
- Preserve ordered sections. `SYNC_SECTION_ORDER` is the canonical full order; request parsers dedupe
  while retaining caller order. An apply subset may narrow the reviewed list but cannot add or reorder
  entries.
- Keep route adapters thin. `_handleSyncPreviewApplyRequest()` parses and maps HTTP concerns; hashing,
  Arr reads, and execution belong in server modules.
- Keep feature-private code narrow. A pure `preview/reviewBinding.ts` should own canonicalization,
  hashing, comparison, and typed invalidation without importing SvelteKit, the database, Arr clients,
  or the global store.
- Clone and normalize `sectionConfigs` before storing. Use the same stored values during apply-time
  preview regeneration and reviewed execution, and always clear transient config in `finally`.
- Reuse existing semantic collection identity from `preview/sectionDiffs.ts`. Its array-key strategies
  prevent order-only false positives; do not sort every array generically or hash raw upstream bodies.
- Preserve planned-versus-actual separation. `EntityChange` is reviewed plan evidence;
  `SyncEntityOutcome` and `syncHistoryId` are confirmed execution evidence only after writes begin.
- Follow repository formatting: tabs, single quotes, no trailing commas, 100-column Prettier width.

## Error Handling

The apply route already distinguishes request errors, missing previews, lifecycle/claim conflicts,
staleness, and unexpected failures with 400/404/409/422/500. Issue #234 should keep those boundaries
and add a closed typed invalidation response for pre-write rejection.

- Return 422 for expired or invalidated reviewed evidence.
- Return 409 for non-ready/single-use lifecycle conflicts and active section claims.
- Return 404 for missing or evicted previews.
- Reserve 500 for unexpected internal failures or an unverifiable operation that cannot be safely
  classified by the public contract.
- Map evidence mismatch to safe stable reasons (`pcd_drift`, `arr_drift`, combined drift, binding or
  scope drift, or unverifiable review). Never expose hashes, API keys, raw PCD rows, upstream bodies,
  credentials, or caught exception text.
- On every fail-closed pre-write path, produce no `SyncEntityOutcome` and no fabricated sync-history
  row. A rejected review is not an attempted sync.
- Once claimed, an invalidated preview should transition `applying -> failed` and remain terminal.
  Do not return it to `ready` or silently refresh its evidence.

In `SyncPreviewPanel.svelte`, `handleApply()` already preserves a local `applyError`, mirrors feedback
through `alertStore.add(...)`, retains confirmed outcomes on failure, and disables Apply through
`hasApplyPermission`. Typed invalidation should immediately make the local preview non-applicable,
retain the old diff read-only, show a persistent `role="alert"` recovery block stating that nothing was
applied, and direct the operator to generate and review a new preview. `alertStore` remains useful
supplemental feedback, but must not be the only recovery surface. Use “Validating reviewed preview…”
until validation completes; do not imply writes have started.

## Testing Approach

### Pure fingerprint and binding tests

Add table-driven tests for canonical preimages and comparison classification. Cover deterministic
key ordering, semantic collection ordering, meaningful order changes, null versus absence, unsupported
values, binding-version mismatch, PCD-only drift, Arr-only drift, combined drift, and plan-only or
unverifiable mismatch. Assert hashes are never part of public serialized snapshots.

### Store lifecycle and concurrency tests

Test `completeGeneration()` and `claimReadyForApply()` directly with an injected clock, following the
existing deterministic `nowMs` pattern in `SyncPreviewStore`. Prove that ready cannot exist without a
binding, expiry is not extended, only one concurrent apply claim succeeds, an unknown binding version
fails closed, invalidation is terminal, and requesting an ineligible/unreviewed section cannot claim.

### Dependency-injected route tests

Keep the existing seam in
`packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/apply/+server.ts`:
`SyncPreviewApplyDependencies`, `DEFAULT_DEPENDENCIES`, and
`_handleSyncPreviewApplyRequest()`. Replace the injected positional `executeSyncJob` with an
object-based `executeReviewedSyncJob` dependency and retain the injectable clock/progress checks.

`src/tests/base/syncPreviewRouteHardening.test.ts` is the focused home for response-contract,
eligibility, request-size, JSON, stale-age, rate-limit, and capacity cases. Extend it to assert the
exact instance, `arrType`, ordered sections, stored configs, preview ID, and binding reach the reviewed
executor unchanged. For every invalidation/claim/type mismatch, assert the execution/write spy has
zero calls and the typed response directs regeneration.

### Execution-boundary and per-Arr tests

Add focused tests around `executeReviewedSyncJob()` proving:

- all selected claims are acquired before any evidence regeneration or write;
- an existing `in_progress` row remains untouched;
- later-section drift causes zero writes in earlier sections;
- claims are released/failed only when owned by this request;
- revalidation and sync receive identical reviewed `sectionConfigs`;
- instance/type rebinding fails before client or writer calls; and
- Radarr, Sonarr, and Lidarr each use their explicit client, mappings, supported sections, and schema
  semantics without fallback.

Use mutation-style fixtures for write-relevant desired values, mappings, remote IDs/current values,
and config overrides. The proof criterion is not merely a changed hash; it is that a material change
under the same preview ID cannot reach a writer.

### UI and validation gates

Test or statically verify exhaustive typed-reason handling, terminal local invalidation, disabled Apply,
retained reviewed diff, persistent recovery CTA, and safe alert text. The issue's focused gate is:

```bash
deno task test packages/praxrr-app/src/tests/base/syncPreviewRouteHardening.test.ts
```

Also run new binding/store/executor tests, `deno task generate:api-types`, `deno task bundle:api`,
`deno task check`, and the relevant full test task. Contract work is incomplete if generated app and
package artifacts drift from the YAML.

## Patterns to Follow

1. Start at the OpenAPI contract and keep YAML, generated app types, package mirrors, runtime mapping,
   and Svelte interpretation in lockstep.
2. Keep `SyncPreviewResult` public and put the versioned reviewed binding only in the private TTL store
   envelope.
3. Capture preview-time and apply-time evidence through the same `generatePreview()` and concrete
   syncer reads; do not build a second planner.
4. Hash explicit bounded per-section projections with deterministic ordering and separate PCD, Arr,
   and plan domains.
5. Claim the preview atomically, acquire every exact section claim without pending resets, revalidate
   every selected section, then permit the first write.
6. Re-read and verify the exact instance and `arrType`; use existing per-Arr clients, capability maps,
   handlers, and config parsers with no sibling fallback.
7. Preserve exact ordered sections and reviewed transient configs through validation and execution.
8. Treat mismatches as typed terminal invalidation with zero writes, zero outcomes, safe messages, and
   an explicit regenerate-and-review recovery path.
9. Preserve the route's dependency-injection seam and prove negative paths with zero-call spies.
10. Keep planned `EntityChange` evidence distinct from confirmed `SyncEntityOutcome`/history claims;
    equality authorizes an attempt, not a success claim.
