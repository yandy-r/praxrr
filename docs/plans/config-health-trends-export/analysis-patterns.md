# Pattern & Code Analysis: Config Health Trends and Export

## Executive Summary

Issue #226 should extend the existing Config Health detail and snapshot-query seams, while following
the newer Timeline pattern of a shared strict filter parser plus a domain service consumed by both
list and export routes. The core repository pattern is to keep route handlers thin, bind every SQL
value, map internal data to mutable OpenAPI-compatible wire objects, and prove database ordering and
route behavior with migrated scratch-SQLite tests.

The main departure from older export code is intentional: Sync History and Timeline silently cap and
log truncated exports, but this feature requires an exact canonical result. Query 10,001 rows, return
`422` when the 10,000-point limit is exceeded, and serialize the same result object for the chart,
semantic table, JSON attachment, and CSV attachment.

## Implementation Patterns

- **One parser shared by related routes**: Timeline centralizes query parsing in
  `packages/praxrr-app/src/lib/server/timeline/filters.ts`; both its list and export route call it.
  Create the equivalent Config Health parser in
  `packages/praxrr-app/src/lib/server/health/trendFilters.ts` and use it from both trend handlers.
  Reuse `parseDateBound()` from
  `packages/praxrr-app/src/lib/server/sync/syncHistory/filters.ts` for strict date-only/ISO parsing and
  inclusive day expansion. Add Config Health rules around it: `days` is integer `1..3650`, `days`
  cannot be combined with `from`/`to`, `from <= to`, and `profile` must be non-empty but otherwise
  remains byte-for-byte exact. Capture one injected `now` and normalize relative days into absolute
  UTC bounds.

- **Typed validation error mapped at the route edge**: `TimelineQueryError` extends
  `TimelineHttpError` in `packages/praxrr-app/src/lib/server/timeline/filters.ts`, and routes translate
  that known error to its status while logging unexpected failures. Follow this with a small typed
  Config Health trend error for `400` filter failures and a distinct overflow error/status for `422`.
  Do not scatter ad hoc `Number(...)` and date parsing between the trend and export handlers.

- **Thin SvelteKit handlers with `satisfies` checks**: Existing Config Health handlers, such as
  `packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/trends/+server.ts`, validate the
  positive path id, apply the explicit sync-capable-instance gate, return `json(...)`, and use
  `satisfies components['schemas'][...]` at the response boundary. Preserve the indistinguishable
  `404` for missing or unsupported instances. Known client errors should be returned without logging;
  unexpected reads should call `logger.error()` with a stable `source` and bounded metadata, then
  return a sanitized `500` body.

- **Explicit Arr semantics before historical access**: The current trend route checks
  `arrInstancesQueries.getById(instanceId)` and `isSyncPreviewArrType(instance.type)` before reading
  history. Keep that explicit `radarr|sonarr|lidarr` narrowing in the shared service; do not resolve a
  missing instance through another Arr type, an orphaned snapshot, or a sibling-app fallback. The
  page picker should mirror `packages/praxrr-app/src/routes/config-health/+page.server.ts`: expose only
  enabled, sync-capable `{ id, name, type }` records, never credential-adjacent fields.

- **Purpose-built parameterized query with stable order**:
  `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts` owns row shapes, JSON
  parsing, and all access to `config_health_snapshots`. Add a bounded trend search there with static
  SQL and bound `instanceId`, absolute bounds, and `limit + 1`. Compare canonical ISO timestamps
  directly (`generated_at >= ?`, `generated_at <= ?`) and order by `generated_at ASC, id ASC`. The
  existing `getTrend()` wraps the indexed column in `datetime(...)`; that is legacy behavior to
  replace for this path, not a pattern to copy. The migration
  `packages/praxrr-app/src/lib/server/db/migrations/20260714_create_config_health_tables.ts` already
  supplies `(arr_instance_id, generated_at DESC)`, so no schema migration is needed.

