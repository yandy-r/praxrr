# PR Review #247 — feat(config-health): add trend analysis and export

**Reviewed**: 2026-07-10T04:06:50Z
**Mode**: PR
**Author**: yandy-r
**Branch**: feat/config-health-trends-export → main
**Decision**: REQUEST CHANGES

## Summary

The contract-first design, explicit evidence states, export parity, and focused validation are strong. The review found five high-severity correctness, security, and rendering-bound issues that should be fixed before merge, plus maintainability and contract-fidelity improvements.

## Findings

### CRITICAL

None.

### HIGH

- **[F001]** `packages/praxrr-app/src/lib/server/health/trends.ts:321` — The query is scoped only by instance ID, so snapshots persisted before an instance changes Arr type can be projected under its new type instead of failing closed. [correctness]
  - **Status**: Open
  - **Category**: Correctness
  - **Suggested fix**: Enforce `snapshot.arrType === instance.type` in SQL or before projection, fail closed on mismatch, and add a type-change regression test.

- **[F002]** `packages/praxrr-app/src/lib/server/utils/export/csv.ts:10` — Formula neutralization omits leading LF and documented locale/full-width formula initiators, leaving hostile persisted text outside the shared spreadsheet-safety policy. [security]
  - **Status**: Open
  - **Category**: Security
  - **Suggested fix**: Extend the shared prefix policy to LF and documented full-width initiators and add regression cases for all three export consumers.

- **[F003]** `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.svelte:263` — Parameter-only `goto` navigation can reuse the page component without remounting, leaving the previous instance's detail/trend visible and pairing old normalized filters with the new instance export path. [correctness]
  - **Status**: Open
  - **Category**: Correctness
  - **Suggested fix**: React to `data.instanceId` changes by aborting/invalidation, clearing instance-owned state, resetting filters, and loading both resources; add an instance-switch E2E test.

- **[F004]** `packages/praxrr-app/src/routes/config-health/[instanceId]/components/HealthTrendChart.svelte:363` — Current-engine threshold bands are presented alongside persisted historical bands without identifying the policy mismatch, so older engine evidence can appear to contradict its stored band. [correctness]
  - **Status**: Open
  - **Category**: Correctness
  - **Suggested fix**: Encode persisted point bands directly and label current thresholds strictly as a current-policy reference, with a cross-engine score/band mismatch test.

- **[F005]** `packages/praxrr-app/src/routes/config-health/[instanceId]/components/HealthTrendTable.svelte:174` — A valid 10,000-point response eagerly mounts every row and nested criterion detail, producing tens of thousands of DOM nodes and risking a frozen browser. [security]
  - **Status**: Open
  - **Category**: Performance
  - **Suggested fix**: Add accessible client-side pagination or virtualization while preserving the exact total and complete export dataset.

### MEDIUM

- **[F006]** `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts:241` — The row-count sentinel does not bound parsed JSON work or aggregate bytes; `SELECT *` materializes and parses both unrestricted blobs before overflow rejection. [security]
  - **Status**: Open
  - **Category**: Performance
  - **Suggested fix**: Select only trend-required fields, enforce documented per-row/nested and aggregate evidence budgets with atomic 422 behavior, and cover oversized stored evidence.

- **[F007]** `packages/praxrr-app/src/lib/server/health/responses.ts:94` — The trend response is hand-declared alongside generated OpenAPI types, and E2E fixtures declare another shadow contract, increasing drift risk despite contract-first rules. [quality]
  - **Status**: Open
  - **Category**: Pattern Compliance
  - **Suggested fix**: Derive response/subtypes from `components['schemas']['ConfigHealthTrendsResponse']` and type fixtures with generated aliases plus `satisfies`.

- **[F008]** `packages/praxrr-app/src/lib/server/health/trends.ts:140` — Persisted numeric validation accepts fractional/out-of-range scores and negative/fractional weights that violate the OpenAPI portable schema but are emitted as measured evidence. [quality]
  - **Status**: Open
  - **Category**: Pattern Compliance
  - **Suggested fix**: Add field-specific integer/range guards matching OpenAPI and map malformed-but-parseable evidence to `not-recorded`, with tests.

- **[F009]** `packages/praxrr-app/src/lib/server/health/trends.ts:303` — Profile options come only from the selected time window, so historical exact names disappear when the current range has no matching snapshot. [correctness]
  - **Status**: Open
  - **Category**: Completeness
  - **Suggested fix**: Load a deterministic, bounded union of retained profile names independently from the point range and test option stability across filters.

- **[F010]** `packages/praxrr-app/src/lib/server/health/trends.ts:317` — The service validates supported type but not enabled state, allowing disabled instances through direct JSON/export access despite the active-instance contract. [correctness]
  - **Status**: Open
  - **Category**: Completeness
  - **Suggested fix**: Carry `enabled` through the service dependency, reject disabled instances consistently, and add per-Arr route tests.

- **[F011]** `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.svelte:444` — The new filter integration retains legacy `on:apply`/`createEventDispatcher` instead of the repository's Svelte 5 callback-property convention. [quality]
  - **Status**: Open
  - **Category**: Pattern Compliance
  - **Suggested fix**: Expose a typed callback prop from `TrendFilters.svelte`, invoke it directly, and bind it with event-property syntax.

