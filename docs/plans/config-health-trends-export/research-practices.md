# Practices Research: Config Health Trends and Export

## Executive Summary

Issue #226 should extend the existing Config Health snapshot path, not create a parallel analytics
system. The highest-value practice is one canonical, deterministic trend result used by the chart
endpoint and both export formats; the UI should render that result without re-filtering, re-sorting,
or inventing values for missing history.

Keep the implementation dependency-free and feature-local: reuse the existing snapshot query,
health band mappings, strict date parsing, export attachment conventions, and UI primitives. Add
small pure seams for filter normalization, snapshot projection, CSV serialization, and chart
geometry. Do not hide malformed or unavailable historical JSON behind an empty array, interpolate
unknown points, or imply continuity across engine-version boundaries.

## Existing Reusable Code

| Module/Utility                                               | Location                                                                                                                                   | Purpose                                                                             | How to Reuse for This Feature                                                                                                                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `configHealthSnapshotsQueries`                               | `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts`                                                                   | Inserts and reads append-only health snapshots in stable `generated_at`, `id` order | Extend its trend read with normalized absolute bounds and a `limit + 1` exactness guard. Keep SQL and row parsing here; do not put chart/export semantics in the query object.                                |
| `ConfigHealthSnapshotDetail`, `SnapshotProfileScore`         | `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts`                                                                   | Parsed stored overall criteria and light profile score/band history                 | Use as the historical source model. Preserve profile-name equality exactly. If future snapshots gain profile criteria, make the field optional and forward-only; old rows cannot be reconstructed truthfully. |
| `configHealthSettingsQueries.get()`                          | `packages/praxrr-app/src/lib/server/db/queries/configHealthSettings.ts`                                                                    | Reads live retention days/max entries and current criterion settings                | Reuse for retention context. Describe these as current global limits, not proof that a specific point was pruned.                                                                                             |
| `CONFIG_HEALTH_ENGINE_VERSION` and health contracts          | `packages/praxrr-app/src/lib/shared/health/types.ts`                                                                                       | Defines engine version, bands, criterion ids, null-as-not-evaluated semantics       | Keep current policy metadata separate from each snapshot's persisted `engineVersion`. Use persisted versions to split comparable chart segments.                                                              |
| `toTrendsResponse` and wire types                            | `packages/praxrr-app/src/lib/server/health/responses.ts`                                                                                   | Current OpenAPI-aligned trend mapper                                                | Evolve this contract-first into a mapper from the canonical trend result. Do not let routes assemble ad hoc response objects.                                                                                 |
| Existing trends route                                        | `packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/trends/+server.ts`                                                       | Validates instance id/eligibility and returns persisted trends                      | Keep its 400/404/500 behavior and active sync-capable instance gate. Replace route-local `days` parsing with the shared trend filter parser used by export.                                                   |
| `parseDateBound`                                             | `packages/praxrr-app/src/lib/server/sync/syncHistory/filters.ts`                                                                           | Strict, inclusive date-only/ISO bound normalization compatible with SQLite          | Reuse it for `from`/`to`; timeline already imports this cross-feature helper. Moving it during #226 adds churn without changing behavior.                                                                     |
| Timeline filter discipline                                   | `packages/praxrr-app/src/lib/server/timeline/filters.ts`                                                                                   | Pure validation, typed filter result, explicit contradictory-filter errors          | Mirror the separation: one parser called by list/chart and export routes. Inject a single `nowIso` for deterministic relative ranges.                                                                         |
| Timeline canonical service                                   | `packages/praxrr-app/src/lib/server/timeline/service.ts`                                                                                   | Both list and export call the same query/projection layer                           | Mirror this boundary for health trends so JSON/CSV cannot drift from the on-screen dataset.                                                                                                                   |
| Sync History and Timeline export routes                      | `packages/praxrr-app/src/routes/api/v1/sync-history/export/+server.ts`, `packages/praxrr-app/src/routes/api/v1/timeline/export/+server.ts` | `format=json                                                                        | csv`, attachment headers, RFC 4180 escaping, spreadsheet-formula neutralization                                                                                                                               | Reuse the public behavior and security rules. Do not reuse their logged-only 50,000-row truncation because issue #226 requires exact export parity. |
| Timeline `buildQuery` / `exportHref` pattern                 | `packages/praxrr-app/src/routes/timeline/+page.svelte`                                                                                     | Builds API and export URLs from one UI filter state                                 | Mirror with a route-local trend query serializer. Prefer export URLs derived from the API's normalized absolute filter, so a later download cannot shift a relative `days` window.                            |
| URL-state parser/serializer pattern                          | `packages/praxrr-app/src/routes/score-simulator/[databaseId]/urlState.ts`                                                                  | Pure, unit-tested query-state round trip                                            | Follow the pattern for shareable trend selections, but do not reuse simulator-specific code or introduce encoded JSON state. Plain `days`, `from`, `to`, and `profile` params are sufficient.                 |
| `HEALTH_BAND_LABEL`, `HEALTH_BAND_TEXT_CLASS`, `bandVariant` | `packages/praxrr-app/src/lib/client/ui/health/healthStatus.ts`                                                                             | Single presentation mapping for health bands                                        | Reuse for legends, badges, and tabular labels. Add symbols/text in the chart; color classes alone are not an accessible encoding.                                                                             |
| `Card`, `Button`, `Badge`, `Table`                           | `packages/praxrr-app/src/lib/client/ui/`                                                                                                   | Existing responsive visual primitives                                               | Use for controls, export actions, notices, legends, and the accessible data alternative. Use a native table if nested criterion rows do not fit `Table.svelte` cleanly; do not contort the generic table API. |
| Detail page fetch/race pattern                               | `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.svelte`                                                                   | Keeps live detail usable when trends are supplementary and guards stale requests    | Preserve trend-specific failure isolation, but show an explicit trend error instead of silently swallowing it. Prefer one `AbortController` per trend request over adding more request-id counters.           |
| Migrated DB/route test harnesses                             | `packages/praxrr-app/src/tests/db/configHealthSnapshots.test.ts`, `packages/praxrr-app/src/tests/routes/configHealth.test.ts`              | Real migrations, scratch SQLite, direct route invocation                            | Extend these suites for bounds, ties, JSON/CSV parity, invalid filters, engine changes, profile gaps, unknown values, and empty exports. The existing `config-health` alias already includes both files.      |
| Playwright request interception and viewport checks          | `packages/praxrr-app/src/tests/e2e/specs/4.4-score-simulator-ux-basics.spec.ts` and other E2E specs using `page.setViewportSize`           | Deterministic UI fixtures and mobile checks                                         | Add a focused Config Health trends spec with intercepted API fixtures rather than depending on a live scoring sweep for every visual state.                                                                   |