- **Database module maps storage shapes, service maps evidence semantics**: The query module currently
  converts snake-case rows to `ConfigHealthSnapshotDetail` and safely turns invalid JSON arrays into
  `[]`. For trends, the service must distinguish an actually empty array from malformed/unrecorded
  JSON, so add an evidence-aware trend row/parser rather than treating all parse failures as valid
  empty evidence. Keep raw rows and JSON strings out of routes. Put overall/profile selection,
  nullable states, counts, engine boundaries, retention metadata, and overflow detection in
  `packages/praxrr-app/src/lib/server/health/trends.ts`.

- **Pure canonical projector beneath the I/O service**: Follow the separation used by
  `packages/praxrr-app/src/lib/server/timeline/service.ts` and its response helpers. Export a pure
  `buildConfigHealthTrendResult(...)` that accepts an instance projection, normalized filter,
  snapshot rows, current settings, current engine version, and captured time. Keep database lookup in
  a small `readConfigHealthTrend(...)` wrapper. Pure fixtures can then cover unknown points, malformed
  payloads, exact profile absence, equal timestamps, and engine changes without initializing SQLite.

- **Persisted evidence is never recomputed**: `config_health_snapshots` already stores the historical
  `engine_version`, overall score/band, overall criterion results, and light profile score/band.
  Overall scope may project persisted criterion scores/contributions. Profile scope must exact-match
  the stored name and expose score/band only. Do not add a migration, enrich future profile snapshot
  writes in this issue, copy current profile criteria backward, derive old bands from current
  thresholds, or trim/case-fold profile names.

- **Tagged absence instead of fabricated zero**: The current sparkline blindly plots
  `overallScore`, but the engine can persist score `0` with `band='unknown'`. The canonical projector
  should produce `score: null` and `state: 'unknown'` for that row. Use `profile-missing` when the exact
  profile is absent and `not-recorded` for unusable persisted breakdowns. Criterion observations need
  their own `measured`, `not-evaluated`, and `not-recorded` states with nullable score/contribution.
  Preserve every snapshot identity even when it creates a gap.

- **Engine-aware segmentation, not cross-version deltas**: Each point must retain the stored engine
  version. Build engine-boundary metadata in canonical point order, with the first point starting the
  first segment. Geometry and summaries must break at unknown/missing/malformed points and whenever
  the engine version changes. Never calculate or narrate a delta across versions.

- **Mutable wire mappings remain in the Config Health response module**:
  `packages/praxrr-app/src/lib/server/health/responses.ts` explicitly documents that its mutable wire
  interfaces mirror OpenAPI and turn readonly engine/query arrays into plain objects. Replace the
  legacy `ConfigHealthTrendPoint`/`toTrendsResponse()` shape there with the canonical trend contract or
  a mapper from the internal result. Keep this module, `docs/api/v1/schemas/config-health.yaml`, and
  generated `components['schemas']` types in lockstep.

- **Contract-first generated artifact flow**: Modify
  `docs/api/v1/paths/config-health.yaml` and `docs/api/v1/schemas/config-health.yaml` first, with the
  path registered through `docs/api/v1/openapi.yaml`. Then run `deno task generate:api-types` for
  `packages/praxrr-app/src/lib/api/v1.d.ts` and the repository's API bundle/type generation for
  `packages/praxrr-api/openapi.json` and `packages/praxrr-api/types.ts`. Generated artifacts are not
  handwritten. Include `200`, `400`, `404`, `422`, and sanitized `500` response contracts, identical
  filters on both operations, and JSON/CSV attachment media types on export.

- **Reuse behavior, not the truncation policy, from existing exports**:
  `packages/praxrr-app/src/routes/api/v1/sync-history/export/+server.ts` and
  `packages/praxrr-app/src/routes/api/v1/timeline/export/+server.ts` establish `format=json|csv`, JSON
  defaulting, attachment responses, fixed CSV column order, nested values encoded with
  `JSON.stringify`, RFC 4180 quoting, formula neutralization, and CRLF rows. Extract their duplicated
  cell encoder into `packages/praxrr-app/src/lib/server/utils/export/csv.ts` as the third consumer.
  Keep Config Health columns and row projection local in
  `packages/praxrr-app/src/lib/server/health/trendCsv.ts`.

