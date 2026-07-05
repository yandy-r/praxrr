# Shared Context: Score Simulator Phase 3

> Generated: 2026-03-06 | Feature: score-simulator-phase3 | Reference:
> [feature-spec.md](./feature-spec.md)

## Overview

Phase 3 transforms the score simulator from a standalone tool into an integrated workflow component
by adding: (1) a "Simulate" deep-link button on the QP scoring page, (2) client-side what-if score
overrides for temporary experimentation without PCD mutation, (3) URL parameter support for
shareable simulation state, and (4) comprehensive unit/integration/e2e test coverage. **No API
changes, no new dependencies, no new database tables.**

---

## File Inventory

### Score Simulator Routes (Phase 1+2 -- Files to Modify or Reference)

| File                  | Path (relative to `packages/praxrr-app/src/routes/`)               | Lines | Role                                                             |
| --------------------- | ------------------------------------------------------------------ | ----- | ---------------------------------------------------------------- |
| Landing page          | `score-simulator/+page.svelte`                                     | 46    | DB selection, auto-redirect via localStorage                     |
| Landing server        | `score-simulator/+page.server.ts`                                  | 11    | Load all databases                                               |
| **Main page**         | `score-simulator/[databaseId]/+page.svelte`                        | 629   | Orchestrator: all state, API calls, rendering                    |
| **Page server**       | `score-simulator/[databaseId]/+page.server.ts`                     | 75    | Load DB, profiles (PCD+TRaSH), parser status                     |
| **Helpers**           | `score-simulator/[databaseId]/helpers.ts`                          | 238   | Phase 1+2 pure functions (scoring, ranking, comparison, batch)   |
| **Presets**           | `score-simulator/[databaseId]/presets.ts`                          | 173   | Hardcoded example release title constants                        |
| **ReleaseInput**      | `score-simulator/[databaseId]/components/ReleaseInput.svelte`      | 213   | Title textarea, media type, profile dropdown, debounce           |
| **ScoreBreakdown**    | `score-simulator/[databaseId]/components/ScoreBreakdown.svelte`    | 88    | Total score, threshold badge, contribution list                  |
| **SimulationResults** | `score-simulator/[databaseId]/components/SimulationResults.svelte` | 379   | CF match table, parsed metadata, expandable conditions           |
| **BatchInput**        | `score-simulator/[databaseId]/components/BatchInput.svelte`        | 159   | Multi-line textarea with line counter, validation, 50-item limit |
| **RankingTable**      | `score-simulator/[databaseId]/components/RankingTable.svelte`      | 215   | Sorted multi-release ranking with expandable rows                |
| **ComparisonView**    | `score-simulator/[databaseId]/components/ComparisonView.svelte`    | 166   | Side-by-side profile score comparison with delta highlighting    |
| **ProfileComparison** | `score-simulator/[databaseId]/components/ProfileComparison.svelte` | 100   | Second profile dropdown with delta summary                       |
| **PresetSelector**    | `score-simulator/[databaseId]/components/PresetSelector.svelte`    | 86    | Categorized dropdown for example release titles                  |
| API endpoint          | `api/v1/simulate/score/+server.ts`                                 | ~926  | POST handler (no changes needed)                                 |

### Quality Profile Scoring Page (Deep-Link Source)

| File               | Path (relative to `packages/praxrr-app/src/routes/`)                        | Lines  | Role                                                 |
| ------------------ | --------------------------------------------------------------------------- | ------ | ---------------------------------------------------- |
| **Scoring page**   | `quality-profiles/[databaseId]/[id]/scoring/+page.svelte`                   | ~1000  | CF score editing, form submission, StickyCard header |
| **Scoring server** | `quality-profiles/[databaseId]/[id]/scoring/+page.server.ts`                | ~151   | Load scoring data, update action                     |
| ScoringTable       | `quality-profiles/[databaseId]/[id]/scoring/components/ScoringTable.svelte` | varies | Responsive table dispatcher (Desktop/Mobile)         |

### Files to Create (Phase 3)

