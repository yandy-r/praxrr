# Architecture Analysis: config-health-trends-export

## Executive Summary

Issue #226 should extend the existing per-instance Config Health detail route around one canonical,
bounded trend result. Persisted `config_health_snapshots` remain the only historical source; a shared
parser/query/projector must feed the chart endpoint, semantic UI/table, and JSON/CSV attachments so
scope, states, counts, and `generated_at ASC, id ASC` ordering cannot drift.

## Architecture Context

- **System Structure**: The feature crosses the portable OpenAPI source, generated API artifacts,
  SQLite query layer, server health service, two SvelteKit API handlers, and route-local Svelte/SVG
  presentation. It adds no table, migration, chart dependency, or analytics service.
- **Data Flow**: `parseConfigHealthTrendFilter(url, injectedNow)` normalizes `days` or inclusive
  `from`/`to` into absolute UTC bounds and preserves an exact profile name. The service validates the
  active sync-capable path instance, reads retention settings, requests at most 10,001 rows with bound
  SQL parameters, and projects at most 10,000 canonical points. Both routes consume that same result;
  CSV only serializes it. The page renders filters, SVG segments, summaries, and a chronological table
  from the response, then builds download URLs from `normalizedFilter`, not the original relative
  request.
- **Integration Points**: Replace the current `getTrend(days?) -> toTrendsResponse()` sparkline path
  with feature-specific parser/service modules. Extend the detail server load using the existing
  credential-safe enabled-instance projection, while keeping live detail and trend fetch failures
  independent. Register the export path and expanded schemas before regenerating and bundling the
  portable API artifacts.
- **Canonical Projection**: Overall scope maps stored overall score/band and `criteria_scores`;
  `band='unknown'` produces `score=null`. Profile scope exact-matches stored names and emits
  `profile-missing` gaps with no criteria. Malformed criterion/profile JSON must remain distinguishable
  from a valid empty array and become `not-recorded`, so the current generic `parseJsonArray()` fallback
  cannot be the evidence boundary for this query.
- **Comparability**: Every point carries its persisted engine version. Unknown, missing,
  not-recorded, and engine-transition points break SVG segments and forbid cross-boundary deltas;
  actual timestamps, not point indexes, drive x-coordinates.

## Critical Files Reference

- `docs/api/v1/paths/config-health.yaml`: Define shared filters, expanded trend responses, export media
  types, and 400/404/422 contracts.
- `docs/api/v1/schemas/config-health.yaml`: Source-of-truth point, criterion-state, metadata, retention,
  count, and boundary schemas.
- `docs/api/v1/openapi.yaml`: Register `/config-health/{instanceId}/trends/export` and schema refs.
- `packages/praxrr-app/src/lib/api/v1.d.ts`, `packages/praxrr-api/openapi.json`,
  `packages/praxrr-api/types.ts`: Generated/bundled artifacts that must remain reproducible from the
  portable contract.
- `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts`: Add a trend-specific
  absolute-bound, cap+1 query using the existing instance/time index and stable timestamp/id order;
  preserve parse-validity evidence.
- `packages/praxrr-app/src/lib/server/health/trendFilters.ts`: New pure validation/normalization seam
  with an injected clock and typed 400 failures.
- `packages/praxrr-app/src/lib/server/health/trends.ts`: New canonical instance validation,
  retention/profile metadata, point-state projection, counts, overflow, and engine-boundary service.
- `packages/praxrr-app/src/lib/server/health/responses.ts`: Keep runtime wire types/mappers aligned with
  generated OpenAPI types while replacing the minimal sparkline contract.
- `packages/praxrr-app/src/lib/server/health/trendCsv.ts` and
  `packages/praxrr-app/src/lib/server/utils/export/csv.ts`: New fixed one-point-per-row serializer and
  shared formula-safe RFC 4180 cell escaping; neither may filter or reorder.
- `packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/trends/+server.ts`: Thin JSON route
  over the shared parser/service with sanitized errors.
