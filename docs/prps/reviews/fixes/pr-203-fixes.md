# Fix Report: pr-203-review

**Source**: docs/prps/reviews/pr-203-review.md
**Applied**: 2026-07-07T00:25:00Z
**Mode**: Parallel sub-agents (3 batches, max width 5)
**Severity threshold**: LOW

## Summary

- **Total findings in source**: 21
- **Already processed before this run**:
  - Fixed: 0
  - Failed: 0
- **Eligible this run**: 21
- **Applied this run**:
  - Fixed: 21
  - Failed: 0
- **Skipped this run**:
  - Below severity threshold: 0
  - No suggested fix: 0
  - Missing file: 0

## Fixes Applied

| ID   | Severity | File | Line | Status | Notes |
| ---- | -------- | ---- | ---- | ------ | ----- |
| F001 | HIGH | GeneralForm.svelte | 40 | Fixed | Wired `initialMode` from server-loaded `customFormatSectionModes` |
| F002 | HIGH | 2.51-progressive-complexity.spec.ts | 59 | Fixed | E2E navigates to edit general route with tier/disclosure reset |
| F003 | HIGH | feature-spec.md | 1 | Fixed | Prettier-formatted three failing docs files |
| F004 | HIGH | complexity-tiers/+server.ts | 75 | Fixed | Replaced `console.error` with `$logger` |
| F005 | HIGH | userComplexityTiers.ts | 1 | Fixed | Extracted `sectionDebouncedSync.ts` shared primitive |
| F006 | MEDIUM | DisclosureSection.svelte | 50 | Fixed | Added error handling for `recordActivity` with alert warnings |
| F007 | MEDIUM | complexityTiersApi.test.ts | 1 | Fixed | Added optimistic-lock edge-case tests |
| F008 | MEDIUM | DisclosureSection.svelte | 1 | Fixed | Added precedence unit tests via `disclosureSectionLogic.ts` |
| F009 | MEDIUM | complexity-tiers/+server.ts | 262 | Fixed | Rate-limit map pruning on each check |
| F010 | MEDIUM | complexity-tiers/+server.ts | 45 | Fixed | Documented single-instance rate-limit assumption |
| F011 | MEDIUM | userComplexityTiers.ts | 1 | Fixed | Reduced file from 547 to 275 lines (F005 extraction) |
| F012 | MEDIUM | complexity-tiers/+server.ts | 400 | Fixed | Moved concurrent upsert to query module |
| F013 | MEDIUM | complexity-tiers/+server.ts | 246 | Fixed | Extracted shared `section-preferences/_helpers.ts` |
| F014 | MEDIUM | ComplexityTierSelector.svelte | 1 | Fixed | Normalized imports and indentation |
| F015 | LOW | +page.server.ts | 49 | Fixed | Verified wiring complete via F001 (no edits needed) |
| F016 | LOW | loadSectionTiers.ts | 30 | Fixed | Replaced `console.warn` with `$logger` |
| F017 | LOW | loadSectionTiers.ts | 23 | Fixed | Batched via `getByUserId`; test mocks updated |
| F018 | LOW | complexity-tiers/+server.ts | 341 | Fixed | Capped per-request counter deltas to ±100 |
| F019 | LOW | complexity-tiers/+server.ts | 52 | Fixed | GET short-circuit for synthetic user id 0 |
| F020 | LOW | 20260706_create_user_complexity_tiers.ts | 15 | Fixed | Added `interaction_count <= 1000000` CHECK |
| F021 | LOW | ComplexityTierSelector.svelte | 29 | Fixed | Documented server-only reset semantics |

## Files Changed

- `packages/praxrr-app/src/routes/custom-formats/[databaseId]/components/GeneralForm.svelte` (F001)
- `packages/praxrr-app/src/lib/server/disclosure/loadSectionModes.ts` (F001 supporting)
- `packages/praxrr-app/src/tests/disclosure/loadSectionModes.test.ts` (F001 supporting)
- `packages/praxrr-app/src/tests/e2e/specs/2.51-progressive-complexity.spec.ts` (F002)
- `docs/plans/pcd-state-snapshot/feature-spec.md` (F003)
- `packages/praxrr-app/src/routes/api/v1/complexity-tiers/+server.ts` (F004, F009–F013, F018, F019)
- `packages/praxrr-app/src/routes/api/v1/section-preferences/_helpers.ts` (F009, F010, F013 — new)
- `packages/praxrr-app/src/routes/api/v1/ui-preferences/+server.ts` (F013 supporting)
- `packages/praxrr-app/src/lib/server/db/queries/user_complexity_tiers.ts` (F012)
- `packages/praxrr-app/src/lib/client/stores/sectionDebouncedSync.ts` (F005, F011 — new)
- `packages/praxrr-app/src/lib/client/stores/userComplexityTiers.ts` (F005, F011)
- `packages/praxrr-app/src/lib/client/ui/form/DisclosureSection.svelte` (F006, F008)
- `packages/praxrr-app/src/lib/client/ui/form/disclosureSectionLogic.ts` (F008 — new)
- `packages/praxrr-app/src/tests/disclosure/disclosureSectionPrecedence.test.ts` (F008 — new)
- `packages/praxrr-app/src/tests/routes/complexityTiersApi.test.ts` (F007)
- `packages/praxrr-app/src/lib/client/ui/complexity/ComplexityTierSelector.svelte` (F014, F021)
- `packages/praxrr-app/src/lib/server/complexity/loadSectionTiers.ts` (F016, F017)
- `packages/praxrr-app/src/tests/complexity/loadSectionTiers.test.ts` (F017 test update)
- `packages/praxrr-app/src/lib/server/db/migrations/20260706_create_user_complexity_tiers.ts` (F020)

## Failed Fixes

(none)

## Validation Results

| Check      | Result |
| ---------- | ------ |
| Type check | Pass   |
| Tests      | Fail   |
| Complexity tests | Pass (18/18) |

**Test failure detail**: Full `deno task test` reports 3 failures — `arrExternalUrlLayoutPropagation`, `lidarrOnboarding` ×2 — due to missing `ARR_CREDENTIAL_MASTER_KEY` env. These are pre-existing and unrelated to PR #203 (documented in source review). Complexity-scoped tests pass 18/18.

## Next Steps

- Re-run `/code-review 203` to verify fixes resolved the issues
- Set `ARR_CREDENTIAL_MASTER_KEY` in CI/dev env to clear unrelated test failures
- Run `/git-workflow --commit` to commit the fixes when satisfied