## Modularity Design

### Recommended Module Boundaries

```text
$db/queries/configHealthSnapshots.ts
  SQL bounds/order/limit and truthful persisted-payload parsing
             |
             v
$server/health/trendFilters.ts
  parse and normalize days/from/to/profile with injected nowIso
             |
             v
$server/health/trends.ts
  canonical read + pure snapshot projection + counts/retention/version boundaries
       |                                      |
       v                                      v
/trends/+server.ts                    /trends/export/+server.ts
OpenAPI JSON response                 same result -> JSON attachment or CSV serializer
       |
       v
/config-health/[instanceId]/
  +page.svelte                        owns request/filter state only
  components/TrendFilters.svelte     labeled responsive controls
  components/HealthTrendChart.svelte feature-specific accessible SVG
  components/HealthTrendTable.svelte exact textual/table alternative
  components/trendChart.ts           pure time scaling/segmentation/ticks
```

- **Keep storage reads in `configHealthSnapshots.ts`** because it already owns the table and row
  mapping. Add a purpose-built trend row projection if selecting `*` and parsing unused blobs becomes
  costly; do not leak raw snake-case rows to the route.
- **Create `trendFilters.ts`** because two public routes must enforce identical filters. It should
  return normalized absolute inclusive bounds and an exact profile selector, and throw a typed
  validation error the routes map to 400.
- **Create `trends.ts`** because retention metadata, profile projection, point states, counts, and
  engine boundaries are domain logic shared by the chart and export routes. Expose a pure
  `buildConfigHealthTrendResult(...)` beneath the I/O wrapper so most edge cases need no database.
