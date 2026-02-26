# PR #122 Review: feat(trash-guide): deliver end-to-end sync pipeline, UI, and import hardening

**PR:** #122 **Branch:** `feat/trash-guide-sync` -> `main` **Date:** 2026-02-25 **Scope:** 14,511
additions, 146 deletions, 66 files **Closes:** #113, #114, #115, #116, #117, #118, #119, #120, #121

## Review Agents Deployed

| Agent                 | Focus                                              |
| --------------------- | -------------------------------------------------- |
| code-reviewer         | CLAUDE.md compliance, bugs, conventions            |
| silent-failure-hunter | Error handling, silent failures, fallback behavior |
| pr-test-analyzer      | Test coverage quality and gaps                     |
| type-design-analyzer  | Type design, invariants, `any` usage               |
| comment-analyzer      | Comment accuracy, JSDoc coverage, rot risk         |

---

## Critical Issues (5 found)

### 1. Migration version/filename mismatch

**File:**
`packages/praxrr-app/src/lib/server/db/migrations/20260225_create_trash_guide_tables.ts:6-7`
**Agent:** code-reviewer, comment-analyzer

The filename says `20260225` but the migration declares `version: 20260226`. This mismatch creates
confusion for developers and risks a version collision if a future migration file is named
`20260226_*.ts`.

**Fix:** Align the filename and version number to the same date.

### 2. `any` type in TrashGuideForm.svelte

**File:** `packages/praxrr-app/src/routes/databases/components/TrashGuideForm.svelte:18` **Agent:**
code-reviewer

```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let form: any = undefined;
```

CLAUDE.md: **"NEVER use `any` type."** The eslint-disable comment is a deliberate suppression rather
than proper typing.

**Fix:** Use a proper type:
`export let form: { success?: boolean; error?: string } | undefined = undefined;`

### 3. Three bare `catch` blocks in `manager.ts` silently swallow errors

**File:** `packages/praxrr-app/src/lib/server/trashguide/manager.ts` **Agent:**
silent-failure-hunter, code-reviewer

Three separate catch blocks with zero logging, violating CLAUDE.md: **"ALWAYS throw errors early and
often"** and **"Log errors with sufficient context for debugging."**

| Lines   | Method                   | What's silenced                                                                                 |
| ------- | ------------------------ | ----------------------------------------------------------------------------------------------- |
| 413-417 | `sync()` pre-check       | Git update check errors -- `updates` retains hardcoded `{ hasUpdates: true, commitsBehind: 0 }` |
| 658-665 | `getCurrentCommitHash()` | Commit hash retrieval errors -- `null` stored with no trace                                     |
| 419-456 | `sync()` main catch      | ALL pipeline errors converted to soft `{ success: false }` without any server-side logging      |

The main `sync()` catch (lines 419-456) is the broadest: it catches every error from fetching,
parsing, transforming, persisting, and triggering sync. Any caller outside the job handler (future
API routes, CLI, etc.) will see errors vanish completely.

**Fix:** Add `logger.warn()` or `logger.error()` calls in all three catch blocks before
returning/continuing.

### 4. `autoPull` initialization ignores source value in edit mode

**File:** `packages/praxrr-app/src/routes/databases/components/TrashGuideForm.svelte:57-65`
**Agent:** code-reviewer

In edit mode, `autoPull` is hardcoded to `'true'` regardless of the actual source state. The
`TrashGuideSourceResponse` interface in `manager.ts` never exposes `auto_pull` from the database,
and `toSourceResponse()` (lines 535-548) never reads it. Result: the edit form always shows
auto-pull enabled and the actual DB value is invisible.

**Fix:** Add `autoPull: boolean` to `TrashGuideSourceResponse`, map `source.auto_pull === 1` in
`toSourceResponse()`, and use `String(source.autoPull)` in the form init.

### Validation update (2026-02-26)

Implemented the first four issues from the review:

- `20260226_create_trash_guide_tables.ts`: aligned migration filename/version (`20260226`) and
  updated `migrations.ts` import/use.
- `TrashGuideForm.svelte`: replaced the `any` form prop with a typed object.
- `manager.ts`: added logging in all three previously silent `catch` blocks (`sync` pre-check, main
  sync catch, and `getCurrentCommitHash`).
- `manager.ts` + `TrashGuideForm.svelte`: exposed `autoPull` in `TrashGuideSourceResponse`, mapped
  it from DB (`source.auto_pull === 1`), and initialized form state from the source value in edit
  mode.

Targeted checks passed: `deno task check:server` and `deno task check:client`.

### 5. `mapWriteErrorStatus` misclassifies fetcher/transform errors as 500

**Files:** `packages/praxrr-app/src/routes/api/v1/trash-guide/sources/+server.ts:152-162`,
`[id]/+server.ts:191-205` **Agent:** silent-failure-hunter

