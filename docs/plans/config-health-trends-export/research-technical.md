# Technical Research: Config Health Trends and Export

## Executive Summary

Issue #226 should extend the existing per-instance Config Health trend surface rather than create an analytics store. `config_health_snapshots` already contains the authoritative overall score, band, engine version, timestamp, overall criterion results, and light per-profile scores. The implementation should add a shared filter/query/projection service used by both the JSON chart endpoint and a new JSON/CSV export endpoint, with the stable order `generated_at ASC, id ASC` and no downsampling or silent truncation.

No SQL migration is required. Overall criterion history is already durable. To make profile-selected criterion charts progressively useful, future snapshot writes should enrich the existing `profile_scores` JSON objects with a compact criterion breakdown; old light objects remain valid and are returned with an explicit `not-recorded` state. This preserves old snapshots, avoids a backfill that cannot reconstruct historical facts, and keeps the one existing snapshot table as the source of truth.

The detail page remains `/config-health/[instanceId]`. It gains URL-driven time/profile filters, an instance selector, explicit loading/empty/sparse/unknown states, accessible dependency-free SVG charts, a tabular alternative, retention context, engine-version boundary markers, and export links built from the exact normalized filter bounds returned by the chart API.

## Current-State Findings

- `config_health_snapshots` is append-only and already stores `arr_instance_id`, denormalized instance identity, `engine_version`, `overall_score`, `band`, `criteria_scores`, `profile_scores`, and `generated_at`.
- `criteria_scores` contains full overall `CriterionResult` objects. `profile_scores` currently contains only `{ name, score, band }`, even though the live `HealthReport` has per-profile criteria.
- `configHealthSnapshotsQueries.getTrend(instanceId, days?)` returns oldest to newest but uses SQLite `datetime(...)` around `generated_at`; that prevents the generated-at index from being used efficiently for range bounds.
- `GET /api/v1/config-health/{instanceId}/trends?days=N` currently emits only `generatedAt`, `overallScore`, and `band`. Its top-level engine version is the current engine version, so it cannot reveal version changes within retained history.
- `/config-health/[instanceId]` fetches live detail and a fixed 30-day trend client-side and draws one fixed-height polyline. Trend failure is silently ignored and zero/single-point histories have no explicit state.
- Retention is configured globally by age and total-row cap. The cap is global across instances, so the API must not claim that an observed first point was definitely deleted by retention.
- Existing sync-history and timeline export routes establish repository conventions: separate `/export`, `format=json|csv`, attachment headers, RFC 4180 quoting, spreadsheet-formula neutralization, and shared filters between list and export.
- All non-public routes are protected by the existing SvelteKit auth hook; Config Health should not add a second authorization mechanism.

## Architecture Design

### Component and Data Flow

```text
config-health.snapshot job
  -> scoreInstance()
  -> configHealthSnapshotsQueries.insert()
     - existing overall criteria JSON
     - enriched compact per-profile criteria JSON (forward-only)

/config-health/[instanceId]
  -> +page.server.ts: selected id + enabled sync-capable instance options
  -> +page.svelte: URL/filter state and request cancellation
     -> GET /api/v1/config-health/{id}/trends?... (JSON)
        -> parseConfigHealthTrendQuery(url, requestNow)
        -> configHealthTrendService.read(instanceId, normalizedFilter)
           -> validate active sync-capable instance
           -> settings query for retention metadata
           -> bounded, parameterized snapshot query
           -> scope projection + availability states + boundaries
        -> toConfigHealthTrendsResponse()
     -> route-local chart/table components
     -> /trends/export links built from response.normalizedFilter

/api/v1/config-health/{id}/trends/export?format=json|csv&...
  -> same parser and service (not a copied query)
  -> JSON: same response contract as chart API
  -> CSV: one deterministic row per response point; nested criteria JSON-encoded
```

### Service Boundaries