- **Formula neutralization precedes RFC 4180 escaping**: Existing exporters prefix an apostrophe when
  the first character matches `/^[=+\-@\t\r]/`, then quote cells containing comma, quote, CR, or LF
  and double internal quotes. Preserve this exact ordering. Emit fixed columns
  `snapshotId,generatedAt,engineVersion,scopeKind,profileName,state,score,band,criteria`, blank nullable
  cells, compact JSON in `criteria`, one row per canonical point, and `\r\n` record separators. An
  empty selection produces the header only.

- **Download headers are feature policy**: The export route should return
  `application/json; charset=utf-8` or `text/csv; charset=utf-8`, a fixed ASCII filename derived only
  from numeric instance id and a server timestamp, `Cache-Control: no-store`, and
  `X-Content-Type-Options: nosniff`. Do not put instance/profile names or an API key in a URL or
  header. JSON export returns the complete canonical envelope, not a naked array.

- **Independent detail and trend fault domains**: The existing detail page at
  `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.svelte` deliberately loads current
  health first and treats the sparkline as supplementary. Preserve that product behavior, but replace
  its silent trend `catch` with explicit trend loading/error/retry states. Use one
  `AbortController` plus a request-id guard for superseded trend filters so stale responses cannot
  replace the applied result. The current detail must remain visible on trend failure.

- **Route-local Svelte components and pure chart math**: There is no established cross-product chart
  abstraction. Create the filter, chart, and table under
  `packages/praxrr-app/src/routes/config-health/[instanceId]/components/`; keep actual-time x scaling,
  fixed `0..100` y scaling, tick selection, non-finite clamping, and segment building in pure
  `trendChart.ts`. This follows the repository's practice of keeping single-feature UI local and
  promoting only proven shared primitives.

- **Native labelled controls and applied-filter state**: Timeline's
  `packages/praxrr-app/src/routes/timeline/+page.svelte` uses a native `<label>` containing a visible
  name and `<select>`/date controls, builds one `URLSearchParams` from UI state, and derives export
  links from the same state. Follow that accessibility pattern. Separate draft custom bounds from
  the last applied result; after success, build downloads from the API's normalized absolute bounds,
  not a moving `days=30` expression.

- **Accessible SVG plus a complete semantic equivalent**: The existing sparkline's lone
  `aria-label` and `<polyline>` are insufficient. Use `<figure>` with concise visible summary and
  description, actual-time axes, direct labels, distinct shapes/dashes in addition to color, and a
  persistent selected-point panel operated by Left/Right/Home/End rather than hundreds of tab stops.
  Pair it with every canonical point in chronological semantic table/card form. Reuse
  `$ui/card/Card.svelte`, `$ui/button/Button.svelte`, `$ui/badge/Badge.svelte`, and the band mappings
  in `$ui/health/healthStatus.ts`. `Table.svelte` supports `responsive`; a feature-native table is also
  acceptable if nested criterion detail would require unsafe/custom HTML renderers.

- **Svelte escaping is the security boundary for labels**: Render instance, profile, criterion, and
  engine labels as normal Svelte text. Do not use `{@html}`, `innerHTML`, SVG `foreignObject`, or
  attacker-controlled `href`, ids, or event attributes. SVG coordinates should be derived only from
  validated finite numeric values and internal identifiers.

- **Migrated scratch-database test harness**:
  `packages/praxrr-app/src/tests/db/configHealthSnapshots.test.ts` and
  `packages/praxrr-app/src/tests/routes/configHealth.test.ts` initialize the real database under a
  unique `/tmp/praxrr-tests/...` base, run the full migration chain, and restore/close globals in
  `finally`. Extend those suites rather than inventing mocks for SQL or direct handler behavior. The
  route suite imports handlers and constructs narrowly typed fake events; maintain that pattern.

