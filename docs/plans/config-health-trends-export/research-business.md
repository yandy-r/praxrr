# Config Health Trends and Export — Business Analysis

## Executive Summary

Issue #226 turns Config Health's existing snapshot history into an inspection and export surface. Its
business purpose is not to create another score, forecast future health, or reinterpret old data. It
lets an operator answer three evidence-based questions:

1. How did this instance or quality profile's measured health change over the selected period?
2. Which instance-level criteria contributed to measured changes, and where is the evidence absent?
3. Can I export exactly the same filtered, ordered evidence for offline review or support?

The append-only `config_health_snapshots` table remains the source of truth. Every consumer must use
one canonical filtered and ordered record set. The chart, accessible tabular representation, JSON
export, and CSV export must therefore agree on included snapshots, scope, timestamps, engine versions,
scores, bands, and criterion values. No consumer may silently refilter, reorder, interpolate, or turn
missing/unknown evidence into zero.

The foundation already retains overall score/band, overall criterion results, and light per-profile
score/band values. It does **not** retain per-profile criterion results. Consequently, this issue can
truthfully provide:

- overall score, band, and criterion score/contribution trends for an instance; and
- score and band trends for a selected profile.

It cannot produce historical per-profile criterion contributions from existing snapshots. Such data
must be shown as unavailable rather than reconstructed from current configuration or copied from the
instance-wide breakdown.

## User Stories

### Primary users

- **Self-hosted operator:** I want to select one Arr instance and a useful time range so I can see
  whether configuration health is improving, stable, or degrading without reading raw database rows.
- **Profile maintainer:** I want to select a quality profile within an instance so I can inspect that
  profile's own score and band history without confusing it with the instance rollup.
- **Troubleshooter:** I want to compare criterion scores and contributions over time so I can identify
  which measured area coincided with an overall change.
- **Accessibility user:** I want every trend conveyed through text, symbols, and a table—not color or
  pointer-only interaction—so the same evidence is available with a keyboard or screen reader.
- **Mobile operator:** I want charts, controls, annotations, and tables to remain readable at narrow
  widths without overlaps or hidden values.
- **Support/audit user:** I want JSON or CSV containing the exact filtered and ordered trend evidence
  represented by the API so I can attach it to an issue, analyze it elsewhere, or retain a point-in-time
  copy.
- **Cautious decision-maker:** I want retention cuts, engine changes, unknown results, and sampling gaps
  called out so I do not infer continuity or comparability that the evidence cannot support.

### Problems solved

- The current 30-day sparkline exposes only overall scores and visually connects every returned point.
- A band change or criterion-driven change cannot be inspected historically.
- A single point, no points, and unknown points have no explicit trend meaning.
- The current trend response reports the current engine version at the response level even though
  stored points can span multiple engine versions.
- Historical evidence cannot currently be exported using the same selection as the UI.

## Business Rules

### 1. Evidence and scope rules

1. Persisted snapshots are the sole historical evidence. The trend surface must never recompute an old
   score from current configuration, backfill missing intervals, or use live detail data as a substitute
   for a missing snapshot.
2. A selection has exactly one eligible, enabled, sync-capable instance and one scope:
   - `overall`; or
   - one exact profile name present in that instance's retained snapshot history.
3. Changing the instance resets the profile scope to `overall` unless the selected profile is explicitly
   present for the new instance. A coincidentally equal profile name on another instance does not make it
   the same history.
4. Profile identity in current snapshots is name-based. Matching must use the exact persisted name; it
   must not trim, case-fold, or fuzzy-match identifiers. A rename therefore creates a visible history
   discontinuity unless stable identity is added in a future contract.
5. Overall scope exposes overall score, band, and persisted overall criteria. Profile scope exposes only
   the selected profile's persisted score and band. Per-profile criteria are unavailable in historical
   snapshots and must not be inferred.
6. A profile missing from a particular retained snapshot is **absent at that time**, not scored zero and
   not `unknown`. The profile series must contain a gap for that snapshot/time.
7. Historical rows denormalize instance name and Arr type. Display/export should use the values persisted
   on each point when representing history, while the selector may use the current instance label.

### 2. Time-range rules

1. The default selection is `overall` for the page's instance over the last 30 days, preserving the
   foundation's current default while making it explicit.
2. Useful built-in ranges should include at least 7, 30, and 90 days plus **all retained history**.
   If custom bounds are included, both date-only and ISO date-time values must normalize to UTC; a
   date-only lower bound means start of day and a date-only upper bound means end of day.
3. Filtering uses persisted `generatedAt`, not insertion/bookkeeping time.
4. Lower and upper bounds are inclusive. A lower bound after the upper bound is invalid and must produce
   a validation error rather than an empty chart.
