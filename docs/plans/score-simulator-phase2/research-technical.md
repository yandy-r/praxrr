# Technical Specifications: Score Simulator Phase 2

## Executive Summary

Phase 2 extends the existing single-release, single-profile Score Simulator with side-by-side
profile comparison, batch release input, example presets, and a ranking table. The existing
`POST /api/v1/simulate/score` endpoint already supports multi-release (up to 50) and multi-profile
(up to 10), so **no API changes are needed** -- all Phase 2 features are client-side composition
over the existing response shape. New components will be added alongside the existing Phase 1
components in the same route directory, with progressive disclosure via the already-registered
`SS_ADVANCED_OPTIONS` section key.

## Architecture Design

### Current Phase 1 Architecture

```
/score-simulator/[databaseId]/
  +page.server.ts          -- loads databases, qualityProfiles (pcd + trash), parserAvailable
  +page.svelte             -- orchestrates state, calls POST /api/v1/simulate/score
  helpers.ts               -- getSelectedProfileScore, resolveScoreThresholdState, sortScoreContributionsByMagnitude
  components/
    ReleaseInput.svelte    -- single title textarea, media type toggle, profile dropdown, simulate button
    SimulationResults.svelte -- parsed metadata badges, CF match table (ExpandableTable)
    ScoreBreakdown.svelte  -- total score, threshold badge, contribution list
```

**Data flow**: `+page.svelte` holds all state (`releaseTitle`, `mediaType`, `selectedProfileName`,
`simulationResult`). On input/profile change, it calls `simulate()` which POSTs to the API with a
single release + single profile, then passes the response to child components. State is persisted to
localStorage across sessions.

**API contract**: `SimulateScoreRequest` accepts `releases[]` (max 50) and `profileNames[]` (max
10). Response `SimulateScoreResponse` returns `results[]` where each `SimulateReleaseResult`
contains `profileScores[]`. The API already handles the full matrix -- Phase 1 just uses it with
arrays of length 1.

### Phase 2 Extensions

Phase 2 leverages the existing multi-release + multi-profile API contract. The page component will:

1. Send multiple releases (batch input) and optionally multiple profiles (comparison mode) in a
   single API call
2. Transform the flat `results[].profileScores[]` response into comparison views and rankings
   client-side
3. Use progressive disclosure (existing `SS_ADVANCED_OPTIONS` key) to hide batch/comparison behind
   "Advanced"

### Component Diagram

```
+page.svelte (orchestrator)
  |
  +-- Tabs (existing, database selector)
  |
  +-- DisclosureSection (sectionKey=SS_ADVANCED_OPTIONS)
  |     |
  |     +-- [basic slot] ReleaseInput (existing, single title mode)
  |     |
  |     +-- [advanced slot]
  |           +-- BatchInput.svelte (multi-title textarea)
  |           +-- PresetSelector.svelte (example title presets)
  |           +-- ProfileComparison.svelte (second profile picker + delta toggle)
  |
  +-- ScoreBreakdown (existing, shows selected profile)
  |
  +-- SimulationResults (existing, single-release detail view)
  |
  +-- RankingTable.svelte (batch results sorted by score)
  +-- ComparisonView.svelte (side-by-side profile scores)
```

### New Components

- **BatchInput.svelte**: Multi-line textarea for pasting multiple release titles (one per line).
  Includes line count indicator and validation. Replaces the single-title textarea when advanced
  mode is active.
- **PresetSelector.svelte**: Dropdown/button group with categorized example release titles (movie
  presets, series presets). Populates either the single title or batch input.
- **ProfileComparison.svelte**: Second profile dropdown for selecting a comparison profile. Displays
  delta indicators (+/-) between the two profiles' scores.
- **RankingTable.svelte**: Table showing all batch releases ranked by total score for the selected
  profile(s). Uses the existing `Table` component with sorting.
- **ComparisonView.svelte**: Side-by-side display of two profiles' scores for a selected release,
  highlighting score deltas per custom format.

### Integration Points

- **`+page.svelte` <-> `BatchInput`**: Parent manages `releaseTitles: string[]` array. BatchInput
  emits parsed titles on change. Parent sends all titles in a single API call.
- **`+page.svelte` <-> `PresetSelector`**: PresetSelector emits selected preset titles. Parent
  populates either single input or batch input depending on active mode.
