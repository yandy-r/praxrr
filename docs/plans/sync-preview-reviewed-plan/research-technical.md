# Technical Research: Sync Preview Reviewed-Plan Binding

## Executive Summary

Issue #234 closes a real execution-integrity gap. Today preview generation reads the selected
PCD/TRaSH desired state and live Arr state, but apply retains only the public diff snapshot. The
apply route then calls `executeSyncJob(instanceId, sections, 'manual', previewId)`, which re-reads
the saved configuration, PCD caches, and Arr APIs. A reviewed preview can therefore describe one
plan while execution applies another. This is especially visible for `sectionConfigs`: the UI sends
the unsaved form state to preview generation, but that state is neither stored as apply evidence nor
passed to the sync job.

The recommended design is **revalidate-and-execute**, not replaying stored HTTP payloads:

1. Generate an internal, immutable `SyncPreviewReviewBinding` alongside the public preview.
2. Bind each eligible section to three SHA-256 fingerprints: execution-relevant PCD/config inputs,
   execution-relevant live Arr inputs, and the fully rendered section plan.
3. Retain the exact normalized `sectionConfigs` used for review inside the in-memory preview store;
   do not expose raw evidence through `GET /sync/preview/{previewId}`.
4. At the reviewed-sync execution boundary, re-read the target instance and regenerate evidence for
   exactly the requested, successfully previewed sections using the stored configuration and the
   stored explicit `arrType`.
5. Fail closed before any Arr write if PCD evidence, Arr evidence, or the rendered plan differs, or
   if evidence cannot be reproduced unambiguously. Return a typed, safe invalidation reason and
   require a new preview and review.
6. If evidence matches, execute the normal syncers with the same stored section configuration,
   keeping issue #232's confirmed `SyncEntityOutcome[]` and `syncHistoryId` strictly separate from
   the planned preview.

This preserves the existing TTL, eligible-section checks, per-section sync claims, explicit
Radarr/Sonarr/Lidarr dispatch, and normal write implementations. It avoids a parallel “plan replay”
engine, which would duplicate transformations and quickly drift from the real syncers.

## Architecture Design

### Current flow and gap

```text
browser form state
      |
      | POST /sync/preview { instanceId, sections, sectionConfigs }
      v
generatePreview()
  |-- reads PCD/TRaSH/config desired inputs
  |-- reads live Arr inputs
  `-- emits public desired/current EntityChange diff
      |
      v
previewStore: SyncPreviewResult only
      |
      | POST /sync/preview/{id}/apply { sections? }
      v
executeSyncJob(instanceId, sections, "manual", previewId)
  |-- sectionConfigs from review are absent
  |-- re-reads current saved config + PCD + Arr
  `-- writes whatever is current now
```

The `previewId` added by issue #232 correlates plan and run in Sync History, but correlation does not
prove that the correlated plan was the plan executed.

### Recommended flow

```text
POST create preview
      |
      v
generatePreview(..., evidenceRecorder)
  |-- explicit instance.arr_type gate
  |-- section-specific PCD/config evidence
  |-- section-specific live Arr evidence (including detected version/schema where used)
  `-- public section diff
      |
      v
buildReviewBinding()
  |-- canonicalize and SHA-256 per section/evidence class
  |-- hash rendered section plan
  `-- retain normalized sectionConfigs internally
      |
      v
previewStore
  |-- public SyncPreviewResult
  `-- private SyncPreviewReviewBinding
      |
POST apply { sections? }
      |
      | parse -> eligible subset -> TTL -> in-progress check
      v
previewStore.claimReadyForApply()        (single-use atomic preview claim)
      |
      v
executeReviewedSyncJob()
  |-- re-read enabled target instance
  |-- require current arr_type === binding.arrType
  |-- regenerate only selected sections with stored sectionConfigs
  |-- compare PCD, Arr, and plan hashes
  |     | mismatch / missing evidence
  |     `--> no writes; typed 422; preview failed; regenerate + review
  |
  `-- evidence matches
        |
        v
      normal arrSyncHandler/syncers
        |-- same selected sections
        |-- same reviewed sectionConfigs
        |-- existing per-section claimSync guard
        `-- actual SyncEntityOutcome[] + Sync History id (#232)
```

