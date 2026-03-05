# Shared Context: Score Simulator Phase 2

> Generated: 2026-03-05 | Feature: score-simulator-phase2 Reference:
> [feature-spec.md](./feature-spec.md)

## Overview

Phase 2 extends the Score Simulator MVP with side-by-side profile comparison, batch release input
(up to 50 titles), curated example presets, ranked results table, and progressive disclosure. **No
API or schema changes needed** — entirely client-side UI work over the existing response shape.

---

## File Inventory

### Score Simulator Routes (Phase 1 — Files to Modify or Reference)

| File                  | Path (relative to `packages/praxrr-app/src/routes/`)               | Lines | Role                                                                                         |
| --------------------- | ------------------------------------------------------------------ | ----- | -------------------------------------------------------------------------------------------- |
| Landing page          | `score-simulator/+page.svelte`                                     | 46    | DB selection, auto-redirect via localStorage                                                 |
| Landing server        | `score-simulator/+page.server.ts`                                  | 11    | Load all databases                                                                           |
| **Main page**         | `score-simulator/[databaseId]/+page.svelte`                        | 235   | Orchestrator: state, API calls, rendering                                                    |
| **Page server**       | `score-simulator/[databaseId]/+page.server.ts`                     | 75    | Load DB, profiles (PCD+TRaSH), parser status                                                 |
| **Helpers**           | `score-simulator/[databaseId]/helpers.ts`                          | 45    | `getSelectedProfileScore`, `resolveScoreThresholdState`, `sortScoreContributionsByMagnitude` |
| **ReleaseInput**      | `score-simulator/[databaseId]/components/ReleaseInput.svelte`      | 194   | Title textarea, media type, profile dropdown, debounce                                       |
| **ScoreBreakdown**    | `score-simulator/[databaseId]/components/ScoreBreakdown.svelte`    | 88    | Total score, threshold badge, contribution list                                              |
| **SimulationResults** | `score-simulator/[databaseId]/components/SimulationResults.svelte` | 332   | CF match table, parsed metadata, expandable conditions                                       |
| API endpoint          | `api/v1/simulate/score/+server.ts`                                 | 335   | POST handler (no changes needed)                                                             |

### Files to Create (Phase 2)

| File                                  | Path (relative to `score-simulator/[databaseId]/`)               | Purpose |
| ------------------------------------- | ---------------------------------------------------------------- | ------- |
| `components/BatchInput.svelte`        | Multi-line textarea with line counter, validation, 50-item limit |
| `components/PresetSelector.svelte`    | Categorized dropdown for example release titles                  |
| `components/ProfileComparison.svelte` | Second profile dropdown with delta summary                       |
| `components/RankingTable.svelte`      | Sorted multi-release ranking with expandable rows                |
| `components/ComparisonView.svelte`    | Side-by-side profile score comparison with delta highlighting    |
| `presets.ts`                          | Hardcoded example release title constants                        |

### Shared UI Components (Reuse)

