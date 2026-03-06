# Analysis: Score Simulator Phase 3 — Task Decomposition

> Generated: 2026-03-06 | Phase: Analysis | Source: shared.md + feature-spec.md + codebase
> inspection

---

## Task Breakdown

### Phase A: Deep-Link + URL State

**T1 — Create SimulateButton.svelte component**

- **Files**: Create
  `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/scoring/components/SimulateButton.svelte`
- **Dependencies**: None
- **Complexity**: S
- **Acceptance criteria**:
  - Component accepts `databaseId: number` and `profileName: string` props
  - Renders `<Button>` with `variant="secondary"`, flask icon, `responsive`, `hideTextOnMobile`
  - On click, calls
    `goto('/score-simulator/${databaseId}?profile=pcd:${encodeURIComponent(profileName)}&arrType=radarr')`
  - Existing dirty store navigation guard triggers if unsaved changes exist (no custom code needed)

**T2 — Integrate SimulateButton into QP scoring page**

- **Files**: Modify
  `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/scoring/+page.svelte`
- **Dependencies**: T1
- **Complexity**: S
- **Acceptance criteria**:
  - `SimulateButton` imported and rendered in StickyCard `slot="right"` div, between Options and
    Save buttons (~line 585)
  - Props wired: `databaseId` from `$page.params.databaseId`, `profileName` from `data.scoring.name`
  - No functional changes to existing buttons or form submission

**T3 — Create urlState.ts module**

- **Files**: Create `packages/praxrr-app/src/routes/score-simulator/[databaseId]/urlState.ts`
- **Dependencies**: None
- **Complexity**: M
- **Acceptance criteria**:
  - Exports `SimulatorUrlState` interface and `ScoreOverrideMap` type
  - `parseUrlState(searchParams)`: extracts all params; unknown params silently ignored; malformed
    base64/JSON silently discarded; invalid mediaType/arrType fall back to defaults
  - `serializeUrlState(state)`: encodes all non-empty fields; `batch` and `overrides` use base64
    JSON
  - `copyShareLink(state, baseUrl)`: serializes, constructs URL, copies via
    `navigator.clipboard.writeText()`, returns success boolean
  - URL length >2000 chars: drops `overrides` first, then `batch`

**T4 — Read URL state on simulator mount**

- **Files**: Modify `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte`
- **Dependencies**: T3
- **Complexity**: M
- **Acceptance criteria**:
  - Import `parseUrlState` from `./urlState.ts`
  - In `onMount`, call `parseUrlState($page.url.searchParams)` once
  - Populate reactive state from URL (title, mediaType, profile, compare, batch, batchMediaType)
  - URL params take precedence over localStorage values
  - If profile not found in options, show warning via `alertStore`
  - Trigger `simulateSingle()` if title and profile populated from URL

**T5 — Add Copy Link button to simulator**

- **Files**: Modify `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte`
- **Dependencies**: T3, T4
- **Complexity**: S
- **Acceptance criteria**:
  - Import `serializeUrlState`, `copyShareLink` from `./urlState.ts`
  - Add "Copy Link" `<Button>` (variant secondary, xs size, Link icon) in page header
  - Success: `alertStore.add('success', 'Link copied to clipboard.')`
  - URL too long: `alertStore.add('warning', ...)` with truncation details
  - Clipboard unavailable: `alertStore.add('info', 'Copy URL from address bar')`

### Phase B: What-If Scoring

**T6 — Add what-if helper functions to helpers.ts**

- **Files**: Modify `packages/praxrr-app/src/routes/score-simulator/[databaseId]/helpers.ts`
- **Dependencies**: None
- **Complexity**: S
- **Acceptance criteria**:
  - Export `ScoreOverrideMap = Record<string, number>` type
  - `applyScoreOverrides(contributions, overrides)`: returns new array with replaced scores; adds
    `originalScore` when overridden; no mutation
  - `computeOverriddenTotal(contributions, overrides)`: sums scores after applying overrides
  - `resolveThresholdWithOverrides(profileScore, overrides)`: computes threshold using overridden
    total
  - Empty overrides returns original values; overrides for non-existent CFs silently ignored

**T7 — Add override state management to +page.svelte**

- **Files**: Modify `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte`
- **Dependencies**: T4, T6
- **Complexity**: M
- **Acceptance criteria**:
  - Add `scoreOverrides: ScoreOverrideMap = {}` state + reactive declarations (`hasActiveOverrides`,
    `overrideCount`)
  - Handlers: `handleOverrideChange`, `handleOverrideReset`, `handleOverrideResetAll`
  - Pass overrides + handlers to ScoreBreakdown, RankingTable, ComparisonView
  - Populate `scoreOverrides` from URL state on mount
  - Include overrides in Copy Link serialization
  - Info banner when overrides active: "What-if overrides are temporary and will not be saved."
  - "Reset All Overrides" button visible when `hasActiveOverrides`

**T8 — Make ScoreBreakdown inline-editable with override indicators**

