# Task Structure Analysis: config-health-trends-export

## Executive Summary

Implement issue #226 as a contract-first, dependency-ordered series of small tasks centered on one
canonical trend result. The critical path is OpenAPI source -> generated types -> evidence-aware
query/service -> two API routes -> page integration -> E2E and release gates; pure filter, CSV, and
chart-geometry work can proceed in parallel without overlapping file ownership.

The recommended breakdown uses one to three owned files per implementation task, assigns every
expected changed file to exactly one task, and treats tests as part of the same dependency graph as
their production seams. No migration, new datastore, chart dependency, snapshot backfill, retention
change, or cross-Arr fallback belongs in this feature.

## Recommended Phase Structure

- **Phase 0: Baseline and contract freeze** — Confirm the worktree is based on the real default
  branch, preserve unrelated changes, and implement the portable source contract before runtime
  code imports generated shapes. This phase has no dependency on later implementation.
- **Phase 1: Independent foundations** — Build the bounded snapshot read, strict filter parser,
  shared CSV escaping, and pure chart geometry. These tasks can run in parallel after the feature
  contract is fixed.
- **Phase 2: Canonical domain and API integration** — Project persisted evidence into the one trend
  result, serialize that result, and wire both authenticated routes. This phase depends on the
  generated contract and relevant Phase 1 primitives.
- **Phase 3: Accessible route UI** — Add safe instance/filter inputs, route-local chart/table
  components, and integrate independent detail/trend request state. Component work can fan out once
  the response contract is stable; the page integration is the join point.
- **Phase 4: Acceptance, documentation, and repository gates** — Prove browser behavior, update
  `ROADMAP.md`, regenerate contracts deterministically, run focused and full validation, then update
  Graphify. No implementation task is complete until these gates pass.
- **Phase 5: PR lifecycle** — Commit intentionally, create the template-derived PR closing #226,
  perform the requested formal review, fix every accepted finding, rerun validation, monitor CI to
  green, squash merge, and remove the local/remote feature branch and issue worktree.

## Detailed Task Breakdown

### Phase 0: Contract freeze

#### T00 — Verify baseline and acceptance matrix

- **Owns files**: none.
- **Action**: Record the worktree branch/base/cleanliness and translate the feature spec into an
  acceptance checklist covering overall versus exact-profile scope, nullable evidence states,
  engine boundaries, retention wording, 10,000-point overflow, representation parity,
  accessibility, auth, and all three explicit Arr types.
- **Dependencies**: none.
- **Validation**: `git status --short`, `git branch --show-current`, `git remote show origin`, and
  issue #226 inspection agree with the worktree and feature spec.
- **Parallelism**: Blocks no source task once the contract decisions in `feature-spec.md` are
  confirmed; do not change scope based on legacy sparkline behavior.

#### T01 — Define the portable trend and export contract

- **Owns files**:
  - `docs/api/v1/schemas/config-health.yaml`
  - `docs/api/v1/paths/config-health.yaml`
  - `docs/api/v1/openapi.yaml`
- **Action**: Define the canonical instance/filter/retention/count/boundary/criterion/point/result
  schemas; replace the legacy trend response; register identical trend/export filters, nullable
  tagged states, JSON/CSV media types, and `400/404/422/500` responses.
- **Dependencies**: T00.
- **Validation**: OpenAPI source resolves with no dangling references; omission versus `null` is
  consistent with the runtime model; profile criteria are not documented.

#### T02 — Regenerate committed API artifacts

- **Owns files**:
  - `packages/praxrr-app/src/lib/api/v1.d.ts`
  - `packages/praxrr-api/openapi.json`
  - `packages/praxrr-api/types.ts`
- **Action**: Generate app types and bundle the portable API from T01. Never hand-edit these files.
- **Dependencies**: T01.
- **Validation**: `deno task generate:api-types`; `deno task bundle:api`; rerunning both produces no
  diff. Confirm the export path and new schemas appear in the declarations and bundled package.

### Phase 1: Independent foundations

#### T03 — Add the bounded, evidence-aware snapshot query

- **Owns files**:
  - `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts`
  - `packages/praxrr-app/src/tests/db/configHealthSnapshots.test.ts`
