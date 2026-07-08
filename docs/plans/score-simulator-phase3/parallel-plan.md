# Parallel Implementation Plan: Score Simulator Phase 3

> Generated: 2026-03-06 | Feature: score-simulator-phase3 References: [shared.md](./shared.md) |
> [feature-spec.md](./feature-spec.md) | [analysis-\*.md](.)

---

## Plan Overview

**Feature:** Deep-link integration, what-if score overrides, shareable URL state, user-first UX
hardening, and comprehensive testing for the Score Simulator.

**Scope:** 19 tasks across 7 parallel batches. No new API endpoints, no new dependencies, no
database changes. One minor server load modification (return profile name).

**Critical Path:** T3 -> T4 -> T7 -> T8 -> T15 -> T18 (urlState -> URL mount reading -> override
wiring -> ScoreBreakdown -> decision summary UX -> UX E2E tests) — 6 tasks across 6 batches

---

## Implementation Batches

### Batch 1 — Foundation (5 parallel tasks)

All tasks in this batch are independent with zero cross-dependencies.

---

#### Task T0: Add profileName to QP scoring page server load

- **Action**: Modify
- **Files**:
  - `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/scoring/+page.server.ts`
- **Dependencies**: None
- **Complexity**: S

**Requirements:**

- The current server load resolves `profile.name` (line 39) but does not include it in the return
  value
- Add `profileName: profile.name` to the return object (line 47-50):

  ```typescript
  return {
    profileName: profile.name,
    scoring: scoringData,
    canWriteToBase: canWriteToBase(currentDatabaseId),
  };
  ```

- This is needed by SimulateButton (T1/T2) to construct the deep-link URL

**Note:** This is a server load data shape change, not an API endpoint change. No OpenAPI spec
update needed.

---

#### Task T1: Create SimulateButton.svelte

- **Action**: Create
- **File**:
  `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/scoring/components/SimulateButton.svelte`
- **Dependencies**: None
- **Complexity**: S

**Requirements:**

- Accept props: `databaseId: number`, `profileName: string`
- Render
  `<Button variant="secondary" icon={FlaskConical} responsive hideTextOnMobile text="Simulate" />`
- On click:
  `goto('/score-simulator/${databaseId}?profile=${encodeURIComponent('pcd:' + profileName)}&arrType=radarr')`
- Import `goto` from `$app/navigation`, `Button` from `$ui/button/Button.svelte`, `FlaskConical`
  from `lucide-svelte`
- Use `URLSearchParams` to construct params to avoid double-encoding
- Conditionally render only when `profileName` is truthy

**Patterns:**

- Follow Button usage in shared.md "Button Component Usage" section
- Standard SvelteKit `goto()` for same-tab navigation

---

#### Task T3: Create urlState.ts module

- **Action**: Create
- **File**: `packages/praxrr-app/src/routes/score-simulator/[databaseId]/urlState.ts`
- **Dependencies**: None
- **Complexity**: M

**Requirements:**

Types to define:

```typescript
import type { ScoreOverrideMap } from '../helpers'; // canonical definition in helpers.ts (T6)

export interface SimulatorUrlState {
  title?: string;
  mediaType?: 'movie' | 'series';
  profile?: string;
  compare?: string;
  arrType?: 'radarr' | 'sonarr';
  batch?: string[];
  batchMediaType?: 'movie' | 'series';
  overrides?: ScoreOverrideMap;
}
```

Functions to implement:

1. `parseUrlState(searchParams: URLSearchParams): SimulatorUrlState`
   - Extract simple params: `title`, `mediaType`, `profile`, `compare`, `arrType`, `batchMediaType`
   - Validate `mediaType` to `'movie' | 'series'` (default: skip/undefined)
   - Validate `arrType` to `'radarr' | 'sonarr'` only (reject `lidarr`, default: undefined)
   - Decode `batch` param: `atob()` -> `JSON.parse()` -> validate is string array. Wrap in
     try/catch, return undefined on failure.
   - Decode `overrides` param: `atob()` -> `JSON.parse()` -> validate is Record<string, number>,
     filter out non-finite values via `Number.isFinite()`, round to integer via `Math.round()`. Wrap
     in try/catch.
   - Empty string params treated as absent (return undefined)
   - Unknown params silently ignored