- **Keep OpenAPI wire mapping in `health/responses.ts`** because all existing Config Health response
  contracts live there. The service result may be readonly; the mapper produces mutable generated-
  type-compatible objects.
- **Keep CSV row construction next to health trends**, for example
  `$server/health/trendExport.ts`, because its columns and flattening are feature policy. Only the
  low-level cell escaping is generic.
- **Keep chart components route-local** because no other feature currently has a data chart. Promote
  them to `$ui/chart/` only when another feature needs the same contract. A feature-specific chart
  can still accept prepared series so score and criterion views share geometry without claiming to
  be a universal chart system.
- **Keep geometry in `trendChart.ts`** because actual-time x scaling, null/version segmentation, and
  label thinning are deterministic math. This makes misleading-line bugs unit-testable without a
  browser or Svelte component harness.

### Shared vs. Feature-Specific Code

| Component                            | Shared or Feature-Specific     | Rationale                                                                                                                                                      |
| ------------------------------------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strict date-bound parsing            | Shared existing code           | Timeline already reuses Sync History's parser; another local parser would create three subtly different date contracts.                                        |
| CSV cell escaping                    | Shared low-level helper        | Sync History and Timeline contain the same formula-neutralization/RFC 4180 implementation. Config Health is the third occurrence, so the rule of three is met. |
| CSV columns and trend row flattening | Feature-specific               | Criterion/state/version columns are Config Health domain policy and should not be forced through a generic record serializer.                                  |
| Trend filter parser                  | Feature-specific server module | It owns Config Health rules such as exact profile names and `days` versus absolute bounds.                                                                     |
| Trend result/projector               | Feature-specific server module | Unknown scores, profile absence, retention context, and engine comparability are health semantics.                                                             |
| Chart geometry                       | Feature-specific pure module   | There is one current chart consumer family; premature `$ui/chart` APIs would freeze assumptions before a second domain exists.                                 |
| Chart/table/filter Svelte components | Route-local feature components | They are used by one detail surface and can evolve with the contract without widening the global UI API.                                                       |
| Health band labels/badge variants    | Shared existing code           | Already the presentation source of truth across dashboard and detail.                                                                                          |
| Instance option load shape           | Reuse local dashboard pattern  | Mirror `config-health/+page.server.ts` and `timeline/+page.server.ts`: expose only id/name/type, never credentials.                                            |

## KISS Assessment

| Area                | Tempting Proposal                                                                 | Simpler Alternative                                                                 | Trade-off                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistence         | Add an analytics table or materialized aggregate                                  | Query retained `config_health_snapshots` directly                                   | No pre-aggregation, but retained data is already bounded and is the required source of truth.                                                 |
| Charting            | Add D3, Chart.js, ECharts, or a generic chart framework                           | One route-local SVG component plus pure geometry helpers                            | Less built-in interaction, but dramatically lower bundle/API/maintenance cost for a small set of lines and markers.                           |
| Instance filtering  | Build a multi-instance overlay endpoint                                           | Keep the instance id in the path; selector navigates to another detail path         | No cross-instance comparison, but matches current information architecture and avoids scale/identity ambiguity.                               |
| Profile history     | Recompute old profile criteria from current state                                 | Show stored profile score/band; mark historical criteria unavailable                | Fewer historical dimensions, but preserves evidence fidelity. Optional profile criteria may be written forward-only if product requires them. |
| Historical metadata | Version and persist a second criterion catalog                                    | Use labels already stored in each `criteria_scores` item and mark engine boundaries | Cannot supply descriptions for every old version, but avoids an unrelated historical-catalog system.                                          |
| Filtering           | Fetch all history and filter in Svelte                                            | Normalize and filter once on the server                                             | Slightly more server code, but exact UI/export parity and bounded client work.                                                                |
| Export              | Maintain separate JSON and CSV queries                                            | Serialize the same canonical result returned by the chart service                   | CSV needs a projection, but cannot silently reorder or broaden the dataset.                                                                   |
| Export size         | Silently truncate at a cap and log                                                | Query `cap + 1`; reject oversized exact exports with an explicit response           | User must narrow a very large range, but an incomplete file is never misrepresented as exact.                                                 |
| Time range          | Store only a relative `days` filter                                               | Echo absolute normalized `from`/`to` and build export from those                    | Response is larger by two strings, but chart and later export refer to the same time slice.                                                   |
| Missing samples     | Smooth or connect all measured points                                             | Split paths at unknown/absent/version boundaries; show markers/table                | Visuals are less decorative, but do not imply measurements or comparability that do not exist.                                                |
| Component hierarchy | Create separate score, band, criterion, profile, boundary, and tooltip frameworks | One trend chart, one table, one filter panel, small render helpers                  | Some conditional rendering remains, but responsibilities stay visible and changeable.                                                         |

