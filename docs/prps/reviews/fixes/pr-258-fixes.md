# Fix Report: pr-258-review

**Source**: `docs/prps/reviews/pr-258-review.md`
**Applied**: 2026-07-10T20:38:00Z
**Mode**: Sequential (2 batches, max width 1)
**Severity threshold**: MEDIUM

## Summary

- **Total findings in source**: 2
- **Already processed before this run**:
  - Fixed: 0
  - Failed: 0
- **Eligible this run**: 2
- **Applied this run**:
  - Fixed: 2
  - Failed: 0
- **Skipped this run**:
  - Below severity threshold: 0
  - No suggested fix: 0
  - Missing file: 0

## Fixes Applied

| ID   | Severity | File                                                              | Line | Status | Notes                                                                                                                                               |
| ---- | -------- | ----------------------------------------------------------------- | ---- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| F001 | HIGH     | `packages/praxrr-app/src/lib/server/db/queries/canaryRollouts.ts` | 383  | Fixed  | Bound non-empty explicit section sequences during persistence, reads, generation, and promotion; preserved null/empty configured-section semantics. |
| F002 | MEDIUM   | `packages/praxrr-app/src/routes/canary/[id]/+page.svelte`         | 469  | Fixed  | Converted native gate controls to `onclick` and added a focused source-contract regression assertion.                                               |

## Files Changed

- `packages/praxrr-app/src/lib/server/db/queries/canaryRollouts.ts` (Fixed F001)
- `packages/praxrr-app/src/lib/server/sync/canary/coordinator.ts` (Fixed F001)
- `packages/praxrr-app/src/tests/db/canaryQueries.test.ts` (Fixed F001)
- `packages/praxrr-app/src/tests/sync/canaryCoordinator.test.ts` (Fixed F001)
- `packages/praxrr-app/src/routes/canary/[id]/+page.svelte` (Fixed F002)
- `packages/praxrr-app/src/tests/base/canaryPreviewEvidenceUx.test.ts` (Fixed F002)
- `docs/prps/reviews/pr-258-review.md` (Updated F001 and F002 status)

## Failed Fixes

None.

## Validation Results

| Check                     | Result                                                                   |
| ------------------------- | ------------------------------------------------------------------------ |
| Type check                | Pass — `deno task check` (0 errors, 0 warnings)                          |
| Tests                     | Pass — 2,213 passed, 0 failed                                            |
| Focused query tests       | Pass — 19 passed, 0 failed                                               |
| Focused coordinator tests | Pass — 16 passed, 0 failed                                               |
| Focused UI contract tests | Pass — 3 passed, 0 failed                                                |
| Whitespace                | Pass — repository-appropriate trailing-space and space-before-tab policy |

## Worktree Summary

| Path                                                     | Branch                             | Status |
| -------------------------------------------------------- | ---------------------------------- | ------ |
| `~/.claude-worktrees/praxrr-239-canary-preview-evidence` | `feat/239-canary-preview-evidence` | parent |

### Next steps

- Re-review PR #258 against the updated head.
- Push the fix commit and fix report to the PR branch.
- Remove the worktree after merge.
