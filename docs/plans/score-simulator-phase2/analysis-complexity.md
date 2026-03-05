# Complexity Analysis: Score Simulator Phase 2

## Summary Table

| File                             | Est. Lines | Complexity  | Risk   |
| -------------------------------- | ---------- | ----------- | ------ |
| `presets.ts`                     | 80-120     | Low         | Low    |
| `helpers.ts` (additions)         | 80-100     | Medium      | Medium |
| `BatchInput.svelte`              | 140-180    | Medium      | Medium |
| `PresetSelector.svelte`          | 80-120     | Low         | Low    |
| `ProfileComparison.svelte`       | 90-130     | Medium      | Medium |
| `RankingTable.svelte`            | 180-250    | High        | High   |
| `ComparisonView.svelte`          | 120-160    | Medium-High | Medium |
| `+page.svelte` (modifications)   | +80-120    | High        | High   |
| `SimulationResults.svelte` (mod) | +15-25     | Low-Medium  | Low    |
| `helpers.test.ts`                | 120-160    | Medium      | Low    |

**Total estimated new/changed lines:** 890-1,260

## Risk Summary

| Risk Level | Items                                                                          |
| ---------- | ------------------------------------------------------------------------------ |
| **High**   | `+page.svelte` state orchestration, `RankingTable` dynamic columns + expansion |
| **Medium** | `helpers.ts` edge cases, `BatchInput` validation UX, `ComparisonView` deltas   |
| **Low**    | `presets.ts`, `PresetSelector`, `SimulationResults` prop addition              |

## Key Risk Details

### RankingTable (High)

- Most complex new component: wraps ExpandableTable with dynamic columns
- Dual score columns in comparison mode
- Expanded row delegates to SimulationResults
- Column definitions change based on comparison mode
- Mobile responsive card layout

### +page.svelte (High)

- State variable count grows from 8 to 12+
- Simulate function bifurcation (single vs batch)
- DisclosureSection mode switching with lossless round-trip
- Component tree restructuring for conditional rendering
- localStorage backward compatibility with new keys

### helpers.ts (Medium)

- `parseBatchTitles`: empty lines, duplicates, 50-item cap, unique IDs
- `buildRankingFromResults`: sort stability, tiebreaking, missing profile handling
- `buildComparisonResult`: CFs in one profile but not other, null safety
