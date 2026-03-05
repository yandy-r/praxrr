# Score Simulator: Analysis Patterns (Phase 1 MVP)

Exact implementation patterns from the existing codebase for every Phase 1 task.

---

## 1. Pattern Catalog

### T1: OpenAPI Schema (`docs/api/v1/schemas/score-simulator.yaml`)

**Reference**: `docs/api/v1/schemas/entity-testing.yaml`

- Lines 1-6: `MediaType` enum → reference via `$ref: '../schemas/entity-testing.yaml#/MediaType'`
- Lines 8-45: `ParsedInfo` object → reference via `$ref: '../schemas/entity-testing.yaml#/ParsedInfo'`
- Lines 47-61: `ReleaseInput` → adapt for `SimulateReleaseInput` (change `id` from `integer` to `string`)
- Lines 86-98: `EvaluateRequest` → adapt for `SimulateScoreRequest` (add `profileNames`, `arrType`)

**Deviations**: `SimulateReleaseInput.id` is `string` (client UUID), not `integer` (DB PK). `databaseId` is required (not optional). `arrType` is new required field.

**Schema definition order**: SimulateConditionResult → SimulateCfMatch → SimulateScoreContribution → SimulateProfileScore → SimulateReleaseResult → SimulateReleaseInput → SimulateScoreRequest → SimulateScoreResponse

### T1: OpenAPI Path (`docs/api/v1/paths/score-simulator.yaml`)

**Reference**: `docs/api/v1/paths/entity-testing.yaml` (all 34 lines)

- Copy entire `evaluate:` block, adapt to `score:` with `operationId: simulateScore`, `tags: [Score Simulator]`
- Add `404` response for "Database or profile not found" with `missing: string[]`

### T1: `openapi.yaml` Modifications

**Reference**: `docs/api/v1/openapi.yaml`

1. **Tag** (after line 27): `{ name: Score Simulator, description: Interactive release scoring playground }`
2. **Path** (after entity-testing paths): `/simulate/score: $ref: './paths/score-simulator.yaml#/score'`
3. **Schemas** (after EvaluateResponse block): 8 schema `$ref` entries for all `Simulate*` types

---

### T2: API Endpoint (`routes/api/v1/simulate/score/+server.ts`)

**Reference**: `routes/api/v1/entity-testing/evaluate/+server.ts`

- Lines 1-16: Import block → same plus `scoring` from quality profiles
- Lines 33-52: Parser health check + degraded response → copy exactly
- Lines 54-56: Batch parse → copy exactly
- Lines 78-90: Cache guard + getAllConditionsForEvaluation + extractAllPatterns + matchPatternsBatch → copy exactly
- Lines 92-127: Per-release evaluation loop → **CRITICAL DEVIATION**: preserve `result.conditions` (line 118 discards it)

**Critical difference at line 118**:

```typescript
// entity-testing (discards conditions):
cfMatches[cf.name] = result.matches;

// simulator (preserves conditions):
cfMatchResults.push({
  name: cf.name,
  matches: result.matches,
  conditions: result.conditions, // SimulateConditionResult[] preserved
});
```

**New: Score computation** (after evaluation loop):

```typescript
const profileData = await scoring(cache, databaseId, profileName);
let totalScore = 0;
const contributions: SimulateScoreContribution[] = [];
for (const cf of cfMatches) {
  if (!cf.matches) continue;
  const cfScoring = profileData.customFormats.find((c) => c.name === cf.name);
  const score = cfScoring?.scores[arrType] ?? 0; // already resolved by scoring()
  if (score !== 0) contributions.push({ cfName: cf.name, score });
  totalScore += score;
}
```

**New: Validation** (not in entity-testing):

```typescript
if (!body.arrType || !['radarr', 'sonarr'].includes(body.arrType)) throw error(400, ...);
if (!body.profileNames?.length) throw error(400, ...);
if (body.profileNames.length > 10) throw error(400, ...);
if (body.releases.length > 50) throw error(400, ...);
```

**New: Profile 404** — `scoring()` throws on missing profile; catch and return `{ error: '...', missing: [...] }` with status 404.

---

### T4a: Parent Route (`routes/score-simulator/+page.server.ts` + `+page.svelte`)

**Reference**: `routes/quality-profiles/entity-testing/+page.server.ts` (11 LOC) + `+page.svelte` (45 LOC)

- **Server**: Copy exactly. `pcdManager.getAll()` and return.
- **Client**: Copy with deviations:
  - `storageKey = 'scoreSimulatorDatabase'`
  - `goto('/score-simulator/${targetId}')`
  - `<title>Score Simulator - Praxrr</title>`

---

### T4b: Child Route Server (`routes/score-simulator/[databaseId]/+page.server.ts`)

