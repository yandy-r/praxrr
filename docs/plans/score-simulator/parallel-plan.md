# Parallel Implementation Plan: Score Simulator - Phase 1 (MVP)

**Feature**: Score Simulator — interactive scoring playground for release titles
**Branch**: `feat/score-simulator`
**Scope**: Phase 1 MVP — single release scoring with full condition detail
**Estimated LOC**: ~1,054 across 15 files (60% adapted, 40% new)
**Estimated Duration**: 4-6 days (single developer)

---

## Prerequisites

Before starting implementation:

- [ ] Read `docs/plans/score-simulator/shared.md` (context doc)
- [ ] Read `docs/plans/score-simulator/feature-spec.md` (authoritative spec)
- [ ] Read `CLAUDE.md` (project conventions)
- [ ] Ensure `feat/score-simulator` branch is up to date
- [ ] `deno task dev` running (or `deno task dev:server` + `deno task dev:parser` separately)

---

## Shared Context

All tasks in this plan share the following context document:

**`docs/plans/score-simulator/shared.md`** — contains relevant files, tables, patterns, and docs references.

Each task below specifies which additional docs from `docs/plans/score-simulator/` to read.

---

## Task Overview

| Task ID | Name                                             | Complexity  | LOC | Batch | Blocked By                                                    |
| ------- | ------------------------------------------------ | ----------- | --- | ----- | ------------------------------------------------------------- |
| TASK-01 | OpenAPI contract (schemas + path + registration) | Low         | 172 | 1     | —                                                             |
| TASK-02 | Type generation gate                             | Low         | 0   | 2     | TASK-01                                                       |
| TASK-03 | Nav registration + disclosure keys               | Low         | 15  | 1     | —                                                             |
| TASK-04 | Parent redirect route                            | Low         | 62  | 1     | —                                                             |
| TASK-05 | Child route server load                          | Low-Medium  | 50  | 1     | —                                                             |
| TASK-06 | API endpoint implementation                      | Medium      | 135 | 3     | TASK-02                                                       |
| TASK-07 | ReleaseInput component                           | Medium      | 120 | 3     | TASK-02                                                       |
| TASK-08 | SimulationResults component                      | Medium-High | 200 | 3     | TASK-02                                                       |
| TASK-09 | ScoreBreakdown component                         | Medium      | 130 | 3     | TASK-02                                                       |
| TASK-10 | Main page integration                            | Medium      | 80  | 4     | TASK-02, TASK-04, TASK-05, TASK-06, TASK-07, TASK-08, TASK-09 |
| TASK-11 | Verification + smoke tests                       | Low         | 0   | 5     | TASK-10                                                       |

---

## Execution Batches

### Batch 1 — Foundation (no prerequisites, fully parallel)

All tasks in this batch can start immediately with zero dependencies.

### Batch 2 — Contract Gate (sequential, after Batch 1)

Type generation depends on TASK-01 completing. Single sequential step.

### Batch 3 — Core Implementation (after Batch 2, fully parallel)

API endpoint and all UI components can be built simultaneously once types exist.

### Batch 4 — Integration (after Batch 3)

Wire all components into the main page.

### Batch 5 — Verification (after Batch 4)

Type check, lint, and smoke tests.

---

## Critical Path

```
TASK-01 → TASK-02 → TASK-06 → TASK-10 → TASK-11
```

The type generation gate (TASK-02) is the single highest-leverage point. Any schema error forces a loop back to TASK-01.

---

## Detailed Task Specifications

---

### TASK-01: OpenAPI Contract

**Batch**: 1 (start immediately)
**Blocked by**: nothing
**Blocks**: TASK-02
**Complexity**: Low | **LOC**: 172 | **Reuse**: 85%
**Must-read docs**: `research-technical.md`, `docs/api/v1/schemas/entity-testing.yaml`, `docs/api/v1/paths/entity-testing.yaml`

#### Description

Define the complete OpenAPI contract for the score simulator API. This is the contract-first foundation that all typed implementation depends on.

#### Files to Create