- **`+page.svelte` <-> `ProfileComparison`**: Parent manages `comparisonProfileName: string | null`.
  When set, parent sends both `selectedProfileName` and `comparisonProfileName` in `profileNames[]`.
- **`+page.svelte` <-> `RankingTable`**: Parent passes full `SimulateScoreResponse.results[]` and
  selected profile name(s). RankingTable sorts and displays.
- **`+page.svelte` <-> `ComparisonView`**: Parent passes two `SimulateProfileScore` objects for the
  selected release. ComparisonView computes and displays deltas.

## Data Models

### New Types (In-Memory)

These types live in `helpers.ts` or a new `types.ts` alongside the existing helpers.

```typescript
// -- Batch Input --

interface BatchInputState {
  /** Raw textarea content, one title per line */
  rawText: string;
  /** Parsed non-empty titles */
  titles: string[];
  /** Whether batch mode is active */
  active: boolean;
}

// -- Comparison Mode --

interface ComparisonState {
  /** Second profile selector value (e.g. "pcd:ProfileName") */
  comparisonProfileName: string | null;
  /** Whether to show delta values between profiles */
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
  titles: PresetTitle[];
}

// -- Ranking --

interface RankedRelease {
  id: string;
  title: string;
  rank: number;
  totalScore: number;
  thresholdState: ScoreThresholdState | null;
  contributionCount: number;
  /** When comparison mode is active */
  comparisonScore?: number;
  scoreDelta?: number;
}

type RankingSortKey = 'rank' | 'title' | 'totalScore' | 'scoreDelta';
type RankingSortDirection = 'asc' | 'desc';
```

### Existing Types to Reuse

- **`SimulateScoreResponse`** from `$api/v1.d.ts`: Full API response, already supports
  multi-release + multi-profile
- **`SimulateProfileScore`** from `$api/v1.d.ts`: Per-profile score with contributions,
  minimumScore, upgradeUntilScore
- **`SimulateReleaseResult`** from `$api/v1.d.ts`: Per-release result with cfMatches and
  profileScores
- **`SimulateScoreContribution`** from `$api/v1.d.ts`: Individual CF score contribution
- **`ScoreThresholdState`** from `helpers.ts`: `'below' | 'accepted' | 'upgrade-reached'`
- **`SimulatorProfileOption`** from `+page.svelte`: Profile dropdown option with
  id/name/value/displayName
- **`Column<T>`** from `$ui/table/types.ts`: Table column definition for RankingTable
- **`SectionKey`** from `$shared/disclosure/sectionKeys.ts`: Already has `SS_ADVANCED_OPTIONS`

## API Design

### No API Changes Required

The existing `POST /api/v1/simulate/score` endpoint fully supports Phase 2 requirements:

- **Batch releases**: `releases[]` already accepts up to 50 items. Phase 1 sends 1; Phase 2 sends N.
- **Multi-profile**: `profileNames[]` already accepts up to 10 items. Phase 1 sends 1; Phase 2 sends
  2 for comparison.
- **Response shape**: `results[]` already returns per-release results with per-profile scores. The
  response matrix `results[N].profileScores[M]` provides all data needed for comparison and ranking.

### Client-Side Data Transformations

Add the following helper functions to `helpers.ts`:

```typescript
/** Parse batch textarea into validated title array */
function parseBatchTitles(
  rawText: string,
  mediaType: MediaType
): SimulateReleaseInput[];

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

/** Sort ranked releases by the given key */
function sortRankedReleases(
  releases: RankedRelease[],
  sortKey: RankingSortKey,
  direction: RankingSortDirection
): RankedRelease[];
```

## Component Specifications

### ProfileComparison.svelte

```
Props:
  qualityProfiles: SimulatorProfileOption[]  -- same list as ReleaseInput
  primaryProfileName: string | null          -- currently selected profile (read-only display)
  comparisonProfileName: string | null       -- bound, second profile selection
  comparisonResult: ComparisonResult | null   -- computed delta data from parent
  isSimulating: boolean

Events:
  on:comparisonChange -> { profileName: string | null }

State:
  comparisonDropdownOpen: boolean

Behavior:
  - Renders a second profile dropdown (reuses Dropdown/DropdownItem from $ui/)
  - Filters out primaryProfileName from options to prevent self-comparison
  - Displays delta summary: total score difference, count of CFs with changed scores
  - Shows per-CF delta list (sorted by absolute delta magnitude)
  - Uses Score component with colored=true for delta display
  - Uses Badge variant="info" for "better" and variant="danger" for "worse" indicators
```