**Reference**: `routes/quality-profiles/entity-testing/[databaseId]/+page.server.ts`

- Keep: lines 21-40 (database lookup + cache guard), lines 49-59 (qualityProfileQueries.select), lines 65-70 (isParserHealthy)
- Remove: entity tests, TMDB settings, Arr instances, form actions
- Return: `{ databases, currentDatabase, parserAvailable, qualityProfiles }`
- Do NOT call `allCfScores()` — simulator computes server-side

---

### T4b: Main Page Shell (`routes/score-simulator/[databaseId]/+page.svelte`)

**Reference**: `routes/quality-profiles/entity-testing/[databaseId]/+page.svelte`

- Lines 50-58: `onMount` parser warning → copy (`alertStore.add('warning', '...', 0)`)
- Lines 49-52: localStorage database tab persistence → copy, change key
- Lines 247-252: Database tabs → copy, change href to `/score-simulator/${db.id}`
- Lines 356-358: Wrapper layout → copy

**Simulator-specific state**:

```typescript
let releaseTitle = '';
let mediaType: 'movie' | 'series' = 'movie';
let selectedArrType: 'radarr' | 'sonarr' | null = null; // null = not selected
let selectedProfileName: string | null = null;
let simulationResult: SimulateScoreResponse | null = null;
let isSimulating = false;
```

**Layout**: Split-pane (`grid grid-cols-1 gap-6 lg:grid-cols-[2fr_3fr]`), input left, results right.

---

### T5: ReleaseInput Component

**No direct analog.** Patterns extracted from:

- `Dropdown.svelte` for profile selector
- Entity-testing page lines 370-405 for toggle pattern
- `getPersistentSearchStore` for debounce concept (but inline `setTimeout` here)

**Props**: `title`, `mediaType`, `arrType`, `qualityProfiles`, `selectedProfileName`, `isSimulating`, `parserAvailable`
**Events**: `dispatch('input')` (debounced title), `dispatch('profileChange')`, `dispatch('arrTypeChange')`

---

### T6: ParsedMetadata (within SimulationResults)

**Reference**: `ReleaseTable.svelte` lines 239-305

Near-direct lift of badge rendering: `grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-xs` with HardDrive, Layers, Tag, Users, Bookmark, Earth icons. `ParsedInfo` type from `$shared/pcd/display.ts`.

---

### T7: SimulationResults Component

**Reference**: `ReleaseTable.svelte` for ExpandableTable integration

- Use `ExpandableTable.svelte` with columns: CF name, match indicator, score
- `Score.svelte` for per-CF score display
- `CustomFormatBadge.svelte` for CF name badges
- Expanded slot: condition detail sub-table (conditionName, type, expected, actual, passes icon)
- `aria-live="polite"` wrapper for accessibility
- Loading state: `opacity-60` on results + `Loader2` spinner

**Important**: Do NOT copy entity-testing's `score !== 0` filter. Show ALL matched CFs including zero-score.

---

### T8: ScoreBreakdown Component

**Reference**: Entity-testing page lines 82-176 for profile selection; `Score.svelte` for total score display

- Threshold states: below minimum (red), accepted + upgrades enabled (green), upgrade until reached (green + lock)
- Contribution list: sorted by `|score|` descending, `CustomFormatBadge` + score per row

---

### T13: Nav Registration

**Reference**: `registry.ts` lines 68-230

```typescript
{
  id: 'policies.score_simulator',
  label: 'Score Simulator',
  href: '/score-simulator',
  groupId: ensureGroupId('policies'),
  order: 6,
  arrScope: scopeAll,
  mobilePriority: 'medium',
  iconKey: 'Calculator',
  emoji: '🧮',
  hasChildren: false,
}
```

---

## 2. File Naming and Location

### Files to Create

| File                                                                                              | Task                     |
| ------------------------------------------------------------------------------------------------- | ------------------------ |
| `docs/api/v1/schemas/score-simulator.yaml`                                                        | OpenAPI schemas          |
| `docs/api/v1/paths/score-simulator.yaml`                                                          | OpenAPI path             |
| `packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts`                                 | POST API handler         |
| `packages/praxrr-app/src/routes/score-simulator/+page.server.ts`                                  | Database redirect server |
| `packages/praxrr-app/src/routes/score-simulator/+page.svelte`                                     | Database redirect client |
| `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.server.ts`                     | Feature page server      |
| `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte`                        | Feature page client      |
| `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ReleaseInput.svelte`      | Title input              |
| `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/SimulationResults.svelte` | Results display          |
| `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ScoreBreakdown.svelte`    | Score breakdown          |

### Files to Modify

