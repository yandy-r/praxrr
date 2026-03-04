# Business Logic Research: Score Simulator

## Executive Summary

Custom format scoring is the single hardest concept for Arr users to understand. Today users must sync configurations to live instances, wait for a grab, and inspect results to learn how scoring works -- a slow, destructive trial-and-error loop. The score simulator provides an interactive, read-only playground where users input release titles, see which custom formats match, inspect per-condition evaluation details, view aggregate scores under any quality profile, and compare how two different scoring configurations would rank the same set of releases.

## User Stories

### Primary User: Configuration Author (PCD Database Maintainer)

- As a PCD author, I want to paste a release title and instantly see which custom formats match so that I can verify my condition logic without syncing to a live Arr instance.
- As a PCD author, I want to compare how the same release set scores under two different quality profiles so that I can validate scoring trade-offs before publishing changes.
- As a PCD author, I want to see per-condition match/fail details for each custom format so that I can debug why a format unexpectedly matched or failed.

### Secondary User: Self-Hoster (End User)

- As a self-hoster, I want to experiment with different scoring configurations in a sandbox so that I understand the impact of score changes before they affect my library.
- As a self-hoster, I want example release titles that demonstrate common scoring scenarios so that I can learn how custom format scoring works through guided experimentation.
- As a self-hoster, I want to see how minimum_custom_format_score, upgrade_until_score, and upgrade_score_increment interact for a given release so that I can tune upgrade behavior confidently.

### Tertiary User: New User (Onboarding)

- As a new user, I want to explore scoring with pre-loaded examples so that I understand the system before configuring my own profiles.

## Business Rules

### Core Rules

1. **Read-Only Operation**: The simulator never writes to the PCD database, Arr instances, or any persistent state. All evaluation is ephemeral and computed on demand.

2. **Parser Dependency**: Release title parsing requires the C# parser microservice. If the parser is unavailable, the simulator must degrade gracefully -- showing a clear "parser unavailable" state rather than returning incorrect results. Existing pattern: `isParserHealthy()` check with fallback UI state (see entity testing page).

3. **CF Matching Logic (Mirrors Arr Behavior)**:
   - Conditions are grouped by type (release_title, resolution, source, etc.).
   - Between types: **AND** -- every condition type group must pass.
   - Within a type with required conditions: **AND** -- all required conditions must pass.
   - Within a type with no required conditions: **OR** -- at least one condition must pass.
   - Negate flag inverts the raw match result before applying AND/OR logic.
   - This logic is already implemented in `evaluateCustomFormat()` in the evaluator.

4. **Score Resolution Precedence**: When a custom format has scores in `quality_profile_custom_formats`:
   - A specific `arr_type` score (e.g., `radarr`) takes precedence over the `all` wildcard score.
   - If only an `all` score exists, it applies to all arr types.
   - If no score row exists, the effective score is 0.
   - The `arr_type` context for simulation is determined by the media type: `movie` -> `radarr`, `series` -> `sonarr`.

5. **Total Score Computation**: For a given release against a quality profile:
   - Parse the release title via the parser service.
   - Evaluate all custom formats against the parsed result.
   - For each matching custom format, look up its score in the profile for the relevant arr_type.
   - Sum all matching scores to produce the total custom format score.
   - Compare against profile thresholds: `minimum_custom_format_score`, `upgrade_until_score`.

6. **Condition Types Requiring External Data**:
   - `indexer_flag` and `size` conditions cannot be evaluated from title alone (they require indexer metadata and file size). The simulator should allow optional user input for these fields, or mark them as "N/A (no indexer/file data)" as the evaluator already does.

7. **Arr-Type Scoping**: Conditions and scores are arr-type aware. Some condition types are Radarr-only (`quality_modifier`, `edition`) or Sonarr-only (`release_type`). The simulator must respect `arr_type` filtering when displaying available conditions and computing scores.

### Validation Requirements

1. **Release title**: Required, non-empty string.
2. **Media type**: Must be `movie` or `series` (determines parser behavior and arr_type context).
3. **Database selection**: Required to evaluate custom formats (optional for parse-only mode).
4. **Quality profile selection**: Required for score computation (optional for CF-match-only mode).

### Edge Cases

