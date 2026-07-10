# Integration Analysis: Config Health Trends and Export

## Executive Summary

Issue #226 expands the existing authenticated per-instance Config Health trend path; it does not
create a separate analytics store or contact an Arr application while reading history. The central
integration boundary should be one canonical server result, built from persisted
`config_health_snapshots` rows and `config_health_settings`, which feeds the chart JSON, semantic
table, JSON attachment, and CSV attachment without a second filter or sort.

The portable contract has three synchronized outputs: the multi-file OpenAPI source, the generated
app declarations, and the bundled `praxrr-api` package artifacts. The detail page remains responsible
for live health separately, so trend loading, filtering, retry, and export must not blank or replace
the live detail report.

## API Endpoints

- `GET /api/v1/config-health/{instanceId}`: existing live overall/profile report, produced by
  `scoreInstance()` and `toDetailResponse()`; trend failures must not affect it — handler at
  `packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/+server.ts`.
- `GET /api/v1/config-health/{instanceId}/trends`: replace the current optional `days` sparkline
  response with the canonical trend envelope — handler at
  `packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/trends/+server.ts`.
- `GET /api/v1/config-health/{instanceId}/trends/export`: add an attachment handler that accepts the
  identical selection plus `format=json|csv` (JSON default), calls the same parser and trend service,
  and only serializes the returned result — new handler at
  `packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/trends/export/+server.ts`.
- `GET /api/v1/config-health/settings`: existing source for current global retention settings; the
  trend service should read `configHealthSettingsQueries.get()` internally rather than require a
  second client request — handler at
  `packages/praxrr-app/src/routes/api/v1/config-health/settings/+server.ts`.
- `GET /api/v1/config-health/summary`: existing fleet view and safe navigation source, but not a
  historical dataset — handler at
  `packages/praxrr-app/src/routes/api/v1/config-health/summary/+server.ts`.

### Request Contract

Both trend handlers need a shared pure parser, preferably
`packages/praxrr-app/src/lib/server/health/trendFilters.ts`, with one injected request clock:

- `instanceId`: positive integer path id; retain the existing indistinguishable `404` for a missing
  instance or a type outside explicit `radarr|sonarr|lidarr` sync support.
- `days`: integer `1..3650`; mutually exclusive with either `from` or `to`. The UI sends `days=30`
  initially, while omission of all time parameters retains the existing all-history API meaning.
- `from` / `to`: inclusive strict date-only or ISO date-time bounds. Reuse the strict behavior of
  `packages/praxrr-app/src/lib/server/sync/syncHistory/filters.ts` (`parseDateBound`) or extract a
  neutral helper; date-only lower/upper values expand to start/end of day and date-times normalize to
  UTC. Reject `from > to`.
- `profile`: optional exact persisted profile name. Reject only an empty value, and preserve the
  decoded value byte-for-byte: no trim, case fold, fuzzy match, or sibling-Arr inference.
- `format`: export-only `json|csv`; any other value is `400`.

Relative `days` must become absolute `normalizedFilter.from/to` values in the result. UI download
URLs must use those applied absolute values (and the applied exact profile), not repeat `days`, so a
later click cannot shift the dataset as wall time advances.

### Response and Error Contract

The current `ConfigHealthTrendsResponse` (`instanceId`, current `engineVersion`, and
`generatedAt/overallScore/band`) is insufficient and should be replaced by schemas matching the
feature spec:

- instance identity (`id`, `name`, explicit `arrType`) and `currentEngineVersion`;
- absolute `normalizedFilter`;
- current global retention policy plus oldest/newest available evidence for this instance;
- exact, deterministically ordered historical profile names;
- counts and engine-version boundaries;
- points ordered by `generatedAt ASC, snapshotId ASC`, each carrying persisted `snapshotId`,
  `generatedAt`, `engineVersion`, explicit state, nullable score/band, and overall criteria.

Use explicit tagged states rather than overloaded values: point `measured|unknown|profile-missing|
not-recorded` and criterion `measured|not-evaluated|not-recorded`. A stored unknown band maps score
to `null`; an absent exact profile stays as a timestamped `profile-missing` point; malformed legacy
JSON stays identifiable as `not-recorded`. Profile scope exposes only persisted profile score/band;
it must not relabel overall criteria as profile evidence.