| File                                                           | Change                                        |
| -------------------------------------------------------------- | --------------------------------------------- |
| `docs/api/v1/openapi.yaml`                                     | Add tag, path ref, schema refs                |
| `packages/praxrr-app/src/lib/api/v1.d.ts`                      | Regenerate via `deno task generate:api-types` |
| `packages/praxrr-app/src/lib/server/navigation/registry.ts`    | Add `policies.score_simulator` entry          |
| `packages/praxrr-app/src/lib/shared/disclosure/sectionKeys.ts` | Add `SS_ADVANCED_OPTIONS` key                 |

---

## 3. Import Map

### `routes/api/v1/simulate/score/+server.ts`

```typescript
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { pcdManager } from '$pcd/index.ts';
import {
  parseWithCacheBatch,
  isParserHealthy,
  matchPatternsBatch,
} from '$lib/server/utils/arr/parser/index.ts';
import {
  getAllConditionsForEvaluation,
  evaluateCustomFormat,
  getParsedInfo,
  extractAllPatterns,
} from '$pcd/entities/customFormats/index.ts';
import { scoring } from '$pcd/entities/qualityProfiles/index.ts';
import type { components } from '$api/v1.d.ts';
```

### `routes/score-simulator/[databaseId]/+page.server.ts`

```typescript
import { error } from '@sveltejs/kit';
import type { ServerLoad } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';
import * as qualityProfileQueries from '$pcd/entities/qualityProfiles/index.ts';
import { isParserHealthy } from '$lib/server/utils/arr/parser/index.ts';
import { logger } from '$logger/logger.ts';
```

### `routes/score-simulator/[databaseId]/+page.svelte`

```typescript
import { onMount } from 'svelte';
import { browser } from '$app/environment';
import Tabs from '$ui/navigation/tabs/Tabs.svelte';
import { alertStore } from '$lib/client/alerts/store';
import ReleaseInput from './components/ReleaseInput.svelte';
import SimulationResults from './components/SimulationResults.svelte';
import ScoreBreakdown from './components/ScoreBreakdown.svelte';
import type { PageData } from './$types';
import type { components } from '$api/v1.d.ts';
```

### `components/SimulationResults.svelte`

```typescript
import {
  Check,
  X,
  HardDrive,
  Layers,
  Tag,
  Users,
  Bookmark,
  Earth,
  Loader2,
} from 'lucide-svelte';
import ExpandableTable from '$ui/table/ExpandableTable.svelte';
import Score from '$ui/arr/Score.svelte';
import CustomFormatBadge from '$ui/arr/CustomFormatBadge.svelte';
import Badge from '$ui/badge/Badge.svelte';
import type { components } from '$api/v1.d.ts';
```

---

## 4. Component Architecture

### ReleaseInput.svelte

- **Props**: `title`, `mediaType`, `arrType`, `qualityProfiles[]`, `selectedProfileName`, `isSimulating`, `parserAvailable`
- **Events**: `dispatch('input')` → parent debounces 300ms → simulate; `dispatch('profileChange')` → immediate simulate
- **Layout**: parser warning banner → textarea → media type toggle → arr type toggle → profile dropdown

### SimulationResults.svelte

- **Props**: `result: SimulateScoreResponse | null`, `selectedProfileName`, `isSimulating`
- **Events**: None (read-only display)
- **Reactive**: `$: releaseResult = result?.results?.[0]`, `$: matchedCfs = ...filter(cf => cf.matches)`
- **Sort**: Matched CFs at top by `|score|` desc, unmatched at bottom
- **Loading**: `opacity-60` on previous results + `Loader2` spinner

### ScoreBreakdown.svelte

- **Props**: `profileScore: SimulateProfileScore`, `profileName`
- **Events**: None (read-only display)
- **Layout**: Total score (Score.svelte) → threshold badges → contribution list sorted by `|score|` desc

---

## 5. Anti-Patterns (Do NOT)

1. **No `$state`/`$derived` runes** — Svelte 5 runes forbidden per CLAUDE.md
2. **No `any` type** — use `components['schemas']['SimulateScoreResponse']` from generated types
3. **No 500 on parser unavailability** — return 200 with `parserAvailable: false`
4. **No client-side score computation** — server returns pre-computed `profileScores`
5. **No re-implementing `all`/arr-type precedence** — `scoring()` already handles it
6. **No `satisfies` omission** — use `satisfies SimulateScoreResponse` on return
7. **No nesting under `/quality-profiles`** — top-level `/score-simulator` per spec
8. **No implicit arr_type** — require explicit selection per Cross-Arr Semantic Validation Policy
9. **No integer release IDs** — `SimulateReleaseInput.id` is string (client UUID)
10. **No auto-dismiss parser warning** — duration `0` for persistent alert
11. **No new dependencies** — all built on existing infrastructure
12. **No hand-editing `v1.d.ts`** — always regenerate via `deno task generate:api-types`
