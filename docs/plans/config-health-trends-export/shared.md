# Config Health Trends and Export

Issue #226 extends the authenticated per-instance Config Health detail surface around one canonical,
bounded historical result. Persisted `config_health_snapshots` rows remain the only historical
source; a shared filter parser, evidence-aware query, and health-domain projector feed the trend JSON,
semantic table, JSON attachment, and CSV attachment in `generated_at ASC, id ASC` order. Overall scope
exposes stored score, band, and criterion history, while exact-name profile scope exposes stored
score/band only. Native route-local SVG and a complete semantic table render explicit unknown,
profile-missing, malformed/unrecorded, engine-version, and retention boundaries without a new table,
chart dependency, backfill, or cross-Arr fallback.

## Relevant Files

- `docs/plans/config-health-trends-export/feature-spec.md`: Final evidence, API, CSV, UX, and security decisions.
- `docs/api/v1/paths/config-health.yaml`: Portable trend/export parameters, responses, and media types.
- `docs/api/v1/schemas/config-health.yaml`: Portable point, criterion, filter, boundary, and result schemas.
- `docs/api/v1/openapi.yaml`: Root path/component registration for the generated API.
- `packages/praxrr-app/src/lib/api/v1.d.ts`: Generated app contract declarations; never hand-edit.
- `packages/praxrr-api/openapi.json`: Bundled portable OpenAPI artifact.
- `packages/praxrr-api/types.ts`: Bundled generated TypeScript artifact.
- `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts`: Snapshot storage/query owner and JSON parsing boundary.
- `packages/praxrr-app/src/lib/server/db/queries/configHealthSettings.ts`: Current global retention policy source.
- `packages/praxrr-app/src/lib/server/health/responses.ts`: Runtime-to-portable Config Health wire mapping.
- `packages/praxrr-app/src/lib/server/health/trendFilters.ts`: New strict shared relative/absolute filter parser.
- `packages/praxrr-app/src/lib/server/health/trends.ts`: New canonical projection/service and explicit evidence states.
- `packages/praxrr-app/src/lib/server/health/trendCsv.ts`: New fixed one-point-per-row canonical CSV projection.
- `packages/praxrr-app/src/lib/server/utils/export/csv.ts`: New shared formula-safe RFC 4180 cell escaping.
- `packages/praxrr-app/src/lib/server/timeline/filters.ts`: Typed filter/service boundary pattern to mirror.
- `packages/praxrr-app/src/lib/server/timeline/service.ts`: One canonical result shared by routes pattern.
- `packages/praxrr-app/src/lib/server/sync/syncHistory/filters.ts`: Strict inclusive date-bound parser to reuse.
- `packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/trends/+server.ts`: Existing JSON route to make thin.
- `packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/trends/export/+server.ts`: New JSON/CSV attachment adapter.
- `packages/praxrr-app/src/routes/api/v1/timeline/export/+server.ts`: Export/CSV precedent and third shared-escape consumer.
- `packages/praxrr-app/src/routes/api/v1/sync-history/export/+server.ts`: Export/CSV precedent and third shared-escape consumer.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.server.ts`: Strict id validation and safe instance options.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.svelte`: Current detail/sparkline and integration owner.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/trendChart.ts`: New pure actual-time geometry.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/TrendFilters.svelte`: New applied/draft selection controls.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/HealthTrendChart.svelte`: New accessible SVG analysis.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/HealthTrendTable.svelte`: New complete semantic alternative.
- `packages/praxrr-app/src/tests/db/configHealthSnapshots.test.ts`: Real SQLite bounds/order/index/evidence tests.
- `packages/praxrr-app/src/tests/routes/configHealth.test.ts`: Route, status, header, auth, and representation-parity tests.
- `packages/praxrr-app/src/tests/e2e/specs/config-health-trends-export.spec.ts`: New deterministic responsive/a11y acceptance coverage.
- `scripts/test.ts`: Config Health alias; modify only if new test paths are otherwise omitted.
- `ROADMAP.md`: Issue #226 status and delivered behavior closeout.

## Relevant Tables

- `config_health_snapshots`: Append-only instance history with persisted engine version, overall
  score/band/criteria, light exact-name profile score/band, and canonical generated time.
