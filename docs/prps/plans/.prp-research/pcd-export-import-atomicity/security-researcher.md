# Security Researcher — PCD Export/Import Atomicity (YAN-463, YAN-466)

Scope: data-integrity of (1) `export_batch: true` metadata flag + `markBaseOrphaned` exclusion, (2) import failure-path full snapshot + watermark delete in one synchronous SQLite transaction. Source: `exporter.ts`, `pcdOps.ts`, `importBaseOps.ts`, `db/db.ts`, `pcdOpHistory.ts` in worktree YAN-463.

## Risks

| Risk                                                                                                                                                                                 | Likelihood | Impact | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo/user crafts `metadata` with `export_batch` to dodge orphaning                                                                                                                   | Low        | High   | `writer.ts:104-136` builds metadata only from typed `OperationMetadata` whitelisted keys — repo YAML cannot reach `export_batch` through the import path, and importer no longer reads `ops/*.sql`. Keep it that way: never serialize raw YAML maps into `pcd_ops.metadata`. Add test: import entity YAML carrying arbitrary extra keys → resulting op metadata has no `export_batch`. Direct DB writes remain trusted boundary. |
| `json_extract` throws on malformed metadata TEXT, breaking the whole sweep UPDATE                                                                                                    | Medium     | Medium | `metadata` is free-form TEXT; `importBaseOps.ts:119-126` `parsePcdOpMetadata` tolerates invalid JSON but SQL `json_extract` raises `malformed JSON` → `markBaseOrphaned` UPDATE fails → import fails on pre-existing junk rows. Predicate must be `NOT json_valid(metadata) OR json_extract(metadata, '$.export_batch') IS NULL` (malformed treated as not-export, still orphaned).                                              |
| Exclusion predicate type confusion (`export_batch: false`/`0`/`"true"` vs absent)                                                                                                    | Low        | Low    | `json_extract(...) IS NULL` only excludes absent key — `false`/`0` rows still orphan (correct). But string `"true"` returns TEXT not 1; if predicate later switches to truthy checks it would over-exclude. Assert in test: `{"export_batch":false}` base op still orphans; only JSON `true` excluded.                                                                                                                           |
| Watermark delete kills concurrent legit rows from other databases                                                                                                                    | Medium     | High   | `pcd_ops.id` and `pcd_op_history.id` are global autoincrements across all DBs; singleton connection interleaves writes from jobs/sync handlers during import's awaits. Delete MUST be `WHERE database_id = ? AND id > ?` on BOTH tables (history has `database_id` column — `pcdOpHistory.ts:7-18`). Bare `id > watermark` deletes other DBs' rows.                                                                              |
| Watermark delete kills same-DB concurrent legit rows (user drafts via API during import awaits)                                                                                      | Medium     | High   | Rows created by any writer during import's await gaps (user draft ops, history from unrelated compiles) also carry `id > watermark` and get deleted on failure-path rollback. Imports are job-serialized but user API writes are not. Prefer recording created-op ids from the repo-import write context over id watermarks; if watermark kept, acceptance test must prove a concurrent same-DB draft survives failure rollback. |
| Nested transaction failure: restore runs `BEGIN` while another `BEGIN` open                                                                                                          | Medium     | Medium | `db.ts:168-178` bare `BEGIN TRANSACTION` throws "cannot start a transaction within a transaction"; failure originating inside `db.transaction()` callers (writer value-guard, pluginRegistry `db.ts` usage) can leave a tx open when catch fires. Use `SAVEPOINT pcd_import_restore` + `RELEASE`/`ROLLBACK TO` (nests safely) or assert no open tx first. Mirror `qualityGoalApplyJournal.ts:51-55` discipline.                  |
| Restore overwrites `updated_at` (and cannot be byte-exact via existing helper)                                                                                                       | High       | Medium | `pcdOps.ts:208` `update()` always stamps `updated_at = CURRENT_TIMESTAMP`; current `restoreBaseRepoOpsFromSnapshot` (importBaseOps.ts:409-435) goes through it. New raw restore SQL must set `updated_at = ?` from snapshot explicitly, inside the sync tx. Acceptance test compares all columns including `updated_at`.                                                                                                         |
| Restoring stale rows clobbers concurrent edits to same rows                                                                                                                          | Low        | Medium | Snapshot rows restored by id overwrite any concurrent mutation landed during import awaits (e.g., user op state change). Scoped to failure path only; per-DB serialization covers job-triggered imports. Document as known gap; follow-up per-PCD mutex (already in spec future work).                                                                                                                                           |
| Restore transaction itself fails → original error masked, partial state left                                                                                                         | Low        | High   | If the restore tx throws, catch block must still `invalidate(databaseId)` and rethrow the ORIGINAL import error (error-string stability rule: `Base op import failed:` unchanged). Wrap restore in its own try/catch, log restore failure, never let it replace the thrown error.                                                                                                                                                |
| Permanent exclusion defeats upstream removal of export commit                                                                                                                        | Medium     | Low    | Flagged batch op never orphans even if the upstream commit is force-pushed away/reverted; local state diverges from repo forever. Exclusion has no lifecycle. Accept as documented (spec: no backfill, no refresh); follow-up canonical-YAML export is the real fix.                                                                                                                                                             |
| Legacy un-flagged export batch rows still orphan (YAN-463 persists for them)                                                                                                         | Medium     | Low    | Rows created before this change lack the flag and keep reverting. Documented in spec edge cases; optional one-time repair op in follow-up.                                                                                                                                                                                                                                                                                       |
| History rows for pre-existing ops created during import (auto-override in final compile) above history watermark deleted, but op-row state changes restored — ordering inside one tx | Low        | Medium | Both delete (history → ops, FK order) and restore must be in the SAME sync transaction, else crash between them leaves hybrid state. Spec already mandates single tx, no awaits inside; keep `db.transaction`'s `await logger.error` (db.ts:221) out of the critical window by using manual begin/commit inline.                                                                                                                 |