5. All retained history means every matching retained row; it does not imply history before retention
   pruning or before snapshots were enabled.
6. Rows are ordered oldest to newest by normalized `generatedAt`, then by immutable snapshot id ascending
   for deterministic ordering of equal timestamps.
7. The API owns ordering. The UI and exporters must not perform a different client-side sort.

### 3. Score, band, and criterion rules

1. A numeric score is measured evidence only when its band is not `unknown`.
2. `unknown` means every enabled criterion for that scored unit was skipped. It is neither a score of
   zero nor a band worse than `needs-review`.
3. The trend contract should expose the effective score as `null` when the persisted band is `unknown`,
   even though the foundation stores an integer rollup column. JSON exports use `null`, CSV uses an empty
   cell, and visualizations use a gap/unknown marker—not a zero-height point.
4. A criterion with `score: null` was present but not evaluated. Its criterion score and contribution
   line must break at that point. Its contribution value must not be presented as evidence of a measured
   zero.
5. A criterion absent from a snapshot is distinct from a present criterion whose score is `null`:
   - absent = not part of the persisted result for that engine/snapshot;
   - null = part of the result but unmeasurable.
6. Criterion series are keyed by stable criterion id, labeled using contract/catalog metadata, and shown
   in canonical criterion order. Labels alone are not identity.
7. Contributions are persisted integer points into the 0–100 rollup. They may only be compared within
   the same engine-version segment and while the criterion is measured.
8. Health bands use their persisted value. Clients must not derive historical bands from hardcoded
   thresholds because policy may differ between engine versions.
9. The surface may summarize change only between comparable measured points in the same engine version.
   It must not calculate a delta across `unknown`, absence, a gap, or an engine-version boundary.

### 4. Empty, sparse, unknown, loading, and error states

The states are mutually distinguishable and must use explicit text:

- **Loading:** a request for the current selection is in flight. Existing data may remain visible only
  if clearly marked stale/loading; late responses from a prior selection must never replace newer data.
- **No retained snapshots:** no snapshot exists for the selected instance in retained history. Explain
  that snapshots are produced by Config Health runs and may be affected by enablement/retention.
- **No data in range:** retained snapshots exist for the instance but none match the selected range.
  Offer a wider/all-retained range; do not present this as a scoring failure.
- **Profile absent in range:** instance snapshots exist, but the selected profile appears in none of
  them. Preserve the distinction from an unknown score.
- **Sparse:** exactly one measured point exists, or multiple returned records do not yield two comparable
  measured points in one engine segment. Show the point(s), state that a trend cannot yet be determined,
  and do not draw a directional line.
- **Unknown:** one or more returned snapshots explicitly carry the `unknown` band or null criterion
  score. Retain those timestamps as unknown markers/gaps; do not omit them from the table/export.
- **Partial/mixed:** measured and unknown/absent points coexist. Show measured segments and explicit
  gaps, with counts available in the accessible summary.
- **Error:** validation, not-found, or internal failure. Preserve the current selection, provide a retry
  path where retry can help, and do not replace an error with an empty-data message.

### 5. Missing-data and continuity rules

1. The horizontal axis must be time-scaled from actual timestamps. Equal visual spacing for irregularly
   spaced snapshots would misrepresent elapsed time.
2. Unknown and absent points always break a line.
3. A long interval without snapshots must be visually discontinuous rather than joined as continuous
   improvement/degradation. Because the database does not retain historical cadence changes or expected
   snapshot slots, the product must describe such a break as a **sampling gap**, not claim which runs
   failed or were skipped.
4. No smoothing, interpolation, prediction, or anomaly labeling is in scope.
5. Markers and accessible text must identify the exact timestamp and state at every observed point; color
   is supplementary only.

### 6. Retention-boundary rules

1. Retention is a global policy applied age-first and then by a global row cap. The current defaults are
   90 days and 5,000 rows, but the surface must use live settings rather than hardcoded values.
2. The count cap is across all instances, not per instance. Therefore a short history for one instance
   may result from fleet-wide pruning; the UI must not promise `retentionDays` of data per instance.
3. A retention notice is relevant when:
   - the requested range starts before the earliest retained matching evidence;
   - all-retained history is selected; or
   - the result is empty/sparse and retention may explain the missing history.
4. The notice states the current age and count policy, the earliest returned/retained timestamp when
   known, and that older points **may** have been pruned. It must not assert whether age or count pruning
   removed a specific missing row because the current schema records no prune provenance.
5. The earliest returned point is not automatically the start of scoring. It is only the earliest
   evidence retained for the selection.
