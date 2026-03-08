# Business Logic Research: Score Simulator Phase 3

## Executive Summary

Phase 3 bridges the score simulator from a standalone evaluation tool into an integrated workflow
component. The three core additions -- deep-link from quality profile scoring, what-if score
overrides, and URL-encoded shareable state -- transform the simulator into a feedback loop where
users can experiment with scoring changes, visualize their impact on real releases, and share
findings with collaborators. The Config Impact Simulator integration (#30) provides the underlying
sandbox mechanism for what-if scoring without mutating live PCD data.

## User Stories

### Primary User: Configuration Author (PCD Database Maintainer)

- As a PCD author editing CF scores on the quality profile scoring page, I want a "Simulate" button
  that opens the score simulator pre-filled with my current database and profile, so that I can
  immediately test how my scoring changes affect real release rankings without manually navigating
  and re-selecting context.
- As a PCD author, I want to temporarily override individual CF scores in the simulator and see
  real-time total score recalculation, so that I can experiment with "what if I changed X to Y?"
  without committing ops to `pcd_ops`.
- As a PCD author, I want to share a URL containing my simulator state (release titles, profile
  selection, what-if overrides) with a collaborator so they can reproduce my exact scenario.

### Secondary User: Self-Hoster (End User)

- As a self-hoster, I want to experiment with score tweaks in the simulator before deciding to save
  them to PCD, so that I can preview the impact of changes on my grab quality without risk.
- As a self-hoster, I want to bookmark a simulator URL with my test releases and profile so I can
  quickly re-test after upstream PCD updates.
- As a self-hoster, I want to see the delta between my current live scores and my what-if overrides
  for each CF, so I understand exactly what would change.

### Tertiary User: New User (Onboarding)

- As a new user, I want to follow a shared URL into the simulator with pre-configured state, so I
  can see scoring in action without needing to understand PCD configuration first.
- As a new user, I want clear visual distinction between "live" scores and "what-if" overrides in
  the simulator, so I am not confused about which scores are actually applied.

## Business Rules

### "Simulate" Button Rules

1. **Placement**: The button belongs on the quality profile scoring page
   (`/quality-profiles/[databaseId]/[id]/scoring`), in the sticky card header alongside Save and
   Info buttons.
2. **Context Passing**: The button navigates to `/score-simulator/[databaseId]` with URL search
   params that encode the profile context:
   - `profile` -- the profile selector value (e.g., `pcd:Profile%20Name`)
   - `arrType` -- inferred from the scoring page's `arrTypes` array (default to `radarr` if multiple
     are available, since the scoring page itself is arr-agnostic but the simulator requires a
     single `arrType`)
3. **Pre-fill Behavior**: On mount, the simulator reads these URL params and sets the corresponding
   reactive state (`selectedProfileName`, `mediaType` derived from `arrType`).
4. **No Dirty Guard Interaction**: Navigating to the simulator via this button should not trigger
   the dirty store's navigation warning on the scoring page, because the button performs a standard
   navigation (not a form submission). However, if the user has unsaved scoring changes, the
   existing dirty guard will warn them before leaving.
5. **Return Path**: No explicit back-link is required. Standard browser back navigation suffices.
   The scoring page's state is server-loaded (via `+page.server.ts`) and will re-render fresh.

### What-If Scoring Rules

1. **Override Scope**: Users can temporarily override the `score` value for any individual
   CF-profile pair that appears in the `contributions` array of the simulation response. Overrides
   are applied client-side before display, not sent to the API.
2. **Override Model**: A what-if override is a map of `{ [cfName: string]: number }` keyed per
   profile selector. The override replaces the server-returned score for that CF contribution when
   computing the displayed `totalScore`.
3. **Precedence**: What-if overrides take precedence over server-returned scores. The original
   server score is preserved and shown alongside (e.g., strikethrough or faded) for comparison.
4. **Recalculation**: When an override is added or changed, the total score and threshold state
   (`below`/`accepted`/`upgrade-reached`) must be recomputed immediately from the full contributions
   array with the override applied. This is purely client-side arithmetic -- no API call needed.
5. **Isolation**: What-if overrides never persist to PCD. They exist only in client memory and
   optionally in URL state. Closing the tab or navigating away loses them unless URL state is used.
6. **Reset**: Users can reset all overrides (return to server-returned scores) or reset individual
   CF overrides. A visual indicator must show when any override is active.