- **Action**: Add a trend-specific row/read seam with optional inclusive absolute ISO bounds,
  `generated_at ASC, id ASC`, `limit + 1`, oldest/newest metadata support, and parse-validity evidence
  that distinguishes valid empty arrays from malformed/non-array JSON. Preserve existing insert,
  degradation, and cleanup behavior.
- **Dependencies**: T00.
- **Validation**: Real migrated SQLite tests cover lower/upper inclusivity, equal timestamps,
  instance isolation across Radarr/Sonarr/Lidarr, cap sentinel, malformed-versus-empty arrays, and an
  `EXPLAIN QUERY PLAN` assertion showing the instance/time index without a temporary sort caused by
  `datetime(generated_at)`.
- **Parallelism**: Runs alongside T01/T02, T04, T05, and T06.

#### T04 — Implement strict shared filter normalization

- **Owns files**:
  - `packages/praxrr-app/src/lib/server/health/trendFilters.ts`
  - `packages/praxrr-app/src/tests/health/trendFilters.test.ts`
- **Action**: Parse `days=1..3650` or inclusive `from`/`to`, preserve an exact non-empty profile
  identifier, normalize relative time with one injected clock, and expose typed `400` failures. The
  export-only format remains a thin route concern or an explicitly shared parser extension without
  duplicating selection parsing.
- **Dependencies**: T00.
- **Validation**: Pure tests cover date-only endpoints, ISO normalization, omitted bounds,
  `days`/absolute exclusivity, reversed ranges, invalid integers/dates, exact whitespace/case/profile
  preservation, and deterministic injected time.
- **Parallelism**: Runs alongside T01/T02, T03, T05, and T06.

#### T05 — Extract formula-safe RFC 4180 cell encoding

- **Owns files**:
  - `packages/praxrr-app/src/lib/server/utils/export/csv.ts`
  - `packages/praxrr-app/src/routes/api/v1/sync-history/export/+server.ts`
  - `packages/praxrr-app/src/routes/api/v1/timeline/export/+server.ts`
- **Action**: Extract only the duplicated low-level cell encoder and update the two existing export
  consumers without changing their columns, limits, filenames, headers, or row selection.
- **Dependencies**: T00.
- **Validation**: Existing Timeline and Sync History route tests remain green; focused helper
  coverage in T08 proves formula neutralization precedes quoting and preserves RFC escaping.
- **Parallelism**: Runs alongside T01/T02, T03, T04, and T06.

#### T06 — Build pure actual-time chart geometry

- **Owns files**:
  - `packages/praxrr-app/src/routes/config-health/[instanceId]/components/trendChart.ts`
  - `packages/praxrr-app/src/tests/health/trendChart.test.ts`
- **Action**: Implement finite guarded timestamp/score scaling, adaptive ticks, marker placement, and
  segment construction that breaks on unknown, profile-missing, not-recorded, and engine-version
  transitions. A single point must remain one marker; no smoothing or inferred cadence.
- **Dependencies**: T00.
- **Validation**: Pure tests cover irregular/equal timestamps, `0` as a measured score, nullable
  gaps, version breaks, one-point/empty inputs, non-finite guards, and deterministic coordinates.
- **Parallelism**: Runs alongside T01/T02, T03, T04, and T05.

### Phase 2: Canonical domain and API integration

#### T07 — Build the canonical trend projection and wire mapping

- **Owns files**:
  - `packages/praxrr-app/src/lib/server/health/trends.ts`
  - `packages/praxrr-app/src/lib/server/health/responses.ts`
  - `packages/praxrr-app/src/tests/health/trends.test.ts`
- **Action**: Validate one active sync-capable instance by explicit `arr_type`, read current global
  retention settings, execute T03's exact query, enforce 10,000/10,001 overflow, and project overall
  or exact-profile evidence into the OpenAPI-aligned result. Compute available profiles, counts,
  per-point engine version, boundaries, and cautious oldest/newest/age-cutoff metadata without
  recomputation or cadence/prune claims.
- **Dependencies**: T02 and T03.
- **Validation**: Pure/service tests cover overall criterion score/contribution states, unknown
  score-to-null mapping, exact profile match and absence gaps, malformed evidence, stable order,
  current versus persisted engine versions, no cross-version delta, empty success, fleet-wide
  retention wording inputs, unsupported/missing instance `404`, and overflow `422`.
