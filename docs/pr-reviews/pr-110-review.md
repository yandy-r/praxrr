# PR #110 Review: chore(remove-sql-files): finalize YAML-only PCD ingestion and cleanup

**PR:** [#110](https://github.com/yandy-r/praxrr/pull/110) **Branch:** `chore/remove-sql-files-`
-> `main` **Date:** 2026-02-24 **Reviewers:** code-reviewer, silent-failure-hunter, pr-test-analyzer,
comment-analyzer, code-simplifier

## Summary

Finalizes the `remove-sql-files` initiative (issues #105-#109) by removing legacy SQL-fallback
ingestion assumptions and formalizing a YAML-only base-data path. Preserves explicit schema
SQL/tweaks behavior and export-history integrity.

**Scope:** 88 files changed, 3,438 additions, 47,200 deletions (bulk: SQL file removal), 9 commits.
Meaningful code changes span 25 files excluding SQL deletions and plan docs.

---

## Critical Issues (4 found) -- Must fix before merge

### C-1. `compat-check.ts` and `verify-pcd-parity.ts` fail Prettier formatting

- **Source:** code-reviewer
- **Files:** `scripts/compat-check.ts`, `scripts/verify-pcd-parity.ts`
- **Status:** [x] Fixed

**Fix details:** Normalized both files using project formatting so they honor the repo Prettier settings (single-quoted strings): `npx prettier --write scripts/compat-check.ts scripts/verify-pcd-parity.ts`.

`compat-check.ts` uses double quotes throughout, violating the project's Prettier config
(`singleQuote: true`). This will cause `deno task lint` to fail in CI. The CLAUDE.md convention
states: "single quotes."

**Fix:** Run `deno task format` or `npx prettier --write scripts/compat-check.ts scripts/verify-pcd-parity.ts`.

### C-2. `loadOps.ts` bare catch swallows non-NotFound filesystem errors

- **Source:** silent-failure-hunter
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts:42-48`
- **Status:** [x] Fixed

`resolveSchemaOpsPath` catches ALL errors from `Deno.readDir(depsPath)` with a bare `catch {}`
block, then silently falls back to a hardcoded path. Permission errors, corrupted filesystem states,
and other unexpected errors are swallowed. With SQL fallback removed, this is now the sole path for
schema layer loading.

**Fix:** Catch only `Deno.errors.NotFound`; re-throw all other errors with context:

```typescript
} catch (error) {
  if (error instanceof Deno.errors.NotFound) {
    // deps directory doesn't exist, fall through to default
  } else {
    throw new Error(
      `Failed to resolve schema ops path: cannot read ${depsPath}: ${String(error)}`
    );
  }
}
```

**Fix details:** Applied targeted catch narrowing in `packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts`:
`catch (error) { if (error instanceof Deno.errors.NotFound) { /* fallback */ } else { throw new Error(...) } }`.

### C-3. `operations.ts` `pathExists` bare catch treats permission errors as "not found"

- **Source:** silent-failure-hunter
- **File:** `packages/praxrr-app/src/lib/server/pcd/utils/operations.ts:12-19`
- **Status:** [x] Fixed

Pre-existing but now critical: the `pathExists` utility has a bare `catch` returning `false` for ANY
error. With SQL fallback removed, this is the gatekeeper for schema and tweaks layer loading. A
permission error on `deps/praxrr-schema/ops` would produce a cache with no schema tables, causing
incomprehensible downstream "table not found" failures.

**Fix:** Only catch `Deno.errors.NotFound`:

```typescript
} catch (error) {
  if (error instanceof Deno.errors.NotFound) {
    return false;
  }
  throw error;
}
```

**Fix details:** Updated `pathExists` to return `false` only for `Deno.errors.NotFound`; re-throw all other filesystem errors.

### C-4. `exporter.ts` PAT decryption error detail discarded

- **Source:** silent-failure-hunter
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts:192-196`
- **Status:** [x] Fixed

Pre-existing but now the sole export pathway. The `error` variable is captured but never used. Key
version mismatch, corrupted nonce, missing encryption key -- all produce the same unhelpful message
"Failed to load personal access token."

**Fix:** Include error detail:

```typescript
const detail = error instanceof Error ? error.message : String(error);
errors.push(`Failed to load personal access token: ${detail}`);
```

**Fix details:** Updated `runPreflight` to append the underlying decryption error to the failure message:
`Failed to load personal access token: <detail>`.

---

## Important Issues (9 found) -- Should fix before merge

