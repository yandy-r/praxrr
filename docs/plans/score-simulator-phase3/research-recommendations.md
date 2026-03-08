# Recommendations: score-simulator-phase3

## Executive Summary

Phase 3 should prioritize the "Simulate" deep-link from the QP scoring page and URL parameter
support as foundational work, followed by what-if scoring as the highest-value feature. The existing
Phase 1+2 architecture -- client-side score composition atop a server-side parse/match pipeline --
is well-suited for what-if scoring via a client-side overlay approach that avoids PCD mutation or
API changes. The largest risk is URL state encoding size for batch scenarios with long release
titles; a compressed hash-fragment approach mitigates this without requiring a server-side
shortener. Testing coverage is the most straightforward phase and can be parallelized heavily since
the helper functions are already pure and well-isolated.

## Implementation Recommendations

### Recommended Approach

Build Phase 3 as three incremental sub-phases: (A) deep-link integration + URL state, (B) what-if
scoring overlay, (C) comprehensive testing. Sub-phase A is lowest risk and highest immediate value
-- it makes the simulator discoverable from the QP scoring page and enables shareable simulator
states. Sub-phase B requires careful UX design to distinguish temporary overrides from persisted
scores. Sub-phase C is the widest in scope but mechanically straightforward given the existing test
infrastructure.

### Technology Choices

| Component                 | Recommendation                                                    | Rationale                                                                                                                                           |
| ------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deep-link from QP scoring | `<a>` tag with query params to `/score-simulator/[databaseId]`    | No JS navigation needed; SSR-safe; profile name encoded as `?profile=pcd:EncodedName`                                                               |
| URL state encoding        | Hash fragment with `lz-string` compression                        | Avoids server round-trips; `lz-string` (5KB, zero-dep) compresses JSON state to URL-safe base64; stays under 2000-char URL limit for typical states |
| What-if score overlay     | Client-side `Map<cfName, overrideScore>` layered over API results | No API changes needed; the `SimulateProfileScore.contributions[]` response already provides per-CF scores that can be recalculated client-side      |
| What-if UI                | Inline editable score cells in ScoreBreakdown component           | Follows the ScoringTable pattern from QP scoring page; number input with visual "modified" indicator                                                |
| Unit tests                | Deno test runner with `@std/assert`                               | Matches existing `scoreSimulatorHelpers.test.ts` and `scoreSimulatorPhase2Helpers.test.ts` patterns                                                 |
| E2E tests                 | Playwright specs under `src/tests/e2e/specs/`                     | Matches existing `1.x-cf-*` and `2.x-qp-*` naming convention                                                                                        |
| Config Impact bridge      | Exported types + shared helper module                             | Define the interface boundary now but defer full integration until #30 is scoped                                                                    |

### Phasing Strategy

1. **Phase A - Deep-Link + URL State (2-3 days)**: Add "Simulate" button to QP scoring page,
   implement URL parameter read/write for simulator state (profile, title, mediaType, databaseId),
   support hash-fragment encoding for full state including batch titles.
