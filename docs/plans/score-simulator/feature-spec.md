# Feature Spec: Score Simulator

## Executive Summary

The score simulator is an interactive scoring playground where users input release titles and instantly see which custom formats match, what scores they produce, and how the total score ranks against quality profile thresholds -- all without syncing to live Arr instances. Custom format scoring is the #1 user confusion point; the simulator replaces the current trial-and-error loop (sync, wait, inspect) with real-time, read-only experimentation. Approximately 90% of the required server infrastructure already exists through the entity testing feature's evaluation pipeline (parser client, CF evaluator, scoring queries), so the primary work is a new API endpoint returning per-condition detail and a purpose-built UI with split-pane playground layout. Key challenges are parser service dependency for .NET regex fidelity and correctly replicating Arr-compatible score resolution precedence (`all` vs arr-type-specific scores).

## External Dependencies

### APIs and Services

#### Praxrr Parser Microservice (Existing)

- **Documentation**: Internal -- `packages/praxrr-parser/`
- **Authentication**: None (internal service)
- **Key Endpoints**:
  - `POST /parse`: Parse release title into structured metadata (source, resolution, languages, release group, year, edition)
  - `POST /match`: Test regex patterns against a single text (.NET regex engine)
  - `POST /match/batch`: Batch regex pattern matching across multiple texts
  - `GET /health`: Health check + parser version info
- **Rate Limits**: None (self-hosted, local network)
- **Pricing**: Free (bundled with Praxrr)
- **Client Wrapper**: `$lib/server/utils/arr/parser/client.ts` -- singleton with `parseWithCacheBatch()`, `matchPatternsBatch()`, built-in SQLite caching by parser version + pattern hash

#### Radarr/Sonarr API (Reference Only)