- **Files**: Modify
  `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ScoreBreakdown.svelte`
- **Dependencies**: T6, T7
- **Complexity**: L
- **Acceptance criteria**:
  - New props: `overrides`, `onOverrideChange`, `onOverrideReset`, `onOverrideResetAll`
  - Click on score activates inline `<NumberInput>` (compact, mono, step=1)
  - Auto-select on activation; Enter confirms, Escape reverts
  - Overridden rows: amber styling (`bg-amber-50 dark:bg-amber-900/20`,
    `border-l-2 border-amber-500`)
  - Original value as strikethrough; delta display (+N green / -N red)
  - Per-CF reset icon on overridden rows
  - Total score recomputed via `computeOverriddenTotal()`; threshold via
    `resolveThresholdWithOverrides()`
  - `aria-live="polite"` on total score region

**T9 — Wire overrides into RankingTable**

- **Files**: Modify
  `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/RankingTable.svelte`
- **Dependencies**: T6, T7
- **Complexity**: M
- **Acceptance criteria**:
  - New prop: `overrides: ScoreOverrideMap = {}`
  - Recompute each release's `totalScore` using `computeOverriddenTotal()` when overrides present
  - Re-sort and re-rank using overridden totals
  - Threshold state per row recalculated with overridden totals

**T10 — Wire overrides into ComparisonView**

- **Files**: Modify
  `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ComparisonView.svelte`
- **Dependencies**: T6, T7
- **Complexity**: S
- **Acceptance criteria**:
  - New prop: `overrides: ScoreOverrideMap = {}`
  - Primary profile (A) uses overridden values; comparison (B) shows baseline
  - Deltas recalculated: overriddenA - baselineB

### Phase C: Testing

**T11 — Unit tests for what-if helper functions**

- **Files**: Create `packages/praxrr-app/src/tests/routes/scoreSimulatorPhase3Helpers.test.ts`
- **Dependencies**: T6
- **Complexity**: M
- **Acceptance criteria**:
  - Follow patterns from `scoreSimulatorHelpers.test.ts` (Deno.test, @std/assert)
  - `applyScoreOverrides()`: empty overrides, single/multiple overrides, non-existent CF (ignored),
    negative score, originalScore annotation, override matching original value (no annotation)
  - `computeOverriddenTotal()`: no overrides, partial, all overridden, empty contributions
  - `resolveThresholdWithOverrides()`: threshold transitions (below->accepted,
    accepted->upgrade-reached, reverse), null profileScore, empty overrides

**T12 — Unit tests for URL state serialization**

- **Files**: Create `packages/praxrr-app/src/tests/routes/scoreSimulatorUrlState.test.ts`
- **Dependencies**: T3
- **Complexity**: M
- **Acceptance criteria**:
  - Round-trip: `parseUrlState(serializeUrlState(state))` equals original
  - Empty params returns defaults; unknown params ignored
  - Malformed base64/JSON silently discarded
  - Invalid mediaType/arrType fall back to defaults (arrType=lidarr -> radarr)
  - Special characters in profile names round-trip correctly
  - URL length truncation: overrides dropped first, then batch

**T13 — E2E tests for Phase 3 workflows**

- **Files**: Create `packages/praxrr-app/src/tests/e2e/specs/4.1-score-simulator-deep-link.spec.ts`,
  `4.2-score-simulator-what-if.spec.ts`, `4.3-score-simulator-url-state.spec.ts`
- **Dependencies**: All Phase A + B complete
- **Complexity**: L
- **Acceptance criteria**:
  - `4.1`: Navigate to scoring page, verify Simulate button, click, verify profile pre-fill
  - `4.2`: Override score, verify total recalculates, verify threshold updates, batch re-sorts,
    reset works
  - `4.3`: Copy link, open in new context, verify state restoration
  - Handle parser-unavailable scenario gracefully

**T14 — Register test aliases in scripts/test.ts**

- **Files**: Modify `scripts/test.ts`
- **Dependencies**: T11, T12
- **Complexity**: S
- **Acceptance criteria**:
  - Add aliases: `url-state`, `what-if`, `phase3`
  - All resolve correctly via `deno task test <alias>`

---

## Dependency Graph

```
Phase A:           T1 --> T2
                   T3 --> T4 --> T5

Phase B:           T6 (parallel with T1, T3)
                   T4 + T6 --> T7
                   T6 + T7 --> T8
                   T6 + T7 --> T9
                   T6 + T7 --> T10

Phase C:           T6 --> T11
                   T3 --> T12
                   T11 + T12 --> T14
                   All A+B --> T13
```

---

## Recommended Implementation Order

1. **T1 + T3 + T6** (parallel, foundation layer)
2. **T2 + T4** (parallel, depend on step 1)
3. **T5 + T7** (parallel)
4. **T8 + T9 + T10** (parallel, UI integration)
5. **T11 + T12** (parallel, unit tests)
6. **T14** (test aliases)
7. **T13** (E2E tests, requires running server)