- **Empty condition custom formats**: A custom format with zero conditions never matches (explicit check in evaluate endpoint).
- **Parser-incompatible regex patterns**: Some .NET regex patterns are not valid in JavaScript. The evaluator falls back to JS regex when parser pattern matching is unavailable, but results may differ. The simulator should prefer the parser `/match` endpoint for authoritative results.
- **Edition and release_group conditions**: These match against the PARSED edition/group string (not the full title), which is a common point of user confusion.
- **All-score expansion**: When a user has only an `all` score and modifies per-arr-type scores, the system expands the `all` row into per-arr-type rows and deletes the `all` row. The simulator should display the effective score per arr_type regardless of storage format.
- **Zero-score custom formats**: Custom formats that match but have a score of 0 still "match" conceptually but contribute nothing to the total. The entity testing UI currently filters these out of the display (`score !== null && score !== 0`); the simulator should show them but visually distinguish them.
- **Multiple databases**: Users may have multiple PCD databases with different custom format definitions. The simulator must scope all evaluation to a single selected database.

## Workflows

### Primary Workflow: Single Release Evaluation

1. User navigates to the score simulator page.
2. User selects a PCD database (or sees a prompt if no databases exist).
3. User enters a release title (or selects from example titles).
4. User selects the media type (movie/series).
5. System parses the release title via the parser microservice.
6. System displays parsed attributes (source, resolution, modifier, languages, release group, edition, year).
7. System evaluates all custom formats from the selected database against the parsed result.
8. System displays matching and non-matching custom formats with per-condition detail.
9. User selects a quality profile.
10. System looks up scores for matching custom formats and displays per-CF scores and total score.
11. System displays threshold indicators: whether the release meets minimum_custom_format_score, whether it reaches upgrade_until_score.

### Secondary Workflow: Side-by-Side Comparison

1. User enters one or more release titles (batch input).
2. User selects two quality profiles (Profile A and Profile B) from the same database.
3. System evaluates all releases against all custom formats (shared evaluation, different scoring).
4. System displays a comparison table: release title, total score under Profile A, total score under Profile B, delta.
5. User can expand any row to see per-CF score breakdown for both profiles.
6. System highlights releases where the ranking order differs between profiles.

### Tertiary Workflow: Example-Driven Learning

1. User clicks "Load Examples" or similar affordance.
2. System populates the input with curated release titles from `test_releases` / `custom_format_tests` tables in the PCD database.
3. User steps through examples, seeing how different titles produce different matches and scores.
4. System provides inline explanations of key scoring concepts (progressive disclosure).

### Error Recovery

- **Parser unavailable**: Show a clear banner with guidance ("Start the parser service with `deno task dev:parser`"). Disable evaluation but allow title input. Match the existing pattern from entity testing.
- **No databases linked**: Show an empty state with a link to the databases page.
- **No custom formats in database**: Show parse results only, with a message that no CFs are available for evaluation.
- **Invalid regex in condition**: The parser `/match` endpoint already handles this with timeouts and error catching. The evaluator skips invalid patterns gracefully.

## Domain Model

### Key Entities

- **Custom Format**: A named set of conditions that together define a "format" (e.g., "Remux", "HDR10+", "x265"). Stored in `custom_formats` table with conditions spread across `custom_format_conditions` and type-specific child tables (`condition_patterns`, `condition_resolutions`, etc.).

- **Condition**: A single test within a custom format. Has a `type` (release_title, resolution, source, language, etc.), `negate` flag, `required` flag, and type-specific data (regex patterns, resolution values, source values, etc.). Assembled into `ConditionData` for evaluation.

- **Regular Expression**: Named regex patterns stored in `regular_expressions`, referenced by conditions via `condition_patterns`. Used for release_title, edition, and release_group condition types.

- **Quality Profile**: A named configuration that defines: quality hierarchy (priority order), upgrade behavior (allowed, cutoff quality, score thresholds), and custom format scores. Stored in `quality_profiles` with scores in `quality_profile_custom_formats`.

- **Custom Format Score**: The numeric weight assigned to a custom format within a quality profile. Stored per `(quality_profile_name, custom_format_name, arr_type)` triple. Can be positive (desired), negative (penalty), or zero (neutral). The `arr_type` can be a specific app or `all`.

- **Profile Score Thresholds**:
  - `minimum_custom_format_score`: Releases below this total score are rejected.
  - `upgrade_until_score`: The target score; upgrades stop once this is reached.
  - `upgrade_score_increment`: Minimum score improvement required for an upgrade.

- **ParseResult**: The output of the C# parser for a release title. Contains: source, resolution, modifier, revision, languages, release group, year, edition, episode info (for series). This is the input to condition evaluation.

- **EvaluationResult**: The output of evaluating a custom format's conditions against a ParseResult. Contains overall `matches` boolean and per-condition `ConditionResult` details (matched, passes, expected, actual).

- **Test Entity / Test Release**: Existing PCD entities (`test_entities`, `test_releases`) that store curated test cases with titles, metadata, and optional size/language/indexer/flag data. These can serve as example data for the simulator.

### Relationships