1. **`docs/api/v1/schemas/score-simulator.yaml`** (~120 LOC)

   Define these schemas in order (each referencing the previous):
   - `SimulateConditionResult` — condition-level pass/fail detail (8 fields: conditionName, conditionType, matched, required, negate, passes, expected, actual)
   - `SimulateCfMatch` — CF-level match with conditions array (name, matches, conditions[])
   - `SimulateScoreContribution` — per-CF score contribution (cfName, score)
   - `SimulateProfileScore` — profile-level totals (profileName, totalScore, minimumScore, upgradeUntilScore, contributions[])
   - `SimulateReleaseResult` — per-release result (id, title, parsed: `$ref ParsedInfo`, cfMatches[], profileScores[])
   - `SimulateReleaseInput` — request release item (id: **string** not integer, title, type: movie|series)
   - `SimulateScoreRequest` — request body (databaseId: required, releases[]: maxItems 50, profileNames[]: maxItems 10, arrType: radarr|sonarr)
   - `SimulateScoreResponse` — response envelope (parserAvailable, results[])

   **Reference `ParsedInfo`** from entity-testing via: `$ref: '../schemas/entity-testing.yaml#/ParsedInfo'`

2. **`docs/api/v1/paths/score-simulator.yaml`** (~40 LOC)

   Define `POST /simulate/score` path with:
   - `operationId: simulateScore`
   - `tags: [Score Simulator]`
   - Request body: `$ref: '../schemas/score-simulator.yaml#/SimulateScoreRequest'`
   - Response 200: `$ref: '../schemas/score-simulator.yaml#/SimulateScoreResponse'`
   - Response 400: validation error `{ error: string }`
   - Response 404: not found `{ error: string, missing: string[] }`
   - Response 500: internal error

#### Files to Modify

3. **`docs/api/v1/openapi.yaml`** (~12 LOC additions)
   - Add tag: `{ name: Score Simulator, description: Interactive release scoring playground }`
   - Add path ref: `/simulate/score: $ref: './paths/score-simulator.yaml#/score'`
   - Add 8 schema component refs for all `Simulate*` types (after Entity Testing schemas block)

#### Acceptance Criteria

- [ ] All YAML files pass OpenAPI linting (well-formed `$ref` paths)
- [ ] `SimulateReleaseInput.id` is `type: string` (not integer)
- [ ] `SimulateScoreRequest.databaseId` is required (not optional)
- [ ] `SimulateScoreRequest.arrType` enum is `[radarr, sonarr]` (no `all`)
- [ ] Cross-file `$ref` to `ParsedInfo` uses correct relative path

#### Risks

- **HIGH**: Cross-file `$ref` to `ParsedInfo` must resolve correctly for type generation. Verify syntax against existing cross-file refs in the spec before proceeding to TASK-02.

---

### TASK-02: Type Generation Gate

**Batch**: 2 (sequential)
**Blocked by**: TASK-01
**Blocks**: TASK-06, TASK-07, TASK-08, TASK-09, TASK-10
**Complexity**: Low | **LOC**: 0 (generated) | **Reuse**: 100%

#### Description

Run type generation and verify the output. This is a non-parallelizable gate that unlocks all typed implementation.

#### Steps

1. Run `deno task generate:api-types`
2. Run `deno task check:server` to verify generated types compile
3. Verify `components['schemas']['SimulateScoreResponse']` exists in `packages/praxrr-app/src/lib/api/v1.d.ts`
4. Verify `ParsedInfo` field on `SimulateReleaseResult` resolves to the correct type (not `unknown` or `any`)

#### Acceptance Criteria

- [ ] `deno task generate:api-types` exits 0
- [ ] `deno task check:server` exits 0
- [ ] All 8 `Simulate*` types visible in `v1.d.ts`

#### Risks

- If this fails, loop back to TASK-01 to fix schema YAML. Do not proceed to Batch 3 until green.

---

### TASK-03: Nav Registration + Disclosure Keys

