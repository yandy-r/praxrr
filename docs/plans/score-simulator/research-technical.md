# Technical Specifications: Score Simulator

## Executive Summary

The score simulator is an interactive scoring playground that lets users test how custom format scores affect release selection without touching live Arr instances. It leverages the existing PCD cache (in-memory SQLite), the C# parser microservice for .NET-compatible regex matching, and the proven `evaluateCustomFormat` evaluation engine. The feature is primarily a new SvelteKit route with a lightweight API endpoint that extends the existing `/api/v1/entity-testing/evaluate` pattern, adding per-profile score calculation and side-by-side comparison on the server side.

## Architecture Design

### Component Diagram

```
User Input (release titles)
        |
        v
+---------------------------+
| /score-simulator/[dbId]   |  SvelteKit Page
| +page.svelte              |  (client-side UI)
+---------------------------+
        |  POST /api/v1/simulate/score
        v
+---------------------------+
| +server.ts                |  API Endpoint
| (server-side handler)     |
+----------+----------------+
           |
    +------+------+------------------+
    |             |                  |
    v             v                  v
+--------+  +-----------+  +------------------+
| Parser |  | PCD Cache |  | Scoring Read     |
| Client |  | (SQLite)  |  | (quality_profile |
| (.NET) |  |           |  |  _custom_formats)|
+--------+  +-----------+  +------------------+
```

### Data Flow

1. User enters one or more release titles and selects media type (movie/series).
2. User selects one or more quality profiles and an arr type for scoring context.
3. Client sends `POST /api/v1/simulate/score` with titles, databaseId, profileNames, arrType.
4. Server parses titles via parser microservice (using existing `parseWithCacheBatch`).
5. Server fetches all custom formats with conditions from PCD cache (using existing `getAllConditionsForEvaluation`).
6. Server matches regex patterns against titles via parser (using existing `matchPatternsBatch`).
7. Server evaluates each title against all custom formats (using existing `evaluateCustomFormat`).
8. Server fetches score mappings for each requested profile (using existing `scoring` read query).
9. Server calculates total scores per release per profile, including per-CF score breakdown.
10. Server returns structured response with parsed info, CF matches, condition details, and scores.
11. Client renders results: matched CFs, score breakdown, side-by-side profile comparison.

### New Components

- **API Endpoint** (`/api/v1/simulate/score`): Orchestrates parsing, evaluation, and score calculation. Extends the existing evaluate pattern with score summation and multi-profile support.
- **Score Simulator Page** (`/score-simulator/[databaseId]/+page.svelte`): Interactive UI with release title input, profile selector, arr type picker, and results display.
- **Score Simulator Server Load** (`/score-simulator/[databaseId]/+page.server.ts`): Loads database list, quality profiles, and parser health for initial page render.
- **SimulationResultCard** (component): Displays per-release results with matched CFs, scores, and expandable condition details.
- **ProfileComparisonTable** (component): Side-by-side score comparison across selected profiles.
- **OpenAPI Schema** (`docs/api/v1/schemas/score-simulator.yaml`): Contract-first schema definitions.
- **OpenAPI Path** (`docs/api/v1/paths/score-simulator.yaml`): Endpoint path definition.

### Integration Points

- **PCD Cache** <-> **Score Simulator API**: Read custom formats, conditions, and scoring data via existing `PCDCache.kb` Kysely queries. Access via `pcdManager.getCache(databaseId)`.
- **Parser Microservice** <-> **Score Simulator API**: Parse release titles and match regex patterns via existing `parseWithCacheBatch` and `matchPatternsBatch` from `$lib/server/utils/arr/parser/client.ts`.
- **Evaluator** <-> **Score Simulator API**: Run condition evaluation via existing `evaluateCustomFormat` from `$pcd/entities/customFormats/evaluator.ts`.
- **Scoring Queries** <-> **Score Simulator API**: Read CF scores per profile via existing `scoring` function from `$pcd/entities/qualityProfiles/scoring/read.ts`.

## Data Models

### Simulation Models (In-Memory)