2. `serializeUrlState(state: SimulatorUrlState): URLSearchParams`
   - Set simple params only when truthy/non-empty
   - Encode `batch` as `btoa(JSON.stringify(batch))` when array has items
   - Encode `overrides` as `btoa(JSON.stringify(overrides))` when object has keys
   - Omit undefined/empty values

3. `copyShareLink(state: SimulatorUrlState, baseUrl: string): Promise<{ success: boolean; truncated: boolean }>`
   - Serialize state, construct full URL
   - If URL length > 2000: drop `overrides` first, set `truncated = true`; if still > 2000: drop
     `batch`, set `truncated = true`
   - Copy via `navigator.clipboard.writeText(url)` in try/catch
   - Fallback: `document.execCommand('copy')` with temporary textarea (follow InstanceForm.svelte
     pattern)
   - Return `{ success, truncated }`

**Edge cases to handle:** U1-U12 from analysis-validation.md

---

#### Task T6: Add what-if helper functions to helpers.ts

- **Action**: Modify (append only)
- **File**: `packages/praxrr-app/src/routes/score-simulator/[databaseId]/helpers.ts`
- **Dependencies**: None
- **Complexity**: S

**Requirements:**

Add at end of file (after existing Phase 2 functions):

```typescript
export type ScoreOverrideMap = Record<string, number>;

export function applyScoreOverrides(
  contributions: ReadonlyArray<{ cfName: string; score: number }>,
  overrides: ScoreOverrideMap
): Array<{ cfName: string; score: number; originalScore?: number }> {
  // Return new array. For each contribution:
  // - If cfName exists in overrides AND override value differs from original score:
  //   return { cfName, score: overrides[cfName], originalScore: contribution.score }
  // - Otherwise: return { cfName, score: contribution.score } (no originalScore)
  // Never mutate input array.
  // Overrides for CFs not in contributions are silently ignored.
}

export function computeOverriddenTotal(
  contributions: ReadonlyArray<{ cfName: string; score: number }>,
  overrides: ScoreOverrideMap
): number {
  // Sum: for each contribution, use overrides[cfName] if present, else contribution.score
}

export function resolveThresholdWithOverrides(
  profileScore: SimulateProfileScore,
  overrides: ScoreOverrideMap
): ScoreThresholdState | null {
  // If profileScore is null, return null
  // Compute overridden total via computeOverriddenTotal()
  // Apply same threshold logic as resolveScoreThresholdState() but with overridden total:
  //   - total >= upgradeUntilScore -> 'upgrade-reached'
  //   - total >= minimumScore -> 'accepted'
  //   - else -> 'below'
}
```

**Edge cases:** W1-W5 from analysis-validation.md. Empty overrides map returns originals unchanged.

---

#### Task T14: Register test aliases in scripts/test.ts

- **Action**: Modify
- **File**: `scripts/test.ts`
- **Dependencies**: None
- **Complexity**: S

**Requirements:**

- Read existing file first to find the `aliases` map
- Add entries:
  - `'url-state': 'packages/praxrr-app/src/tests/routes/scoreSimulatorUrlState.test.ts'`
  - `'what-if': 'packages/praxrr-app/src/tests/routes/scoreSimulatorPhase3Helpers.test.ts'`
  - `'phase3': 'packages/praxrr-app/src/tests/routes/scoreSimulatorPhase3Helpers.test.ts,packages/praxrr-app/src/tests/routes/scoreSimulatorUrlState.test.ts'`
- Keep alphabetical order consistent with existing entries

---

### Batch 2 — Component Integration (2 parallel tasks)

---

#### Task T2: Integrate SimulateButton into QP scoring page

- **Action**: Modify
- **File**: `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/scoring/+page.svelte`
- **Dependencies**: T0, T1
- **Complexity**: S

**Requirements:**

