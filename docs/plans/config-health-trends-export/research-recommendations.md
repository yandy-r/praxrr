# Recommendations: Config Health Trends and Export

## Executive Summary

Implement issue #226 as an expansion of the existing per-instance Config Health detail route, not as
a separate analytics subsystem. The authoritative dataset remains
`config_health_snapshots`; a single server-side filter/query/projection pipeline should produce one
canonical, deterministically ordered trend response that is consumed by the chart, accessible table,
JSON export, and CSV serializer. This is the central correctness decision: the UI and exports must not
independently filter, sort, normalize unknown values, or reconstruct historical facts.

The recommended first release supports one active sync-capable instance and one scope at a time:
`overall` or an exact historical profile name. Overall scope shows score, persisted band, and persisted
criterion score/contribution history. Profile scope shows only the score and band that existing
snapshots can prove. Existing snapshots do not contain per-profile criterion history, so #226 should
state that the breakdown was not recorded rather than infer it from current configuration or from the
instance-wide result. Enriching future snapshot payloads with profile criteria is a valid follow-up,
but it is not required to satisfy the issue and would create a permanently mixed historical contract.

Use a small route-local Svelte/SVG chart plus pure geometry helpers and a semantic table. Do not add a
chart dependency. Lines must break for unknown measurements, absent profiles, sampling gaps, and
engine-version changes; a single point remains a marker, not a trend. Time is scaled from actual
timestamps. Non-color encodings, text summaries, keyboard/touch inspection, and responsive layouts are
part of the feature contract rather than polish.

The implementation should proceed contract-first and in dependency order: settle the evidence model
and CSV shape; update OpenAPI/generated artifacts; build shared parsing/query/projection/serialization;
add route tests; then build the UI and end-to-end coverage. Security hard stops are authenticated route
inheritance and fixed, parameterized SQL. Warning-level release gates include bounded exact results,
formula-safe CSV, no-store download headers, hostile-label-safe rendering, and API/export parity.

## Implementation Recommendations

### Recommended Approach

#### 1. Keep one source of historical truth

- Read only persisted rows from `config_health_snapshots` through
  `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts`.
- Do not add an analytics table, recompute old scores, infer missing points, backfill profiles from the
  live report, or change retention behavior.
- Preserve stored `generated_at`, `engine_version`, band, score, criterion results, instance identity,
  and profile names. Treat `created_at` as bookkeeping only.
- Preserve the total order `generated_at ASC, id ASC`, including equal timestamps. The API owns the
  order; no UI or exporter applies a second sort.
- Compare canonical ISO UTC values directly so the existing
  `(arr_instance_id, generated_at DESC)` index can serve range predicates. Avoid wrapping the indexed
  column in `datetime(...)` in the trend query.

#### 2. Create one canonical trend service

Create focused server modules under `packages/praxrr-app/src/lib/server/health/`:

- `trendFilters.ts`: parse and normalize `days`, `from`, `to`, and exact `profile`; accept an injected
  clock for deterministic tests; reject contradictory or oversized inputs.
- `trends.ts`: validate the path-selected instance, call the bounded snapshot query, project overall or
  profile evidence, classify point states, compute counts and engine boundaries, and attach retention
  context.
- `trendCsv.ts`: serialize the canonical result only; never query, refilter, or reorder.

The current
`packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/trends/+server.ts` and the new
`.../trends/export/+server.ts` must call the same parser and service. The JSON export should contain the
same domain envelope as the normal trend response. CSV must be a deterministic projection of that
envelope.

Normalize relative ranges to absolute inclusive `from`/`to` timestamps in the response. Export links
must use those applied absolute bounds, not repeat `days=30`; otherwise a download made later can include
a different moving window than the data the user inspected. If inserts racing between the trend fetch
and export must be excluded with absolute certainty, add a canonical `throughSnapshotId` value guard;
otherwise document that normalized timestamps define parity and test the chosen contract.

#### 3. Model evidence states explicitly

Recommended point states are:

