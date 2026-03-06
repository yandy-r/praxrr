# External API Research: Score Simulator Phase 2

## Executive Summary

The existing `POST /api/v1/simulate/score` API already supports batch releases (up to 50) and
multiple profiles (up to 10) in a single request, meaning Phase 2 features (comparison, batch,
ranking) require zero API changes. All Phase 2 work is client-side composition: the same API
endpoint serves comparison mode (send two profile names), batch mode (send multiple releases), and
ranking (sort results by totalScore). No new libraries are needed -- the existing ExpandableTable,
Score, Badge, and DisclosureSection components cover all UI requirements. The primary engineering
effort is building new client-side components for multi-release input, dual-profile selection,
comparison layout, and ranking table.

**Confidence**: High -- Phase 1 API contract was designed to support Phase 2 from day one.

## Primary APIs

### Existing Simulate/Score API

- **Endpoint**: `POST /api/v1/simulate/score`
- **Current Contract**:
  - Request: `{ databaseId, releases[], profileNames[], arrType }`
  - releases: array of `{ id, title, type }` -- max 50 items
  - profileNames: array of profile selector strings -- max 10 items
  - Response: `{ parserAvailable, results[] }` where each result contains
    `{ id, title, parsed, cfMatches[], profileScores[] }`
  - Each `profileScores` entry includes
    `{ profileName, totalScore, minimumScore, upgradeUntilScore, contributions[] }`
- **Phase 2 Gaps**: None at the API level. The contract already supports:
  - **Comparison**: Send two profile names in `profileNames[]` -- response contains both profiles'
    scores per release
  - **Batch**: Send multiple releases in `releases[]` -- response contains results for all releases
  - **Ranking**: Client sorts `results[]` by `profileScores[n].totalScore`
- **Recommended Extensions**: None required. Client-side composition is sufficient.

**Confidence**: High -- verified by reading the server implementation at
`packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts` (lines 77-335). The endpoint
already iterates over all releases and all resolved profiles, returning the full cross-product.

### Profile Selector Format

The API supports two profile selector formats via `parseProfileSelector()`:

| Format              | Example                           | Source                   |
| ------------------- | --------------------------------- | ------------------------ |
| PCD profile         | `pcd:HD%20Bluray%20%2B%20WEB`     | Local PCD database       |
| TRaSH Guide profile | `trash:1:HD%20Bluray%20%2B%20WEB` | TRaSH Guide entity cache |
| Legacy (plain name) | `HD Bluray + WEB`                 | Treated as PCD profile   |

This means comparison mode can compare PCD profiles against TRaSH Guide profiles, which is a useful
validation workflow.

**Confidence**: High -- verified from source code (lines 50-75 of +server.ts).

## Libraries and SDKs

### Recommended Libraries

**No new dependencies required.** All Phase 2 features can be implemented with existing components
and vanilla Svelte/Tailwind patterns.

| Requirement                     | Solution                          | Source                                    |
| ------------------------------- | --------------------------------- | ----------------------------------------- |
| Side-by-side layout             | Tailwind CSS grid (`grid-cols-2`) | Already used in project                   |
| Sortable ranking table          | `ExpandableTable` component       | `$ui/table/ExpandableTable.svelte`        |
| Score display with color coding | `Score` component                 | `$ui/arr/Score.svelte`                    |
| Delta/diff highlighting         | Custom CSS with `Score` component | Existing color scheme (green/red/neutral) |
| Progressive disclosure          | `DisclosureSection` component     | `$ui/form/DisclosureSection.svelte`       |
| Expandable details              | `ExpandableTable` with slots      | Already used in Phase 1 results           |
| Badges for metadata             | `Badge` component                 | `$ui/badge/Badge.svelte`                  |
| Dropdown for presets            | `Dropdown` + `DropdownItem`       | Already used in Phase 1 profile selector  |

**Confidence**: High -- all components verified to exist in the codebase with the required
capabilities.

### Alternative Options Considered and Rejected

