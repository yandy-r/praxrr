# Rollback / Point-in-Time Restore (#16) — Implementation Plan

Derived from `design.md` + an adversarial 3-lens design critique (correctness /
integration / scope-contract). The integration lens found a **blocker** (preview must
replay the _reconstructed_ op set, not a naive `id<=N` clamp) which is folded in below.

## Validated mechanism adjustments (must-fixes)

1. **Shared fingerprint canonicalizer** — extract `computeStateHash`'s record builder into
   `pcd/snapshots/fingerprint.ts`; both capture and reconstruct use it byte-for-byte:
   `record = [id, origin, sequence ?? '', state, source, hash].join('|')`, rows
   `ORDER BY id` (single interleaved base+user stream), newline-joined, SHA-256;
   `hash = content_hash ?? sha256(sql + '\n' + (metadata ?? ''))`. `content_hash` is NULL
   for real seed ops → the fallback must be exact or rollback fails-closed. Reconstruct
   serializes with `state` forced to literal `'published'` (matches capture).
2. **Preview == restore == verified set T** _(blocker fix)_ — the snapshot replay cache is
   built from the reconstructed set `T`, threaded as `snapshotOpIds: Set<number>` through
   `loadAllOperations → loadDbOpsByIds → buildReadOnly → withSnapshotCache`. NOT a bare
   `id<=N` clamp over currently-published rows (that omits ops superseded after N while
   verify still passes → preview would misrepresent restore).
3. **Ceiling on raw `pcd_ops.id`**, never `Operation.order`/`sequence` (base drafts get a
   +3e9 offset). Filter rows by id membership before `toOperation`.
4. **Snapshot cache layers** = `{schema, base, tweaks, user}`; never `setCache`, always
   `close()`.
5. **Reconstruct predicate**: `T = id<=N AND state!='draft' AND (superseded_by_op_id > N OR
(superseded_by_op_id IS NULL AND state != 'superseded'))` — includes superseded-after-N
   (datable) + published + undatable dropped/orphaned (optimistic, fingerprint verifies);
   excludes drafts, superseded-before-N, and toxic `superseded + NULL` rows.
6. **Undo uses a datable marker**: `state='superseded', superseded_by_op_id = boundaryId`
   (`MAX(id)` at restore start), so pre-rollback + later snapshots stay reconstructable
   (reversibility). Reactivate → `state='published', superseded_by_op_id=NULL`.
7. **Post-verify + recovery**: after commit+`compile()`, recompute fingerprint; on mismatch
   re-restore the pre-rollback snapshot (`{recovery:true}` guard: skip capture + nested
   recovery), mark `pcd_rollbacks.status='failed'`, surface 500. Before compile, neutralize
   stale `conflicted`/`conflicted_pending` op-history for reactivated ids.
8. **content_hash invariant** documented + regression-tested (for every published op,
   `content_hash === buildContentHash(sql, metadata)`).
9. **Execute from-state guard**: POST body `{ expectedCurrentStateHash }`; mismatch vs live
   hash → `RollbackStaleError` → 422 (mirrors sync preview staleness).
10. **Pre-rollback capture is structurally distinct**: new `SnapshotTrigger 'rollback'`
    (type=`manual` so never pruned); linked via `pcd_rollbacks.pre_rollback_snapshot_id`.
11. **Database-scoped `RollbackPreview`** (no instanceId/arrType); reuses sync
    `EntityChange`/`FieldChange`. Direction `diffToFieldChanges(currentPCD, snapshotPCD)`;
    UI columns "Current" vs "After restore".
12. **Enumerate all entity families** — arr-agnostic {delayProfile, regularExpression,
    customFormat, qualityProfile} + per-arr {naming, mediaSettings, qualityDefinitions}×
    {radarr,sonarr,lidarr} + lidarrMetadataProfile×{lidarr}. No family silently omitted.
13. **PCD-only scope explicit** in response + UI; live-Arr drift via existing drift/sync
    surfaces (honors ROADMAP:152). "Arr changed since snapshot" overlay deferred.
14. **Migrations** (versions > 20260710): `20260711_extend_pcd_snapshot_trigger_rollback`
    (table rebuild per `035` precedent) + `20260712_create_pcd_rollbacks`. Register both.
15. **`getFullDetail` becomes async** (isRestorable needs reconstruct+verify → crypto);
    the existing GET route must `await`.

## Batches (dependency-ordered)

- **B1 foundation**: migrations (2) + register; `snapshots/types.ts` trigger; shared
  `fingerprint.ts`; `db/queries/pcdRollbacks.ts`; `snapshots/rollback/types.ts`; OpenAPI
  contract + bundle + type-gen.
- **B2 building blocks**: op-id set replay (`loadOps` `loadDbOpsByIds` + `cache.ts`
  `buildReadOnly` snapshotOpIds + `layers.ts` `withSnapshotCache`/`withCurrentCache`);
  `snapshots/reconstruct.ts` (reconstruct + verify); `pcdSnapshots` create accepts
  `trigger:'rollback'`; `rollback/entities.ts` (family enumeration + diff).
- **B3 engine**: `rollback/preview.ts` (`previewRestore`); `rollback/restore.ts`
  (`restore` with guard, txn, compile-after-commit, post-verify+recovery).
- **B4 facade + API**: `service.ts`/`index.ts` (async isRestorable + wire preview/restore);
  route files (GET preview, POST execute; existing detail route `await`).
- **B5 UI**: `SnapshotDiff.svelte`; snapshots list page; detail/restore-preview page;
  Snapshots tab.
- **B6 tests**: fingerprint, reconstruct, preview, restore, queries, routes; update the
  existing `service.test.ts` isRestorable expectation.

## Deferred follow-ups (documented in design.md §4)

Selective per-entity rollback; automatic re-sync overlay; "Arr changed since snapshot"
drift overlay in the rollback preview.