- `measured`: numeric score and persisted non-unknown band are valid evidence;
- `unknown`: a persisted `unknown` band or not-evaluated criterion, represented with `score: null`;
- `profile-missing`: the selected exact profile was absent at this snapshot timestamp;
- `not-recorded`: criterion payload required for the requested breakdown is absent or malformed.

The wire response should carry `snapshotId`, `generatedAt`, persisted `engineVersion`, scope, nullable
score/band, and explicit criterion states. Stored `overall_score=0` with `band='unknown'` maps to
`score: null`, not measured zero. A skipped criterion's internal zero contribution is not historical
evidence and should be nullable in the trend contract.

Do not drop timestamps where a selected profile is absent; retain a `profile-missing` point so the chart
breaks rather than joining observations across the absence. Do not derive historical bands from current
threshold constants. Segment every comparable series on engine-version changes and do not compute
deltas across a segment boundary.

#### 4. Keep profile criteria out of the initial persistence change

The recommended #226 contract is:

- overall scope: score, band, and persisted overall criterion score/contribution history;
- profile scope: exact-name score and band history, with an explicit statement that historical profile
  criterion contributions were not recorded.

This is the smallest truthful contract supported by all retained rows. It meets the issue's trend and
filter goals while avoiding a forward-only payload change where old profile points have a fundamentally
different level of detail. If product confirms that profile-specific criterion trends are mandatory,
then enrich `SnapshotProfileScore` in
`packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts` with optional compact criteria
for future writes only. In that stronger option, old rows must remain `not-recorded`, no backfill is
allowed, and the mixed-history behavior must be explicit in OpenAPI, UI, and tests.

#### 5. Evolve the API contract before runtime/UI code

Update these contract sources first:

- `docs/api/v1/paths/config-health.yaml`;
- `docs/api/v1/schemas/config-health.yaml`;
- `docs/api/v1/openapi.yaml`.

Then run `deno task generate:api-types` and `deno task bundle:api` to update
`packages/praxrr-app/src/lib/api/v1.d.ts`, `packages/praxrr-api/openapi.json`, and
`packages/praxrr-api/types.ts`. Runtime mappers should use generated schema types or `satisfies` checks.

Keep the existing per-instance path and add:

```text
GET /api/v1/config-health/{instanceId}/trends
GET /api/v1/config-health/{instanceId}/trends/export?format=json|csv
```

Filters: `days` (1–3650, mutually exclusive with absolute bounds), inclusive `from`, inclusive `to`,
and exact `profile`. The UI sends 30 days initially, with 7/30/90/all-retained presets and a custom
range. Instance switching navigates to another detail path rather than creating a multi-instance
response.

Return `200` for empty evidence, `400` for invalid filters, `404` for missing/non-sync-capable active
instances, and an explicit overflow error (recommended `422`) when an exact result exceeds the server
cap. Never silently truncate or downsample.

#### 6. Choose a stable CSV contract deliberately

Prefer a normalized long-form CSV because criteria can appear, disappear, or change across engine
versions. One summary row followed by canonically ordered criterion rows per trend point makes nullable
criterion values and state explicit and is easier to analyze in spreadsheets than a JSON blob embedded
in a cell. A stable shape can include:

```text
snapshotId,generatedAt,engineVersion,scopeKind,profileName,rowKind,criterionId,
criterionLabel,state,score,band,weight,contribution
```

Ordering is trend point order first, summary before criterion rows second, canonical criterion order/id
third. Empty CSV returns headers only. Numeric unknowns are blank with an explicit state, not `0`.

The simpler alternative—one row per point with `criteria` JSON in a CSV cell—has perfect point-count
parity but is inconvenient for spreadsheet users and obscures the fact that CSV row count differs from
snapshot count in a normalized export. Product should settle this before implementation. Whichever shape
is selected, define columns/order in constants and contract-test parsed semantic parity against the JSON
response.