Revalidation belongs in a dedicated `executeReviewedSyncJob` wrapper in
`jobs/handlers/arrSync.ts`, immediately adjacent to the existing execution primitive. Keeping it at
the execution boundary makes it difficult for another caller to accidentally validate and later
execute through unrelated code. The apply route remains responsible for HTTP parsing, TTL, preview
lifecycle, and response mapping.

## Data Models and Contracts

### Private review binding

Add internal types in a new
`packages/praxrr-app/src/lib/server/sync/preview/reviewBinding.ts` (or `review.ts`):

```ts
type SyncPreviewEvidenceClass = 'pcd' | 'arr';

interface SyncPreviewSectionEvidenceHash {
  readonly section: SyncPreviewSection;
  readonly pcdHash: string;
  readonly arrHash: string;
  readonly planHash: string;
}

interface SyncPreviewReviewBinding {
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
```

The binding is not a public API DTO. It must remain in `StoredPreview` beside the public snapshot so
`GET` cannot accidentally serialize source records, remote payloads, or secrets. Only hashes and the
non-secret normalized selection/config overrides need retention. Deep-clone/freeze normalized
config at bind time so subsequent UI object mutation cannot affect server evidence.

`SyncPreviewStoreApi` needs explicit operations rather than exposing the internal map:

- `bindReview(id, binding, nowMs?)`: allowed only while `generating`; persisted atomically with the
  `ready` result, or implemented as `completeGeneration(id, patch, binding, nowMs?)` so a ready
  preview can never exist without binding evidence.
- `getReview(id, nowMs?)`: internal read for diagnostics/tests only.
- `claimReadyForApply(id, sections, nowMs?)`: atomically checks expiry/current `ready` state,
  validates a binding exists, and transitions to `applying`, returning snapshot plus binding.
  Concurrent apply requests must not both pass based on stale copies.

Previews created before this change or fixtures without a binding are **unverifiable** and must not
execute. There is no compatibility fallback to unguarded `executeSyncJob`.

### Evidence capture and canonicalization

Extend the preview-only syncer interface with an evidence recorder rather than placing raw evidence
on `SyncPreviewResult`:

```ts
interface SyncPreviewEvidenceRecorder {
  record(
    section: SyncPreviewSection,
    source: SyncPreviewEvidenceClass,
    key: string,
    value: unknown
  ): void;
}
```

`BaseSyncer` should receive/reset this recorder alongside preview configuration. The orchestrator
adds instance-level evidence and each concrete syncer records values at the point they are read.
The builder canonicalizes object keys, applies section-declared collection sorting, and hashes the
canonical JSON with SHA-256. Do not rely on plain `JSON.stringify` insertion order. Do not globally
drop `id` or other fields: ignore a field only when the corresponding sync comparator or write path
does not use it.

Evidence must cover all inputs that can materially affect the selected write:

| Section            | PCD/config evidence                                                                                                                                              | Arr evidence                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `qualityProfiles`  | normalized reviewed selections; resolved PCD profile/custom-format rows; TRaSH source/cache rows and source `arr_type`; namespace suffixes; quality API mappings | custom formats; quality profiles; target system version/capability data                                          |
| `delayProfiles`    | normalized database/profile selection and selected PCD delay profile                                                                                             | exact per-app target delay profile/list and target version                                                       |
| `mediaManagement`  | normalized subsection selections; selected PCD or TRaSH naming/quality-size/media-settings rows; mappings; source `arr_type`                                     | naming config, media-management config, quality definitions, target version                                      |
| `metadataProfiles` | normalized database/profile selection; selected Lidarr PCD row; namespace suffix                                                                                 | Lidarr metadata schema (including the explicit `null` fallback result), remote metadata profiles, target version |

Evidence arrays must be sorted by the same semantic identities used by preview diffing (names,
quality names, custom-format specification identity, metadata type/status id). Network response
ordering alone must not invalidate a plan.

The per-section `planHash` is computed from the final public section payload plus its successful
`sectionOutcome`. It catches transformation/diff nondeterminism even when source hashes match.
Revalidation is successful only when all three hashes match for every section selected at apply.
Any missing/duplicate/ambiguous evidence is fail-closed.