- Import `SimulateButton` from `./components/SimulateButton.svelte`
- In the StickyCard `slot="right"` div (~line 583-594), add `<SimulateButton>` between the Options
  button and the Save button
- Props: `databaseId={Number($page.params.databaseId)}` and `profileName={data.profileName ?? ''}`
- `data.profileName` is provided by T0's server load modification
- Conditionally render only when `data.profileName` is truthy
- No other changes to the file

---

#### Task T4: Read URL state on simulator mount

- **Action**: Modify
- **File**: `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte`
- **Dependencies**: T3
- **Complexity**: M

**Requirements:**

- Import `parseUrlState` from `./urlState.ts` and `page` from `$app/stores`
- In the existing `onMount` block, BEFORE any localStorage reads or simulation triggers:
  1. Call `const urlState = parseUrlState($page.url.searchParams)`
  2. If `urlState.title` is set: `releaseTitle = urlState.title`
  3. If `urlState.mediaType` is set: `mediaType = urlState.mediaType`
  4. If `urlState.profile` is set: validate against `data.qualityProfiles` options
     - If found: `selectedProfileName = urlState.profile`
     - If not found: `alertStore.add('warning', 'Profile from URL not found in this database.')`
  5. If `urlState.compare` is set: `comparisonProfileName = urlState.compare` (same validation)
  6. If `urlState.arrType` is set: apply to relevant state (arrType is embedded in profile selector)
  7. If `urlState.batch` is set: `batchRawText = urlState.batch.join('\n')`
  8. If `urlState.batchMediaType` is set: `batchMediaType = urlState.batchMediaType`
  9. If `urlState.overrides` is set: `scoreOverrides = urlState.overrides` (T7 adds this variable)
- URL params take precedence over localStorage values
- If title + profile populated from URL, trigger `simulateSingle()` after state assignment
- Track whether state came from URL to avoid overwriting with localStorage

**Important:** This task adds the URL reading logic. T7 adds the `scoreOverrides` variable that line
9 assigns to. During implementation, if T7 is not yet complete, the overrides line can be added as a
comment/TODO.

---

### Batch 3 — Override State + Copy Link (1 task)

> T5 (Copy Link) and T7 (override state) were merged because T7 updates the `handleCopyLink`
> function that T5 creates — they have a cross-dependency on the same file and function.

---

#### Task T7: Add override state management + Copy Link to +page.svelte

- **Action**: Modify
- **File**: `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte`
- **Dependencies**: T3, T4, T6
- **Complexity**: L

**Requirements:**

**Part A — Override State (formerly T7):**

New imports and state variables:

```typescript
import type { ScoreOverrideMap } from './helpers';
import { copyShareLink } from './urlState';
import { Link, RotateCcw } from 'lucide-svelte';

let scoreOverrides: ScoreOverrideMap = {};

$: hasActiveOverrides = Object.keys(scoreOverrides).length > 0;
$: overrideCount = Object.keys(scoreOverrides).length;
```

New handler functions:

```typescript
function handleOverrideChange(cfName: string, score: number) {
  scoreOverrides = { ...scoreOverrides, [cfName]: Math.round(score) };
}

function handleOverrideReset(cfName: string) {
  const { [cfName]: _, ...rest } = scoreOverrides;
  scoreOverrides = rest;
}

function handleOverrideResetAll() {
  scoreOverrides = {};
}
```

Template changes — override wiring:

- Pass to ScoreBreakdown: `overrides={scoreOverrides}`, `onOverrideChange={handleOverrideChange}`,
  `onOverrideReset={handleOverrideReset}`, `onOverrideResetAll={handleOverrideResetAll}`
- Pass to RankingTable: `overrides={scoreOverrides}`
- Pass to ComparisonView: `overrides={scoreOverrides}`
- Add info banner when `hasActiveOverrides`:

  ```svelte
  {#if hasActiveOverrides}
    <div
      class="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200"
    >
      <span
        >{overrideCount} what-if override{overrideCount > 1 ? 's' : ''} active.</span
      >
      <span class="text-neutral-500"
        >Overrides are temporary and will not be saved.</span
      >
      <Button
        text="Reset All"
        variant="ghost"
        size="xs"
        icon={RotateCcw}
        on:click={handleOverrideResetAll}
      />
    </div>
  {/if}
  ```

