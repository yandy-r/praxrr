# Task Decomposition: Score Simulator Phase 2

## Batch Overview

| Batch | Description               | Tasks    | Parallelism |
| ----- | ------------------------- | -------- | ----------- |
| 0     | Foundation (types, data)  | T1, T2   | 2           |
| 1     | Independent UI components | T3-T7    | 5           |
| 2     | Integration               | T8, T9   | Sequential  |
| 3     | Tests + polish            | T10, T11 | 2           |

## Dependency Graph

```
Batch 0:  T1 (helpers)  |  T2 (presets)
             |               |
Batch 1:  T3 (BatchInput) | T4 (PresetSelector) | T5 (ProfileComparison) | T6 (ComparisonView) | T7 (RankingTable)
             |               |                      |                        |                      |
Batch 2:  T8 (SimulationResults mod) → T9 (+page.svelte integration)
                                          |
Batch 3:  T10 (tests)  |  T11 (polish)
```

## Task Specifications

### T1 -- Extend helpers.ts (Size: M)

**File:** `ROUTE/helpers.ts` (modify) **Scope:** Add types + functions

1. Export types: `BatchInputState`, `ComparisonState`, `ProfileScoreDelta`, `ComparisonResult`,
   `RankedRelease`, `PresetCategory`, `PresetGroup`
2. `parseBatchTitles(rawText, mediaType)` -- split, trim, dedupe, cap at 50, assign IDs
3. `buildRankingFromResults(results, profileName)` -- rank by score desc, tiebreak
4. `buildComparisonResult(releaseResult, profileAName, profileBName)` -- per-CF delta

**Acceptance:** No `any` types, handles edge cases, all types exported

### T2 -- Create presets.ts (Size: S)

**File:** `ROUTE/presets.ts` (new) **Scope:** Static preset data

1. Export `PresetGroup[]` with 3+ movie groups, 3+ series groups
2. Realistic release titles following scene/P2P conventions
3. `getPresetsForCategory()` filter helper

**Acceptance:** Types from helpers.ts, zero runtime dependencies

### T3 -- Create BatchInput.svelte (Size: M)

**File:** `ROUTE/components/BatchInput.svelte` (new) **Scope:** Multi-line batch input

1. Textarea with live line counter ("12 / 50 titles")
2. Validation: warn >50, empty lines excluded
3. Explicit "Simulate All" button (not debounced)
4. `Ctrl+Enter` shortcut
5. Events: `batchChange`, `titlesChange`

**Acceptance:** aria-live on counter, card styling matches ReleaseInput

### T4 -- Create PresetSelector.svelte (Size: S)

**File:** `ROUTE/components/PresetSelector.svelte` (new) **Scope:** Categorized preset dropdown

1. "Try Examples" button with Dropdown/DropdownItem
2. Filter by current mediaType
3. Group headers with descriptions
4. Dispatch `presetSelected` with titles

**Acceptance:** Keyboard accessible, closes on select

### T5 -- Create ProfileComparison.svelte (Size: S)

**File:** `ROUTE/components/ProfileComparison.svelte` (new) **Scope:** Second profile selector

1. "Compare With" dropdown
2. Exclude primary profile from options
3. Clear comparison button
4. Dispatch `comparisonProfileChange`

**Acceptance:** Disabled when no primary, prevents self-comparison

### T6 -- Create ComparisonView.svelte (Size: M)

**File:** `ROUTE/components/ComparisonView.svelte` (new) **Scope:** Side-by-side score comparison

1. Two columns: Profile A | Profile B (stacked on mobile)
2. Delta summary bar with sign-colored display
3. Per-CF rows sorted by absolute delta magnitude
4. Threshold badge per profile

**Acceptance:** Color never sole indicator, aria-live on delta, mobile tab switching

### T7 -- Create RankingTable.svelte (Size: L)

**File:** `ROUTE/components/RankingTable.svelte` (new) **Scope:** Sorted multi-release ranking

1. Wrap ExpandableTable with ranking columns
2. Columns: Rank, Title, Score, Matched CFs, Threshold
3. Comparison mode: add Profile B Score + Delta columns
4. Expanded rows delegate to SimulationResults
5. Progressive loading (pageSize 20)

**Acceptance:** aria-sort on headers, aria-expanded on rows, responsive cards

### T8 -- Modify SimulationResults.svelte (Size: S)

**File:** `ROUTE/components/SimulationResults.svelte` (modify) **Scope:** Remove hardcoded
results[0]

1. Add `releaseId: string | null = null` prop
2. Find matching result by ID, fallback to `[0]`

**Acceptance:** Zero regression for Phase 1, graceful null handling

### T9 -- Integrate into +page.svelte (Size: L)

**File:** `ROUTE/+page.svelte` (modify) **Scope:** Orchestrator wiring

1. Import all new components
2. Add state: batchRawText, comparisonProfileName, selectedReleaseId
3. Reactive declarations for ranking, comparison
4. Modify simulate() for batch vs single mode
5. DisclosureSection with SS_ADVANCED_OPTIONS
6. Conditional rendering: single vs batch, comparison toggle
7. New localStorage keys (separate from Phase 1)
8. Event handlers for all new components

**Acceptance:** Phase 1 works unchanged, batch/comparison functional, no any types

### T10 -- Unit Tests (Size: M)

**File:** `ROUTE/helpers.test.ts` (new) **Scope:** Test new helper functions

1. `parseBatchTitles`: empty, single, multi, dedup, cap, whitespace
2. `buildRankingFromResults`: ordering, ties, missing profile
3. `buildComparisonResult`: deltas, null profiles, disjoint CFs

**Acceptance:** All pass with `deno task test`, edge cases covered

### T11 -- Accessibility + Responsive Polish (Size: S)

**Scope:** Cross-component audit

1. Verify aria-live, aria-sort, aria-expanded
2. Keyboard navigation flow
3. Mobile breakpoint (767px) behavior
4. Color not sole indicator (WCAG 1.4.1)

**Acceptance:** No horizontal overflow on mobile, logical tab order
