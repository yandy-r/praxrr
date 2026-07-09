# Rollback / Point-in-Time Restore (Issue #16) — Design

Status: **Design approved (self)** · Scope: **PCD-only whole-database restore + mandatory preview**
Depends on (shipped): #10 PCD State Snapshots · #7 Sync Preview · #15 Drift · #17 Sync History

## 1. Problem & Done-When

When a sync (or subsequent PCD edits) produce undesired results, a user must be able to
restore PCD configuration state to a previously captured snapshot, **after seeing a preview
of exactly what will change**, and then re-sync through the existing sync flow.

Done-When (from the issue): _"restore a known-good PCD state and understand what will be
re-synced."_ Preview is mandatory; the rollback must itself be recorded and reversible.

## 2. Feasibility Spike Result (answers the issue's flagged assumption)

The issue flags _"append-only ops make rollback straightforward"_ as **weak-evidence**.
Spike result (validated against source):

- **Partially refuted.** `pcd_ops` **rows** are append-only — runtime code **never
  hard-deletes** op rows (only migrations do). **But** the `state` column
  (`published|draft|superseded|dropped|orphaned`) is **mutated destructively** across ~7
  write paths (writer supersede / cancel-out, auto-align/drop, override, import orphan).
  The prior state value is lost and `pcd_op_history` is incomplete (cancel-out and
  `markBaseOrphaned` write no history).
- Therefore a naive replay of `id <= snapshot.ops_sequence_max_id AND state='published'`
  is **unsound**: an op that was published at snapshot time but has since been
  superseded/dropped now reads with its new state and would be wrongly excluded.
- **The snapshot already stores the correctness oracle:** `cache_state_hash` is a SHA-256
  fingerprint over the canonical published-op stream at capture time. This lets us
  **reconstruct-and-verify**: derive the candidate published-op set as-of the snapshot,
  recompute the fingerprint, and only proceed if it matches — otherwise **fail closed**.

Conclusion: rollback is feasible **without schema changes to snapshot capture** and
**without touching the 7 destructive-state paths**, by reconstructing + verifying against
the existing fingerprint. This is the KISS path the spike recommended.

## 3. Mechanism — Verified Op-Log Rewind

Restore = make the live set of `state='published'` ops equal the snapshot's published-op
set, generically across **base + user** ops (so it uniformly handles a bad repo pull and
bad user edits). Correctness is **proven by fingerprint equality**, not by faith.

### 3.1 Reconstruct the snapshot's published-op set (as-of `N = ops_sequence_max_id`)

Candidate set `T` = rows where:

```
database_id = :db
AND id <= :N
AND state != 'draft'                              -- draft ops were not "published" at N
AND (superseded_by_op_id IS NULL OR superseded_by_op_id > :N)  -- not superseded *before* N
```

Supersession is the one transition that is soundly datable: an op is superseded **by** a
higher-id op, so `superseded_by_op_id > N` ⇒ it was still published at N. `dropped`/
`orphaned` transitions are **not** datable (no timestamp) — those rows are optimistically
included and the fingerprint check is what rejects an over/under-inclusion.

### 3.2 Verify (fail-closed)

Recompute the canonical fingerprint over `T` **as if each member had `state='published'`**
(matching what `computeStateHash` saw at capture time), using the exact same record layout
(`id|origin|sequence|state|source|content_hash`, newline-joined, SHA-256). If the result
`≠ snapshot.cache_state_hash`, the snapshot is **not safely restorable** →
`isRestorable=false` / preview returns `reconstructable:false` with a clear reason. No
unsound restore is ever applied.

### 3.3 Preview (mandatory, PCD-to-PCD, no live Arr)

Reuse the proven PCD-to-PCD differ path (same one `pcd/resolved/layerDiff` and
`pcd/resolved/compare` already use):

1. Build an **ephemeral, unregistered** snapshot-state cache via a new
   `withSnapshotCache(databaseId, N, fn)` (modeled on `withBaseOnlyCache`), which replays
   ops with an **op-id ceiling** — a new `maxOpId` option threaded through
   `PCDCache.buildReadOnly` → `loadAllOperations` → `loadDbOps`.