1. **Filter parser**: pure normalization and validation. It accepts the request URL plus an injected `now` so tests and relative-day windows are deterministic.
2. **Snapshot query**: returns stored rows only. It owns SQL filtering and ordering, not wire semantics.
3. **Trend service/projector**: selects instance or exact profile scope, distinguishes unknown from missing/not-recorded data, computes observed engine boundaries/profile options, and attaches retention configuration.
4. **Response mapper**: converts readonly internal objects into OpenAPI wire types.
5. **CSV serializer**: serializes the canonical response points. It never re-queries, re-sorts, or applies filters.
6. **Chart geometry helper**: pure functions for axes, discontinuous segments, markers, and tick selection; the Svelte component owns presentation and accessibility only.

This split prevents the three high-risk divergence modes: UI versus export filters, JSON versus CSV ordering, and chart rendering that treats absent data as zero.

## Data Models

### SQL Schema Recommendation

**Recommendation: no new table, column, index, or migration.** The existing table and indexes are sufficient for retained history. Query ISO UTC strings lexically rather than wrapping the indexed column:

```sql
SELECT *
FROM config_health_snapshots
WHERE arr_instance_id = ?
  AND generated_at >= ?
  AND generated_at <= ?
ORDER BY generated_at ASC, id ASC
LIMIT ?;
```

Every producer writes `generated_at` via `toISOString()`/the health engine input contract, so lexical ordering matches chronological ordering. Keep the `id` tiebreak because a sweep or test can produce equal timestamps. Fetch `MAX_TREND_POINTS + 1`; if the extra row exists, return 422 asking the caller to narrow the range. Never return a silently incomplete series. The default UI request is only 30 days and the default retention cap is 5,000 rows globally, so normal responses remain small.

Do not add an index until query-plan/performance evidence requires it. Existing `idx_config_health_snapshots_instance(arr_instance_id, generated_at DESC)` can scan an instance/range in reverse index order; the retained set is already bounded. If production evidence later shows a temporary tiebreak sort is material, a follow-up may replace it with `(arr_instance_id, generated_at DESC, id DESC)`.

### Forward-Compatible Profile JSON

Keep the `profile_scores` column. Evolve each JSON array member from the current light form to this optional enriched form:

```ts
interface SnapshotProfileScore {
  name: string;
  score: number;
  band: HealthBand;
  criteria?: SnapshotTrendCriterion[]; // absent on pre-#226 rows
}

interface SnapshotTrendCriterion {
  id: CriterionId;
  label: string;
  score: number | null;
  weight: number;
  contribution: number;
}
```

`insert(report)` writes `criteria` for new profile entries by projecting `report.profiles[].criteria`. Do not persist detail/suggestion text a second time; it is not needed by charts and would inflate every snapshot. `rowToDetail` treats a missing/malformed `criteria` member as unavailable, not as an empty measured breakdown. Do not backfill old rows or recompute them from current configuration.

### Internal Query Model

```ts
interface ConfigHealthTrendFilter {
  from?: string; // normalized inclusive ISO instant
  to?: string; // normalized inclusive ISO instant
  days?: number; // input-only relative preset, normalized before query
  profile?: string; // exact persisted name; never trim/rewrite
}

type TrendPointState = 'measured' | 'unknown' | 'profile-missing';
type TrendCriterionState = 'measured' | 'not-evaluated' | 'not-recorded';
```

- `days` must be an integer from 1 through 3650 and cannot be combined with `from` or `to`.
- `from`/`to` accept the repository's strict date-only or ISO datetime syntax. Date-only bounds expand inclusively using the shared `parseDateBound` behavior.
- Reject `from > to`.
- With `days`, capture one `requestNow`, set `to=requestNow`, and derive `from` exactly from it. With custom bounds, omitted `to` becomes `requestNow`; omitted `from` is unbounded. With no time params, preserve the current endpoint's all-retained-history behavior. The UI explicitly sends `days=30` initially.
- `profile` is decoded once and compared with exact string equality in application code. Reject an empty value, but do not trim, case-fold, or normalize it; profile names are persisted sync lookup keys.
- Instance filtering remains the required path parameter. The UI's instance selector navigates to a different instance path rather than introducing a fleet-shaped trend response.