### I-1. No test for `importBaseOps` MigrationReaderError path

- **Source:** pr-test-analyzer
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:175-177`
- **Status:** [x] Fixed

`importBaseOps` throws `MigrationReaderError` when reader issues are present. This is now the
primary validation gate for bad YAML entity data. No test directly exercises this path.

**Suggested test:** Call `importBaseOps` with `__testOnly_setReadMigrationEntitySources` returning a
result with non-empty `issues`, and assert it throws `MigrationReaderError`.

**Fix details:** Added
`importBaseOps: throws MigrationReaderError when migration reader returns issues` in
`packages/praxrr-app/src/tests/pcd/ops/importBaseOps.test.ts`.

### I-2. No test for `importBaseOps` when cache is unavailable

- **Source:** pr-test-analyzer
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:193-195`
- **Status:** [x] Fixed

When `getCacheForTests(databaseId)` returns null/undefined, the function throws. No test exercises
this guard. All existing tests always provide a mock cache.

**Suggested test:** Call `importBaseOps` with `__testOnly_setGetCache` returning `undefined`. Assert
it throws with `'Cache not available'`.

**Fix details:** Added
`importBaseOps: throws when base cache is unavailable` in
`packages/praxrr-app/src/tests/pcd/ops/importBaseOps.test.ts`.

### I-3. `compat-check.ts` uses `__testOnly_*` APIs in CI script

- **Source:** code-reviewer
- **File:** `scripts/compat-check.ts:26-27, 477, 488`
- **Status:** [x] Fixed

The CI script imports `__testOnly_setCompile` and `__testOnly_resetCompile`. Using test-only seams
in a CI validation script blurs the boundary between production and test infrastructure.

**Recommendation:** Consider adding a dedicated API without the `__testOnly_` prefix for legitimate
non-test usage, or document why test-only APIs are intentionally used here.

**Fix details:** Removed `__testOnly_setCompile` and `__testOnly_resetCompile` usage from
`scripts/compat-check.ts` and now rely on default `importBaseOps`/`compile` wiring.

### I-4. Dead code: 9 unused `original*` variable captures in `installQueryShims`

- **Source:** code-reviewer, code-simplifier
- **File:** `scripts/compat-check.ts:92-103`
- **Status:** [x] Fixed

Only `originalDatabaseInstancesGetById` is actually referenced. The remaining 9 captures are dead
because the `patch` helper handles save/restore internally via closure.

**Fix:** Remove unused variable captures.

**Fix details:** Deleted the unused `originalPcdOps*` and `originalPcdOpHistory*` captures from
`installQueryShims` in `scripts/compat-check.ts`.

### I-5. Empty `InMemoryPcdOp` interface adds no value

- **Source:** code-reviewer, code-simplifier
- **File:** `scripts/compat-check.ts:59`
- **Status:** [x] Fixed

`interface InMemoryPcdOp extends PcdOp {}` extends `PcdOp` without adding members.

**Fix:** Removed the redundant `InMemoryPcdOp` type and used `PcdOp` directly in
`installQueryShims` for in-memory op storage.

### I-6. `exporter.ts` remote-fetch and realPath error details discarded

- **Source:** silent-failure-hunter
- **Files:** `packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts:246-248, 478-483`
- **Status:** [x] Fixed

Two additional error-swallowing patterns: (1) remote repository fetch error produces generic
"Failed to reach remote repository" with no detail; (2) `Deno.realPath` failure silently falls back
to stored path with no logging.

**Fix:** Included remote failure details in preflight errors and added warning logs for both
remote check failures and `realPath` fallback behavior.

### I-7. `manager.ts` `switchBranch` returns `false` with no error context

- **Source:** silent-failure-hunter
- **File:** `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:280-296`
- **Status:** [x] Fixed

Pre-existing. When `importBaseOps` fails during branch switch, the method logs the error but returns
`false` to the caller with no error detail. The API handler can only show "Branch switch failed."

**Fix:** Switched to fail-fast: `switchBranch` now throws with contextual error details when
base-op import fails, and returns `true` on success.

### I-8. `verify-pcd-parity.ts` doesn't exit on unsupported arguments

- **Source:** silent-failure-hunter
- **File:** `scripts/verify-pcd-parity.ts:29-32`
- **Status:** [x] Fixed

Unsupported arguments are printed to stderr but execution continues to `printMigrationMessage()`
which throws. The unsupported-args message is lost in the deprecation error noise.