- **[F012]** `packages/praxrr-app/src/routes/config-health/[instanceId]/components/HealthTrendChart.svelte:1` — The 775-line component duplicates axes, boundaries, segments, gaps, ticks, and selection markup across overall and criterion plots. [quality]
  - **Status**: Open
  - **Category**: Maintainability
  - **Suggested fix**: Extract a route-local reusable plot/model while keeping scope-specific captions, thresholds, and series definitions in the parent.

- **[F013]** `packages/praxrr-app/src/routes/config-health/[instanceId]/components/HealthTrendChart.svelte:308` — Horizontally scrollable chart containers are not focusable named regions, so keyboard users cannot reach and scroll them at narrow widths. [quality]
  - **Status**: Open
  - **Category**: Pattern Compliance
  - **Suggested fix**: Mirror the table scroller's focusable named-region treatment with visible focus styling, or remove horizontal scrolling.

- **[F014]** `packages/praxrr-app/src/routes/config-health/[instanceId]/components/HealthTrendChart.svelte:453` — Gap glyphs and engine-boundary labels remain unbounded even though measured markers are sampled, allowing thousands of SVG nodes per plot for a maximum-size sparse series. [security]
  - **Status**: Open
  - **Category**: Performance
  - **Suggested fix**: Bound or aggregate gap and boundary indicators while retaining exact counts/details in the inspector and paginated table; add maximum-size rendering coverage.

### LOW

- **[F015]** `packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/trends/export/+server.ts:14` — Positive instance-ID parsing is duplicated across Config Health boundaries and has diverged from the page's lexical digits-only policy. [quality]
  - **Status**: Open
  - **Category**: Maintainability
  - **Suggested fix**: Centralize one positive safe-integer path parser and reuse it across Config Health routes and the page loader.

## Validation Results

| Check      | Result                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------- |
| Type check | Pass — `deno task check` (0 client errors/warnings)                                             |
| Lint       | Pass for every changed TS/Svelte file; global Prettier gate has 43 pre-existing unrelated files |
| Tests      | Pass — `deno task test config-health` (178 passed)                                              |
| E2E        | Pass — focused Config Health trends spec (9 passed)                                             |
| Build      | Pass — Vite production build and Deno compile                                                   |

## Files Reviewed

- `ROADMAP.md` (Modified)
- `docs/api/v1/openapi.yaml` (Modified)
- `docs/api/v1/paths/config-health.yaml` (Modified)
- `docs/api/v1/schemas/config-health.yaml` (Modified)
- `docs/plans/config-health-trends-export/analysis-architecture.md` (Added)
- `docs/plans/config-health-trends-export/analysis-docs.md` (Added)
- `docs/plans/config-health-trends-export/analysis-integration.md` (Added)
- `docs/plans/config-health-trends-export/analysis-patterns.md` (Added)
- `docs/plans/config-health-trends-export/analysis-tasks.md` (Added)
- `docs/plans/config-health-trends-export/feature-spec.md` (Added)
- `docs/plans/config-health-trends-export/parallel-plan.md` (Added)
- `docs/plans/config-health-trends-export/research-business.md` (Added)
- `docs/plans/config-health-trends-export/research-external.md` (Added)
- `docs/plans/config-health-trends-export/research-practices.md` (Added)
- `docs/plans/config-health-trends-export/research-recommendations.md` (Added)
- `docs/plans/config-health-trends-export/research-security.md` (Added)
- `docs/plans/config-health-trends-export/research-technical.md` (Added)
- `docs/plans/config-health-trends-export/research-ux.md` (Added)
- `docs/plans/config-health-trends-export/shared.md` (Added)
- `packages/praxrr-api/openapi.json` (Modified)
- `packages/praxrr-api/types.ts` (Modified)
- `packages/praxrr-app/src/lib/api/v1.d.ts` (Modified)
- `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts` (Modified)
- `packages/praxrr-app/src/lib/server/health/responses.ts` (Modified)
- `packages/praxrr-app/src/lib/server/health/trendCsv.ts` (Added)
- `packages/praxrr-app/src/lib/server/health/trendFilters.ts` (Added)
- `packages/praxrr-app/src/lib/server/health/trends.ts` (Added)
- `packages/praxrr-app/src/lib/server/utils/export/csv.ts` (Added)
- `packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/trends/+server.ts` (Modified)
- `packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/trends/export/+server.ts` (Added)
- `packages/praxrr-app/src/routes/api/v1/sync-history/export/+server.ts` (Modified)
- `packages/praxrr-app/src/routes/api/v1/timeline/export/+server.ts` (Modified)
- `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.server.ts` (Modified)
- `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.svelte` (Modified)
- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/HealthTrendChart.svelte` (Added)
- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/HealthTrendTable.svelte` (Added)
- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/TrendFilters.svelte` (Added)
- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/trendChart.ts` (Added)
- `packages/praxrr-app/src/tests/db/configHealthSnapshots.test.ts` (Modified)
- `packages/praxrr-app/src/tests/e2e/specs/config-health-trends-export.spec.ts` (Added)
- `packages/praxrr-app/src/tests/health/trendChart.test.ts` (Added)
- `packages/praxrr-app/src/tests/health/trendCsv.test.ts` (Added)
- `packages/praxrr-app/src/tests/health/trendFilters.test.ts` (Added)
- `packages/praxrr-app/src/tests/health/trends.test.ts` (Added)
- `packages/praxrr-app/src/tests/routes/configHealth.test.ts` (Modified)
- `scripts/test.ts` (Modified)