**Batch**: 1 (start immediately)
**Blocked by**: nothing
**Blocks**: nothing
**Complexity**: Low | **LOC**: 15 | **Reuse**: 95%
**Must-read docs**: `analysis-patterns.md` section on nav registration

#### Description

Register the score simulator in the navigation sidebar and disclosure key registry.

#### Files to Modify

1. **`packages/praxrr-app/src/lib/server/navigation/registry.ts`** (~10 LOC)

   Add to `NAV_REGISTRY` array in the `policies` group:

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

2. **`packages/praxrr-app/src/lib/shared/disclosure/sectionKeys.ts`** (~5 LOC)

   Add constant and register in `SECTION_KEYS` array:

   ```typescript
   export const SS_ADVANCED_OPTIONS =
     'score-simulator:simulator:advanced-options' as const;
   ```

#### Acceptance Criteria

- [ ] Nav item appears in sidebar under Policies group
- [ ] Disclosure key follows `route-family:page:section` validation pattern
- [ ] `deno task check` passes

---

### TASK-04: Parent Redirect Route

**Batch**: 1 (start immediately)
**Blocked by**: nothing
**Blocks**: TASK-10
**Complexity**: Low | **LOC**: 62 | **Reuse**: 90%
**Must-read docs**: `analysis-patterns.md` section T4a

#### Description

Create the database-redirect parent route. This is a near-verbatim copy of the entity-testing parent pattern.

#### Files to Create

1. **`packages/praxrr-app/src/routes/score-simulator/+page.server.ts`** (~12 LOC)

   Copy from `routes/quality-profiles/entity-testing/+page.server.ts` exactly:
   - Load `pcdManager.getAll()` and return `{ databases }`

2. **`packages/praxrr-app/src/routes/score-simulator/+page.svelte`** (~50 LOC)

   Copy from `routes/quality-profiles/entity-testing/+page.svelte` with deviations:
   - `storageKey = 'scoreSimulatorDatabase'`
   - Redirect target: `/score-simulator/${targetId}`
   - Title: `Score Simulator - Praxrr`
   - EmptyState description: `"Link a Praxrr Compliant Database to use the Score Simulator."`

#### Acceptance Criteria

- [ ] Navigating to `/score-simulator` redirects to `/score-simulator/{lastUsedDbId}`
- [ ] With no databases linked, shows EmptyState with link to databases page
- [ ] localStorage key `scoreSimulatorDatabase` is set on redirect

---

### TASK-05: Child Route Server Load

**Batch**: 1 (start immediately)
**Blocked by**: nothing
**Blocks**: TASK-10
**Complexity**: Low-Medium | **LOC**: 50 | **Reuse**: 60%
**Must-read docs**: `analysis-patterns.md` section T4b, entity-testing `[databaseId]/+page.server.ts`

#### Description

Create the child route server load function. Substantially simpler than entity-testing (no form actions, no entity tests, no TMDB, no Arr instances).

#### Files to Create

1. **`packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.server.ts`** (~50 LOC)

   Load function returns:
   - `databases` — `pcdManager.getAll()` for tab switcher
   - `currentDatabase` — validated from `pcdManager.getAll()` using param `databaseId`
   - `qualityProfiles` — `qualityProfileQueries.select(cache)` for profile dropdown (id + name only)
   - `parserAvailable` — `isParserHealthy()` boolean

   **Important**: Do NOT call `allCfScores()` — the simulator computes scores server-side. Only profile names are needed client-side.

   Include cache guard: `const cache = pcdManager.getCache(databaseId); if (!cache) throw error(404, ...)`

#### Acceptance Criteria

- [ ] Valid databaseId returns databases, currentDatabase, qualityProfiles, parserAvailable
- [ ] Invalid databaseId returns 404
- [ ] No `allCfScores()` call (unnecessary for simulator)
- [ ] `deno task check` passes

---

### TASK-06: API Endpoint Implementation

**Batch**: 3 (after TASK-02)
**Blocked by**: TASK-02
**Blocks**: TASK-10
**Complexity**: Medium | **LOC**: 135 | **Reuse**: 65%
**Must-read docs**: `feature-spec.md` (API Design section), `research-technical.md`, `research-external.md`, `analysis-patterns.md` section T2

