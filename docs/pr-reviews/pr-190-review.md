# PR #190 Review: feat: complete score simulator phase 3

**Branch:** `feat/score-simulator-phase3` **Date:** 2026-03-07 **Files
Changed:** 41 (+10,810 / -865) **Reviewers:** code-reviewer,
silent-failure-hunter, pr-test-analyzer, type-design-analyzer

---

## Critical Issues (3 found — 3 Fixed)

### C1. ~~SimulateButton hardcodes `arrType: 'radarr'`~~ — Cross-Arr policy violation

**Status:** Fixed **File:**
`packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/scoring/components/SimulateButton.svelte:12`

The deep-link button always sets `arrType: 'radarr'` regardless of the profile's
actual Arr type. A Sonarr profile will simulate with the wrong Arr type,
producing incorrect scores. CLAUDE.md Cross-Arr Semantic Validation Policy:
"Read/write/sync dispatch resolves by explicit `arr_type` (no implicit sibling
fallback)."

**Fix:** Accept an `arrType` prop from the parent scoring page (which knows
`data.scoring.arrTypes`) or derive it from profile metadata.

### C2. ~~Phase 2 tests broken by Phase 3 changes~~

**Status:** Fixed **File:**
`packages/praxrr-app/src/tests/routes/scoreSimulatorPhase2Helpers.test.ts`

Three existing tests fail:

- `buildRankingFromResults ranks a single result as rank 1`
- `buildRankingFromResults sorts by descending score`
- `buildRankingFromResults assigns tied ranks and skips for next`

**Root cause:** `buildRankingFromResults` now calls
`computeOverriddenTotal(contributions, overrides)` instead of reading
`totalScore`. The Phase 2 test factory creates profiles with `totalScore: 10`
but `contributions: []`, so `computeOverriddenTotal` sums an empty array and
returns 0.

**Fix:** Update the test factory `makeProfileScore` to supply contributions
consistent with `totalScore`, or adjust the function to fall back to
`totalScore` when overrides is empty.

### C3. ~~Silent swallow of TRaSH source lookup errors with permanent cache poisoning~~

**Status:** Fixed **File:**
`packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts:508`

```typescript
try {
  source = trashGuideSourcesQueries.getById(sourceId);
} catch {
  fallbackCfGroupsBySource.set(sourceId, []); // permanently cached
  return [];
}
```

This bare `catch {}` swallows every error (including DB connection failures, SQL
corruption) with zero logging. The empty result is permanently cached in the
module-level `Map`, meaning even transient errors (DB lock) permanently suppress
CF groups for that source for the lifetime of the process. Scores silently
become incorrect with no indication.

**Fix:** Log the error with `logger.warn`. Do not cache the empty result on
error -- only cache on successful empty discovery. Add TTL-based invalidation.

---

## Important Issues (7 found — 7 Fixed)

### I1. ~~Module-level `fallbackCfGroupsBySource` cache grows unboundedly and never invalidates~~

**Status:** Fixed **File:**
`packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts:38`

The `Map` caches TRaSH guide CF groups per source ID forever. If TRaSH guide
data is updated, stale groups are served indefinitely. Combined with C3, a
transient error permanently poisons the cache.

**Fix:** Replaced raw `Map` with the existing `Cache` singleton from
`$cache/cache.ts` using a 10-minute TTL. Error paths no longer cache empty
results.

### I2. ~~Unsafe type cast: `'neutral' as 'danger'`~~

**Status:** Fixed **File:**
`packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/RankingTable.svelte:115`

The return type declared `'danger' | 'success' | 'warning'` but the default case
returned `'neutral'` cast to `'danger'`.

**Fix:** Widened return type to `'danger' | 'success' | 'warning' | 'neutral'`
and removed the `as 'danger'` cast.

### I3. ~~`buildRankingFromResults` silently returns empty array on missing profile~~

**Status:** Fixed **File:**
`packages/praxrr-app/src/routes/score-simulator/[databaseId]/helpers.ts:157-160`

When `profileAName` doesn't match any profile in results, the function silently
returned `[]`, discarding all valid rankings.

**Fix:** Changed to `console.warn` and `continue` — skips individual releases
missing the profile instead of discarding all rankings. Updated tests to match
new behavior.

### I4. ~~Evaluator regex catch blocks silently skip patterns~~

**Status:** Fixed **File:**
`packages/praxrr-app/src/lib/server/pcd/entities/customFormats/evaluator.ts:339-341, 557-559, 606-608`

Three `catch {}` blocks silently skipped regex patterns that fail.

**Fix:** Added deduplicated `console.warn` logging via a module-level
`Set<string>` in all three catch blocks (`evaluatePattern`, `evaluateEdition`,
`evaluateReleaseGroup`).

### I5. ~~URL state `parseBatchParam` / `parseOverridesParam` silently discard malformed data~~