Serialize RFC 4180 CRLF records, double embedded quotes, and formula-neutralize externally influenced
cells before CSV escaping. Treat JSON as the lossless machine format because spreadsheet-safe prefixing
intentionally changes dangerous leading text in CSV.

#### 7. Replace the sparkline with an accessible analysis section

Keep the feature on
`packages/praxrr-app/src/routes/config-health/[instanceId]/+page.svelte` and create route-local
components under `.../[instanceId]/components/`:

- `TrendFilters.svelte`;
- `HealthScoreTrendChart.svelte`;
- `HealthCriterionTrendChart.svelte`;
- `HealthTrendTable.svelte`;
- `trendChart.ts` for pure scales, ticks, segments, and marker geometry.

Use dependency-free SVG. The dataset is bounded and domain-specific gap/version behavior is the hard
part, not path drawing. Recommended visual rules:

- real time-scaled x-axis and fixed 0–100 score scale;
- no smoothing or interpolation;
- segments broken at unknown, absent, malformed, sampling-gap, or engine-version boundaries;
- a marker, not a horizontal line, for a single measured point;
- score/band encoded with text plus distinct marker shapes, not color alone;
- overall criteria rendered as labelled small multiples with a common time scale rather than a crowded
  multi-line overlay;
- engine changes shown as labelled vertical boundaries and described in the table/summary;
- retention copy describes current global age/count policy and "earliest available" evidence without
  claiming a specific row was pruned;
- concise visible result summary plus a semantic chronological table containing all returned evidence;
- one composite point navigator using Left/Right/Home/End or a persistent selected-point panel; do not
  make every SVG marker a Tab stop;
- controls stack on narrow screens, charts reduce tick density, and any chart overflow is contained in
  a named region rather than creating page-level horizontal scrolling.

Keep current live detail and historical trends independently fault-tolerant. A trend error must preserve
the current report and filters and offer a trend-only retry. Abort stale requests with `AbortController`
and retain a request-id guard. During refresh, old results may stay visible only with their old applied
filter caption and a clear updating state.

### Technology Choices

| Area                  | Recommended choice                                                    | Rationale                                                                     |
| --------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Historical storage    | Existing `config_health_snapshots`                                    | Already append-only and authoritative; issue forbids another analytics store. |
| Querying              | Static SQLite SQL with bound values                                   | Uses existing index and removes dynamic identifier/JSON-path injection risk.  |
| API                   | Per-instance JSON route plus separate `/export?format=`               | Preserves current route semantics and mirrors repository export conventions.  |
| Range state           | URL-representable presets/custom UTC bounds                           | Shareable, testable, and exact enough to rebuild export URLs.                 |
| Chart                 | Route-local Svelte + SVG + pure TypeScript helpers                    | No dependency/supply-chain expansion; exact gap and accessibility behavior.   |
| Accessible equivalent | Visible summary and semantic table                                    | Required for complex chart equivalence and exact-data inspection.             |
| JSON export           | Canonical response envelope as attachment                             | Lossless representation of nulls, metadata, criteria, and ordering.           |
| CSV export            | Fixed, documented long-form projection                                | Stable across criterion/version changes and practical for analysis.           |
| Large result handling | `cap + 1`, fail atomically with 422                                   | Preserves exactness; silent caps violate acceptance.                          |
| Profile criteria      | Not recorded for #226; forward enrichment only if explicitly required | Avoids fabricating history and unnecessary mixed-payload scope.               |

### Phasing

#### Phase 0 — Resolve contract decisions

Settle profile-criterion scope, CSV row shape, exact point cap, sampling-gap rule, and race-consistency
rule. These choices change wire types and tests; coding around unresolved variants would create rework.

#### Phase 1 — Contract and pure domain model

Update OpenAPI and generated artifacts. Implement the pure filter parser, point-state projection,
engine segmentation, and CSV escaping/serialization with unit tests before route/UI integration.

#### Phase 2 — Bounded data access and canonical service

