# Implementation Report: PCD Export/Import Atomicity (YAN-463, YAN-466)

## Summary

Export batch ops carry `export_batch: true` and are exempt from the import orphan sweep, so exported changes survive restart/sync. A failed `importBaseOps` now restores every pre-import `pcd_ops` row of the database column-for-column (incl. `updated_at`) and deletes exactly the ops/history rows created in the import's async context, in one synchronous SAVEPOINT; if the rollback itself fails the database is disabled.

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual |
| ------------- | ---------------- | ------ |
| Complexity    | Medium           | Medium |
| Confidence    | 8/10             | 8/10   |
| Files Changed | 6                | 8      |

## Tasks Completed

| #   | Task                            | Status          | Notes                                                                  |
| --- | ------------------------------- | --------------- | ---------------------------------------------------------------------- |
| 1.1 | pcdOps/pcdOpHistory query layer | [done] Complete | Recorder later moved to `$db/opCreationRecorder.ts` (review F006)      |
| 1.2 | Exporter batch flag             | [done] Complete | Shared `EXPORT_BATCH_METADATA_KEY` constant (review F012)              |
| 2.1 | importBaseOps rollback          | [done] Complete | Added disable-on-rollback-failure (review F002)                        |
| 3.1 | Adapt importBaseOps tests       | [done] Complete | Also adapted `managerImportOrchestration.test.ts` (same snapshot seam) |
| 3.2 | Real-DB atomicity tests         | [done] Complete | Added 650-op chained-delete regression (review F001/F003)              |

## Validation Results

| Level           | Status      | Notes                                                                  |
| --------------- | ----------- | ---------------------------------------------------------------------- |
| Static Analysis | [done] Pass | `deno task check`; Prettier + ESLint clean on changed files            |
| Unit Tests      | [done] Pass | 283 PCD + atomicity tests; 4 new real-DB tests                         |
| Build           | N/A         | No build-affecting changes                                             |
| Integration     | N/A         | Server-only data path covered by real migrated SQLite tests            |
| Edge Cases      | [done] Pass | malformed/NULL metadata, concurrent write survival, cross-DB isolation |

## Deviations from Plan

- Creation recorder lives in `packages/praxrr-app/src/lib/server/db/opCreationRecorder.ts` instead of `pcdOps.ts` (review F006).
- Restore step 2 un-points all rows referencing created ids (no `NOT IN`) to stay within SQLite variable limits (review F001).
- Rollback failure disables the database instance (review F002).

## Issues Encountered

- Worktree lacked `dist/.svelte-kit`; ran `svelte-kit sync` before `svelte-check`.
- Full suite: `arrExternalUrlLayoutPropagation.test.ts` fails without `ARR_CREDENTIAL_MASTER_KEY` (pre-existing, YAN-431).

## Tests Written

| Test File                                                     | Tests     | Coverage                                              |
| ------------------------------------------------------------- | --------- | ----------------------------------------------------- |
| `packages/praxrr-app/src/tests/db/pcdOpsAtomicity.test.ts`    | 4 tests   | Sweep matrix, exact restore, chained delete, cross-DB |
| `packages/praxrr-app/src/tests/pcd/ops/importBaseOps.test.ts` | 1 updated | Rollback receives full snapshot + created ids         |

## Next Steps

- [ ] PR review via `/code-review --parallel <PR>`
- [ ] Follow-ups: canonical YAML export, export `filePaths` confinement, legacy batch-row repair, per-PCD import mutex, YAN-465