**Part B — Copy Link (formerly T5):**

Add `handleCopyLink()` async function:

1. Gather current state into `SimulatorUrlState` object, including
   `overrides: hasActiveOverrides ? scoreOverrides : undefined`
2. Call `copyShareLink(state, window.location.origin + $page.url.pathname)`
3. On success + not truncated: `alertStore.add('success', 'Link copied to clipboard.')`
4. On success + truncated:
   `alertStore.add('warning', 'Link copied. Some state was omitted to fit URL limits.')`
5. On failure:
   `alertStore.add('info', 'Could not copy to clipboard. Copy URL from the address bar.')`

Add
`<Button text="Copy Link" variant="secondary" size="xs" icon={Link} on:click={handleCopyLink} />` in
the page header toolbar area (near database tabs or results section header)

---

### Batch 4 — UI Components (3 parallel tasks)

---

#### Task T8: Make ScoreBreakdown inline-editable with override indicators

- **Action**: Modify
- **File**:
  `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ScoreBreakdown.svelte`
- **Dependencies**: T6, T7
- **Complexity**: L

**Requirements:**

New props (add to script section):

```typescript
export let overrides: ScoreOverrideMap = {};
export let onOverrideChange:
  ((cfName: string, score: number) => void) | undefined = undefined;
export let onOverrideReset: ((cfName: string) => void) | undefined = undefined;
export let onOverrideResetAll: (() => void) | undefined = undefined;
```

New reactive state:

```typescript
import {
  applyScoreOverrides,
  computeOverriddenTotal,
  resolveThresholdWithOverrides,
} from '../helpers';

$: overriddenContributions = profileScore
  ? applyScoreOverrides(
      sortScoreContributionsByMagnitude(profileScore.contributions),
      overrides
    )
  : [];

$: overriddenTotal = profileScore
  ? computeOverriddenTotal(profileScore.contributions, overrides)
  : 0;

$: overriddenThresholdState = profileScore
  ? resolveThresholdWithOverrides(profileScore, overrides)
  : null;

$: hasOverrides = Object.keys(overrides).length > 0;

// Track which contribution is being edited
let editingCfName: string | null = null;
```

Inline editing behavior:

- Each contribution row: clicking the score area sets `editingCfName = cfName`
- When `editingCfName === cfName`, render `<NumberInput>` instead of `<Score>`:

  ```svelte
  <NumberInput
    name="override-{cfName}"
    value={contribution.score}
    step={1}
    compact
    font="mono"
    onchange={(v) => {
      onOverrideChange?.(cfName, v);
      editingCfName = null;
    }}
  />
  ```

- Handle blur-clear: also listen to `on:change` dispatched event to detect `undefined` and treat as
  reset
- Auto-select input on mount (use `use:action` to select input text)
- Keyboard: Enter confirms (NumberInput handles this), Escape reverts (`on:keydown` handler sets
  `editingCfName = null`)

Override visual indicators:

- Row with active override (where `originalScore` is defined):

  ```
  class:bg-amber-50={hasOverride}
  class:dark:bg-amber-900/20={hasOverride}
  class:border-l-2={hasOverride}
  class:border-amber-500={hasOverride}
  ```

- Original value annotation:
  `<span class="text-xs text-neutral-400 line-through">{originalScore}</span>`
- Delta display:
  `<span class="text-xs {delta > 0 ? 'text-emerald-600' : 'text-red-600'}">{delta > 0 ? '+' : ''}{delta}</span>`
- Per-CF reset button: small X icon button, calls `onOverrideReset?.(cfName)`

Total score section:

- Use `overriddenTotal` instead of `totalScore` when `hasOverrides`
- Use `overriddenThresholdState` instead of `thresholdState` when `hasOverrides`
- Show delta from original: `<span>was {originalTotal}</span>` with delta
- Add `aria-live="polite"` to total score container