6. Export metadata must include the effective selection and retention context so downloaded evidence
   does not lose this boundary.

### 7. Engine-version-boundary rules

1. Every trend point carries its persisted `engineVersion`; a single current response-level version is
   insufficient evidence for historical points.
2. Points are partitioned into contiguous engine-version segments in time order.
3. Charts break all score, band, criterion, contribution, and delta lines at an engine-version change.
   Scores on opposite sides may be displayed, but not treated as like-for-like improvement/degradation.
4. A visible boundary annotation states the old and new engine versions and the first timestamp using
   the new version. The accessible table/export carries the version on every point.
5. A criterion id reused across versions still cannot be compared across the boundary because formula,
   weight, thresholds, or rollup behavior may have changed.
6. Criteria that appear/disappear at a boundary are unavailable outside their owning segment, never zero.
7. The current engine version may be shown separately from historical versions, clearly labeled as the
   current policy rather than the version of all points.

### 8. Filter, ordering, and export invariants

1. One shared filter parser and one shared historical query/projection define instance, profile, time
   bounds, point inclusion, and ordering for the trend response and both export formats.
2. The response echoes the normalized filters and scope. This lets the UI and downloaded artifact state
   exactly what was requested and applied.
3. JSON export contains the same canonical trend response data (including metadata and ordered points)
   as the non-download JSON API for that selection. Download headers may differ; domain content may not.
4. CSV is a deterministic lossless tabular projection of those same points. Recommended long-form order:
   - primary: trend-point order (`generatedAt`, snapshot id);
   - secondary: scope summary row before criterion rows;
   - tertiary: canonical criterion order/id.
5. CSV repeats point identity, scope, score, band, engine version, and boundary/state columns as needed so
   each row is intelligible. Null/absent values remain blank with an explicit state column; they are not
   serialized as `0`.
6. Empty exports are successful: JSON contains metadata plus `points: []`; CSV contains stable headers
   and no data rows.
7. Exports must not silently truncate. If a safety limit is required, the request must fail with an
   explicit error or the artifact must carry machine-readable truncation metadata that the UI also
   displays. A logged-only cap would violate exact parity.
8. CSV follows RFC 4180 escaping and neutralizes spreadsheet formula prefixes in externally influenced
   text such as instance/profile/criterion labels. JSON remains valid UTF-8 JSON.
9. Unsupported formats or invalid filters return a validation error; they do not silently fall back to a
   default format or broaden the selection.
10. Export filenames identify Config Health, the selected instance/scope, and export time without using
    unsafe raw names.

### 9. Accessibility and responsive presentation rules

1. Every chart has an accessible name, a concise textual summary, and a tabular representation containing
   every returned point/state.
2. Band and engine boundaries use text/symbol/pattern in addition to color. Criterion series remain
   distinguishable in monochrome and high-contrast modes.
3. Tooltips are reachable by keyboard and pointer, do not contain exclusive information, and do not
   obscure focus.
4. Controls have programmatic labels and logical focus order; filter changes and errors are announced
   without unexpectedly moving focus.
5. At mobile widths, controls may stack and charts may horizontally scroll within their own region, but
   page-level horizontal overflow, overlapping labels, clipped boundary annotations, and unreachable
   export actions are unacceptable.
6. Reducing visible axis-label density must not remove exact values from the accessible table/export.

## Workflows

### Workflow A: Inspect an instance trend

1. User opens Config Health and chooses an eligible instance.
2. Detail loads with `overall` and 30 days as the explicit default selection.
3. The UI fetches one canonical trend response and renders loading until that request resolves.
4. The response is classified as empty, sparse, mixed, or sufficiently measured.
5. The UI renders score and persisted band over actual time, breaks unknown/gaps/version changes, and
   annotates relevant retention and engine boundaries.
6. The user can inspect exact values through keyboard-accessible point details or the equivalent table.

### Workflow B: Inspect criterion drivers

1. From overall scope, user opens or toggles criterion series.
2. Each persisted criterion score and contribution is aligned to its owning snapshot and engine segment.
3. Null/absent criterion data appears as a gap with an explicit reason state.
4. User correlates measured overall changes with criterion evidence; the UI does not claim causality or
   rank an absent/unmeasured criterion.

### Workflow C: Inspect a profile

1. User selects a profile name available in retained snapshots for the selected instance.
2. The same time filter is retained.
3. Each snapshot is projected to the selected profile's score/band; snapshots without that exact profile
   become absent points/gaps.
4. The UI states that historical profile criterion contributions were not retained and keeps the
   instance-level criterion chart out of the profile scope.
