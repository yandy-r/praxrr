# Technical Specifications: score-simulator-phase3

## Executive Summary

Phase 3 adds four capabilities to the score simulator: deep-link from quality profile scoring pages,
what-if score overrides for temporary experimentation, URL parameter encoding for shareable state,
and comprehensive test coverage. The recommended approach is **API-extended what-if** (Option B) via
an optional `scoreOverrides` field on the existing `POST /api/v1/simulate/score` request, which
keeps the server as the single source of scoring truth while requiring minimal schema changes. URL
state uses a compact JSON-in-base64 encoding with graceful truncation for long batch inputs.

## Architecture Design

### Component Diagram

```
Quality Profile Scoring Page
  /quality-profiles/[databaseId]/[id]/scoring
    |
    | "Simulate" button (new)
    | builds deep-link URL with profile + arrType params
    v
Score Simulator Page
  /score-simulator/[databaseId]?profile=Name&arrType=radarr&...
    |
    +-- URL State Manager (new module)         -- reads/writes URL search params
    |     parses on mount, pushes on state change
    |
    +-- What-If Overlay (new component)        -- per-CF score override UI
    |     renders inline score editor cells
    |     stores overrides as Map<cfName, number>
    |
    +-- Existing components (modified)
    |     ReleaseInput, SimulationResults, ScoreBreakdown,
    |     BatchInput, RankingTable, ComparisonView, etc.
    |
    v
API: POST /api/v1/simulate/score
  (extended with optional scoreOverrides field)
    |
    v
Server scoring pipeline
  existing: resolve profiles -> evaluate CFs -> compute scores
  new: apply scoreOverrides map before totalScore computation
```

### New Components and Modules

| File                                                                              | Purpose                                                        |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `.../score-simulator/[databaseId]/urlState.ts`                                    | URL search param serialization/deserialization, state sync     |
| `.../score-simulator/[databaseId]/components/WhatIfOverlay.svelte`                | Inline score override editor rendered per-CF in ScoreBreakdown |
| `.../quality-profiles/[databaseId]/[id]/scoring/components/SimulateButton.svelte` | Deep-link button to score simulator                            |

### Integration Points

1. **Scoring page to simulator**: The `SimulateButton` component on the scoring page constructs a
   URL using the current profile name, database ID, and the inferred arrType from the scoring page's
   active sort column or first arr type.
2. **URL state to page state**: On mount, `urlState.ts` reads `URLSearchParams` and returns initial
   values for `releaseTitle`, `mediaType`, `selectedProfileName`, `batchRawText`,
   `comparisonProfileName`, and `scoreOverrides`. On state changes, it calls `replaceState` to
   update the URL without navigation.
3. **Score overrides to API**: The `scoreOverrides` map is serialized into the existing
   `POST /api/v1/simulate/score` request body. The server applies overrides during the scoring loop,
   replacing the stored score for any CF that has an override entry.