Replace `getTrend(instanceId, days?)` with an absolute-range, selected-column, `cap + 1` query that
preserves `generated_at ASC, id ASC`. Add retention settings and profile-option queries only where the
canonical response requires them. Keep all selector values out of SQL identifiers/JSON paths.

#### Phase 3 — API and export routes

Wire both routes to the same parser/service. Add auth, validation, not-found, overflow, headers,
empty-result, hostile text, and JSON/CSV parity tests.

#### Phase 4 — UI and accessible charting

Build filters, summaries, score chart, overall criterion small multiples, boundary/retention notices,
semantic table, export actions, and explicit loading/empty/sparse/unknown/error states. Use pure helpers
from Phase 1 and only applied response filters for downloads.

#### Phase 5 — Integration, responsive, and release validation

Add deterministic E2E fixtures for empty, sparse, unknown, missing-profile, multi-criterion, and
multi-engine histories at mobile and desktop widths. Run generation, focused tests, checks, lint, E2E,
`git diff --check`, and `graphify update .`. Update `ROADMAP.md` with #226 and the final PR status.

### Quick Wins

1. Expand each point to include its stored `engineVersion`; the current response-level version is
   historically misleading.
2. Map `band='unknown'` to nullable score immediately, eliminating the most serious false-zero risk.
3. Extract strict range parsing with an injected clock and reuse it in both routes.
4. Preserve `generated_at ASC, id ASC` while removing `datetime(generated_at)` from indexed trend
   predicates.
5. Reuse current health-band labels/classes and existing Card/Button/Badge/Table presentation patterns.
6. Reuse sync-history/timeline export behavior as a reference for attachment headers and formula-safe
   escaping, but do not copy their logged-only truncation behavior.
7. Add an accessible table before advanced chart interaction; it immediately supplies an exact long
   description and de-risks later visual iteration.

## Improvement Ideas

### Related Features Worth Scheduling Separately

1. **Forward profile criterion history:** optionally persist compact per-profile criterion observations
   for future snapshots, explicitly versioning availability without reconstructing older rows.
2. **Durable profile identity:** snapshot a stable profile identifier so renames can be represented as a
   documented identity transition rather than separate exact-name histories.
3. **Deleted-instance archive access:** add a durable historical instance key if operators need to view
   or export orphaned snapshots after `arr_instance_id` becomes null.
4. **Collection provenance:** persist expected cadence and prune reason/last-pruned boundary so the UI can
   distinguish sampling gaps, collection start, age pruning, and global count pruning truthfully.
5. **Cross-feature correlation:** deep-link a selected snapshot time to Timeline/Sync History only when a
   precise contract-backed correlation exists.
6. **Shareable filtered links:** add Copy link after URL filter semantics stabilize.
7. **Comparable-period summaries:** add carefully bounded start/end/change or prior-period comparison
   only within comparable measured engine segments.
8. **Export observability and throttling:** metadata-only timing/count/overflow logs and per-actor/IP
   throttling if deployments show resource pressure.
9. **Shared CSV primitive:** consolidate timeline/sync/config-health formula-safe escaping after three
   consumers demonstrate one stable policy; avoid broad refactoring inside #226 unless necessary.

### Explicitly Defer

- multi-instance overlay/comparison;
- predictive scoring, anomaly detection, interpolation, smoothing, or imputation;
- server-side downsampling that changes the evidence set;
- a second analytics datastore;
- retention-policy mutations;
- drag-only zoom or dashboard-builder controls;
- a charting dependency unless the local SVG implementation demonstrably cannot meet accessibility.

## Risk Assessment

### Technical, Product, and Security Risks