- **Parallelism**: Starts when T02 and T03 finish; T04 and T05 need not block its internal projector.

#### T08 — Serialize the canonical result as exact CSV

- **Owns files**:
  - `packages/praxrr-app/src/lib/server/health/trendCsv.ts`
  - `packages/praxrr-app/src/tests/health/trendCsv.test.ts`
- **Action**: Serialize one canonical point per fixed row with columns
  `snapshotId,generatedAt,engineVersion,scopeKind,profileName,state,score,band,criteria`. Never query,
  filter, sort, infer, or drop points; use T05's cell encoder and CRLF records.
- **Dependencies**: T05 and T07.
- **Validation**: Tests cover header-only empty output, blank null cells versus numeric zero, compact
  criterion JSON, quotes/commas/newlines, leading formula characters including tab/CR, hostile exact
  profile names, and parsed point identity/count/order parity with the input result.

#### T09 — Wire the trend JSON and attachment routes

- **Owns files**:
  - `packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/trends/+server.ts`
  - `packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/trends/export/+server.ts`
- **Action**: Make both handlers thin adapters over T04/T07, with export calling T08 only after the
  same canonical result is built. Map typed `400/404/422`, sanitize unexpected `500`, default export
  to JSON, and emit fixed ASCII filenames plus `no-store` and `nosniff` headers without credentials
  or stored names.
- **Dependencies**: T04, T07, and T08.
- **Validation**: Handler types satisfy generated OpenAPI schemas and no route performs its own SQL,
  profile matching, sorting, cap logic, or historical recomputation.

#### T10 — Prove route, auth, and cross-representation parity

- **Owns files**:
  - `packages/praxrr-app/src/tests/routes/configHealth.test.ts`
- **Action**: Extend the migrated DB/direct-route harness for both handlers and add an auth-boundary
  exercise through the global server hook where needed. Compare trend JSON, JSON attachment, parsed
  CSV identities/order, and the canonical expected result for identical normalized filters.
- **Dependencies**: T09.
- **Validation**: Cover valid/invalid filters and formats, exact hostile names, Radarr/Sonarr/Lidarr
  isolation, missing/unsupported instance, empty `200`, unknown/missing/not-recorded states,
  equal-time ordering, engine boundaries, retention fields, overflow, sanitized `500`, attachment
  headers/content types, JSON deep equality, CSV formula defense, and unauthenticated `401` for both
  protected paths.

### Phase 3: Accessible route UI

#### T11 — Add safe instance and trend filter controls

- **Owns files**:
  - `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.server.ts`
  - `packages/praxrr-app/src/routes/config-health/[instanceId]/components/TrendFilters.svelte`
- **Action**: Load only enabled sync-capable `{id,name,type}` options and implement labelled
  instance, exact historical profile, 7/30/90/all, and custom-bound controls with distinct draft and
  applied state. Instance navigation clears an invalid profile and never exposes Arr URLs/API keys.
- **Dependencies**: T09.
- **Validation**: Server-load tests or T15 fixtures prove explicit Arr filtering and credential-safe
  serialization; component behavior preserves exact profile names and reports local validation
  errors without clearing the applied result.
- **Parallelism**: Runs alongside T12 and T13 after T09.

#### T12 — Implement the accessible SVG analysis view

- **Owns files**:
  - `packages/praxrr-app/src/routes/config-health/[instanceId]/components/HealthTrendChart.svelte`
- **Action**: Render dependency-free score/band and overall criterion history using T06 geometry,
  actual timestamps, fixed 0..100 score scale, visible gap/version boundaries, text/shape/dash
  encodings, concise figure summary, and a persistent keyboard/touch point inspector. Profile scope
  must explicitly state that historical profile criteria were not recorded.
- **Dependencies**: T06 and T09.
- **Validation**: No `{@html}`, `innerHTML`, `foreignObject`, untrusted ids/URLs, hover-only facts,
  interpolated gaps, cross-version deltas, or duplicated one-point lines; E2E proof belongs to T15.
- **Parallelism**: Runs alongside T11 and T13.

#### T13 — Implement the complete semantic trend table

- **Owns files**:
  - `packages/praxrr-app/src/routes/config-health/[instanceId]/components/HealthTrendTable.svelte`
