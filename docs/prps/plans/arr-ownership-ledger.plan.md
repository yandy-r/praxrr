# Plan: Arr Ownership Ledger and Opt-in Pruning (YAN-516 / #351)

## Summary

Record the custom formats (CFs) and quality profiles (QPs) Praxrr **creates** in each Arr instance in a new
`arr_managed_entities` ledger. Add a per-instance `prune_removed_managed` policy (default off). With the policy on,
the reviewed sync preview lists ledger-owned entities that are no longer desired as
`action: 'delete', managed: true`. Reviewed apply then deletes exactly those entities (QPs first), after live
id+name guards. Delete outcomes land in sync history; planned managed deletes show up in drift (new `prune` category)
and in Canary evidence. Cleanup is scoped to the ledger by default, with an explicit `includeUnmanaged` mode.

Spec: `docs/plans/arr-ownership-ledger/feature-spec.md` (plus the seven research files). Target: next app release
from `main`.

## User Story

As a Praxrr operator, when I remove a CF or QP from my PCD (or deselect it), I want Praxrr to delete the copy it
created in Arr after I review a preview, without ever touching entities I made by hand.

## Problem → Solution

The syncers never delete, and cleanup flags every unexpected name, including hand-made ones. The fix is
create-only ownership tracking, a fail-closed prune planner, and deletes that run only from the reviewed apply path.

## Metadata

- **Complexity**: Large
- **Source PRD**: N/A (Linear YAN-516 acceptance criteria)
- **PRD Phase**: N/A
- **Estimated Files**: ~30

## Batches

| Batch | Tasks              | Depends On | Parallel Width |
| ----- | ------------------ | ---------- | -------------- |
| B1    | 1.1, 1.2, 1.3, 1.4 | —          | 4              |
| B2    | 2.1, 2.2, 2.3      | B1         | 3              |
| B3    | 3.1, 3.2, 3.3      | B2         | 3              |
| B4    | 4.1                | B3         | 1              |

- **Total tasks**: 11
- **Total batches**: 4
- **Max parallel width**: 4

## Worktree Setup

- **Parent**: /home/yandy/.claude-worktrees/praxrr-feat-yan-516-arr-ownership-ledger (branch `feat/yan-516-arr-ownership-ledger`)

## UX Design

Before: the sync preview shows red "delete" rows for every unmatched Arr entity, but nothing deletes them. Cleanup
lists hand-made CFs as stale.

After:

- Arr instance settings get a "Prune removed managed entities" toggle (off by default, with a warning help text).
- Preview delete rows carry a badge: "Managed by Praxrr — will be deleted" or "Not managed — left untouched".
  QPs that are still in use are listed as "Kept (in use)".
- Sync history shows Deleted outcomes. The drift detail page shows a "Pending removal" group.
- The cleanup modal defaults to managed items and has an "Include unmanaged items" toggle.

## Mandatory Reading

| Priority | File                                                                                                                                     | Why                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| P0       | `packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts:156-204,334-808,1260-1400`                                            | Batches, prepared context, preview, reviewed apply, writers |
| P0       | `packages/praxrr-app/src/lib/server/sync/customFormats/syncer.ts:66-132,241-293`                                                         | CF writer and outcome                                       |
| P0       | `packages/praxrr-app/src/lib/server/sync/cleanup.ts`                                                                                     | Expected-set and keep-namespace rules                       |
| P0       | `packages/praxrr-app/src/lib/server/sync/preview/{types.ts,sectionDiffs.ts,reviewBinding.ts,orchestrator.ts}`                            | `EntityChange`, delete emission, binding version            |
| P0       | `packages/praxrr-app/src/lib/server/sync/drift/{check.ts,types.ts,responses.ts,summary.ts}`                                              | Drift categories                                            |
| P1       | `packages/praxrr-app/src/lib/server/db/queries/canaryRollouts.ts:228-300`                                                                | Field-by-field `EntityChange` decoder                       |
| P1       | `packages/praxrr-app/src/lib/server/db/migrations/20261023_create_arr_trash_guide_namespaces.ts`, `db/migrations.ts`                     | Migration pattern and registration                          |
| P1       | `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`, `routes/arr/[id]/settings/+page.server.ts`                              | Instance policy column                                      |
| P1       | `packages/praxrr-app/src/lib/server/utils/auth/scopePolicy.ts`, `routes/api/v1/sync/preview/[previewId]/apply/+server.ts`                | Token scopes                                                |
| P1       | `packages/praxrr-api/openapi.json` (search `SyncEntityOutcomeAction`, `CleanupScanRequest`, drift category enum, preview `EntityChange`) | Contract-first                                              |