Return `200` for a valid empty selection, `400` for path/filter/format errors, `404` for missing or
non-sync-capable instances, `422` when the exact selection exceeds 10,000 points, and sanitized `500`
for internal failures. Fetch 10,001 rows and fail atomically rather than truncate. Both download
formats require `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, correct content type,
and a fixed ASCII `Content-Disposition` filename made only from numeric instance id and a server
timestamp.

JSON attachment content is the same canonical envelope and point order as `/trends`. CSV is CRLF,
one row per canonical point, with fixed columns
`snapshotId,generatedAt,engineVersion,scopeKind,profileName,state,score,band,criteria`; `criteria` is
compact JSON in one RFC 4180 cell. Null cells are blank, numeric zero remains `0`, empty selection is
header-only, and values beginning with `=`, `+`, `-`, `@`, tab, or carriage return are prefixed before
CSV quoting. Existing duplicate implementations in the sync-history and timeline export handlers
make `packages/praxrr-app/src/lib/server/utils/export/csv.ts` the appropriate shared low-level
escaping seam, while each feature retains its own columns and row projection.

## OpenAPI and Generated Artifacts

The public OpenAPI server base is `/api/v1`, so contract paths remain `/config-health/...` even though
runtime route files live below `routes/api/v1`.

1. Expand `docs/api/v1/schemas/config-health.yaml` with filter/result metadata, instance, retention,
   counts, engine boundary, criterion state, criterion point, point state, point, and full response
   schemas. Model unknown values as JSON Schema 3.1 nullable unions rather than sentinel zeroes.
2. Expand `docs/api/v1/paths/config-health.yaml#/trends` with `days/from/to/profile`, revised response,
   `422`, and `500`; add a `trendsExport` operation with the same filters plus `format`, attachment
   media types `application/json` and `text/csv`, and the same error statuses.
3. Register `/config-health/{instanceId}/trends/export` and every new schema reference in
   `docs/api/v1/openapi.yaml`.
4. Run `deno task generate:api-types` to regenerate
   `packages/praxrr-app/src/lib/api/v1.d.ts` from the multi-file source.
5. Run `deno task bundle:api` to rebuild `packages/praxrr-api/openapi.json` and copy/inject docs into
   `packages/praxrr-api/types.ts`. These are committed contract artifacts, not optional build output.
6. Keep runtime wire interfaces/mappers in
   `packages/praxrr-app/src/lib/server/health/responses.ts` (or trend-specific types re-exported from
   the canonical service), and require route payload expressions to `satisfies
components['schemas'][...]` so portable and runtime shapes cannot drift.

`packages/praxrr-app/src/tests/base/bundleApiContract.test.ts` currently checks bundled local
pointers, but issue coverage must additionally prove the new path and schemas appear in both
generated declarations and the bundled package or otherwise exercise generation in validation.

## Database

No migration, new table, column, or retention behavior is needed.

### `config_health_snapshots`

Defined by
`packages/praxrr-app/src/lib/server/db/migrations/20260714_create_config_health_tables.ts`, this is
the sole historical source:

- `id INTEGER PRIMARY KEY AUTOINCREMENT`: stable equal-timestamp tiebreak and export identity.
- `arr_instance_id INTEGER NULL REFERENCES arr_instances(id) ON DELETE SET NULL`: active-instance
  query scope; deleted rows may remain historically but the current route deliberately cannot
  address them.
- `instance_name`, `arr_type`, `engine_version`: persisted observation context.
- `overall_score`, `band`: overall observation; the database permits score `0` with `band='unknown'`,
  so the projector, not SQL, must map that to nullable wire evidence.
- `criteria_scores`, `profile_scores`: JSON text. Current profile entries contain only
  `{name,score,band}`; issue #226 must not recompute missing profile criterion history.
- `generated_at`: canonical ISO UTC primary time key.

The existing `idx_config_health_snapshots_instance(arr_instance_id, generated_at DESC)` supports a
static parameterized bounded query. Extend
`packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts` with an internal query shape
that applies `generated_at >= ?` / `<= ?`, orders `generated_at ASC, id ASC`, and limits to cap + 1.
Do not wrap the indexed column in `datetime()` as the current `getTrend(days)` does. Keep all profile
matching out of dynamic SQL/JSON paths: fetch the bounded instance rows and perform exact-name
projection against safely parsed arrays.

Parsing must distinguish a valid empty persisted array from malformed/not-array JSON; the current
generic `parseJsonArray()` collapses both to `[]`, which cannot support the required `not-recorded`
state. Add evidence-aware decoding for the trend path without weakening degradation or snapshot
callers. Query metadata for oldest/newest available instance evidence from the persisted set; do not
infer that an interval was a missed run or that a specific retention rule pruned it.

### `config_health_settings`

The singleton row supplies current `retention_days` and fleet-wide `retention_max_entries`. Attach
these values and a request-clock-derived age cutoff to the trend result. Wording and types must make
clear that the count cap is global across instances and that the earliest available point proves
only availability, not why older evidence is absent.

The separate `config_health_notification_state` table and its `(arr_instance_id, id DESC)` snapshot
index support degradation notifications, not trend projection; issue #226 must not couple to or
mutate that state.

## External Services

There are no new third-party calls, SDKs, credentials, hosted analytics, or chart dependencies. A
trend/export request reads the local app database only; it must not call Radarr, Sonarr, or Lidarr.
Historical rows are produced earlier by the registered `config-health.snapshot` job in
`packages/praxrr-app/src/lib/server/jobs/handlers/configHealthSnapshot.ts`, which live-scores each
eligible instance and appends a report. That producer remains unchanged in semantics and is not run
on demand by the trend routes.

Authentication is inherited from `packages/praxrr-app/src/hooks.server.ts`: Config Health paths are
not listed in `PUBLIC_PATHS`, so unauthenticated `/api/**` requests receive JSON `401`; browser
requests use the session cookie, and programmatic clients may use `X-Api-Key`. Although the current
global middleware also recognizes `apikey` in the query string, the new UI and generated export
links must never place credentials in URLs. Add integration coverage proving both new paths remain
protected rather than relying only on direct handler tests, which bypass the hook.