**Fix:** Added immediate `Deno.exit(2)` when unsupported arguments are present so the message is not
overwritten by the deprecated-path error.

### I-9. `compat-check.ts` query shim `fakeInstance` missing `has_personal_access_token` field

- **Source:** silent-failure-hunter
- **File:** `scripts/compat-check.ts:~165`
- **Status:** [x] Fixed

The fake `DatabaseInstance` omits `has_personal_access_token`. TypeScript forces the field, but the
runtime object may behave unexpectedly if accessed.

**Fix:** Added `has_personal_access_token: 0` to `fakeInstance`.

---

## Suggestions (12 found) -- Nice to have

### S-1. `importBaseOpsWithOrchestration` is now a trivial passthrough

- **Source:** code-simplifier
- **File:** `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:487-490`
- **Status:** [x] Fixed

The method calls `importBaseOps` and returns `true` unconditionally. The boolean return is never used
meaningfully. Consider inlining `importBaseOps` at each call site.

**Fix:** Removed `importBaseOpsWithOrchestration` and replaced all call sites with direct
`importBaseOps(...)` calls.

### S-2. Empty `ImportBaseOpsOptions` interface and unused `_options` parameter

- **Source:** code-simplifier
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:131-132, 171`
- **Status:** [x] Fixed

The options interface existed to carry `pcdMigrationIngestionMode`, which was removed. No caller
passes options anymore.

**Fix:** Removed the unused `ImportBaseOpsOptions` interface and dropped the `_options` parameter.

### S-3. `created`/`updated` counters hardcoded to `0` and never mutated

- **Source:** pr-test-analyzer, silent-failure-hunter, code-simplifier
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:183-184`
- **Status:** [x] Fixed

Dead counters. Logs show `created: 0, updated: 0` alongside `migrationImported: 47`, which is
confusing. Either remove or make meaningful.

**Fix:** Replaced the dead `created/updated` payload with a meaningful `imported` count in
`ImportBaseOpsResult`, and updated `importBaseOps` to increment `imported` for each successfully
applied migration candidate.

### S-4. `managerHybridFallback.test.ts` filename is now misleading

- **Source:** pr-test-analyzer, code-simplifier
- **File:** `packages/praxrr-app/src/tests/pcd/migration/managerHybridFallback.test.ts`
- **Status:** [x] Fixed

No hybrid fallback behavior is tested anymore. Rename to `managerImportOrchestration.test.ts` or
similar.

**Fix:** Renamed file to `packages/praxrr-app/src/tests/pcd/migration/managerImportOrchestration.test.ts` and
updated it to assert direct import orchestration outcomes.

### S-5. Stale comments referencing removed SQL/migration concepts

- **Source:** comment-analyzer
- **Files:**
  - `loadOps.ts:5-6` -- "when import migration mode is removed" (already removed)
  - `importBaseOps.ts:25-29` -- "migration entity" terminology throughout
  - `cache.ts:81` -- "legacy SQL compatibility layer" (functions are still actively needed)
  - `writer.ts:60` -- "Migration repo import" error message
  - `portable.ts:107, 112` -- "hybrid" ingestion references
- **Status:** [x] Fixed

### S-6. `ARCHITECTURE.md` Section 6.7 still says "Exporter (Planned)"

- **Source:** comment-analyzer
- **File:** `docs/ARCHITECTURE.md:287-290`
- **Status:** [x] Fixed

The exporter is fully implemented. Update header and body to reflect current state. Also update
glossary entry at line 47 from "Planned process" to "Process".

**Fix:** Updated glossary entry and section header/body so section 6.7 and `Exporter` definition now
describe the implemented YAML-exporter flow instead of planned status.

### S-7. `ARCHITECTURE.md` repository layout diagram omits `entities/`

- **Source:** comment-analyzer
- **File:** `docs/ARCHITECTURE.md:333-340`
- **Status:** [x] Fixed

The diagram shows `ops/` as the primary data directory without mentioning `entities/`, which is now
the canonical source for base data.

**Fix:** Updated the repository layout diagram at
`docs/ARCHITECTURE.md:330-337` to show `entities/` as the canonical base-data directory (with YAML
files), leaving schema SQL to the separate `Schema PCD layout` section.

### S-8. `praxrr-db/README.md` references `ops/50`-`ops/54` which no longer exist

- **Source:** comment-analyzer
- **File:** `packages/praxrr-db/README.md:38`
- **Status:** [x] Fixed

All `*.sql` files were removed from `packages/praxrr-db/ops/`. Referencing specific SQL files as
"the current v1 seed set" is factually wrong.

