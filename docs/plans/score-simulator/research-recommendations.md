# Recommendations: score-simulator

## Executive Summary

The score simulator should be built as a new top-level route under `/quality-profiles/score-simulator/[databaseId]` that reuses the existing evaluate API pipeline (`/api/v1/entity-testing/evaluate`) and PCD scoring infrastructure. The core evaluation engine (parser client, custom format evaluator, pattern matcher, scoring queries) already exists and is well-tested through the entity testing feature -- the primary work is UI composition and an enhanced API endpoint that returns per-CF score breakdowns rather than just match booleans. The biggest risk is parser service dependency for real-time interactive use; the existing caching layer mitigates this substantially, but a degraded client-side-only mode should be designed from the start.

## Implementation Recommendations

### Recommended Approach

Build the simulator as a hybrid server/client feature that leverages the existing server-side evaluate pipeline for parsing and CF matching, with client-side score calculation and comparison logic. This matches the pattern already established by entity testing (`/quality-profiles/entity-testing/[databaseId]`), where the server handles parsing/matching via the evaluate API and the client computes scores from `cfScoresData`.

The key architectural insight is that the existing `POST /api/v1/entity-testing/evaluate` endpoint already does 90% of what the simulator needs:

1. Batch parses release titles via the C# parser (with caching)
2. Matches all custom format conditions (with .NET regex via parser service)
3. Returns `cfMatches: Record<string, boolean>` per release

The simulator needs the evaluate endpoint to additionally return **per-condition detail** (already computed by `evaluateCustomFormat()` but currently reduced to a boolean), plus client-side score summation using the existing `allCfScores` query pattern.

### Technology Choices

| Component              | Recommendation                                                     | Rationale                                                                                                          |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Routing                | `/quality-profiles/score-simulator/[databaseId]` as nav child      | Follows entity testing pattern; score simulation is a quality profile concern                                      |
| API                    | Extend evaluate endpoint or add `/api/v1/score-simulator/evaluate` | Reuse existing `parseWithCacheBatch` + `evaluateCustomFormat` pipeline                                             |
| Parser integration     | Server-side via existing `ParserClient`                            | Already has caching (`parsedReleaseCacheQueries`, `patternMatchCacheQueries`), retry, timeout (30s), batch support |
| Score computation      | Client-side from `allCfScores` data                                | Matches entity testing pattern; avoids server round-trips when switching profiles                                  |
| Comparison mode        | Client-side state diffing                                          | Two profile selections, same CF match data, different score tables                                                 |
| Presets/examples       | PCD-stored test releases or hardcoded presets                      | Entity testing already stores test releases in PCD; could reuse or add simulator-specific presets                  |
| Progressive disclosure | Integrate with existing `SectionKey` system                        | Add keys like `score-simulator:main:condition-details` for expandable condition breakdowns                         |

### Phasing Strategy

1. **Phase 1 - MVP (Single Release Evaluation)**: Input a release title, select media type and database, see parsed metadata, matched custom formats, and scores for a selected quality profile. This is essentially the entity testing expanded-row view extracted into its own page with direct title input.

2. **Phase 2 - Comparison & Batch**: Side-by-side profile comparison (same release, two profiles), batch release input (paste multiple titles), and example release presets. Score ranking table showing how releases would be ordered.