`mapWriteErrorStatus` only handles `TrashGuideSourceConflictError` (409) and
`TrashGuideSourceValidationError` (422). It does not recognize `TrashGuideFetcherError` or
`TrashGuideTransformError`, so user-correctable errors (wrong URL, wrong branch, bad credentials,
network timeout) all return HTTP 500 "Internal Server Error."

**Fix:** Add `TrashGuideFetcherError` handling -- non-retryable errors (bad URL, bad branch) -> 422,
retryable (network, auth) -> 502. Add `TrashGuideTransformError` -> 422.

### Validation update (2026-02-26)

Implemented issue #5.

- Added `TrashGuideFetcherError` and `TrashGuideTransformError` handling in both
  `packages/praxrr-app/src/routes/api/v1/trash-guide/sources/+server.ts` and
  `packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/+server.ts`.
- Mapping now returns `422` for non-retryable fetcher errors and transform errors, and `502` for
  retryable fetcher errors.
- Added route-level tests in `packages/praxrr-app/src/tests/routes/trashGuideSources.test.ts` for:
  - POST non-retryable fetcher -> `422`
  - POST retryable fetcher -> `502`
  - POST transform -> `422`
  - PUT retryable fetcher -> `502`

Targeted checks passed: `deno task check:server` and
`deno task test packages/praxrr-app/src/tests/routes/trashGuideSources.test.ts`.

---

## Important Issues (8 found)

### 6. API routes return 500 without server-side logging

Status: ✅ Fixed.

**Files:** All API route catch blocks under `routes/api/v1/trash-guide/` **Agent:**
silent-failure-hunter

Every API route catch block maps errors to HTTP status codes and returns JSON, but none log the
error server-side. When `mapWriteErrorStatus` returns 500, the error is returned to the client but
nothing is written to server logs.

**Fix:** Add `logger.error()` calls for 500-level responses in all catch blocks.

Validation: Verified by
`deno task test packages/praxrr-app/src/tests/routes/trashGuideSources.test.ts`.

### 7. Score fallback silently returns 0 when no score set matches

Status: ✅ Fixed.

**File:** `packages/praxrr-app/src/lib/server/trashguide/transformers/qualityProfiles.ts:274-297`
**Agent:** silent-failure-hunter

`resolveScoreFromCustomFormat` silently returns `0` when neither the requested score set nor the
`default` set produces a valid number. Score `0` is semantically meaningful ("do not prioritize"),
so this can cause quality profiles to behave differently than TRaSH Guide authors intended.

**Fix:** At minimum, surface this in parse issues or add a code comment referencing issue #121 if
intentional.

### 8. Duplicate utility functions across files

Status: ✅ Fixed.

**Files:** Multiple **Agent:** code-reviewer

| Function                                                    | Files                                                                                     |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `isRecord()`                                                | `fetcher.ts:515`, `parser.ts:506`, `mediaManagement.ts:144`                               |
| `parseOptionalNonEmptyString()` + `validateRepositoryUrl()` | `sources/+server.ts` and `sources/[id]/+server.ts`                                        |
| `parseArrType()`                                            | `trashGuideSources.ts:90`, `trashGuideSync.ts:60`, `trashIdMappings.ts:53`, `types.ts:32` |

**Fix:** Extract shared functions into common modules (`_helpers.ts`, `trashguide/utils.ts`, shared
parse module).

### 9. Unsafe type assertion in `compareEntityTypes`

Status: ✅ Fixed.

**File:** `packages/praxrr-app/src/lib/server/trashguide/transformer.ts:594-599` **Agent:**
code-reviewer, type-design-analyzer

```typescript
return ENTITY_TYPE_ORDER[a as TrashGuideEntityType] - ENTITY_TYPE_ORDER[b as TrashGuideEntityType];
```

The `as TrashGuideEntityType` casts bypass type safety. If `TrashIdMappingEntityType` ever diverges,
the lookup returns `undefined` causing `NaN` subtraction and broken sort order.

**Fix:** Use a unified type or add a runtime guard.

### 10. `UnifiedDatabaseItem` is a weak flat type instead of a discriminated union

Status: ✅ Fixed.

**File:** `packages/praxrr-app/src/routes/databases/types.ts` **Agent:** type-design-analyzer

Optional fields create an "anything goes" shape. `arrType` is typed as `string` instead of
`TrashGuideSupportedArrType`, losing domain constraints.

**Fix:** Refactor to a proper discriminated union:

```typescript
type UnifiedDatabaseItem =
  | { type: 'pcd' /* PCD fields required */ }
  | { type: 'trash'; arrType: TrashGuideSupportedArrType /* TRaSH fields required */ };
```

### 11. `TrashGuideTransformedOperation` has uncorrelated `portableEntityType` and `data`