| Component         | Path (`$ui/` = `src/lib/client/ui/`) | Lines | Key Props                                                         |
| ----------------- | ------------------------------------ | ----- | ----------------------------------------------------------------- |
| DisclosureSection | `$ui/form/DisclosureSection.svelte`  | 41    | `sectionKey`, `initialMode`, slot + `slot="advanced"`             |
| AdvancedSection   | `$ui/form/AdvancedSection.svelte`    | 95    | `aria-expanded`, `aria-controls`, slide transition                |
| Table             | `$ui/table/Table.svelte`             | 388   | `columns`, `data`, `sortable`, `responsive`, `pageSize`           |
| ExpandableTable   | `$ui/table/ExpandableTable.svelte`   | 429   | `getRowId`, `expandedRows`, `chevronPosition`, `expandOnRowClick` |
| Column types      | `$ui/table/types.ts`                 | 36    | `Column<T>`, `SortState`, `SortDirection`                         |
| Score             | `$ui/arr/Score.svelte`               | 41    | `score`, `showSign`, `size`, `colored`                            |
| CustomFormatBadge | `$ui/arr/CustomFormatBadge.svelte`   | —     | CF name + score color display                                     |
| Badge             | `$ui/badge/Badge.svelte`             | 58    | `variant` (9 options), `size`, `icon`, `mono`                     |
| Dropdown          | `$ui/dropdown/Dropdown.svelte`       | 92    | `position`, `minWidth`, `compact`, `fixed`                        |
| DropdownItem      | `$ui/dropdown/DropdownItem.svelte`   | 40    | `label`, `icon`, `selected`, `disabled`, `danger`                 |
| DropdownSelect    | `$ui/dropdown/DropdownSelect.svelte` | 118   | `value`, `options`, `placeholder`, `responsive`                   |
| Button            | `$ui/button/Button.svelte`           | ~88   | Responsive size, icon, tooltip                                    |
| Tabs              | `$ui/nav/Tabs.svelte`                | 156   | Responsive tab bar, mobile dropdown                               |
| CardGrid          | `$ui/card/CardGrid.svelte`           | 29    | 1-5 column responsive grid                                        |
| FormInput         | `$ui/form/FormInput.svelte`          | ~80   | Text/textarea, size variants                                      |
| SearchDropdown    | `$ui/form/SearchDropdown.svelte`     | 203   | `role="listbox"`, keyboard nav, arrow key support                 |

---

## API Contract (No Changes)

### `POST /api/v1/simulate/score`

**Request:**

```typescript
{
  databaseId: number;
  arrType: 'radarr' | 'sonarr';
  profileNames: string[];     // max 10, format: 'pcd:Name' | 'trash:sourceId:Name' | 'PlainName'
  releases: Array<{
    id: string;                // client-generated correlation ID
    title: string;             // release title to parse
    type: 'movie' | 'series';
  }>;                         // max 50
}
```

**Response:**

```typescript
{
  parserAvailable: boolean;
  results: Array<{
    id: string;
    title: string;
    parsed: ParsedInfo | null;
    cfMatches: Array<{
      name: string;
      matches: boolean;
      conditions: SimulateConditionResult[];
    }>;
    profileScores: Array<{
      profileName: string; // matches request key
      totalScore: number;
      minimumScore: number;
      upgradeUntilScore: number;
      contributions: Array<{ cfName: string; score: number }>;
    }>;
  }>;
}
```

**Profile selector parsing** (`+server.ts` lines 50-75):

- `pcd:ProfileName` → decoded via `decodeURIComponent`
- `trash:<sourceId>:<name>` → regex `/^trash:(\d+):(.*)$/`
- Plain name → treated as PCD

**Limits enforced server-side:**

- `releases.length`: 1-50 (lines 102-108)
- `profileNames.length`: 1-10 (lines 94-100)
- `release.title`: non-empty string (lines 115-117)

---

## Existing Types (from `$api/v1.d.ts`)

```typescript
// Key types to import (already generated):
type SimulateScoreResponse    // lines 733-735
type SimulateReleaseResult    // lines 705-710
type SimulateProfileScore     // lines 698-703
type SimulateScoreContribution // lines 694-696
type SimulateCfMatch          // lines 689-692
type SimulateConditionResult  // lines 680-687
type SimulateReleaseInput     // lines 712-718
type ParsedInfo               // lines 630-646
type MediaType = 'movie' | 'series'  // line 629
type ArrType = 'radarr' | 'sonarr' | 'lidarr'  // line 741
```

### Existing Helper Types (from `helpers.ts`)

```typescript
type ScoreThresholdState = 'below' | 'accepted' | 'upgrade-reached';

// Functions:
getSelectedProfileScore(result, profileName) → SimulateProfileScore | null
resolveScoreThresholdState(profileScore) → ScoreThresholdState | null
sortScoreContributionsByMagnitude(contributions) → SimulateScoreContribution[]
```

---

## Architecture: +page.svelte State (Phase 1)

### Reactive Variables

