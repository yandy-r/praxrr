# Implementation Report: Cross-Arr Parity Map (issue #14)

## Summary

Shipped a read-only **Cross-Arr Parity Map**: a standalone `/parity-map` page plus a contract-first
`GET /api/v1/compatibility/parity` endpoint rendering an entity×app tri-state support matrix (custom
formats, quality profiles, quality definitions, delay profiles, metadata profiles × Radarr/Sonarr/
Lidarr), a curated per-`arr_type` semantic-differences catalog, and live per-profile compatibility
computed from the linked PCD. Support facts are **derived** from `$shared/arr/capabilities.ts` (no
duplicate boolean map); the compatibility algorithm was **extracted once** from
`qualityProfiles/list.ts` into `compatibility.ts` and reused by both the endpoint and the list path.

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual                           |
| ------------- | ---------------- | -------------------------------- |
| Complexity    | XL               | XL                               |
| Confidence    | 9/10             | Confirmed — no design deviations |
| Files Changed | 22               | 23 (15 created, 8 modified)      |

## Tasks Completed

All 22 tasks across 7 dependency batches (B1–B7) completed via parallel `ycc:implementor` sub-agents,
with type-check + targeted tests between every batch. No batch failed validation.

| Batch | Tasks                                                                                        | Status                     |
| ----- | -------------------------------------------------------------------------------------------- | -------------------------- |
| B1    | parity.ts, compatibility.ts, iconMap, registry, test alias                                   | ✅ Complete                |
| B2    | semanticDifferences.ts, list.ts delegation, parityRows, CompatibilityBadges, +page.server.ts | ✅ Complete                |
| B3    | OpenAPI path + schema, ParityMatrix, SemanticDifferences, 2 test files                       | ✅ Complete                |
| B4    | openapi.yaml registration, +page.svelte                                                      | ✅ Complete                |
| B5    | v1.d.ts regen (scrubbed), JSR mirror regen                                                   | ✅ Complete (orchestrator) |
| B6    | parity endpoint +server.ts                                                                   | ✅ Complete                |
| B7    | endpoint contract test                                                                       | ✅ Complete                |

## Validation Results

| Level           | Status  | Notes                                                                                                                                   |
| --------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Static Analysis | ✅ Pass | `deno task check` (server `deno check` + client `svelte-check`) — 0 errors                                                              |
| Unit Tests      | ✅ Pass | 17 new tests: parityMap 7, qualityProfileCompatibility 6, parityMapApi 4; `filters` regression 67/67                                    |
| Build           | ✅ Pass | `deno task build` — Vite build + Deno compile succeeded                                                                                 |
| Integration     | ✅ Pass | App boots to "Server ready" with the new nav entry + route; endpoint exercised by contract test (200 static / 200 profiles / 400 / 401) |
| Edge Cases      | ✅ Pass | invalid/unknown/'all'/unbuilt databaseId → 400; transitional Lidarr rows excluded; zero-enabled fallback                                |

## Files Changed

15 created, 8 modified — +2190 / −100 lines (excludes internal design/plan docs).

| Area           | Files                                                                                                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared modules | `parity.ts` (+89), `semanticDifferences.ts` (+129)                                                                                                                                  |
| Server (PCD)   | `qualityProfiles/compatibility.ts` (+162, extracted), `list.ts` (−102, now delegates)                                                                                               |
| API contract   | `docs/api/v1/paths/compatibility.yaml` (+45), `schemas/compatibility.yaml` (+144), `openapi.yaml` (+11), `v1.d.ts` (+135 scrubbed), `praxrr-api/{openapi.json +256, types.ts +135}` |
| Endpoint       | `routes/api/v1/compatibility/parity/+server.ts` (+81)                                                                                                                               |
| UI             | `parity-map/{+page.svelte +105, +page.server.ts +63, ParityMatrix.svelte +80, SemanticDifferences.svelte +85, parityRows.ts +42}`, `ui/parity/CompatibilityBadges.svelte` (+20)     |
| Nav            | `navigation/iconMap.ts` (+2), `navigation/registry.ts` (+12)                                                                                                                        |
| Tests          | `tests/arr/parityMap.test.ts` (+137), `tests/pcd/qualityProfileCompatibility.test.ts` (+257), `tests/routes/parityMapApi.test.ts` (+197)                                            |
| Misc           | `scripts/test.ts` (+1, `parity` alias)                                                                                                                                              |

## Deviations from Plan

- **B5 (v1.d.ts / JSR mirror) done by the orchestrator, not a sub-agent.** These regen tasks required careful scrubbing of openapi-typescript's ~3300-line version churn down to a reviewable +135 diff (grafting only the new types in the committed file's style), and grafting only the compat delta into `praxrr-api/openapi.json` to avoid a pre-existing ~887-line mirror drift on `main`. Documented as an intentional deviation.
- **Title-cased the `Compatibility` OpenAPI tag** to match the existing spec convention (`System`, `Arr`, `PCD`).
- **Research backstop files removed** from the change set — internal planning scaffolding whose content is synthesized into the plan; several failed markdownlint (MD038, code-span whitespace).

## Issues Encountered

- **Pre-existing type error** in `media-management/.../media-settings/lidarr/[name]/+page.server.ts` surfaces when `deno test` type-checks the whole `tests/arr/` directory (route files are excluded from `deno task check`). Confirmed present on `main`, untouched by this work — not a regression. New parity tests are run per-file and are unaffected.
- **Pre-existing JSR mirror drift**: `packages/praxrr-api/openapi.json` on `main` is already out of sync with its own spec (~887 lines). This PR grafts only the compat delta to keep the diff focused.

## Tests Written

| Test File                                       | Tests | Coverage                                                                                                                                        |
| ----------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/arr/parityMap.test.ts`                   | 7     | Tri-state truth table, bridge totality, axis↔capabilities consistency, quality_definitions↔subsection pin, catalog invariants, parityRows shape |
| `tests/pcd/qualityProfileCompatibility.test.ts` | 6     | Video→[radarr,sonarr], audio→[lidarr], zero-enabled fallback, transitional-row exclusion, **list.ts delegation-equivalence**                    |
| `tests/routes/parityMapApi.test.ts`             | 4     | Static (no profiles), DB tier (profiles), 400 fail-fast, 401 unauth                                                                             |

## Cross-Arr Semantic Validation Compliance

- [x] API semantics verified per Arr app — matrix cells resolve per explicit `arr_type` via `supportsArrSyncSurface`.
- [x] Schema/field mappings validated per app — compatibility uses the QUALITIES-filtered reader (`api_name ∈ QUALITIES[arrType]`).
- [x] Dispatch resolves by explicit `arr_type` — endpoint fails fast (400) on invalid/unknown/'all' id; no sibling fallback.
- [x] Migration/import mappings fail-fast — `PARITY_ENTITY_TO_SYNC_SURFACE` is a total `Record` (compile-time fail on unmapped entity).

## Next Steps

- [x] Code review via `/ycc:code-review`
- [x] PR via `/ycc:prp-pr`