## Patterns to Mirror → ERROR_HANDLING

```ts
// importBaseOps.ts:540-547 — restore, invalidate cache, rethrow ORIGINAL error
} catch (error) {
  restoreBaseRepoOpsFromSnapshot(databaseId, baseRepoSnapshot);
  invalidate(databaseId);
  throw error;
}
```

```ts
// pcdOps.ts:215-226 — scoped + parameterized bulk UPDATE (mirror database_id scoping in watermark delete)
return db.execute(
  `UPDATE pcd_ops SET state = 'orphaned', updated_at = CURRENT_TIMESTAMP
   WHERE database_id = ? AND origin = 'base' AND source = 'repo' ...`,
  databaseId,
  seenAt
);
```

```ts
// db/db.ts:213-227 — begin/commit/rollback wrapper; body must be sync for restore tx
this.beginTransaction();
try { const result = await fn(); this.commit(); return result; }
catch (error) { this.rollback(); ... throw error; }
```

```ts
// qualityGoalApplyJournal.ts:51-55 — never hold a bare BEGIN across the writer's async body
// (a bare `BEGIN` held across awaits would sweep unrelated writes into the rollback)
```

```ts
// writer.ts:104-136 — metadata JSON built only from whitelisted typed fields
const payload = {
  operation: metadata.operation,
  entity: metadata.entity,
  name: metadata.name,
};
if (metadata.stableKey) payload.stable_key = metadata.stableKey; // no raw passthrough
```

## Acceptance-Criteria Gotchas

- `updated_at` byte-exact restore is impossible via `pcdOpsQueries.update` (pcdOps.ts:208 stamps CURRENT_TIMESTAMP) — new helper must use raw SQL with explicit `updated_at = ?` inside the tx.
- Sweep predicate needs `json_valid` guard or any malformed `metadata` TEXT row fails the entire `markBaseOrphaned` UPDATE (json_extract raises; JS-side parse tolerates — asymmetry).
- Watermark deletes must scope `database_id` on both `pcd_ops` AND `pcd_op_history` — ids are global across databases on the singleton connection.
- Concurrent same-DB writes during import awaits (user drafts) also land above the id watermark — they get deleted by rollback unless created-ids are tracked explicitly; test must cover this or the criterion "identical to pre-import snapshot" silently widens to "deletes unrelated new rows".
- Nested-tx hazard: restore must use SAVEPOINT (or prove no open BEGIN) — `db.transaction` callers exist in writer/plugin paths.
- Restore-tx failure must not replace the original `Base op import failed:` error string (spec rule 3).
- Exclusion test matrix: flagged batch op survives sweep; `{"export_batch":false}` and un-flagged entity ops still orphan; malformed-metadata repo row still orphans (not crashes).
- Compile auto-override mutations (user-op state + history) must be inside the restored set — failure injected AFTER final compile is the case that proves snapshot width.
- Legacy pre-flag batch rows still orphan — expected, document in test comments so it is not read as regression.