**Status:** Fixed **File:**
`packages/praxrr-app/src/routes/score-simulator/[databaseId]/urlState.ts:32-130`

Malformed batch/override params (truncated URL, encoding error) silently
returned `undefined`, indistinguishable from "not provided." Users could lose
their batch titles or what-if overrides with no debugging signal.

**Fix:** Added module-prefixed `console.warn` logging for malformed `batch` and
`overrides` params on decode failures and invalid decoded shapes. Extended
URL-state tests to assert the warnings while preserving the existing `undefined`
fallback behavior.

### I6. ~~Missing test coverage for `trash_scores` optional acceptance~~

**Status:** Fixed **File:**
`packages/praxrr-app/src/tests/trashguide/parser.test.ts:175-206`

The parser already defaulted missing `trash_scores` to `{}`, but test fixtures
always supplied the field. There was no coverage proving a custom format without
`trash_scores` parsed successfully.

**Fix:** Added a parser unit test that omits `trash_scores` entirely and
verifies successful parsing with `scores: {}`.

### I7. ~~No unit tests for `buildRankingFromResults`/`buildComparisonResult` with overrides~~

**Status:** Fixed **File:**
`packages/praxrr-app/src/tests/routes/scoreSimulatorPhase3Helpers.test.ts:130-241`

Phase 3 added `ScoreOverrideMap` params to both functions, but no unit test
exercised ranking/comparison integration with overrides.

**Fix:** Added focused tests covering ranking re-ordering from overrides,
threshold-state flips in ranked output, and comparison recalculation of
`profileATotal`, `totalDelta`, and `originalScoreA`.

---

## Suggestions (10 found — 10 Fixed)

### S1. ~~Remove `arrType` from `SimulatorUrlState`~~

**Status:** Fixed **Files:**
`packages/praxrr-app/src/routes/score-simulator/[databaseId]/urlState.ts`,
`packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte`

It is fully derivable from `mediaType` via
`resolveReleaseTypeForPresetCategory`. Its presence creates a contradiction
surface (e.g., `arrType: 'radarr'` with `mediaType: 'anime'`).

**Fix:** Removed `arrType` from the public URL-state shape and new share-link
serialization. Legacy `arrType=radarr|sonarr` links still parse by deriving
`mediaType` inside `parseUrlState`, so old links remain readable without
preserving the contradictory field.

### S2. ~~Remove dead types `BatchInputState` and `ComparisonState`~~

**Status:** Fixed **File:**
`packages/praxrr-app/src/routes/score-simulator/[databaseId]/helpers.ts`

These are exported but never used as runtime objects. The page manages their
fields as separate `let` bindings. `showDeltas` in `ComparisonState` is unused
entirely.

**Fix:** Deleted both unused exported types from `helpers.ts`.

### S3. ~~Remove unused `comparisonRank` field from `RankedRelease`~~

**Status:** Fixed **File:**
`packages/praxrr-app/src/routes/score-simulator/[databaseId]/helpers.ts`

Declared in the type but never assigned in `buildRankingFromResults`. Dead field
that misleads consumers.

**Fix:** Removed the unused `comparisonRank` property from `RankedRelease`.

### S4. ~~Move `SimulatorProfileOption` to `helpers.ts`~~

**Status:** Fixed **Files:**
`packages/praxrr-app/src/routes/score-simulator/[databaseId]/helpers.ts`,
`packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte`,
`packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ReleaseInput.svelte`,
`packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ProfileComparison.svelte`

Currently defined inline in `+page.svelte`. Moving it alongside other shared
types makes it referenceable by child components and eliminates the
`as Array<{...}>` type safety escape hatch.

**Fix:** Exported a shared `SimulatorProfileOption` type from `helpers.ts` and
updated the page plus child components to consume it. The page no longer uses
the `data.qualityProfiles as Array<{...}>` cast.

### S5. ~~Rename local `MediaType` alias in `urlState.ts`~~

**Status:** Fixed **File:**
`packages/praxrr-app/src/routes/score-simulator/[databaseId]/urlState.ts`

Collides with the OpenAPI-generated `MediaType` from `$api/v1.d.ts` (which is
`'movie' | 'series'` without `'anime'`). Rename to `SimulatorMediaType` or
inline `PresetCategory` directly.

**Fix:** Removed the misleading local alias and typed simulator URL-state media
fields directly as `PresetCategory`.

### S6. Add `console.warn` to clipboard fallback catch blocks

**Status:** Fixed **File:** `packages/praxrr-app/src/routes/score-simulator/[databaseId]/urlState.ts`

The first catch discards clipboard API errors; the second discards `execCommand`
errors. The caller does check `success: false`, but developers debugging
clipboard issues get no console output.

**Fix:** Added module-prefixed `console.warn` logging for both failed
`navigator.clipboard.writeText` and failed `document.execCommand` fallback
attempts. Added URL-state tests covering both warning paths.

