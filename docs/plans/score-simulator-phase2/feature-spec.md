# Feature Spec: Score Simulator Phase 2

## Executive Summary

Phase 2 extends the existing single-release, single-profile Score Simulator MVP with side-by-side
profile comparison, batch release input (up to 50 titles), curated example presets, a ranked results
table, and progressive disclosure for advanced modes. The existing `POST /api/v1/simulate/score`
endpoint already supports multi-release (50 max) and multi-profile (10 max) arrays, so **no API or
schema changes are needed** -- Phase 2 is entirely client-side UI work over the existing response
shape. The primary engineering effort is 6 new Svelte components, helper function extensions, and
progressive disclosure wiring. Key challenges are parser latency for large batches (1.5-5s cold for
50 titles), mobile layout for comparison views, and debounce strategy for batch mode.

## External Dependencies

### APIs and Services

#### Existing Simulate/Score API (No Changes)

- **Endpoint**: `POST /api/v1/simulate/score`
- **Contract**: `{ databaseId, releases[] (max 50), profileNames[] (max 10), arrType }` ->
  `{ parserAvailable, results[].profileScores[] }`
- **Phase 2 Usage**:
  - **Comparison**: Send 2 profile names in `profileNames[]`
  - **Batch**: Send N releases in `releases[]`
  - **Ranking**: Client sorts `results[]` by `profileScores[n].totalScore`
- **Profile Selector Format**: Supports `pcd:Name`, `trash:sourceId:Name`, and legacy plain names

### Libraries and SDKs

| Library             | Version | Purpose                              | Installation |
| ------------------- | ------- | ------------------------------------ | ------------ |
| No new dependencies | --      | All features use existing components | --           |

### External Documentation