## API Design

### Endpoints

#### `GET /api/v1/config-health/{instanceId}/trends`

Query parameters:

| Parameter | Type           | Rules                                                 |
| --------- | -------------- | ----------------------------------------------------- |
| `days`    | integer        | Optional, 1–3650; mutually exclusive with `from`/`to` |
| `from`    | date/date-time | Optional inclusive lower bound                        |
| `to`      | date/date-time | Optional inclusive upper bound                        |
| `profile` | string         | Optional exact profile name; empty is invalid         |

Response status:

- `200`: including zero points or a profile with no measured points.
- `400`: malformed id/filter, contradictory range, or `from > to`.
- `404`: active instance missing or not sync-capable, preserving current semantics.
- `422`: matched history exceeds the safe exact-series cap; no partial points returned.
- `500`: sanitized internal read failure.

Proposed response:

```json
{
  "instance": { "id": 12, "name": "Living Room Sonarr", "arrType": "sonarr" },
  "currentEngineVersion": "2",
  "normalizedFilter": {
    "from": "2026-06-10T12:00:00.000Z",
    "to": "2026-07-10T12:00:00.000Z",
    "profile": "WEB-1080p"
  },
  "retention": {
    "days": 90,
    "maxEntries": 5000,
    "ageCutoffAt": "2026-04-11T12:00:00.000Z",
    "oldestAvailableAt": "2026-06-12T00:00:00.000Z",
    "newestAvailableAt": "2026-07-10T06:00:00.000Z"
  },
  "availableProfiles": ["HD-720p", "WEB-1080p"],
  "counts": { "points": 3, "measured": 1, "unknown": 1, "missing": 1 },
  "engineBoundaries": [
    {
      "engineVersion": "1",
      "startsAt": "2026-06-12T00:00:00.000Z",
      "pointIndex": 0
    },
    {
      "engineVersion": "2",
      "startsAt": "2026-07-01T00:00:00.000Z",
      "pointIndex": 2
    }
  ],
  "points": [
    {
      "snapshotId": 301,
      "generatedAt": "2026-06-12T00:00:00.000Z",
      "engineVersion": "1",
      "state": "measured",
      "score": 76,
      "band": "attention",
      "criteria": [
        {
          "id": "completeness",
          "label": "Completeness",
          "state": "not-recorded",
          "score": null,
          "weight": null,
          "contribution": null
        }
      ]
    },
    {
      "snapshotId": 302,
      "generatedAt": "2026-06-18T00:00:00.000Z",
      "engineVersion": "1",
      "state": "profile-missing",
      "score": null,
      "band": null,
      "criteria": []
    },
    {
      "snapshotId": 330,
      "generatedAt": "2026-07-01T00:00:00.000Z",
      "engineVersion": "2",
      "state": "unknown",
      "score": null,
      "band": "unknown",
      "criteria": [
        {
          "id": "drift",
          "label": "Drift",
          "state": "not-evaluated",
          "score": null,
          "weight": 30,
          "contribution": null
        }
      ]
    }
  ]
}
```

Important mapping rules:

- Stored `score=0, band='unknown'` maps to wire `score=null`; zero must never imply a measurement.
- A profile absent from one snapshot still produces a point at that timestamp with `profile-missing`, `score=null`, and `band=null`. Keeping the timestamp preserves the visible gap instead of joining adjacent measurements.
- A skipped criterion maps to `not-evaluated` with nullable contribution on the trend wire contract, even though the scoring engine internally contributes zero.
- Old profile snapshots without criterion payload map criteria to `not-recorded`; do not manufacture criterion zeroes.
- Overall scope always uses stored `criteria_scores`. Malformed legacy JSON is `not-recorded` and logged as a bounded warning, not converted to measured empty criteria.

