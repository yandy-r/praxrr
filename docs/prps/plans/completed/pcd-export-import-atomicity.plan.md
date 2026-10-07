# Plan: PCD Export/Import Atomicity (YAN-463, YAN-466)

## Summary

Exported draft ops are recorded as a published `source='repo'` batch op that the next `importBaseOps` orphans, silently reverting the export (YAN-463). A failed `importBaseOps` leaves residue: created rows/history survive, `updated_at` drifts, and user ops mutated by the final compile's auto-override are not restored (YAN-466). Fix: tag export batch ops `export_batch: true` and exclude them from `markBaseOrphaned`; make the import failure path restore a full per-database `pcd_ops` snapshot and delete exactly the rows the import's async context created, in one synchronous SAVEPOINT.

## User Story

As a PCD maintainer/operator, I want exported drafts to survive every later import and a failed import to leave `pcd_ops`/`pcd_op_history` exactly as before, so that publishing never silently reverts and the base layer is never a hybrid of old and new repo state.

## Problem → Solution

Batch op orphaned on next import; failed import leaves created rows, history, drifted timestamps and mutated user ops → batch op excluded from orphan sweep by explicit metadata flag; failed import restores every pre-import row column-for-column and deletes only rows created inside the import's async context, atomically.

## Metadata

- **Complexity**: Medium
- **Source PRD**: docs/plans/pcd-export-import-atomicity/feature-spec.md
- **PRD Phase**: N/A
- **Estimated Files**: 6
- **Target release**: next release from `main` (trunk-only, RELEASING.md)
- **Issues**: YAN-463 / #287, YAN-466 / #288

## Batches

| Batch | Tasks    | Depends On | Parallel Width |
| ----- | -------- | ---------- | -------------- |
| B1    | 1.1, 1.2 | —          | 2              |
| B2    | 2.1      | B1         | 1              |
| B3    | 3.1, 3.2 | B2         | 2              |

- **Total tasks**: 5
- **Total batches**: 3
- **Max parallel width**: 2

## Worktree Setup

- **Parent**: /home/yandy/Projects/github.com/yandy-r/praxrr/.config/opencode/worktrees/YAN-463/ (branch: fix/YAN-463-pcd-export-import-atomicity)

---

## UX Design

### Before

Export toast "Exported and pushed N ops", then the change reverts after the next sync/restart. Failed sync logs `Base op import failed: …` and leaves a hybrid DB.

### After

Same toast, change persists. Same error string, DB exactly as before the sync.

### Interaction Changes

None — internal change, no route/component/alert copy changes.

## Mandatory Reading