**Fix:** Replaced the seed-set wording to reference the YAML-first seed source under `entities/` in
`packages/praxrr-db/README.md`.

### S-9. `SourceConflictRef` single-field wrapper could be simplified

- **Source:** code-simplifier
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:31-33`
- **Status:** [x] Fixed

After removing `kind: SourceType`, the type wraps only `file: string`. Could be replaced by plain
`string`.

**Fix:** Simplified `SourceConflictRef` from `{ file: string }` to `string` in
`packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts` and updated conflict-path formatting to
use plain source-path strings.

### S-10. `verify-pcd-parity.ts` uses throw/catch for control flow

- **Source:** code-simplifier
- **File:** `scripts/verify-pcd-parity.ts`
- **Status:** [x] Fixed

The deprecation flow uses exception-based control flow to exit with code 3. Simpler to call
`Deno.exit(3)` directly after console output.

**Fix:** Removed the dedicated throw path and replaced it with direct `Deno.exit(3)` after printing the
deprecation message. The script now exits via explicit control-flow only.

### S-11. Consider deleting `parityVerifier.ts` entirely vs. maintaining stub

- **Source:** code-simplifier
- **File:** `packages/praxrr-app/src/lib/server/pcd/migration/parityVerifier.ts`
- **Status:** [x] Fixed

Two stub files (`parityVerifier.ts` and `verify-pcd-parity.ts`) maintained long-term to say "this is
removed" is overhead. If no external consumers exist, outright deletion may be cleaner.

**Fix:** Removed `packages/praxrr-app/src/lib/server/pcd/migration/parityVerifier.ts` and its now-redundant
unit test `packages/praxrr-app/src/tests/pcd/migration/parityVerifier.test.ts` to reduce dead API surface.

`verify-pcd-parity.ts` remains the explicit compatibility message exit point.

### S-12. `compat-check.ts` cleanup block has redundant cache check

- **Source:** code-simplifier
- **File:** `scripts/compat-check.ts:487-497`
- **Status:** [x] Fixed

After `deleteCache` at line 489, the subsequent `getCache` at line 491 should return `undefined`.
The double-delete pattern appears to be defensive code that may be unnecessary after simplification.

**Fix:** Removed the redundant post-`deleteCache` `getCache`/re-delete block in
`scripts/compat-check.ts` cleanup path.

---

## Strengths

- **Clean removal of hybrid/SQL-only mode dispatch** from `manager.ts`, `importBaseOps.ts`,
  `config.ts`, and retired parity-verification shims. The simplification is thorough and complete.
- **`publish-db.yml` CI gate** preventing accidental SQL file reintroduction is a good safety net.
- **Test suite correctly restructured** -- removed tests for deleted code paths, added new tests for
  YAML-only pipeline. All behavioral contracts are covered (duplicate identity detection,
  deterministic ordering, sequence numbering, schema/tweaks loading).
- **`importBaseOps.test.ts`** is well-designed with `__testOnly_*` dependency injection pattern,
  proper cleanup in `finally` blocks, and comprehensive behavioral coverage.
- **`git.ts` comment on `getMaxOpNumber`** is an excellent model: explains "why" (export-history-only),
  establishes boundary (no dependency on `ops/` filesystem for import).
- **`verify-pcd-parity.ts` retirement behavior** is explicit: it exits with clear codes/messages and
  no longer depends on retained parity comparison runtime code.
- **CLAUDE.md PCD section** accurately describes the new architecture.
- **`compat-check.ts` rewrite** eliminates `better-sqlite3` native module dependency from CI,
  significantly simplifying the compatibility workflow.

---

## Recommended Action

1. **Fix C-1 first** (Prettier formatting) -- this will block CI immediately.
2. **Fix C-2 and C-3** (bare catch blocks) -- these are now critical-path error handling gaps with
   SQL fallback removed.
3. **Fix C-4** (error detail) -- quick win for observability.
4. **Address I-1 and I-2** (missing tests) -- add tests for the two untested error paths in
   `importBaseOps`.
5. **Address remaining important issues** as time permits.
6. **Consider suggestions** in follow-up cleanup.
7. **Re-run `deno task lint` and `deno task test`** after fixes to verify.

---

## Test Results

All 12 PR-changed test files pass. Test coverage is good with two notable gaps (I-1, I-2) for error
paths in `importBaseOps`. The `compat-check.ts` script has no direct unit tests but functions as a
CI integration test.