## Abstraction vs. Repetition

### Extract (Worth Abstracting)

- **CSV cell escaping:** identical logic exists in both
  `sync-history/export/+server.ts` and `timeline/export/+server.ts`; Config Health is the third
  consumer. Extract `escapeCsvCell(value: string): string` to a small server-only export helper and
  migrate the two existing callers with their current tests intact. Keep each feature's columns and
  row projection local.
- **Chart/export filter parsing:** two Config Health routes must accept exactly the same selection.
  Extract now, because divergence would directly violate acceptance criteria; this is contract reuse,
  not speculative framework work.
- **Canonical trend projection:** chart JSON and JSON/CSV export are three representations of the
  same evidence. One `ConfigHealthTrendResult` builder is required to make point inclusion, state,
  ordering, and boundaries identical.
- **Chart geometry:** score and criterion renderings need identical time scaling and discontinuity
  rules. Pure `xForTime`, `yForScore`, `segmentPoints`, and tick-selection functions prevent two SVG
  implementations from disagreeing.

### Repeat (Acceptable Duplication)

- **Route response wrappers:** the normal JSON route and attachment route can each contain a short
  `try/catch` and response-header block. A universal SvelteKit export-route factory would obscure
  status handling for only two routes.
- **Feature-specific CSV cell selection:** keep a direct switch/map for the small stable Config Health
  column set. A reflection-based serializer makes null and nested criterion semantics harder to audit.
- **Desktop/mobile Tailwind layout classes:** allow small repeated responsive classes in the three
  route-local components. Do not create layout primitives solely for this page.
- **State copy:** explicit empty, no-range, sparse, unknown, and error messages may share styling but
  should remain separately authored because they communicate different evidence states.
- **Simulator URL-state implementation:** copy the parse/serialize pattern, not its domain code. A
  generic query-state framework is not justified by these two unrelated feature schemas.

## Interface Design

### Public API Surfaces

Recommended internal contracts (names may adjust during planning):

```ts
export interface ConfigHealthTrendFilter {
  from?: string;
  to?: string;
  profile?: string;
}

export function parseConfigHealthTrendFilter(
  url: URL,
  nowIso: string
): ConfigHealthTrendFilter;

export interface ConfigHealthTrendQuery {
  instanceId: number;
  from?: string;
  to?: string;
  limit: number;
}

export function buildConfigHealthTrendResult(input: {
  instance: { id: number; name: string; arrType: HealthArrType };
  filter: ConfigHealthTrendFilter;
  rows: readonly ConfigHealthSnapshotDetail[];
  settings: Pick<
    ConfigHealthSettings,
    'retention_days' | 'retention_max_entries'
  >;
  currentEngineVersion: string;
  nowIso: string;
}): ConfigHealthTrendResult;

export function readConfigHealthTrend(
  instanceId: number,
  filter: ConfigHealthTrendFilter,
  nowIso: string
): ConfigHealthTrendResult;

export function toConfigHealthTrendCsv(result: ConfigHealthTrendResult): string;
```

Interface rules:

- `parseConfigHealthTrendFilter` captures relative time once. `days` is input syntax, not retained
  ambiguity; the returned filter contains absolute inclusive bounds.
- Reject an empty profile but do not trim, case-fold, or rename a non-empty value. Persisted profile
  names are exact sync identifiers.
- Snapshot ordering is always `generatedAt ASC, snapshotId ASC`; every public representation keeps it.
- A canonical point carries `snapshotId`, `generatedAt`, persisted `engineVersion`, explicit state,
  nullable score/band, and criterion observations. Unknown or absent values are null plus state, never
  numeric zero.
- JSON export should contain the same result envelope as the trend endpoint, not merely a naked point
  array, so selection, retention, and engine boundaries remain attached to the evidence.