Accessibility:

- Tab navigation between contribution rows
- `aria-label` on override count indicators

---

#### Task T9: Wire overrides into RankingTable

- **Action**: Modify
- **Files**:
  - `packages/praxrr-app/src/routes/score-simulator/[databaseId]/helpers.ts` (modify
    `buildRankingFromResults()`)
  - `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/RankingTable.svelte`
- **Dependencies**: T6, T7
- **Complexity**: M

> **Note:** T9 and T10 both modify `helpers.ts` (different functions). If running in parallel,
> coordinate to avoid merge conflicts. T9 modifies `buildRankingFromResults()`, T10 modifies
> `buildComparisonResult()`.

**Requirements:**

**helpers.ts change — add optional `overrides` param to `buildRankingFromResults()`:**

- Add `overrides: ScoreOverrideMap = {}` as 4th parameter (optional with default)
- When overrides has keys: replace `profileAScore.totalScore` with
  `computeOverriddenTotal(profileAScore.contributions, overrides)`
- Recompute `thresholdState` via `resolveThresholdWithOverrides()` instead of
  `resolveScoreThresholdState()`
- Existing callers without the param continue to work (default empty map = no change)
- The parent `+page.svelte` reactive declaration becomes:

  ```typescript
  $: rankedReleases = batchSimulationResult
    ? buildRankingFromResults(
        batchSimulationResult.results,
        batchSelectedProfileName,
        comparisonProfileName,
        scoreOverrides // new optional param
      )
    : ([] as RankedRelease[]);
  ```

**RankingTable.svelte change — visual override indicator:**

New prop:

```typescript
export let overrides: ScoreOverrideMap = {};
```

RankingTable receives already-override-adjusted `rankedReleases` from parent. The `overrides` prop
is only for visual indicator display:

- When `Object.keys(overrides).length > 0`, show a small badge: "Ranked with N overrides"
- Overridden score columns show amber tint

---

#### Task T10: Wire overrides into ComparisonView

- **Action**: Modify
- **Files**:
  - `packages/praxrr-app/src/routes/score-simulator/[databaseId]/helpers.ts` (modify
    `buildComparisonResult()`)
  - `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ComparisonView.svelte`
- **Dependencies**: T6, T7
- **Complexity**: S

> **Note:** See T9 note about parallel helpers.ts modification.

**Requirements:**

**helpers.ts change — add optional `overrides` param to `buildComparisonResult()`:**

- Add `overrides: ScoreOverrideMap = {}` as 4th parameter (optional with default)
- When overrides has keys: apply overrides to Profile A contributions before computing deltas.
  Profile B stays at baseline.
- Existing callers without the param continue to work
- Parent reactive declaration becomes:

  ```typescript
  $: comparisonResult = buildComparisonResult(
    singleSimulationResult?.results?.[0],
    selectedProfileName,
    comparisonProfileName,
    scoreOverrides // new optional param
  );
  ```

**ComparisonView.svelte change:**

New prop:

```typescript
export let overrides: ScoreOverrideMap = {};
```

Visual changes:

- Profile A column: overridden contribution scores show amber indicator + original value annotation
- Profile B column: unchanged (baseline)
- Delta column: uses overridden A vs baseline B

---

### Batch 5 — Unit Tests (2 parallel tasks)

---

#### Task T11: Unit tests for what-if helper functions

- **Action**: Create
- **File**: `packages/praxrr-app/src/tests/routes/scoreSimulatorPhase3Helpers.test.ts`
- **Dependencies**: T6
- **Complexity**: M

**Requirements:**

Follow patterns from `scoreSimulatorHelpers.test.ts` and `scoreSimulatorPhase2Helpers.test.ts`:

```typescript
import { assertEquals, assertNotEquals } from '@std/assert';
import type {
  SimulateProfileScore,
  SimulateScoreContribution,
} from '$api/v1.d.ts';
```

Test cases for `applyScoreOverrides()`:

- Empty overrides returns contributions unchanged (no `originalScore` on any item)
- Single override replaces matching CF score, adds `originalScore`
- Multiple overrides replace all matching CFs
- Override for non-existent CF name is silently ignored
- Negative score override works correctly
- Override value equal to original score: no `originalScore` annotation
- Does not mutate input array (verify original array unchanged)
- Empty contributions array returns empty array

Test cases for `computeOverriddenTotal()`:

- No overrides: returns same sum as original contributions
- Partial overrides: correct sum with mix of original and overridden
- All contributions overridden: sum of all override values
- Empty contributions: returns 0
- Negative override values: correctly subtracted

Test cases for `resolveThresholdWithOverrides()`:

- Override pushes total from below minimum -> accepted
- Override pushes total from accepted -> upgrade-reached
- Override pushes total from upgrade-reached -> below (negative override)
- Null profileScore returns null
- Empty overrides returns same as `resolveScoreThresholdState()`
- Zero minimumScore edge case
- Zero upgradeUntilScore edge case

---

#### Task T12: Unit tests for URL state serialization

- **Action**: Create
- **File**: `packages/praxrr-app/src/tests/routes/scoreSimulatorUrlState.test.ts`
- **Dependencies**: T3
- **Complexity**: M

**Requirements:**

Test cases for `parseUrlState()`:

- Empty URLSearchParams returns all-undefined state
- Simple params (title, mediaType, profile, arrType) parsed correctly
- `mediaType` validation: `'movie'` and `'series'` accepted, invalid values skipped
- `arrType` validation: `'radarr'` and `'sonarr'` accepted, `'lidarr'` rejected (returns undefined)
- `batch` param: valid base64 JSON array decoded correctly
- `batch` param: malformed base64 returns undefined
- `batch` param: valid base64 but invalid JSON returns undefined
- `overrides` param: valid base64 JSON object decoded, values rounded to integers
- `overrides` param: non-finite values (NaN, Infinity) filtered out
- `overrides` param: malformed base64 returns undefined
- Empty string params treated as absent
- Unknown params silently ignored

Test cases for `serializeUrlState()`:

- Full state serializes all fields
- Partial state omits undefined/empty fields
- `batch` encoded as base64 JSON
- `overrides` encoded as base64 JSON
- Empty overrides object not serialized

Round-trip tests:

- `parseUrlState(serializeUrlState(fullState))` equals original state
- Profile names with spaces round-trip correctly
- Profile names with colons round-trip correctly
- Unicode characters round-trip correctly

Test cases for URL truncation (in `copyShareLink` context, if testable):

- State producing URL > 2000 chars: overrides dropped first
- Still > 2000 chars: batch dropped too

---

### Batch 6 — E2E Tests (1 task, sequential)

---

#### Task T13: E2E tests for Phase 3 workflows

- **Action**: Create
- **Files**:
  - `packages/praxrr-app/src/tests/e2e/specs/4.1-score-simulator-deep-link.spec.ts`
  - `packages/praxrr-app/src/tests/e2e/specs/4.2-score-simulator-what-if.spec.ts`
  - `packages/praxrr-app/src/tests/e2e/specs/4.3-score-simulator-url-state.spec.ts`
- **Dependencies**: All Batches 1-5 complete
- **Complexity**: L

**Requirements:**

`4.1-score-simulator-deep-link.spec.ts`:

- Navigate to a QP scoring page
- Verify "Simulate" button is visible in the StickyCard header
- Click the button
- Verify navigation to `/score-simulator/{databaseId}` with correct URL params
- Verify profile dropdown has the correct profile pre-selected
- Verify arrType defaults to radarr
- Test with profile name containing spaces (encoding verification)

`4.2-score-simulator-what-if.spec.ts`:

- Run a simulation with a known release title
- Locate a CF contribution row in ScoreBreakdown
- Click the score to activate inline editing
- Enter an override value
- Verify: amber indicator appears, original value shown as strikethrough, delta displayed
- Verify: total score recalculates correctly
- Verify: threshold badge updates if boundary crossed
- Click per-CF reset icon, verify restoration
- Enter multiple overrides, click "Reset All", verify all restored
- In batch mode: verify ranking table re-sorts with overridden totals
- Handle parser-unavailable: test should work with or without parser

