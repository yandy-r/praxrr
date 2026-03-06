# Parallel Implementation Plan: Score Simulator Phase 2

> Generated: 2026-03-05 | Feature: score-simulator-phase2 References: [shared.md](./shared.md) |
> [feature-spec.md](./feature-spec.md)

## Overview

Extend the Score Simulator MVP with batch release input (up to 50 titles), side-by-side profile
comparison, curated example presets, ranked results table, and progressive disclosure. Entirely
client-side UI work over the existing API contract — no backend changes.

**Estimated total: 890-1,260 new/changed lines across 11 tasks in 4 batches.**

---

## Decision Points

> Contradictions between shared.md and feature-spec.md identified during validation. Resolve before
> implementation.

| #   | Topic                         | shared.md / Plan                     | feature-spec.md                                                     | Recommendation                                                                                         |
| --- | ----------------------------- | ------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| D1  | **Duplicate titles in batch** | `parseBatchTitles` deduplicates      | Line 128: "Warn but allow; duplicates flagged in ranking"           | Follow feature-spec: keep duplicates, flag visually                                                    |
| D2  | **Self-comparison**           | T5 filters primary from dropdown     | Line 127: "Allow for verification"                                  | Follow feature-spec: allow same profile, show identical columns                                        |
| D3  | **Batch text storage**        | `localStorage` keys                  | Line 408: `sessionStorage` (batch text too large for cross-session) | Follow feature-spec: use `sessionStorage` for `batchText`, keep `localStorage` for `comparisonProfile` |
| D4  | **Preset in basic mode**      | PresetSelector only in advanced slot | Line 509: "Compact 'Try Examples' button in basic mode"             | Add compact preset trigger near ReleaseInput in basic mode                                             |
| D5  | **Batch progress indicator**  | Loader2 spinner only                 | Line 373: "Simulating 5 of 12..." determinate progress              | Add progress counter to BatchInput during simulation                                                   |
| D6  | **Skeleton rows**             | Empty state only                     | Line 374: "Pulsing placeholder rows while pending"                  | Add skeleton loading state to RankingTable                                                             |

---

## Batch 0: Foundation (Sequential: T1 then T2)

> Types and static data that all subsequent batches depend on. T2 imports types from T1, so these
> run sequentially.

### T1: Extend `helpers.ts` with Phase 2 Types and Functions

- **Size:** M | **Complexity:** Medium | **Risk:** Medium
- **File:** `packages/praxrr-app/src/routes/score-simulator/[databaseId]/helpers.ts` (modify)
- **Depends on:** None (existing `$api/v1.d.ts` types only)
- **Blocks:** T2, T3, T4, T5, T6, T7, T8, T9, T10

**Scope:**

1. Add type exports:
   - `BatchInputState` — `{ rawText: string; titles: string[]; active: boolean }`
   - `ComparisonState` — `{ comparisonProfileName: string | null; showDeltas: boolean }`
   - `ProfileScoreDelta` — `{ cfName: string; scoreA: number; scoreB: number; delta: number }`
   - `ComparisonResult` —
     `{ profileAName, profileBName, profileATotal, profileBTotal, totalDelta, contributions: ProfileScoreDelta[] }`
   - `RankedRelease` —
     `{ id, title, rank, totalScore, thresholdState, matchedCfCount, totalCfCount, parsed, comparisonScore?, comparisonRank?, scoreDelta? }`
   - `PresetCategory` — `'movie' | 'series'`
   - `PresetGroup` —
     `{ category, label, description, titles: Array<{ label: string; title: string }> }`

2. Add `MediaType` import from `$api/v1.d.ts` (not currently imported in helpers.ts)

3. Implement functions:
   - `parseBatchTitles(rawText: string, mediaType: MediaType): SimulateReleaseInput[]`
     - Split by newline, trim, skip empty/whitespace-only, reject >500 chars, cap at 50
     - **Keep duplicates** with visual flagging (see D1) — do NOT deduplicate
     - Assign unique IDs via `crypto.randomUUID()` with fallback
   - `buildRankingFromResults(results: SimulateReleaseResult[], profileName: string): RankedRelease[]`
     - Sort descending by score, tiebreak: matchedCfCount desc then title alpha
     - Assign rank 1-indexed, resolve thresholdState via existing `resolveScoreThresholdState`
     - Return empty array when `profileName` not found in any result's `profileScores`
     - Handle zero-score-all-tied: do not hide results, assign tied ranks
   - `buildComparisonResult(releaseResult: SimulateReleaseResult, profileAName: string, profileBName: string): ComparisonResult | null`
     - Return null if either profile missing from `profileScores[]`
     - Build per-CF delta array (union of CFs from both profiles; missing CF = score 0)
     - Compute total delta

