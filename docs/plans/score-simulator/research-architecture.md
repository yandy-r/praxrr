# Architecture Research: Score Simulator

## System Overview

The score simulator builds on an existing three-layer evaluation pipeline: (1) C# parser microservice for .NET-fidelity title parsing and regex matching, (2) PCD in-memory SQLite cache for custom format conditions and quality profile score mappings, and (3) a server-side evaluator that resolves CF matches using Arr-compatible grouping logic. Approximately 90% of the required server infrastructure is already implemented across the entity testing feature, parser client, CF evaluator, and scoring read queries. The primary new work is a dedicated API endpoint that returns per-condition detail (currently discarded by the entity-testing evaluate endpoint) plus score computation, and a purpose-built SvelteKit route with playground UI.

## Relevant Components

### Server-Side Evaluation Pipeline

- `/packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`: Parser service singleton client. Key exports: `parse()`, `parseWithCacheBatch()`, `matchPatternsBatch()`, `isParserHealthy()`. Parser results cached in SQLite keyed by title+type+parserVersion. Pattern matches cached by title+patternsHash.
- `/packages/praxrr-app/src/lib/server/utils/arr/parser/types.ts`: `ParseResult`, `QualitySource`, `QualityModifier`, `Resolution`, `Language`, `ReleaseType`, `MediaType` enums and types.
- `/packages/praxrr-app/src/lib/server/pcd/entities/customFormats/evaluator.ts`: Core evaluation engine. `evaluateCustomFormat()` applies Arr-compatible grouping logic (between types = AND, within type = OR unless required conditions exist, negate inverts before logic). `getParsedInfo()` serializes parse results for frontend. `extractAllPatterns()` collects regex patterns across all CFs for batch matching.
- `/packages/praxrr-app/src/lib/server/pcd/entities/customFormats/conditions/read.ts`: PCD cache queries. `getConditionsForEvaluation()` loads a single CF's conditions. `getAllConditionsForEvaluation()` batch-loads all CFs with all condition data (patterns, languages, sources, resolutions, quality modifiers, release types, indexer flags, sizes, years) via parallel queries.
- `/packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/scoring/read.ts`: `scoring()` returns a single profile's CF score mappings with `all`/arr-type-specific precedence logic (lines 80-88: specific arr_type score > `all` wildcard > null). `allCfScores()` returns all CF scores for all profiles (used by entity testing for client-side score calculation).
- `/packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/index.ts`: Re-exports `scoring`, `allCfScores`, `select` (profile list), `general`, `qualities`, `create`, `remove`.

### Existing API Endpoint (Reference Implementation)

- `/packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts`: `POST /api/v1/entity-testing/evaluate`. Accepts `{ databaseId, releases[] }`, returns `{ parserAvailable, evaluations[] }`. Pipeline: parse batch -> get all CFs with conditions -> extract patterns -> match patterns batch -> evaluate each release against all CFs. **Critical gap**: This endpoint reduces `evaluateCustomFormat()` results to a boolean `cfMatches[cfName] = result.matches` and discards per-condition `ConditionResult[]` detail. The score simulator needs those condition details.

### Entity Testing Feature (Reference Pattern for Route/UI)

- `/packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/+page.server.ts`: Server load function pattern. Loads databases, cache, test entities, quality profiles, `allCfScores`, parser health, and arr instances. Uses `pcdManager.getAll()` for database tabs, `pcdManager.getCache(id)` for PCD access.
- `/packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/+page.svelte`: Client-side pattern. Lazy-fetches evaluations via `POST /api/v1/entity-testing/evaluate`. Score calculation done client-side using `cfScoresData.profiles` lookup. Uses `Tabs` for database switching, `ActionsBar` for toolbar, `createDataPageStore` for search/filter, `alertStore` for notifications.
- `/packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/components/ReleaseTable.svelte`: Displays release evaluations using `ExpandableTable`, `Badge`, `Score`, `CustomFormatBadge` components. Computes matching formats with scores using `cfScoresData` lookup by arr_type.

