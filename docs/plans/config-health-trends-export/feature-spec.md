# Feature Spec: Config Health Trends and Export

## Executive Summary

Issue #226 replaces the Config Health detail page's fixed 30-day sparkline with an accessible,
filterable analysis surface for persisted overall and profile health history. The existing
`config_health_snapshots` table remains the sole historical source: the implementation adds one
canonical bounded query/projection used by the chart API, semantic table, JSON attachment, and CSV
attachment in deterministic `generated_at ASC, id ASC` order. Overall scope shows score, band, and
persisted criterion score/contribution changes; exact-name profile scope shows only its persisted
score/band because old snapshots do not contain profile criterion history. Native route-local SVG,
explicit unknown/absence/version boundaries, cautious retention context, and a complete tabular
alternative satisfy the accessibility and evidence-fidelity requirements without a new datastore or
chart dependency.

## External Dependencies

### APIs and Services

No external runtime API or hosted analytics service is required. All requests stay on the existing
authenticated, same-origin SvelteKit API and use the existing SQLite application database.

#### Praxrr Config Health API

- **Authentication**: Existing global session or `X-Api-Key` middleware. Generated browser download
  links use the session cookie and never contain an API key.
- **Endpoints**:
  - `GET /api/v1/config-health/{instanceId}/trends`: canonical filtered trend response.
  - `GET /api/v1/config-health/{instanceId}/trends/export`: JSON or CSV attachment produced from the
    same canonical result.
- **Limits**: At most 10,000 matching snapshot points; query 10,001 and fail with `422` rather than
  silently truncating. This exceeds the default fleet-wide retention cap of 5,000 while bounding
  configured extremes.
- **Pricing/rate limits**: None external. Exact point bounds and request cancellation provide the
  initial resource controls.

### Libraries and SDKs

| Library        | Version                        | Purpose                            | Decision                               |
| -------------- | ------------------------------ | ---------------------------------- | -------------------------------------- |
| Svelte         | Existing lockfile resolution   | UI and escaped inline SVG          | Reuse                                  |
| SvelteKit      | Existing lockfile resolution   | Authenticated JSON/download routes | Reuse                                  |
| SQLite wrapper | Existing repository dependency | Static parameterized history query | Reuse                                  |
| Chart library  | None                           | Time-series rendering              | Do not add; build focused SVG geometry |

### External Documentation