### BatchInput.svelte

```
Props:
  rawText: string (bound)
  mediaType: MediaType (bound)
  maxTitles: number = 50
  disabled: boolean = false

Events:
  on:change -> { titles: string[] }

State:
  (none beyond bound props)

Behavior:
  - Large textarea (h-40) with placeholder showing one-per-line format
  - Footer showing "{N} / 50 titles" count with overflow warning
  - Trims empty lines, deduplicates titles
  - Debounces change event (same 300ms pattern as ReleaseInput)
  - Shares mediaType toggle with ReleaseInput (parent coordinates)
```

### RankingTable.svelte

```
Props:
  releases: RankedRelease[]
  selectedReleaseId: string | null (bound)
  comparisonMode: boolean
  isSimulating: boolean

Events:
  on:selectRelease -> { releaseId: string }

Behavior:
  - Uses Table component from $ui/table/Table.svelte
  - Columns: Rank (#), Title, Total Score, Threshold Status
  - When comparisonMode: adds Comparison Score, Delta columns
  - Default sort: by totalScore descending
  - Row click selects release for detail view in SimulationResults
  - Selected row gets visual highlight (accent border-left or bg tint)
  - Compact mode, responsive layout
  - Score column uses Score component, threshold uses Badge
```

### PresetSelector.svelte

```
Props:
  mediaType: MediaType
  batchMode: boolean

Events:
  on:select -> { titles: string[] }  -- single-element array in single mode, multi in batch

State:
  dropdownOpen: boolean

Behavior:
  - Button that opens a categorized dropdown
  - Movie presets: typical release naming patterns (remux, web-dl, bluray, HDR variants)
  - Series presets: season packs, single episodes, daily shows
  - Presets filtered by current mediaType
  - In batch mode: "Load All" option adds all presets for the category
  - In single mode: clicking a preset replaces the current title
  - Uses Dropdown/DropdownItem from $ui/
```

### Preset Data (constants)

Store in a new file `presets.ts` alongside `helpers.ts`:

```typescript
export const MOVIE_PRESETS: PresetTitle[] = [
  {
    label: '4K Remux',
    title: 'Movie.Title.2024.2160p.Remux.AVC.DTS-HD.MA.5.1-GROUP',
  },
  {
    label: '4K WEB-DL DV HDR',
    title: 'Movie.Title.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR10+.H.265-GROUP',
  },
  { label: '1080p Bluray', title: 'Movie.Title.2024.1080p.BluRay.x264-GROUP' },
  {
    label: '1080p WEB-DL',
    title: 'Movie.Title.2024.1080p.WEB-DL.DD5.1.H.264-GROUP',
  },
  { label: '720p HDTV', title: 'Movie.Title.2024.720p.HDTV.x264-GROUP' },
  {
    label: '4K WEB-DL HDR10',
    title: 'Movie.Title.2024.2160p.WEB-DL.DDP5.1.HDR10.H.265-GROUP',
  },
  {
    label: 'Hybrid Remux',
    title: 'Movie.Title.2024.Hybrid.2160p.Remux.DoVi.HDR.DTS-HD.MA.7.1-GROUP',
  },
];

export const SERIES_PRESETS: PresetTitle[] = [
  {
    label: 'Season Pack 1080p',
    title: 'Show.Title.S01.1080p.BluRay.x264-GROUP',
  },
  {
    label: 'Single Episode 4K',
    title: 'Show.Title.S01E01.2160p.WEB-DL.DDP5.1.H.265-GROUP',
  },
  { label: 'Daily Show', title: 'Show.Title.2024.01.15.720p.HDTV.x264-GROUP' },
  {
    label: 'Season Pack 4K DV',
    title: 'Show.Title.S02.2160p.WEB-DL.DDP5.1.DV.H.265-GROUP',
  },
  {
    label: 'Anime',
    title: 'Show.Title.S01E01.1080p.WEB-DL.AAC2.0.H.264-SubGroup',
  },
];

export const PRESET_GROUPS: PresetGroup[] = [
  { category: 'movie', label: 'Movie Examples', titles: MOVIE_PRESETS },
  { category: 'series', label: 'Series Examples', titles: SERIES_PRESETS },
];
```

## System Integration

### Files to Create

- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/BatchInput.svelte`:
  Multi-title textarea component
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/PresetSelector.svelte`:
  Example title preset dropdown
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ProfileComparison.svelte`:
  Second profile selector with delta display
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/RankingTable.svelte`:
  Sorted multi-release ranking table
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ComparisonView.svelte`:
  Side-by-side profile score comparison
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/presets.ts`: Preset title constants

### Files to Modify

- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte`: Add batch/comparison
  state management, conditional rendering of new components, update `simulate()` to send
  multi-release/multi-profile requests, add DisclosureSection wrapper for progressive disclosure
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/helpers.ts`: Add
  `parseBatchTitles()`, `buildRankingFromResults()`, `buildComparisonResult()`,
  `sortRankedReleases()` helper functions
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ReleaseInput.svelte`: Add
  preset selector integration slot or compose PresetSelector inline; possibly add batch mode toggle
  button in the footer area
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/SimulationResults.svelte`:
  Accept optional `releaseIndex` prop to display a specific release from multi-release results
  (currently hardcoded to `results[0]`)

### Files Unchanged

- `packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts`: No changes needed
- `docs/api/v1/schemas/score-simulator.yaml`: No schema changes
- `docs/api/v1/paths/score-simulator.yaml`: No endpoint changes
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.server.ts`: No changes needed
  (already loads all required data)
- `packages/praxrr-app/src/lib/shared/disclosure/sectionKeys.ts`: `SS_ADVANCED_OPTIONS` already
  registered

## Technical Decisions

### Decision 1: Progressive Disclosure Strategy

- **Options**: (A) New section keys per feature (batch, comparison, presets), (B) Single existing
  `SS_ADVANCED_OPTIONS` key for all Phase 2 features, (C) Tab-based mode switching
- **Recommendation**: B -- use the existing `SS_ADVANCED_OPTIONS` section key
- **Rationale**: Phase 2 features are logically "advanced" usage of the same simulator. The key
  already exists and is registered. Adding it incrementally avoids section key proliferation. Users
  toggle one switch to reveal batch input, presets, and comparison mode.

### Decision 2: Batch Mode vs. Inline Expansion

- **Options**: (A) Replace ReleaseInput textarea with BatchInput when advanced, (B) Show BatchInput
  as a separate section below ReleaseInput, (C) Toggle within ReleaseInput between single/batch mode
- **Recommendation**: C -- toggle within the existing ReleaseInput area
- **Rationale**: Keeps the input area cohesive. The existing textarea is already sized for pasting.
  A small toggle button (Single / Batch) in the ReleaseInput footer switches between `<textarea>`
  for one title vs. `<textarea>` for many. This avoids layout shift and keeps the form compact.

### Decision 3: Comparison View Placement

- **Options**: (A) Replace ScoreBreakdown with comparison view when second profile selected, (B)
  Show comparison below ScoreBreakdown, (C) Show comparison as a new column in the right panel
- **Recommendation**: A -- replace ScoreBreakdown conditionally
- **Rationale**: ScoreBreakdown currently shows one profile's details. In comparison mode,
  ComparisonView replaces it with a side-by-side layout showing both profiles' breakdowns plus
  deltas. This is the same screen real estate, just with richer content. The user can deselect the
  comparison profile to return to single-profile ScoreBreakdown.

### Decision 4: Ranking Table Position

- **Options**: (A) Below SimulationResults, (B) Replace SimulationResults when batch mode active,
  (C) New panel between input and results
- **Recommendation**: A -- below SimulationResults in the right column
- **Rationale**: When batch mode is active, the ranking table appears below the detail view.
  Clicking a row in the ranking table updates SimulationResults to show that release's detail. This
  keeps the detail view always available while providing the overview ranking.

### Decision 5: Batch Input Persistence

- **Options**: (A) Persist batch text to localStorage like single title, (B) Don't persist batch
  text, (C) Persist only in sessionStorage
- **Recommendation**: C -- sessionStorage only
- **Rationale**: Batch text can be large (50 titles). localStorage persistence across browser
  sessions for batch text is unlikely to be useful (unlike a single "last tested" title). Session
  storage preserves it during tab navigation within the same session, which covers the main use
  case.

### Decision 6: State Shape in +page.svelte

- **Options**: (A) Keep flat variables like Phase 1, (B) Consolidate into a single `simulatorState`
  object
- **Recommendation**: A -- keep flat reactive variables
- **Rationale**: The codebase uses Svelte 4 reactive declarations (`$:`), not Svelte 5 runes. Flat
  `let` bindings with `$:` derivations are the established pattern in this component and across the
  project. Adding an object would break the existing reactive flow without benefit.

## Edge Cases and Gotchas

- **SimulationResults hardcodes `results[0]`**: Line 49 of `SimulationResults.svelte` uses
  `result?.results?.[0]`. For batch mode, this must accept a `releaseIndex` or `releaseId` prop to
  select which release to display in detail.
- **Profile selector values are encoded strings**: Profile selectors use `pcd:` and `trash:`
  prefixes with URI-encoded names (e.g., `pcd:HD%20Bluray%20%2B%20WEB`). Comparison profile
  selection must use the same encoding scheme, and equality checks must compare encoded values.
- **Request token race condition handling**: The existing `simulationRequestToken` pattern in
  `+page.svelte` (lines 118-158) correctly handles concurrent requests. Batch mode will increase
  request latency, making this pattern more important -- no changes needed.
- **API limits**: 50 releases max, 10 profiles max. Batch input must enforce the 50-title limit
  client-side. The textarea should prevent input beyond this (or truncate with warning). Comparison
  mode uses at most 2 profiles, well within the 10-profile limit.
- **Parser unavailability**: When parser is unavailable, the API returns
  `{ parserAvailable: false, results: [] }`. Batch and comparison features must handle this
  gracefully -- show the parser warning and disable simulate, same as Phase 1.
- **Empty batch lines**: Users will paste text with blank lines, trailing newlines, and duplicate
  titles. `parseBatchTitles()` must trim, deduplicate, and filter empties.
- **localStorage key collision**: Phase 1 uses `scoreSimulator.lastTitle` for single title. Batch
  mode should use a different key (`scoreSimulator.batchText`) or sessionStorage to avoid
  overwriting the single-title state.
- **Media type applies to all batch releases**: The API requires a `type` field per release. In
  batch mode, all releases share the same `mediaType` toggle value. This is a simplification --
  mixing movie and series titles in one batch is not supported.

## Open Questions

- Should the ranking table support filtering by threshold state (e.g., show only "accepted"
  releases)?
- Should comparison mode support more than 2 profiles simultaneously, or is pairwise comparison
  sufficient for Phase 2?
- Should presets be hardcoded in `presets.ts` or loaded from the PCD database (e.g., example titles
  associated with custom formats)?
- Should the batch input support CSV/TSV paste in addition to one-per-line format?

## Relevant Existing Files Reference

- `/packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte`: Main orchestrator
  (236 lines)
- `/packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.server.ts`: Server load (75
  lines)
- `/packages/praxrr-app/src/routes/score-simulator/[databaseId]/helpers.ts`: Helper functions (45
  lines)
- `/packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ReleaseInput.svelte`:
  Input form (194 lines)
- `/packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/SimulationResults.svelte`:
  Results display (332 lines)
- `/packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ScoreBreakdown.svelte`:
  Score detail (88 lines)
- `/packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts`: API endpoint (335 lines)
- `/packages/praxrr-app/src/lib/shared/disclosure/sectionKeys.ts`: Disclosure keys
  (SS_ADVANCED_OPTIONS at line 58)
- `/packages/praxrr-app/src/lib/client/ui/table/Table.svelte`: Reusable table with sorting
- `/packages/praxrr-app/src/lib/client/ui/table/ExpandableTable.svelte`: Table with expandable rows
- `/packages/praxrr-app/src/lib/client/ui/form/DisclosureSection.svelte`: Progressive disclosure
  wrapper
- `/packages/praxrr-app/src/lib/client/ui/arr/Score.svelte`: Score display component
- `/packages/praxrr-app/src/lib/client/ui/badge/Badge.svelte`: Badge component (accent, success,
  danger, info variants)
- `/packages/praxrr-app/src/lib/client/ui/dropdown/Dropdown.svelte`: Dropdown container
- `/packages/praxrr-app/src/lib/client/ui/dropdown/DropdownItem.svelte`: Dropdown option
- `/packages/praxrr-app/src/lib/api/v1.d.ts`: Generated API types (lines 679-736 for simulator
  types)
- `/docs/api/v1/schemas/score-simulator.yaml`: OpenAPI schema definitions
- `/docs/api/v1/paths/score-simulator.yaml`: OpenAPI endpoint definition