### CF Testing Feature (Alternative Reference Pattern)

- `/packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/testing/+page.server.ts`: Server-side evaluation pattern. Calls `parse()` (not batch), `getConditionsForEvaluation()` (single CF), `evaluateCustomFormat()` directly. Returns full `ConditionResult[]` per test. This is the pattern the simulator API should follow for per-condition detail, but generalized to all CFs via batch operations.

### Shared Types

- `/packages/praxrr-app/src/lib/shared/pcd/display.ts`: All relevant display types:
  - `ConditionData` (line 158): Full condition structure for evaluation input
  - `ConditionResult` (line 177): Single condition eval result with `passes`, `expected`, `actual`
  - `EvaluationResult` (line 192): `{ matches: boolean, conditions: ConditionResult[] }`
  - `ParsedInfo` (line 200): Serializable parsed attributes for frontend
  - `CustomFormatWithConditions` (line 212): CF name + conditions array
  - `QualityProfileScoring` (line 355): Profile thresholds + CF scoring data
  - `ProfileCfScores` (line 370): Per-profile CF score mappings
  - `AllCfScoresResult` (line 377): All CF scores across all profiles
  - `CustomFormatScoresByArrType` (line 366): Score record by arr_type with `all` expansion

### Navigation System

- `/packages/praxrr-app/src/lib/server/navigation/registry.ts`: `NAV_REGISTRY` array of `NavItemDef` objects. Entity testing registered as a child of Quality Profiles (line 105). Score simulator should be registered as a new top-level nav item in the `policies` group, or as a child of Quality Profiles depending on routing decision.
- `/packages/praxrr-app/src/lib/shared/navigation/types.ts`: `NavItemDef`, `NavChildDef`, `ResolvedNavItem`, `NavShell` types. Items have `groupId`, `order`, `arrScope`, `mobilePriority`, `iconKey`, `emoji`, `hasChildren`, optional `requiredFeature`, `children[]`.
- `/packages/praxrr-app/src/lib/shared/navigation/constants.ts`: `NAV_GROUP_ID` -- groups are `overview`, `apps`, `policies`, `operations`, `settings`, `dev`.
- `/packages/praxrr-app/src/lib/client/ui/navigation/pageNav/pageNav.svelte`: Renders nav shell with scope-aware filtering. Items can be `visible` or `disabled` based on arr scope and `requiredFeature`.

### OpenAPI Contract System

- `/docs/api/v1/openapi.yaml`: Root OpenAPI spec with path and schema refs
- `/docs/api/v1/schemas/entity-testing.yaml`: Entity testing schemas (`MediaType`, `ParsedInfo`, `ReleaseInput`, `ReleaseEvaluation`, `EvaluateRequest`, `EvaluateResponse`). Several of these types can be referenced by the score simulator schema.
- `/docs/api/v1/paths/entity-testing.yaml`: Entity testing path definition
- `/packages/praxrr-app/src/lib/api/v1.d.ts`: Generated TypeScript types from OpenAPI. Regenerated via `deno task generate:api-types`.

### Progressive Disclosure

- `/packages/praxrr-app/src/lib/shared/disclosure/sectionKeys.ts`: Registry of disclosure section keys following `route-family:page:section` pattern. The simulator may need keys like `score-simulator:main:advanced-options` if progressive disclosure is used for batch/comparison modes.

### UI Components (Reusable)

- `$ui/navigation/tabs/Tabs.svelte`: Database tab switcher (used by entity testing)
- `$ui/actions/ActionsBar.svelte`, `ActionButton.svelte`, `SearchAction.svelte`: Toolbar pattern
- `$ui/table/ExpandableTable.svelte`: Table with expandable rows (used for CF match detail)
- `$ui/arr/Score.svelte`: Score display component with color coding
- `$ui/arr/CustomFormatBadge.svelte`: CF name badge
- `$ui/badge/Badge.svelte`: General badge component
- `$ui/modal/InfoModal.svelte`: Help/info modal
- `$ui/dropdown/Dropdown.svelte`, `DropdownItem.svelte`: Dropdown menus
- `$lib/client/stores/dataPage.ts`: `createDataPageStore` for search/filter/pagination
- `$lib/client/alerts/store.ts`: `alertStore.add(type, message)` for user notifications