**Acceptance criteria:**

- [ ] All types exported, no `any`
- [ ] `parseBatchTitles`: empty -> [], whitespace skipped, >500 char rejected, 50 cap, unique IDs,
      duplicates preserved
- [ ] `buildRankingFromResults`: correct descending sort with tiebreaking, rank from 1, empty array
      on missing profile
- [ ] `buildRankingFromResults`: zero-score results not hidden, all-tied ranks handled
- [ ] `buildComparisonResult`: null when profile missing, correct delta (B - A), CFs from union of
      both profiles

**Patterns:** Existing helper signatures, `SimulateReleaseInput` type, `ScoreThresholdState` reuse

---

### T2: Create `presets.ts` Static Preset Data

- **Size:** S | **Complexity:** Low | **Risk:** Low
- **File:** `packages/praxrr-app/src/routes/score-simulator/[databaseId]/presets.ts` (new)
- **Depends on:** T1 (types `PresetGroup`, `PresetCategory`)
- **Blocks:** T3, T4

**Scope:**

1. Export `PresetGroup[]` constant with:
   - Movie presets (3-4 groups): "4K Remux vs Web-DL", "HDR Formats", "Audio Codecs"
   - Series presets (3-4 groups): "Web-DL Quality Ladder", "Season Packs vs Singles", "Anime
     Releases"
2. Each group: 3-8 realistic release titles following scene/P2P naming conventions
3. Export `getPresetsForCategory(category: PresetCategory): PresetGroup[]` filter helper

**Acceptance criteria:**

- [ ] At least 3 movie groups and 3 series groups
- [ ] Realistic release titles following actual naming conventions
- [ ] Types imported from `helpers.ts` — no inline re-declarations
- [ ] Zero runtime dependencies (pure data + filter)

---

## Batch 1: Independent Components (Parallel: 6 tasks)

> Each task creates or modifies a single component. Depend on Batch 0 types but not on each other.
> T8 moved here from Batch 2 — it has no Batch 1 dependencies and touches a unique file.

### T3: Create `BatchInput.svelte`

- **Size:** M | **Complexity:** Medium | **Risk:** Medium
- **File:**
  `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/BatchInput.svelte` (new)
- **Depends on:** T1, T2
- **Blocks:** T9

**Scope:**

1. Multi-line textarea (one title per line) with live line counter ("12 / 50 titles")
2. Validation display: warn on lines >500 chars, flag duplicate lines visually
3. "Simulate All" button — explicit submit (not debounced), disabled when empty or `isSimulating`
4. Progress counter during simulation: "Simulating..." with Loader2 spinner (see D5)
5. `Ctrl+Enter` keyboard shortcut to trigger simulate
6. Props: `rawText: string` (bind), `isSimulating: boolean`, `parserAvailable: boolean`
7. Events: `dispatch('batchSimulate', { titles })`, `dispatch('titlesChange', { rawText })`

**Acceptance criteria:**

- [ ] Line counter updates reactively, excludes empty/whitespace lines
- [ ] Counter turns warning (text-amber) when >50 valid lines
- [ ] Duplicate lines flagged with visual indicator (e.g., subtle highlight or icon)
- [ ] "Simulate All" uses Loader2 spinner pattern from `ReleaseInput.svelte`
- [ ] `Ctrl+Enter` triggers simulate when textarea focused
- [ ] `aria-live="polite"` on line counter
- [ ] Card styling: `rounded-lg border bg-white dark:bg-neutral-900` wrapper matching ReleaseInput
- [ ] Shows "Parser unavailable" warning when `parserAvailable` is false

**Patterns:** Event dispatch, alert store, card styling from ReleaseInput

---

### T4: Create `PresetSelector.svelte`

- **Size:** S | **Complexity:** Low | **Risk:** Low
- **File:**
  `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/PresetSelector.svelte`
  (new)
