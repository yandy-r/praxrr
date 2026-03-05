# Dependency Analysis: Score Simulator Phase 2

## Dependency Graph

```
TIER 0: Zero Dependencies (immediate)
  presets.ts ─── static data, no imports

TIER 1: Existing Types Only (parallel with Tier 0)
  helpers.ts ──▶ $api/v1.d.ts (extend with new types + functions)

TIER 2: New Components (parallel, after Tier 0+1)
  BatchInput.svelte ──▶ helpers.ts, presets.ts, FormInput
  PresetSelector.svelte ──▶ presets.ts, helpers.ts, Dropdown/DropdownItem
  ProfileComparison.svelte ──▶ helpers.ts, Dropdown/DropdownItem, Score
  ComparisonView.svelte ──▶ helpers.ts, Score, CustomFormatBadge, Badge
  RankingTable.svelte ──▶ helpers.ts, ExpandableTable, Column<T>, Score, Badge

TIER 3: Integration (sequential, after all Tier 2)
  SimulationResults.svelte (modify) ── add releaseId prop, remove [0] hardcode
  +page.svelte (modify) ──▶ ALL new components + helpers + DisclosureSection
```

## Critical Path

```
helpers.ts (types + functions)
  → RankingTable.svelte (most complex new component)
    → +page.svelte (orchestrator wiring)
      → SimulationResults.svelte (releaseId prop)
```

4 sequential phases on the critical path.

## Parallel Execution Map

| Phase | Tasks                                                                       | Max Parallelism |
| ----- | --------------------------------------------------------------------------- | --------------- |
| 1     | presets.ts, helpers.ts (+ unit tests)                                       | 2               |
| 2     | BatchInput, PresetSelector, ProfileComparison, ComparisonView, RankingTable | 5               |
| 3     | SimulationResults mod, +page.svelte integration                             | 2 (sequential)  |
| 4     | Integration testing / e2e                                                   | 1               |

## Shared Types Build Order

| Type              | Required By                     | Phase |
| ----------------- | ------------------------------- | ----- |
| BatchInputState   | BatchInput, +page.svelte        | 1     |
| ComparisonState   | ProfileComparison, +page.svelte | 1     |
| ProfileScoreDelta | ComparisonView                  | 1     |
| ComparisonResult  | ComparisonView, +page.svelte    | 1     |
| RankedRelease     | RankingTable, +page.svelte      | 1     |
| PresetCategory    | PresetSelector, presets.ts      | 1     |
| PresetGroup       | PresetSelector, presets.ts      | 1     |

## Risk Areas

1. **SimulationResults line 49**: hardcoded `results[0]` must become prop-driven
2. **Type colocation**: PresetCategory/PresetGroup types in helpers.ts, consumed by presets.ts
3. **localStorage**: Phase 2 keys separate from Phase 1 keys
4. **simulate() branching**: single vs batch mode in same function
5. **RankingTable expanded rows**: must delegate to SimulationResults per release