```typescript
// --- Request Types ---

/** Media type for parsing context */
type SimulateMediaType = 'movie' | 'series';

/** A single release title to simulate */
interface SimulateReleaseInput {
  /** Client-generated ID for correlating results */
  id: string;
  /** Release title string (e.g., "Movie.2024.1080p.BluRay.REMUX-GROUP") */
  title: string;
  /** Media type for parser context */
  type: SimulateMediaType;
}

/** Score simulation request */
interface SimulateScoreRequest {
  /** PCD database instance ID */
  databaseId: number;
  /** Release titles to simulate */
  releases: SimulateReleaseInput[];
  /** Quality profile names to calculate scores for */
  profileNames: string[];
  /** Arr type for score resolution (determines which score column to use) */
  arrType: 'radarr' | 'sonarr';
}

// --- Response Types ---

/** Parsed metadata from a release title */
// Reuses existing ParsedInfo from $shared/pcd/display.ts:
// { source, resolution, modifier, languages, releaseGroup, year, edition, releaseType }

/** Per-condition evaluation detail */
interface SimulateConditionResult {
  conditionName: string;
  conditionType: string;
  matched: boolean;
  required: boolean;
  negate: boolean;
  passes: boolean;
  expected: string;
  actual: string;
}

/** A custom format match result with condition details */
interface SimulateCfMatch {
  /** Custom format name */
  name: string;
  /** Whether the CF matched overall */
  matches: boolean;
  /** Per-condition evaluation details (for drill-down) */
  conditions: SimulateConditionResult[];
}

/** Score breakdown for a single quality profile */
interface SimulateProfileScore {
  /** Quality profile name */
  profileName: string;
  /** Total score (sum of all matching CF scores) */
  totalScore: number;
  /** Minimum custom format score threshold from profile */
  minimumScore: number;
  /** Upgrade-until score from profile */
  upgradeUntilScore: number;
  /** Per-CF score contributions (only matched CFs with non-zero scores) */
  contributions: SimulateScoreContribution[];
}

/** A single CF's score contribution to a profile */
interface SimulateScoreContribution {
  /** Custom format name */
  cfName: string;
  /** Score value assigned in this profile */
  score: number;
}

/** Evaluation result for a single release title */
interface SimulateReleaseResult {
  /** Correlates to input release ID */
  id: string;
  /** The release title */
  title: string;
  /** Parsed metadata (null if parser failed) */
  parsed: ParsedInfo | null;
  /** All custom format match results */
  cfMatches: SimulateCfMatch[];
  /** Score results per selected profile */
  profileScores: SimulateProfileScore[];
}

/** Full simulation response */
interface SimulateScoreResponse {
  /** Whether the parser microservice is available */
  parserAvailable: boolean;
  /** Per-release evaluation results */
  results: SimulateReleaseResult[];
}
```

### PCD Entity References

Custom formats and scoring data are read from the PCD in-memory SQLite cache. The key tables queried (all via Kysely on `PCDCache.kb`):

| Table                                                                                                                                                                                          | Purpose                                                           | Access Pattern                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------- |
| `custom_formats`                                                                                                                                                                               | CF names and IDs                                                  | `getAllConditionsForEvaluation()` |
| `custom_format_conditions`                                                                                                                                                                     | Condition definitions per CF                                      | `getAllConditionsForEvaluation()` |
| `condition_patterns` + `regular_expressions`                                                                                                                                                   | Regex patterns for release_title/edition/release_group conditions | `getAllConditionsForEvaluation()` |
| `condition_languages`, `condition_sources`, `condition_resolutions`, `condition_quality_modifiers`, `condition_release_types`, `condition_indexer_flags`, `condition_sizes`, `condition_years` | Condition-type-specific data                                      | `getAllConditionsForEvaluation()` |
| `quality_profiles`                                                                                                                                                                             | Profile settings (min score, upgrade_until_score)                 | `scoring()`                       |
| `quality_profile_custom_formats`                                                                                                                                                               | CF-to-profile score mappings per arr_type                         | `scoring()`                       |