#### Description

Implement `POST /api/v1/simulate/score` — the core server-side handler. This extends the entity-testing evaluate pipeline with score computation and condition detail preservation.

#### Files to Create

1. **`packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts`** (~135 LOC)

   **Pipeline** (mirrors evaluate endpoint with additions):
   1. **Validate request body**: arrType in [radarr, sonarr], profileNames non-empty and max 10, releases non-empty and max 50. Return 400 on failure.
   2. **Check parser health**: `isParserHealthy()` → if false, return `{ parserAvailable: false, results: [] }` with HTTP 200 (not error).
   3. **Batch parse**: `parseWithCacheBatch(parseItems)` — identical to evaluate endpoint.
   4. **Load PCD cache**: `pcdManager.getCache(databaseId)` with null guard → 404 if missing.
   5. **Validate profiles exist**: For each profileName, verify it exists in cache. Return 404 with `{ error: '...', missing: [...] }` if any missing.
   6. **Load CFs**: `getAllConditionsForEvaluation(cache)` → all CFs with conditions.
   7. **Extract + match patterns**: `extractAllPatterns(customFormats)` → `matchPatternsBatch(titles, patterns)`.
   8. **Evaluate per release per CF**: `evaluateCustomFormat()` — **preserve `result.conditions`** (entity-testing discards at line 118).
   9. **Score per profile**: For each profileName, call `scoring(cache, databaseId, profileName)`. Access `cfScoring.scores[arrType]` for resolved score (includes `all` fallback). Sum to `totalScore`. Collect non-zero contributions.
   10. **Return response**: `json({ parserAvailable: true, results } satisfies SimulateScoreResponse)`

   **Error handling for `scoring()`**: Wrap in try-catch. `scoring()` throws `Error("Quality profile ... not found")` — convert to 404, not 500.

#### Acceptance Criteria

- [ ] Valid request returns `SimulateScoreResponse` with `parserAvailable: true`
- [ ] Parser unavailable returns 200 with `parserAvailable: false, results: []`
- [ ] Missing database returns 404
- [ ] Missing profile name(s) return 404 with `missing` array
- [ ] Invalid arrType returns 400
- [ ] Empty releases returns 400
- [ ] `ConditionResult[]` preserved for each CF (not discarded)
- [ ] Score resolution uses `scoring()` function (not direct table query)
- [ ] Uses `satisfies SimulateScoreResponse` on return json
- [ ] `deno task check` passes

#### Risks

- RISK-02: `scoring()` throws on missing profile — must catch and return 404
- RISK-03: Score resolution already handled by `scoring()` — do NOT re-implement precedence
- RISK-04: Condition detail is the key differentiator — do NOT discard `result.conditions`

---

### TASK-07: ReleaseInput Component

**Batch**: 3 (after TASK-02)
**Blocked by**: TASK-02
**Blocks**: TASK-10
**Complexity**: Medium | **LOC**: 120 | **Reuse**: 30%
**Must-read docs**: `research-ux.md`, `analysis-patterns.md` section T5

#### Description

Build the release title input component with media type selector, arr type selector, and profile dropdown.

#### Files to Create

1. **`packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ReleaseInput.svelte`** (~120 LOC)

   **Props**:

   ```typescript
   export let title: string;
   export let mediaType: 'movie' | 'series';
   export let arrType: 'radarr' | 'sonarr' | null;
   export let qualityProfiles: Array<{ id: number; name: string }>;
   export let selectedProfileName: string | null;
   export let isSimulating: boolean;
   export let parserAvailable: boolean;
   ```

   **Events** (via `createEventDispatcher`):
   - `input` — debounced title change (triggers simulate)
   - `profileChange` — profile selection changed (immediate simulate)
   - `arrTypeChange` — arr type changed (immediate simulate)

   **Features**:
   - Textarea/input for release title with 300ms debounce (`setTimeout`/`clearTimeout`)
   - Media type toggle (movie/series) — radio buttons or toggle group
   - Arr type selector (radarr/sonarr) — initialize to `null`, require explicit selection
   - Profile dropdown using `Dropdown.svelte` + `DropdownItem.svelte` pattern
   - Inline parser warning banner when `!parserAvailable` (amber, AlertTriangle icon)
   - Disable simulate action when `arrType === null || !selectedProfileName`
   - `onDestroy` cleanup for debounce timer (prevent memory leak)