2. Current resolved state = the live registry cache (`getCache(databaseId)`), or an
   ephemeral current cache if none is registered.
3. Per sync section / entity type: `listResolvedEntityNames` on both caches +
   `readResolvedEntity` both + `diffToFieldChanges` with **`PORTABLE_ARRAY_KEY_STRATEGIES`**
   → assemble `EntityChange[]` per section, reusing the **existing preview DTOs**
   (`EntityChange`/`FieldChange`/`SyncPreviewSummary`).
   - Direction contract: **snapshot = `desired` (target), current = `current`**. Action
     semantics: entity present in snapshot only ⇒ `create` (re-add), current only ⇒
     `delete`, both-but-changed ⇒ `update`.
4. Also surface `opsWrittenSince` and the fingerprint `reconstructable` flag.

> The `maxOpId` ceiling replay uses current `state` filters and so is itself only
> **candidate** state; the preview is trustworthy **only when §3.2 verification passes**,
> which the preview computes and reports.

### 3.4 Execute (`restore`)

1. **Re-verify** §3.2 (never restore an unverified snapshot).
2. Create a **pre-rollback snapshot** via `createManualSnapshot` (description
   `"Pre-rollback auto-capture before restoring snapshot #<id>"`) so the rollback is itself
   reversible — no new snapshot `trigger` enum needed.