- **Query-plan assertions for index-sensitive behavior**: The snapshot tests already run
  `EXPLAIN QUERY PLAN`, assert a named index is used, and reject `USE TEMP B-TREE` for predecessor
  reads. Add comparable evidence for the bounded trend query, while also directly testing inclusive
  bounds, equal-timestamp id ordering, instance isolation, and the `cap + 1` sentinel.

- **Cross-representation parity tests**: Route tests should seed Radarr, Sonarr, and Lidarr rows,
  invoke chart JSON, JSON attachment, and CSV attachment with identical filters, and compare point
  identities/count/order after parsing. Cover exact hostile profile names, missing profiles, unknown
  bands, malformed stored arrays, engine boundaries, empty success, invalid combinations, overflow,
  attachment headers, and formula cells. The existing `config-health` alias in `scripts/test.ts`
  already includes the DB and route suites; add new pure helper test files to that alias if their
  directory is not already covered.

- **Deterministic browser fixtures for UX states**: Follow Playwright specs that intercept API calls
  and use `page.setViewportSize(...)`, rather than depending on a live scoring sweep. Add focused
  fixtures for empty, sparse, unknown, profile-missing, malformed, engine-boundary, large/dense, and
  error states; verify keyboard point navigation, visible focus, table parity, export URLs, and no
  page-level horizontal overflow at mobile width.

## Existing Code Structure

The historical storage owner is
`packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts`. It defines raw and parsed
row types, inserts append-only reports, reads predecessor/trend rows, and implements global retention.
The settings singleton and current retention values live in
`packages/praxrr-app/src/lib/server/db/queries/configHealthSettings.ts`. Health domain/wire behavior is
split across `packages/praxrr-app/src/lib/server/health/` (`service.ts`, `responses.ts`) and the shared
engine types under `packages/praxrr-app/src/lib/shared/health/`.

The existing API surface is
`packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/trends/+server.ts`, backed by
`docs/api/v1/paths/config-health.yaml` and `docs/api/v1/schemas/config-health.yaml`. It currently
accepts only positive `days`, returns `generatedAt/overallScore/band`, reports the current engine
version at the top level, and omits trend tests. This route should be upgraded in place; export is a
new nested sibling.

The browser surface is
`packages/praxrr-app/src/routes/config-health/[instanceId]/+page.svelte`. It has current-detail fetch
and stale-request guards, current health cards, and a fixed 30-day equal-spacing SVG sparkline. Its
server load currently validates only the path id; it should be expanded using the safe instance-option
shape from `packages/praxrr-app/src/routes/config-health/+page.server.ts`.

The best adjacent implementation references are:

- `packages/praxrr-app/src/lib/server/timeline/filters.ts` and `service.ts` for parser/service
  boundaries and typed client errors.
- `packages/praxrr-app/src/routes/api/v1/timeline/export/+server.ts` and
  `packages/praxrr-app/src/routes/api/v1/sync-history/export/+server.ts` for attachment/CSV behavior.
- `packages/praxrr-app/src/routes/timeline/+page.svelte` for labelled native filters, one query
  serializer, supplementary fetch state, and export link construction.
- `packages/praxrr-app/src/lib/client/ui/table/Table.svelte` for the repository's responsive desktop
  table/mobile card behavior.
- `packages/praxrr-app/src/tests/db/configHealthSnapshots.test.ts` and
  `packages/praxrr-app/src/tests/routes/configHealth.test.ts` for real-migration and direct-route test
  harnesses.

## Code Conventions

- TypeScript uses repository aliases (`$db`, `$server`, `$shared`, `$ui`, `$logger`) and explicit
  `.ts` suffixes. Keep imports type-only where applicable.
- Use camelCase in application/wire types and snake_case only for raw database row interfaces.
- Use interfaces for stable response/data shapes, readonly inputs where mutation is unnecessary, and
  plain mutable arrays at the generated OpenAPI boundary.
- Keep functions small and named by responsibility: parse/normalize filters, search rows, project a
  canonical result, serialize CSV, and compute geometry should be separate pure seams.
