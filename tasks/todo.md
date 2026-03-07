# Score Simulator Media Type Alignment

## Plan

- [x] Update score-simulator route/component UI state so batch mode exposes
      movie, series, and anime contexts visibly, while keeping API request types
      mapped to supported release types.
- [x] Rename the single-release selector label to `Media Type` and align related
      simulator wording where needed.
- [x] Extend simulator URL-state handling and targeted tests to preserve `anime`
      for single and batch deep links.
- [x] Verify with focused automated coverage and document results below.

## Review

- Implemented a single visible media-context model (`movie`, `series`, `anime`)
  for the score simulator UI and examples flow, while preserving the existing
  backend contract by mapping `anime` requests to Sonarr/`series`.
- Batch mode now renders the same three visible context buttons as the
  single-release card and keeps that context in share-link URL state.
- Updated single-release wording to `Media Type` and aligned the preset dropdown
  copy to the same terminology.
- Verification:
  - `deno task check:client` ✅
  - `deno task test packages/praxrr-app/src/tests/routes/scoreSimulatorUrlState.test.ts`
    ✅
  - `deno test -A packages/praxrr-app/src/tests/routes/scoreSimulatorPhase2Helpers.test.ts --filter 'anime context'`
    ✅
  - `deno task test packages/praxrr-app/src/tests/routes/scoreSimulatorPhase2Helpers.test.ts`
    ⚠️ still has pre-existing `buildRankingFromResults` failures unrelated to
    this media-type change.

---

# PR #190 Issues I5-I7 Validation And Fixes

## Plan

- [x] Validate I5 against current `urlState.ts` behavior and targeted URL-state
      tests before changing parse behavior.
- [x] Validate I6 against current TRaSH parser coverage and add a focused
      missing-`trash_scores` test if the gap still exists.
- [x] Validate I7 against current helper behavior and add focused override-path
      tests for ranking and comparison helpers.
- [x] Implement the minimal confirmed fixes for I5 and any helper/test updates
      required by I6-I7.
- [x] Run targeted automated verification, update
      `docs/pr-reviews/pr-190-review.md`, and record the outcome below.
- [x] Commit verified progress once the fixes are confirmed.

## Review

- Validated before implementing:
  - I5 was still open: `parseBatchParam` and `parseOverridesParam` used silent
    `catch {}` paths and dropped malformed share-link payloads without any
    debugging signal.
  - I6 was still open as a coverage gap: parser runtime already accepted missing
    `trash_scores`, but no parser test omitted the field.
  - I7 was still open as a coverage gap: helper runtime paths already supported
    overrides, but no ranking/comparison tests exercised those integration
    paths.
- Implemented:
  - Added targeted `console.warn` logging for malformed `batch` and `overrides`
    URL params while preserving current fallback behavior.
  - Added parser coverage for custom formats that omit `trash_scores`.
  - Added override-path helper coverage for ranking re-ordering, threshold
    flips, and comparison recalculation with `originalScoreA`.
- Verification:
  - `deno test -A packages/praxrr-app/src/tests/routes/scoreSimulatorUrlState.test.ts`
    ✅
  - `deno test -A packages/praxrr-app/src/tests/trashguide/parser.test.ts` ✅
  - `deno test -A packages/praxrr-app/src/tests/routes/scoreSimulatorPhase3Helpers.test.ts`
    ✅

---

# PR #190 Suggestions S1-S5 Validation And Fixes

## Plan

- [x] Validate suggestions S1-S5 against the current score-simulator code and
      confirm which ones are still actionable.
- [x] Implement only the confirmed fixes with minimal code movement and no
      behavioral regressions.
- [x] Update or add targeted tests for URL state, helper types, and page
      consumers affected by the confirmed fixes.
- [x] Run focused verification for the touched score-simulator tests and type
      checks as needed.
- [x] Update `docs/pr-reviews/pr-190-review.md` with final status and record the
      outcome below.
- [x] Commit verified progress once the fixes are confirmed.

## Review