## Internal Services

- `arrInstancesQueries.getById()` plus `isSyncPreviewArrType()` is the authoritative active-instance
  gate. Preserve explicit `arr_type` semantics and the existing no-sibling-fallback `404` behavior.
- `trendFilters.ts` should own all selection normalization and typed `400` failures for both routes.
- `configHealthSnapshotsQueries` should own only static, parameterized snapshot retrieval and
  evidence-aware row decoding; it must not know about CSV or UI shapes.
- `packages/praxrr-app/src/lib/server/health/trends.ts` should validate the instance, read settings,
  execute the cap+1 query, project overall/exact-profile evidence, compute profile options/counts/
  boundaries/retention metadata, and return the single canonical result.
- `responses.ts` should remain the portable response boundary; no client component should import DB
  row types.
- `trendCsv.ts` should accept the canonical result and serialize only; it must never query, filter,
  sort, infer, or drop points.
- Existing `scoreInstance()` in `packages/praxrr-app/src/lib/server/health/service.ts` remains the
  live-detail path. Keeping it separate avoids making historical inspection depend on current Arr or
  PCD health gathering.
- Logging should contain bounded operational metadata only: numeric instance id, normalized range
  shape, count/duration/overflow/status. Do not log profile names, raw stored JSON, or CSV content.

## UI Integration Points

- Modify `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.server.ts` to expose only
  safe enabled sync-capable instance options (`id`, `name`, explicit type), mirroring
  `routes/config-health/+page.server.ts`; never expose URL/API-key fields.
- Replace the fixed index-spaced 30-day polyline in
  `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.svelte` with route-local filter,
  SVG chart, and semantic table components under `components/`. The x-axis must use actual
  timestamps, and unknown/profile-missing/not-recorded/version changes must break segments.
- Keep detail and trends as independent request states. Trend changes use `AbortController` plus a
  request id; preserve the last applied caption/result while a new selection loads, and provide a
  trend-only retry.
- Instance selection navigates to `/config-health/{id}`; it does not create a fleet history endpoint.
  Profile options come from `availableProfiles` so deleted/renamed historical names remain selectable
  exactly. Switching instances must clear a profile that is not valid there.
- Build export links from the successful response's absolute `normalizedFilter`; download anchors
  remain same-origin and session-authenticated. JSON/CSV failures must preserve the applied result
  and be announced through the page's polite status region.
- The SVG is a view only. Every point/value/state/version boundary must also be available in the
  chronological semantic table, and profile scope must replace overall criterion charts with an
  honest “not historically recorded” explanation.
- Render stored names/labels through normal escaped Svelte text only: no `{@html}`, `innerHTML`, SVG
  `foreignObject`, or externally controlled URL/event attributes.

## Validation Integration

- Extend `packages/praxrr-app/src/tests/db/configHealthSnapshots.test.ts` for inclusive absolute
  bounds, instance isolation across Radarr/Sonarr/Lidarr, stable equal-timestamp id ordering, cap+1,
  indexed query plan, exact profile parsing, and malformed-vs-empty evidence.
- Extend `packages/praxrr-app/src/tests/routes/configHealth.test.ts` to invoke both trend handlers and
  cover filter combinations, exact names, 400/404/422/500, empty `200`, nullable states, retention,
  engine boundaries, hostile strings, download headers, JSON deep equality, and parsed CSV point/
  criteria/order parity. The current file does not test the existing trend handler, so importing it
  is required.
- Add pure tests for filter normalization, CSV CRLF/escaping/formula neutralization/header-only
  output, and actual-time geometry/segment breaking. Place them under the current `config-health`
  alias roots or update `scripts/test.ts` so `deno task test config-health` actually runs them.
- Add an auth-boundary test through the global hook/server surface for both new GET paths; direct
  handler invocation alone cannot prove `401` inheritance.
- Add deterministic Playwright coverage under `packages/praxrr-app/src/tests/e2e/specs/` using route
  interception or seeded rows for empty, filtered-empty, single-point, unknown, profile-missing,
  multi-engine, keyboard selection, export links, and 320px/mobile reflow. At least one route test
  must still prove database-to-wire behavior.
- Required contract/build gates are `deno task generate:api-types`, `deno task bundle:api`,
  `deno task test config-health`, `deno task check`, `deno task lint`, and relevant/full
  `deno task test:e2e`; finish with `graphify update .` after source changes.

## Implementation Constraints

- Persisted evidence only: no historical recomputation, interpolation, smoothing, cadence inference,
  backfill, retention change, or profile-criterion schema enrichment in issue #226.
- One canonical ordering and selection across chart JSON, table, JSON attachment, and parsed CSV.
- No implicit Radarr/Sonarr/Lidarr fallback; use the path-selected instance's explicit stored type.
- No new runtime dependency, external network access, SQL migration, or alternate datastore.
- OpenAPI source, runtime validators/mappers, generated app declarations, and bundled API artifacts
  must land in the same change and pass generation before UI integration is considered complete.
