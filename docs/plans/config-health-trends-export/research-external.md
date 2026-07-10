# External API and Library Research: Config Health Trends and Export

## Executive Summary

Issue [#226](https://github.com/yandy-r/praxrr/issues/226) does not require a third-party API,
hosted analytics product, or remote chart service. The source of truth is Praxrr's existing
`config_health_snapshots` table, and both visualization and export can remain same-origin and
protected by Praxrr's existing authentication middleware. There are therefore no new API keys,
vendor rate limits, usage fees, or cross-origin data disclosures.

The recommended chart approach is a small, purpose-built inline SVG component, optionally using
only focused D3 modules later if scale/tick/path logic becomes too costly to maintain. Native SVG
fits the current dependency-free sparkline, modest retained dataset (90 days and 5,000 fleet-wide
rows by default), Svelte 5, server rendering, dark mode, and the requirement for an accessible DOM.
It also makes missing measurements, engine-version breaks, retention boundaries, line styles,
markers, labels, and responsive tick selection explicit. Do not introduce Canvas-first Chart.js or
uPlot for this feature; both require a parallel accessibility layer, and uPlot's aligned-column
format is awkward for independently sparse criterion/profile series. LayerChart 2 is capable and
Svelte-native, but its broad dependency surface and newly released v2 API are unnecessary for this
bounded chart.

The API and export routes should share one filter parser, one database query, one stable ordering,
and one wire projection. Render the UI from that exact wire result and serialize the same ordered
records for JSON/CSV. CSV should follow RFC 4180 (`text/csv`, CRLF records, doubled quotes), use an
HTTP `Content-Disposition: attachment` filename, and address spreadsheet formula injection. JSON
should remain the lossless export for `null`, metadata, and exact user-entered names.

Accessibility is not satisfied by an SVG `aria-label` alone. W3C guidance for complex images calls
for a short description plus an equivalent long description, preferably visible structured text or
a data table. Encode series and health bands with labels, markers, and dash/shape differences in
addition to color; provide keyboard-equivalent inspection; and do not connect missing/unknown points
or engine-version boundaries.

## Primary APIs and Standards

### 1. Praxrr same-origin API (the only runtime API)

- **Service/authentication:** existing SvelteKit routes under `/api/v1`; no additional credentials.
  Existing application auth/session/API-key policy applies through the repository's hooks.
- **Current endpoint:** `GET /api/v1/config-health/{instanceId}/trends?days=N` returns persisted
  overall score/band points oldest to newest.
- **Required evolution:** contract-first trend filters for instance, profile/scope, and time range;
  criterion contribution data; retention/engine boundary metadata; and JSON/CSV export.
- **Rate limits/pricing:** no external quota or fee. Local response limits still matter: validate
  ranges, bound export rows, and report truncation explicitly rather than silently clipping data.
- **Data ownership:** no snapshot, instance, or profile data leaves Praxrr.

Use the [OpenAPI 3.1 Response Object and Media Type Object](https://spec.openapis.org/oas/v3.1.0.html#response-object)
to document every response representation. OpenAPI response `content` is keyed by media type, so a
route can document `application/json` and `text/csv` independently. Praxrr already uses a separate
`/export?format=json|csv` pattern for Timeline and Sync History; mirroring that pattern is less
surprising than content negotiation and provides explicit download URLs.

Suggested external contract shape (names are illustrative; the technical design should settle the
final schema):

```http
GET /api/v1/config-health/trends?instanceId=42&profile=Movies&from=2026-06-01T00:00:00Z&to=2026-07-01T00:00:00Z
Accept: application/json

GET /api/v1/config-health/trends/export?instanceId=42&profile=Movies&from=2026-06-01T00:00:00Z&to=2026-07-01T00:00:00Z&format=csv
```

Contract rules needed for exact parity:

1. Parse filters once into a typed `TrendFilters` value. The list and export handlers must call the
   same parser, not duplicate query-parameter validation.
2. Query once with a deterministic total order, ideally `generated_at ASC, id ASC`, with any scope
   and criterion tie-breakers named in the contract.
3. Project query rows once into a canonical wire-record shape. The UI groups these records for
   charts; export must not independently reconstruct them.
4. Return applied filters and ordering in JSON metadata. Return boundary metadata such as oldest
   available timestamp, requested window start, retention policy, and engine-version segments.
5. If an export cap exists, include an explicit `truncated`/`limit` signal in JSON and a response
   header or repeated CSV field. Never allow a cap to silently violate "exactly the filtered data."
6. Preserve ISO 8601/RFC 3339 UTC timestamps and IDs as stable machine values; localize only chart
   labels in the browser.

### 2. JSON

[RFC 8259](https://www.rfc-editor.org/rfc/rfc8259.html) defines JSON and registers
`application/json`. JSON is the authoritative lossless export because it can distinguish a missing
measurement (`null`) from a measured zero, preserve nested criterion metadata, and retain exact
profile/instance names. RFC 8259 defines no `charset` media-type parameter; emit UTF-8 JSON as
`application/json`.

Recommended response/download headers:

```http
Content-Type: application/json
Content-Disposition: attachment; filename="config-health-trends-2026-07-10T02-30-00Z.json"
Cache-Control: no-store
```

### 3. CSV and download behavior

[RFC 4180](https://www.rfc-editor.org/rfc/rfc4180.html) documents the interoperable CSV conventions
and registers `text/csv`:

- one record per line, using CRLF;
- a header row should use the same field count/order as data rows;
- quote fields containing comma, double quote, CR, or LF;
- escape a double quote by doubling it;
- use `text/csv; charset=utf-8` (the optional `header=present` parameter is valid but not required).

[RFC 6266](https://www.rfc-editor.org/rfc/rfc6266.html) defines HTTP `Content-Disposition`.
`attachment` requests download behavior; a conservative ASCII filename avoids `filename*` browser
compatibility questions. MDN documents that the anchor
[`download` attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a#download)
works for same-origin/blob/data URLs and that a `Content-Disposition` filename takes priority.
Therefore a normal same-origin `<a href="..." download>` targeting the server export route is
preferable to fetching the entire file into a browser `Blob`.

If a future UX must construct a Blob client-side, call
[`URL.revokeObjectURL()`](https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static)
after use; MDN explicitly requires revocation to release the object URL. Server-side download avoids
that memory lifecycle entirely.

Recommended CSV headers:

```http
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="config-health-trends-2026-07-10T02-30-00Z.csv"
Cache-Control: no-store
```

CSV has no native null value or nested-object representation. To avoid turning unknown into zero:

- include a `measurementStatus`/`known` column;
- emit an empty numeric cell for unknown/not-evaluated values, never `0`;
- use explicit scope columns (`scopeType`, `profileName`) rather than encoding identity into a label;
- define column order in a constant and contract-test it;
- prefer a normalized long form for criterion series (`snapshotId`, time, scope, criterion,
  criterionScore, contribution) if the API itself also uses canonical flat records. If the API uses
  nested points, document the deterministic flattening order as part of the export contract.

#### Spreadsheet formula injection

[OWASP CSV Injection guidance](https://owasp.org/www-community/attacks/CSV_Injection) warns that
cells beginning with `=`, `+`, `-`, `@`, tab, CR, or LF may be interpreted by spreadsheet software.
It also states that there is no universal strategy safe for every spreadsheet and downstream
consumer. Praxrr's existing Timeline and Sync History serializers prefix suspicious cells before
RFC-4180 quoting; Config Health should use a shared repository serializer rather than creating a
third subtly different escape function.

This creates a fidelity trade-off: a protective prefix changes a user-entered instance/profile name
as observed by a machine CSV reader. Keep JSON explicitly lossless, document CSV spreadsheet
hardening, and add parity tests for row selection/order separately from scalar escaping. The product
owner should decide whether CSV prioritizes safe spreadsheet viewing or byte-exact machine import.

### 4. Accessible chart standards

Relevant primary guidance:

- [W3C WAI Complex Images tutorial](https://www.w3.org/WAI/tutorials/images/complex/): charts need a
  short description and an equivalent long description; visible structured text/table is encouraged.
- [WCAG 2.2 SC 1.4.1, Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color): use
  shape, text, or another cue in addition to color.
- [WCAG 2.2 SC 1.4.10, Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow): content should
  remain usable at 320 CSS px without two-dimensional scrolling, except content whose meaning
  inherently requires a two-dimensional layout.
- [WCAG 2.2 SC 1.4.11, Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast):
  meaningful graphical objects need 3:1 contrast against adjacent colors.
- [WCAG 2.2 SC 1.4.13, Content on Hover or Focus](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus):
  custom tooltip content must be dismissible, hoverable, and persistent when applicable.
- [WCAG 2.2 SC 2.1.1, Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard): functionality
  must not require a pointer.
- [SVG in HTML on MDN](https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_in_HTML): inline
  SVG participates in the accessibility tree; use `role="img"`, `aria-labelledby`, `<title>`, and
  `<desc>` for a concise accessible graphic.
- [MDN SVG `<title>`](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/title): if
  visible text labels the graphic, referencing it with `aria-labelledby` is preferred.

Concrete requirements for this feature:

- Wrap each chart in `<figure>` with a visible heading/summary and an adjacent details/table view.
- Treat the table/list as the complete non-visual representation. An SVG title/description should
  summarize the trend, not attempt to narrate hundreds of points.
- Identify score, band, and each criterion by visible label plus shape/dash/marker, not hue alone.
- Do not render unknown or absent criteria as zero. Break the path and show an explicit "Unknown" or
  "Not evaluated" marker/status in the table and tooltip.
- Use elapsed time for x-position. Equally spacing irregular snapshots visually claims a cadence that
  did not occur.
- Draw a single snapshot as a visible point. A one-point path can otherwise disappear.
- Treat an engine-version change as an annotated vertical boundary and, unless comparability is
  explicitly guaranteed, end the preceding line segment.
- Announce a retention boundary when the requested range predates the oldest available row. Do not
  draw a line to the chart edge as if earlier history were known.
- All pointer tooltips must also open through focus/keyboard. Escape dismisses; focus and hover can
  move into the tooltip without closing it. Do not make tooltip-only information essential.
- Reduce tick density and wrap/move legends at narrow widths. Keep the plot responsive with an SVG
  `viewBox`, but do not shrink labels below readable sizes; render fewer ticks instead.
- Avoid chart entrance/morph animation, or disable it under `prefers-reduced-motion`.

## Libraries and SDKs Evaluated

Registry versions were checked on 2026-07-10. Package `dist.unpackedSize` is a registry archive
metric, **not** the actual tree-shaken browser bundle size.

| Option                                                             | Current compatibility / license                                                | Advantages                                                                                                                    | Constraints                                                                                                                                                                                       | Decision                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Native inline SVG                                                  | Browser platform; no package                                                   | Accessible DOM, SSR-friendly, exact control over gaps/boundaries, no runtime dependency, builds directly on current sparkline | Praxrr owns scales, ticks, hit testing, focus behavior, and path tests                                                                                                                            | **Recommended**                                                  |
| Focused D3 modules (`d3-scale`, `d3-time`, `d3-shape`)             | `d3-shape` 3.2.0, ISC; official [D3 line docs](https://d3js.org/d3-shape/line) | Mature scale/tick/path math; `line.defined(...)` explicitly ends and restarts segments for missing data                       | Rendering and accessibility remain application-owned; importing all of `d3` is unnecessary                                                                                                        | **Fallback if native geometry grows**                            |
| [LayerChart](https://www.layerchart.com/docs/components/LineChart) | 2.0.1, MIT, peer `svelte ^5.0.0`; SVG and Canvas chart layers                  | Svelte-native composition, axes, legends, tooltip state, annotations, series                                                  | Broad visualization dependency graph; v2 is newly released; still requires an accessible table/summary and careful gap semantics                                                                  | Prototype only if scope expands                                  |
| [Chart.js](https://www.chartjs.org/docs/latest/charts/line.html)   | 4.5.1, MIT                                                                     | Established line/point/segment options; `spanGaps: false` breaks at null points                                               | Canvas content is not screen-reader accessible; [Chart.js accessibility docs](https://www.chartjs.org/docs/latest/general/accessibility.html) put ARIA/fallback responsibility on the application | Do not use for accessibility-first bounded data                  |
| [uPlot](https://github.com/leeoniya/uPlot)                         | 1.6.32, MIT                                                                    | Small, fast Canvas time-series renderer; `spanGaps: false` and nulls supported                                                | Requires aligned x arrays and null padding for sparse series; official docs flag arbitrary sparse series as awkward; accessibility layer remains custom                                           | Do not use unless data volume becomes orders of magnitude larger |

No option provides authentication, hosted endpoints, rate limits, or pricing. All evaluated packages
are local open-source dependencies. Pin any chosen package through `deno.json`/lockfile and do not
load it from a CDN.

## Integration Patterns

### Canonical filter/query/projection path

This pattern prevents list/export drift:

```ts
export interface TrendFilters {
  instanceId: number;
  profileName?: string;
  from?: string;
  to?: string;
}

export function readTrendData(url: URL): TrendResponse {
  const filters = parseTrendFilters(url.searchParams);
  const snapshots = configHealthSnapshotsQueries.search(filters);
  // SQL owns total ordering: generated_at ASC, id ASC.
  return toTrendResponse(filters, snapshots);
}

// UI JSON route
export const GET: RequestHandler = ({ url }) => json(readTrendData(url));

// Export route: parse and query through the same function.
export const GET_EXPORT: RequestHandler = ({ url }) => {
  const response = readTrendData(url);
  const format = parseExportFormat(url.searchParams);
  return format === 'csv'
    ? csvDownload(toCsvRows(response.points))
    : jsonDownload(response.points);
};
```

In production, avoid invoking route handlers from route handlers; share a server module. Tests should
assert the JSON endpoint's canonical `points` and the export projection have equal IDs/order for the
same query string, including equal-timestamp rows.

### RFC-4180 serializer with repository-consistent hardening

```ts
const CSV_COLUMNS = [
  'snapshotId',
  'generatedAt',
  'instanceId',
  'instanceName',
  'scopeType',
  'profileName',
  'engineVersion',
  'band',
  'overallScore',
  'criterionId',
  'criterionScore',
  'criterionContribution',
] as const;

function escapeCsvCell(input: string): string {
  let value = input;
  // Match the existing Praxrr export policy; centralize this helper before reuse.
  if (/^[=+\-@\t\r]/.test(value)) value = `'${value}`;
  if (/[",\r\n]/.test(value)) value = `"${value.replace(/"/g, '""')}"`;
  return value;
}

function nullableCell(value: string | number | null): string {
  return value === null ? '' : escapeCsvCell(String(value));
}

function toCsv(rows: readonly TrendExportRow[]): string {
  return [
    CSV_COLUMNS.join(','),
    ...rows.map((row) =>
      CSV_COLUMNS.map((key) => nullableCell(row[key])).join(',')
    ),
  ].join('\r\n');
}
```

Important: keep `null` as an empty numeric cell plus an explicit status column; never call
`Number(null)` or use `value || 0` in chart/export projections.

### Native SVG gap and boundary segmentation

The exact geometry can remain framework-independent and unit-testable. Split before building an SVG
path; never rely on visual clipping to hide invalid connections:

```ts
interface PlotPoint {
  timestampMs: number;
  score: number | null;
  engineVersion: string;
}

function segments(points: readonly PlotPoint[]): PlotPoint[][] {
  const output: PlotPoint[][] = [];
  let active: PlotPoint[] = [];
  let version: string | null = null;

  for (const point of points) {
    const boundary = version !== null && point.engineVersion !== version;
    if (point.score === null || boundary) {
      if (active.length > 0) output.push(active);
      active = [];
    }
    if (point.score !== null) active.push(point);
    version = point.engineVersion;
  }
  if (active.length > 0) output.push(active);
  return output;
}
```

Illustrative Svelte structure (compatible with the project's no-runes convention):

```svelte
<figure
  aria-labelledby="health-trend-title"
  aria-describedby="health-trend-summary"
>
  <figcaption>
    <h2 id="health-trend-title">Config Health score trend</h2>
    <p id="health-trend-summary">{trendSummary}</p>
  </figcaption>

  <svg
    viewBox="0 0 800 280"
    role="img"
    aria-labelledby="health-trend-title health-trend-summary"
  >
    {#each pathSegments as segment}
      <path
        d={segment.path}
        fill="none"
        stroke={segment.color}
        stroke-dasharray={segment.dash}
      />
    {/each}
    {#each versionBoundaries as boundary}
      <g aria-hidden="true">
        <line
          x1={boundary.x}
          x2={boundary.x}
          y1="0"
          y2="240"
          stroke-dasharray="4 4"
        />
        <text x={boundary.x + 4} y="16">Engine {boundary.version}</text>
      </g>
    {/each}
  </svg>

  <details>
    <summary>View trend data as a table</summary>
    <!-- A semantic table contains every timestamp, status, score, band, and criterion value. -->
  </details>
</figure>
```

Do not put focus on every decorative SVG primitive by default. Use a small number of keyboard
controls (previous/next snapshot) with a visible selected-point readout, while the semantic table
provides direct access to all rows.

### Download links with exact filter reuse

Build both API and export URLs from the same `URLSearchParams`, then append only `format`:

```ts
function trendParams(filters: TrendFilters): URLSearchParams {
  const params = new URLSearchParams();
  params.set('instanceId', String(filters.instanceId));
  if (filters.profileName !== undefined)
    params.set('profile', filters.profileName);
  if (filters.from !== undefined) params.set('from', filters.from);
  if (filters.to !== undefined) params.set('to', filters.to);
  return params;
}

function exportHref(filters: TrendFilters, format: 'json' | 'csv'): string {
  const params = trendParams(filters);
  params.set('format', format);
  return `/api/v1/config-health/trends/export?${params}`;
}
```

Using `URLSearchParams` is important for exact profile names containing spaces, `+`, `&`, Unicode,
or punctuation. Avoid hand-built query strings.

## Constraints and Gotchas

### Data semantics

- A health band of `unknown` is not a numeric score of zero. The persisted schema currently stores
  an integer score even for unknown bands, so the trend wire contract needs an explicit nullable
  measured score or status rather than exposing a misleading zero.
- Criteria can be disabled, added, removed, or become unmeasurable. Missing series points are null
  gaps, not zero contributions.
- Profile names are identifiers and may contain whitespace/punctuation. Do not trim or normalize them
  in filters, downloads, or legends; use exact match semantics consistent with sync lookup rules.
- Snapshots can share a timestamp. Timestamp alone is not a total order; include snapshot ID as a
  stable tie-breaker and ideally in the wire/export record.
- Comparing scores across engine versions can be misleading. Return the snapshot engine version,
  compute contiguous version segments, annotate them, and break the line unless the engine contract
  explicitly declares comparability.
- Retention applies globally by age and max-entry cap. The oldest retained row is not necessarily the
  beginning of history. The API must distinguish "requested window fully available" from "left edge
  truncated by retention."
- Time-range filters need exact inclusive/exclusive semantics. Recommended: `from` inclusive,
  `to` exclusive, both validated RFC 3339 instants. Presets should generate these same bounds.

### Rendering and interaction

- Use a true time scale, not point index, or irregular cadence is hidden.
- Do not smooth health scores with cubic interpolation. A straight segment already implies continuity
  between measurements; smoothing invents intermediate extrema and makes the claim stronger.
- Dense criterion legends will overlap on mobile. Provide toggles/list controls outside the SVG,
  wrap the legend, and default to a manageable set while keeping all series available.
- A fixed SVG `viewBox` scales geometry but also scales text. Prefer HTML legends/labels and adapt tick
  count at width breakpoints rather than shrinking all SVG text.
- Tooltip position must clamp inside the viewport/container and must not be the only source of exact
  values.
- Loading, empty, one-point sparse, unknown, API error, and partial criterion histories are distinct
  states and need separate copy and tests.

### API/export behavior

- Keep chart and export filtering on the server. Client-side filtering of a broader response makes
  export parity fragile and sends unnecessary retained history.
- CSV cannot faithfully represent nested JSON without either normalization or JSON-in-cell encoding.
  Pick one documented shape and test it; do not let object stringification yield `[object Object]`.
- The JSON download should serialize the canonical wire values directly, not reparse the CSV model.
- Use an export row cap only with an explicit response signal. A "download succeeded" response that
  silently omits rows violates the issue's parity requirement.
- Return `400` for invalid ranges, unknown formats, invalid positive IDs, or `from >= to`; `404` for
  unavailable/non-sync-capable instances; and `500` only for unexpected server failures.
- Add `Cache-Control: no-store` for authenticated health exports so browser/intermediary caches do not
  retain stale operational data.
- Filenames must not interpolate instance/profile names directly unless sanitized. A timestamp-only
  ASCII filename avoids header injection and cross-platform invalid characters.

### Dependency and maintenance risk

- Native SVG has no supply-chain addition and matches the existing component.
- If D3 is needed, import only modules/functions actually used; do not add the umbrella `d3` package.
- LayerChart 2.0.1 meets Svelte 5 peer compatibility, but it brings many D3 and LayerStack packages.
  Its convenience does not remove the requirement to build a semantic table and explicit gap/version
  behavior.
- Canvas libraries optimize far larger data than the default retained Config Health history. Their
  performance benefit does not justify duplicating accessible content for this bounded use case.

## Test Implications from External Standards

At minimum, tests should cover:

- identical snapshot IDs and stable order between trend JSON, JSON export, and parsed CSV for every
  supported filter combination;
- equal timestamps ordered by snapshot ID;
- commas, quotes, CR/LF, Unicode, leading formula characters, and exact profile-name preservation in
  JSON;
- CRLF row endings, fixed header order, doubled embedded quotes, content types, attachment filenames,
  and no silent export truncation;
- `null`/unknown values staying gaps and blank numeric CSV cells, never zeros;
- path segmentation at missing criteria and engine-version transitions;
- one-point series rendered as a marker and zero-point series rendered as an empty state;
- retention-truncated versus genuinely empty ranges;
- keyboard access to every chart inspection action, visible focus, tooltip dismissal/persistence,
  accessible chart name/summary, and complete semantic table content;
- 320 CSS px and desktop layouts with non-overlapping ticks/legends and no lost controls;
- dark/light theme graphical contrast and non-color series distinctions;
- reduced-motion behavior.

## Open Questions

1. Does "profile filtering" mean one exact profile at a time, multiple selected profiles, or an
   overall/profile scope selector? This determines OpenAPI parameter serialization and CSV shape.
2. Should a filtered response include both overall and selected profile series, or only the selected
   scope?
3. Is a score from one engine version comparable to a score from another? The conservative default is
   a visible boundary and broken segment.
4. What evidence should assert that retention truncated the requested range? Settings alone cannot
   prove max-entry pruning affected a particular instance. Should cleanup persist a high-water mark or
   should the response only say "history may be retention-limited"?
5. Should the JSON export be the complete response envelope (filters/boundaries plus points) or exactly
   the ordered `points` array? Either can satisfy parity if explicitly specified, but tests must pin it.
6. Should CSV be normalized long form or one row per snapshot with criterion JSON cells? Long form is
   chart-friendly and spreadsheet-friendly but must have a documented secondary ordering.
7. For spreadsheet formula injection, does the product prioritize safe spreadsheet viewing (protective
   prefix alters affected text) or byte-exact machine import? JSON can remain the guaranteed lossless
   format either way.
8. Is the existing 5,000-row cap fleet-wide intentional for trend/export UX, or should the UI explain
   that a busy fleet can lose one instance's old rows before `retentionDays`?
9. What time presets are required (for example 7/30/90 days, all retained, custom), and are custom
   bounds expressed in user-local dates or exact UTC instants?
10. Should chart series default to criterion contribution (points added to total), raw criterion score,
    or offer a toggle? Both exist in snapshots but communicate different concepts.

## Primary Documentation URLs

- OpenAPI 3.1.0: <https://spec.openapis.org/oas/v3.1.0.html>
- RFC 8259 (JSON): <https://www.rfc-editor.org/rfc/rfc8259.html>
- RFC 4180 (CSV): <https://www.rfc-editor.org/rfc/rfc4180.html>
- RFC 6266 (Content-Disposition): <https://www.rfc-editor.org/rfc/rfc6266.html>
- OWASP CSV Injection: <https://owasp.org/www-community/attacks/CSV_Injection>
- W3C WAI Complex Images: <https://www.w3.org/WAI/tutorials/images/complex/>
- WCAG 2.2: <https://www.w3.org/TR/WCAG22/>
- MDN SVG in HTML: <https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_in_HTML>
- MDN anchor download behavior: <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a#download>
- MDN object URLs: <https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static>
- D3 line generator and `defined`: <https://d3js.org/d3-shape/line>
- LayerChart LineChart: <https://www.layerchart.com/docs/components/LineChart>
- Chart.js line chart: <https://www.chartjs.org/docs/latest/charts/line.html>
- Chart.js accessibility: <https://www.chartjs.org/docs/latest/general/accessibility.html>
- uPlot docs: <https://github.com/leeoniya/uPlot/blob/master/docs/README.md>