3. **Phase 3 - What-If Integration**: Temporary score overrides (edit scores without saving to PCD), integration with quality profile editor ("test this profile" button), and connection to Config Impact Simulator (#30). Possible sandbox PCD cache for hypothetical scoring configurations.

### Quick Wins

- **Reuse evaluate endpoint directly**: The existing `/api/v1/entity-testing/evaluate` works as-is for basic CF matching. A Phase 1 prototype could call it unchanged and compute scores client-side.
- **Extract `ReleaseTable` expanded view as component**: The parsed metadata + CF badge display in `ReleaseTable.svelte` is exactly what the simulator needs; factor it into a shared component.
- **Nav registration**: Adding a child entry under `policies.quality_profiles` in the nav registry is a one-line change (see `registry.ts` line 105).
- **Leverage parser cache**: The `parseWithCache` and `matchPatternsBatch` functions already cache aggressively by parser version and pattern hash; interactive simulator calls will benefit immediately.

## Improvement Ideas

### Related Features

- **Quality Profile Editor Integration**: Add a "Simulate" button on the scoring tab (`/quality-profiles/[databaseId]/[id]/scoring`) that opens the simulator pre-loaded with that profile. The scoring page already loads all CF scores and arr types.
- **Custom Format Testing Consolidation**: The existing CF testing page (`/custom-formats/[databaseId]/[id]/testing`) does single-CF evaluation. The simulator could supersede this with a multi-CF view, though the per-condition detail in CF testing remains valuable.
- **Entity Testing Convergence**: The entity testing page already has score calculation, CF matching, and parsed metadata display. The simulator is essentially entity testing without the TMDB entity overhead -- consider sharing route components.

### Future Enhancements

- **Score History/Snapshots**: Save simulator sessions to compare how scoring would change across PCD updates. The PCD ops model supports temporal queries.
- **Bulk Import from Arr Instances**: Import actual release candidates from connected Radarr/Sonarr instances (entity testing already has `ImportReleasesModal`).
- **Score Distribution Visualization**: Histogram/chart showing score distribution across a set of releases for a given profile.
- **Quality Goal Integration (#20)**: Show whether a release meets quality goals, not just raw score.
- **Sharable Presets**: Export/import simulator configurations (release title sets + profile selections) as JSON for community sharing.

### Integration Opportunities

- **Config Impact Simulator (#30)**: The score simulator is a building block for the broader what-if testing system. Design the API to return enough data that a future sandbox mode can swap in hypothetical scores.
- **Sync Preview (#7)**: Score simulation results could feed into sync preview to show "this release would/would not be grabbed."
- **Progressive Disclosure (#11)**: The simulator is a natural "advanced" tool. Default to basic mode (score + matched CFs), expand to show per-condition evaluation details in advanced mode.

## Risk Assessment

### Technical Risks

| Risk                                 | Likelihood | Impact | Mitigation                                                                                                                                                        |
| ------------------------------------ | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parser service unavailable           | Medium     | High   | Design degraded mode: show "parser unavailable" prominently (pattern from entity testing); allow score-only comparison without parsing for pre-evaluated releases |
| .NET regex vs JS regex mismatch      | Low        | Medium | Already handled: `evaluatePattern()` falls back to JS regex when `patternMatches` unavailable; document the limitation                                            |
| Parser latency for interactive use   | Medium     | Medium | Existing cache (`parsedReleaseCacheQueries`) + debounce input; average cached parse is <1ms, uncached is ~30-100ms per title                                      |
| Large CF count performance           | Low        | Medium | `getAllConditionsForEvaluation` already batch-loads all CFs efficiently; 100+ CFs with 500+ conditions tested in entity testing                                   |
| Scoring accuracy divergence from Arr | Medium     | High   | Score calculation must match Radarr/Sonarr exactly; the `allScore`/`arrType`-specific score precedence logic in `scoring/read.ts` must be replicated correctly    |
| Cross-Arr semantic confusion         | Medium     | Medium | Simulator must be explicit about whether scores are for Radarr or Sonarr; entity type (movie/series) determines arr_type for scoring                              |

### Integration Challenges

- **Evaluate endpoint response shape**: The current evaluate response returns `cfMatches: Record<string, boolean>` which loses per-condition detail. For the "why it matches" transparency goal, a new or extended endpoint returning `EvaluationResult` (with `ConditionResult[]`) per CF is needed. This is already computed internally by `evaluateCustomFormat()` but discarded.
- **Score computation client/server split**: Entity testing computes scores client-side from `cfScoresData.profiles`. The simulator should follow this pattern for profile-switching responsiveness, but must correctly handle the `all`/`arrType`-specific score precedence (`scoring/read.ts` lines 80-88).
- **Database selection**: Simulator needs database context for CF evaluation. Must handle the multi-database tab pattern used throughout the app.

### Performance Concerns

- **Initial load**: Loading `allCfScores` + `getAllConditionsForEvaluation` takes ~50-150ms per database (measured in entity testing). Acceptable for page load.
- **Real-time parsing**: Each parser call is ~30-100ms uncached. For interactive "type and see" behavior, debounce at 300-500ms. The existing cache means repeated titles are instant.
- **Batch pattern matching**: The `matchPatternsBatch` endpoint processes all patterns against all titles in parallel on the C# side. For N titles x M patterns, this is efficient but could be slow for very large batches (>50 titles x >500 patterns).

## Alternative Approaches

### Option A: Server-Side Evaluation (extend evaluate API)

Add a new endpoint `POST /api/v1/score-simulator/evaluate` that returns full evaluation results including per-CF condition details and score breakdowns for specified profiles.

- **Pros**: Single request gets everything; scoring logic stays server-side and authoritative; condition detail available without extra queries; matches contract-first API convention
- **Cons**: Every profile switch requires a new server request; more complex API response shape; heavier server load for interactive use

### Option B: Hybrid (current entity testing pattern)

Use the existing evaluate endpoint for parsing + CF matching, compute scores client-side from pre-loaded `allCfScores` data. Add a separate endpoint or extend the response for per-condition details.

- **Pros**: Profile switching is instant (client-side); proven pattern from entity testing; lighter server load; responsive UI for comparison mode
- **Cons**: Score calculation logic duplicated between client and server (risk of divergence); per-condition detail requires API change or second call

### Option C: Fully Client-Side with WASM Parser

Compile the C# parser to WASM and run entirely in the browser. No server dependency.

- **Pros**: No parser service dependency; works offline; zero latency for parsing; could work as a standalone tool
- **Cons**: .NET to WASM is large (~10-20MB download); C# parser uses .NET regex which has specific behaviors; maintaining WASM build pipeline adds complexity; evaluation still needs PCD data from server; contradicts existing architecture

### Recommendation

**Option B (Hybrid)** is the clear winner. It matches the proven entity testing architecture, avoids WASM complexity, and provides the best interactive experience for the comparison use case. The only new server work is optionally extending the evaluate response to include per-condition evaluation details for the "why it matches" transparency feature.

## Task Breakdown Preview

### Phase 1: Foundation (MVP)

- **Task group: API layer**
  - Define OpenAPI schema for simulator evaluate endpoint (extend or fork entity-testing schemas)
  - Implement `POST /api/v1/score-simulator/evaluate` endpoint returning `EvaluationResult` per CF (condition-level detail)
  - Generate TypeScript types via `deno task generate:api-types`

- **Task group: Server data loading**
  - Create `+page.server.ts` for `/quality-profiles/score-simulator/[databaseId]`
  - Load databases, quality profiles, `allCfScores`, parser health status (pattern from entity testing `+page.server.ts`)

- **Task group: Core UI**
  - Create simulator page layout with database tabs
  - Build release title input form (title + media type selector)
  - Build parsed metadata display (extract from `ReleaseTable.svelte` expanded view)
  - Build CF match results table with score column
  - Build profile selector dropdown (reuse pattern from entity testing)

- **Task group: Navigation**
  - Register nav child under `policies.quality_profiles` in `registry.ts`
  - Add disclosure section keys if using progressive disclosure

- **Parallel opportunities**: API schema + server data loading can run in parallel with core UI scaffolding. Nav registration is independent.

### Phase 2: Comparison and Batch

- **Task group: Side-by-side comparison**
  - Dual profile selector UI
  - Score diff display (highlight differences between two profiles)
  - Shared CF match data, dual score computation

- **Task group: Batch input**
  - Multi-line title input (paste multiple release titles)
  - Batch evaluate API call
  - Results ranking table (sorted by total score)

- **Task group: Presets and examples**
  - Example release title presets (movie and series categories)
  - "Common scoring scenarios" examples (remux vs web-dl, proper/repack, etc.)
  - Load from PCD test releases or hardcoded list

- **Dependencies**: Phase 1 API and core UI must complete first. Comparison and batch are independent of each other.

### Phase 3: Integration and Polish

- **Task group: Editor integration**
  - "Simulate" button on quality profile scoring page
  - Pre-load simulator with current profile context
  - Deep link support (profile ID + release title in URL params)

- **Task group: What-if mode**
  - Temporary score override UI (edit scores in simulator without saving)
  - Sandbox score computation using modified scores
  - Connect to Config Impact Simulator (#30) infrastructure

- **Task group: Testing**
  - Unit tests for score computation logic
  - E2E tests for simulator page flow
  - Integration tests for evaluate endpoint

### Estimated Complexity

- **Total tasks**: ~18-24 discrete tasks across three phases
- **Critical path**: OpenAPI schema -> API endpoint -> page server load -> core UI -> profile selector -> score display
- **Phase 1 estimated effort**: 3-5 days (most infrastructure already exists)
- **Phase 2 estimated effort**: 3-4 days (UI-heavy, no new server logic)
- **Phase 3 estimated effort**: 4-6 days (what-if mode requires sandbox PCD consideration)

## Relevant Files

### Core Evaluation Infrastructure (reuse these)

- `/packages/praxrr-app/src/lib/server/pcd/entities/customFormats/evaluator.ts`: CF condition evaluator with full condition-type support (release_title, language, source, resolution, quality_modifier, release_type, year, edition, release_group)
- `/packages/praxrr-app/src/lib/server/pcd/entities/customFormats/conditions/read.ts`: `getAllConditionsForEvaluation()` batch-loads all CFs with conditions from PCD cache
- `/packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`: Parser service client with `parseWithCacheBatch()`, `matchPatternsBatch()`, health checks, and version-keyed caching
- `/packages/praxrr-app/src/lib/server/utils/arr/parser/types.ts`: `ParseResult`, `MediaType`, quality/resolution/language enums
- `/packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/scoring/read.ts`: `scoring()` and `allCfScores()` queries for profile-level score data

### Existing Evaluate API (extend or fork)

- `/packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts`: Existing batch evaluate endpoint; returns `cfMatches` booleans
- `/packages/praxrr-app/docs/api/v1/schemas/entity-testing.yaml`: OpenAPI schemas for `EvaluateRequest`, `EvaluateResponse`, `ReleaseEvaluation`, `ParsedInfo`

### UI Pattern References (follow these)

- `/packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/+page.svelte`: Entity testing page with profile selector, score calculation, expandable release details
- `/packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/+page.server.ts`: Server load pattern: databases, profiles, cfScoresData, parserAvailable
- `/packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/components/ReleaseTable.svelte`: Release expanded view with parsed metadata badges and CF score badges
- `/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/scoring/components/ScoringTable.svelte`: Desktop/mobile responsive scoring table with arr-type columns

### Navigation and Disclosure

- `/packages/praxrr-app/src/lib/server/navigation/registry.ts`: Nav item registry; quality profiles already has "Testing" child at line 105
- `/packages/praxrr-app/src/lib/shared/disclosure/sectionKeys.ts`: Section key registry for progressive disclosure

### Parser Service

- `/packages/praxrr-parser/Program.cs`: Parser service entry point (endpoints: /parse, /match, /match/batch, /health)
- `/packages/praxrr-parser/Endpoints/ParseEndpoints.cs`: Release title parsing with quality, language, release group, episode detection
- `/packages/praxrr-parser/Endpoints/MatchEndpoints.cs`: .NET regex pattern matching with batch support, ReDoS timeout protection

### Shared Types

- `/packages/praxrr-app/src/lib/shared/pcd/display.ts`: `EvaluationResult`, `ConditionResult`, `ConditionData`, `ParsedInfo`, `CustomFormatWithConditions`, `QualityProfileScoring`, `AllCfScoresResult`, `CustomFormatScoresByArrType`

## Key Decisions Needed

- **Separate endpoint vs extend existing**: Should the simulator use the existing `/api/v1/entity-testing/evaluate` endpoint (adding optional `includeConditionDetails` parameter) or create a dedicated `/api/v1/score-simulator/evaluate` endpoint? The former is simpler but couples the features; the latter is cleaner but duplicates pipeline code.
- **URL structure**: Should the simulator live under `/quality-profiles/score-simulator/[databaseId]` (as a quality profile child) or as a top-level route `/score-simulator/[databaseId]`? The former groups it logically with scoring; the latter gives it more prominence.
- **Preset storage**: Should example release titles be hardcoded in the client, stored in PCD (like CF tests), or maintained as a separate configuration? PCD storage enables community-contributed presets but adds ops complexity.
- **What-if scope boundary**: For Phase 3, should the simulator support temporary CF additions (not just score changes), or is that deferred to the full Config Impact Simulator (#30)?

## Open Questions

- Does the simulator need to support Lidarr/other arr types, or is Radarr/Sonarr sufficient for the initial implementation? The scoring infrastructure supports `ArrAppType` generically but the entity testing UI currently maps movie->radarr and series->sonarr.
- Should the simulator persist state across sessions (e.g., recent titles, preferred profile) via localStorage, or is it purely ephemeral? Entity testing uses localStorage for `selectedProfileId`.
- Is there an appetite for showing "would this release be grabbed?" logic (incorporating quality cutoff, minimum score, upgrade-until-score) or should the simulator strictly show score breakdowns? The quality profile already stores `minimum_custom_format_score`, `upgrade_until_score`, and `upgrade_score_increment`.
- For the comparison mode, should it compare two profiles against the same release, or the same profile against two different releases (or both)?

## Other Docs

- GitHub Issue #13: [Feature] Score Simulator / Playground
- GitHub Issue #30: [Feature] Configuration Impact Simulator (what-if testing)
- GitHub Issue #20: Quality Goals
- GitHub Issue #11: Progressive Disclosure
- Research: `/research/praxrr-additional-features/report.md`
- Research: `/research/praxrr-additional-features/persona-findings/negative-space.md` (scoring confusion evidence)