| Variable                 | Type                            | Purpose                                      |
| ------------------------ | ------------------------------- | -------------------------------------------- |
| `releaseTitle`           | `string`                        | User-entered release title                   |
| `mediaType`              | `MediaType`                     | `'movie'` or `'series'`                      |
| `selectedProfileName`    | `string \| null`                | Profile selector value (with prefix)         |
| `simulationResult`       | `SimulateScoreResponse \| null` | API response                                 |
| `isSimulating`           | `boolean`                       | Loading state                                |
| `simulationRequestToken` | `number`                        | Stale request detection (increment per call) |
| `parserAvailable`        | `boolean`                       | Parser health                                |
| `mounted`                | `boolean`                       | Blocks localStorage restore until mount      |

### Reactive Declarations

```typescript
$: tabs = data.databases.map(db => ({ label: db.name, href: `.../${db.id}` }));
$: qualityProfileOptions = /* transform server profiles to dropdown options */;
$: selectedProfileLabel = /* display name lookup */;
$: selectedProfileScore = getSelectedProfileScore(simulationResult, selectedProfileName);
$: if (browser && mounted) { /* persist to localStorage */ }
```

### Key Functions

| Function                      | Purpose                                                 |
| ----------------------------- | ------------------------------------------------------- |
| `simulate()`                  | POST to API, token-based stale detection, update result |
| `refreshParserAvailability()` | GET `/api/v1/parser/health`                             |
| `generateReleaseId()`         | UUID or random fallback                                 |
| `handleReleaseInput()`        | Calls `simulate()`                                      |
| `handleProfileChange(event)`  | Updates profile, calls `simulate()`                     |
| `restorePersistedState()`     | Restore from localStorage with validation               |

### localStorage Keys

| Key                              | Type     | Purpose               |
| -------------------------------- | -------- | --------------------- |
| `scoreSimulatorDatabase`         | `number` | Last-used database ID |
| `scoreSimulator.lastTitle`       | `string` | Last release title    |
| `scoreSimulator.lastProfileName` | `string` | Last profile selector |

### Component Tree (Phase 1)

```
<Tabs />
<div class="grid lg:grid-cols-[2fr_3fr]">
  <div class="space-y-4">
    <ReleaseInput on:input on:profileChange />
    <ScoreBreakdown profileScore={selectedProfileScore} />
  </div>
  <SimulationResults result={simulationResult} ... />
</div>
```

---

## Component Props & Events

### ReleaseInput.svelte

```typescript
export let title: string;
export let mediaType: MediaType;
export let qualityProfiles: QualityProfileOption[];
export let selectedProfileName: string | null;
export let isSimulating: boolean;
export let parserAvailable: boolean;

// Events:
dispatch('input', { title }); // debounced 300ms
dispatch('profileChange', { profileName });
```

### ScoreBreakdown.svelte

```typescript
export let profileScore: SimulateProfileScore | null = null;
// Internal: resolves threshold state, sorts contributions by magnitude
// Uses: Score, CustomFormatBadge, Badge components
```

### SimulationResults.svelte

```typescript
export let result: SimulateScoreResponse | null = null;
export let selectedProfileName: string | null = null;
export let selectedProfileLabel: string | null = null;
export let isSimulating: boolean = false;

// IMPORTANT: Line 49 hardcodes result.results[0] — Phase 2 must make this configurable
// Internal: expandedRows Set, sortedCustomFormatRows, metadataBadges
// Uses: ExpandableTable, CustomFormatBadge, Score, Badge
```

---

## Patterns to Follow

### Progressive Disclosure

```svelte
<DisclosureSection
  sectionKey={SS_ADVANCED_OPTIONS}
  sectionTitle="Advanced Options"
  initialMode="basic"
>
  <!-- Basic slot: always visible -->
  <slot />
  <svelte:fragment slot="advanced">
    <!-- Advanced slot: collapsible -->
  </svelte:fragment>
</DisclosureSection>
```

- Section key already registered:
  `SS_ADVANCED_OPTIONS = 'score-simulator:simulator:advanced-options'` (sectionKeys.ts line 58)