4. **Config Impact Simulator (#30) interface**: The what-if override data model
   (`Map<cfName, number>`) is designed to be consumable by a future sandbox system. When #30
   introduces PCD sandbox ops, the override map can be converted to temporary ops for full cache
   recompilation.

## Data Models

### Score Override Types

```typescript
/**
 * A single CF score override for what-if simulation.
 * The key is the custom format name; the value is the temporary score.
 */
export type ScoreOverrideMap = Record<string, number>;

/**
 * Per-profile score overrides. Keys are profile selector strings
 * (e.g. 'pcd:ProfileName' or 'trash:1:Name').
 */
export interface ScoreOverrides {
  [profileSelector: string]: ScoreOverrideMap;
}

/**
 * Extended simulation request with optional score overrides.
 */
export interface SimulateScoreRequestWithOverrides {
  databaseId: number;
  releases: SimulateReleaseInput[];
  profileNames: string[];
  arrType: 'radarr' | 'sonarr';
  scoreOverrides?: ScoreOverrides;
}
```

### URL State Schema

```typescript
/**
 * All URL-encodable state for the score simulator.
 * Serialized as individual search params for simple values,
 * JSON-in-base64 for complex values (overrides, batch titles).
 */
export interface SimulatorUrlState {
  /** Single release title */
  title?: string;
  /** Media type: 'movie' | 'series' */
  mediaType?: 'movie' | 'series';
  /** Primary profile selector */
  profile?: string;
  /** Comparison profile selector */
  compare?: string;
  /** Arr type for deep-link entry */
  arrType?: 'radarr' | 'sonarr';
  /** Batch titles (newline-separated, base64-encoded if > 200 chars) */
  batch?: string;
  /** Batch media type */
  batchMediaType?: 'movie' | 'series';
  /** Batch primary profile */
  batchProfile?: string;
  /**
   * Score overrides (base64-encoded JSON).
   * Only included when overrides are active.
   * Format: base64(JSON.stringify(ScoreOverrides))
   */
  overrides?: string;
}
```

**URL param mapping:**

| Param       | Source           | Example                          |
| ----------- | ---------------- | -------------------------------- |
| `title`     | Plain string     | `?title=Movie.2024.1080p.BluRay` |
| `mediaType` | Literal          | `&mediaType=movie`               |
| `profile`   | Profile selector | `&profile=pcd%3AHD+Bluray`       |
| `compare`   | Profile selector | `&compare=pcd%3AWeb+1080p`       |
| `arrType`   | Literal          | `&arrType=radarr`                |
| `batch`     | Base64           | `&batch=VGl0bGUuT25l...`         |
| `overrides` | Base64 JSON      | `&overrides=eyJwY2Q6...`         |

### Test Fixtures

```typescript
// Located in packages/praxrr-app/src/tests/routes/

/** Fixture: minimal simulation response for override testing */
export const OVERRIDE_FIXTURE_RESPONSE: SimulateScoreResponse = {
  parserAvailable: true,
  results: [
    {
      id: 'test-1',
      title: 'Movie.2024.2160p.WEB-DL.DDP5.1.H.265-GROUP',
      parsed: {
        source: 'WebDl',
        resolution: '2160p',
        modifier: 'None',
        languages: ['English'],
        year: 2024,
      },
      cfMatches: [
        { name: 'WEB-DL', matches: true, conditions: [] },
        { name: 'DDP5.1', matches: true, conditions: [] },
        { name: 'H.265', matches: true, conditions: [] },
      ],
      profileScores: [
        {
          profileName: 'pcd:HD Bluray',
          totalScore: 25,
          minimumScore: 0,
          upgradeUntilScore: 10000,
          contributions: [
            { cfName: 'WEB-DL', score: 15 },
            { cfName: 'DDP5.1', score: 5 },
            { cfName: 'H.265', score: 5 },
          ],
        },
      ],
    },
  ],
};
```

## API Design

### Option Analysis: What-If Implementation

| Criterion                | Option A: Client-Side                                                                                            | Option B: API Extension                                            | Option C: PCD Sandbox                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------ |
| **Accuracy**             | Low -- client must replicate server scoring logic including `all` vs arr-type precedence, TRaSH score resolution | High -- server applies overrides in the authoritative scoring loop | Highest -- full cache recompilation  |
| **Complexity**           | Medium -- duplicate scoring logic on client                                                                      | Low -- ~20 lines added to server scoring loop                      | High -- full sandbox cache lifecycle |
| **Performance**          | Fast (no network)                                                                                                | Same as current (network round-trip)                               | Slow (cache rebuild per change)      |
| **Future compatibility** | Must be rewritten for #30                                                                                        | Override map reusable by #30 sandbox                               | Native #30 integration               |
| **Data drift risk**      | High -- client/server scoring divergence                                                                         | None                                                               | None                                 |
| **New dependencies**     | None                                                                                                             | None                                                               | Sandbox cache manager                |

**Recommendation: Option B (API Extension)**

The server already has the complete scoring pipeline. Adding an optional `scoreOverrides` field to
the existing request is minimal work (~20 LoC in the scoring loop), avoids duplicating scoring logic
on the client, and the override data model naturally extends to the future Config Impact Simulator.
The network round-trip is already present for every simulation; adding overrides to the payload adds
negligible latency.

### Proposed API Changes

**Request change to `POST /api/v1/simulate/score`:**

Add optional `scoreOverrides` field:

```yaml
# In docs/api/v1/schemas/score-simulator.yaml

SimulateScoreOverrides:
  type: object
  description: |
    Per-profile CF score overrides for what-if simulation.
    Keys are profile selector strings, values are objects mapping
    CF names to override scores.
  additionalProperties:
    type: object
    additionalProperties:
      type: integer

SimulateScoreRequest:
  type: object
  required:
    - databaseId
    - releases
    - profileNames
    - arrType
  properties:
    databaseId:
      type: integer
      description: PCD database instance ID
    releases:
      type: array
      maxItems: 50
      description: Release titles to simulate (max 50)
      items:
        $ref: '#/SimulateReleaseInput'
    profileNames:
      type: array
      maxItems: 10
      description: Quality profile names to score against (max 10)
      items:
        type: string
    arrType:
      type: string
      enum:
        - radarr
        - sonarr
      description: Arr type for score column resolution
    scoreOverrides:
      $ref: '#/SimulateScoreOverrides'
      description: Optional per-profile CF score overrides for what-if simulation
```

**Response change to `SimulateProfileScore`:**

Add optional `overridesApplied` boolean so the client can confirm overrides took effect:

```yaml
SimulateProfileScore:
  type: object
  required:
    - profileName
    - totalScore
    - minimumScore
    - upgradeUntilScore
    - contributions
  properties:
    # ... existing fields unchanged ...
    overridesApplied:
      type: boolean
      description: True when scoreOverrides were applied to this profile's scoring
```

**Server-side scoring loop change** (in `+server.ts`, inside the `resolvedProfiles.map` callback):

```typescript
// After resolving the base score for a matched CF:
const overrideMap = body.scoreOverrides?.[profile.requestKey];
if (overrideMap && cfMatch.name in overrideMap) {
  score = overrideMap[cfMatch.name];
}
```

### OpenAPI Schema Changes

1. Add `SimulateScoreOverrides` schema to `docs/api/v1/schemas/score-simulator.yaml`
2. Add `scoreOverrides` optional property to `SimulateScoreRequest`
3. Add `overridesApplied` optional boolean to `SimulateProfileScore`
4. Run `deno task generate:api-types` to regenerate `packages/praxrr-app/src/lib/api/v1.d.ts`

## System Constraints

### Performance

| Constraint                  | Target                  | Notes                                                            |
| --------------------------- | ----------------------- | ---------------------------------------------------------------- |
| URL state sync latency      | < 16ms (single frame)   | `replaceState` is synchronous; debounce writes to 300ms          |
| What-if re-simulation       | < 3s for single release | Same as current simulation; overrides add negligible server cost |
| What-if batch re-simulation | < 6s for 50 releases    | Same as current batch; overrides add negligible cost             |
| URL parse on mount          | < 5ms                   | Simple param extraction + base64 decode                          |

### URL Length

**Problem**: Browser URL length limits are approximately 2000 characters (IE legacy) to 64KB (modern
browsers). SvelteKit `replaceState` uses the History API which has no practical limit, but shareable
URLs (copy/paste, bookmarks) should stay under 2000 characters.

**Strategy:**

1. **Simple params fit easily**: `title`, `mediaType`, `profile`, `compare`, `arrType` together use
   ~200 characters max.
2. **Batch titles**: Base64-encode newline-joined titles. 50 titles at ~80 chars each = ~4000 chars
   raw, ~5400 base64. Exceeds 2000-char limit.
   - **Mitigation**: Only encode the first N titles that fit within a 1500-char budget for the
     `batch` param. The rest are lost on share but retained in the browser session via component
     state. Display a warning: "URL truncated to N of M titles for sharing."
3. **Score overrides**: Base64 JSON. A typical override map with 10 entries is ~300 chars base64.
   Fits comfortably.
4. **Fallback**: If total URL exceeds 2000 chars, drop `batch` and `overrides` params, keeping only
   simple params. Show a toast: "State too large for URL sharing. Use copy/paste for batch titles."

### Test Performance

| Test Suite                             | Target        | Notes                                                             |
| -------------------------------------- | ------------- | ----------------------------------------------------------------- |
| Unit tests (helpers, urlState)         | < 500ms total | Pure functions, no I/O                                            |
| API integration tests (scoreOverrides) | < 5s per test | Uses parser stub from existing `simulateScoreRoute.test.ts`       |
| E2e deep-link flow                     | < 30s         | Navigate scoring page -> click simulate -> verify simulator loads |
| E2e what-if flow                       | < 45s         | Modify override -> verify score recalculation                     |

## Codebase Changes

### Files to Create

| File                                                                                                         | Purpose                                                                    |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `packages/praxrr-app/src/routes/score-simulator/[databaseId]/urlState.ts`                                    | URL search param serialization, deserialization, and replaceState sync     |
| `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/WhatIfOverlay.svelte`                | Per-CF inline score override editor UI                                     |
| `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/scoring/components/SimulateButton.svelte` | Deep-link button component for scoring page                                |
| `packages/praxrr-app/src/tests/routes/scoreSimulatorUrlState.test.ts`                                        | Unit tests for URL state serialization/deserialization                     |
| `packages/praxrr-app/src/tests/routes/scoreSimulatorWhatIf.test.ts`                                          | Unit tests for what-if override application helpers                        |
| `packages/praxrr-app/src/tests/routes/simulateScoreOverrides.test.ts`                                        | API integration tests for scoreOverrides on the simulate endpoint          |
| `packages/praxrr-app/src/tests/e2e/specs/4.1-score-simulator-deep-link.spec.ts`                              | E2e: scoring page -> simulate button -> simulator page with correct params |
| `packages/praxrr-app/src/tests/e2e/specs/4.2-score-simulator-url-state.spec.ts`                              | E2e: URL params populate simulator state on page load                      |
| `packages/praxrr-app/src/tests/e2e/specs/4.3-score-simulator-what-if.spec.ts`                                | E2e: modify CF score override -> verify recalculated total                 |

### Files to Modify

| File                                                                                           | Changes                                                                                                              |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `docs/api/v1/schemas/score-simulator.yaml`                                                     | Add `SimulateScoreOverrides` schema, `scoreOverrides` to request, `overridesApplied` to profile score                |
| `packages/praxrr-app/src/lib/api/v1.d.ts`                                                      | Regenerated via `deno task generate:api-types`                                                                       |
| `packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts`                              | Validate `scoreOverrides`, apply overrides in scoring loop (~30 LoC)                                                 |
| `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte`                     | Read URL state on mount, write URL state on changes, pass overrides to API calls, render WhatIfOverlay               |
| `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.server.ts`                  | No changes needed (URL params are client-side)                                                                       |
| `packages/praxrr-app/src/routes/score-simulator/[databaseId]/helpers.ts`                       | Add `applyScoreOverridesToContributions()` helper for client-side display recalculation when showing override deltas |
| `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ScoreBreakdown.svelte` | Render what-if override indicators (original vs. overridden score)                                                   |
| `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/scoring/+page.svelte`       | Import and render `SimulateButton` in the sticky card header                                                         |
| `scripts/test.ts`                                                                              | Add aliases for new test files: `url-state`, `what-if`, `overrides`                                                  |

### Dependencies

No new dependencies. All functionality uses existing infrastructure:

- `$app/stores` (`page`) and `$app/navigation` (`replaceState`, `goto`) for URL state
- Existing fetch-based API client pattern for extended request body
- Existing Deno test runner and Playwright for testing

## Technical Decisions

### Decision 1: What-If Implementation Strategy

**Options:**

- A) Client-side score recalculation
- B) API extension with `scoreOverrides` field
- C) PCD sandbox with temporary ops