#### Acceptance Criteria

- [ ] Title input dispatches `input` event after 300ms debounce
- [ ] Media type toggle switches between movie/series
- [ ] Arr type selector requires explicit selection (not defaulted)
- [ ] Profile dropdown shows all loaded profiles
- [ ] Parser warning shown when unavailable
- [ ] Timer cleaned up on destroy
- [ ] No `$state`/`$derived` runes used

---

### TASK-08: SimulationResults Component

**Batch**: 3 (after TASK-02)
**Blocked by**: TASK-02
**Blocks**: TASK-10
**Complexity**: Medium-High | **LOC**: 200 | **Reuse**: 40%
**Must-read docs**: `research-ux.md`, `analysis-patterns.md` sections T6+T7

#### Description

Build the simulation results display component with parsed metadata badges, CF match table with expandable condition detail, and match/unmatch visual hierarchy.

#### Files to Create

1. **`packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/SimulationResults.svelte`** (~200 LOC)

   **Props**:

   ```typescript
   export let result: SimulateScoreResponse | null;
   export let selectedProfileName: string | null;
   export let isSimulating: boolean;
   ```

   **Sections**:

   A. **Parsed Metadata Badges** — adapt from `ReleaseTable.svelte` lines 239-305:
   - Grid layout with Badge components for: source, resolution, modifier, languages, year, releaseGroup, edition
   - Icons: HardDrive, Layers, Tag, Users, Bookmark, Earth from lucide-svelte
   - Guard with `{#if releaseResult?.parsed}`

   B. **CF Match Table** — `ExpandableTable.svelte`:
   - Columns: CF name (`CustomFormatBadge`), match indicator (Check/X icon), score (`Score.svelte`)
   - Sort: matched CFs at top by `|score|` desc, unmatched at bottom
   - **Do NOT filter zero-score matched CFs** (entity-testing filters them — simulator must not)

   C. **Condition Detail (expanded row)** — sub-table per CF:
   - Columns: conditionName, conditionType, expected, actual, passes (Check/X icon)
   - Visual flags for negate and required
   - N/A display for `indexer_flag` and `size` condition types

   **States**:
   - Empty: instructional text "Enter a release title to see scoring results."
   - Loading: `opacity-60` on previous results + `Loader2` spinner
   - Results: full display
   - Accessibility: `aria-live="polite"` wrapper

   **Reactive**:

   ```typescript
   $: releaseResult = result?.results?.[0] ?? null;
   $: matchedCfs = releaseResult?.cfMatches?.filter((cf) => cf.matches) ?? [];
   $: unmatchedCfs =
     releaseResult?.cfMatches?.filter((cf) => !cf.matches) ?? [];
   ```

#### Acceptance Criteria

- [ ] Parsed metadata badges render for all non-null attributes
- [ ] CF table shows all matched CFs including zero-score matches
- [ ] Expandable rows show per-condition pass/fail detail
- [ ] N/A conditions display clearly
- [ ] Loading state dims previous results
- [ ] Empty state shows guidance text
- [ ] `aria-live="polite"` on results wrapper
- [ ] No `$state`/`$derived` runes

#### Risks

- RISK-07: Do NOT copy entity-testing's `score !== 0` filter
- RISK-08: Condition detail only renders on expand (ExpandableTable handles this)

---

### TASK-09: ScoreBreakdown Component

**Batch**: 3 (after TASK-02)
**Blocked by**: TASK-02
**Blocks**: TASK-10
**Complexity**: Medium | **LOC**: 130 | **Reuse**: 50%
**Must-read docs**: `research-ux.md`, `analysis-patterns.md` section T8

