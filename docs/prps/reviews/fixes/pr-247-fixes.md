# PR #247 Review Fix Report

## Summary

- **Source review**: `docs/prps/reviews/pr-247-review.md`
- **Mode**: Parallel, dependency-aware batches
- **Severity threshold**: LOW
- **Eligible findings**: 15
- **Fixed**: 15
- **Failed**: 0
- **Skipped**: 0

## Results

| Finding | Severity | Status | Resolution                                                                                    |
| ------- | -------- | ------ | --------------------------------------------------------------------------------------------- |
| F001    | HIGH     | Fixed  | Reject retained snapshots whose persisted Arr type differs from the current instance type.    |
| F002    | HIGH     | Fixed  | Expanded shared CSV formula-prefix neutralization to LF and full-width initiators.            |
| F003    | HIGH     | Fixed  | Reset and reload instance-owned state on parameter-only navigation, with abort handling.      |
| F004    | HIGH     | Fixed  | Render persisted bands on points and label current thresholds as a current-policy reference.  |
| F005    | HIGH     | Fixed  | Added accessible 50-row client pagination for the bounded 10,000-point dataset.               |
| F006    | MEDIUM   | Fixed  | Limited selected columns and enforced per-row, aggregate-byte, criteria, and profile budgets. |
| F007    | MEDIUM   | Fixed  | Derived trend wire types from generated OpenAPI schemas and typed E2E fixtures.               |
| F008    | MEDIUM   | Fixed  | Enforced portable integer and range constraints for persisted numeric evidence.               |
| F009    | MEDIUM   | Fixed  | Loaded a deterministic bounded union of retained profile names independent of date filters.   |
| F010    | MEDIUM   | Fixed  | Rejected disabled instances consistently from trend JSON and export access.                   |
| F011    | MEDIUM   | Fixed  | Replaced the legacy Svelte dispatcher with a typed callback property.                         |
| F012    | MEDIUM   | Fixed  | Extracted the duplicated SVG plot implementation into `TrendPlot.svelte`.                     |
| F013    | MEDIUM   | Fixed  | Made horizontally scrollable charts focusable, named regions with visible focus styles.       |
| F014    | MEDIUM   | Fixed  | Bounded rendered gap and engine-boundary indicators while retaining exact evidence elsewhere. |
| F015    | LOW      | Fixed  | Centralized positive safe-integer Config Health path-parameter parsing.                       |

## Validation

- `deno task check` — passed with 0 Svelte errors and 0 warnings.
- `deno task test config-health` — passed, 193 tests.
- Focused Playwright Config Health trends/export suite — passed, 11 tests.
- `deno task build` — passed, including the production Deno compile.
- Prettier checks for every changed and added source, test, and documentation file — passed.
- Scoped ESLint checks for changed TypeScript and Svelte files — passed.

## Files and Areas Updated

- Trend persistence/query budgets and retained-profile discovery.
- Trend projection, generated response types, and CSV safety.
- Config Health API/page parameter parsing and enabled-instance enforcement.
- Trend page lifecycle, filters, chart extraction, accessibility, and table pagination.
- Database, service, route, chart, CSV, and focused browser regression coverage.
- Source review artifact statuses (`Open` to `Fixed`).

## Outcome

All actionable findings from the PR #247 review were resolved. The branch is ready for a clean
re-review and CI validation.

## Re-review Cycle

The integrated re-review found seven additional bounded-resource and contract/documentation issues.
All seven were fixed:

- Disconnected chart runs now share one multi-subpath SVG path per visual series.
- Distinct criterion chart discovery stops at the display cap plus one and renders at most 12 charts.
- Raw evidence-byte budgets are checked in SQL before JSON text reaches JavaScript.
- Retained profile discovery has a 10,000-snapshot sentinel before JSON expansion.
- Empty persisted profile names are rejected without trimming valid exact names.
- JSON and export OpenAPI 422 responses document every evidence-budget rejection.
- The merged roadmap consistently records #223–#225 shipped and #226/#247 pending merge.

Post-fix validation increased the focused suite to 197 passing tests and the focused browser suite
remains 11 passing tests. The final re-review decision is `APPROVE`.