## Patterns to Mirror

- **Migration**: a named object with `version: 20261025`, `name`, and `up`/`down` SQL strings using `IF NOT EXISTS`,
  registered in `db/migrations.ts` (import plus array entry), as in `20261023_create_arr_trash_guide_namespaces.ts`.
- **Query module**: `db.query`/`db.execute`/`db.queryFirst` exported as `xxxQueries` objects, as in
  `db/queries/arrTrashNamespaces.ts` and `arrInstances.ts`.
- **Outcome construction**: the literal `SyncEntityOutcome` objects in `qualityProfiles/syncer.ts:756-765`. Errors go
  through `sanitizeArrWriteError`.
- **Reviewed guard**: throw on mismatch before any write (`qualityProfiles/syncer.ts:716-720`).
- **Tests**: `packages/praxrr-app/src/tests/sync/*.test.ts` (Deno.test plus fake clients; see
  `qualityProfilesReviewedEvidence.test.ts`, `cleanup.test.ts`, `syncEntityOutcomes.test.ts`). The test runner is
  `deno task test <path-or-alias>`.

## Files to Change

| File                                                                                                                                                                           | Action                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `lib/server/db/migrations/20261025_create_arr_managed_entities.ts`                                                                                                             | CREATE                                                  |
| `lib/server/db/migrations.ts`, `lib/server/db/schema.sql`                                                                                                                      | UPDATE                                                  |
| `lib/server/db/queries/arrManagedEntities.ts`                                                                                                                                  | CREATE                                                  |
| `lib/server/db/queries/arrInstances.ts`                                                                                                                                        | UPDATE (policy column; clear ledger on url/type change) |
| `lib/server/sync/ownership/expectedConfig.ts`                                                                                                                                  | CREATE (extracted from cleanup.ts)                      |
| `lib/server/sync/ownership/record.ts`                                                                                                                                          | CREATE                                                  |
| `lib/server/sync/ownership/planPrunes.ts`                                                                                                                                      | CREATE                                                  |
| `lib/server/sync/ownership/executePrunes.ts`                                                                                                                                   | CREATE                                                  |
| `lib/server/sync/cleanup.ts`, `cleanupRequest.ts`, `routes/api/v1/arr/cleanup/+server.ts`                                                                                      | UPDATE                                                  |
| `lib/server/sync/qualityProfiles/syncer.ts`, `qualityProfiles/handler.ts`, `customFormats/syncer.ts`                                                                           | UPDATE                                                  |
| `lib/server/sync/preview/types.ts`, `preview/reviewBinding.ts`                                                                                                                 | UPDATE                                                  |
| `lib/server/sync/types.ts`                                                                                                                                                     | UPDATE (delete comment)                                 |
| `lib/server/sync/drift/*`, `lib/shared/narration/*`, `lib/shared/health/criteria.ts`                                                                                           | UPDATE                                                  |
| `lib/server/db/queries/canaryRollouts.ts`                                                                                                                                      | UPDATE                                                  |
| `lib/server/utils/auth/scopePolicy.ts` or apply route                                                                                                                          | UPDATE                                                  |
| `packages/praxrr-api/openapi.json` + regenerated `lib/api/v1.d.ts`                                                                                                             | UPDATE                                                  |
| `routes/arr/[id]/settings/*`, `routes/arr/[id]/sync/components/SyncPreviewPanel.svelte`, `routes/arr/components/CleanupModal.svelte`, `routes/drift/[instanceId]/+page.svelte` | UPDATE                                                  |
| `docs/site/src/content/docs/guides/syncing-profiles.md`, `docs/site/src/content/docs/app/sync-pipeline.md`                                                                     | UPDATE                                                  |
| `src/tests/sync/ownership*.test.ts`                                                                                                                                            | CREATE                                                  |

(Paths under `lib/` and `routes/` are relative to `packages/praxrr-app/src/`.)