No new database tables are needed. All simulation state is transient and computed in-memory per request.

## API Design

### OpenAPI Schema (Contract-First)

The following schemas should be added to `docs/api/v1/schemas/score-simulator.yaml`:

```yaml
SimulateMediaType:
  type: string
  enum:
    - movie
    - series

SimulateReleaseInput:
  type: object
  required:
    - id
    - title
    - type
  properties:
    id:
      type: string
      description: Client-generated correlation ID
    title:
      type: string
      description: Release title to parse and evaluate
    type:
      $ref: '#/SimulateMediaType'

SimulateScoreRequest:
  type: object
  required:
    - databaseId
    - releases
    - profileNames
    - arrType
  properties:
    databaseId:
      type: integer
      description: PCD database instance ID
    releases:
      type: array
      items:
        $ref: '#/SimulateReleaseInput'
      maxItems: 50
      description: Release titles to simulate (max 50)
    profileNames:
      type: array
      items:
        type: string
      maxItems: 10
      description: Quality profile names to score against (max 10)
    arrType:
      type: string
      enum:
        - radarr
        - sonarr
      description: Arr type for score column resolution

SimulateConditionResult:
  type: object
  required:
    - conditionName
    - conditionType
    - matched
    - required
    - negate
    - passes
    - expected
    - actual
  properties:
    conditionName:
      type: string
    conditionType:
      type: string
    matched:
      type: boolean
    required:
      type: boolean
    negate:
      type: boolean
    passes:
      type: boolean
    expected:
      type: string
    actual:
      type: string

SimulateCfMatch:
  type: object
  required:
    - name
    - matches
    - conditions
  properties:
    name:
      type: string
    matches:
      type: boolean
    conditions:
      type: array
      items:
        $ref: '#/SimulateConditionResult'

SimulateScoreContribution:
  type: object
  required:
    - cfName
    - score
  properties:
    cfName:
      type: string
    score:
      type: integer

SimulateProfileScore:
  type: object
  required:
    - profileName
    - totalScore
    - minimumScore
    - upgradeUntilScore
    - contributions
  properties:
    profileName:
      type: string
    totalScore:
      type: integer
    minimumScore:
      type: integer
    upgradeUntilScore:
      type: integer
    contributions:
      type: array
      items:
        $ref: '#/SimulateScoreContribution'

SimulateReleaseResult:
  type: object
  required:
    - id
    - title
    - cfMatches
    - profileScores
  properties:
    id:
      type: string
    title:
      type: string
    parsed:
      $ref: '../schemas/entity-testing.yaml#/ParsedInfo'
    cfMatches:
      type: array
      items:
        $ref: '#/SimulateCfMatch'
    profileScores:
      type: array
      items:
        $ref: '#/SimulateProfileScore'

SimulateScoreResponse:
  type: object
  required:
    - parserAvailable
    - results
  properties:
    parserAvailable:
      type: boolean
    results:
      type: array
      items:
        $ref: '#/SimulateReleaseResult'
```

### New Endpoints

#### `POST /api/v1/simulate/score`

**Purpose**: Parse release titles, evaluate custom formats, and calculate scores for selected quality profiles.

**Auth**: Required (follows existing auth middleware in `hooks.server.ts`).

**Request**: `SimulateScoreRequest`

**Response**: `SimulateScoreResponse`

**Error Responses**:

- `400`: Missing or invalid fields (empty releases, empty profileNames, invalid arrType)
- `404`: Database cache not found, or one or more profile names not found
- `500`: Internal error

**Implementation Notes**:

- Maximum 50 releases per request (prevents abuse).
- Maximum 10 profiles per request (keeps response size reasonable).
- Uses existing cached parser results (`parseWithCacheBatch`) -- repeat titles are fast.
- Uses existing pattern match caching (`matchPatternsBatch`).
- The `arrType` parameter determines which score column to read from `quality_profile_custom_formats`. The `'all'` fallback score is applied when no app-specific score exists, matching existing `scoring()` behavior.