| Severity     | Risk                                                                    | Evidence/impact                                                            | Required mitigation                                                                                                                                                 | Release gate                             |
| ------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **CRITICAL** | Auth inheritance is bypassed for the export route                       | Exposes instance/profile names and operational health history              | Keep routes under authenticated `/api/v1/config-health/**`, never add to public paths or use a separate download server; integration-test unauthenticated rejection | Yes                                      |
| **CRITICAL** | Dynamic profile/criterion/sort/JSON-path input reaches SQL syntax       | SQL/JSON-path injection or cross-scope reads                               | Fixed SQL only; bind instance/time/value predicates; map closed selectors in code; never interpolate identifiers or paths                                           | Yes                                      |
| **WARNING**  | UI/JSON/CSV use different filters, ordering, or moving relative windows | Exported evidence differs from what the user inspected                     | One parser/service/result; total order `generated_at,id`; response echoes absolute applied filters; parity tests                                                    | Yes                                      |
| **WARNING**  | Unknown or absent evidence becomes zero or a connected line             | False degradation/improvement and misleading acceptance failure            | Nullable values plus explicit states; segment builder breaks lines; table/export retain timestamps and states                                                       | Yes                                      |
| **WARNING**  | Current engine version is applied to old points                         | Invalid comparisons across scoring policies                                | Carry stored version per point, emit/label boundaries, prohibit cross-boundary deltas                                                                               | Yes                                      |
| **WARNING**  | Unbounded ranges parse/render/export excessive JSON                     | CPU, memory, bandwidth, and browser denial of service                      | Bound ranges/selectors; select required columns; query `cap + 1`; return explicit 422; no silent truncation                                                         | Yes                                      |
| **WARNING**  | CSV formula injection through persisted names/labels                    | Spreadsheet execution or exfiltration when opened                          | Formula-neutralize every external text cell before RFC 4180 escaping; adversarial tests; recommend JSON for lossless automation                                     | Yes                                      |
| **WARNING**  | Export caching or unsafe filenames leak history                         | Sensitive operational posture persists in browser/proxy caches or headers  | `Cache-Control: no-store`, attachment, server-generated ASCII filename, correct media type, `X-Content-Type-Options: nosniff`; never use raw names                  | Yes                                      |
| **WARNING**  | Unsafe SVG/tooltip rendering creates stored XSS                         | Persisted instance/profile/criterion labels reach the browser              | Svelte text interpolation only; prohibit `{@html}`, `innerHTML`, `foreignObject`, dynamic URL/event attributes; numeric internal DOM ids; hostile-label tests       | Yes                                      |
| **WARNING**  | API key is placed in export query string                                | Credential leaks to history, logs, referrers, copied links                 | Browser uses session cookie; automation uses `X-Api-Key`; generated/download URLs never contain `apikey`                                                            | Yes                                      |
| **WARNING**  | Sparse/profile/version gaps are visually overclaimed                    | Users infer trends or causality unsupported by retained evidence           | Actual time scale, marker-only singletons, explicit gaps/boundaries, careful summary language                                                                       | Yes                                      |
| **WARNING**  | Malformed stored JSON crashes or fabricates a clean state               | Partial legacy/corrupt row makes entire view unavailable or silently false | Validate parsed arrays, expose `not-recorded`, log bounded metadata, retain safe point identity                                                                     | Yes                                      |
| **WARNING**  | Mobile/zoom layout overlaps or hides evidence/actions                   | Fails explicit acceptance and WCAG reflow                                  | Stack controls/actions, reduce ticks, use contained named scrolling, semantic table; E2E at 320/375/768/1280 and 400% zoom                                          | Yes                                      |
| **WARNING**  | Kysely 0.27.6 lockfile advisories are exercised accidentally            | Existing high-severity literal/JSON-path advisory surface                  | Use repository raw SQLite wrapper with bound values; prohibit affected literal/path APIs; track adapter/Kysely upgrade separately; rerun `deno audit`               | Yes for safe API use; upgrade may follow |
| **ADVISORY** | New chart dependency expands supply chain and unsafe formatter surface  | Added bundle/CVE/license/SSR complexity                                    | Use local Svelte/SVG; if reversed, pin/review dependency and prove accessibility benefit                                                                            | No new dependency preferred              |
| **ADVISORY** | Export logs capture sensitive query/content                             | Profile names/API keys/full URLs leak to logs                              | Log numeric instance id, normalized range shape, row count, duration, overflow/status only                                                                          | Yes                                      |
| **ADVISORY** | Scope grows into shared utilities or analytics abstractions             | Slows issue and creates unproven extension points                          | Route-local UI and three focused server modules; extract cross-feature CSV helper only if policy is already identical                                               | No                                       |