- **Depends on:** T1, T2
- **Blocks:** T9

**Scope:**

1. "Try Examples" button that opens categorized dropdown
2. Supports two render modes: compact (icon-only button for basic mode) and full (labeled button for
   advanced mode) via `compact` prop
3. Filter presets by current `mediaType` (movie/series)
4. Group headers (non-clickable) with group description as subtitle
5. Clicking a preset dispatches event with titles, category, and mediaType
6. Uses `Dropdown`/`DropdownItem` from `$ui/dropdown/` and `clickOutside`
7. Props: `mediaType: MediaType`, `compact: boolean = false`

**Acceptance criteria:**

- [ ] Shows only presets matching current `mediaType`
- [ ] Group labels as non-interactive headers with description
- [ ] Selecting preset closes dropdown, dispatches `{ titles: string[], category, mediaType }`
- [ ] Compact mode renders icon-only button suitable for basic mode placement (see D4)
- [ ] Keyboard accessible (Escape closes, arrow keys navigate)

**Patterns:** `Dropdown`/`DropdownItem` usage, `clickOutside` from ReleaseInput

---

### T5: Create `ProfileComparison.svelte`

- **Size:** S | **Complexity:** Medium | **Risk:** Medium
- **File:**
  `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ProfileComparison.svelte`
  (new)
- **Depends on:** T1
- **Blocks:** T9

**Scope:**

1. "Compare With" second profile dropdown
2. Show all profiles including the primary (self-comparison allowed for verification — see D2)
3. "Clear comparison" button to deselect
4. Dispatch `comparisonProfileChange` event with `{ profileName: string | null }`
5. Props: `qualityProfiles`, `primaryProfileName`, `comparisonProfileName` (bind), `disabled`
6. Disabled state when no primary profile selected

**Acceptance criteria:**

- [ ] All profiles shown in dropdown (self-comparison allowed per D2)
- [ ] Clear button sets comparison to null
- [ ] Disabled when no primary profile
- [ ] Same dropdown styling as ReleaseInput quality profile selector
- [ ] When primary changes, comparison selection preserved (unless the comparison profile was
      removed from available profiles)

**Patterns:** Profile dropdown from ReleaseInput, event dispatch

---

### T6: Create `ComparisonView.svelte`

- **Size:** M | **Complexity:** Medium-High | **Risk:** Medium
- **File:**
  `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ComparisonView.svelte`
  (new)
- **Depends on:** T1
- **Blocks:** T9

**Scope:**

1. Side-by-side layout: two columns (Profile A | Profile B) on desktop, tabbed on mobile
2. Header: profile name + total score for each
3. Delta summary bar: total delta with sign-colored display (use `Score.svelte` with `showSign`)
4. Per-CF contribution rows: aligned by CF name, show score A, score B, delta
5. Rows where `delta !== 0` get subtle accent highlight (`border-l-2 border-accent-500`)
6. Threshold badge per profile via `resolveScoreThresholdState`
7. Props: `comparisonResult: ComparisonResult | null`, `profileALabel`, `profileBLabel`
8. Mobile: responsive pattern using `matchMedia('(max-width: 767px)')` switches to tabbed view

**Acceptance criteria:**

- [ ] Nothing rendered when `comparisonResult` is null
- [ ] Positive deltas: `text-emerald-600 dark:text-emerald-400` with `+` prefix
- [ ] Negative deltas: `text-red-600 dark:text-red-400`
- [ ] Zero deltas: `text-neutral-500`
- [ ] Sign prefix + color together (WCAG 1.4.1 — color not sole indicator)
- [ ] CF rows sorted by absolute delta magnitude (largest first)
- [ ] Mobile tab switching at 767px via `matchMedia` responsive pattern
- [ ] Uses `Score`, `CustomFormatBadge`, `Badge` consistently with ScoreBreakdown
- [ ] `aria-live="polite"` on delta summary

**Patterns:** Score display colors, badge variants, responsive pattern from shared.md

---

### T7: Create `RankingTable.svelte`

- **Size:** L | **Complexity:** High | **Risk:** High
- **File:**
  `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/RankingTable.svelte` (new)
- **Depends on:** T1
- **Blocks:** T9

**Scope:**

