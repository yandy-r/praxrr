# Fix Report: pr-260-review

**Source**: `docs/prps/reviews/pr-260-review.md`
**Applied**: 2026-07-11T05:12:01Z
**Mode**: Sequential (2 severity batches, max width 2)
**Severity threshold**: MEDIUM

## Summary

- **Total findings in source**: 3
- **Already processed before this run**:
  - Fixed: 0
  - Failed: 0
- **Eligible this run**: 3
- **Applied this run**:
  - Fixed: 3
  - Failed: 0
- **Skipped this run**:
  - Below severity threshold: 0
  - No suggested fix: 0
  - Missing file: 0

## Fixes Applied

| ID   | Severity | File                                                    | Line | Status | Notes                                                                                                                                        |
| ---- | -------- | ------------------------------------------------------- | ---: | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| F001 | HIGH     | `packages/praxrr-app/src/lib/server/utils/git/write.ts` |  174 | Fixed  | Preserves the target clone's checked-out branch and adds a non-default-branch refresh regression test.                                       |
| F002 | MEDIUM   | `packages/praxrr-app/src/tests/e2e/helpers/entity.ts`   |    1 | Fixed  | Formatted with the repository Prettier configuration.                                                                                        |
| F003 | MEDIUM   | `packages/praxrr-parser/testdata/golden/manifest.json`  |    1 | Fixed  | Canonical manifest is Prettier-clean; the capture writer now uses valid standalone plugins and preserves canonical expanded JSON formatting. |

## Files Changed

- `packages/praxrr-app/src/lib/server/utils/git/write.ts` (Fixed F001)
- `packages/praxrr-app/src/tests/pcd/localPathGitClone.test.ts` (Regression coverage for F001)
- `packages/praxrr-app/src/tests/e2e/helpers/entity.ts` (Fixed F002)
- `packages/praxrr-parser/testdata/golden/manifest.json` (Fixed F003)
- `scripts/capture-parser-goldens.ts` (Prevents F003 from recurring)
- `docs/prps/reviews/pr-260-review.md` (Statuses updated in place)

## Failed Fixes

None.

## Validation Results

| Check                   | Result                                                |
| ----------------------- | ----------------------------------------------------- |
| Type check              | Pass — `deno task check` (0 errors, 0 warnings)       |
| Tests                   | Pass — `deno task test` (2,354 passed, 0 failed)      |
| Parser compatibility    | Pass — `scripts/check-parser-go.sh`                   |
| Focused local Git tests | Pass — 8 passed, including non-default branch refresh |
| Scoped formatting       | Pass — all five changed implementation/fixture files  |
| Manifest semantics      | Pass — parsed manifest content unchanged              |

## Next Steps

- Commit and push the fixed findings and this report.
- Re-review PR #260 at the new head revision.
- Monitor all required checks to green before squash merge.