### Integration Challenges

- `ConfigHealthTrendsResponse` in `packages/praxrr-app/src/lib/server/health/responses.ts` and generated
  OpenAPI types must move together. Runtime-only evolution would violate portable contract fidelity.
- The current trend route accepts unbounded positive `days`; tightening it requires backward-compatible
  error behavior and route tests.
- The detail page currently loads detail first and silently ignores trend failure. Preserve fault
  isolation while exposing a trend-specific error/retry state.
- Retention `maxEntries` is fleet-wide. UI copy must not promise a per-instance 90-day history or claim
  why the earliest visible point is the first.
- Profile selection is exact-name historical identity. Do not trim, case-fold, or merge renamed
  profiles.
- Cross-Arr behavior remains explicitly path-instance-scoped. Tests should cover Radarr, Sonarr, and
  Lidarr without sibling fallback or inferred shared profile semantics.
- Existing timeline/sync export helpers are precedents, not necessarily ready-made shared APIs. Reuse
  behavior and tests without forcing a risky refactor into this issue.

### Performance Recommendations

- Default 30-day history at six-hour cadence is roughly 120 points; render all points exactly.
- Use the existing instance/time index with lexical ISO bounds; select only columns required by the
  trend projector.
- Parse each JSON blob once and calculate SVG geometry once per response.
- Use one SVG path per contiguous series segment and event delegation/a composite navigator rather than
  hundreds of focusable elements.
- Reject overflow rather than downsampling or pagination in the first implementation. Exact export and
  gap semantics are more important than supporting an unusually broad request.
- Abort superseded requests and never let stale results overwrite a newer selection.

## Alternative Approaches

| Option                                                    | Advantages                                                      | Disadvantages                                                                                         | Effort     | Recommendation                                                                               |
| --------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| Existing snapshots + shared service + local SVG           | Truthful, scoped, no dependency/store, exact parity is testable | Requires careful chart/accessibility implementation                                                   | Medium     | **Choose**                                                                                   |
| Add a chart library (LayerChart/Chart.js/uPlot/D3 bundle) | Faster basic axes/tooltips; familiar APIs                       | Does not solve missing/version semantics or accessible equivalent; bundle/supply-chain/SSR complexity | Medium     | Reject for #226; reconsider only with proven accessibility benefit                           |
| Add an analytics table/materialized series                | Flexible future queries and pre-aggregation                     | Violates scope, duplicates source of truth, needs migration/backfill/consistency                      | High       | Reject                                                                                       |
| Fleet-wide multi-instance endpoint/overlay                | Direct comparison across instances                              | Spaghetti charts, mixed identities/cadence/retention, larger resource surface                         | High       | Defer to separately designed feature                                                         |
| Client-side export from loaded chart data                 | Guarantees the exact loaded in-memory view                      | Duplicates serialization, stale data risk, large Blob lifecycle, weaker server contract/automation    | Low–Medium | Reject; server export from canonical applied filters                                         |
| Content negotiation on `/trends`                          | One route                                                       | Download anchors and existing repo conventions favor explicit format; error/docs complexity           | Low        | Use separate `/export?format=`                                                               |
| Silent cap or visual downsampling                         | Protects runtime and supports huge windows                      | Violates exact filtered-data acceptance and can hide gaps                                             | Low        | Reject; cap+1 with explicit 422                                                              |
| Pagination/streaming export                               | Supports very large histories                                   | Complicates snapshot consistency, chart parity, gap interpretation, and implementation                | High       | Defer until measured need                                                                    |
| Forward-enrich profile JSON in #226                       | Future profile criterion trends without schema migration        | Old/new rows differ; grows scope and testing; cannot repair history                                   | Medium     | Defer unless acceptance explicitly requires profile criteria                                 |
| One CSV row per point with criteria JSON cell             | Exact point count, stable columns                               | Poor spreadsheet ergonomics; nested JSON in CSV                                                       | Low        | Acceptable KISS fallback if product prioritizes point parity over tabular criterion analysis |
| Long-form summary + criterion rows                        | Spreadsheet-friendly, explicit null/state, version-stable       | CSV row count differs from snapshot count; needs documented ordering                                  | Medium     | Preferred if criterion analysis is a core export use case                                    |