**Recommendation: B -- API extension**

**Rationale:** The scoring pipeline has nuances (arr-type precedence, TRaSH score set resolution,
`all` fallback logic) that are non-trivial to replicate on the client. Option B adds ~30 lines to
the server endpoint, avoids logic duplication, and the override map data structure
(`Record<string, Record<string, number>>`) naturally serves as input to the future Config Impact
Simulator (#30) sandbox. Option C is the ideal end-state but requires significant infrastructure
(sandbox cache lifecycle, temporary op management) that is out of scope for Phase 3.

### Decision 2: URL State Encoding

**Options:**

- A) All state in individual search params (e.g.,
  `?title=X&profile=Y&override_CF1=5&override_CF2=10`)
- B) Simple params for scalars, base64 JSON for complex objects
- C) Full state as single compressed base64 blob

**Recommendation: B -- Hybrid encoding**

**Rationale:** Option A becomes unwieldy with score overrides (one param per CF per profile). Option
C loses human readability of simple params like `profile` and `arrType`, making deep-links from the
scoring page opaque. Option B gives clean deep-link URLs (`?profile=pcd%3AHD+Bluray&arrType=radarr`)
while compactly encoding overrides when present. The `batch` and `overrides` params are the only
ones that use base64, and they are optional.

### Decision 3: Test Organization