- Validated before implementing:
  - S1 was still valid: `SimulatorUrlState` still exposed/serialized `arrType`
    even though it is derivable from `mediaType`, and the page still wrote the
    redundant field into new share links.
  - S2 and S3 were still valid: `BatchInputState`, `ComparisonState`, and
    `RankedRelease.comparisonRank` were dead exported type surface with no live
    references.
  - S4 was still valid: the quality-profile option shape was duplicated between
    the page and child components, and the page still relied on an `as
    Array<{...}>` cast.
  - S5 was still valid: `urlState.ts` used a local `MediaType` alias that
    actually meant `PresetCategory`, which is broader than the OpenAPI
    `MediaType`.
- Implemented:
  - Removed `arrType` from the public simulator URL-state interface and new
    share-link serialization while preserving legacy `arrType` link support by
    deriving `mediaType` during parse.
  - Deleted the dead helper types and the unused `comparisonRank` field.
  - Moved `SimulatorProfileOption` into `helpers.ts` and reused it across the
    page plus profile-related child components, removing the page-level cast.
  - Replaced the misleading local `MediaType` alias in `urlState.ts` with
    direct `PresetCategory` typing.
- Verification:
  - `deno task check:client` ✅
  - `deno test -A src/tests/routes/scoreSimulatorUrlState.test.ts` ✅
  - `deno test -A src/tests/routes/scoreSimulatorPhase2Helpers.test.ts` ✅
  - `deno test -A src/tests/routes/scoreSimulatorPhase3Helpers.test.ts` ✅

---

# PR #190 Suggestions S6-S10 Validation And Fixes

## Plan

- [x] Validate suggestions S6-S10 against current score-simulator client/server behavior and existing targeted tests before implementing anything.
- [x] Implement only the confirmed fixes, keeping clipboard handling, override normalization, and route error classification minimal and explicit.
- [x] Add or update focused tests for clipboard warnings/failures, override normalization, readonly helper types, and route not-found classification as needed.
- [x] Run targeted verification for the touched score-simulator and simulate-score route coverage.
- [x] Update `docs/pr-reviews/pr-190-review.md` with final S6-S10 status and record the outcome below.
- [ ] Commit verified progress once the fixes are confirmed.

## Review

- Validated before implementing:
  - S6 was still valid: clipboard API and `execCommand` fallback failures were
    still swallowed without any debugging signal.
  - S7 was still valid: the simulate-score route still classified missing PCD
    profiles via `err.message.includes('not found')`, which could misclassify
    unrelated failures.
  - S8 was still worth fixing: the earlier `btoa()` example was stale after the
    UTF-8 share-link update, but `handleCopyLink` still allowed unexpected
    copy-path exceptions to surface as unhandled rejections.
  - S9 was still valid as low-risk type hardening: `ProfileScoreDelta` and
    `ComparisonResult` fields were mutable after construction.
  - S10 was still valid: override rounding/finite validation was duplicated
    between the page handler and URL-state normalization paths.
- Implemented:
  - Added clipboard fallback warning logs in `urlState.ts` for
    `navigator.clipboard.writeText` and `document.execCommand` failures.
  - Replaced fragile string matching with a dedicated
    `QualityProfileScoringNotFoundError` for PCD score loading.
  - Wrapped `handleCopyLink` in try-catch so unexpected share-link failures show
    an alert instead of becoming unhandled promise rejections.
  - Marked `ProfileScoreDelta` and `ComparisonResult` fields as `readonly`.
  - Added `createScoreOverrideEntry()` and reused it for page overrides plus
    URL-state parse/serialize normalization.
- Verification:
  - `deno test -A packages/praxrr-app/src/tests/routes/scoreSimulatorUrlState.test.ts`
    ✅
  - `deno test -A packages/praxrr-app/src/tests/routes/scoreSimulatorPhase3Helpers.test.ts`
    ✅
  - `deno test -A packages/praxrr-app/src/tests/routes/simulateScoreRoute.test.ts`
    ✅
  - `deno task check:client` ✅