## NOT Building

- Ledger rows or pruning for delay profiles, metadata profiles, naming, media settings or quality definitions.
- Pruning from scheduled, on_pull, on_change, manual unreviewed or Canary runs.
- Backfilling or adopting pre-ledger entities (follow-up: an explicit "adopt" action).
- Preview-time import-list, collection or root-folder in-use checks. Arr's refusal is the backstop, and the outcome
  is `failed` with the row kept (follow-up).
- A security audit-log table (follow-up; history is the record).

## Step-by-Step Tasks

### Task 1.1: Migration, ledger query module, instance policy column — Depends on [none]

- **BATCH**: B1
- **ACTION**: Create the migration `20261025_create_arr_managed_entities.ts` and register it. Append the matching
  table and column to `schema.sql`. Create `db/queries/arrManagedEntities.ts`. Extend `arrInstances.ts`.
- **IMPLEMENT**:
  - SQL `up`:
    - `ALTER TABLE arr_instances ADD COLUMN prune_removed_managed INTEGER NOT NULL DEFAULT 0 CHECK (prune_removed_managed IN (0,1));`
    - Table `arr_managed_entities(instance_id INTEGER NOT NULL REFERENCES arr_instances(id) ON DELETE CASCADE, section TEXT NOT NULL CHECK(section='qualityProfiles'), entity_type TEXT NOT NULL CHECK(entity_type IN ('customFormat','qualityProfile')), remote_id INTEGER NOT NULL CHECK(remote_id>0), arr_name TEXT NOT NULL, pcd_name TEXT NOT NULL, database_id INTEGER NOT NULL CHECK(database_id>0), source_kind TEXT NOT NULL CHECK(source_kind IN ('pcd','trash')), first_synced_at TEXT NOT NULL, last_synced_at TEXT NOT NULL, PRIMARY KEY(instance_id, entity_type, remote_id))`.
  - `down` drops the table and the column (`ALTER TABLE arr_instances DROP COLUMN prune_removed_managed`).
  - Queries, exported as `arrManagedEntitiesQueries`, with types `ManagedEntityType`, `ManagedSourceKind`,
    `ArrManagedEntity` (camelCase):
    - `recordCreated(row)` uses
      `INSERT ... ON CONFLICT(instance_id,entity_type,remote_id) DO UPDATE SET arr_name, pcd_name, database_id, source_kind, last_synced_at`.
      This handles Arr id reuse after a delete+create by Praxrr itself.
    - `touchUpdated(instanceId, entityType, remoteId, arrName, pcdName, at)` is an UPDATE only. It never inserts.
    - `listForInstance(instanceId)`
    - `deleteConfirmed(instanceId, entityType, remoteId)`
    - `clearInstance(instanceId)`
    - `listRemoteIds(instanceId, entityType): Set<number>`
  - `ArrInstance.prune_removed_managed?: number` is added to `arrInstanceSelect`.
  - `UpdateArrInstanceInput.pruneRemovedManaged?: boolean` is added to `collectArrInstanceUpdates`.
  - In `arrInstancesQueries.update`: when `url` or `type` actually changes value, call
    `arrManagedEntitiesQueries.clearInstance(id)`. This is the id-reuse guard for a repointed instance.
- **MIRROR**: Migration and Query module patterns.
- **GOTCHA**:
  - Never rebuild `arr_instances`, because it is an FK target.
  - TRaSH batches carry `databaseId = -source.id`. The ledger stores the positive source id, and the conversion
    happens in record.ts (Task 2.1).
  - Check how other migrations used `DROP COLUMN` (grep `DROP COLUMN` in migrations/). If none did, keep `down`
    table-only and note this.
- **VALIDATE**: `deno task check:server`; a unit test on an in-memory DB covers the upsert, that `touchUpdated` never
  inserts, and that a url change clears the instance's rows.

### Task 1.2: Extract shared expected-set resolver from cleanup.ts — Depends on [none]

- **BATCH**: B1
- **ACTION**: Move the expected-set and keep-namespace computation (`scanForStaleItems` steps up to the stale
  classification) into `lib/server/sync/ownership/expectedConfig.ts`. `cleanup.ts` keeps calling it, with no change
  in behavior.
