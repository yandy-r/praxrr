# PR #247 Re-review

## Scope

- **Branch**: `feat/config-health-trends-export`
- **Integrated head**: `18743ac6`
- **Base**: `origin/main`
- **Review mode**: Parallel server/security, frontend/accessibility, and contract/test review
- **Decision**: APPROVE

## Findings

### HIGH

- **[R001]** `packages/praxrr-app/src/routes/config-health/[instanceId]/components/TrendPlot.svelte:183` — Disconnected measured runs render as one SVG path element per segment, allowing thousands of path nodes for an alternating-gap maximum-size history. [performance]
  - **Status**: Fixed
  - **Suggested fix**: Combine same-style segment path data into one multi-subpath SVG path and test a 10,000-point alternating-gap history.

- **[R002]** `packages/praxrr-app/src/routes/config-health/[instanceId]/components/HealthTrendChart.svelte:39` — Distinct persisted criterion IDs can create an unbounded number of score/contribution geometries and SVG charts. [performance]
  - **Status**: Fixed
  - **Suggested fix**: Deterministically cap displayed criterion charts, report the omitted count, and retain complete evidence in the table and exports.

### MEDIUM

- **[R003]** `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts:328` — Oversized JSON text is materialized in JavaScript before evidence-byte budgets reject it. [performance]
  - **Status**: Fixed
  - **Suggested fix**: Perform a bounded SQL preflight or sentinel projection so over-budget raw JSON values never reach JavaScript.

- **[R004]** `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts:415` — Retained-profile discovery has no row-count sentinel before JSON expansion and can scan an excessive number of small rows. [performance]
  - **Status**: Fixed
  - **Suggested fix**: Add a deterministic retained-row cap before expansion while keeping the retained profile union stable within that bound.

- **[R005]** `packages/praxrr-app/src/lib/server/health/trends.ts:178` — Empty persisted profile names can be advertised even though exact profile filtering rejects an empty name. [correctness]
  - **Status**: Fixed
  - **Suggested fix**: Reject empty names without trimming in both persisted evidence parsing and SQL expansion.

- **[R006]** `docs/api/v1/paths/config-health.yaml:194` — The 422 response documents point overflow but not row, aggregate-byte, or nested evidence-budget rejection. [contract]
  - **Status**: Fixed
  - **Suggested fix**: Document every runtime evidence-budget condition for both JSON and export endpoints and align the feature specification.

- **[R007]** `ROADMAP.md:341` — A stale row says Config Health notification work is pending and #225–#226 are open after those statuses changed. [documentation]
  - **Status**: Fixed
  - **Suggested fix**: Preserve current upstream security milestones while aligning all Config Health status summaries.

## Verified Resolutions from Initial Review

The re-review independently verified F001–F005, F007–F013, and F015. F006 and F014
required the additional bounded-materialization and SVG-node fixes recorded above.

## Validation at Review Time

- `deno task check` — passed with 0 errors and 0 warnings.
- `deno task test config-health` — passed, 193 tests.
- Trend chart unit suite — passed, 14 tests before the R001 regression was added.

## Fix Verification

- `deno task check` — passed with 0 errors and 0 warnings.
- `deno task test config-health` — passed, 197 tests.
- Trend chart unit suite — passed, 16 tests including adversarial maximum-size histories.
- Focused Playwright Config Health trends/export suite — passed, 11 tests.
- `deno task build` — passed, including the production Deno compile.
- Generated OpenAPI artifacts were refreshed after the 422 contract clarification.
- All seven re-review findings are fixed; exact table and export evidence remains untruncated.
