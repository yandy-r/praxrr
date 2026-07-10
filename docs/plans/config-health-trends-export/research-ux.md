# UX Research: Config Health Trends and Export

Research date: 2026-07-10
Feature: `config-health-trends-export`
Issue: [#226](https://github.com/yandy-r/praxrr/issues/226)

## Executive Summary

The best evolution of Praxrr's Config Health detail is an analysis surface that answers three
questions in order:

1. Is health improving, stable, or declining for this instance or profile?
2. Which measured criteria changed, and where is the history not comparable or unavailable?
3. Can I download the exact records I am looking at?

The current detail route already has the right product location and hierarchy: instance identity,
current score, criterion cards, a small 30-day sparkline, suggestions, and per-profile cards. The
trend work should replace the sparkline with a focused analysis section rather than introduce a
separate analytics dashboard. A single selected instance and scope (`Overall` or one profile) keeps
the chart legible and avoids a multi-instance “spaghetti chart.” The instance picker can navigate
between existing detail routes while preserving applicable time filters.

Accessibility cannot be satisfied by adding an `aria-label` to the SVG. W3C treats charts as complex
images that require a short identification plus a structured long description, which may include a
table. The chart should therefore be one representation of the result, paired with a concise text
summary and a toggleable, semantic data table. Every visual meaning must have a non-colour encoding.
All chart interactions must work by keyboard, pointer, and touch.

The chart model should preserve uncertainty rather than smooth it away:

- An `unknown` health band is not a score of zero. It is a gap plus a labelled “Not evaluated” event.
- Missing expected snapshots break the line. Actual points retain their real time spacing.
- One point is a snapshot, not a trend; render a point and explain that two are needed to compare.
- An engine-version change breaks the score line and gets a labelled vertical boundary because
  scoring on either side may not be directly comparable.
- A retention boundary is an unavailable interval, not an empty interval. Show the retained range
  and policy in text and mark a boundary only when the API can prove why data begins there.

Existing snapshot storage has an important fidelity limit. Overall snapshots include full criterion
scores and contributions, but `profile_scores` stores only profile name, score, and band. With the
existing source of truth, profile scope can accurately chart score and band; it cannot reconstruct
historical per-profile criterion contributions. The UI must hide that chart with a plain explanation,
not substitute current criteria or infer values. Overall scope can show criterion history today.

Exports should use explicit `Download CSV` and `Download JSON` actions beside the applied-result
summary. Both actions must use the same canonical filter/query state as the chart and data table.
Display the exact row/snapshot count and scope before download, keep exports available for empty
results if the contract defines an empty file, and report download failures inline without losing
the current analysis.

## Evidence from the Existing Product

### Current Config Health surface

- `/config-health/[instanceId]` fetches live detail, then treats a trend request as supplementary.
  This is good progressive disclosure: a trend failure should not erase the current report.
- The sparkline is a dependency-free SVG with a fixed `0–100` mapping, one polyline, no axes, no
  data table, no gap handling, no time labels, no filter state, and only `aria-label="Overall score
trend"`.
- The trend endpoint accepts `days` and returns only `generatedAt`, `overallScore`, and `band`; it
  currently discards criterion, profile, per-point engine version, retention, and boundary data that
  exist elsewhere.
- Current health rendering already expresses band as text in badges and `unknown` as an em dash,
  which should remain the canonical language.
- The scoring engine persists `score: 0` when every enabled criterion is unmeasurable, paired with
  `band: unknown`. Trend presentation must key off `band`, not blindly plot `overallScore` at zero.
- Band policy is versioned and currently uses score thresholds of 60 and 85. UI labels and boundary
  locations should come from contract metadata or a shared policy module, never be duplicated as
  chart literals.

### Existing patterns worth reusing

- Sync History and Timeline already use URL-like filter state, labelled date/select controls,
  clear/reset actions, result counts, and explicit JSON/CSV actions.
- `Card`, `Button`, `Badge`, responsive `Table`, and alert/error styles give this feature consistent
  visual vocabulary without a second chart/dashboard design system.
- Existing `Table` changes to labelled cards below 768 px. A trend data table should use the same
  responsive treatment rather than force a wide table across a 320 px viewport.
- The current custom `DropdownSelect` exposes a visible label as a `span`, not a native `<label>` or
  an explicit accessible name for the trigger. New trend filters should use native labelled selects
  or fix/reuse a component that provides a programmatic label before relying on it for this feature.

### Data constraints that affect the experience

- Snapshots are append-only and ordered oldest to newest by `generated_at`, then `id`.
- Default collection cadence is six hours, default age retention is 90 days, and the default maximum
  is 5,000 entries. The maximum-entry cap is global, so “90 days retained for this instance” cannot
  be promised merely from settings.
- Every snapshot records its engine version. The current response returns only the current engine
  version, which is insufficient to place truthful version boundaries.
- Overall `criteria_scores` retain score, weight, contribution, details, and null/not-evaluated
  status. Profile history retains only name, score, and band.
- Profile identity is currently a name string. A rename can look like one series ending and another
  beginning; the UI must not silently merge historical names.

## User Workflows

### Primary workflow: investigate an instance trend

1. User opens Config Health and selects an instance.
2. Detail loads independently of trend history. The trend card has a stable reserved height and a
   `Loading trend history…` status.
3. The analysis header states the applied scope in human language, for example:
   `Radarr Main · Overall · Last 30 days · 87 snapshots · local time`.
4. User reads a one-sentence summary before the graphic, for example:
   `Score rose from 72 (Attention) to 88 (Healthy); 2 snapshots were not evaluated.`
5. User inspects the overall score chart and band row. A pointer, keyboard, or tap can select a point
   to show timestamp, score/band, engine version, and measured/not-evaluated criteria.
6. User expands criterion history to see small multiples for overall criterion contributions.
7. User opens `View data` for exact values and boundary rows.
8. User downloads CSV or JSON. The action label and adjacent summary make clear that the download
   uses the same applied instance, scope, time range, criteria, and oldest-to-newest ordering.

Decision points:

- If there are fewer than two measured points, explain that no trend can be inferred and offer a
  wider retained range.
- If unknown or missing points exist, summarize them and expose their reasons where the snapshot
  contract provides one.
- If an engine changes, lead with comparability caution rather than interpreting the numerical jump.
- If requested history predates retained history, distinguish “not retained” from “no snapshot was
  collected.”

### Alternative workflow: inspect one quality profile

1. User changes `Scope` from `Overall` to an exact profile name.
2. The applied filter summary updates and the score/band chart reloads using persisted profile data.
3. If the profile exists in only part of the interval, the chart begins/ends at those real points and
   labels the absent interval `No snapshot for this profile`; it does not extend the first/last value.
4. The criterion-history area is replaced by:
   `Historical criterion contributions were not recorded for profiles in these snapshots.`
5. Table and exports reflect only that exact profile name and selected time range.

Do not merge renamed profiles, trim names, or perform case-insensitive historical matching in the
presentation layer. If a former name is selectable, label it `Profile name in historical snapshots`
or `No longer present` so the user understands what they are viewing.

### Alternative workflow: switch instance

1. User selects another eligible instance from a labelled single-select.
2. Navigate to `/config-health/{instanceId}` and preserve time-range parameters.
3. Reset profile scope to `Overall` unless the exact profile name is returned as available for the
   new instance. Announce the reset: `Scope reset to Overall; that profile is not available here.`
4. Never infer an equivalent profile across Radarr, Sonarr, or Lidarr from name alone.

### Alternative workflow: choose a custom interval

- Offer common presets: `7 days`, `30 days` (default), `90 days`, and `All retained`.
- Offer `Custom` with labelled start and end date inputs. State the display timezone beside them.
- A custom range has one explicit `Apply` action. Until applied, the result summary and download
  actions continue to describe the old range; do not show a new filter label over stale data.
- Invalid ranges are caught before a request. Put the error next to the date fields and focus the
  first invalid field.
- `Clear` returns to the default 30-day overall view for the current instance.

### Export-only workflow

1. User applies instance, profile, time, and criterion visibility filters.
2. UI says `87 snapshots match · oldest to newest` beside `Download CSV` and `Download JSON`.
3. Button enters a format-specific busy state (`Preparing CSV…`) without disabling the other page
   controls globally.
4. On success, announce `CSV downloaded: 87 snapshots` with `role="status"`.
5. On failure, show a non-secret-bearing message with `Retry CSV download`; preserve all filters and
   the displayed chart.

The downloaded filename should be predictable and safe, for example
`config-health-radarr-main-overall-2026-06-10_2026-07-10.csv`, with an ID fallback rather than
unsafely echoing arbitrary names.

## UI/UX Best Practices

### Recommended information architecture

Within the existing instance detail, use one `Trend analysis` section:

1. Section title and applied-result summary.
2. Filter card: Instance, Scope, Time range; custom dates only when selected.
3. Boundary/retention notice when relevant.
4. Plain-language trend summary.
5. Overall/profile score chart with a band row.
6. Overall-only criterion small multiples.
7. `View data` disclosure containing the semantic table.
8. Download actions and exact result count.

Keep current score breakdown and suggestions outside the trend card. “Current state” and “historical
analysis” should not visually blur together.

### Chart 1: score and band over time

- Use an actual-time x-axis, oldest left to newest right. Never distribute points at equal x spacing
  when collection intervals differ.
- Use a stable `0–100` y-axis because scores and band thresholds have product meaning. This enables
  honest comparison across scopes and intervals and prevents a two-point change such as 81→82 from
  appearing dramatic due to auto-zoom.
- Label the y-axis `Health score (0–100)` and the x-axis/timezone in adjacent HTML. Use horizontal,
  legible date labels and reduce tick frequency rather than rotate text.
- Draw light horizontal gridlines at useful round values, plus directly labelled threshold rules at
  `60 · Attention` and `85 · Healthy`. Threshold labels, line style, and position—not background
  colour alone—convey the bands.
- Use one high-contrast solid score line. Add markers for small or irregular series; for dense
  series, show markers for selected, boundary-adjacent, and band-change points to avoid clutter.
- Add a compact categorical band row below the plot on the same x-scale. Segments use direct text
  where space permits and distinct border/pattern tokens. Band changes receive a labelled marker.
  Do not encode band only as red/amber/green background.
- Do not use a smoothed curve. Straight segments respect observed samples.

### Exact non-colour encoding

Use the same encoding in chart, selected-point panel, and table:

| Meaning              | Colour may support | Required non-colour encoding                                                          |
| -------------------- | ------------------ | ------------------------------------------------------------------------------------- |
| Overall score        | Accent line        | Solid line, circular measured-point marker, direct `Score` label                      |
| Healthy              | Green              | `Healthy` text; circle marker at band change; solid band-row border                   |
| Attention            | Amber              | `Attention` text; triangle marker; dashed band-row border                             |
| Needs review         | Red                | `Needs review` text; square marker; double band-row border                            |
| Unknown              | Neutral            | No numeric point; diamond-with-slash/event marker on `Not evaluated` rail; text label |
| Missing snapshot gap | None               | Broken line, blank interval, bracket/annotation `No snapshot` when selected           |
| Engine boundary      | Neutral            | Vertical long-dash rule, `Engine vN` label, line break across boundary                |
| Retention boundary   | Neutral            | Hatched unavailable region or boundary rule plus `Earlier history not retained` text  |
| Selected point       | Accent             | Visible focus ring/crosshair and persistent HTML details panel                        |

Do not rely on line dash alone to distinguish five criterion series: dash patterns are conventionally
used for forecasts/targets and become hard to track. Prefer labelled small multiples.

### Chart 2: criterion history

- Show criterion **contribution points** for `Overall`, since contributions sum to the overall score
  and answer “what drove the change?” Include sub-score, contribution, and weight in selected-point
  details and the table so a weight change is not mistaken for a signal change.
- Use small multiples with a shared x-axis: one panel per enabled or historically present criterion,
  ordered by the canonical criterion catalog. This avoids five overlapping lines and reduces colour
  dependence. The Government Analysis Function recommends no more than four lines in one line chart;
  Praxrr can already have five registered criteria.
- Each panel directly labels the criterion. Use the same 0–100 sub-score axis if displaying
  criterion score. If the primary line is contribution, label the dynamic contribution units and
  show weight changes explicitly; do not imply contributions share a fixed maximum.
- A `Not evaluated` criterion value is a gap and labelled event, never a zero. A disabled criterion
  is different: show a disabled interval/boundary only if contract data proves it was disabled.
- Allow users to hide individual criterion panels with native checkboxes in a labelled fieldset.
  Keep `Show all`/`Hide all` keyboard-operable, and require at least one visible panel only for the
  visual view. Filtering visibility must not silently remove data from export unless the export
  contract explicitly treats criterion selection as a filter and the applied summary says so.
- For a selected profile, omit the criterion chart because old profile snapshots do not contain the
  data. Never display overall instance criteria under a profile heading.

### Unknown, empty, sparse, and dense states

| State                     | Visual behavior                                                    | Required copy/action                                                                                                             |
| ------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| No snapshots ever         | No empty axes; compact empty card                                  | `No health snapshots yet for this instance.` Explain cadence/status; offer Refresh or settings link if appropriate.              |
| No match for filters      | Keep filters and result summary; no chart                          | `No snapshots match this time range and scope.` Offer `All retained` and Clear filters.                                          |
| One measured point        | One large marker at actual time; no horizontal line                | `1 snapshot is available. At least 2 measured snapshots are needed to show a trend.`                                             |
| Two measured points       | Straight segment only if continuous and same engine                | State start/end values and elapsed time; do not claim a stable “trend” beyond the comparison.                                    |
| Unknown point             | Gap in score line; event on not-evaluated rail                     | `Not evaluated`, with criterion reasons if persisted; never `0`.                                                                 |
| Missing expected interval | Break line based on cadence/gap metadata                           | `No snapshot was recorded` for the interval; do not interpolate.                                                                 |
| Retention truncation      | Mark/shade unavailable leading interval                            | `Showing retained history from DATE. Policy: N days or M total snapshots; earlier data may be pruned.`                           |
| Engine change             | Break line and vertical labelled rule                              | `Scoring engine changed from v1 to v2; scores across this boundary may not be directly comparable.`                              |
| Dense history             | Preserve exact table/export rows; reduce rendered marks/ticks only | `N snapshots shown`. If visual downsampling occurs, disclose `Chart simplified visually; table/export contains all N snapshots.` |

Visual downsampling must never change the data table, export, count, extrema, unknown gaps, band-change
points, or engine/retention boundaries. Prefer reducing markers and labels before dropping plotted
points. If point reduction is necessary, use a shape-preserving method and say so explicitly.

### Structured text alternative and data table

W3C's complex-image guidance calls for both a short identification and a long description. Implement
the chart as a `<figure>` with an HTML heading/caption and a nearby summary. The SVG can use
`role="img"` with `aria-labelledby` pointing to a chart title and concise description, but the SVG
accessibility tree is not the data interface.

Provide `View data` immediately after the figure:

- A real `<table>` on desktop with `<caption>`, column headers, and dates in rows.
- A responsive labelled-card view on mobile, preserving the same document order.
- Default row order identical to the API/export contract: oldest to newest, then a deterministic
  tie-breaker that the contract exposes.
- Columns/fields: generated timestamp with timezone, exact scope name, score or `Not evaluated`, band,
  engine version, and each requested criterion's sub-score/contribution/weight when available.
- Boundary rows or notes must be semantic text, not merely decorative SVG lines.
- Do not enable client-side table sorting unless export ordering changes with the same applied sort;
  a sortable visual table beside a fixed-order export would violate user expectations of parity.

### Tooltips and point inspection

- Prefer a persistent selected-point details region below/next to the chart over hover-only tooltips.
- Pointer hover may preview a point, but click/tap or keyboard activation pins it.
- Keyboard path: tab once into the chart point navigator, then Left/Right moves chronologically;
  Home/End goes to first/last. Announce timestamp, score/band, scope, and boundary state.
- Escape clears a pinned overlay. If a floating tooltip is used, it must be dismissible, hoverable,
  and persistent as required by WCAG 1.4.13.
- Do not make hundreds of SVG points separate Tab stops. A roving-focus composite or the data table
  provides equivalent access without creating an unusable focus sequence.
- Any pointer zoom/drag is optional enhancement only; preset/custom date controls are the complete
  keyboard and touch equivalent.

### Responsive behavior

At 320 CSS px and 400% zoom, information and actions must reflow without two-dimensional page
scrolling (WCAG 1.4.10). Recommended behavior:

- Filters: one full-width control per row on small screens, two columns at `sm`, three or four only
  when labels and values fit without truncation.
- Download actions: full-width stacked buttons on narrow screens; never icon-only without an
  accessible and visible contextual label.
- Overall chart: width follows its card; maintain a neutral minimum height around 240–280 px. Reduce
  x-axis tick count and use three to six gridlines on mobile rather than shrinking text.
- Criterion small multiples: one per row on mobile, two columns on wide desktop. Keep the same time
  scale across panels.
- Selected-point details: below the chart on mobile; side panel only where it does not reduce plot
  legibility.
- Data table: use the product's responsive card layout. If a raw wide table is additionally offered,
  place horizontal scrolling inside a named region, not on the whole page.
- Touch targets: at least WCAG's 24×24 CSS px minimum with spacing; target 44 px for primary filter,
  point-navigation, and download actions where layout permits.
- Test portrait/landscape, 320/375/768/1280 px widths, browser zoom to 400%, long instance/profile
  names, localized dates, light/dark themes, and forced-colours mode.

### Accessibility acceptance checklist

- Chart has an HTML heading, concise summary, semantic long-form data alternative, and no duplicated
  screen-reader noise from decorative SVG children.
- Every band, criterion, boundary, selected state, error, and loading state is conveyed in text or
  shape/line style in addition to colour (WCAG 1.4.1).
- Meaningful lines, markers, focus outlines, and control boundaries meet 3:1 contrast against
  adjacent colours (WCAG 1.4.11); ordinary text meets text contrast requirements.
- All filtering, point selection, data-table disclosure, retry, clear, and download actions work by
  keyboard with a logical visible focus order (WCAG 2.1.1).
- Tooltips meet dismissible/hoverable/persistent behavior (WCAG 1.4.13).
- Loading/completion/result-count messages use a polite status region; errors use an alert only when
  immediate attention is required (WCAG 4.1.3).
- Controls have programmatic labels matching their visible labels and expose name, role, value/state.
- The interface reflows at 320 CSS px and does not overlap at desktop or mobile widths.
- Reduced-motion users do not get animated line drawing; refresh uses a minimal spinner/status only.

## Error Handling

| Situation                                       | User-facing message                                                          | Recovery and focus behavior                                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Invalid custom range                            | `Start date must be on or before end date.`                                  | Inline error linked with `aria-describedby`; focus Start; no request.                                                 |
| Range exceeds accepted API bounds               | `Choose a range within retained history.` or server-provided safe limit      | Preserve values, focus affected control, offer All retained.                                                          |
| Instance removed or no longer eligible          | `This Arr instance is no longer available for Config Health.`                | Link to Config Health; instance picker remains if possible.                                                           |
| Profile absent for whole range                  | `No snapshots match profile “NAME” in this range.`                           | Offer Overall, historical profile options, or wider range. Preserve exact displayed name safely.                      |
| Trend request fails while detail succeeds       | `Current health loaded, but trend history could not be loaded.`              | Keep current detail; Retry trend only.                                                                                |
| Some criterion payload is malformed/unsupported | `Some criterion history could not be displayed.`                             | Render verified series, identify omitted criterion generically, keep raw export behavior contract-defined.            |
| Engine boundary metadata missing                | `Scores use more than one engine version; boundary details are unavailable.` | Do not connect/compare ambiguous segments; Retry.                                                                     |
| No network/offline                              | `You're offline. Trend history could not be refreshed.`                      | Preserve last successful chart only if labelled with its loaded scope/time and `Last updated`; Retry on reconnect.    |
| Server error                                    | `Trend history is temporarily unavailable.`                                  | Retry without resetting filters; log technical details server-side, not in UI.                                        |
| Export fails                                    | `CSV download failed. Your filtered view is unchanged.`                      | Retry that format; keep chart/table/filter state.                                                                     |
| Empty export                                    | `No snapshots match these filters.`                                          | If contract permits empty export, keep action enabled and state `0 rows`; otherwise disable with visible explanation. |
| Stale response arrives after filter change      | No message                                                                   | Ignore/abort it; never replace the newer applied result.                                                              |

Error messages should not expose query text, database paths, stack traces, credentials, or raw internal
exceptions. They should identify the failed operation (`trend`, `CSV download`) and provide a next
action. Filter validation is not a global toast; keep it adjacent to the relevant control.

## Performance UX

### Initial and incremental loading

- Load current detail and trend independently, preserving the existing fault isolation.
- Reserve the chart's final height to prevent layout shift. Use a simple skeleton with axes/card
  silhouette or plain status text, not fake data points.
- Put `aria-busy="true"` on the trend result region and announce `Loading trend history…` politely.
- On filter changes, keep the last successful result visible but dimmed with an `Updating…` overlay
  only if its applied-result caption remains unchanged until the new response succeeds. Never pair
  stale data with new filter labels.
- Abort or ignore obsolete requests. Disable only controls whose simultaneous use would cause an
  ambiguous action; refresh/download can have independent busy states.
- On success, announce `87 snapshots loaded for Last 30 days`; do not move focus to the chart.

### Rendering dense data

- Data fetch, count, table, and export remain exact. Rendering optimization is presentation-only.
- Calculate SVG geometry once per response, not on pointer movement. Use a single path per series
  plus a small set of meaningful markers.
- Use event delegation/one focus navigator rather than listeners and Tab stops on every point.
- Lazy-render collapsed criterion small multiples only if their absence does not alter the accessible
  summary/table.
- Avoid automatic refresh for historical ranges. Manual Refresh is sufficient; if auto-refresh is
  later introduced, pause it while a point is pinned and expose the state.

### Offline and stale data

This feature is read-only, so optimistic updates are inappropriate. Praxrr should not promise offline
analysis. If a previously successful result is retained after a network failure, label it explicitly
with the last-loaded timestamp and exact applied filters. Exports must come from the server's
authoritative filtered endpoint, not a potentially stale client reconstruction.

## Competitive Analysis

### Grafana

Grafana combines dashboard time presets/custom ranges and variables with vertical event annotations.
Its panel inspector exposes raw returned data and supports CSV and JSON inspection/export. These are
strong precedents for keeping filter state, boundary/event markers, exact data inspection, and export
close together.

Adopt:

- one shared applied time range;
- vertical, labelled boundary annotations;
- inspectable raw data beside the chart;
- CSV/JSON derived from the same query state.

Avoid:

- hiding export in a multi-level panel menu;
- a dashboard-builder level of controls for a focused product task;
- connecting null values by default, which Grafana itself documents can be deceptive.

### Google Cloud Monitoring

Cloud Monitoring distinguishes visible gaps, sparse sampling, and a true `No data is available for
the selected time frame` state, then suggests increasing the range. It also discloses when display
limits omit series and offers a selected reference time. These are useful models for truthful sparse
states, range recovery, explicit simplification, and pinned point details.

Adopt:

- plain no-data language tied to the selected range;
- visible gaps rather than imputed zeroes;
- persistent selected-time details;
- disclosure whenever a visual limit changes what is rendered.

Avoid:

- pointer-drag as the only way to zoom or select an interval;
- silently changing aggregation/alignment when the range changes. Praxrr should show actual snapshots.

### Datadog

Datadog uses dashboard template variables for scoping and offers common/calendar time frames. Its
widgets can download the data producing the graph as CSV. It also makes the timezone behavior of
custom time frames explicit.

Adopt:

- compact single-value scope filters;
- presets plus custom calendar range;
- explicit browser-local/UTC labeling;
- download actions tied to graph-producing data.

Avoid:

- hiding scope semantics inside wildcard/template syntax;
- separating the export action so far from filters that users cannot verify its scope.

### Accessibility and public-sector chart guidance

The W3C, UK Government Analysis Function, ONS, and Department for Education guidance is more directly
relevant to inclusive chart construction than observability-product precedent. It consistently
supports text alternatives/tables, direct labels, non-colour encoding, restrained line count,
legible axes, sparse-data markers, and gaps for missing regular observations.

## Prioritized Recommendations

### Must have

1. Replace the sparkline with a score chart using real timestamps, fixed 0–100 scale, labelled band
   thresholds, explicit gaps, and no smoothed/interpolated missing data.
2. Treat `band=unknown` as no measured score even when persisted `overall_score` is `0`; render a
   labelled not-evaluated event, not a zero point.
3. Provide a visible summary and semantic table containing the same filtered, deterministically
   ordered records as the API/export.
4. Use non-colour encodings exactly: direct labels, shapes/borders, line styles, and text for bands,
   criteria, selection, engine boundaries, retention boundaries, and missing/unknown states.
5. Provide labelled, URL-representable Instance, Scope, and Time range controls with presets,
   custom-date validation, clear/reset, applied-result count, and timezone disclosure.
6. Keep one instance and one scope per chart. Navigate instance changes; do not build a multi-instance
   overlay for this issue.
7. Show criterion contribution history only for Overall with existing data. For profile scope, state
   that historical criterion contributions were not recorded; never infer them.
8. Break and label the line at every engine-version change. Include per-point engine version in the
   table/export and warn against direct comparison across the boundary.
9. Expose retention policy and actual available range. Mark a retention boundary only from explicit
   API evidence; do not infer it from the first returned point.
10. Handle never-collected, filtered-empty, one-point, sparse, unknown, missing, dense, loading,
    partial failure, and export failure as distinct states with recovery actions.
11. Make chart inspection fully keyboard/touch accessible, use persistent selected-point details,
    and meet WCAG 2.2 AA for colour, contrast, tooltips, reflow, target sizing, labels, and status.
12. Make JSON/CSV buttons use the canonical applied filters/order and show exactly how many records
    will download. Validate parity in UI/API/export tests.

### Should have

1. Use directly labelled criterion small multiples with a shared x-axis instead of a five-line
   overlay; include score, contribution, and weight in details.
2. Preserve the last successful trend during refresh with an unambiguous `Updating…` state and
   unchanged loaded-result caption.
3. Pin selected points with Left/Right/Home/End navigation and a persistent HTML detail panel.
4. Use stable, scope-aware filenames and announce download success/failure.
5. Disclose visual simplification/downsampling and guarantee table/export contain every matching row.
6. Reuse the responsive Table/Card/Button/Badge patterns, but ensure filter controls have real
   programmatic labels.
7. Test forced colours, dark mode, 400% zoom, long exact profile names, mobile widths, keyboard-only,
   touch, and at least one screen reader.

### Nice to have

1. A shareable/copy-link action for the current filter state after the core parity contract is stable.
2. A compact start/end/change statistic row, provided it never summarizes across unknown or engine
   boundaries without a warning.
3. Optional comparison to a prior equal-duration period only in a future issue, with dotted/directly
   labelled encoding and clear non-overlap with engine changes.
4. Deep links from a selected timestamp to relevant Timeline/Sync History events if a precise,
   contract-backed correlation becomes available.

## Open Questions

1. Does “instance filtering” mean a convenient single-instance switcher on the existing detail route,
   or is cross-instance comparison required? Recommendation: single instance for #226; comparison is
   a separate design/research problem.
2. Should the scope selector expose historical profile names that no longer exist? Recommendation:
   yes when present in the selected snapshots, clearly labelled as historical; never merge on rename.
3. Is there a stable profile identifier available across renames? Current snapshots store only exact
   names. Without an ID, a rename must remain two historical names/series.
4. Can the API return explicit `hasEarlier`, earliest retained timestamp, boundary reason
   (`age`, global max-entry cap, collection start), expected cadence, and detected gaps? Without this,
   the UI cannot truthfully distinguish retention from never-collected history.
5. What is the canonical date boundary and timezone contract? Recommendation: API filters use exact
   ISO instants/UTC; UI displays browser-local time with the timezone named; exports retain ISO UTC.
6. What is the canonical CSV shape: one wide row per snapshot/scope or long rows per criterion?
   Recommendation: optimize the accessible table for one snapshot per row; choose/document a stable
   CSV schema before UI implementation and show its row count accurately.
7. Does criterion visibility affect export, or only visual clutter? Recommendation: time/instance/
   scope always filter exports; criterion selection affects export only if the contract and applied
   summary explicitly say so.
8. How will an engine-version change expose threshold/config changes? At minimum each point needs its
   version and the UI must break the line. Ideally boundary metadata explains changed semantics.
9. When retention maximum entries is global, can the service identify why a particular instance's
   first row is the earliest available? If not, copy must say `earliest available`, not `retention
cutoff`.
10. Should an empty filtered export be downloadable? Recommendation: yes, with CSV headers and JSON
    metadata/empty points, because it preserves a predictable API contract; label it as `0 rows`.

## Sources

Primary accessibility and data-visualisation guidance:

- W3C WAI, [Complex Images](https://www.w3.org/WAI/tutorials/images/complex/) — charts require a
  short description plus a long, structured equivalent; visible descriptions and tables are valid.
- W3C, [Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/) — normative AA
  requirements including reflow, keyboard operation, and minimum target size.
- W3C WAI, [Understanding Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color) —
  colour cannot be the only visual means; use shape or text as well.
- W3C WAI,
  [Understanding Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast) —
  meaningful graphical objects and UI state cues require 3:1 contrast against adjacent colours.
- W3C WAI,
  [Understanding Content on Hover or Focus](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html) —
  custom tooltips must be dismissible, hoverable, and persistent.
- W3C WAI, [Understanding Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard) and
  [Understanding Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages) —
  all functionality needs keyboard equivalence and asynchronous status must be programmatically
  determinable without disruptive focus movement.
- UK Government Analysis Function,
  [Accessible charts: a checklist of the basics](https://analysisfunction.civilservice.gov.uk/policy-store/charts-a-checklist/) —
  declutter charts, keep labels legible/horizontal, directly label lines, and avoid overplotting.
- UK Government Analysis Function,
  [Data visualisation: colours](https://analysisfunction.civilservice.gov.uk/policy-store/data-visualisation-colours-in-charts/) —
  direct labels and a plain-text/table alternative are needed even when line contrast passes.
- ONS Service Manual,
  [Data over time: Line chart](https://service-manual.ons.gov.uk/data-visualisation/chart-types/line-chart) —
  use data markers for small/irregular series, leave gaps for missing regular data, and consider small
  multiples when multiple lines crowd a chart.
- ONS Service Manual,
  [Axes and gridlines](https://service-manual.ons.gov.uk/data-visualisation/guidance/axes-and-gridlines) —
  use meaningful scales and fewer gridlines on mobile.
- Department for Education Design System,
  [Charts](https://design.education.gov.uk/design-system/patterns/charts) — every chart needs a text
  version; use a data table when exact data is needed and make interaction keyboard accessible.

Competitive product references:

- Grafana,
  [Use dashboards](https://grafana.com/docs/grafana/latest/visualizations/dashboards/use-dashboards/),
  [Annotate visualizations](https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/annotate-visualizations/),
  and [Panel inspect view](https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/panel-inspector/).
- Grafana,
  [Troubleshoot dashboards](https://grafana.com/docs/grafana/latest/visualizations/dashboards/troubleshoot-dashboards/) —
  connecting null values can be deceptive.
- Google Cloud Monitoring,
  [Troubleshoot charts](https://cloud.google.com/monitoring/charts/troubleshooting-charts) and
  [Explore charted data](https://cloud.google.com/monitoring/charts/working-with-charts).
- Datadog, [Template Variables](https://docs.datadoghq.com/dashboards/template_variables/),
  [Custom Time Frames](https://docs.datadoghq.com/dashboards/guide/custom_time_frames/), and
  [Widget Configuration](https://docs.datadoghq.com/dashboards/widgets/configuration/).