- **IMPLEMENT**: Export
  `resolveExpectedArrConfig(instanceId, instanceType): Promise<{ expectedQPNames: Set<string>; expectedCFNames: Set<string>; isKept(name: string): boolean }>`.
  `isKept` must encode every existing fail-closed rule exactly:
  - PCD cache unavailable;
  - TRaSH `no_cache` / `transform_failed`;
  - unassigned TRaSH namespace;
  - missing TRaSH profile.

  Log messages stay byte-identical.

- **MIRROR**: The existing cleanup.ts code (move, don't rewrite).
- **GOTCHA**: Do not touch `deleteStaleItems` or the execute path in this task. `cleanup.test.ts` must pass unchanged.
- **VALIDATE**: `deno task test packages/praxrr-app/src/tests/sync/cleanup.test.ts`.

### Task 1.3: OpenAPI contract + type regeneration + preview/drift types — Depends on [none]

- **BATCH**: B1
- **ACTION**: Contract-first edits in `packages/praxrr-api/openapi.json`, then `deno task generate:api-types`. Mirror
  them in the server types.
- **IMPLEMENT**:
  - Preview `EntityChange` schema: optional boolean `managed`, with the description "True only for deletes of
    entities Praxrr created (ownership ledger); only these execute on reviewed apply."
  - The QP preview schema gets an optional `blockedPrunes` array of `{entityType, remoteId, name, reason}`.
  - Update the `SyncEntityOutcomeAction` description: "delete is emitted only for reviewed prunes of ledger-owned
    entities".
  - Add `prune` to the drift category enum and the drift counts schema, and update the descriptions.
  - `CleanupScanRequest` / `CleanupExecuteRequest`: optional `includeUnmanaged` boolean, default false.
  - Server: `preview/types.ts` `EntityChange.readonly managed?: boolean`, plus
    `QualityProfilesPreview.blockedPrunes?: readonly BlockedPrune[]` (an exported interface).
  - `drift/types.ts`: add `'prune'` to the category union and counts.
  - `sync/types.ts`: update the `delete` doc comment.
  - `preview/reviewBinding.ts`: bump `SYNC_PREVIEW_REVIEW_BINDING_VERSION` to 2, with a comment explaining why
    (delete rows now executable).
- **GOTCHA**:
  - Find every exhaustive switch or record over the drift category (narration `DRIFT_CATEGORY_TONE`,
    `resolveDriftCategoryPhrase`, `health/criteria.ts`, `events/types.ts`, `drift/summary.ts`,
    `drift/responses.ts`, `drift/persist.ts`) and add `prune`. A `prune` change must NOT enter `driftSignature`, and
    must not raise the drifted status or alerting.
  - Search tests that pin the binding version.
- **VALIDATE**: `deno task check`; run the drift and preview tests.

### Task 1.4: Canary decoder keeps `managed`/`blockedPrunes`; token scope for prune applies — Depends on [none]

- **BATCH**: B1
- **ACTION**:
  - In `db/queries/canaryRollouts.ts`, have `decodeEntityChange` copy `managed` when it is a boolean (and reject a
    non-boolean value present), and have `decodeQualityProfiles` preserve a valid `blockedPrunes`.
  - In `routes/api/v1/sync/preview/[previewId]/apply/+server.ts`: when the principal is a token and the stored preview
    contains any `managed: true` delete, require the `admin` scope (`hasScope`). Otherwise return 403 with
    `{error:'Forbidden', requiredScope:'admin'}` before claiming the preview.
- **MIRROR**: `scopePolicy.enforceTokenScope` response shape.
- **GOTCHA**: Read how the apply route accesses the principal (`locals`) and the stored preview before claiming it.
  Don't change `scopePolicy.ts` route tables.
- **VALIDATE**: Unit tests: a canary decode round-trip keeps `managed`; the apply route returns 403 for a `sync:apply`
  token on a plan with a managed delete, and passes for `admin`.

### Task 2.1: Ledger writes from confirmed outcomes — Depends on [1.1]

- **BATCH**: B2
- **ACTION**: Create `sync/ownership/record.ts` and call it at every confirmed CF/QP write site.
- **IMPLEMENT**:
  - `recordConfirmedWrite(instanceId, outcome, provenance: {sourceKind:'pcd'|'trash'; databaseId:number; arrName:string})`:
    - only `status==='success'` with a positive integer `remoteId` counts;
    - `action==='create'` → `recordCreated`;
    - `action==='update'` → `touchUpdated` (no insert);
    - `databaseId` is normalized to `Math.abs` for `trash`.
    - It never throws: catch and `logger.error`.
  - Call sites:
    - reviewed CF writes (`syncPreparedQualityProfiles`, using `batch.sourceKind/databaseId` and `payload.name`);
    - reviewed QP writes;
    - unreviewed `syncCustomFormats`: add a `provenance` param with sourceKind/databaseId, passed from `sync()`;
    - unreviewed `syncQualityProfiles`: thread the batch provenance.
  - `arrName` is the suffixed payload name actually written.
- **GOTCHA**: Do NOT derive provenance from names. `writeCustomFormatPayload` stays provenance-free, so record at the
  callers.
- **VALIDATE**: Tests covering: a create inserts a row; an update without a row inserts nothing; an update refreshes
  `last_synced_at`; failed/skipped outcomes leave nothing; a TRaSH id is stored positive.

### Task 2.2: Prune planner + QP in-use check + executor — Depends on [1.1, 1.2]

- **BATCH**: B2
- **ACTION**: Create the pure `sync/ownership/planPrunes.ts`, `sync/ownership/qualityProfileInUse.ts` and
  `sync/ownership/executePrunes.ts`.
- **IMPLEMENT**:
  - `planPrunes({ ledger, expected (from resolveExpectedArrConfig), desiredNames:{cf:Set,qp:Set}, referencedCfNames:Set<string>, liveCustomFormats, liveQualityProfiles, inUseQualityProfileIds:Set<number>|null })`
    returns `{ prunes: PrunePlanItem[]; blocked: BlockedPrune[] }`.

    A row is a candidate only if all of these hold:
    - a live entity has the same id AND `name === row.arrName`;
    - the name is not in the expected set or the desired names;
    - `!expected.isKept(name)`.

    For CFs, the name must also not be in `referencedCfNames` (CFs still scored by any desired profile, or by a
    blocked QP). QPs whose id is in `inUseQualityProfileIds` are blocked with the reason "Quality profile is still
    assigned to media". When `inUseQualityProfileIds === null`, every QP candidate is blocked with the reason "Could
    not verify that the quality profile is unused". Rows with no live match are ignored by the planner.

  - `PrunePlanItem` is `{entityType, remoteId, arrName, pcdName, sourceKind, databaseId}`. QPs are ordered before
    CFs.
  - `qualityProfileInUse(client, arrType)` returns a `Set` of profile ids from the media lists:
    - `radarr`: `getMovies`;
    - `sonarr`: `getAllSeries`;
    - `lidarr`: `getArtists`;
    - any other type: `null`.

    It casts to the concrete client per type (no sibling fallback) and returns `null` on any error.

  - `executePrunes(client, instanceId, arrType, items, liveGuards)` returns `SyncEntityOutcome[]`. For each item it
    re-checks the guard (live id+name from frozen `currentGuards`); a mismatch throws. It then calls
    `deleteQualityProfile` / `deleteCustomFormat`.
    - On success: emit an outcome `{action:'delete', status:'success'}` and call `deleteConfirmed`.
    - On HTTP 404: treat as success (already gone) and drop the row.
    - On any other error: `status:'failed'` with a reason from `sanitizeArrWriteError`; keep the row.
    - The outcome `name` is `pcdName`, `section` is `'qualityProfiles'`, `remoteId` is `String(id)`.
- **GOTCHA**:
  - Reuse `sanitizeArrWriteError`. Do not reuse the cleanup.ts HTTP 500 → "assigned" mapping.
  - Check how `BaseArrClient` errors expose the status (look in `$http` / `$arr/base.ts`).
  - The files must stay under 300 lines each.
- **VALIDATE**: Pure-planner tests for these cases:
  - a hand-made CF with no row is never planned (AC2);
  - id match with a name mismatch is not planned;
  - a kept namespace is not planned;
  - a referenced CF is not planned;
  - an in-use QP is blocked;
  - null in-use blocks all QPs;
  - the order is QP before CF.

  Executor tests with a fake client cover success, 404 and failure.

### Task 2.3: Cleanup scoped to ledger with includeUnmanaged — Depends on [1.1, 1.2, 1.3]

- **BATCH**: B2
- **ACTION**: Thread `includeUnmanaged` through `cleanupRequest.ts` (both arms, strict boolean validation, default
  false), `scanForStaleItems`, `executeCleanup` (the re-scan uses the same flag) and
  `routes/api/v1/arr/cleanup/+server.ts`.
- **IMPLEMENT**:
  - When `!includeUnmanaged`, filter stale items to those whose `(entity_type, id)` is in the ledger
    (`listRemoteIds`). A ledger read failure returns an empty stale list and logs an error.
  - After a successful cleanup delete, call `deleteConfirmed` for the deleted ids (both modes).
  - Find the legacy non-v1 cleanup callers (`grep -rn "scanForStaleItems\|executeCleanup"`), keep them compiling, and
    pass the flag where the UI supplies it.
- **GOTCHA**:
  - YAN-471 invariant: execute deletes only ids returned by the fresh server re-scan under the same scope.
  - The StaleItem shape must expose `id` for both CFs and QPs; check that it does.
- **VALIDATE**: Extend `cleanup.test.ts`: by default a hand-made unexpected CF is not listed; with `includeUnmanaged`
  it is; execute with the default scope cannot delete an unmanaged id.

### Task 3.1: Wire planning into preview and execution into reviewed apply — Depends on [1.3, 2.1, 2.2]

- **BATCH**: B3
- **ACTION**: Modify `qualityProfiles/syncer.ts` (thin calls only) and `qualityProfiles/handler.ts`.
- **IMPLEMENT**:
  - **`generatePreview`**: read the instance policy (`arrInstancesQueries.getById(this.instanceId)?.prune_removed_managed === 1`).
    When the policy is on, load the ledger and resolve the expected config. The `totalProfiles === 0` early return
    must still plan prunes when the policy is on and the ledger is non-empty. In that case fetch the live CFs/QPs
    and record the arr evidence exactly as the normal path does.
    - Record `recordPreviewEvidence('qualityProfiles','pcd','managedLedger', rows)` and `pruneEnabled`.
    - After `diffEntityCollection`, mark a delete change `managed: true` iff `(entityType, remoteId)` is in
      `prunes`.
    - A planned prune whose entity had no delete row (impossible in theory) causes a throw.
    - Put `blockedPrunes` in the result, only when non-empty.
    - Add `materialPlan.prunes: readonly PrunePlanItem[]` (empty when the policy is off).
    - Extend `isQualityProfilesPreparedContext` to require `Array.isArray(materialPlan.prunes)`.
  - **`syncPreparedQualityProfiles`**: after the CF and QP writes, verify that every prune item corresponds to a
    `managed` delete in the reviewed plan (otherwise throw), then run
    `executePrunes(..., context.currentGuards)`, push its outcomes, and count failed deletes in `failedProfiles`-like
    error reporting. Do not count them in `itemsSynced`.
    - Run prunes only if no CF/QP write failed in this run; otherwise skip them with a logged reason, because a
      partial state is unsafe.
  - **Unreviewed `sync()`**: never prunes.
  - **`handler.hasConfig`**: true when the policy is on and `listRemoteIds` is non-empty for either type, even with
    empty selections. Confirm that unreviewed `sync()` with empty selections still no-ops.
- **GOTCHA**:
  - `syncer.ts` is already about 1,458 lines. Put helper logic in `ownership/*`, not here.
  - The preview stays read-only: no ledger writes.
- **VALIDATE**: Integration-style tests extending the `qualityProfilesReviewedEvidence.test.ts` patterns. AC1: with
  the policy on, removing a CF from the PCD → the preview shows a `managed` delete → reviewed apply deletes exactly
  that id and emits a delete outcome. The same scenario with the policy off produces no delete. AC2: a hand-made CF
  is never deleted. The unreviewed path makes no DELETE call.

### Task 3.2: Drift and history surfacing — Depends on [1.3]

- **BATCH**: B3
- **ACTION**: Update `drift/check.ts` `toDriftChange` so that a delete with `managed === true` maps to category
  `prune` and any other delete maps to `unmanaged`. Keep `prune` out of `driftSignature` and the drifted status.
  Update counts, responses, persist, summary, narration and health copy for the new category.
- **IMPLEMENT**: Confirm `syncHistory/record.ts` keeps delete outcomes and that `deriveSyncHistoryStatus` treats a
  failed delete as failure (add a test). No schema change.
- **GOTCHA**: Drift runs preview generation. Because preview now marks managed deletes when the policy is on, drift
  shows "pending removal" automatically.
- **VALIDATE**: Drift tests: a managed delete → `prune` category, signature unchanged. History test: a delete outcome
  is persisted and a failed delete yields partial/failed status.

### Task 3.3: UI — policy toggle, preview badges, cleanup modal, drift group — Depends on [1.1, 1.3, 2.3]

- **BATCH**: B3
- **ACTION**: Svelte 5, no runes, `onclick` handlers.
  1. `routes/arr/[id]/settings`: a "Prune removed managed entities" `Toggle` (find the existing Toggle component),
     persisted through the settings form action into `pruneRemovedManaged`. Help text: "When on, reviewed syncs
     delete custom formats and quality profiles that Praxrr created and that are no longer in your database. You
     always see deletions in the preview first. Items you made in Arr are never touched."
  2. `SyncPreviewPanel.svelte` (and any delete-row renderer): a "Managed — will be deleted" badge for
     `managed === true`, and "Not managed — left untouched" for other deletes. Show the `blockedPrunes` list as
     "Kept (in use)". The destructive confirmation gate should count only managed deletes. Locate how `totalDeletes`
     drives the gate, and compute the managed count client-side from the changes.
  3. `routes/arr/components/CleanupModal.svelte`: an "Include unmanaged items" toggle (default off) passed through
     to scan and execute. The empty-state copy says that only Praxrr-managed items are shown.
  4. `routes/drift/[instanceId]/+page.svelte` and `routes/drift/+page.svelte`: render the `prune` group as "Pending
     removal".
- **GOTCHA**: Find how CleanupModal calls the API (a legacy route or v1) and thread the flag there. Use the dirty
  store if the settings page already uses it.
- **VALIDATE**: `deno task check:client`.

### Task 4.1: Docs — Depends on [3.1, 3.2, 3.3]

- **BATCH**: B4
- **ACTION**: Update `docs/site/src/content/docs/guides/syncing-profiles.md`: a "Pruning removed entities" section
  covering ownership, the default-off toggle, preview-first, in-use QPs, the lack of backfill, and the cleanup scope.
  Add the ledger and the prune step to `docs/site/src/content/docs/app/sync-pipeline.md`.
- **VALIDATE**: `deno task lint` (prettier) passes.

## Testing Strategy

Create `src/tests/sync/ownershipLedger.test.ts`, `ownershipPrunePlan.test.ts` and `ownershipPruneApply.test.ts`.
Extend `cleanup.test.ts`, the drift tests, `syncHistoryRecord.test.ts`, and the canary decode tests.

Edge cases:

- policy off;
- empty ledger;
- id reuse with a different name;
- TRaSH no_cache;
- the last profile deselected;
- an in-use QP;
- a 404 on delete;
- a CF/QP write failure skipping prunes;
- a stale v1 binding rejected;
- a `sync:apply` token rejected for prune plans.

## Validation Commands

```bash
deno task check
deno task lint
deno task test
deno task build
```

## Acceptance Criteria

- [ ] With pruning on, removing a CF from the PCD deletes only the Arr CF Praxrr created, and only after a reviewed
      preview.
- [ ] CFs created by hand are never deleted by pruning.
- [ ] Delete outcomes appear in sync history, drift (`prune`), and Canary evidence.
- [ ] Cleanup defaults to the ledger scope; `includeUnmanaged` restores the legacy scan.
- [ ] check, lint, test and build pass.

## Risks

| Risk                                 | Mitigation                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------- |
| Deleting a hand-made entity          | Create-only ownership; live id + exact name guard; reviewed-only execution |
| Undeterminable desired state         | Shared `isKept` fail-closed resolver                                       |
| In-flight previews after the upgrade | Binding v2 makes them unverifiable, so they must be regenerated            |
| Default cleanup shows fewer items    | UI copy and the includeUnmanaged toggle                                    |