2. **Phase B - What-If Scoring (3-4 days)**: Build client-side score override layer, add
   inline-editable score UI to ScoreBreakdown, implement "Reset overrides" / "Apply to profile"
   actions, design the data contract bridge for Config Impact Simulator (#30).
3. **Phase C - Testing + Integration (3-4 days)**: Unit tests for all helpers and what-if logic, E2E
   tests for deep-link flow and what-if workflow, integration tests for URL state round-trip,
   register test aliases in `scripts/test.ts`.

### Quick Wins

- **"Simulate" button on QP scoring**: A single `<a>` element linking to
  `/score-simulator/{databaseId}?profile=pcd:{encodedProfileName}` -- requires reading
  `$page.params` and the profile name from `data.scoring`. Immediate discoverability improvement.
- **URL param for profile pre-selection**: The `+page.svelte` `onMount` already reads from
  localStorage. Adding `$page.url.searchParams.get('profile')` to initialize `selectedProfileName`
  is a 5-line change.
- **Test alias registration**: Adding `'score-sim': 'packages/praxrr-app/src/tests/routes'` to
  `scripts/test.ts` aliases immediately enables `deno task test score-sim`.

## Improvement Ideas

### Related Features

- **"Open in Simulator" from Entity Testing**: The entity testing page
  (`/quality-profiles/entity-testing/[databaseId]`) already evaluates releases. A button to open a
  specific release in the simulator with full state would reduce context switching.
- **Profile Score Summary Widget**: A compact read-only score summary component (total score +
  threshold badge) reusable in QP scoring page header to show "last simulated score" without
  navigating away.
- **Export Simulation as JSON/CSV**: Allow exporting batch simulation results for external analysis
  or sharing. The `SimulateScoreResponse` type already contains all needed data.

### Future Enhancements

- **Score Override Persistence (localStorage)**: Save what-if overrides per profile+database key so
  users can iterate across sessions without losing their experimental scores. Low complexity, high
  user value.
- **Visual Diff Between What-If and Persisted Scores**: Show a delta column in ScoreBreakdown
  comparing the overridden score against the persisted PCD score. Builds naturally on the existing
  `ComparisonView` component.
- **Collaborative Sharing via Shortened URLs**: If hash-fragment URLs become too long for batch
  scenarios, introduce a server-side `/api/v1/simulate/share` endpoint that stores state in SQLite
  and returns a short ID. Deferred unless URL length becomes a real user complaint.
- **Score Distribution Chart**: Histogram of batch simulation scores using a lightweight charting
  library. Provides at-a-glance insight into how a profile handles diverse releases.

### Integration Opportunities

- **Config Impact Simulator (#30)**: The what-if score overlay data structure
  (`Map<cfName, overrideScore>`) is the natural input contract for a broader sandbox model.
  Exporting the override map as a typed interface (`ScoreOverrideSet`) establishes the bridge. The
  sandbox model in #30 would extend this to include CF condition overrides and quality tier changes.
- **Sync Preview (#7)**: What-if results could feed into sync preview to answer "would this release
  be grabbed with these score changes?" The `resolveScoreThresholdState()` helper already computes
  whether a score meets minimum/upgrade-until thresholds.
- **Arr Library Integration**: The "Open in Simulator" flow could be extended to accept release
  titles directly from connected Arr instance libraries, enabling "why did my instance grab this
  release?" diagnostics.

## Risk Assessment

### Technical Risks

| Risk                                                                                    | Likelihood | Impact | Mitigation                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL state exceeds browser URL length limits (2083 chars in IE, ~8KB in modern browsers) | Medium     | Medium | Use `lz-string` compression for hash fragment; degrade gracefully to localStorage + short URL for very large states; batch titles are the main size driver                                                                   |
| What-if score recalculation diverges from server-side scoring                           | Medium     | High   | Reuse the exact same `contributions[]` data from the API response; only override the score value per CF, do not re-evaluate CF matching client-side; add unit tests comparing client recalculation against known API results |
| Deep-link profile name encoding breaks with special characters                          | Low        | Medium | Profile names already use `encodeURIComponent` in the selector value (`pcd:${encodeURIComponent(name)}`); URL params must use the same encoding; add test cases for names with spaces, unicode, and special chars            |
| Hash fragment state conflicts with future SvelteKit routing                             | Low        | Low    | SvelteKit does not use hash fragments for routing; hash state is safe. If SvelteKit adds hash-based features, migrate to search params                                                                                       |
| E2E tests flaky due to parser service dependency                                        | Medium     | Medium | E2E tests for the simulator should mock parser availability or ensure the parser service is running; use the existing `parserAvailable` check pattern; add a test setup step that verifies parser health                     |
| What-if UI increases page complexity beyond maintainability                             | Low        | Medium | Keep the override layer as a single reactive `Map` with a clear reset action; do not embed what-if logic into the API layer; isolate all override logic in a dedicated helper module                                         |

### Integration Challenges

- **QP Scoring Page Data Availability**: The scoring page (`+page.server.ts`) loads `scoringData`
  which includes `customFormats[].scores` by arr type. The "Simulate" button needs the profile name
  and database ID, both available from `$page.params`. No additional data loading is required for
  the deep-link itself.
- **Bidirectional Navigation**: After opening the simulator from QP scoring, users may want to
  return to the scoring page to edit scores. A "Back to Scoring" breadcrumb or link should be
  included. The scoring page URL is reconstructable from `databaseId` and `profileId`, but the
  simulator only receives `profileName` not `profileId` -- the page server would need to resolve the
  ID from the name, or the deep-link should include both.
- **What-If + Comparison Mode Interaction**: When what-if overrides are active and comparison mode
  is enabled, it is ambiguous whether overrides apply to both profiles or only the primary.
  Recommendation: overrides apply to the primary profile only; the comparison profile shows
  unmodified scores as a baseline.

### Performance Concerns

- **URL State Serialization Cost**: `lz-string.compressToEncodedURIComponent()` is O(n) where n is
  state size. For typical simulator state (1 title, 1 profile, media type) this is <1ms. For batch
  mode (50 titles), compression time is ~5-10ms which is acceptable on state change. Do not compress
  on every keystroke; compress only when generating a shareable URL.
- **What-If Recalculation Frequency**: Recalculating total score from contributions is O(k) where k
  is the number of matched CFs (typically 5-20). This is trivially fast and can run on every
  override change without debouncing.
- **Hash Fragment Update Frequency**: `window.location.hash` updates are synchronous and trigger
  `hashchange` events. Use `replaceState` instead of `pushState` for continuous state updates to
  avoid polluting browser history.

### Security Considerations

- **URL State Tampering**: Hash fragment state is client-controlled and could contain arbitrary
  data. The simulator should validate deserialized state before applying it (check that profile
  names exist in the loaded options, media type is valid, release titles are within length limits).
  Never trust URL state for server-side operations.
- **Score Override Injection**: What-if overrides are purely client-side display changes. They must
  never be sent to the server as actual score updates without explicit user action ("Apply to
  Profile" button that triggers the existing save flow with dirty tracking and confirmation).
- **Shareable URL Privacy**: Release titles in URLs could contain sensitive information (e.g.,
  unreleased media titles). Document that shared URLs expose all state in the URL. Consider offering
  a "copy without titles" option.

## Alternative Approaches

### What-If Scoring

#### Option A: Client-Side Score Overlay (Recommended)

Maintain a client-side `Map<string, number>` of CF name to override score. When computing totals,
check the override map first, falling back to the API-provided contribution scores. No API changes
needed.

- **Pros**: Zero server changes; instant feedback; no PCD mutation risk; overrides are ephemeral by
  default; straightforward to implement using existing `contributions[]` data
- **Cons**: Score recalculation is duplicated client-side (but trivial -- just summing numbers);
  cannot simulate CF condition changes (only score values); if the API response shape changes, the
  overlay logic must be updated
- **Effort**: 2-3 days for full implementation including UI

#### Option B: API Extension with Override Parameters

Extend `POST /api/v1/simulate/score` to accept an optional `scoreOverrides: Record<string, number>`
parameter. The server applies overrides during scoring, returning results as if those scores were
configured.

- **Pros**: Single source of truth for scoring logic; overrides apply to all profile-level
  calculations including threshold resolution; server-validated override values
- **Cons**: Requires API contract change (OpenAPI schema update + type regeneration); adds
  complexity to an already-large endpoint (~900 lines); every override change requires a server
  round-trip; the parser must still be available for the full pipeline to run
- **Effort**: 3-4 days including API schema, endpoint changes, and client integration

#### Option C: PCD Sandbox Cache

Create an in-memory clone of the PCD cache with override ops applied. The simulator queries the
sandbox cache instead of the real one. This is the foundation for Config Impact Simulator (#30).

- **Pros**: Full fidelity -- overrides affect CF matching, scoring, and all derived queries; sandbox
  is a true preview of what the PCD would look like after changes; natural bridge to #30
- **Cons**: Highest complexity; cloning the PCDCache is non-trivial (Kysely + SQLite in-memory DB);
  memory cost of maintaining a parallel cache; cache invalidation when the real PCD changes;
  over-engineered for score-only overrides
- **Effort**: 5-8 days; should be deferred to #30 scope

#### Recommendation

**Option A (Client-Side Score Overlay)** is the clear choice for Phase 3. It delivers the what-if
experience with zero API changes, zero risk to PCD integrity, and minimal implementation effort. The
scoring recalculation is trivially correct because it only replaces individual contribution scores
and re-sums -- the same arithmetic the server performs. Option C should be revisited when Config
Impact Simulator (#30) is scoped, at which point the score overlay can be migrated to operate on the
sandbox cache.

### URL State Encoding

#### Option A: Search Parameters (Query String)

Encode state as `?profile=pcd:Name&title=Some.Release&mediaType=movie`.

- **Pros**: Standard URL format; works with SSR (available in `+page.server.ts` via
  `url.searchParams`); visible in browser address bar; compatible with all link-sharing contexts
- **Cons**: Long URLs for batch mode (50 titles); search params are sent to server on every
  navigation; triggers SvelteKit load function re-runs on param changes; URL-encoded special
  characters make long URLs unreadable
- **Best for**: Simple state (single title + profile + media type)

#### Option B: Hash Fragment with Compression (Recommended)

Encode full state as `#s=<lz-string-compressed-base64>`. Use search params for the most common
fields (profile, databaseId) and hash fragment for extended state (batch titles, what-if overrides).

- **Pros**: Hash fragments are not sent to server; does not trigger SvelteKit load re-runs;
  `lz-string` compresses JSON state by 60-80%; hybrid approach means simple deep-links use clean
  search params while full state uses hash
- **Cons**: Hash fragments are not available in `+page.server.ts`; requires client-side hydration;
  `lz-string` is a new dependency (5KB, well-maintained, zero dependencies)
- **Best for**: Full state including batch titles and what-if overrides

#### Option C: Server-Side Shortened URLs

Store state in SQLite via `POST /api/v1/simulate/share`, return a short ID. Shareable URL becomes
`/score-simulator/1?state=abc123`.

- **Pros**: Shortest possible URLs; state persists across browser sessions; enables analytics on
  shared simulations
- **Cons**: Requires new API endpoint + DB table + cleanup job; server dependency for a client
  feature; adds operational complexity; overkill for initial implementation
- **Best for**: Future enhancement if URL length becomes a real user pain point

#### Recommendation

**Hybrid of Option A + B**: Use search params for the simple deep-link case
(`?profile=pcd:Name&mediaType=movie`) which covers the QP scoring "Simulate" button. Use hash
fragment with `lz-string` compression for the full shareable state case. This gives clean,
SSR-compatible URLs for the common case while supporting the full-state case without server changes.
If `lz-string` is rejected as a new dependency, base64-encoded JSON without compression is a viable
fallback (at the cost of ~2x longer URLs).

## Task Breakdown Preview

### Phase A: Deep-Link + URL State (Foundation)

- **Task group: QP Scoring Integration**
  - Add "Simulate" button/link to QP scoring page header (next to existing Info/Options/Save
    buttons)
  - Construct deep-link URL:
    `/score-simulator/{databaseId}?profile=pcd:{encodedProfileName}&mediaType={arrType}`
  - Style the button to match existing `Button` component with a play/experiment icon (e.g.,
    `FlaskConical` from lucide-svelte)

- **Task group: URL Parameter Read**
  - In `+page.svelte` `onMount`, read `$page.url.searchParams` for `profile`, `mediaType`, `title`
  - Initialize component state from URL params, falling back to existing defaults
  - If `profile` param is present and matches a loaded quality profile, auto-select it and trigger
    simulation

- **Task group: URL State Write (Hash Fragment)**
  - Add `lz-string` dependency (or implement a URL state serialization module)
  - Define `SimulatorUrlState` type:
    `{ profile?, title?, mediaType?, batchTitles?, batchMediaType?, comparisonProfile? }`
  - Serialize state to hash fragment on meaningful state changes (debounced, using `replaceState`)
  - Add "Copy Link" button to simulator UI that copies the full URL to clipboard

- **Task group: URL State Read (Hash Fragment)**
  - On page mount, check for hash fragment; if present, decompress and deserialize
  - Validate deserialized state against loaded data (profiles exist, media types valid)
  - Apply valid state to component variables and trigger simulation
  - Handle graceful fallback for malformed/outdated hash state

- **Parallel opportunities**: QP scoring button can be implemented independently of URL state logic.
  URL read and write are sequential (read must handle write format), but both are independent of the
  deep-link button.

### Phase B: What-If Scoring (Core Feature)

- **Task group: Score Override Data Model**
  - Define `ScoreOverrideMap` type: `Map<string, number>` keyed by CF name
  - Create `what-if-helpers.ts` module with:
    `applyOverrides(contributions, overrides) -> contributions`,
    `computeOverriddenTotal(contributions, overrides) -> number`,
    `hasActiveOverrides(overrides) -> boolean`
  - Export `ScoreOverrideSet` interface as the contract boundary for Config Impact Simulator (#30)

- **Task group: ScoreBreakdown Enhancement**
  - Add inline-editable score cells to contribution list items in `ScoreBreakdown.svelte`
  - Show "modified" visual indicator (e.g., amber border or asterisk) on overridden scores
  - Display overridden total score alongside original total with a delta indicator
  - Add "Reset All Overrides" button that clears the override map

- **Task group: Override Integration with Simulation Flow**
  - Pass override map through to `ScoreBreakdown`, `ComparisonView`, and `RankingTable`
  - Recalculate threshold state (`resolveScoreThresholdState`) using overridden totals
  - In batch/ranking mode, re-rank releases using overridden scores
  - Include override state in URL hash serialization

- **Task group: Config Impact Bridge**
  - Define the `ScoreOverrideSet` exported interface in `$shared/` or helpers
  - Document the contract: what fields are included, how they map to PCD scoring, what #30 would
    need to extend
  - Add a placeholder "Apply Overrides to Profile" button (disabled, with tooltip explaining future
    functionality) or wire it to the existing scoring save flow if scope allows

- **Dependencies**: Score override data model must be defined before UI work. ScoreBreakdown
  enhancement depends on the data model. Integration with simulation flow depends on both. Config
  Impact bridge is independent but should be designed alongside the data model.

### Phase C: Testing + Integration (Quality Assurance)

- **Task group: Unit Tests - Helpers**
  - Tests for URL state serialization/deserialization round-trip
  - Tests for `applyOverrides()` with various edge cases (empty overrides, missing CFs, zero-score
    overrides)
  - Tests for `computeOverriddenTotal()` accuracy
  - Tests for `hasActiveOverrides()` boundary conditions
  - Tests for URL param parsing (valid params, missing params, malformed values, special characters
    in profile names)

- **Task group: Unit Tests - Existing Helpers Coverage**
  - Review existing `scoreSimulatorHelpers.test.ts` and `scoreSimulatorPhase2Helpers.test.ts` for
    gaps
  - Add tests for `parseBatchTitles` with what-if override state propagation
  - Add tests for `buildRankingFromResults` with overridden scores
  - Add tests for `buildComparisonResult` with one profile overridden

- **Task group: E2E Tests**
  - Test: Navigate from QP scoring page to simulator via "Simulate" button, verify profile
    pre-selected
  - Test: Enter release title + select profile, verify URL updates with state
  - Test: Copy shareable URL, navigate to it in new context, verify state restored
  - Test: Apply what-if override to a CF score, verify total recalculates
  - Test: Reset overrides, verify scores return to original values
  - Test: What-if override in batch mode, verify ranking re-sorts

- **Task group: Test Infrastructure**
  - Add test alias `score-sim-helpers` pointing to
    `packages/praxrr-app/src/tests/routes/scoreSimulator*.test.ts` in `scripts/test.ts`
  - Add test alias `score-sim-whatif` for the new what-if helper tests
  - E2E specs should follow naming convention: `4.x-score-simulator-*.spec.ts` (next series after
    existing `3.x-regex-*`)

- **Parallel opportunities**: Unit tests for helpers, URL state, and what-if logic are all
  independent. E2E tests depend on Phase A+B being complete. Test infrastructure setup is
  independent of all test writing.

### Estimated Complexity

- **Total tasks**: ~16-20 discrete tasks across three sub-phases
- **Critical path**: URL state type definition -> URL read/write implementation -> what-if data
  model -> ScoreBreakdown override UI -> E2E tests
- **Phase A estimated effort**: 2-3 days
- **Phase B estimated effort**: 3-4 days
- **Phase C estimated effort**: 3-4 days
- **Total estimated effort**: 8-11 days

## Key Decisions Needed

- **`lz-string` dependency approval**: Adding `lz-string` (5KB, zero-dep, MIT license) for URL state
  compression. Alternative is raw base64 JSON (longer URLs but zero new deps). If neither is
  acceptable, fall back to search params only (limits shareable state to simple scenarios).
- **What-if override scope**: Should overrides be limited to score values only (recommended for
  Phase 3), or should they extend to minimum score, upgrade-until-score, and upgrade-score-increment
  thresholds? Extending to thresholds is low-effort but adds UI complexity.
- **"Apply to Profile" action**: Should Phase 3 include a button to persist what-if overrides back
  to the QP scoring page (triggering the existing save flow), or is this deferred to Config Impact
  Simulator (#30)? Including it creates a complete feedback loop but adds form submission
  complexity.
- **E2E test numbering**: Should score simulator E2E tests use the `4.x-` prefix (next available
  series) or a different convention?
- **What-if + comparison interaction**: When overrides are active in comparison mode, should they
  apply to (a) primary profile only, (b) both profiles, or (c) user-selectable per profile?
  Recommendation: primary profile only, keeping the comparison profile as a baseline.

## Open Questions

- Should the hash fragment state include the `databaseId`, or is the route parameter sufficient? If
  included, the shareable URL works even if the user's localStorage has a different default
  database. If excluded, the URL is shorter.
- For the "Simulate" button on the QP scoring page, should it open the simulator in the same tab or
  a new tab? Same tab is simpler but loses the scoring page context. New tab preserves context but
  fragments attention.
- Is there appetite for a "what-if session" concept where overrides persist in localStorage across
  page navigations, or should overrides be strictly ephemeral (lost on page leave)? The URL hash
  encoding provides implicit persistence for shared links, but localStorage persistence covers the
  "experimenting over time" workflow.
- Should the what-if override UI be visible by default in `ScoreBreakdown`, or should it be behind a
  toggle/disclosure? Showing it by default increases discoverability but adds visual noise for users
  who do not need it.

## Relevant Files

### Phase 3 Direct Targets

- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte`: Main simulator page --
  add URL param reading and override state management
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/helpers.ts`: Helper module -- add URL
  state serialization, what-if override helpers
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ScoreBreakdown.svelte`:
  Score display -- add inline-editable override UI
- `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/scoring/+page.svelte`: QP
  scoring page -- add "Simulate" button
- `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/scoring/+page.server.ts`: QP
  scoring server load -- profile name available at line 45
- `packages/praxrr-app/src/tests/routes/scoreSimulatorHelpers.test.ts`: Existing Phase 1 helper
  tests -- extend with Phase 3 tests
- `packages/praxrr-app/src/tests/routes/scoreSimulatorPhase2Helpers.test.ts`: Existing Phase 2
  helper tests -- extend with override + ranking tests

### Supporting Infrastructure

- `packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts`: Simulation API endpoint (no
  changes expected for Phase 3)
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.server.ts`: Server load for
  simulator page (profile list, parser health)
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ComparisonView.svelte`:
  Comparison display -- may need override-aware rendering
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/RankingTable.svelte`:
  Ranking table -- may need override-aware re-ranking
- `packages/praxrr-app/src/lib/shared/disclosure/sectionKeys.ts`: Section key registry -- may need
  new key for what-if disclosure
- `packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/scoring/read.ts`: Server-side
  scoring query -- reference for score computation accuracy
- `docs/api/v1/schemas/score-simulator.yaml`: OpenAPI schema (no changes expected unless API
  extension approach chosen)
- `scripts/test.ts`: Test alias registry -- add score simulator test aliases
- `playwright.config.ts`: Playwright config at repo root -- E2E tests use
  `packages/praxrr-app/src/tests/e2e/specs/`

### Previous Phase Documentation

- `docs/plans/score-simulator/research-recommendations.md`: Phase 1 research and architecture
  decisions
- `docs/plans/score-simulator-phase2/research-external.md`: Phase 2 API research confirming no API
  changes needed
- `docs/plans/score-simulator/feature-spec.md`: Original feature spec with Phase 3 outline at line
  412

## Other Docs

- GitHub Issue #30: Config Impact Simulator (what-if testing) -- the broader sandbox model that
  Phase 3 what-if scoring bridges into
- GitHub Issue #13: Score Simulator feature request (parent issue)
- `docs/plans/score-simulator/research-ux.md`: UX research from Phase 1
- `docs/plans/score-simulator/research-business.md`: Business context from Phase 1