### Execution context

Add a reviewed-only input, preferably as an object to avoid extending the already positional
`executeSyncJob` signature further:

```ts
interface ExecuteReviewedSyncInput {
  readonly previewId: string;
  readonly instanceId: number;
  readonly arrType: SyncPreviewArrType;
  readonly sections: readonly SectionType[];
  readonly sectionConfigs: Readonly<Partial<Record<SectionType, unknown>>>;
  readonly expectedEvidence: Readonly<
    Partial<Record<SectionType, SyncPreviewSectionEvidenceHash>>
  >;
}
```

`executeReviewedSyncJob(input)` revalidates and either throws a typed
`SyncPreviewReviewInvalidatedError` before writes or invokes the existing sync handler. The job
payload/internal execution context must carry `reviewedArrType` and `sectionConfigs`. Each syncer
must read its reviewed override through the already existing preview-config parser/helper during
this reviewed execution, then clear it in `finally`.

The ordinary scheduler/manual/canary `executeSyncJob` path stays unchanged. There is no implicit
upgrade of unreviewed syncs into reviewed syncs.

### Typed invalidation errors

Use a discriminated server error:

```ts
type SyncPreviewStaleReason =
  | 'ttl_expired'
  | 'pcd_drift'
  | 'arr_drift'
  | 'pcd_and_arr_drift'
  | 'unverifiable_review';

class SyncPreviewReviewInvalidatedError extends Error {
  readonly reason: SyncPreviewStaleReason;
  readonly changedEvidence: readonly SyncPreviewEvidenceClass[];
}
```

If the plan hash differs while both source hashes appear equal, classify it as
`unverifiable_review`; never guess PCD or Arr and never execute. Errors from live reads,
unsupported/changed `arr_type`, a disabled/deleted target, an unavailable PCD cache, or incomplete
fresh section generation are also unverifiable unless the recorder can precisely attribute them.
Messages returned to the UI are fixed safe strings, not raw Arr bodies or serialized section
exceptions. This maintains the failure-redaction boundary and does not reuse confirmed outcome
reasons for pre-execution failures.

## API Design: Requests, Responses, and Errors

### Request

Keep `POST /api/v1/sync/preview/{previewId}/apply` request-compatible:

```json
{ "sections": ["qualityProfiles"] }
```

Omission continues to mean all successfully previewed sections. A supplied list remains a subset
claim against `snapshot.sections` and successful `sectionOutcomes`. Revalidation and execution use
that exact deduplicated ordered list; they must not expand back to all configured sections.

### Success response

Keep `SyncPreviewApplyResponse` unchanged. `results`, confirmed `outcomes`, and `syncHistoryId` are
actual execution evidence from issue #232. `staleWarning` remains the age warning. No plan hash or
raw evidence is needed on the wire.

### Invalidated response

Add a dedicated contract-first schema rather than making existing error fields loosely optional:

```yaml
SyncPreviewApplyInvalidatedResponse:
  type: object
  required:
    [error, code, reason, changedEvidence, regenerateRequired, staleWarning]
  properties:
    error: { type: string }
    code: { type: string, enum: [review_invalidated] }
    reason: { $ref: '#/SyncPreviewStaleReason' }
    changedEvidence:
      type: array
      uniqueItems: true
      items: { type: string, enum: [pcd, arr] }
    regenerateRequired: { type: boolean, const: true }
    staleWarning:
      oneOf: [{ type: string }, { type: 'null' }]
```

Return `422 Unprocessable Entity` for TTL or reviewed-evidence invalidation, matching the repository's
existing rollback from-state guard semantics. Keep `409 Conflict` for lifecycle/claim conflicts
(`not ready`, another apply, section already syncing). Keep `404` for a missing/already-expired
in-memory preview and `500` only for unexpected server failures.

Examples:

```json
{
  "error": "Desired PCD inputs changed after this preview. Generate and review a new preview.",
  "code": "review_invalidated",
  "reason": "pcd_drift",
  "changedEvidence": ["pcd"],
  "regenerateRequired": true,
  "staleWarning": null
}
```