#### `GET /api/v1/config-health/{instanceId}/trends/export`

Accepts the exact same filter parameters plus `format=json|csv` (default `json`). Follow repository precedent rather than relying on `Accept`, because download anchors cannot consistently negotiate and existing public contracts use the explicit format query. OpenAPI declares both `application/json` and `text/csv` response media types.

- The export handler calls the same parser and trend service as the chart endpoint.
- JSON is the same response envelope and point order as `/trends`; it is returned as an attachment.
- CSV is one row per canonical point in that same order. Fixed columns are:

```text
snapshotId,generatedAt,engineVersion,scopeKind,profileName,state,score,band,criteria
```

`criteria` is the exact compact criterion array encoded as JSON in one RFC 4180 cell. This avoids unstable columns when engine versions add criteria and gives one CSV row per API point. Empty data returns the header only. Null is an empty cell; measured numeric zero remains `0`.

Headers:

```text
Content-Type: application/json
Content-Disposition: attachment; filename="config-health-12-2026-07-10T12-00-00.000Z.json"
Cache-Control: no-store
```

or `text/csv; charset=utf-8` and `.csv`. Filenames use only the numeric instance id and server timestamp, never the externally influenced instance/profile name. CSV escaping must neutralize leading `=`, `+`, `-`, `@`, tab, or carriage return before standard quote/comma/newline escaping.

### Exact UI/Export Parity

Relative `days` requests are normalized into absolute `from`/`to` in the JSON response. After loading, the page builds both export URLs from `response.normalizedFilter`, not its original relative query. Thus a later download cannot acquire a newly inserted point or lose a point as the wall clock advances. The canonical service owns filtering, projection, availability states, and ordering, while the CSV serializer only serializes returned points. Tests must compare parsed JSON export points and parsed CSV row keys against the chart response for the same normalized filter.

### OpenAPI and Generated Artifacts

Contract-first order:

1. Update `docs/api/v1/paths/config-health.yaml` with new parameters, 422, and `trendsExport`.
2. Update `docs/api/v1/schemas/config-health.yaml` with filter, retention, counts, boundary, criterion, point, instance, and response schemas. Use nullable unions for score/band/contribution.
3. Register `/config-health/{instanceId}/trends/export` and schemas in `docs/api/v1/openapi.yaml`.
4. Run `deno task generate:api-types`.
5. Run `deno task bundle:api` so `packages/praxrr-api/openapi.json` and `packages/praxrr-api/types.ts` stay in lockstep.
6. Route response expressions must `satisfies components['schemas'][...]`.

## UI and Chart Design

### Page Structure

- Extend `+page.server.ts` to return enabled sync-capable instance options `{id,name,type}` in addition to the validated selected id. Do not expose URLs or API keys.
- Keep live detail and historical trend requests independent. Refresh triggers both; a trend failure shows an inline retry state while preserving live detail.
- URL state uses `days`, `from`, `to`, and `profile`; changing instance navigates to the corresponding path. Initial range is 30 days. Presets: 7 days, 30 days, 90 days, all retained, and custom.
- Profile options come from `availableProfiles`; "Whole instance" omits `profile`. Preserve exact names in URL encoding and API queries.
- Export buttons are disabled until a successful trend response supplies normalized filters.

### Route-Local Components

Create components under `packages/praxrr-app/src/routes/config-health/[instanceId]/components/` because this is their first and only consumer:

- `TrendFilters.svelte`: instance, time range, custom date bounds, and profile controls; stacks to one column on mobile.
- `HealthScoreTrendChart.svelte`: score line, band encoding, unknown/missing markers, and engine boundaries.
- `HealthCriterionTrendChart.svelte`: selectable criterion lines using stable patterns/markers; gaps for `not-evaluated`/`not-recorded`.
- `HealthTrendTable.svelte`: accessible chronological table with timestamp, engine, state, score, band, and criterion values.
- `trendChart.ts`: pure segment/scale/tick/label helpers, with no DOM access.

