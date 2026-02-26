# PR #132 Review: feat: deliver TRaSH source-aware sync UX

**PR:** #132 **Branch:** `feat/trash-guide-sync-ux` -> `main` **Date:** 2026-02-26 **Scope:** 12,270
additions, 1,843 deletions, 69 files **Closes:** #127, #128, #129, #130, #131

## Review Agents Deployed

| Agent                 | Focus                                              |
| --------------------- | -------------------------------------------------- |
| code-reviewer         | CLAUDE.md compliance, bugs, conventions            |
| silent-failure-hunter | Error handling, silent failures, fallback behavior |
| pr-test-analyzer      | Test coverage quality and gaps                     |
| type-design-analyzer  | Type design, invariants, `any` usage               |
| comment-analyzer      | Comment accuracy, JSDoc coverage, rot risk         |
| code-simplifier       | Duplication, complexity, simplification            |

---

## Critical Issues (7 found)

### 1. Empty catch blocks in cleanup.ts can cause mass deletion from Arr instances

**Status:** Fixed — parse/transform failures are logged with source/trash context, and fully
malformed sources now fail the cleanup scan.

**Files:** `packages/praxrr-app/src/lib/server/sync/cleanup.ts:99-103`, `cleanup.ts:108-137`
**Agent:** silent-failure-hunter

Two bare `catch {}` blocks in `scanForStaleItems`:

- **Line 99-103:** `JSON.parse(row.jsonData)` failures silently skipped with `// skip malformed`. If
  the entity cache is systematically corrupted, `parsedEntities` will be empty, the expected-names
  set will be incomplete, and items the user wants to keep will be flagged as stale and **deleted
  from the Arr instance**.

- **Line 108-137:** `transformTrashGuideEntities()` failure silently `continue`s with no logging.
  The identical call in `syncer.ts:616` correctly logs a warning with full context. In cleanup, the
  failure is completely invisible.

**Impact:** Silent data loss. TRaSH Guide custom formats and quality profiles that the user
deliberately selected will be deleted from their Arr instance with no explanation.

**Fix:** Log every malformed row at warn level with `trashId`, `sourceId`, and error message. If all
rows fail to parse, throw to abort the scan rather than proceeding with an empty expected-names set.

### 2. Empty catch block in syncer.ts silently produces zero-entity sync batches

**Status:** Fixed — malformed TRaSH cache rows are logged per-row and an all-malformed source now
fails batch assembly.

**File:** `packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts:574-579` **Agent:**
silent-failure-hunter

Same pattern as #1. During sync batch assembly, malformed cached JSON rows are silently dropped. If
the cache is systematically corrupt, the sync will proceed with zero entities, report "success" with
0 items synced, and the user will not understand why their TRaSH Guide profiles never appear in the
Arr instance.

**Fix:** Log each malformed row at warn level. If 100% of rows fail to parse, log at error level and
consider failing the batch.

### 3. TRaSH namespace suffix logic duplicated in 3 places with fragile coupling

**Status:** Fixed — introduced `getTrashGuideNamespaceSuffix()` in `namespace.ts` and reused it from
cleanup and syncer.

**Files:** `cleanup.ts:150`, `syncer.ts:684`, `namespace.ts` (reference) **Agents:** code-reviewer,
code-simplifier

Both `cleanup.ts` and `syncer.ts` independently construct the TRaSH namespace suffix:
`\u200C${'\u200B'.repeat(trashNamespaceIndex)}`. The index is incremented only for sources passing
all guard conditions, but the guards differ subtly between the two files (cleanup checks
`source.arr_type !== arrType` while syncer checks `source.arr_type !== this.instanceType`). If any
guard behaves differently, namespace index assignments will diverge and cleanup will not correctly
identify expected names -- leading to deletion of freshly synced items.

**Impact:** Potential namespace mismatch between sync and cleanup causing stale-item false
positives.

**Fix:** Extract TRaSH namespace suffix construction into a shared helper (adjacent to existing
`getNamespaceSuffix` in `namespace.ts`). Ideally extract the shared "build TRaSH sync batches" logic
into a common function both syncer and cleanup consume.