7. **Batch Mode Interaction**: What-if overrides apply across all releases in a batch simulation.
   When an override changes, the ranking table re-sorts using the overridden total scores. No
   re-fetch is needed since CF matching is independent of scores.
8. **CF Coverage**: Only CFs that appear in the profile's scoring data can be overridden. Users
   cannot add new CF score mappings via what-if (that would require PCD ops).
9. **Score Bounds**: Override scores must be integers (matching PCD's `score` column type). No
   minimum/maximum bounds are enforced (negative scores are valid business logic for blocking).

### URL State Rules

1. **Encoded Parameters**: The URL search params encode the following simulator state:
   - `db` -- database ID (number, already in the path, but included for completeness when sharing)
   - `profile` -- primary profile selector string
   - `profile2` -- comparison profile selector string (optional)
   - `arrType` -- `radarr` or `sonarr`
   - `title` -- single release title (for single-input mode)
   - `titles` -- base64-encoded newline-separated batch titles (for batch mode, to avoid URL length
     issues)
   - `overrides` -- JSON-encoded what-if overrides map, base64-encoded
2. **URL Length Limits**: Total URL length should stay under 2,000 characters for broad browser
   compatibility. Batch titles and overrides use base64 encoding. If the encoded state exceeds this
   limit, degrade gracefully: omit `titles` and/or `overrides` from the URL and show a warning that
   the state is too large to share.
3. **Read on Mount**: URL params are read once during `onMount`. They populate reactive state but do
   not create a two-way binding. Subsequent user interactions do not automatically update the URL.
4. **Write on Explicit Action**: A "Copy Share Link" button serializes current state to URL params
   and copies the full URL to clipboard. This is the only action that writes state to URL.
5. **Backward Compatibility**: Unknown URL params are silently ignored. Missing params fall back to
   defaults (no profile, movie media type, empty title).
6. **Validation**: Malformed param values (invalid base64, non-numeric database ID, unknown arrType)
   are silently discarded with defaults applied. No error is shown for bad URL params.

### Test Coverage Rules

1. **Unit Tests** (Deno test, `src/tests/`):
   - Score computation helpers in `helpers.ts` -- override application, total recalculation,
     threshold state with overrides
   - URL state serialization/deserialization round-trip
   - Edge cases: empty overrides, overrides for non-existent CFs, overrides that change threshold
     state
2. **Integration Tests** (Deno test, `src/tests/routes/`):
   - API endpoint continues to work unchanged (Phase 3 does not modify the API)
   - Server-side data loading for the scoring page includes correct profile context for deep-link
3. **E2E Tests** (Playwright, `src/tests/e2e/`):
   - Navigate from scoring page to simulator via "Simulate" button, verify pre-fill
   - Apply what-if override, verify total score updates
   - Copy share link, open in new context, verify state restoration
   - Reset overrides, verify return to original scores
4. **Coverage Targets**: All new helper functions should have 100% branch coverage. UI interaction
   paths should cover happy path + primary error path (e.g., parser unavailable).

## Workflows

### Workflow 1: QP Scoring -> Simulator Deep Link

1. User navigates to `/quality-profiles/[databaseId]/[id]/scoring`.
2. User sees the scoring table with CF scores per arr type.
3. User clicks the "Simulate" button in the sticky card header.
4. Browser navigates to
   `/score-simulator/[databaseId]?profile=pcd:<encodedProfileName>&arrType=radarr`.
5. Score simulator page mounts, reads URL params.
6. `selectedProfileName` is set from `profile` param. `mediaType` is set based on `arrType` param
   (`radarr` -> `movie`, `sonarr` -> `series`).
7. User enters a release title and sees score breakdown for the pre-selected profile.

### Workflow 2: What-If Score Override

1. User has a simulation result displayed with score breakdown.
2. User clicks an "edit" icon next to a CF contribution score (e.g., "DV HDR10: +1500").
3. An inline number input appears, pre-filled with the current score.
4. User changes the value to a new score (e.g., +2000).
5. The contribution row shows the override value with a visual indicator (e.g., blue highlight, with
   original value shown as strikethrough).
6. `totalScore` recalculates immediately using the override. Threshold badge updates if the new
   total crosses a boundary.
7. In batch mode, the ranking table re-sorts based on updated total scores.
8. User can click a "reset" icon on the row to revert to the server score.
9. User can click a global "Reset All Overrides" button to clear all what-if changes.

### Workflow 3: Share Simulator State via URL

1. User has configured a simulation: profile selected, release title entered, what-if overrides
   applied.
2. User clicks a "Share" or "Copy Link" button.
3. The system serializes current state to URL search params (profile, arrType, title/titles,
   overrides).
4. If the resulting URL exceeds 2,000 characters, the system shows a warning and omits the largest
   params (overrides first, then titles).
5. The URL is copied to clipboard. A success alert is shown.
6. A collaborator opens the shared URL.
7. The simulator page mounts, reads all params, and reconstructs the state.
8. The collaborator sees the same profile, release title(s), and what-if overrides.
9. Simulation auto-triggers on mount since profile and title are both present.

### Workflow 4: Testing Workflows

1. **Unit tests**: Run `deno task test` or target specific test files via `deno test`.
   - Test files: `src/tests/routes/scoreSimulatorPhase3Helpers.test.ts` (new)
   - Tests cover: override application to contributions, total score recalculation with overrides,
     threshold state transitions with overrides, URL state encode/decode round-trips.
2. **Integration tests**: Existing `simulateScoreRoute.test.ts` continues to pass unchanged.
3. **E2E tests**: Run `deno task test:e2e` with a running server.
   - Spec files follow existing numbering convention (e.g., `4.x-score-simulator-*.spec.ts`).
   - Tests use existing helpers (`linkPcd`, `sync`, `entity`, `dropdown`).

## Domain Model

### Key Entities

**ScoreOverride**: A client-side-only data structure representing a temporary score modification.

```typescript
interface ScoreOverrideMap {
  // Keyed by profile selector (e.g., "pcd:HD Bluray + WEB")
  [profileSelector: string]: {
    // Keyed by CF name (e.g., "DV HDR10")
    [cfName: string]: number; // The overridden score value
  };
}
```

**SimulatorUrlState**: The serializable subset of simulator state for URL encoding.

```typescript
interface SimulatorUrlState {
  profile?: string; // Primary profile selector
  profile2?: string; // Comparison profile selector
  arrType?: 'radarr' | 'sonarr';
  title?: string; // Single release title
  titles?: string[]; // Batch release titles (base64-encoded in URL)
  overrides?: ScoreOverrideMap; // What-if overrides (base64-encoded JSON in URL)
}
```

**Sandbox Cache** (Config Impact Simulator #30 integration -- future):

The PCD system compiles ops into an in-memory SQLite database (`PCDCache`). For what-if scoring,
Phase 3 takes the simpler client-side approach (override map applied to API response). The Config
Impact Simulator (#30) would provide a server-side sandbox where temporary ops are compiled into a
separate `PCDCache` instance, never written to `pcd_ops`. This is a future integration point:

- Phase 3 what-if: Client-side override map, no server changes
- Config Impact (#30): Server-side sandbox cache compiled from temporary ops

The Phase 3 what-if model is a deliberate simplification. It does not replicate the full PCD
compilation pipeline and therefore cannot model changes that affect CF matching logic (e.g., adding
a new condition to a CF). It only models score value changes. The Config Impact Simulator would
handle the broader case.

### State Transitions

**Override Lifecycle**:

1. `inactive` -- No overrides. All scores are server-returned values.
2. `active` -- One or more CF scores have been overridden. Visual indicators show modified rows.
3. `reset` -- User clears all overrides. Returns to `inactive`. If URL state had overrides, they are
   removed from the next "Copy Link" operation.

**URL State Sync**:

1. `read` -- On mount, URL params are parsed and applied to reactive state. One-time operation.
2. `idle` -- User interacts with simulator. URL is not updated.
3. `write` -- User clicks "Copy Link". Current state is serialized to URL and copied.

## Existing Codebase Integration

### Related Features

- **Score Simulator Phase 1** (`+server.ts`, `helpers.ts`, `ReleaseInput.svelte`,
  `ScoreBreakdown.svelte`, `SimulationResults.svelte`): Foundation API and UI. Phase 3 does not
  modify the API endpoint. Client-side helpers need new functions for override application.
- **Score Simulator Phase 2** (`BatchInput.svelte`, `RankingTable.svelte`, `ComparisonView.svelte`,
  `ProfileComparison.svelte`, `PresetSelector.svelte`, `presets.ts`): Batch and comparison features.
  Phase 3 what-if overrides must integrate with batch ranking and comparison views.
- **Quality Profile Scoring Page** (`scoring/+page.svelte`, `scoring/+page.server.ts`,
  `ScoringTable.svelte`): Where the "Simulate" button will be placed. The scoring page already has
  the profile name and database ID in its route params.
- **PCD Snapshot Service** (`pcd/snapshots/service.ts`): Reference for how PCD state isolation
  works. Not directly used in Phase 3, but relevant for Config Impact Simulator planning.
- **Dirty Store** (`$lib/client/stores/dirty`): The scoring page uses `initEdit`/`update`/`isDirty`
  for unsaved changes tracking. The "Simulate" button triggers standard navigation, which will
  trigger the dirty guard if changes are unsaved.

### Patterns to Follow

- **Profile Selector Format**: Existing `pcd:` and `trash:<sourceId>:<name>` prefix conventions from
  Phase 1 API. URL params use the same format.
- **Event Dispatching**: Phase 1/2 components use `createEventDispatcher` for child-to-parent
  communication (e.g., `ReleaseInput` dispatches `input`, `profileChange`, `clear`). Phase 3
  override events should follow this pattern.
- **Request Token Pattern**: The main page uses `singleSimulationRequestToken` and
  `batchSimulationRequestToken` with `AbortController` for request cancellation. What-if overrides
  do not trigger API calls, so this pattern is not needed for overrides.
- **Reactive Declarations**: State is managed via Svelte `$:` reactive declarations (not runes, per
  project conventions). New computed values (e.g., overridden total score) should use `$:`.
- **URL Param Reading**: The TRaSH guide pages (`databases/trash/[id]/custom-formats/+page.svelte`)
  use `$page.url.searchParams.get()` in `onMount` to read URL state. This is the established pattern
  for URL-to-state hydration.
- **Test Structure**: Unit tests use `Deno.test()` with `@std/assert`. Test factories (`makeResult`,
  `makeProfileScore`) are defined inline. Existing test files for the simulator are
  `scoreSimulatorHelpers.test.ts` and `scoreSimulatorPhase2Helpers.test.ts`.
- **E2E Test Structure**: Playwright specs in `src/tests/e2e/specs/` with numerical prefixes.
  Helpers in `src/tests/e2e/helpers/`. Tests use `page.goto()`, `page.click()`, `page.fill()`.

### Components to Leverage

- **ScoreBreakdown.svelte**: Must be extended to support inline score editing for what-if overrides.
  Currently renders contributions as read-only `<li>` elements with `Score` and `CustomFormatBadge`
  components.
- **Score.svelte** (`$ui/arr/Score.svelte`): Displays score values with color coding. Can be reused
  for override display.
- **Button.svelte** (`$ui/button/Button.svelte`): For "Simulate" button on scoring page, "Copy Link"
  and "Reset Overrides" on simulator.
- **NumberInput** (`$ui/form/NumberInput.svelte`): For inline score override editing. Already used
  on the scoring page for `minimumScore`, `upgradeUntilScore`, etc.
- **Badge.svelte** (`$ui/badge/Badge.svelte`): For visual indicators of active overrides.
- **alertStore** (`$lib/client/alerts/store`): For "Link copied" and "State too large to share"
  feedback.

## Success Criteria

- [ ] "Simulate" button on scoring page navigates to simulator with correct profile pre-filled
- [ ] Simulator reads URL params on mount and populates state correctly
- [ ] What-if score overrides update total score and threshold state in real-time
- [ ] What-if overrides apply across batch mode and re-sort ranking table
- [ ] Visual distinction between live scores and overridden scores is clear
- [ ] "Copy Link" produces a URL that restores simulator state when opened
- [ ] URL gracefully degrades when state exceeds length limits
- [ ] All new helper functions have unit tests with full branch coverage
- [ ] Existing Phase 1/2 tests continue to pass unchanged
- [ ] E2E test covers the full QP scoring -> simulator -> what-if -> share flow

## Open Questions

- **arrType Inference on Scoring Page**: The scoring page shows scores for all arr types (radarr,
  sonarr). When deep-linking to the simulator, which `arrType` should be used? Options: (a) default
  to `radarr`, (b) use the currently sorted-by arr type column, (c) add a small selector to the
  simulate button. Recommendation: default to `radarr` with a note in the simulator that the user
  can change it.
- **Override Persistence Across Page Reloads**: Should what-if overrides survive a browser refresh
  via `sessionStorage`, or only persist via URL share links? Recommendation: URL only -- keep the
  implementation simple and the mental model clear.
- **Config Impact Simulator (#30) Scope for Phase 3**: How much of the sandbox cache infrastructure
  should Phase 3 implement vs defer? Recommendation: Phase 3 uses client-side override map only.
  Server-side sandbox compilation is deferred to a dedicated Config Impact Simulator feature.
- **Maximum Override Count**: Should there be a limit on how many CF scores can be overridden
  simultaneously? Profiles can have 50+ CFs. Recommendation: no artificial limit; the UI naturally
  constrains this since users edit one at a time.
- **TRaSH Profile What-If Support**: TRaSH profiles resolve scores differently (via `format_items`
  and `score_set` on the server). Client-side what-if overrides work identically for TRaSH and PCD
  profiles since they both appear as `contributions` in the API response. Confirm this is correct.

## Relevant Files

### Score Simulator (Phase 1 + 2)

- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte`: Main simulator page,
  orchestrates all state and API calls
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.server.ts`: Server-side data
  loader (databases, profiles, parser status)
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/helpers.ts`: Score computation
  helpers (getSelectedProfileScore, buildRankingFromResults, buildComparisonResult,
  parseBatchTitles)
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/presets.ts`: Example release title
  presets
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ScoreBreakdown.svelte`:
  Score display with contributions list
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ReleaseInput.svelte`:
  Title input with profile selector
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/SimulationResults.svelte`:
  CF match table with condition details
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/BatchInput.svelte`:
  Multi-line batch input
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/RankingTable.svelte`:
  Ranked results table
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ComparisonView.svelte`:
  Profile comparison display
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ProfileComparison.svelte`:
  Comparison profile selector

### Quality Profile Scoring Page

- `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/scoring/+page.svelte`: Scoring
  page where "Simulate" button will be added
- `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/scoring/+page.server.ts`:
  Server load for scoring data (profile name, database ID, scores)
- `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/scoring/components/ScoringTable.svelte`:
  Responsive scoring table wrapper

### API

- `packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts`: POST endpoint (no changes
  needed in Phase 3)
- `packages/praxrr-app/src/lib/api/v1.d.ts`: OpenAPI-generated types (SimulateScoreRequest,
  SimulateScoreResponse, SimulateProfileScore, SimulateScoreContribution)

### PCD System (Reference)

- `packages/praxrr-app/src/lib/server/pcd/index.ts`: PCD public API (cache, writer, compile)
- `packages/praxrr-app/src/lib/server/pcd/database/cache.ts`: PCDCache class (in-memory compiled
  database)
- `packages/praxrr-app/src/lib/server/pcd/core/types.ts`: Operation, WriteOptions, CacheBuildStats
- `packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/scoring/read.ts`: Scoring data
  query

### Shared Types

- `packages/praxrr-app/src/lib/shared/pcd/display.ts`: QualityProfileScoring,
  CustomFormatScoresByArrType, ProfileCfScores
- `packages/praxrr-app/src/lib/shared/pcd/types.ts`: PCDDatabase schema types

### Existing Tests

- `packages/praxrr-app/src/tests/routes/scoreSimulatorHelpers.test.ts`: Phase 1 helper tests
- `packages/praxrr-app/src/tests/routes/scoreSimulatorPhase2Helpers.test.ts`: Phase 2 helper tests
- `packages/praxrr-app/src/tests/routes/simulateScoreRoute.test.ts`: API endpoint integration tests

### UI Components

- `packages/praxrr-app/src/lib/client/ui/form/NumberInput.svelte`: Numeric input for score editing
- `packages/praxrr-app/src/lib/client/ui/button/Button.svelte`: Reusable button component
- `packages/praxrr-app/src/lib/client/ui/badge/Badge.svelte`: Status badge component
- `packages/praxrr-app/src/lib/client/ui/arr/Score.svelte`: Score display component
- `packages/praxrr-app/src/lib/client/alerts/store.ts`: Alert notification store
- `packages/praxrr-app/src/lib/client/stores/dirty.ts`: Dirty tracking store