1. Wrap `ExpandableTable` with ranking-specific column definitions
2. Base columns: Rank (#), Release Title (truncated+tooltip), Total Score (sortable), Matched CFs
   (sortable), Threshold (badge)
3. Comparison mode: add Profile B Score column, Delta column
4. Expanded row content: delegate to `SimulationResults` for full CF detail (pass `releaseId`)
5. Progressive loading via `pageSize: 20`
6. Skeleton loading state: pulsing placeholder rows when `isSimulating` and no results yet (see D6)
7. Props: `rankedReleases: RankedRelease[]`, `comparisonActive: boolean`,
   `selectedReleaseId: string | null`, `isSimulating: boolean`, plus sub-props for expanded content
   (`simulationResult`, `selectedProfileName`, `selectedProfileLabel`)
8. Events: `dispatch('releaseSelect', { id })`
9. Empty state: "Run a batch simulation to see ranked results"

**Acceptance criteria:**

- [ ] Default sort: rank ascending (score descending)
- [ ] Comparison columns appear only when `comparisonActive`
- [ ] `aria-sort` on sortable column headers
- [ ] `aria-expanded` on expandable rows
- [ ] `aria-live="polite"` on results container for batch result announcements
- [ ] Threshold badges: correct variants per `ScoreThresholdState` (`danger`/`success`/`warning`)
- [ ] Title truncated with CSS `truncate` + native `title` attribute tooltip
- [ ] Responsive card layout on mobile via `ExpandableTable` `responsive` prop
- [ ] Skeleton rows when `isSimulating` and `rankedReleases` empty
- [ ] Empty state message when not simulating and no results
- [ ] Zero-score results shown (not hidden)

**Patterns:** Table column definition, ExpandableTable props, `RankedRelease` type, badge variants

---

### T8: Modify `SimulationResults.svelte` for Multi-Release Support

- **Size:** S | **Complexity:** Low-Medium | **Risk:** Low
- **File:**
  `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/SimulationResults.svelte`
  (modify)
- **Depends on:** None (independent change)
- **Blocks:** T9

**Scope:**

1. Add new prop: `releaseId: string | null = null`
2. Change line 49 from `$: releaseResult = result?.results?.[0] ?? null` to:
   ```typescript
   $: releaseResult = releaseId
     ? (result?.results?.find((r) => r.id === releaseId) ?? null)
     : (result?.results?.[0] ?? null);
   ```
3. No other changes — rest of component works with any `releaseResult`

**Acceptance criteria:**

- [ ] When `releaseId` is null/omitted: identical to Phase 1 (uses `results[0]`)
- [ ] When `releaseId` provided: finds matching result by `id`
- [ ] When `releaseId` provided but no match: treats as null
- [ ] Zero visual/behavioral regression for Phase 1

---

## Batch 2: Integration (Sequential: 1 task)

> Wire everything together. Depends on all Batch 0 and Batch 1 tasks.

### T9: Integrate Phase 2 into `+page.svelte` Orchestrator

- **Size:** L | **Complexity:** High | **Risk:** High
- **File:** `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte` (modify)
- **Depends on:** T1-T8 (all previous tasks)
- **Blocks:** T10, T11

**Scope:**

1. **Imports:** BatchInput, PresetSelector, ProfileComparison, ComparisonView, RankingTable,
   DisclosureSection (`$ui/form/DisclosureSection.svelte`), `SS_ADVANCED_OPTIONS`
   (`$shared/disclosure/sectionKeys.ts`), new helpers/types

2. **State variables** (flat reactive, matching Phase 1):

   ```typescript
   let batchRawText = '';
   let comparisonProfileName: string | null = null;
   let selectedReleaseId: string | null = null;
   ```

3. **Reactive declarations:**

   ```typescript
   $: batchTitles = parseBatchTitles(batchRawText, mediaType);
   $: batchActive = batchTitles.length > 1;
   $: comparisonProfileLabel = /* lookup from qualityProfileOptions */;
   $: rankedReleases = batchActive && simulationResult
     ? buildRankingFromResults(simulationResult.results, selectedProfileName)
     : [];
   $: comparisonResult = comparisonProfileName && simulationResult?.results?.[0]
     ? buildComparisonResult(simulationResult.results[0], selectedProfileName, comparisonProfileName)
     : null;
   $: profileNames = [selectedProfileName, comparisonProfileName].filter(Boolean);
   ```

4. **Modify `simulate()` function:**
   - Batch mode: `releases = parseBatchTitles(batchRawText, mediaType)`
   - Single mode: existing single-release behavior
   - Always send `profileNames` array (1 or 2)
   - Extend `simulationRequestToken` pattern (works for both modes)

5. **Event handlers:** `handleBatchSimulate`, `handlePresetSelected`,
   `handleComparisonProfileChange`, `handleReleaseSelect`

6. **Layout with DisclosureSection:**

   ```svelte
   <DisclosureSection sectionKey={SS_ADVANCED_OPTIONS} initialMode="basic">
     <!-- Basic: ReleaseInput + PresetSelector(compact) + ScoreBreakdown/ComparisonView -->
     <svelte:fragment slot="advanced">
       <!-- Advanced: BatchInput, PresetSelector(full), ProfileComparison -->
     </svelte:fragment>
   </DisclosureSection>
   ```

7. **Conditional rendering:**
   - Single-release: existing SimulationResults
   - Batch mode: RankingTable (SimulationResults in expanded rows via `releaseId`)
   - Comparison: ComparisonView alongside/replacing ScoreBreakdown
   - Basic mode: compact "Try Examples" button near ReleaseInput (see D4)

8. **Persistence:**
   - `sessionStorage` for `scoreSimulator.batchText` (see D3 — batch text too large for
     cross-session)
   - `localStorage` for `scoreSimulator.comparisonProfile` (small, useful cross-session)
   - Phase 1 keys untouched: `scoreSimulator.lastTitle`, `scoreSimulator.lastProfileName`

9. **Lossless round-trip:** Keep batch/comparison data in memory when collapsing advanced mode —
   state preserved on collapse/expand cycle

**Acceptance criteria:**

- [ ] Phase 1 single-release flow works identically when advanced collapsed
- [ ] Expanding advanced reveals BatchInput, PresetSelector, ProfileComparison
- [ ] Compact "Try Examples" button visible in basic mode near ReleaseInput
- [ ] Batch simulate sends all titles in single API call
- [ ] Comparison sends 2 profileNames in single API call
- [ ] RankingTable appears when batch has >1 result
- [ ] ComparisonView appears when comparison profile selected
- [ ] Clicking ranking row updates detail via `releaseId`
- [ ] `sessionStorage` for batch text, `localStorage` for comparison profile
- [ ] Phase 1 localStorage keys (`scoreSimulator.lastTitle`, `.lastProfileName`) unaffected
- [ ] `simulationRequestToken` covers batch requests
- [ ] Collapsing and re-expanding advanced mode preserves batch text and comparison selection
- [ ] Parser-unavailable state shows warning banner in batch mode
- [ ] No `any` types

**Patterns:** DisclosureSection + `SS_ADVANCED_OPTIONS`, request token, storage compat, flat
reactive variables

---

## Batch 3: Tests and Polish (Parallel: 2 tasks)

### T10: Unit Tests for Helper Functions

- **Size:** M | **Complexity:** Medium | **Risk:** Low
- **File:** `packages/praxrr-app/src/routes/score-simulator/[databaseId]/helpers.test.ts` (new)
- **Depends on:** T1, T9
- **Blocks:** None

**Scope:**

1. Test `parseBatchTitles`:
   - Empty input -> []
   - Single title -> 1 item with unique ID
   - Multiple titles -> correct count
   - Duplicates preserved (not removed) with correct IDs
   - Max 50 cap enforced
   - Whitespace trimming, empty line skipping
   - > 500 char rejection

2. Test `buildRankingFromResults`:
   - Single result -> rank 1
   - Multiple results -> descending score order
   - Tiebreaking: matchedCfCount desc -> title alpha
   - Missing profile -> empty array
   - Empty results -> empty array
   - All-zero-score results -> all shown, tied ranks

3. Test `buildComparisonResult`:
   - Both profiles present -> correct deltas
   - One profile missing -> null
   - Zero delta -> correct handling
   - Mixed positive/negative -> correct signs
   - Disjoint CFs -> missing CF treated as score 0

4. Verify existing functions unbroken: `getSelectedProfileScore`, `resolveScoreThresholdState`,
   `sortScoreContributionsByMagnitude`

**Acceptance criteria:**

- [ ] Uses Deno test framework (`Deno.test`, `assertEquals`)
- [ ] All edge cases listed above covered
- [ ] All tests pass with `deno task test`
- [ ] No mocking needed (pure functions)

**Patterns:** Existing test pattern from `scoreSimulatorHelpers.test.ts`

---

### T11: Accessibility and Responsive Polish

- **Size:** S | **Complexity:** Low | **Risk:** Low
- **Files:** Cross-component audit of ComparisonView, RankingTable, BatchInput, +page.svelte
- **Depends on:** T9
- **Blocks:** None

**Scope:**

1. Verify all `aria-live="polite"` on: line counter (T3), delta summary (T6), ranking results (T7)
2. Verify `aria-sort` on RankingTable sortable column headers
3. Verify `aria-expanded` on RankingTable expandable rows
4. Test keyboard navigation flow: batch input -> simulate button -> ranking table -> detail panel
5. Verify mobile breakpoint (767px) switches ComparisonView to tabbed/stacked
6. Verify RankingTable uses card layout on mobile via `ExpandableTable` `responsive` prop
7. Ensure color never sole indicator: sign prefixes on deltas, threshold badges use text+color (WCAG
   1.4.1)
8. Check no horizontal overflow on mobile for all new components

**Acceptance criteria:**

- [ ] `aria-live` present on line counter, delta summary, and ranking results container
- [ ] `aria-sort` on all sortable RankingTable column headers
- [ ] `aria-expanded` on all expandable RankingTable rows
- [ ] Tab order: batch input -> simulate button -> ranking table -> detail panel
- [ ] Screen reader announces result updates via `aria-live`
- [ ] Sign prefix + color on all delta displays (WCAG 1.4.1)
- [ ] No horizontal overflow on mobile for any new component

---

## Execution Summary

```
Batch 0 (sequential) ────────────────────
  T1 (helpers.ts)     ████████  [M]
  T2 (presets.ts)     ████      [S]  (after T1)

Batch 1 (parallel: 6) ───────────────────
  T3 (BatchInput)     ████████  [M]
  T4 (PresetSelector) ████      [S]
  T5 (ProfileComp)    ████      [S]
  T6 (ComparisonView) ████████  [M]
  T7 (RankingTable)   ██████████ [L]
  T8 (SimResults mod) ██        [S]

Batch 2 (sequential) ────────────────────
  T9 (+page.svelte)   ██████████ [L]

Batch 3 (parallel: 2) ───────────────────
  T10 (tests)         ████████  [M]
  T11 (a11y polish)   ████      [S]
```

**Total tasks:** 11 **Max parallelism:** 6 (Batch 1) **Critical path:** T1 -> T7 -> T9 -> T10

---

## Validation Results

Three validation agents verified this plan:

1. **Completeness**: All shared.md files, types, helpers, and integration notes covered. Decision
   points D1-D6 reconcile feature-spec divergences.
2. **Dependency ordering**: T2 correctly sequenced after T1 in Batch 0. T8 moved to Batch 1 for
   better parallelism. No circular dependencies. No same-file conflicts within batches.
3. **Acceptance criteria**: All a11y requirements covered with specific attribute checks. Edge cases
   (zero-score, all-tied, parser unavailable, lossless round-trip) addressed. Svelte 5 no-runes
   convention verified.

---

## File Reference

| Task | File                                                                       | Action |
| ---- | -------------------------------------------------------------------------- | ------ |
| T1   | `packages/praxrr-app/src/routes/score-simulator/[databaseId]/helpers.ts`   | Modify |
| T2   | `packages/praxrr-app/src/routes/score-simulator/[databaseId]/presets.ts`   | Create |
| T3   | `.../[databaseId]/components/BatchInput.svelte`                            | Create |
| T4   | `.../[databaseId]/components/PresetSelector.svelte`                        | Create |
| T5   | `.../[databaseId]/components/ProfileComparison.svelte`                     | Create |
| T6   | `.../[databaseId]/components/ComparisonView.svelte`                        | Create |
| T7   | `.../[databaseId]/components/RankingTable.svelte`                          | Create |
| T8   | `.../[databaseId]/components/SimulationResults.svelte`                     | Modify |
| T9   | `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte` | Modify |
| T10  | `.../[databaseId]/helpers.test.ts`                                         | Create |
| T11  | Cross-component audit                                                      | Modify |