**Options:**

- A) Single large test file for all Phase 3 features
- B) Separate test files per feature (urlState, whatIf, apiOverrides, e2e)
- C) Extend existing test files

**Recommendation: B -- Separate files per feature**

**Rationale:** Follows the existing pattern where `scoreSimulatorHelpers.test.ts` and
`scoreSimulatorPhase2Helpers.test.ts` are separate files. The URL state module is a new unit with
its own serialization logic deserving isolated tests. The API override tests extend the existing
`simulateScoreRoute.test.ts` pattern (in-memory SQLite + parser stub) but are a new concern. E2e
tests follow the existing `N.M-description.spec.ts` naming convention under `4.x` for score
simulator flows.

### Decision 4: Deep-Link Entry Point

**Options:**

- A) Add "Simulate" button in the scoring page's `StickyCard` header bar
- B) Add "Simulate" link in each row of the scoring table
- C) Add a floating action button

**Recommendation: A -- Header bar button**

**Rationale:** The scoring page header already contains action buttons (Info, Options, Save). A
"Simulate" button fits naturally alongside them. Per-row links (Option B) are noisy and the
simulator operates on the full profile, not individual CFs. The deep-link passes the profile name
and inferred arrType from the current sort state. The button component is simple:
`<a href="/score-simulator/{databaseId}?profile={encodedProfileSelector}&arrType={arrType}">`.

