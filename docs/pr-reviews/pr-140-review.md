# PR #140 Review: feat(trash): read-only entity detail views with clickable navigation

**Date:** 2026-02-27
**Branch:** `feat/trash-entity-detail-views` -> `main`
**Scope:** 54 files, +2808/-86 lines

## Summary

Adds browsable entity list pages and individual detail pages for TRaSH Guide sources (Custom Formats, Quality Profiles, Quality Sizes, Naming), a single-entity API endpoint, shared detail components, TRaSH entity clickability in PCD combined views, and a DB migration for normalizing trash IDs.

---

## Critical Issues (3 found)

### C-1: `hasContentChanged` silently returns `false` on empty trashId

**File:** `packages/praxrr-app/src/lib/server/db/queries/trashGuideEntityCache.ts:347-349`

When `trashId` is empty/whitespace, the function returns `false` ("content has not changed") instead of throwing. This is semantically wrong -- an empty trashId is invalid input, not a "no change" condition. Callers in the sync pipeline will silently skip updates, leading to stale cache data with zero diagnostic trail.

Violates CLAUDE.md: "ALWAYS throw errors early and often. Do not use fallbacks."

**Fix:** Throw an error for empty trashId on this write-path helper.
**Status:** Fixed.
Validation: Added `assertThrows` coverage in `packages/praxrr-app/src/tests/db/trashGuideEntityCache.test.ts` for empty `trashId` input.

### C-2: `getByKey` silently returns `undefined` on empty trashId

**File:** `packages/praxrr-app/src/lib/server/db/queries/trashGuideEntityCache.ts:284-287`

Empty `trashId` returns `undefined`, indistinguishable from "entity not found." All page server load functions and the API endpoint inherit this deception. A URL like `/databases/trash/1/custom-formats/%20/general` shows "not found" instead of "invalid ID."

**Systemic pattern:** Write operations (`upsert`) correctly throw on empty trashId, but read operations silently return "not found" values. This asymmetry means corrupted lookups produce wrong results silently.
**Fix:** Throw an error for empty `trashId` and let callers handle invalid ID reporting.
**Status:** Fixed.
Validation: Added `assertThrows` coverage in `packages/praxrr-app/src/tests/db/trashGuideEntityCache.test.ts` for empty `trashId` input.

### C-3: Same silent-return pattern in `trashIdMappings.ts`

**File:** `packages/praxrr-app/src/lib/server/db/queries/trashIdMappings.ts:220-223, 256-259`

`getByArrTypeAndTrashId` returns `[]` and `getByIdentity` returns `undefined` on empty trashId, while `upsert` correctly throws. Inconsistent validation between read and write paths.
**Fix:** Replace silent returns with consistent throw-fast validation and return typed results only when input is valid.
**Status:** Fixed.
Validation: Added `packages/praxrr-app/src/tests/db/trashIdMappings.test.ts` with throw assertions for empty `trashId` in `getByArrTypeAndTrashId` and `getByIdentity`.

---

## Important Issues (8 found)

### I-1: 15+ `any` type violations across 5 new Svelte components

**Files:**

- `databases/trash/[id]/custom-formats/[trashId]/conditions/+page.svelte` (4 occurrences)
- `databases/trash/[id]/custom-formats/[trashId]/general/+page.svelte` (1)
- `databases/trash/[id]/quality-profiles/[trashId]/qualities/+page.svelte` (5)
- `databases/trash/[id]/quality-profiles/[trashId]/scoring/+page.svelte` (3)
- `databases/trash/[id]/quality-sizes/[trashId]/+page.svelte` (4)

Uses `Column<any>[]` and `(row: any)` callback patterns. Directly violates CLAUDE.md: "NEVER use `any` type, use proper types." These are new files, not legacy code. Domain types already exist and should be used.