5. If no matching point exists, user is offered overall scope, another profile, or a wider range.

### Workflow D: Change time range or instance

1. User changes a filter.
2. The selection is validated and normalized; invalid custom bounds remain editable with a specific
   message.
3. Any prior request is made stale/cancelled and cannot overwrite the new selection.
4. Instance changes reset invalid profile selections.
5. Data and annotations rerender from the newly returned canonical record set.

### Workflow E: Export filtered evidence

1. User establishes instance, scope/profile, and time range in the UI.
2. User selects JSON or CSV.
3. Export uses the exact normalized selection; it does not fetch an unfiltered superset for client-side
   processing.
4. Server emits the same canonical ordered points and boundary/state semantics as the trend API.
5. Empty data produces a valid empty artifact; invalid selection shows a validation error; server failure
   preserves the selection and offers retry.

### Error recovery

- **Invalid instance/profile/bounds/format:** show field-specific validation; do not issue or broaden the
  export.
- **Instance removed or no longer eligible:** return not-found/unavailable and offer the Config Health
  instance list. Do not silently select another instance.
- **Trend request fails after live detail succeeds:** preserve live detail, show a trend-specific error,
  and allow trend retry.
- **Export fails:** keep the on-screen trend and filters intact; retry creates a new export from the same
  normalized selection.
- **Malformed historical JSON:** do not fabricate criteria/profile values. Surface affected snapshot
  data as unavailable and log the integrity failure; preserve usable point identity/boundary evidence.

## Domain Model

### Entities and value objects

| Concept                | Business meaning                                         | Key invariants                                                                                       |
| ---------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Config Health snapshot | Immutable measured evidence for one instance at one time | One engine version; one overall score/band; persisted overall criteria; light profile scores         |
| Trend selection        | The user's requested evidence slice                      | One instance, one scope, normalized inclusive time range, explicit format only for export            |
| Trend point            | Canonical projection of one retained snapshot            | Stable snapshot id, persisted timestamp/version/identity, nullable effective score, explicit state   |
| Overall scope          | Instance-wide historical view                            | Score, band, criteria, and contributions are available as persisted                                  |
| Profile scope          | Exact profile-name historical view within one instance   | Score/band only; missing profile is absence; criteria unavailable                                    |
| Criterion observation  | One criterion at one snapshot                            | Numeric measured, present-but-unknown, or absent; contribution comparable only within engine segment |
| Engine segment         | Contiguous ordered points produced by one engine version | No deltas or continuous lines across segment boundaries                                              |
| Sampling gap           | Interval where continuity is not evidenced               | Never filled or assigned a cause without provenance                                                  |
| Retention context      | Current age/count policy plus observed earliest evidence | Describes limits, not proof of which rows were pruned                                                |
| Export artifact        | Downloadable representation of the canonical selection   | Same filters, points, states, versions, and ordering as API/UI                                       |

### View-state transitions

```text
uninitialized
  -> loading(selection)
      -> loaded-empty
      -> loaded-sparse
      -> loaded-mixed-or-measured
      -> validation-error
      -> not-found
      -> request-error

loaded-* --filter change--> loading(new selection)
request-error --retry--> loading(same selection)
loaded-* --export--> exporting(same normalized selection) --> success | export-error
```

Unknown/absent are point states inside a loaded result; they are not transport errors. Retention and
engine changes are evidence boundaries inside a loaded result; they are not reasons to discard data.

## Existing Codebase Integration

### Existing foundation to preserve

- `config_health_snapshots` is append-only and already stores denormalized instance identity,
  `engine_version`, overall score/band, overall `criteria_scores`, light `profile_scores`, and
  `generated_at`.
- `configHealthSnapshotsQueries.getTrend()` already filters one instance and orders by
  `datetime(generated_at) ASC, id ASC`; expanded filtering/export must preserve this deterministic
  ordering.
- Snapshot retention runs daily, pruning by age and then by the global maximum entry count.
- `ConfigHealthTrendsResponse` currently contains only response-level engine version and overall
  score/band points. It needs a contract-first evolution before richer routes/UI are changed.
- `/config-health/[instanceId]` currently fetches live detail first and treats its fixed 30-day
  sparkline as supplementary. Trend failure should remain isolated from live-detail success.
- The shared health contract defines `unknown` as all enabled criteria skipped and criterion `null` as
  not evaluated/excluded; trend semantics must remain aligned.
- Health-band labels/classes and narration conventions already communicate non-judgmentally.
- Sync History provides useful export precedents: shared date normalization, JSON/CSV attachments,
  RFC-4180 escaping, formula-injection defense, and explicit invalid-filter handling. Config Health
  must additionally avoid Sync History's logged-only truncation pattern because exact parity is an
  explicit acceptance criterion here.