- `packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/trends/export/+server.ts`: New thin
  attachment adapter with JSON/CSV selection, fixed filenames, `no-store`, and `nosniff`.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.server.ts`: Supply only safe,
  enabled, sync-capable instance options; never expose credential-adjacent fields.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.svelte`: Own applied/draft filter
  state, abortable request lifecycle, fault isolation, normalized export URLs, and composition.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/{TrendFilters.svelte,HealthTrendChart.svelte,HealthTrendTable.svelte,trendChart.ts}`:
  New route-local controls, accessible presentation, complete semantic alternative, and pure geometry.
- `packages/praxrr-app/src/tests/db/configHealthSnapshots.test.ts` and
  `packages/praxrr-app/src/tests/routes/configHealth.test.ts`: Primary indexed-query and API/export
  parity gates; add focused pure helper tests plus Config Health E2E coverage for interaction/reflow.
- `ROADMAP.md`: Record #226 only after implementation evidence and final PR status are known.

## Cross-Cutting Concerns

- **Contract fidelity**: OpenAPI schemas, generated types, runtime validators, route `satisfies`
  checks, CSV columns, and UI assumptions must change as one contract-first unit.
- **Evidence fidelity**: Never recompute history, trim/case-fold profile identifiers, substitute
  instance criteria for profile criteria, convert absence to zero, interpolate gaps, or claim a
  retention cause the schema cannot prove.
- **Cross-Arr isolation**: Validate the path instance's explicit Radarr/Sonarr/Lidarr type and
  sync-capability; do not infer sibling-app profiles or use fallback handlers.
- **Bounded resources**: Use static parameterized SQL, lexical canonical ISO bounds, selected columns,
  cap+1 detection, and atomic 422 overflow. Abort superseded browser requests and keep all table/export
  points even if visual marker density is reduced.
- **Security**: Inherit protected `/api/v1/config-health/**` auth, keep API keys out of URLs, escape all
  Svelte/SVG text normally, neutralize CSV formula prefixes before RFC escaping, use numeric-id-only
  filenames, and log bounded metadata rather than stored payloads.
- **Accessibility/responsiveness**: Color is supplementary. Charts need labelled shapes/lines,
  keyboard/touch point inspection, concise summaries, engine/gap annotations, polite live status, and
  a complete semantic table that reflows without page-level horizontal overflow.
- **Race semantics**: Absolute applied bounds prevent moving relative windows. A `throughSnapshotId`
  token is intentionally deferred unless parity tests expose backdated concurrent inserts; do not add
  an unplanned snapshot protocol preemptively.

## Parallelization Opportunities

- After the response and CSV decisions are frozen, OpenAPI work, pure filter parsing, bounded-query
  work, CSV escaping, and chart geometry can proceed independently in separate file groups.
- Generated API artifacts depend on the OpenAPI source; the canonical service depends on generated
  types, parser, and query; both JSON/export handlers depend on the service, and CSV route behavior
  also depends on the serializer.
- UI request-state/filter scaffolding and pure geometry can start from settled fixtures in parallel,
  but integrated chart/table/export composition waits for the canonical response contract.
- DB/service/route tests can be developed alongside their layers. Responsive accessibility E2E,
  ROADMAP, graph update, and full validation are final integration tasks.

## Implementation Constraints

- Preserve one instance per route and one scope (`overall` or one exact historical profile); profile
  history exposes score/band only because old snapshots contain no profile criterion evidence.
- Preserve deterministic `generatedAt ASC, snapshotId ASC` order in JSON, CSV, chart, table, counts,
  and parity tests; valid empty results are 200 and CSV is header-only.
- `days` is mutually exclusive with `from`/`to`, accepts 1-3650, defaults in the UI to 30, and must be
  resolved once with an injected `now`; bounds are inclusive and invalid ranges are 400.
- More than 10,000 matching snapshots is a 422 with no partial result or export. Use the indexed
  `(arr_instance_id, generated_at DESC)` path without wrapping `generated_at` in `datetime()`.
- Retention metadata describes the current global age/count policy and observed oldest/newest evidence;
  it must say earlier history may have been pruned, never that a specific policy caused a gap.
- Use native route-local SVG and existing Svelte 5 non-runes conventions/components. Do not add a
  chart library, datastore, SQL migration, retention change, predictive behavior, or cross-Arr
  fallback.