**Fix:** Define local row-shape interfaces for each table and use them in `Column<T>` generics.
**Status:** Implemented.
**Validation:** Updated all 5 files listed above to remove `any` usage and added typed callbacks/column generics.

### I-2: `trashId` on wrong type in discriminated union

**File:** `packages/praxrr-app/src/lib/shared/sources/types.ts:27-45`

`trashId?: string` is placed on `SourceDisplayRowBase`, making it available on PCD-sourced rows. The JSDoc says "only set for TRaSH-sourced rows" but the type system does not enforce this. This is the "invariant enforced only through documentation" anti-pattern.

**Fix:** Move `trashId` off `SourceDisplayRowBase` onto `TrashSourcedDisplayRow` only, making it required (not optional).
**Status:** Implemented.
**Validation:** Updated `packages/praxrr-app/src/lib/shared/sources/types.ts` so `trashId` is required on `TrashSourcedDisplayRow` and absent (`never`) on PCD rows.

### I-3: `getRowHref` functions don't guard against undefined `trashId`

**Files:** All 4 entity list pages (`custom-formats/+page.svelte`, `quality-profiles/+page.svelte`, `quality-sizes/+page.svelte`, `naming/+page.svelte`)

`format.trashId` is typed as `string | undefined`. Missing trashId produces `".../custom-formats/undefined/"` -- a broken URL silently passed as a row link.

**Fix:** Return `null` when `trashId` is missing to prevent linking.
**Status:** Implemented.
**Validation:** Added guard checks in all 4 list pages (`custom-formats/+page.svelte`, `quality-profiles/+page.svelte`, `quality-sizes/+page.svelte`, `naming/+page.svelte`) to skip links when `trashId` is missing.

### I-4: Raw HTML interpolation of `custom_format_trash_id` in scoring page

**File:** `databases/trash/[id]/quality-profiles/[trashId]/scoring/+page.svelte:28`

Interpolates data into `{@html}` without escaping. While TRaSH IDs are hex-validated at parse time and the `Column<any>` bypasses type checks, this could become an XSS vector if refactored.

**Fix:** Use `escapeHtml()` utility when interpolating dynamic values into `{@html}` strings.
**Status:** Implemented.
**Validation:** Added `src/lib/client/utils/escapeHtml.ts` and applied it in `quality-profiles/[trashId]/scoring/+page.svelte` for `custom_format_trash_id`.

### Targeted validation run

- `DENO_DIR=/tmp/deno_cache deno test packages/praxrr-app/src/tests/routes/trashGuideQualityProfileScoringPage.test.ts --allow-read --allow-write --allow-env --allow-ffi --allow-run --allow-net` (passed: `1 passed`, `0 failed`)
- `DENO_DIR=/tmp/deno_cache deno test packages/praxrr-app/src/tests/routes/trashGuideSourceEntityByTrashId.test.ts --allow-read --allow-write --allow-env --allow-ffi --allow-run --allow-net` (passed: `2 passed`, `0 failed`)

### I-5: `parseCachedEntity` catch block swallows all exceptions as "Malformed JSON"

**File:** `packages/praxrr-app/src/lib/server/trashguide/displayTransform.ts:162-165`

Bare `catch` catches every possible exception, not just `JSON.parse` `SyntaxError`. Type guard bugs, `TypeError`, or `RangeError` are all mislabeled as "Malformed JSON."

**Fix:** Catch only `SyntaxError`; re-throw everything else.

### I-6: List page loaders silently drop malformed entities without user notification

**Files:** All 4 entity list `+page.server.ts` files

`.map().filter(row !== null)` pattern removes malformed entities silently. Users see fewer entities than expected with no indication entries were skipped.

**Fix:** Track skipped count and surface it in the page data.

### I-7: Duplicated `normalizeTrashId` function across 3 locations

**Files:**

- `db/queries/trashGuideEntityCache.ts:66`
- `db/queries/trashIdMappings.ts:53`
- `trashguide/types.ts` (inline in `toTrashGuideId`)