- [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0.html): response media types and contract source.
- [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259.html): JSON representation.
- [RFC 4180](https://www.rfc-editor.org/rfc/rfc4180.html): CSV records and escaping.
- [RFC 6266](https://www.rfc-editor.org/rfc/rfc6266.html): attachment filenames.
- [OWASP CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection): spreadsheet formula
  neutralization.
- [W3C WAI Complex Images](https://www.w3.org/WAI/tutorials/images/complex/): chart summary and
  structured equivalent.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/): keyboard, color, contrast, reflow, focus, and status
  requirements.

## Business Requirements

### User Stories

**Primary User: Self-hosted Praxrr operator**

- As an operator, I want to inspect health score and band changes over 7, 30, 90, custom, or all
  retained history so that I can understand measured change without reading raw rows.
- As an operator, I want to inspect overall criterion scores and contributions so that I can see
  which measured areas changed alongside the total.
- As an operator, I want to select an exact historical profile so that I can inspect its own stored
  score/band history without confusing it with the instance rollup.
- As an operator, I want engine changes, unknown observations, and retention limits identified so
  that I do not compare evidence that is absent or governed by different scoring policy.
- As an operator, I want JSON and CSV downloads of the exact applied dataset so that offline analysis
  and support artifacts agree with the UI.

**Secondary User: Keyboard, screen-reader, touch, or mobile user**

- As a non-pointer user, I want labelled filters, textual summaries, and a complete chronological
  table so that every chart fact is available without hovering or perceiving color.
- As a mobile user, I want controls, legends, boundaries, and export actions to reflow without page-
  level horizontal overflow or overlapping labels.

### Business Rules

1. **Persisted evidence only**: Never recompute, backfill, smooth, interpolate, or infer a historical
   observation from current configuration.
2. **Single-instance scope**: `instanceId` remains the path parameter. Switching instance navigates to
   another detail route; multi-instance overlays are out of scope.
3. **Exact profile identity**: A profile filter matches the exact stored name without trimming,
   case-folding, fuzzy matching, or cross-Arr inference. A rename is a visible discontinuity.
4. **Truthful profile scope**: Old snapshots prove profile score/band only. Do not display overall
   criteria under a profile heading or invent historical per-profile criteria.
5. **Deterministic order**: Every representation preserves `generatedAt ASC, snapshotId ASC`.
6. **Unknown is not zero**: Stored `band='unknown'` maps to wire `score=null`. A skipped criterion maps
   to nullable score/contribution with an explicit state.
7. **Gaps remain gaps**: Unknown points, absent profiles, malformed/unrecorded breakdowns, and engine
   changes break visual segments. A single measured point is a marker, not a directional line.
8. **No invented cadence**: Plot actual timestamps. Do not label a long interval as a missed run or
   retention event without provenance.
9. **Engine comparability**: Carry the stored engine version per point, label each transition, and
   never calculate a cross-version delta.
10. **Retention wording**: Report current global age/count policy and earliest available evidence.
    Say older data may have been pruned; do not claim which policy removed a point.
11. **One canonical result**: Trend JSON and both attachments call the same filter parser, query, and
    projector. CSV serialization may flatten values but cannot select or reorder points.
12. **Exact overflow**: A result over 10,000 points fails atomically with `422`; no response or export
    silently omits data.
13. **Safe downloads**: JSON is lossless. CSV uses fixed columns, CRLF, RFC 4180 escaping, formula
    neutralization, blank nullable cells, and an explicit point state.
14. **Empty success**: A valid empty selection returns `200`; JSON includes metadata and `points: []`,
    while CSV contains its header row only.

### Edge Cases

| Scenario                              | Expected Behavior                             | Notes                                                    |
| ------------------------------------- | --------------------------------------------- | -------------------------------------------------------- |
| No retained snapshots                 | Explicit never-collected/retained empty state | Do not render empty axes                                 |
| No points in selected range           | Filtered-empty state with wider/all action    | Distinct from scoring failure                            |
| One comparable point                  | Marker and sparse explanation                 | No line or change statistic                              |
| Unknown overall band                  | Null score, unknown marker/table state        | Never plot at zero                                       |
| Criterion not evaluated               | Criterion gap and `not-evaluated` state       | Contribution is null on wire                             |
| Selected profile absent at a snapshot | Preserve timestamp as `profile-missing`       | Break the series                                         |
| Profile criteria requested            | Explain not historically recorded             | Profile score/band remains usable                        |
| Equal timestamps                      | Order by snapshot id ascending                | Export and table match                                   |
| Engine changes                        | Boundary label and hard segment break         | Per-point version retained                               |
| Malformed stored JSON                 | Safe point identity plus `not-recorded`       | Log bounded metadata only                                |
| Range exceeds cap                     | `422` with narrow-range guidance              | No partial artifact                                      |
| Concurrent new snapshot               | Export uses absolute applied bounds           | `throughSnapshotId` deferred unless tests prove required |
| Instance removed/unsupported          | Existing indistinguishable `404`              | No sibling-app fallback                                  |

### Success Criteria

- [ ] Users can inspect overall score, band, criterion score, and criterion contribution changes over
      selectable time ranges.
- [ ] Users can switch among active sync-capable instances and exact historical profile score/band
      scopes without inferred cross-instance or cross-Arr identity.
- [ ] Unknown, absent, malformed, sparse, and engine-boundary evidence is never rendered or exported
      as measured zero or an uninterrupted trend.
- [ ] Trend JSON, JSON attachment, parsed CSV point identities, semantic table, filters, counts, and
      order agree for every tested selection.
- [ ] Charts expose text/shape/line encodings, a concise summary, keyboard/touch inspection, and a
      complete table; mobile and desktop layouts do not overlap.
- [ ] Retention and engine-version boundaries are visible and use evidence-bounded language.
- [ ] Focused Config Health tests, type checks, E2E coverage, OpenAPI generation/bundling, formatting,
      lint, and graph update pass.

## Technical Specifications

### Architecture Overview

```text
config_health_snapshots + config_health_settings
                 |
                 v
configHealthSnapshotsQueries.searchTrend(instance, absolute bounds, cap + 1)
                 |
                 v
parseTrendFilters + buildConfigHealthTrendResult
       |                                  |
       v                                  v
GET .../trends                    GET .../trends/export
canonical JSON                    same result -> JSON or CSV attachment
       |
       v
detail-page request state
       |
       +--> accessible SVG score/band + criterion charts
       +--> textual summary + chronological semantic table
       +--> export URLs from normalized absolute filters
```

### Data Models

#### Existing `config_health_snapshots`

No migration, second table, or new column is required.

| Field                        | Type                   | Use                                                  |
| ---------------------------- | ---------------------- | ---------------------------------------------------- |
| `id`                         | integer PK             | Stable equal-timestamp tiebreak and export identity  |
| `arr_instance_id`            | nullable integer FK    | Active instance scoping                              |
| `instance_name` / `arr_type` | text                   | Persisted identity context                           |
| `engine_version`             | text                   | Per-point comparability boundary                     |
| `overall_score` / `band`     | integer / text         | Overall observation; unknown score maps to null      |
| `criteria_scores`            | JSON text              | Overall criterion score, weight, contribution, label |
| `profile_scores`             | JSON text              | Exact profile name, score, band only                 |
| `generated_at`               | canonical ISO UTC text | Inclusive filtering and primary order                |

Use the existing `(arr_instance_id, generated_at DESC)` index with lexical canonical ISO bounds.
Fetch `limit + 1`; do not wrap indexed values in `datetime()` for the new bounded query.

#### Canonical Trend Result

```ts
type TrendPointState =
  'measured' | 'unknown' | 'profile-missing' | 'not-recorded';
type TrendCriterionState = 'measured' | 'not-evaluated' | 'not-recorded';

interface ConfigHealthTrendPoint {
  snapshotId: number;
  generatedAt: string;
  engineVersion: string;
  state: TrendPointState;
  score: number | null;
  band: HealthBand | null;
  criteria: ConfigHealthTrendCriterion[];
}

interface ConfigHealthTrendResult {
  instance: { id: number; name: string; arrType: HealthArrType };
  currentEngineVersion: string;
  normalizedFilter: { from?: string; to?: string; profile?: string };
  retention: {
    days: number;
    maxEntries: number;
    ageCutoffAt: string;
    oldestAvailableAt: string | null;
    newestAvailableAt: string | null;
  };
  availableProfiles: string[];
  counts: {
    points: number;
    measured: number;
    unknown: number;
    missing: number;
  };
  engineBoundaries: Array<{
    engineVersion: string;
    startsAt: string;
    pointIndex: number;
  }>;
  points: ConfigHealthTrendPoint[];
}
```

### API Design

#### `GET /api/v1/config-health/{instanceId}/trends`

**Authentication**: Existing global middleware.

**Query**:

| Parameter | Rules                                                     |
| --------- | --------------------------------------------------------- |
| `days`    | Integer 1–3650; mutually exclusive with `from`/`to`       |
| `from`    | Optional inclusive date-only or ISO date-time lower bound |
| `to`      | Optional inclusive date-only or ISO date-time upper bound |
| `profile` | Optional exact non-empty persisted profile name           |

The UI defaults to `days=30`. The parser captures one injected `now`, expands date-only bounds with
the existing strict date helper, rejects `from > to`, and returns normalized absolute UTC bounds.

**Response (200)**:

```json
{
  "instance": { "id": 12, "name": "Living Room Sonarr", "arrType": "sonarr" },
  "currentEngineVersion": "2",
  "normalizedFilter": {
    "from": "2026-06-10T12:00:00.000Z",
    "to": "2026-07-10T12:00:00.000Z",
    "profile": null
  },
  "retention": {
    "days": 90,
    "maxEntries": 5000,
    "ageCutoffAt": "2026-04-11T12:00:00.000Z",
    "oldestAvailableAt": "2026-06-12T00:00:00.000Z",
    "newestAvailableAt": "2026-07-10T06:00:00.000Z"
  },
  "availableProfiles": ["HD-720p", "WEB-1080p"],
  "counts": { "points": 2, "measured": 1, "unknown": 1, "missing": 0 },
  "engineBoundaries": [
    {
      "engineVersion": "1",
      "startsAt": "2026-06-12T00:00:00.000Z",
      "pointIndex": 0
    },
    {
      "engineVersion": "2",
      "startsAt": "2026-07-01T00:00:00.000Z",
      "pointIndex": 1
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
      "criteria": []
    },
    {
      "snapshotId": 330,
      "generatedAt": "2026-07-01T00:00:00.000Z",
      "engineVersion": "2",
      "state": "unknown",
      "score": null,
      "band": "unknown",
      "criteria": []
    }
  ]
}
```

**Errors**:

| Status | Condition                                             |
| ------ | ----------------------------------------------------- |
| `400`  | Invalid id, range, days combination, or empty profile |
| `404`  | Instance absent or not sync-capable                   |
| `422`  | More than 10,000 exact matching points                |
| `500`  | Sanitized internal read failure                       |

#### `GET /api/v1/config-health/{instanceId}/trends/export`

Accepts the identical filters plus `format=json|csv` (default JSON). It invokes the same service.

- JSON attachment is the same response envelope and point order as `/trends`.
- CSV uses one row per canonical point with fixed columns:
  `snapshotId,generatedAt,engineVersion,scopeKind,profileName,state,score,band,criteria`.
- `criteria` is the exact compact criterion array JSON-encoded inside one RFC 4180 cell. This keeps
  snapshot/CSV rows one-to-one and best satisfies the issue's exact ordered-data parity; long-form
  criterion CSV is deferred.
- Empty CSV has the header only; nullable numeric/band cells are blank and state remains explicit.
- Return `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and a fixed ASCII filename using
  only numeric instance id and server timestamp.

### System Integration

#### Files to Create

- `packages/praxrr-app/src/lib/server/health/trendFilters.ts`: shared pure parser and typed 400 error.
- `packages/praxrr-app/src/lib/server/health/trends.ts`: canonical query/projector/metadata service.
- `packages/praxrr-app/src/lib/server/health/trendCsv.ts`: fixed one-point-per-row serializer.
- `packages/praxrr-app/src/lib/server/utils/export/csv.ts`: low-level formula-safe RFC 4180 cell
  escaping shared by the third export consumer.
- `packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/trends/export/+server.ts`: download
  handler.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/TrendFilters.svelte`.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/HealthTrendChart.svelte`.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/HealthTrendTable.svelte`.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/trendChart.ts`.
- Focused pure helper and E2E tests where required by the final plan.

#### Files to Modify

- `docs/api/v1/openapi.yaml`, `docs/api/v1/paths/config-health.yaml`, and
  `docs/api/v1/schemas/config-health.yaml`: portable source contract.
- `packages/praxrr-app/src/lib/api/v1.d.ts`, `packages/praxrr-api/openapi.json`, and
  `packages/praxrr-api/types.ts`: generated/bundled artifacts.
- `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts`: absolute bounds, cap+1,
  stable order, evidence-aware parsing.
- `packages/praxrr-app/src/lib/server/health/responses.ts`: OpenAPI-aligned trend wire types/mappers.
- Existing trend route: shared parser/service and expanded response.
- Config Health detail `+page.server.ts` / `+page.svelte`: safe instance options, filters, request
  lifecycle, charts/table/export, explicit states.
- Config Health DB/route tests and `scripts/test.ts` if a new helper suite needs alias registration.
- `ROADMAP.md`: record #226 implementation and final PR status without overclaiming merge state.

No SQL migration, runtime dependency, cross-Arr fallback, or retention change is allowed.

## UX Considerations

### User Workflows

#### Primary Workflow: Inspect and export overall history

1. **Load**
   - User opens `/config-health/{instanceId}`.
   - System loads current detail and 30-day overall trends independently with reserved layout and a
     polite busy status.
2. **Inspect**
   - User reads applied scope/count/timezone and a one-sentence evidence summary.
   - System renders the 0–100 score chart, band labels, overall criterion history, boundaries, and a
     complete chronological table.
3. **Filter**
   - User changes instance, exact profile, preset, or custom bounds and applies them.
   - System aborts stale requests, preserves the old applied caption while updating, then replaces
     every representation from one successful response.
4. **Export**
   - User selects JSON or CSV beside the applied count.
   - System downloads the same normalized absolute selection and announces success/failure without
     clearing the analysis.

#### Profile Workflow

1. User chooses an exact historical profile name.
2. Score/band history retains absent timestamps as gaps.
3. Criterion history is replaced with a clear message that historical profile contributions were not
   recorded; overall criteria are never relabelled as profile evidence.

#### Error Recovery Workflow

1. Invalid custom bounds remain in their labelled fields with a specific inline error.
2. A trend failure leaves current detail visible and offers a trend-only retry.
3. An empty range offers All retained/Clear; a one-point range explains that a trend cannot be
   determined.
4. Export failure preserves applied filters and result; retry targets the same format and selection.

### UI Patterns

| Component        | Pattern                                                  | Notes                                                         |
| ---------------- | -------------------------------------------------------- | ------------------------------------------------------------- |
| Filters          | Native labelled selects/date inputs in a responsive card | One column mobile; instance navigation resets invalid profile |
| Score/band chart | Inline SVG in `<figure>`                                 | Actual time x-scale, fixed 0–100 y-scale, no smoothing        |
| Criteria         | Directly labelled small multiples or compact panels      | Overall only; shared time scale                               |
| Exact values     | Semantic chronological table/card layout                 | Same document/order/data as API                               |
| Selection        | Persistent HTML point details                            | Left/Right/Home/End; no hundreds of tab stops                 |
| Boundaries       | Labelled rule plus table/summary text                    | Color is supplementary                                        |
| Downloads        | Existing Button links                                    | From normalized applied filters; visible format labels        |

### Accessibility Requirements

- WCAG 1.1.1: chart has a concise name/description and a complete structured table equivalent.
- WCAG 1.4.1/1.4.11: text, shapes, line/border patterns, and 3:1 graphical contrast convey every
  series/band/boundary state in addition to color.
- WCAG 1.4.10: controls and actions reflow at 320 CSS px/400% zoom without page-level horizontal
  overflow; any essential chart scrolling is contained and named.
- WCAG 1.4.13/2.1.1: inspection works by keyboard/touch; any tooltip is dismissible, hoverable, and
  persistent, while no essential fact is tooltip-only.
- WCAG 4.1.3: loading, update, count, and download status use a polite live region without moving
  focus.
- Long/hostile names render only through normal Svelte escaped text; no `{@html}`, `innerHTML`, SVG
  `foreignObject`, or untrusted URL/event attributes.

### Performance UX

- Keep current detail and trend fault domains independent.
- Use `AbortController` plus request-id protection for superseded selections.
- Calculate geometry once per response; render one path per comparable segment and only meaningful
  markers.
- Reduce tick/marker density before dropping data. Table/export/counts always retain every point.
- No optimistic or offline mutation behavior is relevant for this read-only feature.

## Recommendations

### Implementation Approach

**Recommended Strategy**: contract-first canonical result, followed by bounded database/service
implementation, route parity tests, accessible native-SVG UI, E2E state/responsive coverage, and
ROADMAP/graph closeout.

**Phasing:**

1. **Phase 1 - Contract and pure primitives**: Freeze the one-row-per-point CSV shape and 10,000-point
   cap; update OpenAPI/generated artifacts; implement parser, point-state projector, CSV escape/
   serialization, and geometry tests.
2. **Phase 2 - Data/API**: Add indexed absolute-range query and canonical service, then wire chart and
   export routes with validation, auth, headers, empty, overflow, hostile-text, and parity tests.
3. **Phase 3 - UI and closeout**: Add instance/scope/time controls, charts, summaries/table, boundaries,
   exports, state matrix, responsive E2E, ROADMAP, graph update, and full validation.

### Technology Decisions

| Decision         | Recommendation                        | Rationale                                                       |
| ---------------- | ------------------------------------- | --------------------------------------------------------------- |
| Storage          | Existing snapshots only               | Required source of truth; no migration needed                   |
| Profile criteria | Do not persist/reconstruct in #226    | Old history cannot prove them                                   |
| CSV shape        | One point row with criteria JSON cell | Strongest point-count/order parity and smallest stable contract |
| Result cap       | 10,000 + explicit 422                 | Exact and bounded; no silent loss                               |
| Time ranges      | 7/30/90/all plus custom inclusive UTC | Useful inspection/export coverage                               |
| Chart            | Route-local native SVG                | No dependency; full gap/a11y control                            |
| Engine changes   | Hard segment boundary                 | Policies are not assumed comparable                             |
| Retention        | Current policy + earliest available   | Evidence cannot identify prune cause                            |

### Quick Wins

- Add stored engine version and snapshot id to each point.
- Convert unknown-band score zero to nullable wire evidence.
- Replace index-spaced sparkline geometry with actual-time pure helpers.
- Use one strict filter parser and absolute applied export bounds.
- Extract the third shared CSV cell escape while keeping feature row schemas local.

### Future Enhancements

- Forward-only compact per-profile criterion history with explicit legacy `not-recorded` state.
- Durable profile identity across renames and archived deleted-instance access.
- Persisted collection/prune provenance for causal gap/boundary labels.
- Cross-feature timeline correlation and shareable filtered links.
- Streaming exports only after measured demand exceeds the exact point cap.

## Risk Assessment

### Technical Risks

| Risk                     | Likelihood | Impact | Mitigation                                             |
| ------------------------ | ---------- | ------ | ------------------------------------------------------ |
| UI/export drift          | Medium     | High   | One parser/service/result plus parity tests            |
| False zero/interpolation | Medium     | High   | Nullable tagged states and segment tests               |
| Cross-engine comparison  | Medium     | High   | Per-point version and hard boundary                    |
| Unbounded history        | Medium     | High   | Indexed cap+1 query, 422, request cancellation         |
| Malformed legacy JSON    | Low        | High   | Explicit `not-recorded`, safe identity, bounded logs   |
| Mobile/chart overlap     | Medium     | Medium | Stacked controls, adaptive ticks, table, viewport E2E  |
| Contract drift           | Medium     | High   | OpenAPI first, generated artifacts, `satisfies` checks |

### Integration Challenges

- Runtime response types, portable OpenAPI schemas, and generated API package artifacts must remain in
  lockstep.
- Existing route semantics require an active sync-capable instance, while orphaned retained rows are
  not addressable; archived deleted-instance history is deferred.
- Current retention count is fleet-wide, so notices must not promise a per-instance duration.
- Cross-Arr tests must prove explicit instance `arr_type` behavior without sibling fallback.

### Security Considerations

#### Critical — Hard Stops

| Finding                 | Risk                                           | Required Mitigation                                                                         |
| ----------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Auth inheritance bypass | Unauthenticated operational-history disclosure | Keep every route under protected `/api/v1/config-health/**`; add auth integration coverage  |
| Dynamic SQL/JSON paths  | Injection and cross-scope reads                | Static SQL, bound values, constant selectors; never interpolate profile/criterion/sort/path |

#### Warnings — Must Address

| Finding                    | Risk                                | Mitigation                                     | Alternatives                                |
| -------------------------- | ----------------------------------- | ---------------------------------------------- | ------------------------------------------- |
| Oversized exact result     | CPU/memory/bandwidth exhaustion     | 10,000 cap+1 and 422                           | Streaming/pagination later                  |
| Formula CSV cells          | Spreadsheet execution/exfiltration  | Formula neutralization then RFC escaping       | JSON for lossless automation                |
| Cached/unsafe downloads    | Operational metadata leakage        | no-store, nosniff, fixed ASCII filename        | Private caching only if later required      |
| Unsafe SVG labels          | Stored XSS                          | Escaped Svelte text only; numeric internal ids | Sanitizer only if HTML is later unavoidable |
| Query-string API key       | Credential leakage                  | Cookie browser auth / header machine auth only | No token URL needed                         |
| Existing Kysely advisories | Dangerous literal/path API exposure | Use raw bound SQLite; audit and track upgrade  | Adapter upgrade separately                  |

#### Advisories — Best Practices

- Keep the chart dependency-free; review/pin any future visualization dependency.
- Log only numeric instance id, normalized range shape, count, duration, overflow, and status.
- Keep routes read-only/same-origin and do not add wildcard CORS.

## Task Breakdown Preview

### Phase 1: Contract and independent primitives

**Focus**: Freeze the wire/CSV model and establish pure tested seams.
**Tasks**:

- OpenAPI and generated artifacts.
- Filter normalization and CSV escape/serialization.
- Bounded snapshot query tests.
- Pure chart geometry and segmentation tests.

**Parallelization**: Contract, query, and geometry can proceed concurrently after the fixed decisions
in this spec; generated artifacts wait for OpenAPI.

### Phase 2: Canonical service and routes

**Focus**: Produce one exact authenticated result and both attachment formats.
**Dependencies**: Contract, parser, bounded query, serializer.
**Tasks**:

- Overall/profile projection, states, counts, retention, and version boundaries.
- Trend and export route wiring.
- Database, route, auth, header, hostile-value, overflow, and JSON/CSV parity tests.

### Phase 3: Accessible UI and release validation

**Focus**: Replace the sparkline and prove acceptance across state/layout variants.
**Dependencies**: Stable canonical response and route tests.
**Tasks**:

- Safe instance/profile/time filters and request lifecycle.
- Score/band and overall criterion charts, summaries, semantic table, exports, and explicit states.
- Mobile/desktop/keyboard E2E fixtures.
- ROADMAP, graph update, focused/full checks, PR review/fix, CI, and merge lifecycle.

## Decisions Needed

All implementation-blocking decisions are resolved for planning:

1. **Profile criterion history**
   - Decision: #226 shows overall criterion history and profile score/band history only.
   - Rationale: Old snapshots cannot prove profile criteria; forward enrichment is a separate change.
2. **CSV shape**
   - Decision: One canonical point per row with an exact criteria JSON cell.
   - Rationale: Strongest filter/count/order parity and smallest stable serializer.
3. **Result bound**
   - Decision: 10,000 points, queried as cap+1, overflow `422`.
   - Rationale: Bounded exactness without silently truncating configured extreme retention.
4. **Sampling gaps**
   - Decision: Plot actual elapsed time and break only at explicit unknown/absence/malformed/version
     states; do not invent a cadence-based cause in #226.
5. **Export race consistency**
   - Decision: Use normalized absolute bounds; defer `throughSnapshotId` unless validation demonstrates
     a requirement beyond the issue's filter/order parity.
6. **Instance semantics**
   - Decision: Single active path-selected instance with explicit navigation; no overlay/archive.

## Research References

For detailed findings, see:

- [research-external.md](./research-external.md): standards, libraries, and integration patterns.
- [research-business.md](./research-business.md): business rules and evidence semantics.
- [research-technical.md](./research-technical.md): technical architecture and file-level design.
- [research-ux.md](./research-ux.md): accessible/responsive workflows and state design.
- [research-security.md](./research-security.md): severity-classified security findings.
- [research-practices.md](./research-practices.md): reuse, KISS, module boundaries, and test seams.
- [research-recommendations.md](./research-recommendations.md): trade-offs, risks, and phasing.
