# Config Health Trends and Export Implementation Plan

Implement issue #226 by replacing the per-instance Config Health sparkline with a canonical,
filterable historical evidence surface. One strict parser, bounded SQLite query, and health-domain
projector will feed the JSON chart endpoint, semantic table, JSON attachment, and one-point-per-row CSV
attachment in stable timestamp/id order. Independent contract, query, filter, CSV, and chart-geometry
work converges into thin API routes, then route-local accessible components converge into the detail
page. No migration, second datastore, chart dependency, profile-criterion backfill, retention change,
or cross-Arr fallback is permitted.

## Critically Relevant Files and Documentation

- `CLAUDE.md`: Repository contract-first, Svelte, cross-Arr, formatting, ROADMAP, and graph rules.
- `docs/plans/config-health-trends-export/feature-spec.md`: Final evidence model, API, CSV, UX, and security decisions.
- `docs/plans/config-health-trends-export/shared.md`: Concise architecture, file, table, pattern, and documentation context.
- `docs/plans/config-health-trends-export/analysis-patterns.md`: Exact repository patterns and implementation gotchas.
- `docs/plans/config-health-trends-export/analysis-integration.md`: OpenAPI, database, auth, route, UI, and validation integration.
- `docs/api/README.md`: Portable API source versus generated/runtime ownership.
- `docs/api/v1/paths/config-health.yaml`: Existing trend operation and new export operation source.
- `docs/api/v1/schemas/config-health.yaml`: Existing Config Health wire schemas to evolve.
- `docs/api/v1/openapi.yaml`: Root path and component registry.
- `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts`: Historical storage and query owner.
- `packages/praxrr-app/src/lib/server/db/queries/configHealthSettings.ts`: Current retention context source.
- `packages/praxrr-app/src/lib/server/health/responses.ts`: Runtime portable response mapping boundary.
- `packages/praxrr-app/src/lib/server/timeline/filters.ts`: Typed shared filter parser pattern.
- `packages/praxrr-app/src/lib/server/timeline/service.ts`: Canonical result shared by handlers pattern.
- `packages/praxrr-app/src/lib/server/sync/syncHistory/filters.ts`: Strict inclusive date-bound parser.
- `packages/praxrr-app/src/routes/api/v1/timeline/export/+server.ts`: JSON/CSV attachment and escaping precedent.
- `packages/praxrr-app/src/routes/api/v1/sync-history/export/+server.ts`: JSON/CSV attachment and escaping precedent.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.svelte`: Current detail/sparkline and final integration owner.
- `packages/praxrr-app/src/tests/db/configHealthSnapshots.test.ts`: Migrated SQLite query tests.
- `packages/praxrr-app/src/tests/routes/configHealth.test.ts`: Migrated direct-route test harness.
- `docs/site/src/content/docs/app/testing.md`: Test entry-point and E2E guidance.
- `ROADMAP.md`: Config Health foundation/follow-up status source.

## Implementation Plan

### Phase 1: Portable Contract and Independent Foundations

#### Task 1.1: Define the canonical trend and export OpenAPI contract Depends on [none]

**READ THESE BEFORE TASK**

- `docs/plans/config-health-trends-export/feature-spec.md`
- `docs/api/README.md`
- `docs/api/v1/paths/config-health.yaml`
- `docs/api/v1/schemas/config-health.yaml`
- `docs/api/v1/openapi.yaml`

**Instructions**

Files to Create

- None.

Files to Modify

- `docs/api/v1/paths/config-health.yaml`
- `docs/api/v1/schemas/config-health.yaml`
- `docs/api/v1/openapi.yaml`

Replace the sparkline-only contract with the final feature-spec model: identical `days`/inclusive
`from`/inclusive `to`/exact `profile` filters, instance/current-version/filter/retention/count/profile/
boundary metadata, tagged nullable point and criterion states, per-point persisted engine version, and
stable snapshot identity. Add `/config-health/{instanceId}/trends/export` with `format=json|csv`, both
media types, empty success, and 400/404/422/500 responses. Do not document profile criteria, silent
truncation, historical recomputation, or causal retention provenance. Validate all local references.

#### Task 1.2: Add the bounded evidence-aware snapshot query Depends on [none]

**READ THESE BEFORE TASK**

- `docs/plans/config-health-trends-export/feature-spec.md`
- `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts`
- `packages/praxrr-app/src/lib/server/db/migrations/20260714_create_config_health_tables.ts`
- `packages/praxrr-app/src/tests/db/configHealthSnapshots.test.ts`

**Instructions**

Files to Create

- None.

Files to Modify

- `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts`
- `packages/praxrr-app/src/tests/db/configHealthSnapshots.test.ts`

Add a trend-specific read seam with optional inclusive canonical ISO bounds, an explicit caller limit,
and total order `generated_at ASC, id ASC`. It must use static parameterized SQL, fetch `limit` rows
where the service passes cap+1, and preserve JSON parse validity so a valid empty array differs from
malformed/non-array stored evidence. Retain existing insertion, degradation, cleanup, and public callers.
Real migrated tests must cover both bounds, equal timestamps, Radarr/Sonarr/Lidarr instance isolation,
cap sentinel, malformed versus empty arrays, and index-aware query behavior without wrapping the new
predicate/order in `datetime()`.

#### Task 1.3: Implement strict shared trend filter normalization Depends on [none]

**READ THESE BEFORE TASK**

- `docs/plans/config-health-trends-export/feature-spec.md`
- `packages/praxrr-app/src/lib/server/timeline/filters.ts`
- `packages/praxrr-app/src/lib/server/sync/syncHistory/filters.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/health/trendFilters.ts`
- `packages/praxrr-app/src/tests/health/trendFilters.test.ts`

Files to Modify

- None.

Create a pure parser with an injected clock and typed client error. Accept `days=1..3650` or inclusive
date-only/ISO `from`/`to`, reject their combination and reversed/invalid bounds, and normalize relative
days to one absolute UTC window. An omitted/all-history request normalizes to an unbounded `from` and
`to` equal to the captured request clock so a later export cannot acquire newly generated points.
Reject an empty profile but otherwise preserve its exact decoded bytes: no trim, case fold, fuzzy match,
or Arr mapping. Tests must pin omitted/all bounds, date-only expansion, deterministic relative time,
invalid values/combinations, and exact whitespace/case/punctuation names.

#### Task 1.4: Extract the third shared formula-safe CSV cell encoder Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/api/v1/timeline/export/+server.ts`
- `packages/praxrr-app/src/routes/api/v1/sync-history/export/+server.ts`
- `packages/praxrr-app/src/tests/routes/timeline.test.ts`
- `packages/praxrr-app/src/tests/routes/syncHistory.test.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/utils/export/csv.ts`