| File                                                                              | Purpose                                                                                              |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `.../score-simulator/[databaseId]/urlState.ts`                                    | URL state serialization/deserialization, `parseUrlState()`, `serializeUrlState()`, `copyShareLink()` |
| `.../quality-profiles/[databaseId]/[id]/scoring/components/SimulateButton.svelte` | Deep-link button for QP scoring page StickyCard header                                               |
| `.../tests/routes/scoreSimulatorPhase3Helpers.test.ts`                            | Unit tests for what-if override helpers                                                              |
| `.../tests/routes/scoreSimulatorUrlState.test.ts`                                 | Unit tests for URL state serialization round-trip                                                    |
| `.../tests/e2e/specs/4.1-score-simulator-deep-link.spec.ts`                       | E2E: scoring page -> simulate -> pre-fill verification                                               |
| `.../tests/e2e/specs/4.2-score-simulator-what-if.spec.ts`                         | E2E: override score -> verify recalculation                                                          |
| `.../tests/e2e/specs/4.3-score-simulator-url-state.spec.ts`                       | E2E: copy link -> open in new context -> verify state                                                |

### Files to Modify (Phase 3)

| File                                                                | Changes                                                                                                   |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `.../score-simulator/[databaseId]/+page.svelte`                     | Read URL state on mount, manage override state, pass overrides to components, add "Copy Link" button      |
| `.../score-simulator/[databaseId]/helpers.ts`                       | Add `applyScoreOverrides()`, `computeOverriddenTotal()`, `resolveThresholdWithOverrides()`                |
| `.../score-simulator/[databaseId]/components/ScoreBreakdown.svelte` | Inline-editable score cells, override visual indicators (amber), original value annotation, delta display |
| `.../score-simulator/[databaseId]/components/RankingTable.svelte`   | Accept overrides prop, re-rank using overridden totals                                                    |
| `.../score-simulator/[databaseId]/components/ComparisonView.svelte` | Show overrides on primary profile, baseline on comparison                                                 |
| `.../quality-profiles/[databaseId]/[id]/scoring/+page.svelte`       | Import and render SimulateButton in StickyCard header                                                     |
| `scripts/test.ts`                                                   | Add aliases: `url-state`, `what-if`, `phase3`                                                             |

### Shared UI Components (Reuse)

| Component         | Path (`$ui/` = `src/lib/client/ui/`) | Key Props                                                                   |
| ----------------- | ------------------------------------ | --------------------------------------------------------------------------- |
| Button            | `$ui/button/Button.svelte`           | `text`, `variant`, `size`, `icon`, `href`, `responsive`, `hideTextOnMobile` |
| NumberInput       | `$ui/form/NumberInput.svelte`        | `value`, `min`, `max`, `step`, `compact`, `responsive`, `onchange`          |
| Score             | `$ui/arr/Score.svelte`               | `score`, `showSign`, `size`, `colored`                                      |
| CustomFormatBadge | `$ui/arr/CustomFormatBadge.svelte`   | CF name + score color display                                               |
| Badge             | `$ui/badge/Badge.svelte`             | `variant` (9 options), `size`, `icon`, `mono`                               |
| ExpandableTable   | `$ui/table/ExpandableTable.svelte`   | `getRowId`, `expandedRows`, `chevronPosition`, `expandOnRowClick`           |
| DisclosureSection | `$ui/form/DisclosureSection.svelte`  | `sectionKey`, `initialMode`, slot + `slot="advanced"`                       |

---

## API Contract (No Changes)

### `POST /api/v1/simulate/score`

**Request:**

```typescript
{
  databaseId: number;
  arrType: 'radarr' | 'sonarr';
  profileNames: string[];     // max 10, format: 'pcd:Name' | 'trash:sourceId:Name'
  releases: Array<{
    id: string;
    title: string;
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
      profileName: string;
      totalScore: number;
      minimumScore: number;
      upgradeUntilScore: number;
      contributions: Array<{ cfName: string; score: number }>;
    }>;
  }>;
}
```

**What-if overrides operate on `contributions[]` post-response.** The server resolves arr-type
precedence, TRaSH score sets, and `all` fallback. Overrides only change _how much_ a matched CF
contributes, not _which_ CFs match. Client replaces `contribution.score` values and re-sums for
`totalScore`.

---

## Existing Types (from `$api/v1.d.ts`)