## Data Flow

### Current Entity Testing Flow (Reference)

```
Client                          Server (page load)           Server (API)
  |                                |                            |
  |-- GET /entity-testing/[dbId] ->|                            |
  |                                |-- pcdManager.getAll()      |
  |                                |-- pcdManager.getCache(id)  |
  |                                |-- entityTestQueries.list() |
  |                                |-- qualityProfileQueries.select() |
  |                                |-- allCfScores(cache)       |
  |                                |-- isParserHealthy()        |
  |<--- SSR page data -------------|                            |
  |                                                             |
  |-- (user expands entity row) -------------------------------->|
  |-- POST /api/v1/entity-testing/evaluate                      |
  |   { databaseId, releases[] }                                |
  |                                                             |
  |                              parseWithCacheBatch(items)     |
  |                              getAllConditionsForEvaluation() |
  |                              extractAllPatterns(cfs)        |
  |                              matchPatternsBatch(titles, patterns) |
  |                              evaluateCustomFormat() per CF  |
  |                                                             |
  |<--- { parserAvailable, evaluations[] } --(boolean cfMatches)|
  |                                                             |
  |-- (client calculates scores from cfScoresData)              |
```

### Proposed Score Simulator Flow

```
Client                          Server (page load)           Server (API)
  |                                |                            |
  |-- GET /score-simulator/[dbId]->|                            |
  |                                |-- pcdManager.getAll()      |
  |                                |-- pcdManager.getCache(id)  |
  |                                |-- qualityProfileQueries.select() |
  |                                |-- isParserHealthy()        |
  |<--- SSR page data -------------|                            |
  |                                                             |
  |-- (user types title, selects profile) ---------------------->|
  |-- POST /api/v1/simulate/score                               |
  |   { databaseId, releases[], profileNames[], arrType }       |
  |                                                             |
  |                              parseWithCacheBatch(items)     |
  |                              getAllConditionsForEvaluation() |
  |                              extractAllPatterns(cfs)        |
  |                              matchPatternsBatch(titles, patterns) |
  |                              evaluateCustomFormat() per CF  |  <-- preserve ConditionResult[]
  |                              scoring(cache, dbId, profileName) per profile |
  |                              calculate totals per release per profile |
  |                                                             |
  |<--- { parserAvailable, results[] }                          |
  |     (cfMatches with conditions, profileScores with contributions) |
```

Key difference from entity testing: the simulator API computes scores server-side (instead of client-side), returns per-condition evaluation detail (instead of boolean match), and accepts multiple profile names for comparison.

## Integration Points

### Files to Create

1. **OpenAPI Contract** (create first, per project convention):
   - `docs/api/v1/schemas/score-simulator.yaml` -- Schema definitions for `SimulateScoreRequest`, `SimulateScoreResponse`, etc. Can `$ref` existing `MediaType`, `ParsedInfo` from `entity-testing.yaml`.
   - `docs/api/v1/paths/score-simulator.yaml` -- Path definition for `POST /api/v1/simulate/score`.

2. **API Endpoint**:
   - `packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts` -- POST handler. Imports from `$pcd/entities/customFormats/index.ts` (evaluator + conditions) and `$pcd/entities/qualityProfiles/index.ts` (scoring).

3. **Route Pages**:
   - `packages/praxrr-app/src/routes/score-simulator/+page.server.ts` -- Redirect to first database (matches entity testing pattern).
   - `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.server.ts` -- Load databases, profiles, parser health.
   - `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte` -- Main simulator UI.

4. **UI Components** (co-located with route):
   - `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ReleaseInput.svelte`
   - `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/SimulationResults.svelte`
   - `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ProfileComparison.svelte`
   - `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ScoreBreakdown.svelte`

### Files to Modify