Files to Modify

- `packages/praxrr-app/src/routes/api/v1/timeline/export/+server.ts`
- `packages/praxrr-app/src/routes/api/v1/sync-history/export/+server.ts`

Extract only the identical low-level cell encoder: formula-neutralize `= + - @ TAB CR` before RFC
4180 quoting, double embedded quotes, and quote commas/quotes/CR/LF. Update both existing exporters to
import it without changing their filters, rows, limits, headers, filenames, or output. Their existing
route suites must remain byte-compatible.

#### Task 1.5: Build pure actual-time chart geometry Depends on [none]

**READ THESE BEFORE TASK**

- `docs/plans/config-health-trends-export/feature-spec.md`
- `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.svelte`
- `packages/praxrr-app/src/lib/client/ui/health/healthStatus.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/trendChart.ts`
- `packages/praxrr-app/src/tests/health/trendChart.test.ts`

Files to Modify

- None.

Implement finite guarded actual-time x scaling, fixed 0..100 score scaling, adaptive ticks, marker
placement, and contiguous segment construction. Unknown, profile-missing, not-recorded, and engine-
version changes must break segments; measured zero remains a valid coordinate; a singleton is one
marker and never a duplicated horizontal line. Do not smooth, interpolate, or infer cadence. Pure tests
cover empty/single/equal/irregular times, all gap states, version transitions, non-finite values, and
deterministic geometry.