### S7. Server route uses fragile string matching for error classification

**Status:** Fixed **Files:**
`packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts`,
`packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/scoring/read.ts`

```typescript
if (err instanceof Error && err.message.includes('not found')) {
```

Uses `err.message.includes('not found')` to distinguish "profile not found" from
other errors. An unrelated error containing "not found" would be misclassified.
Consider a specific error type or error code.

**Fix:** Introduced `QualityProfileScoringNotFoundError` in the scoring reader
and changed the route to classify missing PCD profiles by error type instead of
message substring matching. Added a route test proving a generic scoring error
containing `not found` still surfaces as HTTP 500.

### S8. `handleCopyLink` has no try-catch for unhandled exceptions

**Status:** Fixed **Files:**
`packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte`,
`packages/praxrr-app/src/routes/score-simulator/[databaseId]/urlState.ts`

The original `btoa()` example is no longer current after the UTF-8 share-link
encoding fix, but the copy pipeline still had an unhandled-exception surface if
share-link generation or copy setup threw unexpectedly.

**Fix:** Wrapped `handleCopyLink` in try-catch so unexpected failures surface as
an error alert instead of an unhandled rejection. `copyShareLink` now also logs
clipboard fallback failures, making copy-path debugging visible.

### S9. Mark `ProfileScoreDelta` and `ComparisonResult` fields as `readonly`

**Status:** Fixed **File:**
`packages/praxrr-app/src/routes/score-simulator/[databaseId]/helpers.ts`

Low-cost change that prevents accidental mutation after construction.

**Fix:** Marked all `ProfileScoreDelta` and `ComparisonResult` fields as
`readonly`, including the `contributions` collection.

### S10. Create a factory for `ScoreOverrideMap` entries

**Status:** Fixed **Files:**
`packages/praxrr-app/src/routes/score-simulator/[databaseId]/helpers.ts`,
`packages/praxrr-app/src/routes/score-simulator/[databaseId]/urlState.ts`,
`packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte`

Validation logic (rounding, finite check) is duplicated in
`handleOverrideChange` and `parseOverridesParam`. A single factory function
would centralize this.

**Fix:** Added `createScoreOverrideEntry()` in `helpers.ts` and reused it from
the page override handler plus URL-state parse/serialize normalization so
rounding and finite-value validation live in one place. Added helper tests for
the new normalization path.

---

## Strengths

- **Well-structured URL state module** with clean parse/serialize symmetry and
  progressive truncation
- **Override engine is well-tested** with dedicated unit tests for
  `applyScoreOverrides`, `computeOverriddenTotal`,
  `resolveThresholdWithOverrides`
- **URL state round-trip tests are thorough** covering empty params, invalid
  types, malformed base64, round-trips, special characters
- **Discriminated union for `ResolvedProfile`** is textbook TypeScript --
  enables clean narrowing in the dual-source scoring pipeline
- **Preset validation pipeline** with
  `parsePresetData`/`isPresetGroup`/`isPresetTitle` guards is rigorous and
  fail-fast at module load
- **Integration tests are comprehensive** covering parser-down scenarios,
  validation, mixed PCD+TRaSH scoring, anime inference, CF group fallback
- **Follows Svelte conventions** -- uses `$:` reactive declarations and
  `on:click` handlers (no runes), no `any` types
- **Good test file organization** -- `Phase3Helpers`, `UrlState`, `Presets`,
  `EntityTestingEvaluateRoute` are cleanly separated

---

## Type Design Summary

| Type                    | Encapsulation | Invariant Expression | Usefulness | Enforcement |
| ----------------------- | ------------- | -------------------- | ---------- | ----------- |
| SimulatorUrlState       | 4/10          | 5/10                 | 7/10       | 6/10        |
| ScoreOverrideMap        | 2/10          | 2/10                 | 7/10       | 4/10        |
| PresetCategory          | 8/10          | 8/10                 | 8/10       | 7/10        |
| PresetGroup             | 3/10          | 5/10                 | 7/10       | 7/10        |
| ShareLinkMode           | 9/10          | 7/10                 | 8/10       | 9/10        |
| ResolvedProfile (union) | 7/10          | 8/10                 | 9/10       | 7/10        |
| RankedRelease           | 3/10          | 5/10                 | 8/10       | 5/10        |
| SimulatorProfileOption  | 3/10          | 4/10                 | 6/10       | 4/10        |

---

## Recommended Action

1. ~~**Fix critical issues** C1 (hardcoded arrType), C2 (broken tests), C3
   (silent cache poisoning) before merge~~ — All fixed
2. ~~**Address important issues** I1-I7, prioritizing silent-failure and
   override-validation gaps~~ — All fixed
3. **Consider suggestions** S1-S10 for follow-up cleanup
4. **Re-run tests** after fixes: `deno task test`
