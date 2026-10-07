# PR Review #290 — fix(pcd): keep exports published and roll back failed imports

**Reviewed**: 2026-10-07
**Mode**: PR
**Author**: yandy-r
**Branch**: fix/YAN-463-pcd-export-import-atomicity → main
**Decision**: APPROVE (after fixes)

## Summary

Three-reviewer pass (correctness via @oracle, security, quality) on head `5a2bca9d`. No CRITICAL or HIGH findings. MEDIUM/LOW items fixed in a follow-up commit except where noted. CodeRabbit skipped the review (repository below its automatic-review threshold).

## Findings

### MEDIUM

- **[F001]** `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:516` — After a failed rollback disables the database, `initialize()` still compiles it in the same boot because `compileIfEnabled` reads a stale `instance.enabled`.
  - **Status**: Fixed
  - **Category**: Correctness
  - **Suggested fix**: Re-read `enabled` from the database in `compileIfEnabled`.
- **[F002]** `packages/praxrr-app/src/lib/server/db/queries/pcdOps.ts:297` — Vanished-row throw in `restoreImportSnapshot` untested.
  - **Status**: Fixed
  - **Category**: Completeness
  - **Suggested fix**: Real-DB test asserting the throw and that the savepoint rolled back.
- **[F003]** `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:418` — Rollback-failure branch (disable + original error) untested.
  - **Status**: Fixed
  - **Category**: Completeness
  - **Suggested fix**: Unit test with `restoreImportSnapshot` throwing; assert disable called and original error rethrown.
- **[F004]** `packages/praxrr-app/src/lib/server/db/queries/pcdOps.ts:254` — JSDoc overclaimed exactness; concurrent updates to snapshot rows are reverted.
  - **Status**: Fixed
  - **Category**: Maintainability
  - **Suggested fix**: Document the revert and link YAN-747.
- **[F005]** `docs/` — Research/plan/report artifacts committed with the fix.
  - **Status**: Open
  - **Category**: Pattern Compliance
  - **Suggested fix**: None; matches repository precedent (#270, #272).
- **[F009]** `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:421` — A database disabled by a failed rollback (or a failed cache build) can never be re-enabled from the app; recovery needs a hand edit of SQLite.
  - **Status**: Open
  - **Category**: Completeness
  - **Suggested fix**: Re-enable action on the settings page and API, gated on a successful recompile. Pre-existing gap now reachable from one more path; filed as YAN-748.

### LOW

- **[F006]** `packages/praxrr-app/src/lib/server/db/opCreationRecorder.ts:16` — Recorder silently replaced an outer record if nested; callback needlessly typed async.
  - **Status**: Fixed
  - **Category**: Correctness
  - **Suggested fix**: Throw on nesting; type `fn` as `() => T`.
- **[F007]** `packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts:113` — `ponytail:` comment had no ticket.
  - **Status**: Fixed
  - **Category**: Maintainability
  - **Suggested fix**: Reference YAN-744.
- **[F008]** `packages/praxrr-app/src/tests/pcd/migration/managerImportOrchestration.test.ts:175` — Two patch lines repeated in two tests.
  - **Status**: Open
  - **Category**: Maintainability
  - **Suggested fix**: None (two sites).
- **[F010]** `packages/praxrr-app/src/lib/server/db/queries/pcdOps.ts:267` — Restore prepared statement never finalized.
  - **Status**: Fixed
  - **Category**: Performance
  - **Suggested fix**: `finalize()` in `finally`.
- **[F011]** `packages/praxrr-app/src/lib/server/db/queries/pcdOps.ts:326` — If both `ROLLBACK TO` and `RELEASE` threw, the `RELEASE` error masked the original restore error.
  - **Status**: Fixed
  - **Category**: Correctness
  - **Suggested fix**: Best-effort cleanup in separate try/catch blocks; always rethrow the original error.
- **[F012]** `packages/praxrr-app/src/lib/server/db/queries/pcdOps.ts:244` — `markBaseOrphaned` evaluates `json_valid`/`json_extract` per stale row with no index.
  - **Status**: Open
  - **Category**: Performance
  - **Suggested fix**: None; acceptable at current op volumes.

## Validation Results

| Check      | Result                           |
| ---------- | -------------------------------- |
| Type check | Pass                             |
| Lint       | Pass (changed files)             |
| Tests      | Pass — 284 PCD + atomicity tests |
| Build      | Pass (CI `build`)                |

## Files Reviewed

- `packages/praxrr-app/src/lib/server/db/opCreationRecorder.ts` (Added)
- `packages/praxrr-app/src/lib/server/db/queries/pcdOps.ts` (Modified)
- `packages/praxrr-app/src/lib/server/db/queries/pcdOpHistory.ts` (Modified)
- `packages/praxrr-app/src/lib/server/pcd/core/manager.ts` (Modified)
- `packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts` (Modified)
- `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts` (Modified)
- `packages/praxrr-app/src/tests/db/pcdOpsAtomicity.test.ts` (Added)
- `packages/praxrr-app/src/tests/pcd/ops/importBaseOps.test.ts` (Modified)
- `packages/praxrr-app/src/tests/pcd/migration/managerImportOrchestration.test.ts` (Modified)