```typescript
type SimulateScoreResponse       // Root response
type SimulateReleaseResult       // Per-release result
type SimulateProfileScore        // Per-profile scoring
type SimulateScoreContribution   // { cfName, score }
type SimulateCfMatch             // CF match with conditions
type SimulateConditionResult     // Per-condition result
type SimulateReleaseInput        // { id, title, type }
type ParsedInfo                  // Parsed release metadata
type MediaType = 'movie' | 'series'
type ArrType = 'radarr' | 'sonarr' | 'lidarr'
```

### Existing Helper Types (from `helpers.ts`)

```typescript
type ScoreThresholdState = 'below' | 'accepted' | 'upgrade-reached';

// Phase 1
getSelectedProfileScore(result, profileName) -> SimulateProfileScore | null
resolveScoreThresholdState(profileScore) -> ScoreThresholdState | null
sortScoreContributionsByMagnitude(contributions) -> SimulateScoreContribution[]

// Phase 2
parseBatchTitles(rawText, mediaType) -> SimulateReleaseInput[]  // max 50, 500 chars each
buildRankingFromResults(results, profileAName, profileBName?) -> RankedRelease[]
buildComparisonResult(releaseResult, profileAName, profileBName) -> ComparisonResult | null
createReleaseId() -> string

// Phase 2 Types
interface RankedRelease {
  id: string; title: string; rank: number; totalScore: number;
  thresholdState: ScoreThresholdState | null;
  matchedCfCount: number; totalCfCount: number;
  parsed: ParsedInfo | null;
  comparisonScore?: number; comparisonRank?: number; scoreDelta?: number;
}
interface ComparisonResult {
  profileAName: string; profileBName: string;
  profileATotal: number; profileBTotal: number; totalDelta: number;
  contributions: ProfileScoreDelta[];
}
```

---

## New Types to Define (Phase 3)

### Score Override Types (Client-Side Only)

```typescript
/**
 * Map of CF name -> overridden score value.
 * Applied client-side to contributions[] from the API response.
 */
export type ScoreOverrideMap = Record<string, number>;

/**
 * All URL-encodable simulator state.
 */
export interface SimulatorUrlState {
  title?: string;
  mediaType?: 'movie' | 'series';
  profile?: string; // Primary profile selector (e.g., 'pcd:HD Bluray')
  compare?: string; // Comparison profile selector
  arrType?: 'radarr' | 'sonarr';
  batch?: string[]; // Batch titles array
  batchMediaType?: 'movie' | 'series';
  overrides?: ScoreOverrideMap; // What-if score overrides
}
```

### New Helper Functions (in `helpers.ts`)

```typescript
/** Apply score overrides to contributions. Returns new array, no mutation. */
export function applyScoreOverrides(
  contributions: ReadonlyArray<{ cfName: string; score: number }>,
  overrides: ScoreOverrideMap
): Array<{ cfName: string; score: number; originalScore?: number }>;

/** Recompute total score with overrides applied. */
export function computeOverriddenTotal(
  contributions: ReadonlyArray<{ cfName: string; score: number }>,
  overrides: ScoreOverrideMap
): number;

/** Resolve threshold state using overridden total. */
export function resolveThresholdWithOverrides(
  profileScore: SimulateProfileScore,
  overrides: ScoreOverrideMap
): ScoreThresholdState | null;
```

### URL State Functions (in `urlState.ts`)

```typescript
/** Parse URL search params into SimulatorUrlState. Called once on mount. */
export function parseUrlState(searchParams: URLSearchParams): SimulatorUrlState;

/** Serialize SimulatorUrlState to URLSearchParams. Called on "Copy Link". */
export function serializeUrlState(state: SimulatorUrlState): URLSearchParams;

/** Copy shareable URL to clipboard with graceful fallback. */
export async function copyShareLink(
  state: SimulatorUrlState,
  baseUrl: string
): Promise<boolean>;
```

---

## Architecture: +page.svelte State (Phase 1+2 Current)

### Reactive Variables

**Phase 1 (Single Mode):**