Use a dependency-free SVG rather than adding a chart library. The data model is small, the existing UI already uses SVG, and a library would add bundle/security cost without solving the domain-specific gap/version/retention semantics.

### Rendering Rules

- Never connect a line through `unknown`, `profile-missing`, `not-evaluated`, or `not-recorded`. Build contiguous measured segments.
- A single measured point is a marker, not a horizontal line implying duration.
- Bands use both color and marker/text: healthy circle, attention triangle, needs-review square, unknown hollow diamond. The legend names every encoding.
- Criterion series combine label, marker shape, and dash pattern; color is supplementary.
- Engine boundaries are dashed vertical rules labeled `Engine vN`; suppress duplicate consecutive labels.
- Show the retention notice as configured policy: "History retained for up to 90 days and 5,000 snapshots across all instances; earliest available here is …" Never claim the first point proves pruning occurred.
- On narrow screens, controls stack, summary cards wrap, the chart retains a readable minimum plotting width inside an explicitly labeled horizontal scroller, and the table is available below it. Reduce x-axis ticks based on measured width (via a small `ResizeObserver`) rather than allowing labels to overlap.
- Loading uses a reserved-height skeleton/status with `aria-live="polite"`; do not clear old data during a refresh. Announce completion/error without moving focus.

### Explicit States

| State                        | Trigger                                                | Presentation                                                                       |
| ---------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Loading                      | Initial trend request                                  | Reserved chart skeleton + "Loading trend history" live status                      |
| Refreshing                   | Existing data, new request                             | Keep chart, mark busy, spin refresh icon                                           |
| Empty history                | `points=0`, no profile filter                          | Empty state explaining snapshots are created by the scheduled/on-demand health job |
| Filtered empty               | Time range has no points                               | "No snapshots in this range" plus clear/expand-range action                        |
| Sparse                       | One measured point or fewer than two comparable points | Marker/table only and "Not enough points to show a trend"                          |
| Unknown                      | Snapshot band unknown                                  | Hollow diamond, dash for score, `Unknown` text; never plot at zero                 |
| Profile missing              | Profile absent at a timestamp                          | Visible gap and `Profile not present` table state                                  |
| Legacy breakdown unavailable | Old profile point lacks criteria                       | Score remains visible; criterion chart gap labeled "Breakdown not recorded"        |
| Trend error                  | Supplementary API failure                              | Inline retry; live detail remains visible                                          |

## Codebase Changes

### Create