- SQL is static and multiline with `?` parameters; user input is never interpolated into identifiers,
  JSON paths, order clauses, or limits.
- Comments explain invariants and non-obvious safety choices (append order, index usage, evidence
  gaps), not routine syntax.
- Errors returned to clients are concise `{ error: string }`; unexpected exception details may be
  logged, but trend logs should remain bounded to instance id, normalized range shape, result count,
  duration/status, and overflow. Do not log profile/criterion contents or full stored JSON.
- Svelte 5 code follows the project rule of no runes. The repository currently uses legacy
  `on:click`; new project guidance prefers `onclick`, so implementation should follow the effective
  formatter/type-check convention selected for surrounding edited code and avoid introducing runes.
- Styling uses Tailwind utility classes, existing neutral/accent/dark-mode tokens, route-local layout,
  and shared UI primitives. New chart meaning must never rely on color classes alone.
- Formatting is tabs, single quotes, no trailing commas, 100-character print width as enforced by
  repository Prettier. Run `deno task format:plans` for this planning directory and scoped formatting
  for implementation files.
- Tests use descriptive `Deno.test` names, `@std/assert`, explicit edge-case fixtures, and cleanup in
  `finally`. Database behavior is tested against migrations; pure transformations are tested without
  the database.

## Integration Points

### Create

- `packages/praxrr-app/src/lib/server/health/trendFilters.ts`: strict shared trend filter parser,
  normalized absolute bounds, typed validation error, injected clock.
- `packages/praxrr-app/src/lib/server/health/trends.ts`: canonical read service plus pure projector,
  evidence states, counts, retention context, engine boundaries, 10,000-point exact cap.
- `packages/praxrr-app/src/lib/server/health/trendCsv.ts`: fixed one-point-per-row CSV projection of the
  canonical result.
- `packages/praxrr-app/src/lib/server/utils/export/csv.ts`: low-level formula-safe RFC 4180 cell
  escaping shared by Config Health, Sync History, and Timeline.
- `packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/trends/export/+server.ts`: JSON/CSV
  attachment handler using the same parser/service as the JSON trend route.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/TrendFilters.svelte`: labelled
  instance/scope/range controls with draft versus applied state.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/HealthTrendChart.svelte`:
  accessible dependency-free SVG, summary, boundary/gap encodings, keyboard selection.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/HealthTrendTable.svelte`:
  complete chronological semantic alternative and mobile presentation.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/trendChart.ts`: pure time scale,
  score scale, ticks, path segmentation, and finite-coordinate guards.
- Focused pure tests for trend filters, projector/CSV, and chart geometry under the existing Config
  Health test tree; add a Playwright Config Health trends spec in the repository's E2E spec location.

### Modify

- `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts`: add evidence-aware bounded
  query, direct ISO bounds, `limit + 1`, stable `generated_at ASC, id ASC` ordering.
- `packages/praxrr-app/src/lib/server/health/responses.ts`: replace the sparkline wire shape with the
  full OpenAPI-aligned canonical trend types/mapping.
- `packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/trends/+server.ts`: delegate filters
  and result building to shared modules; map `400/404/422/500` consistently.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.server.ts`: include safe enabled
  sync-capable instance picker options while retaining strict path validation.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.svelte`: replace the fixed sparkline,
  own trend request/applied state, keep current detail independent, render new components and exports.
- `packages/praxrr-app/src/routes/api/v1/sync-history/export/+server.ts` and
  `packages/praxrr-app/src/routes/api/v1/timeline/export/+server.ts`: import the extracted CSV cell
  helper without changing their existing row schemas or behavior.
- `docs/api/v1/paths/config-health.yaml`, `docs/api/v1/schemas/config-health.yaml`, and
  `docs/api/v1/openapi.yaml`: define expanded trend/export contracts and references.
- `packages/praxrr-app/src/lib/api/v1.d.ts`, `packages/praxrr-api/openapi.json`, and
  `packages/praxrr-api/types.ts`: regenerate from the portable contract.
