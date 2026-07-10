# Architecture Research: Sync Preview Reviewed-Plan Binding

## System Overview

The current sync-preview path is a read-only projection over the same section registry and concrete
syncers used by normal execution. `POST /api/v1/sync/preview` accepts an instance, ordered sections,
and optional transient `sectionConfigs`; `generatePreview()` creates one explicit Radarr, Sonarr, or
Lidarr client, applies each override through `BaseSyncer.setPreviewConfig()`, calls the section's
`generatePreview()`, clears the override, and returns public `EntityChange` diffs plus coverage and
summary data. `SyncPreviewStore` retains only that public snapshot in a bounded TTL map.

Apply is not currently bound to what was reviewed. The apply route validates lifecycle, age, and the
requested successful-section subset, transitions `ready -> applying`, then calls
`executeSyncJob(instanceId, sections, 'manual', previewId)`. That function first sets all requested
section statuses to `pending`, reloads the instance and saved sync configuration, re-reads PCD/TRaSH
and live Arr state, and invokes the existing writers. The preview ID correlates the later Sync History
run, but neither the private source evidence nor transient preview configuration reaches execution.

The target architecture should preserve the public diff and all existing writers while adding a
private, versioned review binding beside the stored snapshot. Preview generation records bounded,
canonical PCD/config evidence, live Arr evidence, and the material section plan; store completion
publishes `ready` only when the result and binding are installed together. Apply atomically claims the
ready preview, reloads the exact enabled instance, acquires every selected section without resetting
active work, regenerates all selected evidence with the bound configuration, and compares every
section before the first Arr write. Drift or unverifiable evidence terminally invalidates the preview
with zero outcomes and no Sync History run. A match delegates to the existing per-Arr syncers and
retains their confirmed outcomes/history behavior.

## Relevant Components (verified paths)

- `packages/praxrr-app/src/lib/server/sync/preview/types.ts` defines the public lifecycle, Arr type,
  section results, field/entity changes, coverage outcomes, and summary. Private binding material must
  not be added to `SyncPreviewResult`, because `GET` serializes that object directly.
- `packages/praxrr-app/src/lib/server/sync/preview/store.ts` owns TTL, cleanup, lifecycle transitions,
  and the in-memory `Map`. Its `StoredPreview` currently contains only `snapshot`; it is the correct
  boundary for a private `SyncPreviewReviewBinding`, atomic `completeGeneration`, and atomic
  `claimReadyForApply` operations.
- `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts` resolves ordered sections, creates
  one short-lived Arr client, applies transient configs, accumulates partial failures, and closes the
  client in `finally`. It is the shared preview materialization path used to create and later
  re-materialize review evidence.
- `packages/praxrr-app/src/lib/server/sync/preview/reviewBinding.ts` does not exist yet; it should own
  explicit canonical projections, SHA-256 hashing, versioned binding construction, selected-section
  comparison, and typed review invalidation.
- `packages/praxrr-app/src/lib/server/sync/base.ts` stores one preview override and exposes
  `setPreviewConfig`, `clearPreviewConfig`, and `generatePreview`. It is the narrow common seam for an
  optional evidence recorder and for reusing reviewed overrides during execution.
- `packages/praxrr-app/src/lib/server/sync/types.ts` and
  `packages/praxrr-app/src/lib/server/sync/registry.ts` define `SectionType`, `SectionHandler`, handler
  lookup, per-section claims/status methods, config checks, and syncer factories.
- `packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts` already uses
  `getQualityProfilesSyncConfig()` in the shared batch loader for preview and sync. Evidence must cover
  reviewed selections, PCD/TRaSH batches, namespaces, quality mappings, remote custom formats, remote
  quality profiles, and the resulting diff/payload plan.