```json
{
  "error": "Live Sonarr state changed after this preview. Generate and review a new preview.",
  "code": "review_invalidated",
  "reason": "arr_drift",
  "changedEvidence": ["arr"],
  "regenerateRequired": true,
  "staleWarning": null
}
```

No invalidated response contains `outcomes` or `syncHistoryId`, because no Arr write was attempted.

Update `docs/api/v1/paths/sync.yaml` so it no longer says apply merely reruns the current saved sync
configuration. Update `docs/api/v1/schemas/sync.yaml` first, then regenerate/bundle:

- `deno task generate:api-types`
- `deno task bundle:api`

This updates `packages/praxrr-app/src/lib/api/v1.d.ts`, `packages/praxrr-api/types.ts`, and
`packages/praxrr-api/openapi.json` in lockstep.

## System Constraints

- **Fail closed:** missing legacy binding, hashing failure, partial fresh preview, source-read error,
  unsupported target, ambiguous source attribution, or nondeterministic plan all block before write.
- **Explicit `arr_type`:** the binding stores `radarr | sonarr | lidarr`; fresh target lookup must
  match exactly. Evidence collection and syncer dispatch use the matching client and per-app
  mappings. Metadata profiles remain Lidarr-only. No sibling fallback is permitted.
- **Selected-section preservation:** only the exact successful reviewed subset may be revalidated
  and executed. No empty-list fallback to `SYNC_SECTION_ORDER` is allowed in reviewed execution.
- **TTL preservation:** the current warning/expiry policy remains. Note that the default store TTL
  is 10 minutes while the hard stale block constant is 30 minutes, so production previews normally
  disappear before that hard block; do not extend TTL as part of this issue.
- **Claim preservation:** keep `getSectionsInProgress` and each handler's `claimSync(instanceId)`.
  Add the atomic preview-store claim so the same preview cannot be applied twice concurrently.
- **No writes during revalidation:** no sync status changes, snapshots, history rows, or Arr writes
  occur until evidence passes. PCD/Arr reads and best-effort version detection must not be mistaken
  for confirmed execution outcomes.
- **Issue #232 separation:** planned `EntityChange` remains intent; only syncer write results create
  `SyncEntityOutcome`. A stale plan produces zero outcomes and no plan-linked run row.
- **Bounded memory:** retain hashes and normalized configs, not complete raw PCD/Arr response blobs.
  Existing capacity and cleanup limits continue to bound the in-memory store.
- **Canonical stability:** order-only API response differences and explicitly volatile fields must
  not cause drift; execution-relevant ids, names, mappings, enabled flags, schema, and managed fields
  must.
- **TOCTOU:** Arr has no general conditional-write/ETag contract. Revalidation must therefore occur
  inside the reviewed execution wrapper immediately before the existing sync handler. This is the
  strongest available guard without replacing all sync writes with app-specific conditional APIs.

## Codebase Changes

### Preview core

- `packages/praxrr-app/src/lib/server/sync/preview/types.ts`
  - Add `SyncPreviewEvidenceClass`, `SyncPreviewStaleReason`, and internal generation/evidence types
    if they are shared across modules.
  - Do not add raw binding material to public `SyncPreviewResult`.
- `packages/praxrr-app/src/lib/server/sync/preview/reviewBinding.ts` (new)
  - Implement canonical serialization, SHA-256 hashing, evidence recording, binding construction,
    selected-section comparison, and `SyncPreviewReviewInvalidatedError`.
  - Export a pure `compareReviewedEvidence(expected, actual, sections)` for focused tests.
- `packages/praxrr-app/src/lib/server/sync/preview/store.ts`
  - Extend `StoredPreview` with private `reviewBinding`.
  - Add atomic `completeGeneration` and `claimReadyForApply`; remove the possibility of `ready`
    without evidence for new previews.
  - Preserve TTL cleanup and transition rules; invalidation transitions `applying -> failed`.
- `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`
  - Accept/create the recorder, capture explicit target identity/version evidence, and return the
    binding with the public result.
  - Revalidation uses `sections` exactly as supplied; it must not re-expand an apply subset.