`4.3-score-simulator-url-state.spec.ts`:

- Configure simulator: enter title, select profile, apply an override
- Click "Copy Link" button
- Verify success toast appears
- Open the copied URL in a new browser context
- Verify: title, profile selection, and overrides are all restored
- Test with batch mode state in URL
- Test with URL containing non-existent profile: verify warning and dropdown behavior

**Patterns:** Follow existing E2E specs in `tests/e2e/specs/`. Use Playwright `test.describe()`
blocks, `page.goto()`, `page.locator()`, `expect()` assertions.

---

### Batch 7 — User-First UX Hardening (4 tasks)

These tasks close adoption gaps for normal users and are required for Phase 3 completion.

---

#### Task T15: Add plain-language decision summary in ScoreBreakdown

- **Action**: Modify
- **Files**:
  - `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ScoreBreakdown.svelte`
  - `packages/praxrr-app/src/routes/score-simulator/[databaseId]/helpers.ts`
- **Dependencies**: T6, T8
- **Complexity**: M

**Requirements:**

- Add a summary card above the contribution list that translates threshold state into user-facing
  language:
  - `below` -> "This release would not be grabbed."
  - `accepted` -> "This release is eligible to grab."
  - `upgrade-reached` -> "This release meets your upgrade target."
- Card must include:
  - current total score
  - minimum required score
  - remaining gap to minimum or upgrade-until score (if applicable)
- Summary must reflect overridden totals when what-if overrides are active
- Do not remove advanced details; this is an additive quick-understanding layer

---

#### Task T16: Add first-run quick-start and empty-state guidance

- **Action**: Modify
- **Files**:
  - `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte`
  - `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ReleaseInput.svelte`
- **Dependencies**: T4, T7
- **Complexity**: M

**Requirements:**

- When no profile/title is selected and no result exists, show a "Start in 3 steps" panel:
  1. Choose profile
  2. Paste release title
  3. Run simulation
- Add one-click "Try example release" action that reuses existing preset infrastructure
- Include one plain-language note: "Simulation changes are temporary until you save on the scoring
  page."
- Keep this panel hidden once users have entered input or loaded results

---

#### Task T17: Add share-safe link action and beginner terminology polish

- **Action**: Modify
- **Files**:
  - `packages/praxrr-app/src/routes/score-simulator/[databaseId]/urlState.ts`
  - `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte`
  - `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ReleaseInput.svelte`
- **Dependencies**: T3, T7
- **Complexity**: M

**Requirements:**

- Extend sharing to two actions:
  - "Copy Full Link" (existing behavior)
  - "Copy Safe Link" (omits `title` and `batch`, preserves profile, arrType, compare, overrides)
- Use explicit action labels in UI; avoid ambiguous single "Copy Link" text
- Ensure both actions reuse truncation handling and clipboard fallback patterns from
  `copyShareLink()`
- Replace developer-heavy labels in visible UI copy:
  - "App type" for Radarr/Sonarr selector label
  - "What-if changes" for override summary text

---

#### Task T18: Add UX-focused E2E coverage (mobile + first-run + share safety)

- **Action**: Create
- **File**: `packages/praxrr-app/src/tests/e2e/specs/4.4-score-simulator-ux-basics.spec.ts`
- **Dependencies**: T13, T15, T16, T17
- **Complexity**: M

**Requirements:**

- First-run flow:
  - open simulator with no params
  - verify quick-start panel appears with 3 steps
  - click "Try example release" and verify input/result state updates
- Decision summary:
  - run simulation and verify plain-language outcome text appears
  - apply override and verify decision summary updates with overridden total
- Share safety:
  - generate full and safe links
  - verify safe link does not include title/batch params
- Mobile ergonomics:
  - run test at narrow viewport (e.g., 390x844)
  - verify edit and reset controls are visible and usable without horizontal scrolling

---

## Validation Checklist

### Must-Fix Items (from analysis-validation.md + Phase 4 validation)