Status: ✅ Fixed.

**File:** `packages/praxrr-app/src/lib/server/trashguide/transformer.ts:61-77` **Agent:**
type-design-analyzer

The type allows impossible combinations (e.g., `portableEntityType: 'custom_format'` with
`data: PortableSonarrNaming`). Runtime is correct but the type system does not prevent mismatches.

**Fix:** Make it a discriminated union on `portableEntityType`.

Validation: Verified by
`deno task test packages/praxrr-app/src/tests/trashguide/transformer.test.ts`.

### 12. `toRunMetadata` fabricates "unknown" status instead of failing

**File:** `packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/sync/+server.ts:100-113`
**Agent:** silent-failure-hunter

When the job queue record is not found (race condition or DB inconsistency), the function fabricates
a response with `status: 'unknown'` and a fake timestamp. This masks a real problem.

**Fix:** Throw an error or return 500.

### 13. `walkDirectoryForJson` propagates raw Deno errors without context

**File:** `packages/praxrr-app/src/lib/server/trashguide/fetcher.ts:342-369` **Agent:**
silent-failure-hunter

If a directory becomes unreadable mid-walk, the raw Deno error propagates with no context about
which entity directory was being scanned.

**Fix:** Wrap `Deno.readDir` in a try-catch that throws a contextual `TrashGuideFetcherError`.

---

## Test Coverage Analysis

### Coverage Summary

| Module                            | Lines  | Tests    | Coverage                                                  |
| --------------------------------- | ------ | -------- | --------------------------------------------------------- |
| `fetcher.ts`                      | 521    | 0        | **None**                                                  |
| `manager.ts`                      | 673    | 0        | **None**                                                  |
| `parser.ts`                       | 607    | 196      | Partial (identity collisions only)                        |
| `transformer.ts`                  | 633    | 520      | **Good** (renames, scores, idempotency, #121 regressions) |
| `transformers/qualityProfiles.ts` | 350    | Indirect | Via transformer tests                                     |
| `transformers/mediaManagement.ts` | 146    | 0        | **None**                                                  |
| `trashGuideSync handler`          | 243    | 202      | **Schedule only** (handler not tested)                    |
| DB query modules (4 files)        | ~1,600 | 0        | **None**                                                  |
| API routes (4 files)              | ~786   | 287      | Partial (error paths, missing PUT/DELETE/happy path)      |

### Prioritized Test Gaps

| Priority | Module                      | What to Test                                                                                | Criticality |
| -------- | --------------------------- | ------------------------------------------------------------------------------------------- | ----------- |
| 1        | `fetcher.ts`                | `classifyGitError`, `normalizeMetadataPath` (security boundary), `readMetadata` error paths | 10/10       |
| 2        | `trashGuideSync.ts` handler | `parsePayload` validation, transient retry logic, disabled/not-due guards, `auto_pull` gate | 9/10        |
| 3        | `manager.ts`                | `createSource` rollback, `updateSource` with URL change cleanup, conflict assertions        | 9/10        |
| 4        | Route `[id]/+server.ts`     | PUT update validation, DELETE handler, 404 paths                                            | 7/10        |
| 5        | `qualityProfiles.ts`        | Ambiguous cutoff, empty cutoff, group formation                                             | 7/10        |
| 6        | `mediaManagement.ts`        | Template resolution fallbacks, Radarr vs Sonarr naming                                      | 6/10        |
| 7        | `parser.ts`                 | `formatItems`-as-object, quality size compatibility, partial status                         | 6/10        |
| 8        | `trashIdMappings.ts`        | `normalizeMappings` dedup, `computeDiff` classification                                     | 5/10        |

### Test Strengths

- Transformer tests directly validate all #121 regression fixes (missing spec fields, empty quality
  items, unresolved format refs, Radarr anime compatibility)
- Idempotency testing verifies reordered/duplicated entities produce identical operations
- Route tests cover input validation and conflict detection well
- Scheduling tests verify stable dedupe key generation

---

## Type Design Analysis

### Overall Scores