| Variable                                | Type                            | Purpose                    |
| --------------------------------------- | ------------------------------- | -------------------------- |
| `releaseTitle`                          | `string`                        | User-entered release title |
| `mediaType`                             | `MediaType`                     | `'movie'` or `'series'`    |
| `selectedProfileName`                   | `string \| null`                | Profile selector value     |
| `singleSimulationResult`                | `SimulateScoreResponse \| null` | API response               |
| `isSimulatingSingle`                    | `boolean`                       | Loading state              |
| `singleSimulationRequestToken`          | `number`                        | Stale request detection    |
| `activeSingleSimulationAbortController` | `AbortController \| null`       | Request cancellation       |

**Phase 2 (Batch Mode):**

| Variable                               | Type                            | Purpose                           |
| -------------------------------------- | ------------------------------- | --------------------------------- |
| `batchRawText`                         | `string`                        | Multi-line batch input            |
| `batchMediaType`                       | `MediaType`                     | Batch media type                  |
| `batchSelectedProfileName`             | `string \| null`                | Batch profile selector            |
| `comparisonProfileName`                | `string \| null`                | Comparison profile selector       |
| `selectedReleaseId`                    | `string \| null`                | Selected release in ranking table |
| `batchSimulationResult`                | `SimulateScoreResponse \| null` | Batch API response                |
| `isSimulatingBatch`                    | `boolean`                       | Batch loading state               |
| `batchSimulationRequestToken`          | `number`                        | Batch stale request detection     |
| `activeBatchSimulationAbortController` | `AbortController \| null`       | Batch request cancellation        |

**Global:**

| Variable               | Type                             | Purpose              |
| ---------------------- | -------------------------------- | -------------------- |
| `parserAvailable`      | `boolean`                        | Parser health status |
| `parserHealthInterval` | `ReturnType<typeof setInterval>` | 3s health poll timer |

### Phase 3 New State (to add)

```typescript
/** What-if score overrides. Keyed by CF name. Client-side only. */
let scoreOverrides: ScoreOverrideMap = {};

/** Whether any overrides are active. */
$: hasActiveOverrides = Object.keys(scoreOverrides).length > 0;

/** Override count for badge display. */
$: overrideCount = Object.keys(scoreOverrides).length;
```

### Reactive Declarations (Current)

```typescript
$: selectedProfileScore = getSelectedProfileScore(
  singleSimulationResult,
  selectedProfileName
);
$: batchTitles = parseBatchTitles(batchRawText, batchMediaType);
$: rankedReleases = buildRankingFromResults(
  batchSimulationResult?.results,
  batchSelectedProfileName,
  comparisonProfileName
);
$: comparisonResult = buildComparisonResult(
  singleSimulationResult?.results?.[0],
  selectedProfileName,
  comparisonProfileName
);
$: singleProfileNames = [selectedProfileName, comparisonProfileName].filter(
  Boolean
);
$: batchProfileNames = [batchSelectedProfileName, comparisonProfileName].filter(
  Boolean
);
```

### Key Functions (Current)

| Function                      | Purpose                                                 |
| ----------------------------- | ------------------------------------------------------- |
| `simulateSingle()`            | POST single release to API with token-based stale check |
| `simulateBatch(override?)`    | POST batch releases to API                              |
| `refreshParserAvailability()` | GET `/api/v1/parser/health` every 3s                    |
| `handleReleaseInput()`        | Calls `simulateSingle()`                                |
| `handleProfileChange(event)`  | Updates profile, calls `simulateSingle()`               |
| `handleBatchSimulate()`       | Calls `simulateBatch()`                                 |
| `clearMainSection()`          | Resets all single vars + cancels request                |
| `clearAdvancedSection()`      | Resets all batch vars + cancels request                 |

### Component Tree (Current)

```
<Tabs />                              <!-- database switcher -->
<div class="grid lg:grid-cols-[2fr_3fr]">
  <div class="space-y-4">
    <ReleaseInput on:input on:profileChange />
    <ScoreBreakdown profileScore={selectedProfileScore} />
  </div>
  <SimulationResults result={singleSimulationResult} ... />
</div>
<DisclosureSection sectionKey={SS_ADVANCED_OPTIONS}>
  <!-- Basic: BatchInput + PresetSelector -->
  <!-- Advanced slot: ProfileComparison -->
</DisclosureSection>
{#if batchSimulationResult}
  <RankingTable rankedReleases={rankedReleases} ... />
  {#if comparisonResult}
    <ComparisonView comparisonResult={comparisonResult} ... />
  {/if}
{/if}
```