1. `docs/api/v1/openapi.yaml` -- Add path ref, schema refs, and `Score Simulator` tag.
2. `packages/praxrr-app/src/lib/api/v1.d.ts` -- Regenerated via `deno task generate:api-types`.
3. `packages/praxrr-app/src/lib/server/navigation/registry.ts` -- Register nav item. Add to `NAV_REGISTRY` in the `policies` group, either as top-level item or as child of Quality Profiles.
4. `packages/praxrr-app/src/lib/shared/disclosure/sectionKeys.ts` -- Add section keys if using progressive disclosure for advanced options.

### No Changes Required

- No new database tables or migrations (all data is read-only from PCD cache).
- No new dependencies.
- No new environment variables.
- Parser client, evaluator, and scoring queries are used as-is.

## Architectural Patterns

- **Contract-first API**: OpenAPI spec defined first in `docs/api/v1/`, TypeScript types generated via `deno task generate:api-types`, then implementation follows. Score simulator must follow this pattern.
- **PCD Cache Access**: All PCD entity reads go through `pcdManager.getCache(databaseId)` which returns an in-memory SQLite instance (`PCDCache`) with a Kysely query builder (`cache.kb`). The cache is populated at startup and refreshed on sync/import operations.
- **Singleton Parser Client**: `ParserClient` is lazy-initialized as a singleton at `/packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`. All parser calls go through exported functions, not direct client instantiation.
- **Two-Layer Caching**: Parser results cached in `parsed_release_cache` (keyed by title:type + parser version). Pattern match results cached in `pattern_match_cache` (keyed by title + patterns hash). Both caches auto-invalidate on parser version change or pattern set change.
- **Server-Side Form Actions + Client API Calls**: Entity testing uses SvelteKit form actions for CRUD mutations and client-side `fetch()` for lazy evaluation. The score simulator will use only client-side API calls (read-only, no form actions needed).
- **Nav Registration**: Nav items declared in `NAV_REGISTRY` array with `NavItemDef` shape. Items grouped by `groupId`, ordered by `order`, scope-filtered by `arrScope` and `requiredFeature`. Entity testing is a child of Quality Profiles; score simulator could be top-level in `policies` group.
- **Database Tab Pattern**: Features that span multiple PCD databases use `Tabs` component with `pcdManager.getAll()` for database list and URL param `[databaseId]` for selection. Last-used database persisted in `localStorage`.
- **Disclosure Sections**: Progressive disclosure keys follow `route-family:page:section` pattern and are registered in `sectionKeys.ts`. Used for collapsing advanced options.

## Gotchas and Edge Cases

- **Evaluate endpoint discards condition details**: The existing `POST /api/v1/entity-testing/evaluate` reduces `evaluateCustomFormat()` results to boolean. The simulator needs the full `ConditionResult[]` array. Rather than modifying the existing endpoint (which would bloat entity testing responses), the recommendation is a new dedicated endpoint.
- **Score resolution precedence**: In `scoring/read.ts` lines 80-88, specific `arr_type` score takes precedence over `all` wildcard score. The `all` row is a fallback default. The simulator API must replicate this exact logic: `cfScores?.get(arrType) ?? cfScores?.get('all') ?? null`.
- **Entity testing computes scores client-side**: The entity testing page loads `allCfScores` at page load and computes totals in the Svelte component. The score simulator should compute scores server-side in the API response for a cleaner contract and to support multi-profile comparison without redundant data transfer.
- **Non-evaluable condition types**: `indexer_flag` and `size` conditions return `{ matched: false, expected: "...", actual: "N/A" }` from the evaluator since these require data not available from title parsing alone. The UI should clearly indicate these as "not evaluable" rather than "failed".
- **Edition and release_group matching**: These condition types match against the parsed substring (`parsed.edition`, `parsed.releaseGroup`) not the full title. This is a common user confusion point that the simulator should make visually clear.
- **JS regex fallback**: The evaluator has a JS regex fallback for pattern matching when the parser is unavailable. .NET regex and JS regex can produce different results for some patterns. The simulator should always prefer the parser `/match` endpoint and warn when falling back.
- **`ReleaseInput.id` type mismatch**: In the entity-testing OpenAPI schema, `ReleaseInput.id` is typed as `integer`. The feature spec proposes `string` (client-generated correlation ID) for the simulator. This is a deliberate deviation -- the simulator does not reference persistent release IDs.
- **Arr-type scoping for conditions**: Some condition types are Radarr-only (`quality_modifier`, `edition`) or Sonarr-only (`release_type`). The `ConditionData.arrType` field specifies this. The evaluator currently evaluates all conditions regardless -- the UI should annotate arr-type-specific conditions accordingly.
- **Svelte 5 without runes**: Per project conventions, use `onclick` handlers not `$state`/`$derived`. Reactivity via Svelte 4 stores and reactive declarations (`$:`).