### Phase 2: Generated Contract, Canonical Domain, and API

#### Task 2.1: Regenerate committed portable API artifacts Depends on [1.1]

**READ THESE BEFORE TASK**

- `docs/api/README.md`
- `deno.json`
- `scripts/bundle-api.ts`

**Instructions**

Files to Create

- None.

Files to Modify

- `packages/praxrr-app/src/lib/api/v1.d.ts`
- `packages/praxrr-api/openapi.json`
- `packages/praxrr-api/types.ts`

Run `deno task generate:api-types` and `deno task bundle:api`; never hand-edit generated output.
Confirm the new path, parameters, nullable states, and supporting schemas exist in all three artifacts.
Rerun both commands after generation and require no further generated diff.

#### Task 2.2: Build the canonical trend service and wire mapping Depends on [1.2, 2.1]

**READ THESE BEFORE TASK**

- `docs/plans/config-health-trends-export/feature-spec.md`
- `packages/praxrr-app/src/lib/server/health/responses.ts`
- `packages/praxrr-app/src/lib/server/db/queries/configHealthSettings.ts`
- `packages/praxrr-app/src/lib/server/timeline/service.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/health/trends.ts`
- `packages/praxrr-app/src/tests/health/trends.test.ts`

Files to Modify

- `packages/praxrr-app/src/lib/server/health/responses.ts`

Create a pure projector plus small I/O service. Validate one active sync-capable path instance by its
explicit Arr type, read current global retention settings, call the bounded query with 10,001, and
return 422 when more than 10,000 points match. Project overall persisted criteria or exact-name profile
score/band, mapping unknown to null, retaining missing-profile timestamps, representing malformed/
unrecorded evidence explicitly, preserving stored bands/versions, and computing counts, profile options,
oldest/newest context, age cutoff, and engine boundaries. Keep wire mappings mutable/OpenAPI-aligned.
Tests cover all states, exact names, ordering, current versus stored versions, empty/overflow, cautious
retention metadata, and Radarr/Sonarr/Lidarr fail-closed behavior.

#### Task 2.3: Serialize the canonical result as exact CSV Depends on [1.4, 2.2]

**READ THESE BEFORE TASK**

- `docs/plans/config-health-trends-export/feature-spec.md`
- `packages/praxrr-app/src/lib/server/utils/export/csv.ts`
- `packages/praxrr-app/src/lib/server/health/trends.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/health/trendCsv.ts`
- `packages/praxrr-app/src/tests/health/trendCsv.test.ts`

Files to Modify

- None.

Serialize one fixed row per canonical point in existing order with columns
`snapshotId,generatedAt,engineVersion,scopeKind,profileName,state,score,band,criteria`. JSON-encode the
compact criterion array in one cell, leave null cells blank, preserve numeric zero, emit CRLF, and
use the shared cell encoder. Never query, filter, sort, infer, or drop points. Tests cover header-only
empty output, null/zero distinction, nested JSON, hostile exact names, every formula prefix, quotes,
commas, CR/LF, and parsed point identity/count/order parity.

#### Task 2.4: Wire thin trend and export routes with parity coverage Depends on [1.3, 2.2, 2.3]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/trends/+server.ts`
- `packages/praxrr-app/src/tests/routes/configHealth.test.ts`
- `packages/praxrr-app/src/hooks.server.ts`
- `packages/praxrr-app/src/routes/api/v1/timeline/export/+server.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/trends/export/+server.ts`

Files to Modify

- `packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/trends/+server.ts`
- `packages/praxrr-app/src/tests/routes/configHealth.test.ts`