Three independent implementations of `trashId.trim().toLowerCase()`. If normalization rules change, all three must update in lockstep.

**Fix:** Extract to a shared utility module.

### I-8: API response type is inline with no contract

**File:** `api/v1/trash-guide/sources/[id]/entities/[trashId]/+server.ts:72-80`

The response shape is defined inline in the `json()` call with no exported interface. CLAUDE.md requires "Contract-first API: Define OpenAPI spec first, generate types, then implement."

**Fix:** Define a `TrashGuideEntityDetailResponse` interface and add OpenAPI spec entry.

---

## Suggestions (9 found)

### S-1: Migration collision check error messages are opaque

**File:** `db/migrations/20260227_normalize_trash_guide_trash_ids.ts:19-24`

If collisions exist, the UNIQUE constraint error from SQLite won't identify which specific trash_ids collided, and the temp table evidence is dropped.

**Suggestion:** Add a pre-check query that identifies collisions before attempting the insert, or expand JSDoc to explain the strategy.

### S-2: `isTrashGuideId` regex `/i` flag inconsistent with lowercase invariant

**File:** `trashguide/types.ts:62`

Regex uses case-insensitive flag but canonical form is lowercase-only. The `i` flag is now redundant since `toTrashGuideId` normalizes first.

**Suggestion:** Either drop `/i` flag or add a comment explaining it's intentional for pre-normalization input.

### S-3: `asTrashGuideId` is an unguarded escape hatch

**File:** `trashguide/types.ts:75`

Bypasses the `isTrashGuideId` guard entirely, allowing arbitrary strings to be cast to `TrashGuideId`.

**Suggestion:** Rename to `unsafeAsTrashGuideId` or add runtime normalization.

### S-4: Layout loader uses lenient `parseInt` vs API's strict validation

**File:** `databases/trash/[id]/+layout.server.ts:8`

`parseInt('42garbage', 10)` returns `42`. The API endpoint uses strict `/^\d+$/` validation.

**Suggestion:** Use the same strict regex validation.

### S-5: Redirect load functions don't validate `trashId` parameter

**Files:** `custom-formats/[trashId]/+page.server.ts`, `quality-profiles/[trashId]/+page.server.ts`

Directly interpolate params into redirect URLs without validation.

### S-6: `logMalformedCacheRow` uses fire-and-forget logging

**File:** `displayTransform.ts:129`

`void logger.warn(...)` discards the Promise. If the logger fails, the only diagnostic signal for disappearing entities is lost.

**Suggestion:** Add `.catch()` to surface logger failures.

### S-7: Duplicated `formatDate` helper across detail pages

Multiple detail view components define the same `formatDate` function.

**Suggestion:** Extract to a shared client utility.

### S-8: Missing JSDoc on `toSyntheticId` function

**File:** `displayTransform.ts:44-55`

FNV-1a hashing to generate deterministic negative synthetic IDs -- non-obvious logic with no documentation explaining purpose, negative-ID convention, or stability guarantee.

### S-9: Misleading `@throws {never}` JSDoc on API GET handler

**File:** `api/v1/trash-guide/sources/[id]/entities/[trashId]/+server.ts:19`

Handler body throws internally and `logTrashGuideRouteError` may also throw. The `@throws {never}` annotation creates a false guarantee.

---

## Test Coverage Gaps

### Gap Priority Table