- `config_health_settings`: Singleton collection and global age/count retention configuration used
  for context only; no retention behavior changes.
- `arr_instances`: Active enabled instance identity and explicit `arr_type`; routes keep the existing
  missing/non-sync-capable 404 and never fall back across Arr apps.

No new table, column, migration, materialized series, or profile-criterion backfill is allowed.

## Relevant Patterns

**Contract-first portable API**: Edit the three YAML sources, then run `deno task generate:api-types`
and `deno task bundle:api`; runtime route values use generated schema types or `satisfies`. See
`docs/api/README.md` and `packages/praxrr-app/src/lib/server/health/responses.ts`.

**Shared parser and canonical service**: Both normal and export routes parse identical selection and
consume one service result. Mirror `packages/praxrr-app/src/lib/server/timeline/filters.ts` and
`packages/praxrr-app/src/lib/server/timeline/service.ts`.

**Static parameterized SQLite**: Bind instance, canonical UTC bounds, and limit against fixed SQL.
Use lexical `generated_at` bounds and `ORDER BY generated_at ASC, id ASC`; never interpolate profile,
criterion, JSON path, sort, column, or identifier.

**Evidence-aware projection**: The query layer distinguishes valid empty arrays from malformed/
non-array JSON. The health service maps unknown scores to null, retains missing-profile timestamps,
preserves stored bands/versions, and builds version boundaries without recomputing history.

**Exact bounded output**: Query 10,001 for a 10,000-point limit and return 422 with no partial result.
Do not reuse Timeline/Sync History's logged-only truncation behavior.

**Feature-local UI until proven reusable**: Keep filters/chart/table/geometry under the detail route.
Promote a chart abstraction only after another domain demonstrates the same contract.

**Independent current/trend fault domains**: Preserve current detail when trend loading, refresh, or
export fails. Use `AbortController` plus request-id protection; applied captions change only when a
new response succeeds.

**Accessible complex image**: SVG is one representation. A concise visible summary and complete
chronological table expose every point/state; text, shapes, line/border patterns, and focus state carry
meaning in addition to color.

**Spreadsheet-safe CSV**: Formula-neutralize each cell before RFC 4180 escaping and CRLF joining.
Feature-specific fixed columns remain in `trendCsv.ts`; only the low-level cell helper is shared.

**Cross-Arr fail-closed semantics**: Resolve the active path-selected instance's explicit
`radarr|sonarr|lidarr` type. Do not infer profile identity, reuse sibling handlers, or expose orphaned
history through another Arr route.

## Relevant Docs

**`CLAUDE.md`**: You _must_ read this for contract-first API, Svelte, formatting, cross-Arr, ROADMAP,
PR-template, and Graphify rules.

**`docs/plans/config-health-trends-export/feature-spec.md`**: You _must_ read this before every task;
it resolves profile-criterion scope, CSV shape, point cap, evidence states, and accessibility behavior.

**`docs/plans/config-health-trends-export/analysis-patterns.md`**: You _must_ read this for exact
repository parser/query/export/Svelte/test patterns and gotchas.

**`docs/plans/config-health-trends-export/analysis-integration.md`**: You _must_ read this for
OpenAPI-generation, auth, database, route, UI, and validation integration.

**`docs/api/README.md`**: You _must_ read this before editing portable API sources or generated files.

**`docs/site/src/content/docs/app/architecture.md`**: You _must_ read this when changing app/server/
portable contract boundaries.

**`docs/site/src/content/docs/app/jobs.md`**: You _must_ read this when describing snapshot cadence or
retention; current policy does not prove a point was pruned.

**`docs/site/src/content/docs/app/testing.md`**: You _must_ read this before adding test files or
changing the Config Health alias.

**`docs/site/src/content/docs/app/components/forms.mdx`**, **`cards.md`**, **`tables.md`**, and
**`feedback.md`**: Reference for labelled controls, responsive structure, semantic tables, and explicit
loading/empty/error feedback.

**W3C WAI Complex Images and WCAG 2.2**: You _must_ apply the chart summary/table, keyboard, non-color,
contrast, tooltip, status, and 320 CSS px reflow requirements captured in the feature spec.