### 4. Dead code after `return` in `getMediaManagementRouteName`

**Status:** Fixed — removed unreachable `void arrType` statement and renamed parameter to
`_arrType`.

**File:** `packages/praxrr-app/src/lib/shared/arr/displayName.ts:53` **Agent:** code-reviewer

The `void arrType` statement is placed **after** the `return` statement, making it unreachable. The
sibling function `getMediaManagementDisplayName` correctly places `void arrType` before `return`.

**Fix:** Move `void arrType` before the `return` statement, or use `_arrType` prefix convention.

### 5. ESLint `@typescript-eslint/no-unused-vars` disabled globally for all Svelte files

**Status:** Fixed — blanket disable replaced with rule enforcement in Svelte override:

**File:** `eslint.config.js` **Agent:** code-reviewer

```js
{
  files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { args: 'none', argsIgnorePattern: '^_' }],
  },
}
```

This keeps Svelte linting strict for locals while allowing underscore-prefixed intentionally unused
arguments.

**Validation:** `deno run -A npm:eslint src/routes/+layout.svelte` (from `packages/praxrr-app`). No
unused-vars warnings were surfaced for that representative Svelte file.

### 6. No unit tests for `displayTransform.ts` (171 new lines, criticality 9/10)

**Status:** Fixed — added unit coverage in
`packages/praxrr-app/src/tests/trashguide/displayTransform.test.ts`.

**File:** `packages/praxrr-app/src/lib/server/trashguide/displayTransform.ts` **Agent:**
pr-test-analyzer

Tests now cover:

- malformed cache rows in `toSourcedCustomFormatRow` and naming/quality-size transforms.
- custom format transformation of specifications, source metadata, and tag arrays.
- quality profile upgrade-until inference across group/item members.
- quality size transform behavior for valid and invalid payloads.

**Validation:**
`deno test packages/praxrr-app/src/tests/trashguide/displayTransform.test.ts --allow-read --allow-write --allow-env --allow-net --allow-run --allow-ffi`.

### 7. No unit tests for `cleanup.ts` (94 new lines, criticality 9/10)

**Status:** Fixed — added unit coverage in `packages/praxrr-app/src/tests/sync/cleanup.test.ts`.

**File:** `packages/praxrr-app/src/lib/server/sync/cleanup.ts` **Agent:** pr-test-analyzer

Tests now cover:

- expected-name set construction across PCD and TRaSH selections.
- complete TRaSH malformed cache rejection handling.
- stale deletion behavior, including successful deletion and HTTP 500 assigned-profile skip
  classification.

**Validation:**
`deno test packages/praxrr-app/src/tests/sync/cleanup.test.ts --allow-read --allow-write --allow-env --allow-net --allow-run --allow-ffi`.

---

## High Issues (11 found)

### 8. `getQualityMappings` changed from throw to silent empty Map fallback

**File:** `syncer.ts:710-723` **Agent:** silent-failure-hunter

Previously threw `Error('No PCD cache available for quality API mappings')`. Now silently returns an
empty Map. This covers the TRaSH-only case, but also silently masks PCD-batch failures. With an
empty quality mappings map, quality profiles will be pushed with unmapped quality items.

**Fix:** Return empty Map only when no PCD batches exist. If PCD batches exist but none have a valid
cache, throw as the original code did. **Status:** ✅ Fixed

- `QualityProfileSyncer.getQualityMappings` now tracks PCD batches and throws
  `No PCD cache available for quality API mappings` when a PCD batch is present but uncached.
- Added unit tests for:
  - TRaSH-only batches returning empty map.
  - cached availability missing for PCD batches throws.
  - successful mapping from first available PCD cache.

### 9. `resolveDatabases` catches all errors with no logging (2 files)

**Files:** `media-management/[databaseId]/naming/+page.server.ts:34-45`,
`quality-definitions/+page.server.ts:36-47` **Agent:** silent-failure-hunter