- `packages/praxrr-app/src/lib/server/sync/delayProfiles/syncer.ts`,
  `packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts`, and
  `packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts` have preview-aware config getters,
  but their `sync()` methods currently read `arrSyncQueries` directly. Reviewed execution must route
  both preview and writes through the same getters. Their evidence respectively covers the selected
  delay profile and live target profile; naming/media settings/quality definitions plus mappings and
  live configs; and Lidarr-only metadata profile, namespace, schema, and remote profiles.
- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts` is the execution boundary. It reloads
  the instance, resolves explicit Arr support/version gates, captures snapshots/history intent, then
  claims and runs sections. A dedicated `executeReviewedSyncJob` belongs here so revalidation happens
  immediately before existing writes while ordinary scheduled/manual/canary execution stays unchanged.
- `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts` implements claims as guarded
  `pending -> in_progress` updates. Its unconditional `set*StatusPending` methods can overwrite
  `in_progress`; reviewed execution must not call the current `setSectionsStatusPending` preamble and
  needs an all-selected claim/release strategy that never resets another run.
- `packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts` validates request size, instance,
  capacity, rate limits, sections, and transient configs, creates `generating`, calls the orchestrator,
  then currently updates the public snapshot to `ready`. It should atomically complete generation with
  the private binding.
- `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/+server.ts` returns the public snapshot
  verbatim and deletes previews; private evidence must remain inaccessible here.
- `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/apply/+server.ts` parses the exact
  eligible subset and maps lifecycle, TTL, conflict, execution, outcome, and history responses. It
  should claim snapshot plus binding and call the reviewed executor instead of `executeSyncJob`.
- `docs/api/v1/paths/sync.yaml` and `docs/api/v1/schemas/sync.yaml` are the contract-first sources for
  create/get/apply and generated response types. Typed `422` invalidation must be defined here before
  regenerating `packages/praxrr-app/src/lib/api/v1.d.ts`, `packages/praxrr-api/types.ts`, and
  `packages/praxrr-api/openapi.json`.
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewTrigger.svelte` sends unsaved
  section form state as `sectionConfigs`. `SyncPreviewPanel.svelte` fetches and renders the old diff,
  applies it, shows outcomes/history, and currently says apply "reruns" sections. It is the recovery
  surface for typed PCD/Arr/both/scope/unverifiable invalidation while retaining the old diff read-only.
- `packages/praxrr-app/src/tests/base/syncPreviewRouteHardening.test.ts` is the current route/store
  acceptance seam for exact section forwarding, lifecycle, TTL, limits, conflicts, outcomes, and
  history. A focused `syncPreviewReviewedPlan.test.ts` should cover canonical binding and comparison,
  with section tests proving config/evidence parity for every explicit Arr path.

## Data Flow

1. The UI sends the exact instance, ordered section selection, and current section form values to
   `POST /api/v1/sync/preview`.
2. The route creates a `generating` snapshot. `generatePreview()` dispatches by the instance's exact
   `arrType`, attaches the transient config and a private recorder to each syncer, reads the relevant
   desired PCD/TRaSH/config state and live Arr state, and produces the existing public section diff.
3. The binding builder canonicalizes only execution-relevant projections. Each successful section
   receives independent `pcdHash`, `arrHash`, and `planHash`; the binding also fixes version,
   `instanceId`, explicit `arrType`, ordered successful sections, and cloned normalized configs.
4. `completeGeneration` installs public result and private binding in one store mutation and performs
   `generating -> ready`. `GET` continues to expose only the public snapshot.
5. Apply parses a non-empty ordered subset of successfully reviewed sections, preserves TTL/body and
   eligibility guards, rejects known active-section conflicts, then `claimReadyForApply` atomically
   performs `ready -> applying` and returns the matching binding. A second apply cannot claim it.
6. `executeReviewedSyncJob` reloads the exact enabled instance and verifies its type and section
   capability. It acquires all selected section claims without first forcing them to pending.
7. Using the bound configs and exact selected subset, it regenerates fresh PCD, Arr, and plan evidence.
   It validates all sections before snapshots, history capture, status completion, or any Arr mutation.