Make both handlers thin adapters over the same parser/service; only export selects JSON versus CSV.
Map typed 400/404/422, sanitize/log bounded unexpected 500s, default export to JSON, and emit fixed
ASCII numeric-instance/timestamp filenames with `no-store` and `nosniff`. Use generated schemas or
`satisfies` at route boundaries. Extend migrated route tests for every filter/format/error, empty and
all evidence states, equal-time/order, hostile names, engine/retention metadata, overflow, JSON deep
equality, parsed CSV parity/formula defense, headers/content types, explicit Arr isolation, and auth
inheritance through the protected route hierarchy. No route may re-query, match profiles, sort, or cap.

### Phase 3: Accessible Route-Local UI

#### Task 3.1: Add safe instance options and trend filter controls Depends on [2.4]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/config-health/+page.server.ts`
- `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.server.ts`
- `packages/praxrr-app/src/routes/timeline/+page.svelte`
- `docs/site/src/content/docs/app/components/forms.mdx`

**Instructions**

Files to Create

- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/TrendFilters.svelte`

Files to Modify

- `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.server.ts`

Expose only enabled sync-capable `{id,name,type}` options and preserve strict inline id errors. Build
programmatically labelled instance, exact profile, 7/30/90/all, and custom date controls with distinct
draft versus applied state and inline validation. Instance changes navigate to another path and clear
an unavailable profile; never serialize Arr URLs, keys, or sibling-app identity.

#### Task 3.2: Implement the accessible SVG trend analysis Depends on [1.5, 2.4]

**READ THESE BEFORE TASK**

- `docs/plans/config-health-trends-export/feature-spec.md`
- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/trendChart.ts`
- `packages/praxrr-app/src/lib/client/ui/health/healthStatus.ts`
- `docs/site/src/content/docs/app/components/cards.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/HealthTrendChart.svelte`

Files to Modify

- None.

Render dependency-free score/band and overall persisted criterion score and contribution history,
preserving measured, not-evaluated, and not-recorded states, using actual time, a fixed 0..100 score
scale, labelled thresholds, explicit gaps, and engine boundaries. Pair a concise visible figure
summary with text/shape/dash encodings and a persistent keyboard/touch inspector using Left/Right/Home/
End without hundreds of tab stops or hover-only facts. Profile scope must state that historical
criterion contributions were not recorded. Use normal escaped Svelte text only; no runes, `{@html}`,
`innerHTML`, `foreignObject`, untrusted URL/event attributes, smoothing, or cross-version deltas.

#### Task 3.3: Implement the complete semantic trend table Depends on [2.4]

**READ THESE BEFORE TASK**

- `docs/plans/config-health-trends-export/feature-spec.md`
- `docs/site/src/content/docs/app/components/tables.md`
- `packages/praxrr-app/src/lib/client/ui/table/Table.svelte`

**Instructions**

Files to Create

- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/HealthTrendTable.svelte`

Files to Modify

- None.

Render every canonical point in chronological order with timestamp/timezone, snapshot, engine, state,
score/band, and each overall criterion's persisted score, contribution, and explicit measured/not-
evaluated/not-recorded state. Use a real semantic table with a complete mobile card
equivalent or safe route-local responsive treatment. Render hostile persisted labels only as escaped
text; do not use the generic table's raw-HTML surface. Preserve empty, sparse, unknown, profile-missing,
not-recorded, measured-zero, and boundary facts exactly.

#### Task 3.4: Integrate independent trend state into the detail page Depends on [3.1, 3.2, 3.3]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.svelte`
- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/TrendFilters.svelte`
- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/HealthTrendChart.svelte`
- `packages/praxrr-app/src/routes/config-health/[instanceId]/components/HealthTrendTable.svelte`

**Instructions**

Files to Create

- None.

Files to Modify

- `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.svelte`

