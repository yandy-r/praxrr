# Fix Report: pr-206-review

**Source**: docs/prps/reviews/pr-206-review.md
**Applied**: 2026-07-07
**Mode**: Orchestrator-coherent (findings overlapped on shared files — parallel per-file fixers would conflict)
**Severity threshold**: LOW

## Summary

- **Total findings in source**: 14
- **Already processed before this run**: Fixed 0 / Failed 0
- **Eligible this run**: 14
- **Applied this run**: Fixed 13 / Failed 0
- **Deferred this run**: 1 (F013 — optional, left Open)

## Fixes Applied

| ID   | Severity | File                                                  | Status | Notes                                                                                                                                                                                             |
| ---- | -------- | ----------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F001 | HIGH     | packages/praxrr-api/openapi.json                      | Fixed  | Corrected the 3 new `/compatibility/parity` error-response refs to `#/components/schemas/ErrorResponse` (left the 3 pre-existing bundler-bug refs on other paths untouched to keep scope focused) |
| F002 | MEDIUM   | qualityProfiles/compatibility.ts + list.ts            | Fixed  | Added optional `knownProfileNames` param; `computeProfileCompatibility` + `list` now pass their already-fetched names — no redundant `quality_profiles` query                                     |
| F003 | MEDIUM   | routes/parity-map/+page.server.ts                     | Fixed  | Wrapped `computeProfileCompatibility` in try/catch with `logger.error` + controlled `error` return (symmetric with the endpoint)                                                                  |
| F004 | MEDIUM   | docs/api/v1/schemas/compatibility.yaml (+ generated)  | Fixed  | Added the 10-literal `enum` to `ArrSemanticDifference.scope`; hand-propagated to `v1.d.ts` + JSR mirror (`types.ts`, `openapi.json`) to avoid a full regen churn                                  |
| F005 | MEDIUM   | lib/shared/arr/parityRows.ts (moved)                  | Fixed  | Moved `parityRows.ts` from the UI route to `$shared/arr/`; updated all 3 importers (endpoint, ParityMatrix, test) to the `$shared/arr/` alias                                                     |
| F006 | MEDIUM   | lib/shared/arr/parity.ts + SemanticDifferences.svelte | Fixed  | Exported single `PARITY_ENTITY_LABELS` from `parity.ts`; `parityRows.ts` + `SemanticDifferences.svelte` reuse it (labels no longer duplicated)                                                    |
| F007 | MEDIUM   | scripts/test.ts                                       | Fixed  | `parity` alias now lists all 3 parity test files (comma-separated, matching `complexity`/`setup-wizard`)                                                                                          |
| F008 | LOW      | routes/api/v1/compatibility/parity/+server.ts         | Fixed  | `if (!locals.user && !locals.authBypass)` — reachable under `AUTH=off`/local-bypass                                                                                                               |
| F009 | LOW      | +server.ts + +page.server.ts                          | Fixed  | Strict `/^\d+$/` databaseId validation before `parseInt` in both entry points                                                                                                                     |
| F010 | LOW      | routes/parity-map/ParityMatrix.svelte                 | Fixed  | Replaced the unchecked `as ArrAppType` cast with an `isAppKey` type guard                                                                                                                         |
| F011 | LOW      | parityRows.ts + +server.ts                            | Fixed  | Import `ARR_APP_TYPES`/`ArrAppType` from `$shared/arr/capabilities.ts` (feature-consistent)                                                                                                       |
| F012 | LOW      | routes/parity-map/ParityMatrix.svelte                 | Fixed  | Reformatted to tabs to match the sibling `$ui`/route `.svelte` convention                                                                                                                         |
| F013 | LOW      | qualityProfiles/compatibility.ts                      | Open   | **Deferred** — decomposing the verbatim-extracted 110-line algorithm risks the delegation-equivalence guarantee for a style nitpick; recorded as an optional follow-up                            |
| F014 | LOW      | tests/pcd/qualityProfileCompatibility.test.ts         | Fixed  | Strengthened the delegation test with independently-hardcoded expected sets per arr type + renamed                                                                                                |

## Files Changed

- `packages/praxrr-api/openapi.json` (F001, F004), `packages/praxrr-api/types.ts` (F004), `packages/praxrr-app/src/lib/api/v1.d.ts` (F004)
- `packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/compatibility.ts` (F002), `list.ts` (F002)
- `packages/praxrr-app/src/routes/parity-map/+page.server.ts` (F003, F009)
- `docs/api/v1/schemas/compatibility.yaml` (F004)
- `packages/praxrr-app/src/lib/shared/arr/parityRows.ts` (moved — F005, F006, F011), `parity.ts` (F006)
- `packages/praxrr-app/src/routes/parity-map/ParityMatrix.svelte` (F005, F010, F012), `SemanticDifferences.svelte` (F006)
- `packages/praxrr-app/src/routes/api/v1/compatibility/parity/+server.ts` (F005, F008, F009, F011)
- `scripts/test.ts` (F007)
- `packages/praxrr-app/src/tests/arr/parityMap.test.ts` (F005), `tests/pcd/qualityProfileCompatibility.test.ts` (F014)

## Failed Fixes

None.

## Validation Results

| Check      | Result                                                               |
| ---------- | -------------------------------------------------------------------- |
| Type check | Pass (`deno task check` — 0 errors)                                  |
| Tests      | Pass (`deno task test parity` — 17/17; `filters` regression — 67/67) |

## Next Steps

- F013 remains an optional follow-up (decompose the extracted compatibility function without behavior change).
- Fixes committed and pushed to the PR branch; CI re-runs on push.