## Key Dependencies

### Internal Modules (No Changes Needed)

| Module        | Import Path                              | Used For                                                                                               |
| ------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Parser Client | `$lib/server/utils/arr/parser/index.ts`  | `parseWithCacheBatch()`, `matchPatternsBatch()`, `isParserHealthy()`                                   |
| CF Evaluator  | `$pcd/entities/customFormats/index.ts`   | `evaluateCustomFormat()`, `getAllConditionsForEvaluation()`, `getParsedInfo()`, `extractAllPatterns()` |
| QP Scoring    | `$pcd/entities/qualityProfiles/index.ts` | `scoring()` for per-profile score mappings, `select()` for profile list                                |
| PCD Manager   | `$pcd/index.ts`                          | `pcdManager.getAll()`, `pcdManager.getCache()`                                                         |
| Nav Registry  | `$lib/server/navigation/registry.ts`     | `NAV_REGISTRY` for nav item registration                                                               |
| Shared Types  | `$shared/pcd/display.ts`                 | `ConditionResult`, `EvaluationResult`, `ParsedInfo`, `QualityProfileScoring`, etc.                     |

### External Services

| Service                               | Dependency Type            | Fallback                                               |
| ------------------------------------- | -------------------------- | ------------------------------------------------------ |
| C# Parser (`packages/praxrr-parser/`) | Required for full fidelity | Graceful degradation with "parser unavailable" warning |

### UI Components (Reusable)

| Component                 | Import Path                        | Used For                  |
| ------------------------- | ---------------------------------- | ------------------------- |
| Tabs                      | `$ui/navigation/tabs/Tabs.svelte`  | Database switching        |
| ExpandableTable           | `$ui/table/ExpandableTable.svelte` | CF match detail rows      |
| Score                     | `$ui/arr/Score.svelte`             | Color-coded score display |
| CustomFormatBadge         | `$ui/arr/CustomFormatBadge.svelte` | CF name badges            |
| Badge                     | `$ui/badge/Badge.svelte`           | Parsed attribute badges   |
| ActionsBar / ActionButton | `$ui/actions/`                     | Toolbar controls          |
| Dropdown / DropdownItem   | `$ui/dropdown/`                    | Profile selection         |
| InfoModal                 | `$ui/modal/InfoModal.svelte`       | Help content              |

## Other Docs

- `/docs/plans/score-simulator/feature-spec.md`: Complete feature specification with API design, data models, UX workflows, phasing, and risk assessment
- `/docs/plans/score-simulator/research-technical.md`: Detailed technical research including architecture, data models, and API design
- `/docs/plans/score-simulator/research-business.md`: Domain model, workflows, and existing codebase integration points
- `/docs/plans/score-simulator/research-ux.md`: Playground patterns, competitive analysis, accessibility, responsive design
- `/docs/plans/score-simulator/research-external.md`: Parser service integration, Arr scoring algorithm, ecosystem tools
- `/docs/plans/score-simulator/research-recommendations.md`: Phasing strategy, risks, alternative approaches
- [Radarr CustomFormatCalculationService.cs](https://github.com/Radarr/Radarr/blob/develop/src/NzbDrone.Core/CustomFormats/CustomFormatCalculationService.cs): Authoritative Arr scoring algorithm source