- **Action**: Render every canonical point chronologically with snapshot/time/version/state,
  score/band, and overall criterion values/states. Use ordinary escaped Svelte text and a responsive
  semantic table/card treatment without unsafe generic HTML renderers.
- **Dependencies**: T09.
- **Validation**: Empty, sparse, unknown, profile-missing, not-recorded, zero, hostile label, and
  engine-boundary facts remain textually available and in canonical order.
- **Parallelism**: Runs alongside T11 and T12.

#### T14 — Integrate independent trend state into the detail page

- **Owns files**:
  - `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.svelte`
- **Action**: Replace the fixed 30-day sparkline, retain the live detail fault domain, and coordinate
  T11-T13 with trend-only loading/error/retry, `AbortController` plus request-id stale-response
  protection, applied counts/timezone/retention context, polite status updates, and same-origin export
  links built from the successful response's normalized absolute bounds.
- **Dependencies**: T11, T12, and T13.
- **Validation**: A failed or superseded trend request never removes current detail or the last
  applied caption/result; downloads never repeat moving `days` state or include credentials.

### Phase 4: Acceptance and closeout gates

#### T15 — Add deterministic browser acceptance coverage

- **Owns files**:
  - `packages/praxrr-app/src/tests/e2e/specs/config-health-trends-export.spec.ts`
- **Action**: Use intercepted deterministic responses or seeded rows to exercise the complete trend
  state matrix without relying on a live scoring sweep.
- **Dependencies**: T14.
- **Validation**: Cover initial 30-day load, apply/race/retry behavior, empty and filtered-empty,
  single point, unknown, profile-missing/not-recorded, irregular times, multiple engines, exact
  profiles, table/chart fact parity, normalized export URLs, keyboard Left/Right/Home/End inspection,
  visible focus, touch-safe controls, and no page-level horizontal overflow at 320 CSS pixels.

#### T16 — Register focused tests if discovery requires it

- **Owns files**:
  - `scripts/test.ts` (conditional; no edit if existing alias discovery already includes T04/T06/T07/T08)
- **Action**: Ensure `deno task test config-health` executes every new pure, DB, and route suite. Do
  not broaden unrelated aliases.
- **Dependencies**: T03, T04, T06, T07, T08, and T10.
- **Validation**: Inspect the test command's enumerated files/output and prove none of the new suites
  are skipped.

#### T17 — Update the roadmap for issue #226

- **Owns files**:
  - `ROADMAP.md`
- **Action**: Add the Config Health trends/export outcome and issue linkage in the existing roadmap
  style. Describe implemented evidence semantics, filters, accessible table/chart, and exact exports;
  do not claim the PR is merged while the commit is still under review.
- **Dependencies**: T14 and T15.
- **Validation**: Link targets and terminology match issue #226 and the final implementation, with no
  claims of profile criterion history, causal retention provenance, or cross-instance overlays.

#### T18 — Run deterministic generation, quality, and graph gates

- **Owns files**:
  - `graphify-out/**` generated/updated artifacts only.
- **Action**: After all source/tests/docs settle, format scoped changes, regenerate API artifacts,
  run focused then broad validation, and update the project knowledge graph from this worktree.
- **Dependencies**: T02, T10, T15, T16, and T17.
- **Validation gates, in order**:
  1. `deno task format:plans` and scoped repository formatting; inspect that only intended files changed.
  2. `deno task generate:api-types` and `deno task bundle:api`; rerun and require a clean generated diff.
  3. `deno task test config-health`.
  4. Relevant Timeline/Sync History route tests affected by T05.
  5. `deno task check`.
  6. `deno task lint`.
  7. Relevant Config Health Playwright spec, then the repository-required `deno task test:e2e` scope.
  8. `deno task test` if not already required by repository hooks/CI.
  9. `deno task check:dist-paths` and `git diff --check`.
  10. `graphify update .`, followed by graph artifact/status inspection.
- **Failure rule**: Fix the owning task, rerun its focused test, then rerun every downstream gate;
  never waive a broad failure based only on a narrow passing test.

### Phase 5: PR, review, merge, and cleanup

#### T19 — Publish the feature PR with issue closure

- **Owns files**: none beyond the already validated implementation.
- **Action**: Review the full diff, stage all intended files including generated artifacts, create
  intentional conventional commit(s), push the issue branch, derive the PR body from the repository
  template using `--body-file`, and include `Closes #226` plus design/plan/test evidence.
