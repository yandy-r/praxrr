# Fix Report: pr-255-review

**Source**: `docs/prps/reviews/pr-255-review.md`
**Applied**: 2026-07-10T18:22:40+00:00
**Mode**: Parallel sub-agents (4 batches, max width 3)
**Severity threshold**: LOW

## Summary

- **Total findings in source**: 12
- **Already processed before this run**:
  - Fixed: 0
  - Failed: 0
- **Eligible this run**: 12
- **Applied this run**:
  - Fixed: 12
  - Failed: 0
- **Skipped this run**:
  - Below severity threshold: 0
  - No suggested fix: 0
  - Missing file: 0

## Fixes Applied

| ID   | Severity | File                                                                              | Line | Status | Notes                                                                               |
| ---- | -------- | --------------------------------------------------------------------------------- | ---: | ------ | ----------------------------------------------------------------------------------- |
| F001 | HIGH     | `docs/api/v1/paths/sync.yaml`                                                     |  222 | Fixed  | Runtime, OpenAPI, bundled schema, generated types, and contract test now agree      |
| F002 | HIGH     | `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`                        |  282 | Fixed  | Reviewed claims consume prior pending state and preserve later ordinary triggers    |
| F003 | HIGH     | `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`                     |  412 | Fixed  | Private target hash plus one shared client binds revalidation and writes            |
| F004 | HIGH     | `packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts`                   |  332 | Fixed  | Explicit non-applicable generation remains ready but cannot be applied              |
| F005 | MEDIUM   | `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`                     |  492 | Fixed  | Deadline is rechecked at the final pre-side-effect boundary                         |
| F006 | MEDIUM   | `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`                     |  595 | Fixed  | History changes are flattened from the revalidated preview with no second live read |
| F007 | MEDIUM   | `packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts`              |  359 | Fixed  | Empty Lidarr metadata selection becomes a typed skipped/ineligible preview          |
| F008 | MEDIUM   | `packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts`               |  628 | Fixed  | Ordinary and reviewed paths share payload-oriented CF/profile writers               |
| F009 | MEDIUM   | `packages/praxrr-app/src/lib/server/sync/preview/store.ts`                        |   44 | Fixed  | Receipt-owned release is explicit and validated by the lifecycle matrix             |
| F010 | MEDIUM   | `packages/praxrr-app/src/lib/server/sync/preview/store.ts`                        |  323 | Fixed  | Store and executor require an order-preserving reviewed subsection                  |
| F011 | LOW      | `docs/plans/sync-preview-reviewed-plan/feature-spec.md`                           |  192 | Fixed  | `changedEvidence` example is a bounded array                                        |
| F012 | LOW      | `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte` |  772 | Fixed  | Regeneration uses `onclick`; shared Button forwards callback DOM props              |

## Files Changed

- `docs/api/v1/paths/sync.yaml` (F001)
- `docs/plans/sync-preview-reviewed-plan/feature-spec.md` (F011)
- `docs/prps/reviews/pr-255-review.md` (F001-F012 status reconciliation)
- `packages/praxrr-api/openapi.json` (F001)
- `packages/praxrr-api/types.ts` (F001)
- `packages/praxrr-app/src/lib/api/v1.d.ts` (F001)
- `packages/praxrr-app/src/lib/client/ui/button/Button.svelte` (F012)
- `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts` (F002)
- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts` (F003, F005, F006, F010)
- `packages/praxrr-app/src/lib/server/sync/customFormats/syncer.ts` (F008)
- `packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts` (F007)
- `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts` (F003, F007)
- `packages/praxrr-app/src/lib/server/sync/preview/reviewBinding.ts` (F003)
- `packages/praxrr-app/src/lib/server/sync/preview/sectionSkip.ts` (F007)
- `packages/praxrr-app/src/lib/server/sync/preview/store.ts` (F004, F009, F010)
- `packages/praxrr-app/src/lib/server/sync/preview/types.ts` (F003)
- `packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts` (F008)
- `packages/praxrr-app/src/lib/server/sync/syncHistory/record.ts` (F006)
- `packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts` (F003, F004)
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte` (F012)
- Focused contract, store, route, job, metadata, quality-profile, and entity-outcome tests (F001-F010)

## Failed Fixes

None.

## Validation Results

| Check                   | Result                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| Type check              | Pass — `deno task check`; Svelte 0 errors, 0 warnings                                           |
| Tests                   | Pass — `deno task test`; 2,250 passed, 0 failed                                                 |
| Build                   | Pass — `deno task build`                                                                        |
| API generation          | Pass — generation + bundle + Prettier is deterministic across two runs                          |
| API contract            | Pass — 3 bundled/runtime contract tests                                                         |
| Changed-file formatting | Pass — Prettier and Markdownlint                                                                |
| Modified lint wrapper   | Baseline-only failure — Biome whole-file style/import conflicts and unchanged about-page TS7031 |

## Next Steps

- Re-run the formal PR review against the updated head
- Commit and push the fix set and this report
- Monitor required GitHub checks to green before squash merge