#### Description

Build the score breakdown component with total score display, threshold indicators, and per-CF contribution list.

#### Files to Create

1. **`packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ScoreBreakdown.svelte`** (~130 LOC)

   **Props**:

   ```typescript
   export let profileScore: SimulateProfileScore | null;
   ```

   **Sections**:

   A. **Total Score** — `Score.svelte` with color-coded sign prefix (existing component)

   B. **Threshold Indicators** — Badge components showing:
   | Condition | Label | Color |
   |-----------|-------|-------|
   | `totalScore < minimumScore` | "Below Minimum" | Red |
   | `minimumScore <= totalScore < upgradeUntilScore` | "Accepted - Upgrades Enabled" | Green |
   | `totalScore >= upgradeUntilScore` | "Upgrade Until Reached" | Green (muted) |

   C. **Contribution List** — sorted by `|score|` descending:
   - Each row: `CustomFormatBadge` + `Score.svelte` for the contribution amount
   - Zero-score matches shown with muted styling (not hidden)

   **Empty state**: When `!profileScore`, show "Select a profile to see score breakdown."

#### Acceptance Criteria

- [ ] Total score displayed with correct color coding
- [ ] Three threshold states render correctly
- [ ] Contribution list sorted by absolute score descending
- [ ] Zero-score contributions shown (muted style)
- [ ] Empty state when no profile selected
- [ ] Uses Radarr-native threshold terminology
- [ ] No `$state`/`$derived` runes

#### Risks

- RISK-09: Threshold semantics — "Upgrade Until Reached" means NO more upgrades, not "upgrade triggered"

---

### TASK-10: Main Page Integration

**Batch**: 4 (after all Batch 3 tasks)
**Blocked by**: TASK-02, TASK-04, TASK-05, TASK-06, TASK-07, TASK-08, TASK-09
**Blocks**: TASK-11
**Complexity**: Medium | **LOC**: 80 | **Reuse**: 55%
**Must-read docs**: `feature-spec.md` (UX section), `analysis-patterns.md` section T4b page shell

#### Description

Wire all components into the main page. This is the final integration point that connects the API, route data, and UI components.

#### Files to Create

1. **`packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte`** (~180 LOC total including shell)

   **Wiring**:
   - `PageData` from `./$types` (databases, currentDatabase, qualityProfiles, parserAvailable)
   - Database `Tabs` component with hrefs to `/score-simulator/${db.id}`
   - Parser warning via `alertStore.add('warning', 'Parser service unavailable...', 0)` on mount
   - localStorage persistence for last-used title, profile, arrType

   **State management**:

   ```typescript
   let releaseTitle = '';
   let mediaType: 'movie' | 'series' = 'movie';
   let selectedArrType: 'radarr' | 'sonarr' | null = null;
   let selectedProfileName: string | null = null;
   let simulationResult: SimulateScoreResponse | null = null;
   let isSimulating = false;
   let debounceTimer: ReturnType<typeof setTimeout> | null = null;
   ```

   **simulate() function**:

   ```typescript
   async function simulate() {
     if (!releaseTitle.trim() || !selectedProfileName || !selectedArrType)
       return;
     isSimulating = true;
     try {
       const response = await fetch('/api/v1/simulate/score', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           databaseId: data.currentDatabase.id,
           releases: [
             { id: crypto.randomUUID(), title: releaseTitle, type: mediaType },
           ],
           profileNames: [selectedProfileName],
           arrType: selectedArrType,
         }),
       });
       if (!response.ok) {
         /* handle error via alertStore */
       }
       simulationResult = await response.json();
     } catch {
       alertStore.add('error', 'Failed to simulate scores');
     } finally {
       isSimulating = false;
     }
   }
   ```

   **Layout**: Split-pane

   ```html
   <div class="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_3fr]">
     <ReleaseInput
       ...
       on:input="{onTitleInput}"
       on:profileChange="{simulate}"
     />
     <div>
       <SimulationResults {result} {selectedProfileName} {isSimulating} />
       <ScoreBreakdown profileScore="{currentProfileScore}" />
     </div>
   </div>
   ```