8. Differences classify as `pcd_drift`, `arr_drift`, `pcd_and_arr_drift`, or `scope_drift`; missing,
   ambiguous, unreadable, unknown-version, or plan-only mismatches become `unverifiable_review`.
   Claims are released/failed safely, the preview becomes terminal `failed`, and the route returns a
   sanitized `422` with changed sections/evidence and `regenerateRequired: true`.
9. When every hash matches, the executor invokes the existing writers with the same section configs
   already validated. Only actual writes create `SyncEntityOutcome[]` and a correlated Sync History
   row. Success transitions the preview to `applied`; writer failure preserves confirmed outcomes and
   uses the existing failed response path.

## Integration Points

- Keep evidence capture optional in `generatePreview()` because drift/history and other internal
  callers reuse the orchestrator and must continue receiving the same public result.
- Keep the binding private to `StoredPreview`; API GET, logs, errors, and Sync History should expose
  only safe reason codes and bounded section/evidence classifications, never raw PCD/Arr material.
- Preserve exact selected-section order and never allow reviewed execution's empty/subset input to
  expand through the normal `SYNC_SECTION_ORDER` fallback.
- Preserve explicit Radarr/Sonarr/Lidarr dispatch. Metadata profiles remain Lidarr-only; target type or
  capability change is scope drift, not a sibling-app fallback.
- Separate preview claim from section claims. Store claim provides single-use preview semantics;
  database section claims exclude concurrent syncs. All selected claims and all revalidation must
  precede the first write to avoid partial execution.
- Reuse existing preview-aware config parsers during both revalidation and execution. This is required
  for `SyncPreviewTrigger.svelte`'s unsaved form state to mean the same thing at Apply time.
- Update OpenAPI first, regenerate both app and package artifacts, then update the handler/UI against
  generated types. Keep existing `409` lifecycle/claim and `404` missing/expired behavior; use `422`
  only for review invalidation.
- UI invalidation should preserve the reviewed diff, disable further Apply, focus a `role="alert"`
  recovery region, state that nothing was applied, name the evidence class in text, and direct the
  operator to generate and review a new preview.
- Acceptance coverage must assert zero writer calls, zero outcomes, and no history record for PCD,
  Arr, combined, config, scope, TTL, concurrency, missing-binding, and unverifiable failures; it must
  also prove exact instance, Arr type, section subset, and configs reach the successful write path.

## Key Dependencies

- Deno 2 Web Crypto (`crypto.subtle.digest`) provides SHA-256 without a new package; deterministic
  explicit projections and section-specific collection ordering are still required before hashing.
- `$arr/arrInstanceClients.ts` and concrete Arr clients provide the single explicit per-instance
  connection used for both preview and immediate revalidation.
- `$db/queries/arrInstances.ts` is authoritative for current enabled target identity/type;
  `$db/queries/arrSync.ts` is authoritative for saved configs and section claim/status state.
- `$sync/mappings.ts` supplies `SYNC_SECTION_ORDER`, per-Arr support, and version/capability resolution;
  `$sync/registry.ts` supplies exact section handlers and factories.
- PCD caches, TRaSH hydration/cache readers, namespace queries, and quality API mappings used inside
  the four concrete syncers are material desired-state dependencies and must be recorded beside their
  corresponding transformation reads.
- `$sync/preview/diff.ts` and `$sync/preview/sectionDiffs.ts` define the canonical material public plan
  shape and entity array-key semantics; `planHash` should be derived from the finalized section result,
  not summary counts.
- `$sync/syncHistory/record.ts` and `$sync/types.ts` remain execution-only evidence: planned
  `EntityChange` and confirmed `SyncEntityOutcome` must never be conflated.
- Existing preview TTL, capacity, rate-limit, request-size, lifecycle, and stale-warning constants in
  `preview/store.ts` and `preview/limits.ts` remain unchanged and independently enforced.