### Decision 5: Score Override Scope

**Options:**

- A) Global overrides (same override map for all profiles in the request)
- B) Per-profile overrides (different override map per profile selector)

**Recommendation: B -- Per-profile overrides**

**Rationale:** The primary use case is "what if I change CF X's score in Profile A but not Profile
B?" Per-profile scoping allows comparison views to show the impact of targeted score changes. The
data model uses `Record<profileSelector, Record<cfName, number>>` which neatly maps to the server's
existing per-profile scoring loop.

## Relevant Files

- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte`: Main page component
  with all simulator state management
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/helpers.ts`: Pure scoring helper
  functions (Phase 1 + Phase 2)
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.server.ts`: Server load
  function providing databases, profiles, parser status
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ReleaseInput.svelte`:
  Release input with profile selector
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ScoreBreakdown.svelte`:
  Per-CF score display (override indicators go here)
- `packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts`: API endpoint with full scoring
  pipeline (~926 LoC)
- `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/scoring/+page.svelte`: Scoring
  page where "Simulate" button is added
- `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/scoring/+page.server.ts`:
  Scoring page server load (profile name resolution)
- `docs/api/v1/schemas/score-simulator.yaml`: OpenAPI schema for simulate endpoint
- `docs/api/v1/paths/score-simulator.yaml`: OpenAPI path for simulate endpoint
- `packages/praxrr-app/src/tests/routes/scoreSimulatorHelpers.test.ts`: Existing Phase 1 helper
  tests (pattern to follow)
- `packages/praxrr-app/src/tests/routes/scoreSimulatorPhase2Helpers.test.ts`: Existing Phase 2
  helper tests (pattern to follow)
- `packages/praxrr-app/src/tests/routes/simulateScoreRoute.test.ts`: Existing API integration tests
  (in-memory DB + parser stub pattern)
- `packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/scoring/read.ts`: Server-side
  score resolution (arr-type precedence logic)
- `packages/praxrr-app/src/lib/server/pcd/database/cache.ts`: PCDCache class (sandbox understanding
  for #30 interface)
- `packages/praxrr-app/src/lib/server/pcd/database/registry.ts`: Cache registry (sandbox cache would
  need a parallel registry or temporary entries)
- `scripts/test.ts`: Test runner with alias map (add new aliases)
- `playwright.config.ts`: E2e test configuration (testDir, timeout)

## Open Questions

1. **Override persistence across page reloads**: Should score overrides survive a full page reload
   (via URL params) or be session-only? The current design encodes them in URL params (base64 JSON),
   but very large override sets could exceed URL length limits. Decision: encode in URL up to the
   2000-char budget, drop if too large.

2. **Override visual design**: How should overridden scores appear in the ScoreBreakdown component?
   Options: strikethrough original + new value, color-coded diff indicator, inline edit field. This
   is a UX decision that does not affect the technical architecture.

3. **TRaSH profile override support**: The current API supports TRaSH profile selectors
   (`trash:sourceId:Name`). Should what-if overrides also apply to TRaSH profiles? The data model
   supports it (override keys are profile selectors), but the TRaSH scoring path uses a different
   score resolution chain. Decision: support it -- the override application point is after score
   resolution, so it works identically for both PCD and TRaSH profiles.

4. **Deep-link arrType inference**: The scoring page does not explicitly track which arrType the
   user is viewing scores for. The current sort state key (`radarr` | `sonarr` | `name`) can be used
   as a heuristic, defaulting to `radarr` when sorting by name. Is this acceptable or should an
   explicit arrType selector be added to the scoring page?

5. **Config Impact Simulator (#30) handoff**: The `ScoreOverrides` type is designed as a portable
   interface. When #30 introduces sandbox ops, the conversion path would be: `ScoreOverrides` ->
   temporary `quality_profile_custom_formats` update ops -> sandbox cache recompilation. This
   conversion logic should live in a shared module under `$pcd/` rather than in the score simulator
   route. Confirm this architectural boundary.
