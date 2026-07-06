# PR Review #202 — refactor(pcd): split display type barrel

**Reviewed**: 2026-07-06T19:26:41Z
**Mode**: PR
**Author**: yandy-r
**Branch**: refactor/pcd-display-types → main
**Decision**: APPROVE

## Summary

The display type split preserves the public `$shared/pcd/display` import surface while moving entity-family type definitions into focused modules. The ancillary type fixes are narrow and behavior-neutral, and they make the repository's required check and test gates pass.

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

None.

### LOW

None.

## Validation Results

| Check      | Result                                             |
| ---------- | -------------------------------------------------- |
| Type check | Pass (`deno task check`)                           |
| Lint       | Pass (`git diff --check`)                          |
| Tests      | Pass (`deno task test`, 1020 passed)               |
| Build      | Skipped (not required for this type-only refactor) |

## Files Reviewed

- `ROADMAP.md` (Modified)
- `packages/praxrr-app/src/lib/client/ui/table/ExpandableTable.svelte` (Modified)
- `packages/praxrr-app/src/lib/client/ui/table/Table.svelte` (Modified)
- `packages/praxrr-app/src/lib/server/sync/qualityProfiles/transformer.ts` (Modified)
- `packages/praxrr-app/src/lib/server/upgrades/processor.ts` (Modified)
- `packages/praxrr-app/src/lib/shared/pcd/display.ts` (Modified)
- `packages/praxrr-app/src/lib/shared/pcd/display/common.ts` (Added)
- `packages/praxrr-app/src/lib/shared/pcd/display/conditions.ts` (Added)
- `packages/praxrr-app/src/lib/shared/pcd/display/customFormats.ts` (Added)
- `packages/praxrr-app/src/lib/shared/pcd/display/delayProfiles.ts` (Added)
- `packages/praxrr-app/src/lib/shared/pcd/display/entityTests.ts` (Added)
- `packages/praxrr-app/src/lib/shared/pcd/display/mediaSettings.ts` (Added)
- `packages/praxrr-app/src/lib/shared/pcd/display/metadataProfiles.ts` (Added)
- `packages/praxrr-app/src/lib/shared/pcd/display/naming.ts` (Added)
- `packages/praxrr-app/src/lib/shared/pcd/display/qualityDefinitions.ts` (Added)
- `packages/praxrr-app/src/lib/shared/pcd/display/qualityProfiles.ts` (Added)
- `packages/praxrr-app/src/lib/shared/pcd/display/regex.ts` (Added)
- `packages/praxrr-app/src/lib/shared/upgrades/selectors.ts` (Modified)
- `packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte` (Modified)
- `packages/praxrr-app/src/routes/databases/[id]/changes/+page.svelte` (Modified)
- `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/scoring/+page.svelte` (Modified)
- `packages/praxrr-app/src/tests/db/trashGuideEntityCache.test.ts` (Modified)