- **Dependencies**: T18.
- **Validation**: PR base is the actual default branch, title meets repository rules, body uses the
  template, changed-file set matches the ownership map, and GitHub reports issue linkage.

#### T20 — Perform formal review and fix every accepted finding

- **Owns files**: review artifact/fix report paths selected by the repository review workflow;
  production/test files remain attributed to their original owner task for audit purposes.
- **Action**: Run the requested proper PR review against the remote diff, create the machine-readable
  review artifact, classify findings, apply fixes through the review-fix workflow, update each
  finding status, commit/push fixes, and repeat review until no actionable finding remains.
- **Dependencies**: T19.
- **Validation**: Review artifact exists, all findings are `Fixed` or explicitly justified, no
  unresolved actionable GitHub threads remain, and T18's applicable gates pass on the final SHA.

#### T21 — Drive CI green, squash merge, and clean up

- **Owns files**: none.
- **Action**: Monitor every required check on the latest PR SHA. Diagnose/fix genuine failures and
  rerun T18/T20 as needed; distinguish external review latency from code failures. Once required CI
  and review state are green, squash merge, verify issue #226 closed, update the primary checkout,
  delete the remote feature branch if GitHub did not, remove the issue worktree, delete the local
  feature branch, and prune stale worktree/remote-tracking metadata.
- **Dependencies**: T20.
- **Validation**: PR state is `MERGED` with the expected squash commit on the default branch; issue
  #226 is closed; no local/remote issue branch remains; the issue worktree path is absent; primary
  checkout is clean and contains the merge.

## Task Granularity

- Production behavior is split by stable seam: portable contract, generated artifacts, database
  access, filters, CSV primitive, canonical projector, serializer, handlers, chart geometry,
  components, and page coordinator. Avoid combining API, DB, and UI into one implementor task.
- Tests live with the smallest seam they prove when that keeps ownership within three files. The
  existing route and DB integration suites remain their own tasks because they are shared convergence
  points and are likely to receive substantial additions.
- Generated artifacts form one mechanical task after their three source contract files. They are
  never divided among implementors or edited concurrently.
- The detail `+page.svelte` is intentionally a single-file integration task after three component
  tasks; splitting edits to that file would create merge conflicts and inconsistent request state.
- `scripts/test.ts` is a conditional ownership task. It must remain untouched if the existing
  `config-health` alias already discovers the new test locations.
- Graphify output is owned only by the final gate. Dirty pre-existing graph files are not grounds to
  skip the update, but unrelated graph changes must be identified before commit.

## Dependency Analysis

### Dependency graph

```text
T00
 +--> T01 --> T02 --------------------+
 +--> T03 -----------------------> T07 +--> T08 --> T09 --> T10 ----+
 +--> T04 ------------------------------------------^                |
 +--> T05 --------------------------------> T08                      |
 +--> T06 ----------------------------------------------> T12 --+    |
                                                               |    |
T09 --> T11 ---------------------------------------------------+--> T14 --> T15 --> T17 --+
  +--> T13 ----------------------------------------------------+                           |
                                                                                           +--> T18
T03,T04,T06,T07,T08,T10 ---------------------------------------------> T16 ---------------+

T18 --> T19 --> T20 --> T21
```

### Parallel opportunities

- After T00, T01, T03, T04, T05, and T06 are independent and can run concurrently if separate
  implementors are available.
- T02 is a short mechanical follow-up to T01 and can finish while T03-T06 continue.
- Once T09 is stable, T11, T12, and T13 can run concurrently because they own separate files.
- T10 can run in parallel with early UI component work after T09, but T18 cannot begin until both API
  integration tests and browser acceptance finish.
- Review/CI fixes return to the smallest owning task and must not be fanned out across the same file.

### Circular-dependency check

There are no cycles. Storage and filter primitives do not import route/UI modules; the canonical
service depends only on generated contract-compatible types, DB queries, settings, and shared health
types; CSV depends on the canonical result and low-level encoder; handlers depend on parser/service/
serializer; components depend on wire shapes/pure geometry; the page depends on components. Tests
may import their production seam, but production code must never import tests, E2E fixtures, plan
artifacts, or Graphify output.

## File-to-Task Mapping