### Modified Endpoints

No existing endpoints need modification. The score simulator is additive.

### OpenAPI Spec Updates

Add to `docs/api/v1/openapi.yaml`:

```yaml
# Under paths:
/simulate/score:
  $ref: './paths/score-simulator.yaml#/simulate-score'

  # Under components/schemas:
  SimulateScoreRequest:
    $ref: './schemas/score-simulator.yaml#/SimulateScoreRequest'
  SimulateScoreResponse:
    $ref: './schemas/score-simulator.yaml#/SimulateScoreResponse'
  # ... (other schema refs)
```

Add new tag:

```yaml
- name: Score Simulator
  description: Interactive scoring playground for testing custom format scores
```

## System Constraints

### Performance

- **Parser round-trip**: ~10-50ms per title. Batch parsing and result caching (`parseWithCacheBatch`) mitigate this. Cached titles resolve in <1ms.
- **Pattern matching**: ~5-20ms per batch via parser microservice. Results cached in `pattern_match_cache` with hash-based invalidation.
- **CF evaluation**: Pure in-memory computation against PCD cache. ~0.1ms per CF per release. With ~200 CFs and 50 releases, total ~1s worst case.
- **Score calculation**: O(profiles \* matched_CFs) map lookups. Negligible overhead.
- **Target**: Full simulation for 10 releases x 5 profiles should complete in <500ms (cached parser), <2s (cold parser).
- **Client debounce**: Input should debounce 300-500ms before triggering API call to avoid excessive requests during typing.

### Parser Service Dependency

- The parser microservice is optional. When unavailable, the API returns `parserAvailable: false` and empty results.
- The UI should show a clear warning banner when parser is unavailable (following existing entity-testing pattern).
- For pattern-based conditions (`release_title` type), the parser's `/match/batch` endpoint provides .NET-compatible regex matching. Without it, a JS regex fallback exists in the evaluator but may produce different results for .NET-specific patterns.

### PCD Cache Integration

- The PCD cache must be compiled for the selected database. If not available, API returns 404.
- Cache is read-only for simulation -- no writes, no ops.
- Cache contents are consistent within a single request (snapshot semantics from SQLite in-memory DB).

### Security

- All inputs are validated (title length, array size limits).
- Regex patterns are pre-compiled with 100ms timeout in the parser service (ReDoS protection).
- No user data is persisted by the simulator -- all results are ephemeral.
- Standard auth middleware applies.

## Codebase Changes

### Files to Create

**OpenAPI Contract (create first, then generate types)**:

- `docs/api/v1/schemas/score-simulator.yaml`: Schema definitions for request/response types
- `docs/api/v1/paths/score-simulator.yaml`: Path definition for `POST /simulate/score`

**API Endpoint**:

- `packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts`: POST handler. Follows the pattern in `/api/v1/entity-testing/evaluate/+server.ts`. Orchestrates parse -> evaluate -> score flow.

**Route Pages**:

- `packages/praxrr-app/src/routes/score-simulator/+page.server.ts`: Redirect to first database (follows custom-formats pattern).
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.server.ts`: Load databases, quality profiles, parser health, canWriteToBase.
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte`: Main simulator UI page.

**UI Components** (co-located with route):

- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ReleaseInput.svelte`: Multi-line release title input with media type selector.
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/SimulationResults.svelte`: Results display with expandable CF match details.
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ProfileComparison.svelte`: Side-by-side profile score comparison table.
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ScoreBreakdown.svelte`: Per-release score breakdown card showing CF contributions.

### Files to Modify

- `docs/api/v1/openapi.yaml`: Add path ref, schema refs, and `Score Simulator` tag (lines ~30, ~145, ~500).
- `packages/praxrr-app/src/lib/api/v1.d.ts`: Regenerated via `deno task generate:api-types` after OpenAPI updates.

**Navigation** (add score-simulator to nav):

- The navigation file(s) that define sidebar/top-nav items. Check `$ui/navigation/` or layout files for where nav items are declared.

### Dependencies