- [TRaSH Guides - Custom Formats](https://trash-guides.info/Radarr/Radarr-collection-of-custom-formats/):
  Source data for preset release title naming conventions
- [TRaSH Guides - Quality Profiles](https://trash-guides.info/Radarr/radarr-setup-quality-profiles/):
  Scoring recommendations referenced in presets

## Business Requirements

### User Stories

**Primary User: Configuration Author (PCD Database Maintainer)**

- As a PCD author, I want to compare how the same set of releases scores under two different quality
  profiles so that I can validate scoring trade-offs before publishing changes.
- As a PCD author, I want to paste 10-20 real release titles at once and see them ranked by total
  score so that I can verify my profile correctly prioritizes the intended quality tiers.
- As a PCD author, I want to see the score delta between profiles for each release so that I can
  identify exactly which custom formats cause ranking differences.

**Secondary User: Self-Hoster (End User)**

- As a self-hoster, I want to compare my current profile against a TRaSH Guide recommended profile
  for the same releases so that I can decide whether to switch.
- As a self-hoster, I want to batch-test releases from my recent grab history so that I can verify
  my scoring configuration matches my expectations.
- As a self-hoster, I want to understand why a particular release was preferred over another by
  seeing them ranked with score breakdowns.

**Tertiary User: New User (Onboarding)**

- As a new user, I want to load example release titles for movies or series so that I can see
  scoring in action without needing to know release naming conventions.
- As a new user, I want progressive disclosure that starts with a simple view and reveals advanced
  comparison features as I explore, so that I am not overwhelmed on first visit.

### Business Rules

1. **Profile Comparison**
   - Users select exactly two profiles from the same database for comparison.
   - Both profiles can be PCD, TRaSH, or one of each (API supports `pcd:` and `trash:` selectors).
   - CF matching is shared: same release produces same CF matches regardless of profile. Only score
     contributions differ.
   - Comparison displays: profile name, total score, per-CF contributions, and delta (Profile B -
     Profile A).
   - Score precedence unchanged: specific `arr_type` > `all` wildcard > 0. This means two profiles
     can assign the same CF different effective scores depending on `all` vs arr-type-specific rows.
   - Both profiles must use the same `arrType`. Cross-arr comparison is not meaningful.

2. **Batch Input**
   - Maximum 50 releases per request (already enforced in API at `+server.ts` line 106).
   - Input format: one release title per line in a textarea.
   - Client strips empty lines, trims whitespace, deduplicates, and assigns correlation IDs.
   - All releases in a batch share the same `mediaType` and `arrType`.
   - Batch mode uses explicit "Simulate All" button (not debounced auto-simulate) to manage parser
     load.
   - Reject titles > 500 characters.

3. **Example Presets**
   - Two top-level categories: **Movie** (arrType: radarr) and **Series** (arrType: sonarr).
   - Each preset is a group of 3-8 titles demonstrating a scoring scenario.
   - Presets are hardcoded in the client (static `presets.ts` module). No PCD entity needed.
   - Each preset group includes a one-line description explaining the scenario.
   - Loading a preset populates the batch input and auto-sets media type.

4. **Ranking Table**
   - Primary sort: total score descending (highest = rank 1 = "most preferred").
   - Tie-breaking: matched CF count descending, then alphabetical by title.
   - Columns: Rank, Release Title (truncated with tooltip), Total Score, Matched CFs, Threshold
     Status.
   - Each row expandable for per-CF score breakdown.
   - In comparison mode: two score columns + delta column, per-profile independent ranking.

5. **Progressive Disclosure**
   - **Basic mode** (default): Phase 1 experience -- single release input, single profile, results.
   - **Advanced mode**: Batch input, second profile selector, presets, ranking table. Uses existing
     `DisclosureSection` with `SS_ADVANCED_OPTIONS` key (already registered at `sectionKeys.ts` line
     58).
   - Preference persists via `userInterfacePreferences` store.
   - Switching advanced -> basic: keep first title and first profile, preserve data in memory
     (lossless round-tripping on re-expand).

### Edge Cases

| Scenario                           | Expected Behavior                                                  | Notes                               |
| ---------------------------------- | ------------------------------------------------------------------ | ----------------------------------- |
| Parser unavailable in batch        | `parserAvailable: false`, empty results, single warning banner     | Match Phase 1 pattern               |
| Mixed PCD + TRaSH in comparison    | Fully supported via `ResolvedPcdProfile`/`ResolvedTrashProfile`    | Already handled by API              |
| Profile with no CF scores          | `totalScore: 0` for all releases; ranking shows all tied at 0      | Do not hide results                 |
| All titles unparseable             | All results `parsed: null`, all CFs `matches: false`, ranking at 0 | Banner explaining parse failure     |
| Preset titles with zero matches    | Expected behavior for "edge case" presets                          | Not an error                        |
| Zero-score matched CFs             | Counts toward "Matched CFs" count, contributes 0 to total          | Visually distinct from non-matching |
| Comparison with identical profiles | Both columns show identical values                                 | Allow for verification              |
| Duplicate titles in batch          | Warn but allow; duplicates flagged in ranking                      | Deduplicate by default              |
| Parser batch latency (50 cold)     | 1.5-5s; `parseWithCacheBatch()` fires parallel requests            | Show progress indicator             |

### Success Criteria

- [ ] User can select two profiles and see side-by-side score comparison for the same release(s)
- [ ] User can paste up to 50 release titles and see them ranked by total score
- [ ] User can load curated example presets organized by movie and series categories
- [ ] Ranking table sorts by total score descending with tie-breaking
- [ ] In comparison mode, ranking table shows per-profile ranks and highlights rank differences
- [ ] Progressive disclosure hides batch/comparison by default, reveals on toggle
- [ ] Disclosure preference persists across sessions
- [ ] Batch mode requires explicit action (button or Ctrl+Enter), not auto-simulate per keystroke
- [ ] All Phase 1 single-release functionality continues to work in basic mode
- [ ] No new API endpoints or schema changes needed
- [ ] Performance: 50 releases x 2 profiles completes in <5s cold, <1s cached

## Technical Specifications

### Architecture Overview

```text
+page.svelte (orchestrator)
  |
  +-- Tabs (existing, database selector)
  |
  +-- DisclosureSection (sectionKey=SS_ADVANCED_OPTIONS)
  |     |
  |     +-- [basic slot] ReleaseInput (existing, single title)
  |     |
  |     +-- [advanced slot]
  |           +-- BatchInput.svelte (multi-title textarea)
  |           +-- PresetSelector.svelte (example presets dropdown)
  |           +-- ProfileComparison.svelte (second profile picker)
  |
  +-- ScoreBreakdown (existing, single profile)
  |   OR ComparisonView.svelte (side-by-side, when comparison active)
  |
  +-- SimulationResults (existing, single-release detail)
  |   OR RankingTable.svelte (batch mode, sorted by score)
```

**Data flow**: `+page.svelte` holds all state. On simulate, sends batch releases + selected profile
names to existing API. Response's `results[].profileScores[]` matrix is transformed client-side for
comparison deltas and ranking.

### Data Models

#### New Types (In-Memory, in `helpers.ts`)

```typescript
// -- Batch --
interface BatchInputState {
  rawText: string;
  titles: string[];
  active: boolean;
}

// -- Comparison --
interface ComparisonState {
  comparisonProfileName: string | null;
  showDeltas: boolean;
}

interface ProfileScoreDelta {
  cfName: string;
  scoreA: number;
  scoreB: number;
  delta: number;
}

interface ComparisonResult {
  profileAName: string;
  profileBName: string;
  profileATotal: number;
  profileBTotal: number;
  totalDelta: number;
  contributions: ProfileScoreDelta[];
}

// -- Presets --
type PresetCategory = 'movie' | 'series';

interface PresetTitle {
  label: string;
  title: string;
}

interface PresetGroup {
  category: PresetCategory;
  label: string;
  description: string;
  titles: PresetTitle[];
}

// -- Ranking --
interface RankedRelease {
  id: string;
  title: string;
  rank: number;
  totalScore: number;
  thresholdState: ScoreThresholdState | null;
  matchedCfCount: number;
  totalCfCount: number;
  parsed: ParsedInfo | null;
  comparisonScore?: number;
  comparisonRank?: number;
  scoreDelta?: number;
}
```

#### Existing Types to Reuse

- `SimulateScoreResponse`, `SimulateReleaseResult`, `SimulateProfileScore`,
  `SimulateScoreContribution` from `$api/v1.d.ts`
- `ScoreThresholdState` from `helpers.ts`
- `SimulatorProfileOption` from `+page.svelte`
- `Column<T>` from `$ui/table/types.ts`

### API Design

**No API changes required.** The existing endpoint supports all Phase 2 use cases:

- Batch: `releases[]` accepts up to 50 items
- Comparison: `profileNames[]` accepts up to 10 items
- Response: `results[N].profileScores[M]` provides full matrix

#### Client-Side Data Transformations (add to `helpers.ts`)

```typescript
/** Parse batch textarea into validated title array */
function parseBatchTitles(rawText: string, mediaType: MediaType): SimulateReleaseInput[];

/** Build ranked release list from multi-release response */
function buildRankingFromResults(
  results: SimulateReleaseResult[],
  profileName: string
): RankedRelease[];

/** Compute per-CF delta between two profiles for a single release */
function buildComparisonResult(
  releaseResult: SimulateReleaseResult,
  profileAName: string,
  profileBName: string
): ComparisonResult | null;
```

### System Integration

#### Files to Create

- `.../[databaseId]/components/BatchInput.svelte`: Multi-title textarea with line counter,
  validation, and 50-item limit
- `.../[databaseId]/components/PresetSelector.svelte`: Categorized dropdown for example release
  titles
- `.../[databaseId]/components/ProfileComparison.svelte`: Second profile dropdown with delta summary
- `.../[databaseId]/components/RankingTable.svelte`: Sorted multi-release ranking using
  Table/ExpandableTable
- `.../[databaseId]/components/ComparisonView.svelte`: Side-by-side profile score comparison with
  delta highlighting
- `.../[databaseId]/presets.ts`: Hardcoded example release title constants

#### Files to Modify

- `.../[databaseId]/+page.svelte`: Batch/comparison state management, multi-release/multi-profile
  API calls, DisclosureSection wrapper, mode-conditional rendering
- `.../[databaseId]/helpers.ts`: Add `parseBatchTitles()`, `buildRankingFromResults()`,
  `buildComparisonResult()` helpers
- `.../[databaseId]/components/ReleaseInput.svelte`: Preset selector integration, batch mode toggle
- `.../[databaseId]/components/SimulationResults.svelte`: Accept `releaseIndex`/`releaseId` prop
  instead of hardcoded `results[0]`

#### Files Unchanged

- `packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts` (no API changes)
- `docs/api/v1/schemas/score-simulator.yaml` (no schema changes)
- `docs/api/v1/paths/score-simulator.yaml` (no endpoint changes)
- `.../[databaseId]/+page.server.ts` (already loads all required data)
- `$shared/disclosure/sectionKeys.ts` (`SS_ADVANCED_OPTIONS` already registered)

#### Configuration

- No new environment variables
- No new database tables or migrations
- No new dependencies

## UX Considerations

### User Workflows

#### Profile Comparison Workflow

1. **Enter release title**: User enters a release title (Phase 1 flow unchanged).
2. **Enable comparison**: User expands Advanced Options disclosure section. Second profile dropdown
   appears.
3. **Select second profile**: User picks Profile B. System sends `profileNames: [A, B]` in one API
   call.
4. **View side-by-side**: ScoreBreakdown replaced by ComparisonView showing both profiles' totals,
   per-CF contributions, and deltas. Rows where scores differ highlighted with subtle accent.
5. **Interpret delta**: Summary shows "Profile B: +350" with threshold crossing indicators.
6. **Exit comparison**: Deselect second profile to return to single-profile view.

#### Batch Evaluation Workflow

1. **Expand advanced mode**: User opens Advanced Options disclosure.
2. **Enter titles**: Paste/type titles one per line in BatchInput textarea. Counter shows "12 / 50
   titles".
3. **Simulate**: Click "Simulate All" (explicit submit, not debounced).
4. **View ranking**: Results appear in RankingTable sorted by total score descending.
5. **Drill into detail**: Click any row to show full CF match + score breakdown in
   SimulationResults.
6. **Re-sort**: Click column headers to sort by title, score, or match count.

#### Preset Learning Workflow

1. **Discover presets**: "Try Examples" button near input opens categorized dropdown.
2. **Browse categories**: Movie / Series categories with subcategories by quality tier.
3. **Load preset**: Select a preset; titles populate batch input, media type auto-set.
4. **Explore**: Select a profile and click Simulate. Ranking table shows how the profile ranks the
   presets.

### UI Patterns

| Component              | Pattern                                                       | Notes                                      |
| ---------------------- | ------------------------------------------------------------- | ------------------------------------------ |
| Comparison layout      | Dual-column with aligned CF rows                              | `grid-cols-2` on desktop; tabbed on mobile |
| Delta highlighting     | Subtle left-border accent + background tint on differing rows | `border-l-2 border-accent-500`             |
| Delta display          | `Score.svelte` with sign prefix (green/red)                   | Existing component                         |
| Ranking table          | `ExpandableTable` with sortable columns                       | Expandable rows for per-release detail     |
| Batch input            | Multi-line textarea with line counter                         | One title per line, max 50                 |
| Presets                | `Dropdown` + `DropdownItem` with category headers             | Filtered by active media type              |
| Progressive disclosure | `DisclosureSection` with `SS_ADVANCED_OPTIONS`                | Persisted toggle state                     |
| Threshold badges       | `Badge` (success/warning/danger variants)                     | Below minimum / accepted / upgrade reached |

### Accessibility Requirements

- Color not sole indicator: sign prefixes, icons, text labels supplement colors (WCAG 1.4.1)
- `aria-live="polite"` on results panel for screen reader announcements
- Full keyboard navigation with logical tab order
- Column sort state communicated via `aria-sort` attribute
- Expandable rows use `aria-expanded`

### Performance UX

- **Batch mode**: Explicit "Simulate All" submit (not debounced per-keystroke)
- **Progress indicator**: "Simulating 5 of 12 releases..." with determinate progress
- **Skeleton rows**: Pulsing placeholder rows in ranking table while results pending
- **Parser caching**: Cached titles resolve <1ms; batch re-simulation near-instant after first run
- **Progressive rendering**: Render first 10-20 rows immediately; remaining via
  `requestAnimationFrame`
- **Request cancellation**: Extend `simulationRequestToken` with `AbortController` for batch

## Recommendations

### Implementation Approach

**Recommended Strategy**: Extend the existing `/score-simulator/[databaseId]/+page.svelte` with
mode-conditional rendering (single/batch/comparison). All modes share the same page, API call, and
result display. Progressive disclosure via `DisclosureSection` reveals advanced features.

**Phasing:**

1. **Batch 1 - Foundation**: Mode state management, batch input component, helper functions for
   parsing/ranking/comparison, `SimulationResults` multi-release support
2. **Batch 2 - Core Features**: ProfileComparison + ComparisonView, RankingTable. These are
   independent and can be developed in parallel.
3. **Batch 3 - Polish**: PresetSelector + presets.ts, progressive disclosure wiring, mobile
   responsive optimization

### Technology Decisions

| Decision          | Recommendation                  | Rationale                                                          |
| ----------------- | ------------------------------- | ------------------------------------------------------------------ |
| API changes       | None                            | Existing contract supports batch + multi-profile                   |
| Mode switching    | DisclosureSection toggle        | Matches existing pattern; `SS_ADVANCED_OPTIONS` already registered |
| Batch input       | Textarea with newline delimiter | Simpler than structured input; natural paste target                |
| Comparison limit  | Exactly 2 profiles              | Simpler delta visualization; covers primary use case               |
| Ranking           | Client-side sort                | API returns all scores; `Array.sort()` is trivial                  |
| Presets           | Static client-side constants    | Zero server overhead; version-controlled with app                  |
| State shape       | Flat reactive variables         | Matches Phase 1 `$:` pattern; no runes                             |
| Batch persistence | sessionStorage only             | Batch text too large for localStorage cross-session                |

### Quick Wins

- Batch input with zero API changes: send multiple titles in existing `releases[]` array
- Multi-profile scoring with zero API changes: send 2 profile names in `profileNames[]`
- Ranking is a `sort()` on `profileScores[].totalScore` from existing response
- `resolveScoreThresholdState()` already computes threshold states; apply to both profiles for delta

### Future Enhancements

- Score delta with threshold-crossing indicators (below minimum -> accepted transition)
- Export comparison as JSON/CSV for sharing
- Keyboard shortcuts: `Ctrl+Enter` to simulate, `Ctrl+1/2` to switch profiles
- Score heatmap for batch x multiple profiles
- Connection to Phase 3 what-if scoring via `scoreOverrides` prop
- PCD-derived presets from community contributions

## Risk Assessment

### Technical Risks

| Risk                                 | Likelihood | Impact | Mitigation                                                                       |
| ------------------------------------ | ---------- | ------ | -------------------------------------------------------------------------------- |
| Parser batch latency (50 uncached)   | Medium     | High   | `parseWithCacheBatch` parallelizes; chunk to groups of 10-15; cached titles <1ms |
| Rendering 50 releases x 10 profiles  | Medium     | High   | Progressive loading via `pageSize` on Table; defer condition expansion to click  |
| Mobile comparison layout             | High       | Medium | Stacked layout with profile toggle on mobile; reuse existing `isMobile` pattern  |
| Debounce interaction with batch      | Medium     | Medium | Explicit "Simulate All" button for batch mode; no auto-simulate per keystroke    |
| Request token with rapid batch edits | Medium     | Medium | Extend `simulationRequestToken` with `AbortController`                           |
| State management complexity          | Medium     | Medium | Keep flat reactive variables; co-locate in `+page.svelte`                        |

### Integration Challenges

- `SimulationResults.svelte` line 49 hardcodes `result?.results?.[0]` -- must accept release index
  prop
- Phase 1 localStorage keys (`releaseTitle`, `selectedProfileName`) are scalars; Phase 2 extends
  without breaking backward compatibility
- ExpandableTable not designed for multi-column comparison; extend `tableColumns` dynamically based
  on mode

### Security Considerations

- All inputs validated (title length, array size limits: 50 releases, 10 profiles)
- Regex patterns evaluated with 100ms timeout in parser (ReDoS protection)
- No user data persisted -- all results ephemeral
- Standard auth middleware applies

## Task Breakdown Preview

### Batch 1: Foundation

**Focus**: Mode infrastructure, batch input, helper functions. **Tasks**:

- Add batch/comparison state to `+page.svelte` (mode toggle, multi-release/multi-profile API calls)
- Create `BatchInput.svelte` (multi-line textarea, line counter, validation)
- Extend `helpers.ts` with `parseBatchTitles()`, `buildRankingFromResults()`,
  `buildComparisonResult()`
- Modify `SimulationResults.svelte` to accept `releaseId` prop instead of hardcoded `results[0]`
- Create `presets.ts` with hardcoded example titles

**Parallelization**: BatchInput component and helper functions can be developed independently.

### Batch 2: Core Features

**Focus**: Comparison view and ranking table. **Tasks**:

- Create `ProfileComparison.svelte` (second profile dropdown, delta summary)
- Create `ComparisonView.svelte` (side-by-side scores, delta highlighting, aligned CF rows)
- Create `RankingTable.svelte` (sorted table with expandable detail rows, threshold badges)
- Wire ranking table row selection to SimulationResults detail view

**Parallelization**: ProfileComparison/ComparisonView and RankingTable are fully independent.

### Batch 3: Polish

**Focus**: Presets, progressive disclosure, mobile optimization. **Tasks**:

- Create `PresetSelector.svelte` (categorized dropdown, auto-populate batch input)
- Wire `DisclosureSection` for advanced mode toggle
- Integrate PresetSelector into ReleaseInput area
- Mobile responsive: stacked comparison with profile toggle, responsive ranking cards
- Persist mode/profile preferences to localStorage/sessionStorage

**Parallelization**: Presets, disclosure wiring, and mobile optimization are independent.

## Decisions Needed

1. **Comparison Scope**
   - Options: 2 profiles only, up to 3
   - Impact: Layout complexity; 3 requires different comparison visualization
   - Recommendation: 2 profiles. Design data flow for N, implement for 2.

2. **Batch + Comparison Intersection**
   - Options: Allow simultaneous batch + comparison, keep as separate modes
   - Impact: 50 releases x 2 profiles = complex UI (dual-rank columns per row)
   - Recommendation: Allow both simultaneously -- ranking table gains two score columns with delta.

3. **Preset Visibility**
   - Options: Visible in basic mode (more discoverable), advanced mode only
   - Impact: Basic mode UI complexity vs onboarding discoverability
   - Recommendation: Show a compact "Try Examples" button in basic mode; full dropdown in advanced.

4. **Debounce Strategy**
   - Options: Auto-simulate with 500-800ms debounce, explicit button only, hybrid (<5 auto, >5
     button)
   - Impact: Interactivity vs parser load
   - Recommendation: Explicit "Simulate All" button for batch. Single-release keeps existing 300ms
     debounce.

5. **Advanced-to-Basic Round-Trip**
   - Options: Lossless (preserve data in memory, just hide), destructive (truncate with
     confirmation)
   - Impact: UX complexity vs data preservation
   - Recommendation: Lossless -- keep all batch titles in memory, hide on collapse, restore on
     re-expand.

6. **Preset Loading Behavior**
   - Options: Replace current input, append to current input
   - Impact: UX simplicity vs flexibility
   - Recommendation: Replace by default. "Load All in Category" for batch mode.

## Research References

For detailed findings, see:

- [research-external.md](./research-external.md): API contract analysis, UI component inventory,
  integration patterns
- [research-business.md](./research-business.md): User stories, business rules, workflows, codebase
  integration
- [research-technical.md](./research-technical.md): Architecture, data models, component specs, file
  paths
- [research-ux.md](./research-ux.md): Comparison patterns, batch UX, presets, progressive
  disclosure, competitive analysis
- [research-recommendations.md](./research-recommendations.md): Phasing strategy, risks, alternative
  approaches
