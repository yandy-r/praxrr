# PR #100 Review: feat(pcd): complete phase-2 pcd data migration rollout

**PR:** [#100](https://github.com/yandy-r/praxrr/pull/100) **Branch:** `feat/pcd-data-migration-2`
-> `dev` **Date:** 2026-02-23 **Reviewers:** code-reviewer, silent-failure-hunter, pr-test-analyzer,
type-design-analyzer, comment-analyzer

## Summary

Phase 2 of PCD data migration: promotes migration metadata and hybrid SQL/entity handling into
first-class runtime behavior. Aligns portable contracts, OpenAPI schemas, and runtime types. Adds
migration converter/parity tooling and rollout documentation.

**Scope:** 816 files changed (761 entity YAML data files + ~28 core code files + docs), 38,275
additions, 240 deletions, 15 commits.

---

## Critical Issues (6 found) -- Must fix before merge

### C-1. Overly broad fallback catch masks non-migration errors

- **Source:** silent-failure-hunter
- **File:** `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:416-435`
- **Status:** [x] Fixed

When `pcdMigrationAllowLegacyFallback` is enabled, the catch block in
`importBaseOpsWithOrchestration` catches **all** errors -- not just `MigrationReaderError`.
Filesystem permission errors, SQLite corruption, OOM, or any unexpected failure silently falls back
to SQL-only mode and returns `true` (success). The caller has no indication that hybrid ingestion
failed.

**Fix:** Restrict the catch to `MigrationReaderError` only:

```typescript
} catch (error) {
  if (!config.pcdMigrationAllowLegacyFallback || !(error instanceof MigrationReaderError)) {
    throw error;
  }
  // Only fall back for reader-specific issues
  await logger.warn('Hybrid base-op ingestion failed; falling back to SQL-only path', { ... });
  await importBaseOps(databaseId, localPath, { pcdMigrationIngestionMode: 'sql-only' });
  return true;
}
```

**Validation result:**

- Updated `importBaseOpsWithOrchestration` to rethrow when `pcdMigrationAllowLegacyFallback` is
  disabled or when the thrown error is not a `MigrationReaderError`.
- When `pcdMigrationAllowLegacyFallback` is enabled and the failure is `MigrationReaderError`,
  fallback remains for SQL-only mode.
- `packages/praxrr-app/src/lib/server/pcd/core/manager.ts`

---

### C-2. sync() triggers arr syncs after failed base-op import

- **Source:** silent-failure-hunter
- **File:** `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:174-203`
- **Status:** [x] Fixed

When `importBaseOpsWithOrchestration` fails during sync, the code continues to: (1) seed built-in
base ops, (2) update `last_synced_at`, (3) recompile cache with stale data, (4) trigger arr syncs to
Radarr/Sonarr -- all before returning `success: false`. The arr sync at line 195 pushes data derived
from a failed import to production arr instances.

**Fix:** Move the failure check immediately after the import attempt, or at minimum before
`triggerPullSync`. Do not trigger arr syncs when base-op import has failed.

**Validation result:**

- `sync()` now returns early with `success: false` when base-op import fails, and stops before
  calling `seedBuiltInBaseOpsWithOrchestration`, `compileIfEnabled`, and `triggerPullSync`.
- `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:174-203`

---

### C-3. OpenAPI `v1.d.ts` missing `PortableLidarrNaming` in data unions

- **Source:** type-design-analyzer
- **File:** `packages/praxrr-app/src/lib/api/v1.d.ts:654-694`
- **Status:** [x] Fixed

The runtime `PortableEntityData` union includes `PortableLidarrNaming` (10 members), but the OpenAPI
`ExportResponse.data` and `ImportRequest.data` unions omit `PortableLidarrNaming` and
`PortableLidarrMetadataProfile`. This violates the project's Portable Contract Fidelity rule:
"OpenAPI portable schemas, runtime validators, and entity payload handlers must stay in lockstep."

**Fix:** Update the OpenAPI spec to include `PortableLidarrNaming` (and
`PortableLidarrMetadataProfile` if applicable) in both data unions, then regenerate `v1.d.ts`.

**Validation result:**

- Updated `packages/praxrr-app/src/lib/api/v1.d.ts` data unions and added matching schema entries
  for `PortableLidarrNaming`/`PortableLidarrMetadataProfile` (regeneration is currently blocked by
  unrelated OpenAPI `$ref` resolution failures in `docs/api/v1/openapi.yaml`).
- `ExportResponse.data` and `ImportRequest.data` unions now include `PortableLidarrNaming` and
  `PortableLidarrMetadataProfile`.
- `packages/praxrr-app/src/lib/api/v1.d.ts`

---

### C-4. Module-level mutable `writeContextStack` is unsafe for concurrent requests

- **Source:** code-reviewer
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts:36`
- **Status:** [x] Fixed

`writeContextStack` is a module-level mutable array used as a call-stack for write context frames.
If two database imports run concurrently (parallel PCD syncs, user import during startup), they
share and corrupt this stack. One request's `push` could interleave with another's `pop`, causing
wrong write context to apply.

**Fix:** Replace with `AsyncLocalStorage` to scope write context per async execution chain, or pass
context explicitly through function parameters.

**Validation result:**

- Replaced module-level stack with `AsyncLocalStorage<WriteContextFrame[]>` in
  `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts`.
- `withRepoImportWriteContext` now scopes context via `writeContextStorage.run(...)`, preventing
  cross-request stack corruption.

### C-5. YAML sequence collision potential with complex entities

- **Source:** code-reviewer
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:18-19, 463`
- **Status:** [x] Fixed

`YAML_SEQUENCE_STRIDE` of 1,000 per entity means if a single entity deserializer emits >1,000 SQL
operations, its sequences collide with the next entity's range. Quality profiles with many groups,
qualities, custom format scores, tags, and languages could approach this.

**Fix:** Increase `YAML_SEQUENCE_STRIDE` (e.g., to 10,000 or 100,000), or add a runtime guard that
throws if `nextIndex >= YAML_SEQUENCE_STRIDE`.

**Validation result:**

- Increased `YAML_SEQUENCE_STRIDE` to `10_000` in
  `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`.
- Added guard in `consumeRepoImportIdentity`
  (`packages/praxrr-app/src/lib/server/pcd/ops/writer.ts`) to throw if a migration entity emits
  `>= YAML_SEQUENCE_STRIDE` operations.

---

### C-6. Misleading comment contradicts actual behavior

- **Source:** comment-analyzer
- **File:** `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:482`
- **Status:** [x] Fixed

Comment says "Log error but don't fail the surrounding operation" but the code at lines 487-488
reads `if (failOnError) { throw error; }`. When `failOnError=true` (the default and only current
usage), the operation **does** fail. The comment describes the opposite of what happens.

**Fix:** Replace with:
`// Log the error, then either re-throw (failOnError=true) or return zero stats.`

**Validation result:**

- Updated comment in `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:482` to match runtime
  control flow.

---

## High Issues (6 found) -- Should fix before merge

### H-1. `parseMetadata` silently returns null on JSON parse failure

- **Source:** silent-failure-hunter
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts:418-425`
- **Status:** [x] Fixed

The function catches all JSON parse errors and returns `null` with zero logging. Corrupted metadata
in existing operations prevents the supersede mechanism from working, allowing duplicate operations
to accumulate.

**Fix:** Added debug-level logging on parse failures in `parseMetadata` with raw-metadata preview
and error details, matching the `cancelOutCreate` metadata parse diagnostics path.

---

### H-2. `importBaseOps` silently returns success when base ops path missing

- **Source:** silent-failure-hunter
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:322-325`
- **Status:** [x] Fixed

If the base ops directory does not exist, the function returns zero-count success with no logging. A
mis-cloned or corrupted repository silently produces an empty import.

**Fix:** Added a warning log when the base ops path is missing, including import mode/database
context. Kept import to continue (to preserve non-fatal behavior) while surfacing the failure
explicitly.

---

### H-3. Hybrid mode silently drops ALL SQL entries with no warning

- **Source:** silent-failure-hunter
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:386-396`
- **Status:** [x] Fixed

When `isHybridIngestion && !allowLegacySqlInHybrid`, `effectiveSqlEntries` is `[]` with only a
debug-level log. If migration candidates are also empty, the user loses all SQL ops AND all entity
ops, resulting in a completely empty import that reports success.

**Fix:** Added a warning when hybrid import evaluates to zero effective SQL entries and zero
migration candidates, ensuring zero-op import is visible rather than silently succeeding.

---

### H-4. Deserialization result uses loose duck-typing

- **Source:** silent-failure-hunter
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:467-482`
- **Status:** [x] Fixed

If `deserialize` returns `undefined`, `null`, or an object without a `success` field, all are
silently treated as success. A malfunctioning deserializer would increment `migrationImported`
without writing data.

**Fix:** Added a `DeserializeResult` type and strict return-shape validation before treating a
migration entity import as successful.

---

### H-5. `switchBranch` updates syncedAt after failed import

- **Source:** silent-failure-hunter
- **File:** `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:252-266`
- **Status:** [x] Fixed

After a branch switch, if base-op import fails, the function continues to seed built-in ops and call
`updateSyncedAt`, marking the sync as successful. The cache is in an inconsistent state.

**Fix:** Added an early return on failed base-op import so built-in seed and `updateSyncedAt` are
skipped when the branch import fails.

---

### H-6. Stale JSDoc on base layer state description

- **Source:** comment-analyzer
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts:510-515`
- **Status:** [x] Fixed

JSDoc says "For base layer: inserts a draft base op" but after the refactoring, base ops are
inserted as `state: 'published'` with `source: 'repo'` when a `repoImport` write context is active.

**Fix:** Updated the JSDoc to reflect base-layer differences for repo imports (`published`) versus
local imports (`draft`).

---

## Important Issues (15 found) -- Should address

### I-1. Duplicated `ENTITY_IMPORT_ORDER` constant

- **Source:** code-reviewer, comment-analyzer
- **Files:** `importBaseOps.ts:22-36`, `parityVerifier.ts:100-115`
- **Status:** [ ] Open

Same constant defined independently in two files. Per Portable Contract Fidelity, shared constants
should be defined once to prevent silent contract drift.

**Fix:** Extract to a shared module.

---

### I-2. Duplicated `sortMigrationCandidatesByImportOrder` function

- **Source:** code-reviewer
- **Files:** `importBaseOps.ts:272-284`, `parityVerifier.ts:391-401`
- **Status:** [ ] Open

Same logic duplicated. Same drift risk as I-1.

---

### I-3. Duplicated `formatStableJson` function

- **Source:** code-reviewer
- **Files:** `parityVerifier.ts:135`, `verify-pcd-parity.ts:319`
- **Status:** [ ] Open

---

### I-4. Duplicate `MigrationEntityStableIdentity` definitions

- **Source:** type-design-analyzer
- **Files:** `reader.ts` (with `kind: 'stable'`), `enumerateEntities.ts` (without `kind`)
- **Status:** [ ] Open

Two structurally incompatible interfaces share the same name. Consolidate into a single canonical
definition.

---

### I-5. `verify-pcd-parity.ts` binds `db.close` without preserving `this` context

- **Source:** code-reviewer
- **File:** `scripts/verify-pcd-parity.ts:67`
- **Status:** [ ] Open

`db: { close: dbModule.db.close }` may lose `this` context. Compare with `convert-pcd-to-yaml.ts:70`
which uses `db: { close: () => dbModule.db.close() }`.

**Fix:** Use arrow wrapper for consistency.

---

### I-6. `resolveConflictStrategy` falls back to 'override' instead of throwing

- **Source:** silent-failure-hunter
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts:171-184`
- **Status:** [ ] Open

An invalid conflict strategy silently corrects to 'override' (the most destructive strategy). Per
CLAUDE.md: "ALWAYS throw errors early and often. Do not use fallbacks."

---

### I-7. `deriveSqlStableIdentity` bare catch loses error context

- **Source:** silent-failure-hunter
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:140-151`
- **Status:** [ ] Open

Throws generic "Malformed SQL metadata JSON" with no context about which file or the actual parse
error.

---

### I-8. Ephemeral database instances could leak on cleanup error

- **Source:** silent-failure-hunter
- **File:** `packages/praxrr-app/src/lib/server/pcd/migration/parityVerifier.ts:377-399`
- **Status:** [ ] Open

If `invalidate` throws in the `finally` block, `databaseInstancesQueries.delete` never executes.

---

### I-9. Empty catch blocks in CLI scripts (7 instances)

- **Source:** silent-failure-hunter
- **Files:** `convert-pcd-to-yaml.ts:422,450,456,571`, `verify-pcd-parity.ts:304,312,514`
- **Status:** [ ] Open

Per CLAUDE.md, empty catch blocks are not acceptable even in cleanup contexts. Add `console.error`.

---

### I-10. `link()` cleanup catch discards errors

- **Source:** silent-failure-hunter
- **File:** `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:109-113`
- **Status:** [ ] Open

Nested empty catch in cleanup path. Repeated failed link attempts could fill disk with orphaned PCD
clones.

---

### I-11. `writeOperationsFromSqlOperations` returns `success:false` for missing instance

- **Source:** silent-failure-hunter
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts:524-526`
- **Status:** [ ] Open

A missing database instance is a precondition violation that should throw, not return a soft
failure.

---

### I-12. `ParityDiff` should be a discriminated union

- **Source:** type-design-analyzer
- **File:** `packages/praxrr-app/src/lib/server/pcd/migration/parityVerifier.ts`
- **Status:** [ ] Open

Optional `field`/`valueA`/`valueB` fields should be correlated with `kind` at the type level.

---

### I-13. Missing hybrid ingestion precedence documentation

- **Source:** comment-analyzer
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:386-396`
- **Status:** [ ] Open

The three-way branching logic for SQL entry survival in hybrid mode has no comment explaining the
rationale.

---

### I-14. Missing sequence numbering scheme documentation

- **Source:** comment-analyzer
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:17-19`
- **Status:** [ ] Open

Magic numbers `UNPREFIXED_SEQUENCE_BASE`, `YAML_SEQUENCE_BASE`, `YAML_SEQUENCE_STRIDE` have no
comment explaining the partitioned sequence space.

---

### I-15. Inaccurate `--strict` flag description in convert CLI

- **Source:** comment-analyzer
- **File:** `scripts/convert-pcd-to-yaml.ts:132`
- **Status:** [ ] Open

USAGE says `--strict Include migration metadata in output.` The name "strict" misleadingly suggests
validation rigor, not metadata inclusion.

**Fix:** Rename to `--include-metadata` or rewrite the description.

---

## Test Coverage Gaps (7 found)

### T-1. `slug.ts` -- No unit tests (Criticality: 9/10)

- **Source:** pr-test-analyzer
- **File:** `packages/praxrr-app/src/lib/server/pcd/migration/slug.ts`
- **Status:** [ ] Open

Critical to migration determinism. Every entity file path depends on correct slug generation.
Missing coverage: empty/whitespace names, 60-char truncation, unicode, collision resolution.

---

### T-2. `yamlFormatter.ts` -- No unit tests (Criticality: 8/10)

- **Source:** pr-test-analyzer
- **File:** `packages/praxrr-app/src/lib/server/pcd/migration/yamlFormatter.ts`
- **Status:** [ ] Open

Serialization backbone for YAML-first migration. 139 lines of normalization logic including
migration key rejection, non-finite numbers, undefined normalization. No edge case tests.

---

### T-3. `enumerateEntities.ts` -- No direct tests (Criticality: 8/10)

- **Source:** pr-test-analyzer
- **File:** `packages/praxrr-app/src/lib/server/pcd/migration/enumerateEntities.ts`
- **Status:** [ ] Open

203-line module driving entity enumeration for converter and parity verifier. Missing: entityTypes
filtering, unsupported type error, `distinctNames` behavior, empty cache tables.

---

### T-4. `converter.ts` -- Error paths not tested (Criticality: 7/10)

- **Source:** pr-test-analyzer
- **File:** `packages/praxrr-app/src/lib/server/pcd/migration/converter.ts`
- **Status:** [ ] Open

Only happy-path scenarios covered. Missing: all `ConverterConfigError` paths,
`ConverterSerializationError`, `ConverterWriteError`, JSON format, no-metadata mode.

---

### T-5. `parityVerifier.ts` -- Normalization helpers untested (Criticality: 7/10)

- **Source:** pr-test-analyzer
- **File:** `packages/praxrr-app/src/lib/server/pcd/migration/parityVerifier.ts`
- **Status:** [ ] Open

`normalizeScalarValue()`, `valuesEqual()`, `compareRowsBySortKeys()`, duplicate row detection -- all
untested. A type coercion bug could cause false parity passes.

---

### T-6. `importBaseOps.ts` -- Parse/identity logic untested (Criticality: 7/10)

- **Source:** pr-test-analyzer
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`
- **Status:** [ ] Open

`parseMetadata()`, `deriveSqlStableIdentity()`, `parseStableIdentityFromText/Object()`, migration
entity suppression via `migrationIdentitySet` -- all untested.

---

### T-7. `config.ts` -- `parsePCDMigrationMode` not tested (Criticality: 6/10)

- **Source:** pr-test-analyzer
- **File:** `packages/praxrr-app/src/lib/server/utils/config/config.ts`
- **Status:** [ ] Open

Missing: invalid values (should throw), default behavior (empty string defaults to 'hybrid'),
`parseBooleanEnv` edge cases.

---

## Type Design Improvements (Lower priority)

### TD-1. `PortableEntitySerializer` return type too wide

- **File:** `converter.ts`
- Return type `Promise<unknown>` loses compile-time guarantees. Narrow to
  `Promise<Record<string, unknown>>`.

### TD-2. No discriminated union for `entityType`/`data` pairing

- **File:** `portable.ts`
- Can construct `PortableImportRequest` with mismatched `entityType` and `data`.

### TD-3. Add compile-time assertion for Lidarr naming field coverage

- **File:** `validate.ts`
- `LIDARR_MEDIA_MANAGEMENT_PORTABLE_MATRIX.lidarr_naming.requiredFields` can silently drift from
  `PortableLidarrNaming` interface keys.

---

## Strengths

1. **Well-structured error hierarchy** in `converter.ts` -- three typed error classes with
   structured failure data and partial-progress reporting.
2. **Byte-identical output test** in `converter.test.ts` is an excellent determinism regression
   guard.
3. **Cache parity test** thoroughly verifies that legacy SQL replay and hybrid writer replay produce
   identical cache state.
4. **Manager hybrid fallback test** covers all three orchestration paths with good behavioral
   coverage.
5. **Comprehensive portable migration metadata validation** with closed-field rejection.
6. **Pervasive `readonly`** modifiers on converter/parity types prevent post-creation mutation.
7. **No `any` type usage** -- all files pass the strict typing policy.
8. **`PARITY_COMPARISON_TABLES` with `TABLE_SORT_KEYS`** creates exhaustive compile-time mapping.
9. **`seedBuiltInBaseOpsWithOrchestration`** now re-throws after logging (improved from previous
   swallow-and-continue pattern).
10. **`yamlFormatter.ts`** validates inputs thoroughly with fail-fast on non-finite numbers,
    non-plain objects, and reserved keys.

---

## Recommended Action

1. Fix all **Critical** issues (C-1 through C-6) before merge
2. Fix **High** issues (H-1 through H-6) before merge
3. Address **Important** issues in follow-up commits
4. Add unit tests for T-1 (slug.ts), T-2 (yamlFormatter.ts), T-3 (enumerateEntities.ts) before or
   shortly after merge
5. Remaining test gaps and type improvements can be addressed in subsequent PRs

---

## Issue Tracker

| ID   | Severity  | Category       | File                                    | Status    |
| ---- | --------- | -------------- | --------------------------------------- | --------- |
| C-1  | Critical  | Silent Failure | manager.ts:416-435                      | [x] Fixed |
| C-2  | Critical  | Silent Failure | manager.ts:174-203                      | [x] Fixed |
| C-3  | Critical  | Type Contract  | v1.d.ts:654-694                         | [ ] Open  |
| C-4  | Critical  | Concurrency    | writer.ts:36                            | [ ] Open  |
| C-5  | Critical  | Data Integrity | importBaseOps.ts:18-19                  | [ ] Open  |
| C-6  | Critical  | Comment        | manager.ts:482                          | [ ] Open  |
| H-1  | High      | Silent Failure | writer.ts:418-425                       | [ ] Open  |
| H-2  | High      | Silent Failure | importBaseOps.ts:322-325                | [ ] Open  |
| H-3  | High      | Silent Failure | importBaseOps.ts:386-396                | [ ] Open  |
| H-4  | High      | Type Safety    | importBaseOps.ts:467-482                | [ ] Open  |
| H-5  | High      | Silent Failure | manager.ts:252-266                      | [ ] Open  |
| H-6  | High      | Comment        | writer.ts:510-515                       | [ ] Open  |
| I-1  | Important | Duplication    | importBaseOps.ts, parityVerifier.ts     | [ ] Open  |
| I-2  | Important | Duplication    | importBaseOps.ts, parityVerifier.ts     | [ ] Open  |
| I-3  | Important | Duplication    | parityVerifier.ts, verify-pcd-parity.ts | [ ] Open  |
| I-4  | Important | Type Design    | reader.ts, enumerateEntities.ts         | [ ] Open  |
| I-5  | Important | Bug Risk       | verify-pcd-parity.ts:67                 | [ ] Open  |
| I-6  | Important | Error Handling | writer.ts:171-184                       | [ ] Open  |
| I-7  | Important | Error Context  | importBaseOps.ts:140-151                | [ ] Open  |
| I-8  | Important | Resource Leak  | parityVerifier.ts:377-399               | [ ] Open  |
| I-9  | Important | Error Handling | CLI scripts (7 instances)               | [ ] Open  |
| I-10 | Important | Error Handling | manager.ts:109-113                      | [ ] Open  |
| I-11 | Important | Error Handling | writer.ts:524-526                       | [ ] Open  |
| I-12 | Important | Type Design    | parityVerifier.ts                       | [ ] Open  |
| I-13 | Important | Documentation  | importBaseOps.ts:386-396                | [ ] Open  |
| I-14 | Important | Documentation  | importBaseOps.ts:17-19                  | [ ] Open  |
| I-15 | Important | Comment        | convert-pcd-to-yaml.ts:132              | [ ] Open  |
| T-1  | Test Gap  | Coverage       | slug.ts                                 | [ ] Open  |
| T-2  | Test Gap  | Coverage       | yamlFormatter.ts                        | [ ] Open  |
| T-3  | Test Gap  | Coverage       | enumerateEntities.ts                    | [ ] Open  |
| T-4  | Test Gap  | Coverage       | converter.ts                            | [ ] Open  |
| T-5  | Test Gap  | Coverage       | parityVerifier.ts                       | [ ] Open  |
| T-6  | Test Gap  | Coverage       | importBaseOps.ts                        | [ ] Open  |
| T-7  | Test Gap  | Coverage       | config.ts                               | [ ] Open  |