3. In a **single DB transaction**:
   - Append an inert **rollback-boundary marker op** (id > every existing op,
     `state='superseded'`, NULL back-pointer → excluded from compile, fingerprint, AND
     reconstruction). This gives undone ops a _datable_ `superseded_by_op_id` strictly
     greater than any prior op, so the pre-rollback snapshot (and earlier ones) stay
     reconstructable — the key to reversibility. _(This refinement came out of the
     test-driven pass: pointing undone ops at `MAX(id)` fails when the highest op is itself
     undone.)_
   - `undo`: ops currently `state='published'` whose `id ∉ T` → set `state='superseded'`,
     `superseded_by_op_id = markerId`. (Undoes everything written after N, plus anything
     re-published since that wasn't in the snapshot.)
   - `reactivate`: ops in `T` currently not `published` → set `state='published'`,
     `superseded_by_op_id=NULL` (+ a neutralizing `applied` op-history row so recompile
     doesn't re-drop a previously-conflicted op). Restores pre-N ops deactivated since.
   - Insert one **append-only** `pcd_rollbacks` audit row (snapshot_id,
     pre_rollback_snapshot_id, database_id, ops_undone, ops_reactivated, target_state_hash,
     status, created_at).
4. `compile(pcdPath, databaseId)` to refresh the live cache.
5. **Post-verify**: recompute `computeStateHash(databaseId) == snapshot.cache_state_hash`.
   Mismatch ⇒ log error + mark rollback `status='failed'` (should be unreachable given
   pre-verify; defensive).

**Append-only invariant preserved:** no op row is ever deleted; the rollback is recorded as
a new durable audit event (git-revert analogy). State transitions are the same mechanism the
writer already uses when superseding.

## 4. Scope decisions

| Feature (issue bullet)           | This PR          | Rationale                                                                                                                   |
| -------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Restore to snapshot              | ✅ full-database | Core; op-log rewind is whole-DB by nature                                                                                   |
| Preview rollback                 | ✅               | Mandatory; reuses PCD-to-PCD differ                                                                                         |
| Append-only safety               | ✅               | No row deletes; `pcd_rollbacks` audit; pre-rollback snapshot                                                                |
| Re-sync after rollback           | ➡️ existing flow | Rollback changes desired PCD state; user re-syncs via existing sync preview→apply. UI links to it                           |
| Selective (per-entity) rollback  | ⏭️ follow-up     | Op-log rewind is whole-DB; selective needs the append-reverse-ops-per-entity path. Preview DTO is per-section so extensible |
| "Arr changed since snapshot" gap | ⏭️ follow-up     | Reuse `checkInstanceDrift` against restored state as an overlay; not required for Done-When                                 |

PCD-only (not atomic PCD+sync) — matches ROADMAP note _"do not ship restore flows that make
it unclear what will happen on the next sync"_: preview shows the PCD delta; sync is a
separate, already-preview-gated step.

## 5. Surfaces to add / modify

**Server**

- `pcd/database/cache.ts` — add `maxOpId?` to `buildReadOnly({layers, maxOpId})`.
- `pcd/ops/loadOps.ts` — thread `maxOpId` ceiling through `loadAllOperations`/`loadDbOps`
  (filter DB ops `id <= maxOpId`).
- `pcd/resolved/layers.ts` — add `withSnapshotCache(databaseId, maxOpId, fn)`.
- `pcd/snapshots/reconstruct.ts` (new) — derive set `T`, recompute fingerprint, `verify()`.
- `pcd/snapshots/rollback.ts` (new) — `previewRestore(snapshotId)` + `restore(snapshotId)`;
  export via `snapshotService`.
- `pcd/snapshots/service.ts` / `types.ts` — real `isRestorable` in `getFullDetail`.
- `db/migrations/YYYYMMDD_create_pcd_rollbacks.ts` (+ register in `migrations.ts`).
- `db/queries/pcdRollbacks.ts` (new) — `rollbackQueries` (insert/list/getById), mirrors
  `syncHistoryQueries`.

**API (contract-first)**

- `docs/api/v1/paths/pcd-snapshots.yaml` — `previewSnapshotRollback` (GET
  `.../rollback/preview`), `executeSnapshotRollback` (POST `.../rollback`).
- `docs/api/v1/schemas/pcd-snapshots.yaml` — `RollbackPreview`, `RollbackResult`.
- Regenerate `v1.d.ts` (not CI-gated; avoid committing tool-version noise) + bundle
  `packages/praxrr-api/openapi.json` (prettier-gated → `prettier --write`).
- Routes: `.../snapshots/[snapshotId]/rollback/+server.ts` (POST execute),
  `.../snapshots/[snapshotId]/rollback/preview/+server.ts` (GET preview). Reuse the
  `parsePositiveInteger` + `validateDatabaseExists` + ownership idiom verbatim.

**UI (Svelte 5, no runes)**

- `routes/databases/[id]/snapshots/+page.{svelte,server.ts}` — snapshots list (KPI cards,
  Table, Create + per-row Restore/Delete).
- `routes/databases/[id]/snapshots/[snapshotId]/+page.{svelte,server.ts}` — detail +
  restore preview (diff) + danger confirm `Modal`.
- `client/ui/snapshots/SnapshotDiff.svelte` — mirror `SyncHistoryDiff.svelte`.
- Add a "Snapshots" tab to `routes/databases/[id]/+layout.svelte`.

## 6. Correctness argument (why this is safe)

1. **Sound or refuse.** Restore proceeds only when the reconstructed fingerprint equals the
   snapshot's stored fingerprint. Any imprecision in reconstruction (undatable drop/orphan
   transitions, draft→publish) changes the fingerprint ⇒ refusal, never a wrong restore.
2. **Idempotent.** Restoring to the current state (opsWrittenSince=0, sets `undo`/
   `reactivate` empty) is a verified no-op.
3. **Reversible.** A pre-rollback snapshot captures the state you're leaving; the same
   rollback machinery can restore it.
4. **Auditable.** Every rollback appends a `pcd_rollbacks` row; nothing is deleted.
5. **Generic.** Operates on op membership, not per-entity semantics ⇒ no FK-ordering or
   per-entity-type gaps; base + user handled uniformly.

## 7. Test plan (unit, in-memory SQLite, mirrors `tests/pcd/snapshots`)

- reconstruct: exact set membership for supersede-before/after-N, draft exclusion; fingerprint
  match ⇒ verify true; tampered op ⇒ verify false.
- preview: create/update/delete/unchanged EntityChange for CF + quality profile; direction
  (snapshot=desired); empty diff when opsWrittenSince=0.
- restore: undo ops after N; reactivate an op superseded after N; post-restore fingerprint ==
  snapshot; pre-rollback snapshot created; `pcd_rollbacks` row written; refuse when
  unverifiable; no op rows deleted (row count monotonic).
- isRestorable: false for legacy/unverifiable, true for reconstructable.
- queries/migration: `pcd_rollbacks` insert/list; migration up creates table + indexes.