Replace the fixed sparkline while preserving live-detail fault isolation. Coordinate draft/applied
filters, trend-only loading/error/retry, explicit never-collected/filtered-empty/sparse/unknown states,
`AbortController` plus request-id stale-response protection, applied count/timezone/retention/version
context, polite status, chart/table composition, and export links built only from a successful
response's normalized absolute bounds. The All retained selection uses unbounded `from` plus the
response's captured absolute `to`, never a moving unbounded upper edge. A failed/superseded request must
not erase current detail or pair stale data with new labels; browser links never include credentials.

### Phase 4: Acceptance, Tracking, and Executable Gates

#### Task 4.1: Add deterministic responsive and accessibility E2E coverage Depends on [3.4]

**READ THESE BEFORE TASK**

- `docs/plans/config-health-trends-export/feature-spec.md`
- `packages/praxrr-app/src/tests/e2e/specs/4.4-score-simulator-ux-basics.spec.ts`
- `playwright.config.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/tests/e2e/specs/config-health-trends-export.spec.ts`

Files to Modify

- None.

Use deterministic API interception or seeded rows to cover initial 30-day load; applied filter race/
retry; never-collected, filtered-empty, singleton, unknown, profile-missing/not-recorded, irregular
time, multiple criteria with both persisted scores and contributions, and multiple engines; table/chart
facts; normalized export URLs including the captured All-history upper bound; keyboard
inspection and visible focus; long exact names; touch-safe controls; and no page-level overflow at 320,
375/390, 768, and desktop widths. E2E fixtures complement rather than replace DB-to-wire route tests.

#### Task 4.2: Register focused tests and update ROADMAP Depends on [3.4]

**READ THESE BEFORE TASK**

- `scripts/test.ts`
- `docs/site/src/content/docs/app/testing.md`
- `ROADMAP.md`
- `docs/plans/config-health-trends-export/feature-spec.md`

**Instructions**

Files to Create

- None.

Files to Modify

- `scripts/test.ts`
- `ROADMAP.md`

Ensure `deno task test config-health` executes every new `tests/health` suite without broadening
unrelated aliases. Update all Config Health/#226 roadmap references consistently: #244 is now merged,
#226 is implemented by this completion change pending merge, and #224/#225 remain separate open/in-
flight follow-ups according to live state. Describe the actual filter, evidence, accessible chart/table,
and exact export outcome without claiming profile criterion history, multi-instance comparison, causal
prune provenance, or a merged #226 PR before merge. The orchestrator will add the created PR number in
a follow-up roadmap commit once GitHub assigns it.

## Advice

- Freeze the generated wire contract before service/UI work; do not let runtime types become an
  alternate source of truth.
- Keep `generatedAt ASC, snapshotId ASC` unchanged from SQL through every response, table, chart, and
  parsed CSV assertion. No downstream consumer may refilter or re-sort.
- `band='unknown'` maps to nullable score evidence, not measured zero. A missing exact profile or
  malformed breakdown remains a timestamped gap point.
- Current retention settings and earliest evidence cannot prove which policy removed older rows.
- Profile identity is exact persisted text. Do not trim, case-fold, merge renames, infer sibling-app
  profiles, or expose overall criteria under profile scope.
- Query 10,001 and return 422; never reuse the existing exporters' logged-only truncation.
- Formula-neutralization intentionally changes dangerous spreadsheet cells. JSON is the lossless
  machine export; parity means identical point selection/order and documented CSV projection.
- Keep live detail visible if trends fail, and keep applied captions aligned with the last successful
  response while a new draft selection loads.
- After all tasks, the orchestrator must run formatting, API regeneration/bundling idempotence, focused
  Config Health tests, affected Timeline/Sync History tests, type checks, lint, focused/full E2E,
  full unit tests as required, dist-path and whitespace gates, and `graphify update .` before commit.
- PR creation, formal code review, review-fix, final green CI, squash merge, issue closure, and local/
  remote branch/worktree cleanup are mandatory lifecycle phases after this implementation plan passes.