| File or path                                                                                   | Exclusive owner |
| ---------------------------------------------------------------------------------------------- | --------------- |
| `docs/api/v1/schemas/config-health.yaml`                                                       | T01             |
| `docs/api/v1/paths/config-health.yaml`                                                         | T01             |
| `docs/api/v1/openapi.yaml`                                                                     | T01             |
| `packages/praxrr-app/src/lib/api/v1.d.ts`                                                      | T02             |
| `packages/praxrr-api/openapi.json`                                                             | T02             |
| `packages/praxrr-api/types.ts`                                                                 | T02             |
| `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts`                       | T03             |
| `packages/praxrr-app/src/tests/db/configHealthSnapshots.test.ts`                               | T03             |
| `packages/praxrr-app/src/lib/server/health/trendFilters.ts`                                    | T04             |
| `packages/praxrr-app/src/tests/health/trendFilters.test.ts`                                    | T04             |
| `packages/praxrr-app/src/lib/server/utils/export/csv.ts`                                       | T05             |
| `packages/praxrr-app/src/routes/api/v1/sync-history/export/+server.ts`                         | T05             |
| `packages/praxrr-app/src/routes/api/v1/timeline/export/+server.ts`                             | T05             |
| `packages/praxrr-app/src/routes/config-health/[instanceId]/components/trendChart.ts`           | T06             |
| `packages/praxrr-app/src/tests/health/trendChart.test.ts`                                      | T06             |
| `packages/praxrr-app/src/lib/server/health/trends.ts`                                          | T07             |
| `packages/praxrr-app/src/lib/server/health/responses.ts`                                       | T07             |
| `packages/praxrr-app/src/tests/health/trends.test.ts`                                          | T07             |
| `packages/praxrr-app/src/lib/server/health/trendCsv.ts`                                        | T08             |
| `packages/praxrr-app/src/tests/health/trendCsv.test.ts`                                        | T08             |
| `packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/trends/+server.ts`           | T09             |
| `packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/trends/export/+server.ts`    | T09             |
| `packages/praxrr-app/src/tests/routes/configHealth.test.ts`                                    | T10             |
| `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.server.ts`                    | T11             |
| `packages/praxrr-app/src/routes/config-health/[instanceId]/components/TrendFilters.svelte`     | T11             |
| `packages/praxrr-app/src/routes/config-health/[instanceId]/components/HealthTrendChart.svelte` | T12             |
| `packages/praxrr-app/src/routes/config-health/[instanceId]/components/HealthTrendTable.svelte` | T13             |
| `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.svelte`                       | T14             |
| `packages/praxrr-app/src/tests/e2e/specs/config-health-trends-export.spec.ts`                  | T15             |
| `scripts/test.ts` (only if needed)                                                             | T16             |
| `ROADMAP.md`                                                                                   | T17             |
| `graphify-out/**` generated changes                                                            | T18             |
| Review artifact and fix report paths selected by the review workflow                           | T20             |

## Implementation Guardrails

- Treat `config_health_snapshots` as the sole historical source. Never recompute, interpolate,
  smooth, backfill, or infer missing evidence from current configuration.
- Preserve `generatedAt ASC, snapshotId ASC` from SQL through result, chart/table, JSON, and parsed
  CSV. No downstream consumer may re-filter or re-sort.
- `band='unknown'` is nullable score evidence, not measured zero. Profile absence and malformed
  storage remain timestamped gap points.
- Profile matching is exact and byte-preserving. Profile scope exposes persisted score/band only;
  overall criteria must never be relabelled as profile criteria.
- Resolve Radarr, Sonarr, and Lidarr only through the active path-selected instance's explicit
  `arr_type`; no sibling fallback, inferred mapping, or orphan lookup.
- The 10,000-point limit is exact: query 10,001 and return `422`; never truncate chart or export.
- Current retention settings and earliest available evidence do not prove why older rows are absent.
- Keep the two API routes authenticated under the existing protected hierarchy. Browser links use
  session auth and must never put an API key in a URL.
- Render hostile persisted labels with escaped Svelte text only. Formula-neutralize CSV before RFC
  quoting and keep JSON as the lossless format.
- Generated OpenAPI artifacts, `ROADMAP.md`, tests, and Graphify update are required deliverables,
  not optional cleanup.