---

## Component Props & Events (Modification Targets)

### ScoreBreakdown.svelte (88 lines -- Key Phase 3 Target)

```typescript
// Current props
export let profileScore: SimulateProfileScore | null = null;

// Current reactive state
$: totalScore = profileScore?.totalScore ?? 0;
$: minimumScore = profileScore?.minimumScore ?? 0;
$: upgradeUntilScore = profileScore?.upgradeUntilScore ?? 0;
$: thresholdState = resolveScoreThresholdState(profileScore);
$: contributions = profileScore
  ? sortScoreContributionsByMagnitude(profileScore.contributions)
  : [];

// Phase 3 additions needed:
// - New prop: overrides: ScoreOverrideMap = {}
// - New prop: onOverrideChange: (cfName: string, score: number) => void
// - New prop: onOverrideReset: (cfName: string) => void
// - New prop: onOverrideResetAll: () => void
// - Override-adjusted totalScore and thresholdState
// - Inline-editable score cells with amber styling
// - Original value annotation (strikethrough)
// - Delta display (+N / -N)
```

### RankingTable.svelte (215 lines)

```typescript
export let rankedReleases: RankedRelease[] = [];
export let comparisonActive: boolean = false;
export let isSimulating: boolean = false;
export let simulationResult: SimulateScoreResponse | null = null;
export let selectedProfileName: string | null = null;
export let selectedProfileLabel: string | null = null;

// Dispatches: releaseSelect: { id: string }
// Phase 3: Accept overrides prop, re-rank using overridden totals
```

### ComparisonView.svelte (166 lines)

```typescript
export let comparisonResult: ComparisonResult | null = null;
export let profileALabel: string;
export let profileBLabel: string;

// Desktop: side-by-side grid with CF name, Profile A score, Profile B score, delta
// Mobile: tabbed view showing one profile at a time
// Phase 3: Show override-adjusted deltas for primary profile only
```

### ReleaseInput.svelte (213 lines)

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
dispatch('clear');
```

---

## QP Scoring Page Integration

### StickyCard Header (SimulateButton Placement)

The scoring page `+page.svelte` uses a `<StickyCard>` header with action buttons. Current buttons in
the header area (approximate lines 577-595):

```svelte
<StickyCard position="top">
  <!-- Left side: page title / profile name -->
  <!-- Right side: action buttons -->
  <Button text="Scoring" icon={Info} on:click={() => (showInfoModal = true)} />
  <!-- Options button -->
  <Button
    disabled={isSaving || !$isDirty}
    icon={isSaving ? Loader2 : Save}
    text={isSaving ? 'Saving...' : 'Save'}
    on:click={handleSaveClick}
  />
</StickyCard>
```

**Phase 3 adds** `<SimulateButton>` between Info and Save:

```svelte
<SimulateButton databaseId={data.databaseId} profileName={data.scoring.name} />
```

### Scoring Page Server Data

```typescript
// +page.server.ts load returns:
{
  scoring: PcdProfileScoreData,  // includes profile name, CF scores by arrType
  canWriteToBase: boolean,
}