- `packages/praxrr-app/src/lib/server/health/trendFilters.ts` — shared parser, normalized bounds, typed 400 error.
- `packages/praxrr-app/src/lib/server/health/trends.ts` — canonical projection/service, cap enforcement, metadata/boundaries.
- `packages/praxrr-app/src/lib/server/health/trendCsv.ts` — fixed columns, RFC 4180/formula-safe serializer.
- `packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/trends/export/+server.ts` — attachment route.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/TrendFilters.svelte`.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/HealthScoreTrendChart.svelte`.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/HealthCriterionTrendChart.svelte`.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/HealthTrendTable.svelte`.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/trendChart.ts`.
- `packages/praxrr-app/src/tests/shared/health/trendChart.test.ts` (or route helper test path matching final placement).
- `packages/praxrr-app/src/tests/e2e/specs/6.1-config-health-trends.spec.ts` using deterministic API interception/fixtures for empty, sparse, unknown, and multi-engine histories.

### Modify

- `docs/api/v1/openapi.yaml`.
- `docs/api/v1/paths/config-health.yaml`.
- `docs/api/v1/schemas/config-health.yaml`.
- `packages/praxrr-app/src/lib/api/v1.d.ts` (generated).
- `packages/praxrr-api/openapi.json` and `packages/praxrr-api/types.ts` (bundled/generated).
- `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts` — bounded absolute-range query, optional enriched profile criteria parsing, deterministic order.
- `packages/praxrr-app/src/lib/server/health/responses.ts` — expanded OpenAPI-aligned wire types/mappers, or move trend-specific wire code to `trends.ts` and re-export.
- `packages/praxrr-app/src/lib/server/jobs/handlers/configHealthSnapshot.ts` only if insertion projection is kept outside the query module; otherwise `insert(report)` enrichment is sufficient.
- `packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/trends/+server.ts` — shared parser/service and full response.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.server.ts` — safe instance options.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.svelte` — filters, charts, states, export, request cancellation.
- `packages/praxrr-app/src/tests/db/configHealthSnapshots.test.ts` — bounds, order, legacy/enriched profile parsing.
- `packages/praxrr-app/src/tests/routes/configHealth.test.ts` — trend and export contracts/parity.
- `scripts/test.ts` only if a new test file lies outside the current `config-health` alias coverage.
- `ROADMAP.md` — mark #226 implemented/shipped using the final PR status and summarize contract/export/accessibility behavior.

No new runtime dependency is required.

## Test Strategy

### Database and Service Tests

- Exact instance scoping across Radarr, Sonarr, and Lidarr; no sibling-app fallback.
- Inclusive absolute bounds and relative-day normalization using an injected clock.
- Stable `generated_at ASC, id ASC` order, including identical timestamps and scrambled inserts.
- Exact profile name matching, including case differences, spaces, commas, quotes, and formula-prefix characters.
- Profile appearance/disappearance emits gaps rather than dropping/reordering timestamps.
- Old light profile JSON, new enriched profile JSON, malformed arrays, skipped criteria, and unknown bands map to the correct explicit states.
- Engine boundaries are emitted only on actual consecutive-version transitions.
- Retention metadata reflects settings and observed bounds without asserting deletion.
- Cap+1 fails atomically with 422; no truncated response is returned.

### Route and Contract Tests

- Existing invalid/unknown instance cases plus every invalid days/from/to/profile combination.
- Empty response is 200 with zero counts and retention metadata.
- JSON route and JSON export are deep-equal for the same normalized filter.
- CSV row keys and order match `points` exactly; criteria cell JSON deep-equals the point criteria.
- CSV header-only empty export, null cells, CRLF, embedded commas/quotes/newlines, and formula-injection neutralization.
- Correct content type, attachment filename, `no-store`, 400/404/422/500 behavior.
- Generated types compile and route payloads satisfy the OpenAPI schema.

### Chart Helper and Accessibility Tests

- Scale clamps 0–100, equal timestamps do not produce NaN, one point remains a marker, and empty input produces no path.
- Segment builder breaks on all unknown/missing/not-recorded states and engine boundaries remain positioned correctly.
- Tick selection limits labels for mobile widths.
- Playwright at desktop and mobile viewports verifies no control/legend overlap, horizontal chart containment, export href parity, keyboard-reachable filters, named SVG/title/description, non-color legend text, state messages, and the tabular alternative.
- Run manual checks from the issue for empty, sparse, multi-criterion, multi-engine, and retained histories at desktop/mobile widths.

### Required Validation

```bash
deno task generate:api-types
deno task bundle:api
deno task test config-health
deno task check
deno task lint
deno task test:e2e
git diff --check
graphify update .
```

If the full existing E2E suite is environmentally blocked, the PR must show the exact blocker plus passing targeted Config Health Playwright coverage; it must not silently claim the issue test plan passed.

## System Constraints

### Performance and Scalability

- Default 30-day/6-hour cadence is about 120 points per instance; render all points without aggregation.
- Never interpolate/downsample server-side because exports and charts must represent identical facts.
- Reject overly broad exact requests instead of truncating. The caller can narrow the range.
- Parse profile JSON once per row and project only compact trend fields; do not return stored suggestions/details.
- Abort superseded browser requests with `AbortController` and retain request-id protection to prevent stale responses overwriting new filters.

### Security and Privacy

- Rely on the existing global auth/session/API-key middleware; endpoint remains non-public.
- Bind every SQL value. Never build profile names or dates into SQL.
- Do not expose Arr URL, API key, or credential-derived fields in page data, API metadata, logs, or filenames.
- Log numeric instance id, filter shape, row count, and sanitized errors; do not log arbitrary profile names unless redacted/bounded.
- Protect CSV consumers from formula execution and prevent header injection by using a fixed safe filename.
- Use `Cache-Control: no-store` for health exports; they describe deployment configuration posture.

### Compatibility and Semantics

- The path-selected instance is explicitly validated as Radarr/Sonarr/Lidarr; no cross-Arr profile inference occurs.
- Historical profile names are exact persisted identifiers. Do not trim or case-fold them.
- Engine versions are data boundaries, not comparable-series guarantees. Charts may show adjacent points but must mark the boundary and avoid claims that a score change across it reflects configuration change.
- Retention count is global, not per instance. Wording and metadata must preserve that fact.
- Profile criterion enrichment changes only future JSON stored in the existing column; it does not alter engine scoring, so it does not by itself require an engine-version bump. The wire contract explicitly detects absence.

## Technical Decisions

| Decision                    | Options                                                                  | Recommendation and Rationale                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Storage                     | New analytics table; new columns; existing snapshots                     | Existing snapshots only. They already hold authoritative facts; profile JSON can evolve compatibly.                                        |
| Historical profile criteria | Backfill/recompute; omit forever; forward enrichment                     | Forward enrichment with explicit `not-recorded` for old rows. Lost historical inputs cannot be truthfully reconstructed.                   |
| API scope                   | Fleet endpoint; per-instance path                                        | Keep per-instance path and optional exact profile. It matches current routing and avoids cross-instance mixed cadence/retention semantics. |
| Export path                 | Accept negotiation on `/trends`; query format; separate export route     | Separate `/trends/export?format=` matching repo convention, while OpenAPI declares both media types.                                       |
| CSV shape                   | Dynamic criterion columns; long-form duplicated rows; criteria JSON cell | One row per API point with ordered criteria JSON. Stable across engine versions and exact point parity.                                    |
| Large ranges                | Silent cap/downsample; pagination; hard fail                             | Cap+1 and 422. Pagination/downsampling would make chart/export parity and gap interpretation harder.                                       |
| Chart dependency            | Add chart library; custom SVG                                            | Small custom SVG + pure geometry helper. No dependency, exact gap/version semantics, accessible table fallback.                            |
| Unknown score               | Plot stored zero; omit snapshot; nullable score                          | Nullable score plus explicit state. This preserves time evidence without implying a measured zero.                                         |

## Open Questions

1. Does product require per-profile criterion history immediately, or is overall criterion history plus profile score/band sufficient? This design supports the stronger interpretation forward-only and makes old limitations explicit.
2. Should `days` remain the only preset wire parameter for backward compatibility, or may the v2 contract replace it with a `range` enum? Keeping `days` is the lower-risk implementation and is recommended.
3. What exact point cap should ship (recommended 10,000)? It should be identical for chart JSON and both exports and documented in the 422 response.
4. Should deleted-instance history become browsable? The existing route deliberately returns 404 once the active instance is gone. Supporting orphan history needs a separate stable snapshot-history identity and is outside issue #226.
5. Should profile options be the union within the selected range or all retained history? Recommend all retained history for selector stability, while the selected time range controls points/counts.
6. Is a full-suite Config Health Playwright fixture acceptable through request interception, or should the E2E reset seed durable snapshot rows? Interception is faster and deterministic for responsive/accessibility states; one real route test should continue to prove database-to-wire behavior.