```
Quality Profile 1---* Custom Format Score *---1 Custom Format
Custom Format 1---* Condition
Condition *---* Regular Expression (via condition_patterns)
Quality Profile 1---* Quality (via quality_profile_qualities)
ParseResult --evaluated-against--> Condition[] --> EvaluationResult
EvaluationResult + Score Lookup --> Total Score
```

### State Transitions (Simulator Session)

- **Empty** -> **Title Entered**: User types or selects a release title.
- **Title Entered** -> **Parsed**: System parses via parser service.
- **Parsed** -> **CF Evaluated**: System evaluates all CFs (requires database selection).
- **CF Evaluated** -> **Scored**: System computes total score (requires profile selection).
- **Scored** -> **Compared**: User adds a second profile for side-by-side comparison.

## Existing Codebase Integration

### Related Features

- `/packages/praxrr-app/src/routes/quality-profiles/entity-testing/`: The closest existing feature. It evaluates release titles against custom formats and computes scores per quality profile. The simulator builds on the same evaluation pipeline but with a different UX focus (ad-hoc exploration vs. persistent test entity management).

- `/packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/testing/`: Per-CF test runner. Evaluates curated test titles against a single custom format's conditions. Shows pass/fail/unknown status with per-condition details.

- `/packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts`: The API endpoint that powers entity testing evaluation. Handles batch parsing, CF evaluation, and pattern matching. This is the primary reuse target for the simulator's backend.

### Patterns to Follow

- **Database Tab Pattern**: Multi-database features use a `[databaseId]` route segment with a tab bar for database switching. See `/quality-profiles/[databaseId]/` and `/custom-formats/[databaseId]/`.

- **Parser Health Check Pattern**: All parser-dependent features check `isParserHealthy()` at load time and pass `parserAvailable` to the client. The UI shows a degraded state when the parser is down.

- **Evaluate API Pattern**: The `/api/v1/entity-testing/evaluate` endpoint demonstrates the full evaluation pipeline: batch parse via `parseWithCacheBatch()`, extract patterns via `extractAllPatterns()`, batch match via `matchPatternsBatch()`, then `evaluateCustomFormat()` per CF. The simulator should reuse this pipeline (or a similar new endpoint).

- **Score Calculation Pattern (Client-Side)**: Entity testing computes total scores client-side by summing matching CF scores from the `cfScoresData` structure. This avoids round-trips for profile switching. The simulator should follow this approach.

- **Navigation Registry**: New top-level features are registered in `/packages/praxrr-app/src/lib/server/navigation/registry.ts` with group, order, icon, and arr scope. The simulator likely belongs in the `policies` group as a sibling of Quality Profiles, or potentially as a child of Quality Profiles.

- **Contract-First API**: Per CLAUDE.md conventions, new API work should define OpenAPI spec first, generate types, then implement. The evaluate endpoint schema in `v1.d.ts` provides a template.

### Components to Leverage

- **`Score` component** (`$ui/arr/Score.svelte`): Renders a numeric score with color coding (green positive, red negative, gray zero/null).

- **`CustomFormatBadge` component** (`$ui/arr/CustomFormatBadge.svelte`): Renders a CF name + score badge for matched formats.

- **`ExpandableTable` component** (`$ui/table/ExpandableTable.svelte`): Table with expandable rows for detail views. Used in entity testing for per-release CF breakdowns.

- **`Badge` component** (`$ui/badge/Badge.svelte`): General-purpose label badge for metadata display.

- **`alertStore`** (`$lib/client/alerts/store`): Global alert system for user feedback.

- **Parser Client** (`$lib/server/utils/arr/parser/client.ts`): Singleton client with `parse()`, `parseWithCache()`, `matchPatterns()`, `matchPatternsBatch()`. Handles caching automatically.

- **Evaluator** (`$pcd/entities/customFormats/evaluator.ts`): `evaluateCustomFormat()`, `getParsedInfo()`, `extractAllPatterns()` -- the core evaluation engine.

- **Scoring Queries** (`$pcd/entities/qualityProfiles/scoring/read.ts`): `scoring()` for per-profile scores, `allCfScores()` for all profiles' scores (used by entity testing for client-side score computation).

- **Condition Reader** (`$pcd/entities/customFormats/conditions/read.ts`): `getConditionsForEvaluation()` and `getAllConditionsForEvaluation()` for loading CF conditions with all related data.

### Data Models (No Extension Needed for MVP)

The simulator can operate entirely on existing data models:

- `custom_formats` + conditions tables (via PCD cache)
- `quality_profiles` + `quality_profile_custom_formats` (via PCD cache)
- `test_entities` + `test_releases` (for example data)
- `custom_format_tests` (for per-CF test examples)
- Parser cache tables (`parsed_release_cache`, `pattern_match_cache`)

No new database tables or migrations are needed. The simulator is purely a read-only view with ephemeral client-side state.