Catches ALL exceptions from `pcdManager.getAll()` -- including programmer errors -- and silently
falls back to a single database or empty array. No logging. Violates CLAUDE.md: "ALWAYS throw errors
early and often. Do not use fallbacks."

**Fix:** Remove the fallback and let errors propagate, or at minimum log at error level and limit
the catch to a specific expected error type. **Status:** ✅ Fixed

- `resolveDatabases` now only logs for `DatabaseNotInitializedError` and rethrows; generic fallbacks
  were removed.

### 10. `listTrashSourcesSafely` uses fragile string matching (2 files)

**Files:** `naming/+page.server.ts:22-32`, `quality-definitions/+page.server.ts:24-34` **Agent:**
silent-failure-hunter

Catches errors by matching `error.message.includes('Database not initialized')`. String-based error
matching is fragile and has no logging when caught.

**Fix:** Use a specific error class (e.g., `DatabaseNotInitializedError`) rather than string
matching. Log at debug/warn level. **Status:** ✅ Fixed

- Added `DatabaseNotInitializedError` class in `src/lib/server/db/db.ts` and now use instance checks
  in both affected page loaders.
- Added warning logs when TRaSH source listing is skipped due to uninitialized DB.

### 11. CF deletion failures not surfaced to user

**File:** `cleanup.ts:221-229` **Agent:** silent-failure-hunter

Custom format deletion failures are logged at warn level but not included in the
`CleanupDeleteResult`. The user sees "cleanup complete" while stale CFs remain.

**Fix:** Add `failedCustomFormats` field to `CleanupDeleteResult` (mirroring
`skippedQualityProfiles`). **Status:** ✅ Fixed

- `deleteStaleItems` now records CF delete failures as `{ item, reason }` in `failedCustomFormats`.
- Cleanup API/typed docs updated to include `failedCustomFormats`.
- `CleanupModal` now renders failed CF deletions with reason text.
- Targeted test coverage added in `tests/sync/cleanup.test.ts`.

### 12. Individual profile sync failures hidden from result

**File:** `syncer.ts:840-852` **Agent:** silent-failure-hunter

When a quality profile fails to sync, the error is logged but the overall result says
`{ success: true, itemsSynced: N }` with no indication of failures. User sees "sync succeeded" while
profiles are silently missing.

**Fix:** Track failed profiles alongside synced profiles and include in the result.

### 13. No unit tests for `trashGuideSyncQueue.ts` (122 new lines, criticality 8/10)

**File:** `packages/praxrr-app/src/lib/server/jobs/helpers/trashGuideSyncQueue.ts` **Agent:**
pr-test-analyzer

The double-check deduplication pattern, `toRunMetadata` throw behavior, and `latestRun`
null-coalescing path are tested only at the route integration level, not directly.

**Fix:** Add direct unit tests for `enqueueManualTrashGuideSourceSync` covering queued,
already_running (pre-upsert), already_running (post-upsert race), and `toRunMetadata` with no run
history.

### 14. Client-side `TrashGuideSourceArrType` includes `'lidarr'` but server doesn't support it

**Files:** `TrashGuideSources.svelte:10`, `QualityProfiles.svelte:10` **Agent:** comment-analyzer

Client-side type declares `'radarr' | 'sonarr' | 'lidarr'`, but the canonical server-side type in
`trashguide/types.ts` defines `TRASHGUIDE_SUPPORTED_ARR_TYPES = ['radarr', 'sonarr'] as const`. The
server's `parseTrashGuideSourceArrType` will throw on `'lidarr'`.

**Fix:** Align client-side type with server-side, or import from a shared location.

### 15. Source-filter utility duplicated across 4 listing pages (~250 lines)

**Files:** `custom-formats/[databaseId]/+page.svelte:86-161`, `naming/+page.svelte:29-132`,
`quality-definitions/+page.svelte:28-127`, `quality-profiles/[databaseId]/+page.svelte:59-149`
**Agent:** code-simplifier

Functions `toSourceKey`, `sameSelection`, `normalizeSourceSelection`, `loadSourceSelection`,
`filterBySources`, `resolveSourceKey`, `isCurrentDatabasePcd*`, `clearSourceFilters` are copy-pasted
with trivial naming variations. The reactive `$:` lifecycle pattern (~20 lines per page) is also
duplicated.