- `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts` (L340-560: seams, `restoreBaseRepoOpsFromSnapshot`, `importBaseOps`)
- `packages/praxrr-app/src/lib/server/db/queries/pcdOps.ts` (whole file, ~230 lines)
- `packages/praxrr-app/src/lib/server/db/queries/pcdOpHistory.ts` (L100-125 `create`)
- `packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts` (L95-115 `buildMetadataJson`, L625-660 bookkeeping)
- `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts` (L153-164 SAVEPOINT wrapper)
- `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts` (L11-101 AsyncLocalStorage write context)
- `packages/praxrr-app/src/tests/pcd/ops/importBaseOps.test.ts` (L31-53 seams/patch, L1342-1484 #275 restore test)
- `packages/praxrr-app/src/tests/db/syncHistoryQueries.test.ts` (L15-38 `migratedTest` real-DB helper)
- `packages/praxrr-app/src/lib/server/db/migrations/041_create_pcd_ops.ts`, `042_create_pcd_op_history.ts` (FKs)

## External Documentation

| Topic                     | Source                                         | Key Takeaway                                                                                                   |
| ------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| json_extract / json_valid | https://sqlite.org/json1.html#jex              | JSON `true` → 1; missing/NULL → NULL; malformed text THROWS — guard with `CASE WHEN json_valid(...)`.          |
| SAVEPOINT nesting         | https://sqlite.org/lang_savepoint.html         | Nests inside an open transaction; after `ROLLBACK TO` must `RELEASE`. Bare `BEGIN` inside a transaction fails. |
| FK actions                | https://sqlite.org/foreignkeys.html#fk_actions | `pcd_op_history.op_id` ON DELETE CASCADE; `pcd_ops.superseded_by_op_id` NO ACTION (checked per statement).     |
| REPLACE pitfalls          | https://sqlite.org/lang_conflict.html          | Never `INSERT OR REPLACE` to restore — cascades history deletion. Use UPDATE.                                  |

## Patterns to Mirror

### NAMING_CONVENTION

| Pattern                  | File:Lines                       | Snippet                                                                               |
| ------------------------ | -------------------------------- | ------------------------------------------------------------------------------------- |
| Test-only seams          | `importBaseOps.ts:17-19,359-365` | `let compileForTests = compile;` + `__testOnly_setCompile/reset…`                     |
| Metadata JSON snake_case | `exporter.ts:104-112`            | `JSON.stringify({ operation: 'export', entity: 'batch', name, exported_at, op_ids })` |

### ERROR_HANDLING

```ts
// importBaseOps.ts:540-547 — restore, invalidate, rethrow ORIGINAL error
} catch (error) {
  restoreBaseRepoOpsFromSnapshot(databaseId, baseRepoSnapshot);
  invalidate(databaseId);
  throw error;
}
```

### LOGGING_PATTERN

```ts
await logger.error('…', {
  source: 'PCDImporter',
  meta: { databaseId, error: String(e) },
});
```

### REPOSITORY_PATTERN

```ts
// arrSync.ts:153-164 — sync SAVEPOINT, nest-safe
db.exec('SAVEPOINT reviewed_sync_claim');
try {
  const r = operation();
  db.exec('RELEASE SAVEPOINT reviewed_sync_claim');
  return r;
} catch (e) {
  db.exec('ROLLBACK TO SAVEPOINT reviewed_sync_claim');
  db.exec('RELEASE SAVEPOINT reviewed_sync_claim');
  throw e;
}
```

### SERVICE_PATTERN

```ts
// writer.ts:11,39 — AsyncLocalStorage-scoped context
const writeContextStorage = new AsyncLocalStorage<WriteContextFrame[]>();
```

### TEST_STRUCTURE

```ts
// importBaseOps.test.ts:47-53 patch helper; syncHistoryQueries.test.ts:15-38 migratedTest
function patch(target, key, replacement, restores) { … restores.push(() => target[key] = original); }
```

---

## Files to Change

| File                                                            | Action | Justification                                                      |
| --------------------------------------------------------------- | ------ | ------------------------------------------------------------------ |
| `packages/praxrr-app/src/lib/server/db/queries/pcdOps.ts`       | UPDATE | Sweep exclusion; creation recorder; `restoreImportSnapshot` helper |
| `packages/praxrr-app/src/lib/server/db/queries/pcdOpHistory.ts` | UPDATE | `create` reports id to the creation recorder                       |
| `packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts`        | UPDATE | `export_batch: true` in batch metadata                             |
| `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`   | UPDATE | Full snapshot, recorder scope, new rollback                        |
| `packages/praxrr-app/src/tests/pcd/ops/importBaseOps.test.ts`   | UPDATE | Adapt #275 restore test to new rollback seam                       |
| `packages/praxrr-app/src/tests/db/pcdOpsAtomicity.test.ts`      | CREATE | Real migrated-DB tests: sweep matrix + restore helper              |

## NOT Building

- No YAML regeneration on export (follow-up issue).
- No export `filePaths` confinement (follow-up issue, security).
- No legacy unflagged batch-row repair/backfill (follow-up).
- No YAN-465 overrideConflict fix (separate ticket).
- No async `db.transaction()` around the import; no per-PCD mutex; no schema migration; no new `source` enum; no feature flag (nothing user-reachable is unfinished).

---

## Step-by-Step Tasks

### Task 1.1: pcdOps/pcdOpHistory query layer — Depends on [none]

- **BATCH**: B1
- **ACTION**: In `pcdOps.ts`: (a) `markBaseOrphaned` adds `AND (CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.export_batch') ELSE NULL END) IS NOT 1`; (b) add an `AsyncLocalStorage`-based creation recorder: `export function withOpCreationRecorder<T>(fn: () => Promise<T>): { run: Promise<T>; created: { opIds: number[]; historyIds: number[] } }` (or equivalent shape) plus `export function recordCreatedHistoryId(id)`; `pcdOpsQueries.create` pushes its new id when a recorder is active; (c) add `pcdOpsQueries.restoreImportSnapshot(databaseId, snapshot: PcdOp[], created: { opIds: number[]; historyIds: number[] }): void`. In `pcdOpHistory.ts`: `create` calls `recordCreatedHistoryId(id)`.
- **IMPLEMENT**: Restore runs synchronously inside `SAVEPOINT pcd_import_restore` (arrSync pattern) in this order: 1) for each snapshot row, raw `UPDATE pcd_ops SET <every column except id/database_id/created_at> = ?, updated_at = ? WHERE id = ? AND database_id = ?` from snapshot values; 2) `UPDATE pcd_ops SET superseded_by_op_id = NULL WHERE database_id = ? AND superseded_by_op_id IN (<created op ids>) AND id NOT IN (<created op ids>)` (should be no-op after step 1 for snapshot rows; defends rows outside the snapshot); 3) `DELETE FROM pcd_op_history WHERE database_id = ? AND id IN (<created history ids>)`; 4) `DELETE FROM pcd_ops WHERE database_id = ? AND id IN (<created op ids>)`. Chunk IN-lists (≤500 params) if needed. Recorder store is per async context so concurrent unrelated writes are never recorded; nested recorder frames all receive ids. No awaits inside.
- **MIRROR**: REPOSITORY_PATTERN (arrSync SAVEPOINT), SERVICE_PATTERN (writer AsyncLocalStorage).
- **IMPORTS**: `import { AsyncLocalStorage } from 'node:async_hooks';` in `pcdOps.ts`; `pcdOpHistory.ts` imports `recordCreatedHistoryId` from `./pcdOps.ts`.
- **GOTCHA**: `pcdOpsQueries.update` stamps `updated_at = CURRENT_TIMESTAMP` — do NOT use it for restore. Malformed metadata must not throw in the sweep. Exclude only JSON `true` (`IS NOT 1`), not `false`. Scope every statement by `database_id`.
- **VALIDATE**: `deno task check:server`.