## Relevant Files

- `/packages/praxrr-app/src/lib/server/pcd/entities/customFormats/evaluator.ts`: Core CF evaluation engine with all condition matching logic
- `/packages/praxrr-app/src/lib/server/pcd/entities/customFormats/conditions/read.ts`: Loads conditions with all related data for evaluation
- `/packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/scoring/read.ts`: Score queries (per-profile and all-profiles)
- `/packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`: Parser client with caching for parse and pattern match operations
- `/packages/praxrr-app/src/lib/server/utils/arr/parser/types.ts`: TypeScript enums matching C# parser types (QualitySource, Resolution, Language, etc.)
- `/packages/praxrr-app/src/lib/shared/pcd/types.ts`: PCD database schema types (all table interfaces)
- `/packages/praxrr-app/src/lib/shared/pcd/display.ts`: Display types including ConditionData, EvaluationResult, QualityProfileScoring, CustomFormatScoresByArrType
- `/packages/praxrr-app/src/lib/shared/pcd/conditions.ts`: Condition type definitions, valid values for source/resolution/modifier/etc.
- `/packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts`: Existing evaluate endpoint (primary reuse target for backend pipeline)
- `/packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/+page.server.ts`: Entity testing page load (pattern for data loading)
- `/packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/components/ReleaseTable.svelte`: Entity testing release table with score display (UI pattern reference)
- `/packages/praxrr-app/src/lib/client/ui/arr/Score.svelte`: Score display component
- `/packages/praxrr-app/src/lib/client/ui/arr/CustomFormatBadge.svelte`: CF badge with score component
- `/packages/praxrr-app/src/lib/server/navigation/registry.ts`: Navigation registration for new features
- `/packages/praxrr-app/src/lib/server/sync/qualityProfiles/transformer.ts`: How scores are resolved for sync (precedence logic)
- `/packages/praxrr-parser/Endpoints/ParseEndpoints.cs`: Parser /parse endpoint (movie/series title parsing)
- `/packages/praxrr-parser/Endpoints/MatchEndpoints.cs`: Parser /match and /match/batch endpoints (regex matching)
- `/packages/praxrr-parser/Models/Responses.cs`: Parser response types
- `/docs/api/v1/openapi.yaml`: OpenAPI spec (contract-first API definition)

## Success Criteria

- [ ] User can input a release title and see parsed attributes within 500ms (parser available)
- [ ] User can see which custom formats match a release with per-condition pass/fail detail
- [ ] User can select a quality profile and see the total score with per-CF score breakdown
- [ ] User can compare two quality profiles side-by-side for the same set of releases
- [ ] Parser unavailability is handled gracefully with clear user messaging
- [ ] Example release titles are available for guided learning
- [ ] All evaluation uses the parser /match endpoint for .NET regex accuracy (not JS fallback)
- [ ] Score resolution correctly handles all/specific arr_type precedence
- [ ] No writes to PCD database or Arr instances
- [ ] Feature is accessible from the navigation sidebar

## Open Questions

1. **Routing**: Should the simulator be a standalone top-level route (e.g., `/score-simulator`) or a child of Quality Profiles (e.g., `/quality-profiles/simulator`)? The entity testing feature is a child of Quality Profiles. The simulator is more cross-cutting (CF + QP + parser), which may argue for top-level.

2. **Batch Input UX**: Should users paste multiple release titles at once (textarea, one per line), or input them one at a time? Batch input is more powerful but increases UI complexity.

3. **Example Sources**: Should examples come from `test_releases` (entity testing data), `custom_format_tests` (per-CF test cases), hardcoded curated examples, or a combination? The PCD database already has test data that could be leveraged.

4. **Comparison Scope**: Should side-by-side comparison be limited to two profiles, or should users be able to compare N profiles? Two is simpler and covers the primary use case.

5. **Lidarr Support**: The simulator needs to handle arr_type scoping. Lidarr is a first-class arr type but has different semantics. Should the simulator support Lidarr from day one, or defer it? Lidarr does not have a parser integration path yet (parser handles movie/series only).

6. **Indexer Flags / Size Inputs**: Should the simulator allow users to optionally specify indexer flags and file size for more complete condition evaluation, or keep it simple with title-only input? The evaluator already returns "N/A" for these conditions when data is missing.

7. **Persistence**: Should simulator sessions (input titles, selected profiles) persist across page reloads via URL params, localStorage, or neither? Entity testing uses persistent PCD entities; the simulator is ephemeral by design.

8. **Progressive Disclosure Integration**: Issue #11 mentions progressive disclosure. Should the simulator use the progressive disclosure system to gradually reveal advanced features (comparison mode, condition details)?