- `packages/praxrr-app/src/lib/server/sync/base.ts` and
  `packages/praxrr-app/src/lib/server/sync/types.ts`
  - Add recorder attach/read/reset methods to `BaseSyncer`; clear recorder and config in `finally`.

### Section evidence and reviewed config execution

- `packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts`
  - Record configuration, resolved PCD/TRaSH batches, mappings/namespaces, remote custom formats,
    and remote quality profiles in `generatePreview`.
  - Ensure reviewed execution continues through `getQualityProfilesSyncConfig()` so stored config
    overrides, not newly saved selections, are used.
- `packages/praxrr-app/src/lib/server/sync/delayProfiles/syncer.ts`
  - Record selected PCD profile and per-app target profile evidence.
  - Change `sync()` to use `getDelayProfilesSyncConfig()` instead of directly calling
    `arrSyncQueries.getDelayProfilesSync()` when reviewed config is attached.
- `packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts`
  - Record evidence per naming, quality-definitions, and media-settings subsection, including
    PCD-vs-TRaSH source identity and explicit source `arr_type`.
  - Change `sync()` to use `getMediaManagementSyncConfig()` for reviewed execution.
- `packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts`
  - Record Lidarr-only PCD profile/namespace and remote schema/profile evidence.
  - Change `sync()` to use `getMetadataProfilesSyncConfig()` for reviewed execution.

### Apply and execution boundary

- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`
  - Add `executeReviewedSyncJob(input)`.
  - Re-read instance, require `toSyncArrType(instance.type) === input.arrType`, regenerate and
    compare evidence, then call the normal handler with the exact sections/configs.
  - Attach/clear each section config around `syncer.sync()` without changing unreviewed jobs.
  - Never record history or outcomes for a revalidation rejection.
- `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/apply/+server.ts`
  - Replace the dependency on `executeSyncJob` with `executeReviewedSyncJob`.
  - Atomically claim the ready snapshot/binding after request, eligibility, TTL, and in-progress
    checks.
  - Map typed invalidation to the contract-safe 422 response and mark the preview failed.
  - Preserve success/failure outcome forwarding from issue #232.
- `packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts`
  - Persist public result and review binding atomically after successful generation.

### API and UI

- `docs/api/v1/schemas/sync.yaml`
  - Add the stale reason/evidence enums and invalidated response schema.
- `docs/api/v1/paths/sync.yaml`
  - Document binding/revalidation, 422 drift behavior, exact sections, and regeneration.
- Generated files:
  - `packages/praxrr-app/src/lib/api/v1.d.ts`
  - `packages/praxrr-api/types.ts`
  - `packages/praxrr-api/openapi.json`
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte`
  - Parse the typed invalidation response; show PCD, Arr, both, or unverifiable recovery copy.
  - Set the local preview to non-applicable after invalidation, retain the reviewed diff for
    inspection, and state “Generate a new preview and review it before applying.”
  - Replace “Apply reruns…” copy with the reviewed binding/revalidation behavior.
- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte`
  - If needed, handle a `previewInvalidated` event so route state disables further apply attempts
    while the section's existing Preview Sync trigger remains the recovery action.

### Tests

- `packages/praxrr-app/src/tests/base/syncPreviewRouteHardening.test.ts`
  - Add PCD-only, Arr-only, both-sources, unverifiable, explicit `arr_type` mismatch, missing legacy
    binding, and concurrent/double-claim cases.
  - Every invalidation test must assert reviewed execution/write count is exactly zero.
  - Assert selected sections and stored config overrides reach revalidation/execution unchanged.
  - Retain existing TTL, failed-section, body-limit, capacity, and issue #232 response tests.
- `packages/praxrr-app/src/tests/base/syncPreviewReviewedPlan.test.ts` (new)
  - Canonical key/order stability, semantic collection sorting, material field changes, per-section
    subset comparison, source classification, and plan-hash-with-equal-input fail-closed behavior.
- Extend focused section tests where necessary to prove each syncer records both evidence classes
  and uses reviewed config during execution, particularly quality-profile mappings and Lidarr
  metadata schema behavior.

Required validation should include:

```bash
deno task test packages/praxrr-app/src/tests/base/syncPreviewRouteHardening.test.ts
deno task test packages/praxrr-app/src/tests/base/syncPreviewReviewedPlan.test.ts
deno task generate:api-types
deno task bundle:api
deno task check
```

## Technical Decisions

### 1. Revalidate normal sync inputs instead of replaying stored Arr payloads

**Decision:** regenerate evidence with existing per-Arr syncers, then execute the normal write path.

**Rationale:** exact payload replay would require a second execution engine for custom formats,
profiles, bulk quality definitions, singleton settings, namespace matching, and create/update remote
ids. It would bypass current claim/status/history behavior and drift whenever a syncer changes.
Revalidation preserves one transformation/write implementation and still prevents changed reviewed
inputs from executing.

**Rejected alternative:** store `EntityChange` and reconstruct writes from field diffs. Diffs omit
unchanged fields, are display-oriented, and intentionally are not execution proof.

### 2. Hash source-class evidence and the rendered plan

**Decision:** keep separate per-section PCD, Arr, and plan hashes.

**Rationale:** a single plan hash detects change but cannot truthfully tell the user whether desired
PCD evidence or live Arr evidence invalidated review. Two source hashes provide precise recovery
language; the plan hash adds a deterministic transformation guard.

**Rejected alternative:** hash only published PCD ops plus complete Arr JSON. It misses TRaSH cache,
selection, namespace, schema, and mapping inputs, while creating false drift from irrelevant remote
metadata.

### 3. Keep bindings private and ephemeral

**Decision:** store hashes/configs only in `SyncPreviewStore` for the existing TTL.

**Rationale:** this feature needs execution integrity, not a durable plan ledger. Sync History already
holds durable actual outcomes and preview correlation. Private storage also prevents accidentally
turning internal source values into a new API disclosure surface.

**Rejected alternative:** add a database migration for reviewed plans. That expands retention,
cleanup, secrecy, and compatibility scope without being required by #234.

### 4. Use a dedicated reviewed execution entry point

**Decision:** add `executeReviewedSyncJob`, leaving ordinary `executeSyncJob` semantics intact.

**Rationale:** only preview apply has a reviewed binding. Making every scheduler/canary/manual caller
manufacture optional guard fields weakens typing and encourages “guard absent, continue” fallbacks.

### 5. Consume an invalidated preview

**Decision:** once atomically claimed, a drift/unverifiable result transitions `applying -> failed`.

**Rationale:** the user must generate and review again; retrying the same stale evidence cannot make
it valid. The UI may keep displaying it for comparison, but it is no longer applicable.

### 6. Map stale evidence to 422 and claim conflicts to 409

**Decision:** mirror rollback's from-state guard convention.

**Rationale:** the request is syntactically valid and refers to a real preview, but its reviewed
preconditions no longer hold. A wrong lifecycle/concurrent claim remains a state conflict.

## Open Questions

1. **Should a reviewed apply use unsaved section form state?** The current preview endpoint supports
   it, and exact binding therefore requires passing stored overrides into sync. If product intent is
   instead “save before apply,” the API/UI must explicitly reject apply when preview config differs
   from persisted config; silently switching to saved config is not acceptable.
2. **How strict should version evidence be when `getSystemStatus` is temporarily unavailable?** The
   safe default is `unverifiable_review` and no write. Reusing stale `detected_version` would weaken
   the cross-Arr capability guard.
3. **Should order-only changes in an Arr endpoint be material?** Recommended answer is no where the
   existing sync comparator is key-based; every collection needs an explicit canonical sort rather
   than a global array-sort rule.
4. **Can all section sync methods consume the existing preview-config parsers without semantic
   divergence?** Quality profiles already route preview through its helper; delay, media management,
   and metadata currently read saved queries directly in `sync()` and require focused parity tests.
5. **Is the 10-minute store TTL intentional relative to the 30-minute hard stale block?** This issue
   should preserve it, but the 30-minute production branch is effectively unreachable under the
   default store and may deserve a separate cleanup decision.
6. **Should a pre-execution invalidation create a Sync History row?** Recommended answer is no: no
   sync run or Arr write occurred. If durable invalidation auditing is later desired, it should be a
   distinct event type rather than a fabricated confirmed outcome.