| Category                    | Score | Notes                                                           |
| --------------------------- | ----- | --------------------------------------------------------------- |
| `any` type compliance       | 9/10  | One `any` in Svelte form (item #2)                              |
| Discriminated union usage   | 9/10  | Excellent for entities; missed in `TransformedOperation`        |
| Database row typing         | 8/10  | Strong row-to-domain validation; duplicate parse functions      |
| API request/response types  | 7/10  | Good validation; code duplication in helpers                    |
| Invariant expression        | 8/10  | Strong literal types; `UnifiedDatabaseItem` is the outlier      |
| Arr type discrimination     | 8/10  | Thorough runtime enforcement; `FetchOptions.arr_type` too broad |
| Transformer I/O constraints | 7/10  | Correct at runtime; type-level correlation missing              |

### Top Type Improvements

1. Correlate `portableEntityType` and `data` in `TrashGuideTransformedOperation` as discriminated
   union
2. Refactor `UnifiedDatabaseItem` to proper discriminated union
3. Narrow `TrashGuideFetchOptions.arr_type` from `TrashGuideArrType` to `TrashGuideSupportedArrType`
4. Consolidate duplicate `parseArrType`/`parseEntityType` functions into shared module
5. Convert `TrashGuideSource.enabled` and `auto_pull` from `number` to `boolean` in domain model

---

## Comment Quality Analysis

### Summary

| Metric                      | Count    |
| --------------------------- | -------- |
| JSDoc on exported functions | 0 of ~10 |
| Inline "why" comments       | 2        |
| Comment rot risks           | 5        |

### Missing JSDoc (High Priority)

Public API functions with zero JSDoc documentation:

- `fetchTrashGuideSource()` and `discoverTrashGuideFiles()` in `fetcher.ts`
- `parseTrashGuideEntities()` in `parser.ts`
- `transformTrashGuideEntities()` in `transformer.ts`
- All `TrashGuideManager` public methods in `manager.ts`
- All API route handlers (`GET`, `POST`, `PUT`, `DELETE`)

### Comment Rot Risks

1. **`TRANSFORMABLE_ENTITY_TYPES`** (transformer.ts:102) -- currently matches all entity types,
   making the guard dead code. No comment explaining if this is forward-compatibility.
2. **Template candidate paths** (mediaManagement.ts:36-65) -- hardcoded path arrays encoding TRaSH
   Guide JSON schema assumptions with no documentation.
3. **Score fallback to 0** (qualityProfiles.ts:296) -- no comment explaining intentional fallback vs
   oversight.
4. **`sync_strategy` column** (migration SQL) -- column name doesn't indicate its unit (minutes).
   `0` has special meaning (disabled).
5. **`DEFAULT_BRANCH = 'master'`** duplicated in fetcher.ts:20 and manager.ts:23 -- no comment
   explaining TRaSH Guide convention.

---

## Suggestions (Nice to Have)

### 14. `toCacheRows` uses `Promise.all` over potentially thousands of entities

**File:** `manager.ts:638-656`

For large TRaSH Guide repos, `Promise.all` over all entities creates thousands of concurrent
microtasks for `crypto.subtle.digest`. Consider sequential processing or batching for memory
predictability.

### 15. Consider branded type for `TrashGuideId`

**File:** `types.ts`

`TrashGuideId` resolves to `string` at compile time, so any string can be silently assigned. A
branded type would force construction through `isTrashGuideId`:

```typescript
type TrashGuideId = string & { readonly __brand: 'TrashGuideId' };
```

### 16. Consider a job payload registry type

**File:** `queueTypes.ts`

The generic `Record<string, unknown>` payload type could be replaced with a mapped type connecting
`jobType` to specific payload interfaces for type-safe enqueue/dequeue.

---

## Strengths

- **Strong domain modeling** with discriminated unions, typed error classes (error codes,
  retryability, context), and exhaustive `never` checks
- **Correct Cross-Arr validation** -- `arr_type` explicitly validated at every layer boundary
  (fetcher, parser, transformer, query, API)
- **Clean separation of concerns** across fetcher/parser/transformer/manager pipeline
- **Proper fail-fast behavior** in parsing and transformation
- **Well-designed schema** with appropriate foreign keys, cascading deletes, and scope validation
- **Correct Svelte 5 patterns** -- no runes, uses reactive `$:` and `onclick` handlers as prescribed
- **Thorough transformer tests** directly validating all #121 regression scenarios
- **Parser resilience model** -- individual file failures collected as structured issues without
  aborting the batch

---

## Recommended Action Plan

### Before Merge (Critical)

1. Fix migration version/filename mismatch (item #1)
2. Replace `any` type in TrashGuideForm (item #2)
3. Add logging to all three bare catch blocks in `manager.ts` (item #3)
4. Expose `autoPull` in `TrashGuideSourceResponse` and fix form init (item #4)
5. Add `TrashGuideFetcherError`/`TrashGuideTransformError` to `mapWriteErrorStatus` (item #5)

### Should Fix (Important)

6. Add server-side logging for 500 responses in API routes (item #6)
7. Document or fix score fallback to 0 (item #7)
8. Extract duplicate utility functions (item #8)
9. Fix unsafe type assertion in `compareEntityTypes` (item #9)

### Follow-Up PR

10. Add test coverage for `fetcher.ts`, `manager.ts`, job handler, and `mediaManagement.ts`
11. Refactor `UnifiedDatabaseItem` and `TrashGuideTransformedOperation` types
12. Add JSDoc to all public API functions
13. Address comment rot risks with inline documentation