## Task Breakdown Preview

| ID  | Task group                                                                          | Main files                                                             | Depends on | Complexity | Completion evidence                                                                    |
| --- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------- | ---------- | -------------------------------------------------------------------------------------- |
| T0  | Resolve evidence/CSV/cap/race decisions                                             | Research/spec/plan artifacts                                           | None       | Small      | Decisions recorded with no contradictory contract variants                             |
| T1  | Define OpenAPI paths, filters, response states, retention, boundaries, export media | `docs/api/v1/{openapi,paths/config-health,schemas/config-health}.yaml` | T0         | Medium     | Spec validates; schemas cover nullable/explicit states and 400/404/422                 |
| T2  | Regenerate portable API artifacts                                                   | `src/lib/api/v1.d.ts`, `packages/praxrr-api/*`                         | T1         | Small      | `generate:api-types` and `bundle:api` clean/reproducible                               |
| T3  | Implement/test filter normalization                                                 | `health/trendFilters.ts`, focused tests                                | T0         | Medium     | UTC inclusive bounds, exact names, contradictions, injected-clock days tests pass      |
| T4  | Implement bounded indexed snapshot query                                            | `db/queries/configHealthSnapshots.ts`, DB tests                        | T0         | Medium     | Instance/range/order/equal-timestamp/cap+1 fixtures pass; query avoids dynamic SQL     |
| T5  | Implement canonical projection and retention/version metadata                       | `health/trends.ts`, service tests                                      | T2, T3, T4 | High       | Unknown/absent/malformed/profile/version/retention fixtures produce exact states       |
| T6  | Implement/test CSV serializer                                                       | `health/trendCsv.ts`                                                   | T0, T5     | Medium     | Fixed headers/order, CRLF, nulls, hostile cells, formula payloads, empty export pass   |
| T7  | Wire trend and export routes                                                        | existing trends route, new export route, route tests                   | T2, T5, T6 | Medium     | Auth, status, header, JSON deep parity, parsed CSV semantic parity pass                |
| T8  | Add safe instance/filter page data and request lifecycle                            | `+page.server.ts`, `+page.svelte`                                      | T5, T7     | Medium     | Current detail remains usable on trend error; stale requests cannot overwrite state    |
| T9  | Build pure chart geometry                                                           | `components/trendChart.ts`, unit tests                                 | T5         | Medium     | Actual-time scaling, 0–100 clamp, segmentation, ticks, singletons, equal times pass    |
| T10 | Build filters/charts/table/export UI                                                | route-local Svelte components, `+page.svelte`                          | T7, T8, T9 | High       | All explicit states, non-color encoding, applied export hrefs, semantic table work     |
| T11 | Add responsive/accessibility E2E                                                    | Config Health Playwright spec/fixtures                                 | T10        | High       | Keyboard/touch, mobile/desktop, long labels, gaps, boundaries, no overlap verified     |
| T12 | Update roadmap/graph and run full validation                                        | `ROADMAP.md`, graphify artifacts                                       | T1–T11     | Medium     | Required commands, lint, diff check, graph update pass or exact E2E blocker documented |

Parallelization after T0 is possible: T1, T3, T4, and the serializer's pure escaping tests can begin
together. T5 waits for the contract/parser/query. T9 can begin from the settled wire fixture while T7 is
wired. T10 waits for the canonical response and geometry. T11 and release validation follow the
integrated surface.

## Key Decisions Needed