### Task 1.2: Exporter batch flag — Depends on [none]

- **BATCH**: B1
- **ACTION**: In `exporter.ts` `buildMetadataJson` add `export_batch: true`.
- **IMPLEMENT**: One field added to the batch metadata object; preview/SQL header unchanged. Comment: marks export batch ops so the YAML import orphan sweep skips them (YAN-463) until export regenerates entity YAML.
- **MIRROR**: NAMING_CONVENTION (metadata snake_case).
- **IMPORTS**: none.
- **GOTCHA**: Only the batch op metadata; do not touch per-entity op metadata.
- **VALIDATE**: `deno task check:server`.

### Task 2.1: importBaseOps rollback — Depends on [1.1, 1.2]

- **BATCH**: B2
- **ACTION**: In `importBaseOps.ts` replace the repo-only snapshot with `pcdOpsQueries.listByDatabase(databaseId)` (all origins/sources/states), taken before `buildImportCache`; run the `try` body (scoped import + `markBaseOrphaned` + `compileForTests`) inside the creation recorder; on failure call `pcdOpsQueries.restoreImportSnapshot(databaseId, snapshot, created)` wrapped in its own try/catch (log restore failure via `logger.error`, never replace the original error), then `invalidate(databaseId)`, rethrow original. Delete `restoreBaseRepoOpsFromSnapshot`.
- **IMPLEMENT**: Keep `finally { importCache.close(); }` and the zero-candidate `else` branch unchanged. Update the doc comment to state the guarantee: all pre-import `pcd_ops` rows of the database restored exactly; rows/history created by the import's async context deleted; registered cache invalidated.
- **MIRROR**: ERROR_HANDLING.
- **IMPORTS**: recorder helper from `$db/queries/pcdOps.ts`.
- **GOTCHA**: Recorder must wrap `compileForTests` too so auto-override-created user ops/history are captured. Keep `Base op import failed:` strings in callers untouched.
- **VALIDATE**: `deno task check:server`; `deno task test packages/praxrr-app/src/tests/pcd/ops`.

### Task 3.1: Adapt importBaseOps unit tests — Depends on [2.1]

- **BATCH**: B3
- **ACTION**: Update the #275 failure-restore test (`importBaseOps.test.ts` ~L1342-1484) to the new seam: patch `pcdOpsQueries.listByDatabase` / `restoreImportSnapshot` instead of `update`; assert restore receives the full snapshot and the ids created during the failed pass (patched `create` must still report to the recorder — call through the real recorder helper). Add one case: compile throws after creating a user op → that op id is in `created.opIds`.
- **IMPLEMENT**: Reuse `patch`, fake-table `Map`, `restores[]` teardown. Keep all other existing tests green without behavior changes.
- **MIRROR**: TEST_STRUCTURE.
- **IMPORTS**: existing.
- **GOTCHA**: Patched `pcdOpsQueries.create` bypasses the recorder; have the fake push via the exported recorder hook or assert through `restoreImportSnapshot` arguments.
- **VALIDATE**: `deno task test packages/praxrr-app/src/tests/pcd/ops`.

### Task 3.2: Real-DB atomicity tests — Depends on [2.1]