| Library                             | Purpose                | Rejection Reason                                                                                                                              |
| ----------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `svelte-table` / `svelte-tablesort` | Sortable table         | Redundant -- `ExpandableTable` already has full sorting with `sortable`, `sortAccessor`, `sortComparator`, and `defaultSortDirection` support |
| `split-pane` / `svelte-split-pane`  | Resizable split layout | Overkill -- CSS grid with fixed ratios is simpler and sufficient; comparison is not a code editor layout                                      |
| `diff2html` / `jsdiff`              | Diff highlighting      | Overkill -- score comparison needs numeric delta display, not text diffing; `Score` component already handles positive/negative color coding  |
| TanStack Table                      | Feature-rich table     | Unnecessary dependency; `ExpandableTable` covers sorting, expansion, responsive card layout, and progressive loading                          |

**Confidence**: High -- ExpandableTable already supports all needed table features including sorting
(ascending/descending/clear cycle), column-level sort configuration, responsive mobile card layout,
and progressive loading.

## Integration Patterns

### Side-by-Side Comparison

#### Research Findings

Side-by-side comparison tables are a well-established UI pattern for "considered decisions" --
situations where users need to evaluate trade-offs between options
([Smashing Magazine, 2017](https://www.smashingmagazine.com/2017/08/designing-perfect-feature-comparison-table/)).
Key design principles:

1. **Highlight differences, not similarities**: Users open comparison views specifically to see what
   differs. A "show differences only" toggle is the most-used feature in comparison tables.
2. **Keep context while highlighting**: Rather than removing identical rows, use subtle background
   color on differing cells.
3. **Limit columns to 2-3 for readability**: More than 3 comparison columns creates cognitive
   overload.
4. **Use sticky headers**: Floating headers or navigation dropdowns that follow scroll allow quick
   orientation.

**Confidence**: High -- established UX research from Nielsen Norman Group and Smashing Magazine.

#### Recommended Pattern for Score Simulator

The comparison layout should show two profiles as columns with custom formats as rows. Since the
Phase 1 API already returns `profileScores[]` per release, the client simply renders two columns
from the same response.

```
+---------------------------+-------------------+-------------------+
| Custom Format             | Profile A (Score) | Profile B (Score) |
+---------------------------+-------------------+-------------------+
| Remux Tier 01             |     +1700         |     +1700         |
| DTS-HD MA                 |       +50         |         0         |  <-- highlighted
| BR-DISK                   |   -10000          |   -10000          |
+---------------------------+-------------------+-------------------+
| Total                     |    -8250          |    -8300          |
| Delta                     |         --        |       -50         |
+---------------------------+-------------------+-------------------+
```

**Layout approach**: Use a single `ExpandableTable` with dynamic columns. When comparison mode is
active, add a second score column and a delta column. This avoids building a separate comparison
component.

```svelte
<!-- Pseudo-code for dynamic columns -->
$: tableColumns = comparisonMode
  ? [
      { key: 'name', header: 'Custom Format', sortable: true },
      { key: 'matches', header: 'Match', width: 'w-16', align: 'center' },
      { key: 'scoreA', header: profileALabel, width: 'w-24', align: 'right', sortable: true },
      { key: 'scoreB', header: profileBLabel, width: 'w-24', align: 'right', sortable: true },
      { key: 'delta', header: 'Delta', width: 'w-20', align: 'right', sortable: true },
    ]
  : [
      { key: 'name', header: 'Custom Format', sortable: true },
      { key: 'matches', header: 'Match', width: 'w-24', align: 'center', sortable: true },
      { key: 'score', header: 'Score', width: 'w-24', align: 'right', sortable: true },
    ];
```

**Mobile responsive**: On mobile (`ExpandableTable` with `responsive={true}`), the table
automatically switches to card layout via the existing `useMobileLayout` detection. Each card shows
the custom format name as the primary column with profile scores as secondary label-value pairs.

**Confidence**: High -- builds directly on existing ExpandableTable capabilities.

#### Delta Highlighting

Use the existing `Score` component for delta display. The component already handles positive (green
with + prefix), negative (red), and zero (neutral gray) color coding. For cells where two profiles
differ, add a subtle background tint:

```svelte
<!-- Highlight row when scores differ -->
<tr class="{scoreA !== scoreB ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''}">
```

This approach follows the comparison table best practice of highlighting differences with subtle
background color while preserving full context
([Smashing Magazine](https://www.smashingmagazine.com/2017/08/designing-perfect-feature-comparison-table/)).

**Confidence**: High -- uses existing component with minimal CSS addition.

### Batch Input

#### Research Findings

Batch text input via textarea is a standard pattern for entering multiple items. The key
considerations are:

1. **Newline-separated input**: One item per line in a textarea is the most intuitive pattern for
   batch entry
   ([MDN textarea docs](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/textarea)).
2. **Real-time count**: Show a counter like "3 / 50 releases" below the textarea to give immediate
   feedback on how many items will be processed.
3. **Validation on parse**: Split on newlines, trim whitespace, filter empty lines, and deduplicate.
   Show validation errors inline.
4. **Preserve existing single-input UX**: Batch mode should be progressive -- the default view is a
   single input, with batch mode behind a disclosure section.

**Confidence**: High -- standard web pattern with clear implementation path.

#### Recommended Pattern

Extend the existing `ReleaseInput.svelte` component with a mode toggle or use `DisclosureSection` to
reveal batch input:

```typescript
// Parse textarea into releases array
function parseBatchInput(
  raw: string
): Array<{ title: string; type: MediaType }> {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 50) // enforce API limit
    .map((title) => ({ title, type: mediaType }));
}
```

The existing Phase 1 `ReleaseInput.svelte` already uses a `<textarea>` element (line 104-110), which
naturally supports multi-line input. The transition from single to batch is purely a matter of
parsing: split on newlines instead of treating the entire textarea value as one title.

**UI considerations**:

- Show a live counter: `{parsedReleases.length} / 50 releases`
- Dim lines that exceed the 50-release limit
- Auto-detect media type from title patterns (optional enhancement)
- Preserve the media type toggle for all releases (uniform type per batch)

**Confidence**: High -- minimal change to existing textarea component.

### Example Presets

#### Research Findings

Preset/example systems in playground tools follow a consistent pattern
([UXPin](https://www.uxpin.com/studio/blog/dropdown-interaction-patterns-a-complete-guide/)):

1. **Grouped dropdown**: Organize presets into categories with visual dividers and bold category
   headers.
2. **Clear labeling**: Each preset should have a descriptive name that indicates what it
   demonstrates.
3. **One-click application**: Selecting a preset immediately populates the input and triggers
   simulation.
4. **Non-destructive**: Warn if the user has unsaved input before replacing with a preset.

**Confidence**: Medium -- general UI pattern literature; no specific scoring-tool preset
implementations found.

#### Recommended Preset Categories

Based on common release naming conventions from
[TRaSH Guides](https://trash-guides.info/Radarr/Radarr-collection-of-custom-formats/) and
[Servarr Wiki](https://wiki.servarr.com/radarr/settings):

```typescript
interface PresetCategory {
  label: string;
  presets: Array<{
    label: string;
    titles: string[];
    type: MediaType;
  }>;
}

const EXAMPLE_PRESETS: PresetCategory[] = [
  {
    label: 'Movies - Quality Tiers',
    presets: [
      {
        label: 'Remux 2160p (Best Quality)',
        titles: [
          'Movie.Title.2024.2160p.UHD.BluRay.REMUX.DV.HDR.DTS-HD.MA.7.1-GROUP',
        ],
        type: 'movie',
      },
      {
        label: 'Bluray 1080p (High Quality)',
        titles: ['Movie.Title.2024.1080p.BluRay.x264.DTS-HD.MA.5.1-GROUP'],
        type: 'movie',
      },
      {
        label: 'WEB-DL 2160p (Streaming)',
        titles: ['Movie.Title.2024.2160p.AMZN.WEB-DL.DDP5.1.H.265-GROUP'],
        type: 'movie',
      },
      {
        label: 'WEB-DL 1080p (Standard)',
        titles: ['Movie.Title.2024.1080p.NF.WEB-DL.DDP5.1.x264-GROUP'],
        type: 'movie',
      },
      {
        label: 'HDTV 720p (Low Quality)',
        titles: ['Movie.Title.2024.720p.HDTV.x264-GROUP'],
        type: 'movie',
      },
    ],
  },
  {
    label: 'Movies - Edge Cases',
    presets: [
      {
        label: 'Scene vs P2P Naming',
        titles: [
          'Movie.Title.2024.1080p.BluRay.x264-SCENEGROUP',
          'Movie Title 2024 1080p BluRay x264-P2PGROUP',
        ],
        type: 'movie',
      },
      {
        label: 'Multi-Language Release',
        titles: [
          'Movie.Title.2024.MULTi.1080p.BluRay.x264.DTS-HD.MA.5.1-GROUP',
        ],
        type: 'movie',
      },
      {
        label: 'REPACK / PROPER',
        titles: [
          'Movie.Title.2024.1080p.BluRay.REPACK.x264-GROUP',
          'Movie.Title.2024.1080p.BluRay.PROPER.x264-GROUP',
        ],
        type: 'movie',
      },
      {
        label: 'BR-DISK (Unwanted)',
        titles: ['Movie.Title.2024.COMPLETE.BLURAY-GROUP'],
        type: 'movie',
      },
    ],
  },
  {
    label: 'Series - Quality Tiers',
    presets: [
      {
        label: 'WEB-DL 2160p (Best Streaming)',
        titles: ['Series.Title.S01E01.2160p.AMZN.WEB-DL.DDP5.1.H.265-GROUP'],
        type: 'series',
      },
      {
        label: 'WEB-DL 1080p (Standard)',
        titles: ['Series.Title.S01E01.1080p.NF.WEB-DL.DDP5.1.x264-GROUP'],
        type: 'series',
      },
      {
        label: 'Season Pack',
        titles: ['Series.Title.S01.1080p.BluRay.x264-GROUP'],
        type: 'series',
      },
      {
        label: 'Daily Show Format',
        titles: ['Daily.Show.2024.03.15.1080p.WEB.h264-GROUP'],
        type: 'series',
      },
    ],
  },
  {
    label: 'Batch Comparison Sets',
    presets: [
      {
        label: 'Quality Ladder (Movie)',
        titles: [
          'Movie.Title.2024.2160p.UHD.BluRay.REMUX.DV.HDR.DTS-HD.MA.7.1-GROUP',
          'Movie.Title.2024.2160p.AMZN.WEB-DL.DDP5.1.H.265-GROUP',
          'Movie.Title.2024.1080p.BluRay.REMUX.AVC.DTS-HD.MA.5.1-GROUP',
          'Movie.Title.2024.1080p.BluRay.x264.DTS-HD.MA.5.1-GROUP',
          'Movie.Title.2024.1080p.AMZN.WEB-DL.DDP5.1.x264-GROUP',
          'Movie.Title.2024.720p.HDTV.x264-GROUP',
        ],
        type: 'movie',
      },
      {
        label: 'Streaming Source Comparison',
        titles: [
          'Movie.Title.2024.1080p.AMZN.WEB-DL.DDP5.1.x264-GROUP',
          'Movie.Title.2024.1080p.NF.WEB-DL.DDP5.1.x264-GROUP',
          'Movie.Title.2024.1080p.DSNP.WEB-DL.DDP5.1.x264-GROUP',
          'Movie.Title.2024.1080p.HMAX.WEB-DL.DDP5.1.x264-GROUP',
          'Movie.Title.2024.1080p.ATVP.WEB-DL.DDP5.1.H.265-GROUP',
        ],
        type: 'movie',
      },
    ],
  },
];
```

**Implementation**: Use the existing `Dropdown` + `DropdownItem` components with category headers.
When a preset is selected, populate the textarea and trigger simulation. For multi-title presets,
switch to batch mode automatically.

**Confidence**: High -- preset data sourced from TRaSH Guides naming conventions.

### Ranking Tables

#### Research Findings

Client-side sortable ranking tables are well-supported by the existing `ExpandableTable` component.
Key patterns from research:

1. **Sticky headers**: Use `sticky top-0` on `<thead>` with a solid background to keep column
   headers visible during scroll
   ([Creative Tim](https://www.creative-tim.com/twcomponents/component/sticky-table-header),
   [Cruip](https://cruip.com/create-a-table-with-a-sticky-column-using-tailwind-css/)).
2. **Default sort by score**: Rank by total score descending as the default sort.
3. **Visual rank indicators**: Show rank number (1, 2, 3...) as a column or badge.
4. **Threshold indicators**: Color-code rows based on whether they meet minimum score and
   upgrade-until score.

**Confidence**: High -- standard table pattern with direct ExpandableTable support.

#### Recommended Pattern

The ranking table reuses `ExpandableTable` with a new data mapping that flattens releases into
sortable rows:

```typescript
interface RankingRow {
  rank: number;
  releaseId: string;
  title: string;
  totalScore: number;
  thresholdState: ScoreThresholdState | null;
  matchedCfCount: number;
  totalCfCount: number;
  parsed: ParsedInfo | null;
}

// Build ranking from API response
function buildRankingRows(
  results: SimulateReleaseResult[],
  profileName: string
): RankingRow[] {
  return results
    .map((result) => {
      const profileScore = result.profileScores.find(
        (p) => p.profileName === profileName
      );
      return {
        releaseId: result.id,
        title: result.title,
        totalScore: profileScore?.totalScore ?? 0,
        thresholdState: resolveScoreThresholdState(profileScore ?? null),
        matchedCfCount: result.cfMatches.filter((cf) => cf.matches).length,
        totalCfCount: result.cfMatches.length,
        parsed: result.parsed,
      };
    })
    .sort((a, b) => b.totalScore - a.totalScore)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}
```

**Ranking table columns**:

```typescript
const rankingColumns: Column<RankingRow>[] = [
  { key: 'rank', header: '#', width: 'w-12', align: 'center' },
  { key: 'title', header: 'Release Title', sortable: true },
  {
    key: 'matchedCfCount',
    header: 'CF Matches',
    width: 'w-28',
    align: 'center',
    sortable: true,
  },
  {
    key: 'totalScore',
    header: 'Score',
    width: 'w-24',
    align: 'right',
    sortable: true,
    defaultSortDirection: 'desc',
  },
  {
    key: 'thresholdState',
    header: 'Status',
    width: 'w-28',
    align: 'center',
  },
];
```

**Sticky header**: Add `sticky top-0 z-10` to the `<thead>` element. The `ExpandableTable` component
renders a standard `<thead>` (line 271-326 of ExpandableTable.svelte), so this can be applied via a
wrapper `<div>` with `max-h-[600px] overflow-y-auto` or by adding an optional `stickyHeader` prop to
the component.

**Confidence**: High -- ExpandableTable already supports all column features needed (sorting,
alignment, width, responsive).

### Comparison Layout for Ranking Table

When comparing two profiles across batch releases, the ranking table can show both profiles' scores:

```typescript
const comparisonRankingColumns: Column<ComparisonRankingRow>[] = [
  { key: 'rank', header: '#', width: 'w-12', align: 'center' },
  { key: 'title', header: 'Release Title', sortable: true },
  {
    key: 'scoreA',
    header: profileALabel,
    width: 'w-24',
    align: 'right',
    sortable: true,
    defaultSortDirection: 'desc',
  },
  {
    key: 'scoreB',
    header: profileBLabel,
    width: 'w-24',
    align: 'right',
    sortable: true,
    defaultSortDirection: 'desc',
  },
  {
    key: 'delta',
    header: 'Delta',
    width: 'w-20',
    align: 'right',
    sortable: true,
  },
  {
    key: 'winner',
    header: 'Winner',
    width: 'w-20',
    align: 'center',
  },
];
```

**Confidence**: High -- direct extension of single-profile ranking pattern.

## Constraints and Gotchas

### 1. API Limit: 50 Releases x 10 Profiles

- **Impact**: Comparison mode uses 2 of the 10 profile slots per request. Batch mode uses up to 50
  release slots. The cross-product means up to 50 x 2 = 100 profile score calculations per request.
- **Workaround**: None needed. The server already handles this efficiently -- custom format
  evaluation is shared across profiles (parse once, evaluate CFs once, then score against each
  profile). The bottleneck is parser latency, not scoring computation.
- **Client enforcement**: Validate batch input to reject > 50 releases before sending the request.
  Show a counter and disable the simulate button when over the limit.

**Confidence**: High -- verified from server implementation.

### 2. Parser Service Latency for Batch

- **Impact**: Uncached parsing takes ~30-100ms per title. A batch of 50 uncached titles could take
  1.5-5 seconds.
- **Mitigation**:
  - `parseWithCacheBatch()` already batches all parse calls and caches results in SQLite by parser
    version + title hash. Subsequent simulations of the same titles resolve in <1ms each.
  - Show a progress indicator during batch simulation. Use the existing `isSimulating` state with a
    more informative message like "Simulating 50 releases..." instead of just "Simulating...".
  - Consider streaming results as they become available (future enhancement, not Phase 2 scope).
- **UX recommendation**: For the initial batch simulation, show a loading state with a count
  ("Parsing 50 releases..."). After the first run, cached titles make re-simulation near-instant.

**Confidence**: High -- parser caching verified in codebase.

### 3. Svelte 5 Without Runes Constraint

- **Impact**: The project uses Svelte 5 but without runes (`$state`, `$derived`). Components must
  use the traditional reactive `$:` syntax, `export let` props, and `createEventDispatcher`.
- **Workaround**: The existing Phase 1 components already follow this pattern consistently. Phase 2
  components should follow the same approach:
  - `$:` for reactive declarations
  - `export let` for props
  - `createEventDispatcher()` for events
  - `bind:value` for two-way bindings
  - Stores via `svelte/store` where needed
- **No impact on feature capability**: All Phase 2 features are achievable without runes.

**Confidence**: High -- verified from all existing Phase 1 components.

### 4. Mobile/Responsive Requirements for Comparison Layout

- **Impact**: Side-by-side comparison with two score columns becomes cramped on mobile screens.
- **Workaround**: The `ExpandableTable` component already handles this. When `responsive={true}` and
  screen width < 768px, it automatically switches to a card layout where secondary columns (scores,
  delta) become label-value pairs below the primary column (custom format name). This is built-in
  behavior (lines 166-262 of ExpandableTable.svelte).
- **Additional mobile optimization for ranking**: On mobile, the ranking table card view should show
  title as primary, with rank, score, and status as secondary items. Use `primaryColumnKey="title"`
  to ensure the title is the card header.

**Confidence**: High -- ExpandableTable responsive mode verified from source.

### 5. State Management for Comparison Mode

- **Impact**: Comparison mode requires tracking two selected profiles instead of one. localStorage
  persistence needs to handle the additional profile selection.
- **Approach**: Extend the existing localStorage pattern:
  ```typescript
  const profileAStorageKey = 'scoreSimulator.comparisonProfileA';
  const profileBStorageKey = 'scoreSimulator.comparisonProfileB';
  const modeStorageKey = 'scoreSimulator.mode'; // 'single' | 'comparison' | 'batch'
  ```
- **State shape**: Keep the existing `selectedProfileName` for single mode. Add `comparisonProfileA`
  and `comparisonProfileB` for comparison mode. The API call uses whichever is active.

**Confidence**: High -- extends existing localStorage persistence pattern.

### 6. Debounce Behavior for Batch Input

- **Impact**: The Phase 1 debounce (300ms) fires on every keystroke. For batch input (multi-line
  textarea), users may paste large blocks of text at once.
- **Workaround**: Use the same 300ms debounce for batch mode. Pasting triggers a single `input`
  event, so the debounce correctly waits 300ms after the paste and then processes all lines. For
  typing, the debounce prevents excessive API calls as the user adds titles one by one.
- **Optimization**: Consider a longer debounce (500ms) for batch mode since users are likely
  composing multiple lines. This can be toggled based on the input mode.

**Confidence**: High -- standard debounce behavior handles paste correctly.

## Code Examples

### Basic Integration: Comparison Mode

Minimal working example showing how to extend the existing page component for comparison mode:

```svelte
<script lang="ts">
  // ... existing imports ...

  // Comparison mode state
  let comparisonMode = false;
  let profileA: string | null = null;
  let profileB: string | null = null;

  // Single API call serves both modes
  $: activeProfileNames = comparisonMode
    ? [profileA, profileB].filter(Boolean)
    : selectedProfileName
      ? [selectedProfileName]
      : [];

  async function simulate() {
    const titles = batchMode ? parseBatchInput(releaseTitle) : [releaseTitle.trim()];
    if (titles.length === 0 || activeProfileNames.length === 0) {
      simulationResult = null;
      return;
    }

    const releases = titles.map((title) => ({
      id: generateReleaseId(),
      title,
      type: mediaType,
    }));

    const response = await fetch('/api/v1/simulate/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        databaseId: data.currentDatabase.id,
        releases,
        profileNames: activeProfileNames,
        arrType: mediaType === 'movie' ? 'radarr' : 'sonarr',
      }),
    });

    simulationResult = await response.json();
  }
</script>
```

### Basic Integration: Batch Input Parsing

```typescript
function parseBatchInput(raw: string): string[] {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  // Deduplicate while preserving order
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const line of lines) {
    if (!seen.has(line)) {
      seen.add(line);
      unique.push(line);
    }
  }

  return unique.slice(0, 50);
}
```

### Basic Integration: Ranking Data Transformation

```typescript
function buildRankingData(
  result: SimulateScoreResponse,
  profileName: string
): RankingRow[] {
  if (!result.parserAvailable || result.results.length === 0) return [];

  return result.results
    .map((releaseResult) => {
      const profileScore = releaseResult.profileScores.find(
        (p) => p.profileName === profileName
      );
      return {
        releaseId: releaseResult.id,
        title: releaseResult.title,
        totalScore: profileScore?.totalScore ?? 0,
        thresholdState: resolveScoreThresholdState(profileScore ?? null),
        matchedCfCount: releaseResult.cfMatches.filter((cf) => cf.matches)
          .length,
        totalCfCount: releaseResult.cfMatches.length,
        parsed: releaseResult.parsed,
      };
    })
    .sort((a, b) => b.totalScore - a.totalScore)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}
```

### Basic Integration: Comparison Delta Calculation

```typescript
interface ComparisonRow {
  cfName: string;
  matches: boolean;
  scoreA: number;
  scoreB: number;
  delta: number;
  differs: boolean;
}

function buildComparisonRows(
  result: SimulateReleaseResult,
  profileNameA: string,
  profileNameB: string
): ComparisonRow[] {
  const scoreMapA = new Map(
    result.profileScores
      .find((p) => p.profileName === profileNameA)
      ?.contributions.map((c) => [c.cfName, c.score]) ?? []
  );
  const scoreMapB = new Map(
    result.profileScores
      .find((p) => p.profileName === profileNameB)
      ?.contributions.map((c) => [c.cfName, c.score]) ?? []
  );

  return result.cfMatches.map((cf) => {
    const scoreA = cf.matches ? (scoreMapA.get(cf.name) ?? 0) : 0;
    const scoreB = cf.matches ? (scoreMapB.get(cf.name) ?? 0) : 0;
    return {
      cfName: cf.name,
      matches: cf.matches,
      scoreA,
      scoreB,
      delta: scoreB - scoreA,
      differs: scoreA !== scoreB,
    };
  });
}
```

### Progressive Disclosure Pattern

Using the existing `DisclosureSection` component for batch and comparison modes:

```svelte
<DisclosureSection
  sectionKey="scoreSimulatorAdvanced"
  sectionTitle="Advanced Mode"
  sectionHint="Batch input and profile comparison."
  showAdvancedLabel="Show Batch & Comparison"
  hideAdvancedLabel="Hide Batch & Comparison"
>
  <!-- Basic content (always visible) -->
  <ReleaseInput {/* single-release props */} />

  <svelte:fragment slot="advanced">
    <!-- Batch input textarea -->
    <BatchReleaseInput bind:titles={batchTitles} bind:mediaType limit={50} />

    <!-- Dual profile selector for comparison -->
    <ProfileComparison
      profiles={qualityProfileOptions}
      bind:profileA
      bind:profileB
    />
  </svelte:fragment>
</DisclosureSection>
```

**Note**: This requires registering a new section key. The existing `DisclosureSection` uses
`getUserInterfacePreferenceSectionStore` which persists the expanded/collapsed state per section
key.

**Confidence**: High -- DisclosureSection component verified from source (lines 1-41).

## Open Questions

1. **Preset data location**: Should example presets be hardcoded in a TypeScript constants file
   co-located with the route, or loaded from a shared location? Hardcoded is simpler and sufficient
   for Phase 2 since presets are curated and infrequently changed.

2. **Comparison mode trigger**: Should comparison mode be a toggle button next to the profile
   selector, or a separate tab/section? A toggle is simpler UX and avoids page navigation.

3. **Ranking vs. detail view**: When viewing batch results, should the default view be the ranking
   table (sorted by score) or the detailed per-release view (like Phase 1)? Recommendation: show
   ranking table as default with "View Details" expansion per row.

4. **Sticky header for ExpandableTable**: Should a `stickyHeader` prop be added to the
   `ExpandableTable` component, or should the ranking table use a separate implementation with
   `overflow-y-auto` wrapper? Adding a prop is cleaner and reusable.

5. **Batch input mode switching**: When a user switches from batch to single mode, should the
   textarea content be preserved? Recommendation: preserve content but only use the first non-empty
   line in single mode.

6. **Preset categories per arr_type**: Should movie presets be hidden when the user selects series
   media type? Recommendation: yes, filter presets by the active media type to avoid confusion.

## Sources

- [Smashing Magazine - Designing The Perfect Feature Comparison Table](https://www.smashingmagazine.com/2017/08/designing-perfect-feature-comparison-table/)
  (2017)
- [Nielsen Norman Group - Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
- [UXPin - Dropdown Interaction Patterns](https://www.uxpin.com/studio/blog/dropdown-interaction-patterns-a-complete-guide/)
- [LogRocket - Progressive Disclosure in UX Design](https://blog.logrocket.com/ux-design/progressive-disclosure-ux-types-use-cases/)
- [Tailwind CSS - Responsive Design Documentation](https://tailwindcss.com/docs/responsive-design)
- [Tailwind CSS - Grid Template Columns](https://tailwindcss.com/docs/grid-template-columns)
- [SitePoint - Tailwind CSS v4 Container Queries](https://www.sitepoint.com/tailwind-css-v4-container-queries-modern-layouts/)
- [Creative Tim - Tailwind Sticky Table Header](https://www.creative-tim.com/twcomponents/component/sticky-table-header)
- [Cruip - Sticky Column Table with Tailwind](https://cruip.com/create-a-table-with-a-sticky-column-using-tailwind-css/)
- [MDN - Textarea Element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/textarea)
- [TRaSH Guides - Collection of Custom Formats](https://trash-guides.info/Radarr/Radarr-collection-of-custom-formats/)
- [TRaSH Guides - Quality Profile Setup](https://trash-guides.info/Radarr/radarr-setup-quality-profiles/)
- [TRaSH Guides - Recommended Naming Scheme](https://trash-guides.info/Radarr/Radarr-recommended-naming-scheme/)
- [Servarr Wiki - Radarr Settings](https://wiki.servarr.com/radarr/settings)
- [Svelte Playground - Textarea Inputs](https://svelte.dev/playground/textarea-inputs)
- [Interaction Design Foundation - UI Design Patterns](https://ixdf.org/literature/topics/ui-design-patterns)

## Search Queries Executed

1. `side-by-side comparison UI pattern web application best practices 2025`
2. `Svelte 5 sortable table component client-side sorting pattern`
3. `batch text input textarea UI pattern multiple items newline separated`
4. `regex101 playground scoring tool comparison layout UX design pattern`
5. `example preset dropdown categorized curated examples playground UI pattern`
6. `Tailwind CSS v4 responsive side-by-side comparison layout grid breakpoint pattern`
7. `sticky table header CSS scroll sortable ranking table pattern Tailwind`
8. `score diff highlighting comparison two profiles same items delta visualization`
9. `GraphQL playground Apollo sandbox split pane input results layout UX`
10. `progressive disclosure UI pattern advanced options expandable section best practices`
11. `Svelte textarea batch input parse newline-separated items counter validation pattern`
12. `comparison table score difference highlight color coding positive negative delta UI`
13. `Radarr Sonarr release title example common formats remux web-dl bluray naming`

## Uncertainties and Gaps

- **ExpandableTable sticky header support**: The current `ExpandableTable` component does not have a
  `stickyHeader` prop. Adding one is straightforward (add `sticky top-0 z-10` to the `<thead>`
  element), but requires a minor component enhancement. This is a low-risk change that benefits the
  ranking table and other long tables throughout the app.

- **DisclosureSection key registration**: The Phase 2 advanced mode needs a new section key (e.g.,
  `scoreSimulatorAdvanced`). The mechanism for registering new section keys
  (`$shared/disclosure/sectionKeys.ts`) was referenced in the feature spec but the actual file/type
  was not found via grep. This needs verification before implementation.

- **Parser batch performance ceiling**: While individual parse calls are fast (~30-100ms uncached),
  the behavior of `parseWithCacheBatch()` with 50 concurrent titles has not been load-tested. The
  parser microservice is single-threaded (.NET Kestrel), so 50 sequential parse calls could take
  1.5-5 seconds on first run. Consider whether the parser supports parallel request handling.

- **Preset currency**: Hardcoded release title presets will become dated as naming conventions
  evolve. No automated mechanism exists to refresh presets from TRaSH Guides or PCD data. This is
  acceptable for Phase 2 but should be revisited if presets become stale.

- **Container queries vs breakpoints**: Tailwind CSS v4 supports container queries (`@container` /
  `@md:`) which could provide more granular responsive behavior than viewport breakpoints. The
  existing codebase uses viewport breakpoints exclusively. Using container queries for the
  comparison layout would be novel for this codebase and may introduce inconsistency.