- Persists via `userInterfacePreferenceSectionStore` → API `/api/v1/ui-preferences`
- Slide transition (200ms), respects `prefers-reduced-motion`

### Request Token Pattern (Stale Detection)

```typescript
let simulationRequestToken = 0;

async function simulate() {
  const requestToken = ++simulationRequestToken;
  isSimulating = true;
  try {
    const response = await fetch(...);
    if (requestToken !== simulationRequestToken) return; // stale
    // process result
  } finally {
    if (requestToken === simulationRequestToken) isSimulating = false;
  }
}
```

### Event Dispatch

```typescript
import { createEventDispatcher } from 'svelte';
const dispatch = createEventDispatcher<{
  input: { title: string };
  profileChange: { profileName: string | null };
}>();
dispatch('input', { title });

// Parent: <Component on:input={handler} />
```

### Alert Store

```typescript
import { alertStore } from '$lib/client/alerts/store';
alertStore.add('error', 'Failed to run score simulation.');
alertStore.add('warning', 'Parser service unavailable.', 0); // 0 = no auto-dismiss
alertStore.add('success', 'Simulation complete.');
```

### Responsive Pattern

```typescript
let mediaQuery: MediaQueryList | null = null;
let isMobile = false;

onMount(() => {
  if (typeof window !== 'undefined') {
    mediaQuery = window.matchMedia('(max-width: 767px)');
    isMobile = mediaQuery.matches;
    mediaQuery.addEventListener('change', (e) => { isMobile = e.matches; });
  }
});
onDestroy(() => mediaQuery?.removeEventListener('change', ...));
```

### Table Column Definition

```typescript
import type { Column } from '$ui/table/types';

const columns: Column<RankedRelease>[] = [
  { key: 'rank', header: '#', width: 'w-12', align: 'center' },
  { key: 'title', header: 'Release Title', sortable: true },
  {
    key: 'totalScore',
    header: 'Score',
    width: 'w-24',
    align: 'right',
    sortable: true,
    sortAccessor: (row) => row.totalScore,
  },
  { key: 'matchedCfCount', header: 'Matched CFs', width: 'w-28', align: 'center', sortable: true },
];
```

### Score Display Colors

```
Positive (> 0): text-emerald-600 dark:text-emerald-400 with '+' prefix
Negative (< 0): text-red-600 dark:text-red-400
Zero (=== 0):   text-neutral-500
Null:           text-neutral-400 with '—'
Font:           font-mono font-medium
```

### Badge Variants

```
accent | neutral | success | warning | danger | info | radarr | sonarr | lidarr
sm: px-1.5 py-0.5 text-[10px]
md: px-2 py-0.5 text-xs
```

---

## Accessibility Requirements

### Existing Patterns in Codebase

| Pattern              | Example File                | Usage                                     |
| -------------------- | --------------------------- | ----------------------------------------- |
| `aria-live="polite"` | `MaskedApiKey.svelte:211`   | Status announcements with `role="status"` |
| `aria-expanded`      | `AdvancedSection.svelte:67` | Toggle buttons on collapsible sections    |
| `aria-controls`      | `AdvancedSection.svelte:68` | Links button to controlled panel          |
| `aria-labelledby`    | `AdvancedSection.svelte:85` | Links region to heading                   |
| `role="listbox"`     | `SearchDropdown.svelte:136` | Dropdown option lists                     |
| `aria-selected`      | `SearchDropdown.svelte:145` | Selected option state                     |
| `.sr-only`           | `FormInput.svelte:77`       | Screen-reader-only labels                 |

### Phase 2 Requirements

- `aria-live="polite"` on results panel for batch simulation updates
- `aria-sort` on sortable table column headers
- `aria-expanded` on expandable ranking table rows
- Sign prefixes + icons supplement color (WCAG 1.4.1)
- Logical tab order through batch input → simulate → results

---

## Parser Integration

### Batch Parsing (`parseWithCacheBatch`)

**File:** `$utils/arr/parser/client.ts` lines 285-350