**Fix:** Extract into a shared module at `$lib/client/utils/sourceFilter.ts` with a
`createSourceFilter` factory parameterized by storage key prefix.

### 16. `buildSourceContext` duplicated across 4 server loaders (~150 lines)

**Files:** `custom-formats/[databaseId]/+page.server.ts:12-66`,
`quality-profiles/[databaseId]/+page.server.ts:12-63`, `naming/+page.server.ts:14-95`,
`quality-definitions/+page.server.ts:16-97` **Agent:** code-simplifier

Nearly identical function differing only in entity count key and label string. Helper functions
`sourceKey`, `isTrashSource`, `withPcdSource`, `sortRows`, `listTrashSourcesSafely`, and
`resolveDatabases` are also duplicated.

**Fix:** Extract a generic `buildSourceContext` factory into `$lib/server/utils/sourceContext.ts`.

### 17. `extractFormError` duplicated in 3 components

**Files:** `TrashGuideSources.svelte:314-324`, `QualityProfiles.svelte:378-388`,
`+page.svelte:337-347` **Agent:** code-simplifier

Byte-for-byte identical across three files.

**Fix:** Move to `$lib/client/utils/`.

### 18. syncer.ts module-level JSDoc is factually incomplete

**File:** `syncer.ts:1-13` **Agent:** comment-analyzer

Describes sync as PCD-only 4-step process. After this PR, the syncer handles both PCD and TRaSH
Guide batches. The comment omits the TRaSH source flow entirely.

**Fix:** Rewrite to reflect dual-source nature.

---

## Medium Issues (10 found)

### 19. `parseCachedEntity<T>` returns null with no logging

**File:** `displayTransform.ts:45-55` **Agent:** silent-failure-hunter, type-design-analyzer

Silent null return on malformed JSON. If the entire entity cache is corrupted, users see empty lists
with no error indicators. The `as T` cast is unchecked -- parsed JSON is verified to be a non-null
non-array object, but not validated against `T`.

### 20. `toSyntheticId` can produce collisions and silently falls back to 0

**File:** `displayTransform.ts:39-43` **Agents:** code-reviewer, silent-failure-hunter,
type-design-analyzer

Uses only first 8 hex chars of UUID mod 1,000,000. Birthday-paradox collisions possible with large
entity sets. Non-hex trash IDs silently produce `suffix = 0`, causing all unparseable IDs from the
same source to collide.

### 21. Nested ternary in `viewState` derivation (CLAUDE.md violation)

**File:** `TrashGuideSources.svelte:460-468` **Agent:** code-simplifier

4-level nested ternary. Should be a helper function with if/else chain per CLAUDE.md conventions.

### 22. `fetchSyncBatches` is 250 lines with mixed PCD/TRaSH concerns

**File:** `syncer.ts:444-693` **Agent:** code-simplifier

The TRaSH section alone is ~136 lines handling source lookup, JSON parsing, result reconstruction,
transformation, entity extraction, and namespace construction.

**Fix:** Extract TRaSH batch building into a separate private method.

### 23. `void logger.warn(...)` drops the promise

**File:** `trashGuideSync.ts (handler):112` **Agent:** silent-failure-hunter

Inconsistent with other `await logger.warn(...)` calls in the same file. If the logger itself fails,
the failure is silently discarded.

### 24. TRaSH sync types duplicated between client and server

**Files:** `TrashGuideSources.svelte:10-63`, `QualityProfiles.svelte:10-49` **Agent:**
code-simplifier, type-design-analyzer

Components re-declare types that already exist in server query module. Risks drift.

**Fix:** Move to `$shared/trashguide/types.ts` and import from both sides.

### 25. `TrashGuideEntityType` defined independently in two files

**Files:** `trashguide/types.ts:10`, `trashGuideEntityCache.ts:4` **Agent:** type-design-analyzer

Both define the same union with separate validation sets. If one changes, the other must change in
lockstep, but the compiler won't warn.