#### Acceptance Criteria

- [ ] Database tabs switch correctly
- [ ] Parser warning shows on mount when unavailable
- [ ] Title input triggers debounced simulate (300ms)
- [ ] Profile/arrType changes trigger immediate simulate
- [ ] Results display updates after API response
- [ ] Score breakdown shows for selected profile
- [ ] localStorage persists last-used title, profile, arrType, database
- [ ] Loading state visible during simulation
- [ ] No `$state`/`$derived` runes

---

### TASK-11: Verification + Smoke Tests

**Batch**: 5 (after TASK-10)
**Blocked by**: TASK-10
**Blocks**: nothing
**Complexity**: Low | **LOC**: 0

#### Description

Run full verification suite and manual smoke tests.

#### Steps

1. **Type check**: `deno task check` — zero errors
2. **Lint**: `deno task lint` — zero warnings
3. **Smoke test (happy path)**:
   - Navigate to `/score-simulator`
   - Verify redirect to first database
   - Select Radarr arr type
   - Select a quality profile
   - Enter: `Movie.2024.1080p.BluRay.REMUX.AVC.DTS-HD.MA.5.1-GROUP`
   - Verify: parsed metadata badges appear (source: Bluray, resolution: 1080, modifier: Remux)
   - Verify: CF matches table populates
   - Verify: score breakdown shows total with contributions
4. **Smoke test (parser unavailable)**:
   - Stop parser service
   - Navigate to simulator page
   - Verify: warning banner appears
   - Verify: no 500 errors in console
5. **Smoke test (no databases)**:
   - Temporarily unlink all databases
   - Navigate to `/score-simulator`
   - Verify: EmptyState renders with link to databases page
6. **Smoke test (nav)**:
   - Verify: "Score Simulator" appears in sidebar under Policies group

#### Acceptance Criteria

- [ ] `deno task check` exits 0
- [ ] `deno task lint` exits 0
- [ ] All 4 smoke tests pass
- [ ] No console errors during testing

---

## Dependency Graph (Visual)

```
Batch 1 (parallel):
  TASK-01 ──┐
  TASK-03   │  (independent)
  TASK-04   │  (independent)
  TASK-05   │  (independent)
            │
Batch 2:    ▼
  TASK-02 ──┬──────────────────────────────┐
            │                              │
Batch 3:    ▼ (parallel)                   │
  TASK-06 ──┤                              │
  TASK-07 ──┤                              │
  TASK-08 ──┤                              │
  TASK-09 ──┤                              │
            │                              │
Batch 4:    ▼                              ▼
  TASK-10 ◄── (also needs TASK-04, TASK-05)
            │
Batch 5:    ▼
  TASK-11
```

---

## Anti-Patterns Checklist

Before submitting any task for review, verify:

- [ ] No `$state`/`$derived` runes (Svelte 5 runes forbidden per CLAUDE.md)
- [ ] No `any` type (use generated types from `$api/v1.d.ts`)
- [ ] No 500 on parser unavailability (return 200 with `parserAvailable: false`)
- [ ] No client-side score computation (server returns pre-computed `profileScores`)
- [ ] No re-implementing `all`/arr-type score precedence (call `scoring()`)
- [ ] No filtering zero-score matched CFs (show all matches)
- [ ] No implicit arr_type defaulting (require explicit user selection)
- [ ] No hand-editing `v1.d.ts` (always regenerate)
- [ ] `satisfies` type annotation on all `return json(...)` calls
- [ ] Route at top-level `/score-simulator` (not nested under `/quality-profiles`)

---

## Post-Phase 1 (Out of Scope)

These are Phase 2/3 features explicitly excluded from this plan:

- Side-by-side profile comparison (ProfileComparison component)
- Batch release input (multiple titles)
- Example release title presets
- What-if scoring (temporary overrides)
- URL parameter sharing
- "Simulate" button on quality profile scoring page
- Unit/integration/e2e tests (Phase 3)