// Profile name available as: data.scoring.name (or from route params)
// Database ID available as: params.databaseId
```

### Scoring Page State

```typescript
// Dirty tracking (from $lib/client/stores/dirty)
import { current, isDirty, initEdit, update } from '...dirty';
// The "Simulate" button performs standard navigation via goto()
// If user has unsaved changes, existing dirty guard will warn before leaving
```

---

## URL State Design

### Encoding Strategy

**Simple params for scalars, base64 JSON for complex objects.** No new dependencies (no lz-string).

| Param            | Encoding          | Example                          |
| ---------------- | ----------------- | -------------------------------- |
| `title`          | Plain string      | `?title=Movie.2024.1080p.BluRay` |
| `mediaType`      | Literal           | `&mediaType=movie`               |
| `profile`        | URL-encoded       | `&profile=pcd%3AHD+Bluray`       |
| `compare`        | URL-encoded       | `&compare=pcd%3AWeb+1080p`       |
| `arrType`        | Literal           | `&arrType=radarr`                |
| `batch`          | Base64 JSON array | `&batch=WyJUaXRsZS4x...`         |
| `batchMediaType` | Literal           | `&batchMediaType=series`         |
| `overrides`      | Base64 JSON       | `&overrides=eyJEViI6MjAw...`     |

### URL State Lifecycle

1. **Read on mount**: `onMount` reads `$page.url.searchParams`, parses via `parseUrlState()`,
   populates reactive state. One-time operation.
2. **No continuous sync**: URL is NOT updated on every state change. No bidirectional binding.
3. **Write on explicit action**: "Copy Link" button calls `serializeUrlState()`, constructs full
   URL, copies to clipboard via `navigator.clipboard.writeText()`.
4. **Graceful degradation**: If URL > ~2000 chars, drop `overrides` first, then `batch`. Show
   warning toast.

### URL Param Validation

- Unknown params: silently ignored
- Missing params: fall back to defaults (no profile, movie media type, empty title)
- Malformed base64/JSON: silently discarded
- Profile not found: load with dropdown open, show warning, preserve other state
- Invalid arrType: default to `radarr`

---

## What-If Override Design

### Architecture

```
API Response (contributions[])
  |
  | Client applies ScoreOverrideMap
  v
Overridden contributions[]
  |
  +-- Re-sum -> overridden totalScore
  +-- Re-threshold -> overridden ScoreThresholdState
  +-- Re-rank -> overridden RankedRelease[] (batch mode)
```

### Rules

1. **Client-side only**: Overrides replace `contribution.score` values and re-sum. No API call.
2. **Never persisted**: Overrides exist in client memory + optionally in URL state. Never written to
   PCD. Info banner: "What-if overrides are temporary and will not be saved."
3. **Scope**: Only CFs in the profile's `contributions[]` can be overridden. No new CF mappings.
4. **Value constraints**: Integer scores only. Negative values valid (blocking). No min/max bounds.
5. **Batch mode**: Override map applies uniformly to all releases (CF scores are per-profile, not
   per-release). Ranking table re-sorts using overridden totals.
6. **Comparison mode**: Overrides apply to primary profile only. Comparison profile shows baseline.
7. **Recalculation**: <1ms (sum of ~5-20 contributions). No debounce needed.
8. **Reset**: Per-CF reset (click indicator) and "Reset All Overrides" button. No confirmation
   modal.

### ScoreOverrideMap Type Contract

```typescript
export type ScoreOverrideMap = Record<string, number>;
```

This type serves as the bridge to Config Impact Simulator (#30). When #30 introduces PCD sandbox
ops, the override map can be converted to temporary `quality_profile_custom_formats` update ops.

---

## Scoring Loop Reference (API Endpoint)

The server-side scoring loop at `+server.ts` lines 848-875:

```typescript
let totalScore = 0;
const contributions: SimulateScoreContribution[] = [];