### Integration constraints

- Contract-first means OpenAPI paths/schemas are updated, generated API types are regenerated, and
  runtime response mappers/validators remain in lockstep before UI consumption.
- Existing snapshots support overall criterion history but not per-profile criterion history.
- Current instance routes require an active sync-capable instance even though snapshot rows survive
  deletion with `arr_instance_id = null`; deleted-instance history is not currently addressable by a
  stable historical instance key.
- Snapshot timestamps are evidence times; `created_at` is bookkeeping and must not drive filtering.
- Criterion and band policy are versioned. Current constants/catalog metadata cannot be assumed to
  describe every historical engine version.
- This issue must not add a second analytics datastore, predictive scoring, anomaly detection, or
  change retention semantics.

## Measurable Success Criteria

1. For fixtures spanning at least two instances, three profiles, equal timestamps, unknown criteria,
   absent profiles, and two engine versions, the trend API returns only matching records in
   `generatedAt ASC, snapshotId ASC` order.
2. For every selection fixture, UI table, downloadable JSON, and parsed CSV identify the same ordered
   snapshot set and normalized filters. CSV criterion rows preserve the documented secondary order.
3. Unknown overall/profile scores render as a dash/gap and export as JSON `null` / CSV blank plus an
   explicit `unknown` state; no test or screenshot represents them as measured zero.
4. A single comparable point produces the sparse message and no directional line/delta.
5. Unknown, absent-profile, sampling-gap, and engine-version fixtures each break the visual series and
   retain their timestamp/state in the accessible table and export.
6. Engine-version fixtures show a visible and screen-reader-readable boundary and never compute a delta
   across it.
7. Selecting a profile returns only its exact name matches; missing snapshots remain gaps. No historical
   per-profile criterion values are emitted unless the persistence contract is explicitly expanded.
8. A range older than retained evidence shows current age/count retention settings, the earliest known
   evidence, and cautious `may have been pruned` language.
9. Empty and no-data-in-range fixtures yield distinct messages and valid empty JSON/CSV artifacts.
10. Invalid instance, time bounds, profile, and export format return explicit validation/not-found
    outcomes without falling back or broadening filters.
11. Automated accessibility checks find no serious violations; keyboard users can operate filters,
    inspect exact values, reach the data table, and export without pointer-only interactions.
12. At representative 320 px, 768 px, and desktop widths, controls and annotations do not overlap,
    page-level horizontal scrolling is absent, and exact data remains reachable.
13. Focused Config Health tests, type checks, and end-to-end tests pass, including the issue's required
    commands: `deno task test config-health`, `deno task check`, and `deno task test:e2e` (or a documented
    environment blocker for E2E).

## Open Questions

1. **Per-profile criterion history:** Is score/band-only profile history acceptable for #226? Existing
   snapshots do not persist profile criteria. If per-profile criterion trends are mandatory, should the
   issue expand future snapshot payloads while explicitly showing older rows as unavailable?
2. **Deleted instances:** Must users export history after an instance is deleted? Current `ON DELETE SET
NULL` rows preserve evidence but lose a unique queryable instance id, so supporting this requires a
   durable historical key or a separately agreed identity rule.
3. **Profile renames:** Should old and new names remain separate truthful series (recommended for current
   data), or is a durable profile identity/mapping required before rename continuity can be claimed?
4. **Sampling-gap threshold:** What disclosed rule marks a long interval as a gap? Historical cadence is
   not stored. A threshold based only on current cadence can mislabel periods after cadence changes;
   storing cadence provenance is outside the present snapshot contract.
5. **Instance comparison:** Does “instance filtering” mean a single-instance selector (consistent with
   the current detail route), or is a multi-instance overlay expected? Multi-instance comparison adds
   scale, identity, and global-retention interpretation decisions not stated in issue #226.
6. **Time controls:** Are 7/30/90/all-retained presets sufficient, or is a custom inclusive date range
   required for acceptance? Export parity rules support either, but the UX and validation scope differ.
7. **CSV shape:** Confirm the recommended long form (summary row plus criterion rows per point) versus a
   wide criterion-column format. Long form better preserves criteria that appear/disappear across engine
   versions; either choice must be stable and lossless.
8. **Historical labels/catalog:** When an old engine version's criterion label differs from the current
   catalog, should the API use the label persisted in `criteria_scores` (recommended) and expose current
   catalog metadata separately?
9. **Export safety limit:** What operational maximum is acceptable? Exact parity forbids silent
   truncation; rejecting an oversized export with an explicit error is safer than returning incomplete
   evidence.