- `packages/praxrr-app/src/tests/db/configHealthSnapshots.test.ts`: bounds, ties, cap sentinel, parsing,
  isolation, and index plan.
- `packages/praxrr-app/src/tests/routes/configHealth.test.ts`: trend/export handler coverage and exact
  JSON/CSV/table-contract parity cases.
- `scripts/test.ts`: only if newly created pure test files are outside paths already included by the
  `config-health` alias.
- `ROADMAP.md`: record issue #226 behavior and status without claiming merge before it occurs.

### Do Not Modify

- No database migration, new table/column, retention policy change, snapshot backfill, chart
  dependency, shared generic chart framework, or cross-Arr fallback is required.
- Do not enrich `SnapshotProfileScore` with criteria for this issue; retained rows cannot provide the
  same evidence and the final feature specification explicitly limits profile scope to score/band.

## Gotchas and Warnings

- `getTrend(instanceId, days?)` uses `datetime(generated_at)` in predicates/order. It is legacy
  sparkline behavior and can defeat the compound index; do not reuse it as the canonical query.
- Existing `parseJsonArray()` collapses malformed JSON, a non-array value, and an actual empty array
  to the same `[]`. Trend evidence needs a status-bearing parser or raw parse metadata to distinguish
  `not-recorded` from a valid empty criterion set.
- Stored `overall_score=0` is not necessarily measured zero. If `band='unknown'`, wire score must be
  `null` and charts must break.
- The global `retention_max_entries` cap is fleet-wide. The earliest row for one instance does not
  prove when or why older rows were removed; copy must say earlier data _may_ have been pruned.
- `engineVersion` in the current trends response is the current engine version, not the version of
  each retained point. Preserve per-row `engine_version` and never compare across a transition.
- Profile identity is an exact stored name. Trimming, case folding, fuzzy matching, or treating a
  rename as one identity would violate persisted sync-key semantics.
- A selected profile missing at one timestamp must remain a canonical gap point. Filtering it out
  before geometry would falsely connect measurements across an absence.
- Sync History and Timeline cap at exactly 50,000 and only log that results were truncated. That is
  explicitly unsuitable here: query 10,001 and fail the entire result with `422`.
- Existing exporters duplicate their CSV helper and omit `no-store`/`nosniff`. Extract the helper,
  but add the stronger headers only where specified; avoid unrelated behavior changes unless tests
  intentionally cover them.
- Formula neutralization changes literal spreadsheet-oriented CSV values. JSON remains the lossless
  automation format; tests should compare CSV point identity/order and expected escaped values, not
  assume hostile strings round-trip without the protective apostrophe.
- Relative `days` is moving state. Once the UI receives normalized absolute bounds, downloads must use
  those bounds or the later export can contain a different dataset.
- Do not use the generic `Table.svelte` HTML renderer for hostile persisted labels: it supports
  `{@html}` for some callers. Either pass labels through ordinary Svelte slots/text or build the
  route-local semantic table directly.
- Equal timestamps require `snapshotId` as the secondary order in SQL, JSON, CSV, chart/table, and
  parity assertions. Sorting only by timestamp is insufficient.
- A single measured point is a marker and explicit sparse state, not a horizontal trend line. The
  current sparkline duplicates a single point across the full width; remove that behavior.
- Actual timestamps determine x position. The current equal-step polyline falsely implies regular
  cadence and must not be adapted for the new chart.
- Keep essential information out of hover-only tooltips. Keyboard/touch inspection and the semantic
  table must expose every point and state.
- The protected `/api/v1/config-health/**` hierarchy inherits global auth. Do not relocate export to a
  public subtree, add wildcard CORS, or put `X-Api-Key` in browser download URLs.
- `graphify query` could not inspect this worktree because `graphify-out/graph.json` is absent here.
  Implementation closeout should run `graphify update .` from a checkout/worktree where the graph is
  initialized, then verify the expected graph artifacts without treating pre-existing graph dirt as
  a blocker.