| Decision           | Recommended default                                                                                             | Why                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Scope per view     | One path-selected instance; `overall` or one exact profile                                                      | Matches current detail route and avoids mixed retention/cadence semantics.                                               |
| Default/ranges     | 30 days; 7/30/90/all retained plus custom inclusive UTC bounds                                                  | Preserves current behavior while satisfying useful range selection.                                                      |
| Profile criteria   | Overall criteria only for #226; profile score/band only                                                         | Existing history cannot prove profile criteria; avoids scope-expanding mixed payload.                                    |
| Unknown semantics  | Nullable score/contribution plus explicit state                                                                 | Prevents false measured zero.                                                                                            |
| Engine changes     | Per-point version and hard visual/comparison boundary                                                           | Historical scoring policies are not assumed comparable.                                                                  |
| Sampling gaps      | Break only under a disclosed deterministic threshold; otherwise break known unknown/absent/version states       | Cadence provenance is not stored, so causal claims are unsafe.                                                           |
| Profile options    | Union across all retained history for the instance                                                              | Stable selector; exact range still controls points/counts. Label historical names as such.                               |
| CSV shape          | Long-form summary/criterion rows                                                                                | Best for analysis and evolving criterion sets; document row-count semantics.                                             |
| Exact-result cap   | 10,000 canonical points, queried as cap+1, overflow 422                                                         | Conservative relative to default global 5,000-row retention while handling configured maxima safely. Measure and adjust. |
| Export consistency | Build links from normalized absolute filters; add `throughSnapshotId` only if strict race exclusion is required | Avoids moving relative windows without prematurely adding token/state machinery.                                         |
| Chart technology   | Local Svelte/SVG plus semantic table                                                                            | Lowest dependency risk and full control over evidence boundaries/accessibility.                                          |
| Empty export       | Successful JSON metadata with `points: []`; CSV headers only                                                    | Predictable automation contract and exact representation of zero results.                                                |
| Deleted instances  | Continue current 404 active-instance semantics                                                                  | Browsing orphan history needs a durable identity design outside #226.                                                    |
| Retention language | Current global policy + earliest available; "may have been pruned"                                              | Schema cannot prove prune cause.                                                                                         |
| ROADMAP update     | Mark #226 implemented with final PR reference/status after validation                                           | Keeps roadmap evidence aligned with actual delivery state.                                                               |

## Open Questions

1. Does acceptance require profile-specific criterion contributions, or is overall criterion history
   plus profile score/band history sufficient? The latter is the recommended truthful #226 scope.
2. Should the CSV favor long-form criterion analysis or one-row-per-point parity with a nested JSON
   criteria cell? This must be frozen before OpenAPI/serializer work.
3. Is 10,000 the acceptable exact-result cap after measuring representative payload/parse/render cost?
4. Must export exclude snapshots inserted after the on-screen response loaded even when they fall inside
   the normalized absolute range? If yes, add `throughSnapshotId` to both response and export filters.
5. What deterministic interval constitutes a sampling gap when historical expected cadence is not
   stored? Avoid a gap-cause label until the rule is disclosed and testable.
6. Should custom date controls ship in the first release, or do 7/30/90/all-retained presets satisfy
   acceptance? The recommended implementation includes custom bounds because export/audit workflows
   benefit materially.
7. Should historical profile names outside the selected range appear in the selector with an explicit
   historical label? Recommended yes for stability and discoverability.
8. Does the project want a real database-seeded Config Health E2E fixture or deterministic API
   interception for most visual/accessibility cases? Recommended: route/database tests prove persistence
   to wire; intercepted E2E fixtures efficiently cover the state matrix and responsive behavior.
9. Should JSON exports include full criterion labels or only stable ids plus numeric evidence? Labels aid
   offline reading; the minimal safer contract omits detail/suggestion prose and all raw configuration.
10. Is metadata-only export observability sufficient for expected self-hosted deployments, or is a
    feature-specific concurrent-export/rate limit required from day one? Strict point bounds are the
    recommended initial control.