- CSV should be deterministic and lossless. Prefer a documented long form if criterion rows must be
  first-class; otherwise encode the exact criterion array as JSON in a fixed cell. Do not generate
  dynamic columns whose meaning changes with engine versions.

### Extension Points

- `ConfigHealthTrendFilter` can gain another server-validated dimension later without changing the
  route's canonical-service boundary.
- Tagged point/criterion availability states can add a new reason without overloading `null` or zero.
- Persisted `SnapshotProfileScore` may gain optional compact criteria for new writes. The projector can
  expose `not-recorded` for older entries without a schema migration or false backfill.
- A later second charting feature can promote the proven geometry contract from the route into
  `$ui/chart/`. Do not design that global API in #226.
- A later streaming exporter can consume the same canonical point iterator if operational evidence
  shows retained exact exports exceed safe memory. Streaming is not required to establish the current
  domain contract.

## Testability Patterns

### Recommended Patterns

- **Injected clock:** pass `nowIso` into relative-range parsing and retention metadata. Tests can assert
  exact normalized bounds and export URLs without fake global timers.
- **Pure projector:** test overall/profile selection, missing profile rows, malformed payload states,
  unknown values, equal timestamps, engine boundaries, and counts with arrays of snapshot fixtures.
- **Real SQLite query tests:** extend `configHealthSnapshots.test.ts` for inclusive `from`/`to`, stable
  id tie-breaks, instance isolation, `cap + 1`, and index/query-plan behavior. Pure mocks cannot prove
  SQL ordering.
- **Route contract tests:** extend `configHealth.test.ts` to import both trend handlers and compare the
  normal JSON response, JSON attachment, and parsed CSV for one normalized selection. Also cover
  malformed/contradictory filters, invalid format, 404 eligibility, empty headers, content types, and
  content disposition.
- **CSV unit tests:** assert commas, quotes, CR/LF, UTF-8, null/zero distinction, nested criterion JSON,
  and formula prefixes `=`, `+`, `-`, `@`, tab, and carriage return.
- **Pure geometry tests:** assert actual-time spacing, a single point producing no directional line,
  null/profile-missing points breaking segments, and engine changes breaking segments even when both
  surrounding scores are measured.
- **Deterministic E2E fixtures:** intercept detail/trend APIs for empty, sparse, mixed unknown, multiple
  criteria, and multiple engines. Check labeled controls, keyboard-reachable exact values/table,
  export href parity, no page-level overflow at 320/390 px, and non-overlapping desktop rendering.
- **Alias discipline:** keep all new Config Health unit/DB/route tests in paths already covered by the
  `config-health` alias or update `scripts/test.ts` in the same change. Run `deno task test
config-health`, `deno task check`, and the focused/full E2E command required by the issue.

### Anti-patterns to Avoid

- **Do not reuse `parseJsonArray` as currently written for evidence fidelity.** It turns malformed JSON
  and a valid empty array into the same `[]`. Trend projection needs an explicit unavailable/invalid
  state; otherwise a corrupt criterion payload looks like a measured absence.
- **Do not wrap indexed timestamps in `datetime(generated_at)` for new bound predicates without query-
  plan evidence.** Stored values are canonical ISO UTC; normalized ISO string comparisons allow the
  existing `(arr_instance_id, generated_at DESC)` index to help.
- **Do not keep the current index-spaced sparkline math.** `stepX = width / (points.length - 1)` makes
  irregular sampling appear regular. Scale x from actual timestamps.
- **Do not draw one polyline through unknown, missing-profile, sampling-gap, or engine-version points.**
  Build separate comparable segments.
- **Do not silently ignore trend failures.** Live detail may remain visible, but trend errors need their
  own status and retry action.
- **Do not compute bands from current thresholds for old points.** Use each snapshot's stored band and
  version.
- **Do not client-filter a server-returned superset for the chart while export filters on the server.**
  That creates untestable count/order mismatches.
- **Do not add a broad dependency-injection container or repository interface solely for tests.** A
  pure projector plus real migrated query tests gives the needed seams with less indirection.
- **Do not use profile array index as identity.** Profiles are selected by exact persisted name; renames
  form separate truthful historical series unless a durable identity is explicitly designed later.
- **Do not place Svelte runes in the new components.** Follow the repository's Svelte 5 legacy syntax
  and event conventions.