- **Documentation**: [Radarr API Docs](https://radarr.video/docs/api/) | [Servarr Wiki](https://wiki.servarr.com/radarr/settings)
- **Note**: The simulator does NOT call Arr APIs directly. It operates entirely against local PCD data. The Arr API is referenced only for understanding scoring algorithm semantics.
- **Scoring Algorithm Source**: [Radarr CustomFormatCalculationService.cs](https://github.com/Radarr/Radarr/blob/develop/src/NzbDrone.Core/CustomFormats/CustomFormatCalculationService.cs)

### Libraries and SDKs

| Library                      | Version | Purpose                                            | Installation |
| ---------------------------- | ------- | -------------------------------------------------- | ------------ |
| No new dependencies required | --      | All functionality built on existing infrastructure | --           |

**Optional fallback** (not recommended for v1):

- `@ctrl/video-filename-parser` -- JS release title parser for degraded mode when C# parser unavailable. Uses JS regex (not .NET), so pattern matching fidelity differs.

### External Documentation

- [TRaSH Guides - Custom Formats](https://trash-guides.info/Radarr/Radarr-collection-of-custom-formats/): Source data for PCD custom format definitions
- [TRaSH Guides - Quality Profiles](https://trash-guides.info/Radarr/radarr-setup-quality-profiles/): Scoring recommendations and threshold guidance
- [Radarr Source - CustomFormatCalculationService.cs](https://github.com/Radarr/Radarr/blob/develop/src/NzbDrone.Core/CustomFormats/CustomFormatCalculationService.cs): Authoritative scoring algorithm

## Business Requirements

### User Stories

**Primary User: Configuration Author (PCD Database Maintainer)**

- As a PCD author, I want to paste a release title and instantly see which custom formats match so that I can verify my condition logic without syncing to a live Arr instance.
- As a PCD author, I want to compare how the same release scores under two different quality profiles so that I can validate scoring trade-offs before publishing changes.
- As a PCD author, I want to see per-condition match/fail details for each custom format so that I can debug why a format unexpectedly matched or failed.

**Secondary User: Self-Hoster (End User)**

- As a self-hoster, I want to experiment with scoring configurations in a sandbox so that I understand impact before it affects my library.
- As a self-hoster, I want example release titles demonstrating common scoring scenarios so that I can learn how scoring works through guided experimentation.
- As a self-hoster, I want to see how `minimum_custom_format_score`, `upgrade_until_score`, and `upgrade_score_increment` interact for a given release so that I can tune upgrade behavior confidently.

**Tertiary User: New User (Onboarding)**

- As a new user, I want to explore scoring with pre-loaded examples so that I understand the system before configuring my own profiles.

### Business Rules

1. **Read-Only Operation**: The simulator never writes to PCD, Arr instances, or persistent state. All evaluation is ephemeral.
2. **Parser Dependency**: Release title parsing requires the C# parser microservice. If unavailable, degrade gracefully with clear "parser unavailable" state. Never return incorrect results.
3. **CF Matching Logic (Mirrors Arr Behavior)**:
   - Conditions grouped by type.
   - Between types: **AND** -- every type group must pass.
   - Within a type (required conditions): **AND** -- all required must pass.
   - Within a type (no required): **OR** -- at least one must pass.
   - `negate` flag inverts raw match result before AND/OR logic.
   - Already implemented in `evaluateCustomFormat()` in the evaluator.
4. **Score Resolution Precedence**: Specific `arr_type` score > `all` wildcard score > 0 (no mapping). Context: `movie` -> `radarr`, `series` -> `sonarr`.
5. **Non-Evaluable Conditions**: `indexer_flag` and `size` conditions cannot be evaluated from title alone. Show as "N/A" (matches existing evaluator behavior).
6. **Arr-Type Scoping**: Some condition types are Radarr-only (`quality_modifier`, `edition`) or Sonarr-only (`release_type`). The simulator must respect `arr_type` filtering.
7. **Total Score**: Sum of all matching custom format scores for the relevant arr_type in the selected quality profile.

### Edge Cases

| Scenario                       | Expected Behavior                                          | Notes                                  |
| ------------------------------ | ---------------------------------------------------------- | -------------------------------------- |
| Empty conditions CF            | Never matches                                              | Explicit check in evaluator            |
| Edition/release_group matching | Matches against _parsed_ substring, not full title         | Common user confusion point            |
| `all` score expansion          | Display effective score per arr_type regardless of storage | `all` rows expand on modification      |
| Zero-score matching CF         | Shows as matched with 0 contribution                       | Distinguish visually from non-matching |
| Parser unavailable             | Warning banner, disable evaluation                         | Match entity testing pattern           |
| No CFs in database             | Show parse results only with guidance message              |                                        |
| .NET-specific regex patterns   | Must use parser `/match` endpoint, not JS fallback         | JS regex may produce false negatives   |

### Success Criteria

- [ ] User can input a release title and see parsed attributes within 500ms (parser available)
- [ ] User can see which custom formats match with per-condition pass/fail detail
- [ ] User can select a quality profile and see total score with per-CF breakdown
- [ ] User can compare two quality profiles side-by-side for the same releases
- [ ] Parser unavailability handled gracefully with clear messaging
- [ ] Example release titles available for guided learning
- [ ] Score resolution correctly handles `all`/specific `arr_type` precedence
- [ ] No writes to PCD or Arr instances
- [ ] Feature accessible from navigation sidebar

## Technical Specifications

### Architecture Overview

```text
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

**Data Flow**:

1. User enters release titles, selects media type (movie/series), database, arr type, and profile(s).
2. Client sends `POST /api/v1/simulate/score` with titles, databaseId, profileNames, arrType.
3. Server parses titles via `parseWithCacheBatch()`.
4. Server loads all CFs with conditions via `getAllConditionsForEvaluation()`.
5. Server matches regex patterns via `matchPatternsBatch()`.
6. Server evaluates each title against all CFs via `evaluateCustomFormat()`.
7. Server fetches score mappings per profile via `scoring()`.
8. Server calculates totals per release per profile with per-CF contributions.
9. Returns structured response with parsed info, CF matches, condition details, and scores.

### Data Models

#### Simulation Models (In-Memory -- No New DB Tables)

```typescript
// --- Request Types ---
interface SimulateScoreRequest {
  databaseId: number;
  releases: SimulateReleaseInput[]; // max 50
  profileNames: string[]; // max 10
  arrType: 'radarr' | 'sonarr';
}

interface SimulateReleaseInput {
  id: string; // client-generated correlation ID
  title: string; // release title string
  type: 'movie' | 'series';
}

// --- Response Types ---
interface SimulateScoreResponse {
  parserAvailable: boolean;
  results: SimulateReleaseResult[];
}

interface SimulateReleaseResult {
  id: string;
  title: string;
  parsed: ParsedInfo | null; // reuses existing type from $shared/pcd/display.ts
  cfMatches: SimulateCfMatch[];
  profileScores: SimulateProfileScore[];
}

interface SimulateCfMatch {
  name: string;
  matches: boolean;
  conditions: SimulateConditionResult[];
}

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

interface SimulateProfileScore {
  profileName: string;
  totalScore: number;
  minimumScore: number;
  upgradeUntilScore: number;
  contributions: SimulateScoreContribution[];
}

interface SimulateScoreContribution {
  cfName: string;
  score: number;
}
```

#### PCD Entity References (Read-Only)

| Table                                | Purpose                      | Access Pattern                    |
| ------------------------------------ | ---------------------------- | --------------------------------- |
| `custom_formats` + conditions tables | CF definitions               | `getAllConditionsForEvaluation()` |
| `quality_profiles`                   | Profile thresholds           | `scoring()`                       |
| `quality_profile_custom_formats`     | CF-to-profile score mappings | `scoring()`                       |
| `parsed_release_cache`               | Parser result cache          | `parseWithCacheBatch()`           |
| `pattern_match_cache`                | Regex match cache            | `matchPatternsBatch()`            |

### API Design

#### `POST /api/v1/simulate/score`

**Purpose**: Parse release titles, evaluate custom formats, and calculate scores for selected quality profiles.
**Authentication**: Required (standard auth middleware).

**Request:**

```json
{
  "databaseId": 1,
  "releases": [
    {
      "id": "r1",
      "title": "Movie.2024.1080p.BluRay.REMUX.AVC.DTS-HD.MA.5.1-GROUP",
      "type": "movie"
    }
  ],
  "profileNames": ["HD Bluray + WEB", "Remux + WEB 1080p"],
  "arrType": "radarr"
}
```

**Response (200):**

```json
{
  "parserAvailable": true,
  "results": [
    {
      "id": "r1",
      "title": "Movie.2024.1080p.BluRay.REMUX.AVC.DTS-HD.MA.5.1-GROUP",
      "parsed": {
        "source": "Bluray",
        "resolution": "1080",
        "modifier": "Remux",
        "languages": ["English"],
        "releaseGroup": "GROUP",
        "year": 2024,
        "edition": null,
        "releaseType": null
      },
      "cfMatches": [
        {
          "name": "Remux Tier 01",
          "matches": true,
          "conditions": [
            {
              "conditionName": "REMUX",
              "conditionType": "release_title",
              "matched": true,
              "required": false,
              "negate": false,
              "passes": true,
              "expected": "\\bREMUX\\b",
              "actual": "REMUX"
            }
          ]
        }
      ],
      "profileScores": [
        {
          "profileName": "HD Bluray + WEB",
          "totalScore": 1750,
          "minimumScore": 0,
          "upgradeUntilScore": 10000,
          "contributions": [
            { "cfName": "Remux Tier 01", "score": 1700 },
            { "cfName": "DTS-HD MA", "score": 50 }
          ]
        }
      ]
    }
  ]
}
```

**Errors:**

| Status | Condition                                               | Response                               |
| ------ | ------------------------------------------------------- | -------------------------------------- |
| 400    | Missing/invalid fields, empty releases, invalid arrType | `{ "error": "..." }`                   |
| 404    | Database cache not found, profile name(s) not found     | `{ "error": "...", "missing": [...] }` |
| 500    | Internal error                                          | `{ "error": "..." }`                   |

### System Integration

#### Files to Create

**OpenAPI Contract (create first)**:

- `docs/api/v1/schemas/score-simulator.yaml`: Schema definitions
- `docs/api/v1/paths/score-simulator.yaml`: Path definition

**API Endpoint**:

- `packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts`: POST handler

**Route Pages**:

- `packages/praxrr-app/src/routes/score-simulator/+page.server.ts`: Redirect to first database
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.server.ts`: Load databases, profiles, parser health
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte`: Main simulator UI

**UI Components** (co-located with route):

- `.../[databaseId]/components/ReleaseInput.svelte`: Title input with media type selector
- `.../[databaseId]/components/SimulationResults.svelte`: Results display with expandable CF details
- `.../[databaseId]/components/ProfileComparison.svelte`: Side-by-side profile comparison
- `.../[databaseId]/components/ScoreBreakdown.svelte`: Per-release score breakdown card

#### Files to Modify

- `docs/api/v1/openapi.yaml`: Add path ref, schema refs, and `Score Simulator` tag
- `packages/praxrr-app/src/lib/api/v1.d.ts`: Regenerated via `deno task generate:api-types`
- `packages/praxrr-app/src/lib/server/navigation/registry.ts`: Register nav item
- `packages/praxrr-app/src/lib/shared/disclosure/sectionKeys.ts`: Add disclosure section keys (if using progressive disclosure)

#### Configuration

- No new environment variables
- No new database tables or migrations
- No new dependencies

## UX Considerations

### User Workflows

#### Primary Workflow: Single Release Evaluation

1. **Navigate**: User opens score simulator from navigation sidebar.
2. **Select Database**: User picks a PCD database (or sees prompt if none exist).
3. **Select Arr Type**: User chooses Radarr or Sonarr (required per Cross-Arr Semantic Validation Policy).
4. **Enter Title**: User types/pastes a release title (or picks from example presets).
5. **View Parsed Attributes**: System parses via parser service (debounced 300ms), shows source, resolution, modifier, languages, release group, year, edition.
6. **Select Profile**: User selects a quality profile from dropdown.
7. **View Results**: System shows matched/unmatched CFs with per-condition detail, per-CF scores, total score, and threshold indicators (meets minimum, meets upgrade-until).

#### Secondary Workflow: Profile Comparison

1. User enters release title(s) and selects two quality profiles.
2. System shows side-by-side comparison: same CF matches, different score contributions, total score delta.
3. User can expand any row to see per-CF detail for both profiles.

#### Error Recovery

| Error              | User Message                                                        | Recovery                              |
| ------------------ | ------------------------------------------------------------------- | ------------------------------------- |
| Parser unavailable | "Parser service unavailable. Score simulation requires the parser." | Warning banner + link to start parser |
| No databases       | Empty state with link to databases page                             |                                       |
| No CFs in database | Parse results only, "No custom formats available" message           |                                       |
| Unparseable title  | "Could not parse -- title may not follow standard naming"           | Show partial results                  |

### UI Patterns

| Component              | Pattern                                                              | Notes                                     |
| ---------------------- | -------------------------------------------------------------------- | ----------------------------------------- |
| Layout                 | Split-pane (input left, results right on desktop; stacked on mobile) | Follows Regex101/GraphQL Playground model |
| Score display          | `Score.svelte` -- green/red/gray color coding with sign prefix       | Existing component                        |
| CF breakdown           | `ExpandableTable` with expandable rows for condition detail          | Existing component                        |
| Parsed attributes      | `Badge` components for each attribute                                | Existing pattern from testing page        |
| Profile selector       | Dropdown with arr-type scoping                                       | Existing pattern                          |
| Presets                | Dropdown/button group for example release titles                     | New component                             |
| Progressive disclosure | `DisclosureSection` for advanced options (batch, comparison)         | Existing pattern                          |

### Accessibility Requirements

- Color is not sole indicator (WCAG 1.4.1): sign prefixes, icons, text labels supplement colors
- `aria-live="polite"` on results panel for screen reader announcements
- Full keyboard navigation with logical tab order
- Focus stays in input field while results update

### Performance UX

- **Debounce**: 300ms on release title input (matches existing `getPersistentSearchStore` pattern)
- **Loading States**: Spinner next to input during parsing; previous results dimmed (opacity 0.6) until new results arrive
- **Caching**: Parser results cached in SQLite -- repeated titles resolve in <1ms
- **Target**: Full simulation for 10 releases x 5 profiles in <500ms (cached), <2s (cold)
- **Persistent State**: Save last-used title and profile to localStorage

## Recommendations

### Implementation Approach

**Recommended Strategy**: Build as a new top-level route with a dedicated API endpoint (`POST /api/v1/simulate/score`) that extends the existing evaluate pipeline. Server handles parsing + CF evaluation + score calculation; client handles display, profile switching (cached scores), and comparison layout.

**Phasing:**

1. **Phase 1 - MVP (Single Release Evaluation)**: API endpoint, route with database tabs, release title input, parsed metadata display, CF match results with scores, profile selector, threshold indicators. ~3-5 days.
2. **Phase 2 - Comparison & Batch**: Side-by-side profile comparison, batch release input (multiple titles), example release presets, ranking table. ~3-4 days.
3. **Phase 3 - Polish & Integration**: "Simulate" button on quality profile scoring page, what-if scoring (temporary overrides), persistent URL state for sharing, connection to Config Impact Simulator (#30). ~4-6 days.

### Technology Decisions

| Decision                   | Recommendation                                                    | Rationale                                                                              |
| -------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Score calculation location | Server-side                                                       | Cleaner contract; avoids duplicating score logic on client; response is self-contained |
| API approach               | New `/api/v1/simulate/score` endpoint                             | Different contract needs than entity-testing; keeps features decoupled                 |
| Route structure            | Top-level `/score-simulator/[databaseId]`                         | Bridges CFs and QPs; more discoverable than nesting under either                       |
| Condition details          | Full detail for all CFs                                           | Primary value is understanding _why_ -- essential for debugging                        |
| Comparison                 | Multi-profile in single request                                   | Avoids redundant parsing/evaluation; shared parse work                                 |
| Parser dependency          | Required for full fidelity; graceful degradation when unavailable | .NET regex fidelity is critical for accuracy                                           |

### Quick Wins

- Reuse existing `evaluateCustomFormat()` pipeline directly -- already battle-tested
- Nav registration is a one-line change in `registry.ts`
- Parser cache means interactive simulator calls benefit immediately from existing cache
- Extract parsed metadata display from `ReleaseTable.svelte` expanded view

### Future Enhancements

- What-if scoring mode (temporary score overrides without saving to PCD)
- Score composition visualization (diverging stacked bar chart)
- Score thermometer/gauge for threshold visualization
- Shareable URLs encoding title + profile selection
- Integration with Config Impact Simulator (#30)
- Bulk import from connected Arr instances (reuse `ImportReleasesModal`)
- Score history/snapshots across PCD updates

## Risk Assessment

### Technical Risks

| Risk                                 | Likelihood | Impact | Mitigation                                                                            |
| ------------------------------------ | ---------- | ------ | ------------------------------------------------------------------------------------- |
| Parser service unavailable           | Medium     | High   | Degraded mode with clear warning; existing entity testing pattern handles this        |
| Scoring accuracy divergence from Arr | Medium     | High   | Use `scoring/read.ts` precedence logic exactly; verify `all` vs arr-type resolution   |
| .NET vs JS regex mismatch            | Low        | Medium | Always prefer parser `/match` endpoint; only fall back to JS regex as last resort     |
| Parser latency for interactive use   | Medium     | Medium | Existing cache + 300ms debounce; cached parse <1ms, uncached ~30-100ms                |
| Large CF count performance           | Low        | Medium | `getAllConditionsForEvaluation` already batch-loads efficiently; tested with 100+ CFs |
| Cross-Arr semantic confusion         | Medium     | Medium | Require explicit arr_type selection; enforce per Cross-Arr Semantic Validation Policy |

### Integration Challenges

- **Evaluate endpoint gap**: Current entity-testing evaluate endpoint discards per-condition detail (reduces to boolean). New endpoint must return `ConditionResult[]` per CF -- already computed by `evaluateCustomFormat()` but currently discarded.
- **Score precedence replication**: `all`/arr-type-specific score precedence logic in `scoring/read.ts` (lines 80-88) must be correctly applied in the simulator API.

### Security Considerations

- All inputs validated (title length, array size limits: 50 releases, 10 profiles)
- Regex patterns evaluated with 100ms timeout in parser (ReDoS protection)
- No user data persisted -- all results ephemeral
- Standard auth middleware applies

## Task Breakdown Preview

### Phase 1: Foundation (MVP)

**Focus**: Single release scoring with full condition detail.
**Tasks**:

- Define OpenAPI schema for simulator endpoint
- Implement `POST /api/v1/simulate/score` endpoint
- Generate TypeScript types via `deno task generate:api-types`
- Create route scaffolding (`+page.server.ts`, `+page.svelte`)
- Build release title input component with media type selector
- Build parsed metadata display
- Build CF match results table with expandable condition detail
- Build score breakdown with profile selector and threshold indicators
- Register nav item in `registry.ts`
- Add disclosure section keys

**Parallelization**: OpenAPI schema + route scaffolding can run in parallel. Nav registration is independent.

### Phase 2: Comparison & Batch

**Focus**: Multi-profile and multi-release comparison.
**Dependencies**: Phase 1 API and core UI.
**Tasks**:

- Build dual profile selector for comparison mode
- Build side-by-side comparison layout with diff highlighting
- Add multi-line title input for batch releases
- Build ranking table sorted by total score
- Create example release title presets (movie + series categories)
- Add progressive disclosure for advanced modes

**Parallelization**: Comparison and batch features are independent of each other.

### Phase 3: Integration & Polish

**Focus**: Editor integration, what-if mode, testing.
**Tasks**:

- Add "Simulate" button on quality profile scoring page
- Implement what-if scoring (temporary score overrides)
- Add URL parameter support for shareable state
- Unit tests for score computation logic
- E2E tests for simulator flow
- Integration tests for API endpoint

## Decisions Needed

1. **Route Structure**
   - Options: Top-level `/score-simulator/[databaseId]` vs nested under `/quality-profiles/score-simulator/[databaseId]`
   - Impact: Discoverability and conceptual grouping
   - Recommendation: Top-level -- the simulator bridges CFs and QPs and is more discoverable

2. **Example Presets Source**
   - Options: Hardcoded in client, from PCD `test_releases`, or new PCD entity
   - Impact: Maintainability and community contribution potential
   - Recommendation: Start with hardcoded curated examples; consider PCD integration later

3. **Lidarr Support**
   - Options: Include from day one, defer to later
   - Impact: Parser doesn't handle Lidarr content types yet
   - Recommendation: Defer -- Radarr/Sonarr only for initial implementation

4. **Batch Input Limits**
   - Options: 10, 25, or 50 release titles per request
   - Impact: Performance and UX complexity
   - Recommendation: 50 max (already specified in API design) -- sufficient for most use cases

## Research References

For detailed findings, see:

- [research-external.md](./research-external.md): Parser service integration, Arr scoring algorithm, ecosystem tools
- [research-business.md](./research-business.md): Domain model, workflows, existing codebase integration points
- [research-technical.md](./research-technical.md): Architecture, data models, API design, OpenAPI schemas
- [research-ux.md](./research-ux.md): Playground patterns, competitive analysis, accessibility, responsive design
- [research-recommendations.md](./research-recommendations.md): Phasing strategy, risks, alternative approaches, task breakdown