**Fix:** Import from `trashguide/types.ts` instead of redefining.

### 26. `SourcedDisplayRow` all-optional fields create partial-data hazard

**File:** `sources/types.ts` **Agent:** type-design-analyzer

Three independently optional fields (`sourceType?`, `sourceDatabaseId?`, `sourceDatabaseName?`)
allow semantically invalid states (e.g., `sourceType = 'trash'` but missing `sourceDatabaseId`).

**Fix:** Use discriminated union or wrap in a single optional object.

### 27. `hasContentChanged` conflates "not found" with "changed"

**File:** `trashGuideEntityCache.ts:317-328` **Agent:** silent-failure-hunter

Returns `true` when entity doesn't exist in cache. Callers must understand this implicit semantic.

### 28. `sync()` not wrapped in try-catch, bypasses retry logic

**File:** `trashGuideSync.ts (handler):210` **Agent:** silent-failure-hunter

If `trashGuideManager.sync()` throws, it bypasses the transient-retry logic that `checkForUpdates`
benefits from, and the user's scheduled sync stops working until the next interval.

---

## Strengths

### Architecture & Types

- **Zero `any` types** across all 50 code files -- full CLAUDE.md compliance
- **Discriminated unions** used correctly: `SourceRef`, `EnqueueManualTrashGuideSyncResult`,
  `TrashGuideSyncScopeErrorCode`
- **Private row types, public domain types** in query modules -- textbook encapsulation
- **Domain-specific error classes** (`TrashGuideSyncScopeError`, `TrashGuideSyncValidationError`)
  with structured error codes enable programmatic branching

### Cross-Arr Validation

- `assertScope` validates arr_type parity before every write operation
- SQL queries enforce `arr_type` matching in JOINs (`ai.type = s.arr_type`)
- TRaSH source filtering by `arr_type` prevents cross-Arr contamination
- Tests methodically verify scope rejection with explicit error codes

### Error Handling (Positive)

- `trashGuideSync.ts` query module: `assertScope`, `parseTrashGuideSyncTrigger`, and parser
  functions throw typed errors immediately on invalid input
- `trashGuideEntityCache.ts` transactions correctly rollback and re-throw
- New form actions (`saveTrashGuideSource`, `syncTrashGuideSource`) demonstrate thorough input
  validation
- `replaceSelections` validates non-empty item names and deduplicates

### Testing

- Scope validation tests are thorough (scope assertion, scope mismatch before transaction, dedup)
- UX flow tests call actual page `load` functions verifying full `sourceContext` payload shape
- Route-level tests cover HTTP 409 conflict, entity cache pagination, arr type mismatch guard
- Display name tests cover edge cases (empty string, unknown arr types)

### Comments (Positive)

- `namespace.ts` module-level and `getNamespaceSuffix` JSDoc are exemplary "why" documentation
- `sources/types.ts` JSDoc accurately describes discriminated union contracts
- `syncer.ts:682-684` correctly documents the TRaSH/PCD namespace disjointness invariant

---

## Type Design Summary

| Category              | Rating |
| --------------------- | ------ |
| Encapsulation         | 7.5/10 |
| Invariant Expression  | 7.3/10 |
| Invariant Usefulness  | 7.8/10 |
| Invariant Enforcement | 6.5/10 |

Main type concerns: unchecked JSON deserialization casts (`as T`), `SourcedDisplayRow` all-optional
pattern, `TrashGuideEntityType` duplication, loose `string` types in queue module where narrower
types are available.

---

## Recommended Action

1. **Fix critical issues 1-3 first** (silent catch blocks in cleanup/syncer) -- these can cause data
   loss
2. **Fix critical issues 4-5** (dead code, ESLint blanket disable) -- quick wins
3. **Add test coverage** for `displayTransform.ts` and `cleanup.ts` (issues 6-7)
4. **Address high issues** -- especially #8 (getQualityMappings fallback), #14 (lidarr type drift),
   and #15-17 (duplication -- ~450 lines removable)
5. **Consider medium issues** as follow-up work
6. **Re-run review** after fixes to verify resolution