## Build vs. Depend

| Need                           | Build Custom                                         | Use Library                      | Recommendation                    | Rationale                                                                                                                                                                                                 |
| ------------------------------ | ---------------------------------------------------- | -------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Time-series chart              | Small SVG + pure geometry                            | D3/Chart.js/ECharts/Plotly       | Build                             | No chart package exists; the requirement is a bounded set of score/criterion series. A library adds bundle, accessibility adaptation, SSR, theming, and upgrade burden larger than the required geometry. |
| Accessible exact values        | Native table / existing `Table.svelte`               | Chart tooltip plugin             | Build with existing UI primitives | Tooltips cannot be the only carrier of information. The exact table is simpler, keyboard-safe, and directly testable.                                                                                     |
| Time parsing                   | Existing `parseDateBound` plus native `Date`         | date-fns/Luxon/Temporal polyfill | Reuse/build                       | The accepted syntax is already defined and tested. A dependency would widen behavior and risk SQLite incompatibility.                                                                                     |
| Request cancellation           | Native `AbortController`                             | Fetch wrapper/query client       | Use platform                      | The page has a few fetches and existing stores do not use a query framework. Native cancellation is sufficient.                                                                                           |
| JSON export                    | `JSON.stringify` canonical result                    | Serializer library               | Use platform                      | Contract data is already JSON-safe; custom serialization adds no value.                                                                                                                                   |
| CSV export                     | Feature row projection + shared `escapeCsvCell`      | Papa Parse / csv-stringify       | Build                             | Two audited implementations already establish the small required behavior. Extract the third shared escape, retain security tests, and avoid a new dependency for a fixed schema.                         |
| File download                  | Attachment response + existing `Button href`         | FileSaver/client blob library    | Reuse platform/UI                 | Same-origin anchor downloads already work for Timeline and Sync History and preserve server-side filtering.                                                                                               |
| Responsive layout              | Tailwind classes and current `Card`/`Button`/`Table` | Visualization layout library     | Reuse                             | Existing responsive primitives match the app. Charts may scroll inside their own labeled region; the page must not overflow.                                                                              |
| Accessibility regression tests | Playwright semantics/keyboard assertions             | Add axe package                  | Reuse current stack first         | The repo has Playwright but no visible axe dependency. Add an accessibility library only if project-wide policy adopts it, not only for this route.                                                       |

## Open Questions

1. Does “criterion/profile history” require per-profile criterion contributions, or overall criterion
   history plus per-profile score/band history? Existing `profile_scores` cannot answer the former for
   old snapshots. If mandatory, approve optional forward-only profile criteria and an explicit
   `not-recorded` state.
2. Should selecting a profile that existed historically but is absent from some snapshots keep those
   timestamps as explicit gaps (recommended), and should an entirely unknown profile be 200-empty or a
   validation error?
3. Are 7/30/90/all presets sufficient, or must #226 ship arbitrary inclusive `from`/`to` controls?
   The server contract should normalize both even if the first UI exposes only presets.
4. What exact sampling-gap rule should break a line beyond explicit unknown/version gaps? Historical
   cadence changes are not stored, so any time-based threshold must be disclosed as a presentation
   heuristic rather than evidence of a missed run.
5. What exact export safety limit is acceptable? The current retention cap may be configured up to one
   million global rows. Exactness rules out silent truncation; reject with a narrow-range instruction or
   explicitly plan a streaming implementation.
6. Should JSON export be byte-for-byte the normal trend response body, or only semantically identical?
   The simplest strong guarantee is the same result object passed to `JSON.stringify` in both routes.
7. Should CSV use one point row with a JSON criterion cell or long-form summary/criterion rows? The
   former is simpler and maps one-to-one to API points; the latter is friendlier to analysis tools but
   needs a documented secondary ordering and repeated metadata.
8. Must history remain queryable after an Arr instance is deleted? Rows preserve denormalized names but
   `arr_instance_id` becomes null, while current routes require an active numeric instance. Supporting
   deleted-instance export needs a durable historical identity and is larger than the current route.
9. Is a current global retention notice sufficient, or does product want prune provenance? The latter
   would change retention semantics/storage and conflicts with issue scope; current code can only say
   older points may have been pruned.