for (const cfMatch of cfMatches) {
  if (!cfMatch.matches) continue;

  let score = 0;
  if (profile.kind === 'pcd') {
    const cfScoring = profile.scoreData.customFormats.find(
      (cf) => cf.name === cfMatch.name
    );
    score = cfScoring?.scores[arrType] ?? 0;
  } else {
    // TRaSH score resolution (direct name match -> normalized key fallback)
    const scoreByCfName = trashScoreMapsByRequestKey.get(profile.requestKey);
    score =
      scoreByCfName?.get(cfMatch.name.toLowerCase()) ??
      scoreByCfName?.get(normalizeCfKey(cfMatch.name)) ??
      0;
  }

  if (score !== 0) {
    contributions.push({ cfName: cfMatch.name, score });
  }
  totalScore += score;
}
```

**What-if correctness**: Client-side override replaces `score` in `contributions[]` and re-sums
`totalScore`. This is the same arithmetic the server performs. The override does NOT change which
CFs match or which score resolution path is used -- those are already resolved.

---

## Patterns to Follow

### Event Dispatch (Phase 1/2 Convention)

```typescript
import { createEventDispatcher } from 'svelte';
const dispatch = createEventDispatcher<{
  input: { title: string };
  profileChange: { profileName: string | null };
  overrideChange: { cfName: string; score: number };
  overrideReset: { cfName: string };
}>();
```

### Request Token Pattern (Stale Detection)

```typescript
let simulationRequestToken = 0;
async function simulate() {
  const requestToken = ++simulationRequestToken;
  isSimulating = true;
  try {
    const response = await fetch(...);
    if (requestToken !== simulationRequestToken) return; // stale
  } finally {
    if (requestToken === simulationRequestToken) isSimulating = false;
  }
}
```

### Alert Store

```typescript
import { alertStore } from '$lib/client/alerts/store';
alertStore.add('success', 'Link copied to clipboard.');
alertStore.add('warning', 'URL truncated to fit sharing limits.', 0);
```

### Score Display Colors

```
Positive (> 0): text-emerald-600 dark:text-emerald-400 with '+' prefix
Negative (< 0): text-red-600 dark:text-red-400
Zero (=== 0):   text-neutral-500
Override active: bg-amber-50 dark:bg-amber-900/20, border-l-2 border-amber-500
Delta positive:  text-emerald-600 with '+' prefix
Delta negative:  text-red-600
```

### Badge Variants

```
accent | neutral | success | warning | danger | info | radarr | sonarr | lidarr
sm: px-1.5 py-0.5 text-[10px]
md: px-2 py-0.5 text-xs
```

### Button Component Usage

```svelte
<!-- Secondary navigation button (SimulateButton) -->
<Button
  text="Simulate"
  variant="secondary"
  icon={FlaskConical}
  responsive
  hideTextOnMobile
  on:click={openSimulator}
/>

<!-- Copy Link button -->
<Button
  text="Copy Link"
  variant="secondary"
  icon={Link}
  size="xs"
  on:click={handleCopyLink}
/>

<!-- Reset All Overrides -->
<Button
  text="Reset All"
  variant="ghost"
  icon={RotateCcw}
  size="xs"
  on:click={handleResetAll}
/>
```

### NumberInput for Inline Score Editing

```svelte
<NumberInput
  name="override-{cfName}"
  value={overriddenScore}
  step={1}
  compact
  font="mono"
  onchange={(v) => handleOverrideChange(cfName, v)}
/>
```

### Disclosure Section Key

```typescript
// Already registered in sectionKeys.ts line 58:
export const SS_ADVANCED_OPTIONS =
  'score-simulator:simulator:advanced-options' as const;
// No new section keys needed for Phase 3
```

### localStorage Keys (Phase 1 -- No Changes)

| Key                              | Type     | Purpose               |
| -------------------------------- | -------- | --------------------- |
| `scoreSimulatorDatabase`         | `number` | Last-used database ID |
| `scoreSimulator.lastTitle`       | `string` | Last release title    |
| `scoreSimulator.lastProfileName` | `string` | Last profile selector |

---

## Server Load Data Shape

### Score Simulator `+page.server.ts`

```typescript
return {
  databases: Database[],
  currentDatabase: Database,
  qualityProfiles: Array<{
    id: number;
    name: string;
    value: string;        // 'pcd:{encodedName}' or 'trash:{id}:{encodedName}'
    displayName: string;
  }>,
  parserAvailable: boolean,
};
```

### Scoring Page `+page.server.ts`

```typescript
return {
  scoring: PcdProfileScoreData, // includes .name, .customFormats[].scores
  canWriteToBase: boolean,
};
```

---

## Accessibility Requirements

| Requirement                       | Pattern                                                                    |
| --------------------------------- | -------------------------------------------------------------------------- |
| Color not sole indicator          | Sign prefixes (+/-), strikethrough text, "was: N" annotations (WCAG 1.4.1) |
| Score recalculation announcements | `aria-live="polite"` on total score region                                 |
| Inline editing keyboard support   | Tab between cells, Enter to confirm, Escape to revert                      |
| Auto-select on activation         | Input content selected for immediate replacement typing                    |
| Override count badge              | `aria-label` for screen readers                                            |
| Copy Link feedback                | Toast with `aria-live="polite"`                                            |

---

## Testing

### Existing Test Structure

```
packages/praxrr-app/src/tests/routes/
  scoreSimulatorHelpers.test.ts          # Phase 1: getSelectedProfileScore, resolveThresholdState, sortContributions
  scoreSimulatorPhase2Helpers.test.ts     # Phase 2: parseBatchTitles, buildRankingFromResults, buildComparisonResult
  simulateScoreRoute.test.ts             # API endpoint integration tests