- [ ] Profile name availability: scoring page server load returns `profileName` (T0)
- [ ] NumberInput blur-clear handling: override handler detects undefined and treats as reset (T8)
- [ ] Double-encoding prevention: SimulateButton uses URLSearchParams API (T1)
- [ ] Override-aware ranking: `buildRankingFromResults()` accepts optional overrides param (T9)
- [ ] Override-aware comparison: `buildComparisonResult()` accepts optional overrides param (T10)
- [ ] Override same-as-original: no amber indicator when override equals original (T8)
- [ ] Float enforcement: round override values to integers in handler (T7, T8)
- [ ] arrType=lidarr rejection: URL parser filters to radarr/sonarr only (T3)
- [ ] localStorage vs URL precedence: URL params checked first on mount (T4)
- [ ] `ScoreOverrideMap` canonical location: defined in `helpers.ts` (T6), imported in `urlState.ts`
      (T3)
- [ ] `$page` store import: add to simulator `+page.svelte` if not already present (T4)
- [ ] Decision summary provides plain-language outcome + score gap math (T15)
- [ ] First-run quick-start only appears when simulator is empty (T16)
- [ ] "Copy Safe Link" excludes title and batch params (T17)
- [ ] Mobile viewport (390x844) supports override edit/reset without layout break (T18)

### Integration Risks

- [ ] onMount URL state reading happens BEFORE localStorage fallback (T4)
- [ ] Override map persists across re-simulation; non-matching CFs silently ignored (T7)
- [ ] ComparisonView uses overridden Profile A vs baseline Profile B (T10)
- [ ] Clipboard fallback follows InstanceForm.svelte pattern (T3)
- [ ] API response is never mutated; overrides applied to copies (T6, T9, T10)
- [ ] T9 and T10 both modify helpers.ts — coordinate if parallel to avoid merge conflicts
- [ ] Decision summary wording remains consistent with threshold state mapping (T15)
- [ ] Quick-start panel does not compete with loaded-result UI hierarchy (T16)
- [ ] Full/safe share actions avoid duplicated serialization logic drift (T17)

---

## Validation Notes

This plan was validated by 3 independent agents (completeness, dependency ordering, feasibility).

**Fixes applied from validation:**

1. Added T0 (scoring page server load) — `data.scoring.name` doesn't exist; `QualityProfileScoring`
   has no `name` field
2. Fixed critical path: was `T6→T8→T7→T13` (wrong order, wrong chain), now `T3→T4→T7→T8→T15→T18` (6
   tasks with UX gate)
3. Merged T5 into T7 — both modify `+page.svelte`, T7 updates `handleCopyLink` that T5 creates
4. Made T9/T10 explicitly list `helpers.ts` as modified file with parallel conflict note
5. Consolidated `ScoreOverrideMap` to canonical location in `helpers.ts`
6. Removed vestigial batch drift and normalized to 7 effective batches with explicit UX hardening
   batch
7. Fixed `copyShareLink` return type to `{ success, truncated }` (shared.md says `boolean` — plan
   version is correct)
8. Added explicit user-first completion tasks: decision summary, quick-start onboarding, safe link
   sharing, and mobile UX E2E coverage

---

## Summary

| Metric               | Value                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Total tasks          | 19 (T0-T4, T6-T18; T5 merged into T7)                                                                                         |
| Parallel batches     | 7                                                                                                                             |
| Max parallelism      | 5 (Batch 1)                                                                                                                   |
| Critical path length | 6 tasks (T3→T4→T7→T8→T15→T18)                                                                                                 |
| New files            | 6 (urlState.ts, SimulateButton.svelte, 4 test files)                                                                          |
| Modified files       | 9 (scoring +page.server.ts, helpers.ts, +page.svelte x2, ScoreBreakdown, ReleaseInput, RankingTable, ComparisonView, test.ts) |
| API changes          | 0                                                                                                                             |
| New dependencies     | 0                                                                                                                             |
| Database changes     | 0                                                                                                                             |

### Next Step

Run `implement-plan` with this plan to deploy implementor agents in dependency-resolved batches.