```
Flow:
1. Get parser version (cached per session)
2. Separate cached vs uncached items (DB-backed cache)
3. Parse uncached in parallel via Promise.all()
4. Store results in cache
5. Return Map<cacheKey, ParseResult | null>

Cache key: `${title}:${type}`
Parser timeout: 30000ms
Parser retries: 2 with 500ms delay
```

### Pattern Matching (`matchPatternsBatch`)

**File:** `$utils/arr/parser/client.ts` lines 446-520

```
Flow:
1. Hash sorted patterns (SHA-256)
2. Check cache by text + hash
3. Fetch uncached from parser
4. Cache results
5. Return Map<text → Map<pattern → boolean>>
Auto-invalidates when patterns change (hash differs)
```

---

## New Types to Define (in `helpers.ts`)

```typescript
// Batch input state
interface BatchInputState {
  rawText: string;
  titles: string[];
  active: boolean;
}

// Comparison state
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

// Presets
type PresetCategory = 'movie' | 'series';

interface PresetGroup {
  category: PresetCategory;
  label: string;
  description: string;
  titles: Array<{ label: string; title: string }>;
}

// Ranking
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

## New Helper Functions (in `helpers.ts`)

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

---

## Integration Notes

### SimulationResults Hardcoded Index

`SimulationResults.svelte` line 49 hardcodes `result?.results?.[0]`. Phase 2 must:

- Add a `releaseId` or `releaseIndex` prop
- Find the matching result from the array instead of using `[0]`

### Phase 1 localStorage Backward Compatibility

Phase 1 keys (`scoreSimulator.lastTitle`, `.lastProfileName`) store scalars. Phase 2 batch state
should use separate keys (e.g., `scoreSimulator.batchText`, `scoreSimulator.comparisonProfile`) to
avoid breaking existing behavior.

### ExpandableTable for Ranking

The existing `ExpandableTable` component supports:

- Sortable columns with `sortAccessor` and `sortComparator`
- Expandable rows via `expandedRows: Set<string | number>`
- Progressive loading via `pageSize`
- Mobile card layout via `responsive: true`
- Chevron position and conditional disable

This is the right component for the RankingTable — wrap it with ranking-specific column definitions
and expanded row content (delegating to SimulationResults for detail).

### Batch Simulate Button

Phase 1 uses 300ms debounced auto-simulate. Phase 2 batch mode should:

- Use explicit "Simulate All" button (not debounced per-keystroke)
- Single-release mode keeps existing 300ms debounce
- Extend `simulationRequestToken` pattern for batch (same approach, just send more releases)

### Profile Comparison

To compare profiles, send `profileNames: [profileA, profileB]` in single API call. Response returns
`profileScores[]` with entries for both profiles per release. Client-side delta calculation via
`buildComparisonResult()`.

---

## Testing

No existing unit tests for score-simulator UI components. Test patterns use Deno test framework:

```typescript
import { assertEquals } from '@std/assert';

Deno.test('description', () => {
  // Setup, test, assert
});
```

New helper functions (`parseBatchTitles`, `buildRankingFromResults`, `buildComparisonResult`) should
have unit tests since they contain sorting/ranking/delta logic.

---

## Decision Summary

| Decision           | Choice                          | Rationale                                        |
| ------------------ | ------------------------------- | ------------------------------------------------ |
| API changes        | None                            | Existing contract supports batch + multi-profile |
| Comparison limit   | 2 profiles                      | Simpler layout; covers primary use case          |
| Batch + comparison | Simultaneous allowed            | Ranking table gains dual score columns           |
| Mode switching     | DisclosureSection               | `SS_ADVANCED_OPTIONS` already registered         |
| Batch input        | Textarea with newline delimiter | Natural paste target                             |
| Presets            | Static client-side constants    | Zero server overhead                             |
| State shape        | Flat reactive variables         | Matches Phase 1 `$:` pattern                     |
| Batch submit       | Explicit button                 | Manages parser load                              |
| Advanced↔Basic     | Lossless round-trip             | Keep data in memory, just hide UI                |