No new dependencies required. The feature builds entirely on existing infrastructure:

- Parser client (`$lib/server/utils/arr/parser/client.ts`)
- PCD cache system (`$pcd/index.ts`)
- CF evaluator (`$pcd/entities/customFormats/evaluator.ts`)
- Scoring queries (`$pcd/entities/qualityProfiles/scoring/read.ts`)
- Existing UI components (Table, Card, Badge, Tabs, ActionsBar, Modal, Dropdown)

## Technical Decisions

### Decision 1: Server-Side vs Client-Side Score Calculation

- **Options**: (A) Calculate scores entirely on the server, (B) Send CF matches to client and calculate scores client-side (current entity-testing approach), (C) Hybrid
- **Recommendation**: A -- Server-side calculation
- **Rationale**: The entity-testing page sends `cfMatches` (boolean map) and `cfScoresData` (all profiles' scores) to the client, which calculates scores in `calculateScore()`. This works but requires sending the full score matrix to the client. For the simulator, server-side calculation is cleaner because: (1) we can return computed `totalScore` and `contributions` directly, reducing client complexity; (2) condition details are included per-CF for drill-down, which is more data than entity-testing sends; (3) the server already has all data in the PCD cache. The response is self-contained.

### Decision 2: New Endpoint vs Extending Existing Evaluate Endpoint

- **Options**: (A) New endpoint `/api/v1/simulate/score`, (B) Extend `/api/v1/entity-testing/evaluate` with optional scoring params
- **Recommendation**: A -- New endpoint
- **Rationale**: The existing evaluate endpoint serves entity testing with a different contract (integer release IDs, no profile selection, boolean-only CF matches, no condition details). Overloading it would complicate both consumers. A dedicated endpoint keeps contracts clean and follows the existing pattern of purpose-specific endpoints.

### Decision 3: Route Structure

- **Options**: (A) Top-level `/score-simulator/[databaseId]`, (B) Nested under `/quality-profiles/score-simulator/[databaseId]`, (C) Nested under `/custom-formats/score-simulator/[databaseId]`
- **Recommendation**: A -- Top-level route
- **Rationale**: The simulator bridges both custom formats and quality profiles. It is a cross-cutting tool that does not belong under either entity. A top-level route with database tabs (following the entity-testing pattern) is the most discoverable and consistent.

### Decision 4: Condition Details in Response

- **Options**: (A) Include full condition evaluation details per CF, (B) Only include match boolean per CF (like entity-testing), (C) Include details only for matched CFs
- **Recommendation**: A -- Full condition details for all CFs
- **Rationale**: The simulator's primary value is understanding _why_ a release scored the way it did. Showing which conditions matched/failed for each CF is essential for debugging scoring configurations. The data volume is manageable since conditions are small objects and we cap at 50 releases.

### Decision 5: Side-by-Side Comparison Approach

- **Options**: (A) Multi-profile request with server-side comparison, (B) Multiple sequential single-profile requests composed client-side
- **Recommendation**: A -- Multi-profile in single request
- **Rationale**: Parsing and CF evaluation are identical across profiles -- only the score lookup differs. A single request avoids redundant parsing and evaluation. The server can share the parse/evaluate work and only vary the score lookup per profile.

## Relevant Files

### Core Evaluation Engine (reuse as-is)

- `/packages/praxrr-app/src/lib/server/pcd/entities/customFormats/evaluator.ts`: CF condition evaluator with full match logic. Contains `evaluateCustomFormat()`, `getParsedInfo()`, `extractAllPatterns()`.
- `/packages/praxrr-app/src/lib/server/pcd/entities/customFormats/conditions/read.ts`: Fetches condition data from PCD cache. Contains `getAllConditionsForEvaluation()` for batch loading.

### Scoring Data Access (reuse as-is)

- `/packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/scoring/read.ts`: Reads CF scores per profile with arr_type resolution and `'all'` fallback logic.

### Parser Integration (reuse as-is)

- `/packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`: Parser client with `parseWithCacheBatch()` and `matchPatternsBatch()`.
- `/packages/praxrr-app/src/lib/server/utils/arr/parser/types.ts`: Parser type definitions (`ParseResult`, `MediaType`, enums).

### PCD System

- `/packages/praxrr-app/src/lib/server/pcd/index.ts`: Public PCD API exports. Access `pcdManager.getCache(id)`.
- `/packages/praxrr-app/src/lib/server/pcd/database/cache.ts`: `PCDCache` class with `kb` (Kysely) accessor.
- `/packages/praxrr-app/src/lib/server/pcd/database/registry.ts`: Cache registry (Map of databaseId -> PCDCache).

### Shared Types

- `/packages/praxrr-app/src/lib/shared/pcd/display.ts`: Shared type definitions for `ConditionData`, `ConditionResult`, `EvaluationResult`, `ParsedInfo`, `CustomFormatWithConditions`, `QualityProfileScoring`, `CustomFormatScoring`, `CustomFormatScoresByArrType`.

### Existing Pattern Reference (entity-testing)

- `/packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts`: Reference implementation for parse -> evaluate flow. The score simulator endpoint should follow this pattern closely.
- `/packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/+page.svelte`: Reference for database tabs, profile selection dropdown, client-side score display, lazy evaluation on expand.

### OpenAPI Contract

- `/docs/api/v1/openapi.yaml`: Main OpenAPI spec (add new path + schema refs here).
- `/docs/api/v1/schemas/entity-testing.yaml`: Existing schema definitions (reference for format).
- `/docs/api/v1/paths/entity-testing.yaml`: Existing path definitions (reference for format).

### UI Components (reuse)

- `/packages/praxrr-app/src/lib/client/ui/table/ExpandableTable.svelte`: Expandable table for drill-down results.
- `/packages/praxrr-app/src/lib/client/ui/card/StickyCard.svelte`: Sticky summary card.
- `/packages/praxrr-app/src/lib/client/ui/card/CollapsibleCard.svelte`: Collapsible card for result sections.
- `/packages/praxrr-app/src/lib/client/ui/navigation/tabs/Tabs.svelte`: Database tab navigation.
- `/packages/praxrr-app/src/lib/client/ui/actions/ActionsBar.svelte`: Action bar for controls.
- `/packages/praxrr-app/src/lib/client/ui/badge/Badge.svelte`: Score/match badges.

## Edgecases

- Parser service being unavailable must degrade gracefully: show warning, disable simulate button, return `parserAvailable: false`. Do not attempt evaluation without parser results.
- A quality profile with zero CF score mappings is valid and should return `totalScore: 0` with empty `contributions`.
- Custom formats with zero conditions should report `matches: false` (matches existing evaluator behavior).
- The `'all'` meta arr_type in `quality_profile_custom_formats` serves as a fallback when no app-specific score exists. The scoring logic must apply the same fallback precedence as the existing `scoring()` function: specific arr_type score > `'all'` score > null (no contribution).
- Release titles with .NET-specific regex patterns (lookaheads, named groups) must be matched via the parser service. The JS regex fallback in `evaluatePattern()` may produce false negatives for these patterns. The simulator should always prefer parser-service matching when available.
- Condition types `indexer_flag` and `size` cannot be evaluated from title parsing alone. These should appear as `"N/A"` in results, matching existing evaluator behavior.
- Empty release title strings should be rejected at the API level (400 error).
- Profile names are case-sensitive in the PCD cache. Invalid profile names should return 404 with a clear error message listing which names were not found.
- The `arrType` parameter is required because score resolution depends on it. If the user's database has CFs scored only for `'all'`, those scores will correctly resolve for both `radarr` and `sonarr` arr types.

## Other Docs

- `/packages/praxrr-app/src/lib/server/utils/arr/README.md`: Arr client architecture documentation
- `/packages/praxrr-app/src/lib/shared/pcd/conditions.ts`: Condition type definitions and canonical value mappings
- `/docs/api/v1/openapi.yaml`: OpenAPI v1 spec (contract-first workflow reference)