packages/praxrr-app/src/tests/e2e/specs/
  1.x-cf-*                               # Custom format tests
  2.x-qp-*                               # Quality profile tests
  3.x-regex-*                            # Regex tests
  4.x-score-simulator-*                  # Phase 3 (new)
```

### Test Patterns

```typescript
import { assertEquals } from '@std/assert';

Deno.test('applyScoreOverrides replaces matching CF scores', () => {
  const contributions = [
    { cfName: 'DV', score: 50 },
    { cfName: 'HDR10', score: 30 },
  ];
  const overrides = { DV: 100 };
  const result = applyScoreOverrides(contributions, overrides);
  assertEquals(result[0].score, 100);
  assertEquals(result[1].score, 30);
});
```

### Test Aliases (scripts/test.ts -- Current)

```
Available: filters, normalize, selectors, env-instances, backup, cleanup
Directories: upgrades, jobs, logger
```

Phase 3 adds: `url-state`, `what-if`, `phase3`

---

## Decision Summary

| Decision                   | Choice                                  | Rationale                                                                  |
| -------------------------- | --------------------------------------- | -------------------------------------------------------------------------- |
| What-if implementation     | Client-side score overlay               | No API changes; override + re-sum is trivial; zero PCD mutation risk       |
| URL state encoding         | Search params + base64 JSON for complex | Clean deep-links; compact overrides without new deps                       |
| URL state sync             | Read-on-mount, write-on-action          | Simplest mental model; no continuous bidirectional sync                    |
| URL compression            | None (no lz-string)                     | Typical state fits ~3500-4000 chars; well within modern browser limits     |
| Inline editing             | Click-to-edit in contribution cells     | Follows PatternFly/enterprise data table patterns; preserves row context   |
| Override scope             | Per-CF globally (all profiles)          | CF score override = "what if this CF contributed X?" -- applies regardless |
| Override persistence       | URL-only (ephemeral unless shared)      | Simplest mental model; overrides are temporary by nature                   |
| Deep-link arrType          | Default `radarr`                        | Scoring page is arr-agnostic; user can change in simulator                 |
| Deep-link target           | Same tab (standard navigation)          | Standard UX; scoring page reloads from server on back                      |
| Config Impact (#30) bridge | `ScoreOverrideMap` type contract only   | Define interface boundary now; full sandbox deferred                       |
| Testing framework          | Deno test + Playwright (existing)       | Matches established patterns                                               |
| API changes                | None                                    | Feature spec explicit: zero API, schema, or dependency changes             |

---

## Risk Summary

| Risk                                               | Likelihood | Impact | Mitigation                                                                 |
| -------------------------------------------------- | ---------- | ------ | -------------------------------------------------------------------------- |
| URL state exceeds 2000 chars for batch scenarios   | Medium     | Medium | Truncate batch titles; drop overrides; show warning toast                  |
| What-if recalculation diverges from server scoring | Low        | Medium | Only replaces contribution scores and re-sums; same arithmetic; unit tests |
| Profile name encoding with special characters      | Low        | Medium | Use `encodeURIComponent()`; test spaces, unicode, colons                   |
| E2E tests flaky due to parser dependency           | Medium     | Medium | Use `parserAvailable` check; tests work with or without parser             |
| Override UI adds visual noise to ScoreBreakdown    | Low        | Low    | Editing activates on click; amber indicators are subtle; "Reset All"       |

---

## Research References

- [feature-spec.md](./feature-spec.md): Authoritative specification
- [research-technical.md](./research-technical.md): Architecture, data models, API analysis
- [research-business.md](./research-business.md): User stories, business rules, workflows
- [research-external.md](./research-external.md): SvelteKit URL APIs, Deno testing, Playwright
- [research-ux.md](./research-ux.md): What-if editing patterns, competitive analysis, accessibility
- [research-recommendations.md](./research-recommendations.md): Phasing strategy, risks,
  alternatives
- [Phase 1 shared.md](../score-simulator/shared.md): Original architecture and patterns
- [Phase 2 shared.md](../score-simulator-phase2/shared.md): Batch/comparison architecture
