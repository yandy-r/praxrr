# PR #190 Review: feat: complete score simulator phase 3

**Branch:** `feat/score-simulator-phase3` **Date:** 2026-03-07 **Files Changed:** 41 (+10,810 /
-865) **Reviewers:** code-reviewer, silent-failure-hunter, pr-test-analyzer, type-design-analyzer

---

## Critical Issues (3 found)

### C1. SimulateButton hardcodes `arrType: 'radarr'` -- Cross-Arr policy violation

**File:**
`packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/scoring/components/SimulateButton.svelte:12`

The deep-link button always sets `arrType: 'radarr'` regardless of the profile's actual Arr type. A
Sonarr profile will simulate with the wrong Arr type, producing incorrect scores. CLAUDE.md
Cross-Arr Semantic Validation Policy: "Read/write/sync dispatch resolves by explicit `arr_type` (no
implicit sibling fallback)."

**Fix:** Accept an `arrType` prop from the parent scoring page (which knows `data.scoring.arrTypes`)
or derive it from profile metadata.

### C2. Phase 2 tests broken by Phase 3 changes (live regression)

**File:** `packages/praxrr-app/src/tests/routes/scoreSimulatorPhase2Helpers.test.ts`

Three existing tests fail:

- `buildRankingFromResults ranks a single result as rank 1`
- `buildRankingFromResults sorts by descending score`
- `buildRankingFromResults assigns tied ranks and skips for next`

**Root cause:** `buildRankingFromResults` now calls
`computeOverriddenTotal(contributions, overrides)` instead of reading `totalScore`. The Phase 2 test
factory creates profiles with `totalScore: 10` but `contributions: []`, so `computeOverriddenTotal`
sums an empty array and returns 0.

**Fix:** Update the test factory `makeProfileScore` to supply contributions consistent with
`totalScore`, or adjust the function to fall back to `totalScore` when overrides is empty.

### C3. Silent swallow of TRaSH source lookup errors with permanent cache poisoning

**File:** `packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts:508`

```typescript
try {
  source = trashGuideSourcesQueries.getById(sourceId);
} catch {
  fallbackCfGroupsBySource.set(sourceId, []); // permanently cached
  return [];
}
```

This bare `catch {}` swallows every error (including DB connection failures, SQL corruption) with
zero logging. The empty result is permanently cached in the module-level `Map`, meaning even
transient errors (DB lock) permanently suppress CF groups for that source for the lifetime of the
process. Scores silently become incorrect with no indication.

**Fix:** Log the error with `logger.warn`. Do not cache the empty result on error -- only cache on
successful empty discovery. Add TTL-based invalidation.

---

## Important Issues (7 found)

### I1. Module-level `fallbackCfGroupsBySource` cache grows unboundedly and never invalidates

**File:** `packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts:38`

The `Map` caches TRaSH guide CF groups per source ID forever. If TRaSH guide data is updated, stale
groups are served indefinitely. Combined with C3, a transient error permanently poisons the cache.

**Fix:** Add TTL-based invalidation or clear the cache when TRaSH guide sources are re-synced.

### I2. Unsafe type cast: `'neutral' as 'danger'`

**File:**
`packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/RankingTable.svelte:115`

```typescript
default:
  return 'neutral' as 'danger';  // lies to the type system
```

The return type declares `'danger' | 'success' | 'warning'` but the default case returns `'neutral'`
cast to `'danger'`. The Badge component receives `'neutral'` at runtime while TypeScript thinks it's
`'danger'`.

**Fix:** Either widen the return type to include `'neutral'` (if Badge supports it) or return
`'danger'`.

### I3. `buildRankingFromResults` silently returns empty array on missing profile

**File:** `packages/praxrr-app/src/routes/score-simulator/[databaseId]/helpers.ts:157-160`

When `profileAName` doesn't match any profile in results, the function silently returns `[]`,
discarding all valid rankings. Per CLAUDE.md: "ALWAYS throw errors early and often. Do not use
fallbacks."

**Fix:** Throw an error or `console.error` with the profile name. Consider skipping individual
releases rather than discarding entire rankings.

### I4. Evaluator regex catch blocks silently skip patterns

**File:**
`packages/praxrr-app/src/lib/server/pcd/entities/customFormats/evaluator.ts:339-341, 557-559, 606-608`

Three `catch {}` blocks silently skip regex patterns that fail. A CF that should match may not match
because its regex was silently skipped. No logging, no telemetry.

**Fix:** Log invalid patterns at least once (via a deduplication `Set`). Consider returning a
condition result that indicates "evaluation failed" rather than "did not match."

### I5. URL state `parseBatchParam` / `parseOverridesParam` silently discard malformed data

**File:** `packages/praxrr-app/src/routes/score-simulator/[databaseId]/urlState.ts:60-62, 86-88`