| Area                                  | New Code          | Tests               | Gap                           |
| ------------------------------------- | ----------------- | ------------------- | ----------------------------- |
| API endpoint validation (6 branches)  | +server.ts        | 2 of 8 paths tested | Missing 400/404/422 cases     |
| trashIdMappings normalization         | ~60 lines changed | 0 tests             | Entire module untested        |
| Entity cache upsert guard             | ~10 lines         | 0 tests             | Write-path unverified         |
| Entity cache empty-id early returns   | ~15 lines         | Partial             | 2-3 edge cases missing        |
| Scoring page resolution branches      | ~20 lines         | 1 of 3 branches     | Fallback paths untested       |
| page.server.ts detail loads (8)       | ~200 lines        | 0 direct tests      | Covered indirectly only       |
| page.server.ts list loads (4)         | ~220 lines        | 0 tests             | Not tested                    |
| toTrashGuideId normalization          | ~5 lines          | 0 tests             | Behavior change untested      |
| Display transform trashId propagation | 4 functions       | 1 of 4 asserted     | 3 functions missing assertion |

### Most Impactful Missing Tests

1. **API endpoint validation branches** - Missing type param -> 400, invalid type -> 422, cache miss -> 404, source not found -> 404
2. **trashIdMappings normalization** - upsert throws on empty, getByArrTypeAndTrashId returns [] for whitespace, normalizeMappings conflict detection
3. **Scoring page fallback resolution** - score_set missing falls back to default, neither exists returns null, referenced CF missing from cache

---

## Type Design Ratings

| Type / Area                                  | Encapsulation | Invariant Expression | Usefulness | Enforcement |
| -------------------------------------------- | ------------- | -------------------- | ---------- | ----------- |
| `TrashGuideId` (branded)                     | 7/10          | 7/10                 | 8/10       | 6/10        |
| `SourceDisplayRowBase` / `SourcedDisplayRow` | 4/10          | 4/10                 | 7/10       | 3/10        |
| `TrashGuideEntityCache` / `Input`            | 6/10          | 5/10                 | 8/10       | 7/10        |
| API Response (inline JSON)                   | 3/10          | 4/10                 | 6/10       | 3/10        |
| Svelte `any` usage (5 components)            | 2/10          | 1/10                 | 1/10       | 1/10        |
| `SourcedResult` (display transform)          | 7/10          | 6/10                 | 7/10       | 7/10        |
| `TrashIdMapping` / `Input`                   | 6/10          | 5/10                 | 8/10       | 7/10        |

---

## Strengths

- **Thorough input normalization**: TRaSH ID normalization applied consistently at every query boundary (upsert, getByKey, hasContentChanged, getBySourceTypeAndTrashIds, trashIdMappings).
- **Migration safety**: Collision-check-before-update pattern prevents silent data loss. Uses `DROP TABLE IF EXISTS` for idempotency.
- **Proper API error handling**: Validates all inputs with appropriate HTTP status codes (400, 404, 422, 500).
- **Consistent routing conventions**: Routes follow project pattern. Entity detail pages use inner tabs per "routes over modals" convention.
- **No Svelte 5 runes used**: All reactive state uses `$:` declarations, matching project convention.
- **Good test coverage for critical paths**: Tests cover entity cache normalization, scoring page cross-entity resolution, and API endpoint happy/error paths.
- **Convention-compliant commits**: Messages use conventional format (`feat(ui):`, `refactor(migration):`, `fix:`).
- **Well-designed scoring resolution**: Cross-entity score lookup correctly uses profile's `score_set` to select the right score from CF's score map.

---

## Recommended Action Plan

### Phase 1: Critical Fixes

1. Make read-path query functions fail consistently with write-path on empty trashId
2. Replace all `any` types in 5 Svelte components with proper types

### Phase 2: Important Fixes

3. Move `trashId` onto `TrashSourcedDisplayRow` only in discriminated union
4. Add `trashId` null guards in `getRowHref` functions
5. Narrow catch block in `parseCachedEntity` to `SyntaxError` only
6. Extract `normalizeTrashId` to shared utility
7. Define API response type and add HTML escaping for `{@html}` interpolation

### Phase 3: Test Coverage

8. Add API endpoint validation branch tests (400/404/422)
9. Add trashIdMappings normalization tests
10. Add scoring page fallback resolution tests
11. Assert trashId propagation in remaining display transform tests