- **BATCH**: B3
- **ACTION**: Create `packages/praxrr-app/src/tests/db/pcdOpsAtomicity.test.ts` using the `migratedTest` pattern (real migrated SQLite).
- **IMPLEMENT**: Cases: (1) sweep matrix — stale repo base rows with metadata `{export_batch:true}` stay published; `{export_batch:false}`, missing flag, NULL and malformed metadata are orphaned without SQL error; other database untouched. (2) `restoreImportSnapshot` — seed rows, snapshot, then mutate one (incl. `updated_at`), create a new op + history inside `withOpCreationRecorder`, also create one op OUTSIDE the recorder (concurrent write); call restore → all snapshot rows equal snapshot field-for-field incl. `updated_at`; recorded op/history gone; unrecorded op survives; pre-existing history intact. (3) restore where a snapshot row's `superseded_by_op_id` currently points at a created op → no FK error.
- **MIRROR**: TEST_STRUCTURE (`syncHistoryQueries.test.ts:15-38`).
- **IMPORTS**: `@std/assert`, `$config`, `$db/db.ts`, `$db/migrations.ts`, `$db/queries/pcdOps.ts`, `$db/queries/pcdOpHistory.ts`; a database_instances row may be needed for FK — create via existing query helper.
- **GOTCHA**: `pcd_ops.database_id` FK to database instances — insert parent rows first.
- **VALIDATE**: `deno task test packages/praxrr-app/src/tests/db/pcdOpsAtomicity.test.ts`.

---

## Testing Strategy

### Unit Tests

| Test                  | Input                                                  | Expected Output                   | Edge Case? |
| --------------------- | ------------------------------------------------------ | --------------------------------- | ---------- |
| sweep matrix          | flagged/unflagged/false/NULL/malformed stale repo rows | only flagged stays published      | Yes        |
| restore exactness     | mutated snapshot rows                                  | equal incl. `updated_at`          | No         |
| created-only deletion | recorded + unrecorded inserts                          | recorded deleted, unrecorded kept | Yes        |
| self-FK               | snapshot row superseded_by created op                  | no FK error                       | Yes        |
| importBaseOps failure | compile throws after user op create                    | created id passed to restore      | Yes        |

### Edge Cases Checklist

- [x] Malformed/NULL metadata
- [x] Concurrent same-DB write during import
- [x] Other database rows untouched
- [x] Restore failure does not mask original error
- [ ] Legacy unflagged batch rows (expected still orphan — documented)

## Validation Commands

### Static Analysis

```bash
deno task check:server
deno task lint
```

EXPECT: zero errors

### Unit Tests

```bash
deno task test packages/praxrr-app/src/tests/pcd/ops
deno task test packages/praxrr-app/src/tests/db/pcdOpsAtomicity.test.ts
```

EXPECT: all pass

### Full Test Suite

```bash
deno task test
```

EXPECT: no regressions

### Manual Validation

- [ ] Review diff: no `pcdOpsQueries.update` used for restore; all statements scoped by `database_id`.

## Acceptance Criteria

- [ ] Export batch op metadata contains `export_batch: true`.
- [ ] `markBaseOrphaned` keeps only flagged rows; malformed metadata never throws.
- [ ] Failed import restores every pre-import `pcd_ops` row of the database exactly (incl. `updated_at`) and deletes only rows/history created in its async context.
- [ ] Restore is synchronous, SAVEPOINT-scoped, FK-safe; failure of restore logs and the original error is rethrown; cache invalidated.
- [ ] Existing tests pass; `deno task check` clean.

## Completion Checklist

- [ ] Code follows discovered patterns
- [ ] Error handling matches codebase style
- [ ] Tests follow test patterns
- [ ] No hardcoded values
- [ ] No unnecessary scope additions
- [ ] Self-contained — no questions needed during implementation

## Risks

| Risk                                                    | Likelihood | Impact | Mitigation                                                                              |
| ------------------------------------------------------- | ---------- | ------ | --------------------------------------------------------------------------------------- |
| Restore overwrites a concurrent edit to an existing row | Low        | Medium | Failure path only; documented; per-PCD mutex follow-up                                  |
| Recorder misses an insert path                          | Low        | High   | Only two INSERT sites exist (`pcdOps.create`, `pcdOpHistory.create`) — verified by grep |
| Flag permanently pins an export batch locally           | Medium     | Low    | Accepted until YAML-regen follow-up                                                     |
| Legacy unflagged batches still revert                   | Medium     | Low    | Follow-up repair issue                                                                  |

## Notes

- Follow-up issues to file after merge: export regenerates canonical `entities/*.yaml`; export `filePaths` path confinement (security, `exporter.ts` ~L573); legacy unflagged batch-row repair; YAN-465 sandbox-first override.
- Commit convention: `fix(pcd): … (YAN-463, YAN-466)` with invariants + "New tests:" body.
- Confidence: 8/10.