Malformed batch/override params (truncated URL, encoding error) silently return `undefined`,
indistinguishable from "not provided." Users lose their batch titles or what-if overrides with no
explanation.

**Fix:** Add `console.warn` for debugging. Optionally return a structured result distinguishing "not
provided" from "provided but invalid."

### I6. Missing test coverage for `trash_scores` optional acceptance

**File:** `packages/praxrr-app/src/lib/server/trashguide/parser.ts:176`

The PR makes `trash_scores` optional (defaulting to `{}`), but existing parser tests always supply
`trash_scores`. No test verifies that omitting the field does not throw.

**Fix:** Add a unit test with a custom format entity missing `trash_scores` entirely.

### I7. No unit tests for `buildRankingFromResults`/`buildComparisonResult` with overrides

Phase 3 added `ScoreOverrideMap` params to both functions, but no unit test exercises ranking with
overrides (re-ordering, threshold flips, comparison delta recalculation).

**Fix:** Add tests for: overrides that change ranking order, overrides that flip threshold state,
`buildComparisonResult` with overrides tracking `originalScoreA`.

---

## Suggestions (10 found)

### S1. Remove `arrType` from `SimulatorUrlState`

It is fully derivable from `mediaType` via `resolveReleaseTypeForPresetCategory`. Its presence
creates a contradiction surface (e.g., `arrType: 'radarr'` with `mediaType: 'anime'`).

### S2. Remove dead types `BatchInputState` and `ComparisonState`

These are exported but never used as runtime objects. The page manages their fields as separate
`let` bindings. `showDeltas` in `ComparisonState` is unused entirely.

### S3. Remove unused `comparisonRank` field from `RankedRelease`

Declared in the type but never assigned in `buildRankingFromResults`. Dead field that misleads
consumers.

### S4. Move `SimulatorProfileOption` to `helpers.ts`

Currently defined inline in `+page.svelte`. Moving it alongside other shared types makes it
referenceable by child components and eliminates the `as Array<{...}>` type safety escape hatch.

### S5. Rename local `MediaType` alias in `urlState.ts`

Collides with the OpenAPI-generated `MediaType` from `$api/v1.d.ts` (which is `'movie' | 'series'`
without `'anime'`). Rename to `SimulatorMediaType` or inline `PresetCategory` directly.

### S6. Add `console.warn` to clipboard fallback catch blocks

**File:** `urlState.ts:204-206, 215-217`

The first catch discards clipboard API errors; the second discards `execCommand` errors. The caller
does check `success: false`, but developers debugging clipboard issues get no console output.

### S7. Server route uses fragile string matching for error classification

**File:** `+server.ts:641-647`

```typescript
if (err instanceof Error && err.message.includes('not found')) {
```

Uses `err.message.includes('not found')` to distinguish "profile not found" from other errors. An
unrelated error containing "not found" would be misclassified. Consider a specific error type or
error code.

### S8. `handleCopyLink` has no try-catch for unhandled exceptions

**File:** `+page.svelte:585-607`

If `serializeUrlState` throws (e.g., `btoa()` fails on non-Latin1 characters in batch titles), the
exception propagates as an unhandled promise rejection.

**Fix:** Wrap in try-catch that shows an alert.

### S9. Mark `ProfileScoreDelta` and `ComparisonResult` fields as `readonly`

Low-cost change that prevents accidental mutation after construction.

### S10. Create a factory for `ScoreOverrideMap` entries

Validation logic (rounding, finite check) is duplicated in `handleOverrideChange` and
`parseOverridesParam`. A single factory function would centralize this.

---

## Strengths

- **Well-structured URL state module** with clean parse/serialize symmetry and progressive
  truncation
- **Override engine is well-tested** with dedicated unit tests for `applyScoreOverrides`,
  `computeOverriddenTotal`, `resolveThresholdWithOverrides`
- **URL state round-trip tests are thorough** covering empty params, invalid types, malformed
  base64, round-trips, special characters
- **Discriminated union for `ResolvedProfile`** is textbook TypeScript -- enables clean narrowing in
  the dual-source scoring pipeline
- **Preset validation pipeline** with `parsePresetData`/`isPresetGroup`/`isPresetTitle` guards is
  rigorous and fail-fast at module load
- **Integration tests are comprehensive** covering parser-down scenarios, validation, mixed
  PCD+TRaSH scoring, anime inference, CF group fallback
- **Follows Svelte conventions** -- uses `$:` reactive declarations and `on:click` handlers (no
  runes), no `any` types
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

1. **Fix critical issues** C1 (hardcoded arrType), C2 (broken tests), C3 (silent cache poisoning)
   before merge
2. **Address important issues** I1-I7, prioritizing I1 (cache invalidation) and I3/I4 (silent
   failures)
3. **Consider suggestions** S1-S10 for follow-up cleanup
4. **Re-run tests** after fixes: `deno task test`
