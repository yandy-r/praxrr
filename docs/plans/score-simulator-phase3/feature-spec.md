# Feature Spec: Score Simulator Phase 3

## Executive Summary

Phase 3 transforms the score simulator from a standalone evaluation tool into an integrated workflow
component by adding four capabilities: a "Simulate" button on the quality profile scoring page for
contextual deep-linking, what-if score overrides for temporary experimentation without PCD mutation,
URL parameter support for shareable simulation state, and comprehensive unit/integration/e2e test
coverage. The what-if feature uses a client-side score overlay that replaces individual contribution
scores in the already-computed API response and re-sums totals -- no API changes needed since the
complex scoring resolution (arr-type precedence, TRaSH score sets, `all` fallback) is already
resolved in the response. URL state uses search params for simple deep-links and base64-encoded JSON
for full shareable state. The Config Impact Simulator (#30) integration is limited to defining a
shared `ScoreOverrideMap` type contract; full sandbox compilation is deferred.

Phase 3 completion also requires a user-first UX layer for normal users: plain-language outcomes
("would this be grabbed?"), guided first-run onboarding, and mobile-safe interactions. This is not a
nice-to-have. It is a release gate for the final score simulator phase.

## External Dependencies

### APIs and Services

#### Existing Simulate/Score API (No Changes)

- **Endpoint**: `POST /api/v1/simulate/score`
- **Contract**: `{ databaseId, releases[], profileNames[], arrType }` ->
  `{ parserAvailable, results[].profileScores[].contributions[] }`
- **Phase 3 Usage**: Response's `contributions[]` array provides per-CF resolved scores. What-if
  overrides replace individual `score` values client-side and re-sum for `totalScore`.
- **No schema changes needed**: Overrides are applied after the API response, not during server
  computation.

#### SvelteKit Navigation APIs (Built-in)

- **`goto()`** from `$app/navigation`: Deep-link from scoring page to simulator
- **`replaceState()`** from `$app/navigation`: URL state updates without history pollution
- **`$page.url.searchParams`** from `$app/stores`: Read URL params reactively
- **Documentation**: <https://svelte.dev/docs/kit/$app-navigation>

### Libraries and SDKs

| Library             | Version | Purpose                                  | Installation |
| ------------------- | ------- | ---------------------------------------- | ------------ |
| No new dependencies | --      | All features use existing infrastructure | --           |

### External Documentation

- [SvelteKit $app/navigation](https://svelte.dev/docs/kit/$app-navigation): `goto()`,
  `replaceState()`
- [SvelteKit Shallow Routing](https://svelte.dev/docs/kit/shallow-routing): URL state patterns
- [Deno Testing](https://docs.deno.com/runtime/fundamentals/testing/): Test runner, assertions,
  mocking
- [Playwright for SvelteKit](https://playwright.dev/docs/intro): E2E test patterns

## Business Requirements

### User Stories

**Primary User: Configuration Author (PCD Database Maintainer)**

- As a PCD author editing CF scores on the quality profile scoring page, I want a "Simulate" button
  that opens the score simulator pre-filled with my current database and profile, so that I can
  immediately test how my scoring changes affect real release rankings without manually navigating
  and re-selecting context.
- As a PCD author, I want to temporarily override individual CF scores in the simulator and see
  real-time total score recalculation, so that I can experiment with "what if I changed X to Y?"
  without committing ops to `pcd_ops`.
- As a PCD author, I want to share a URL containing my simulator state (release titles, profile
  selection, what-if overrides) with a collaborator so they can reproduce my exact scenario.

**Secondary User: Self-Hoster (End User)**

- As a self-hoster, I want to experiment with score tweaks in the simulator before deciding to save
  them to PCD, so that I can preview the impact of changes on my grab quality without risk.
- As a self-hoster, I want to bookmark a simulator URL with my test releases and profile so I can
  quickly re-test after upstream PCD updates.
- As a self-hoster, I want to see the delta between my current live scores and my what-if overrides
  for each CF, so I understand exactly what would change.

**Tertiary User: New User (Onboarding)**

- As a new user, I want to follow a shared URL into the simulator with pre-configured state, so I
  can see scoring in action without needing to understand PCD configuration first.
- As a new user, I want clear visual distinction between "live" scores and "what-if" overrides in
  the simulator, so I am not confused about which scores are actually applied.

### User-First Experience Principles

1. **Plain language first**: Surface user-facing wording ("Grab eligibility", "Meets minimum")
   before advanced terms ("threshold state", "CF contribution").
2. **Decision-first output**: Every simulation result must answer "Will this release be accepted?"
   within one screen, without requiring users to parse raw CF math.
3. **Guided onboarding**: First-run and empty states must include a short checklist and one-click
   starter actions.
4. **Safe experimentation**: What-if mode must clearly communicate temporary changes and provide
   easy reset paths.
5. **Mobile usability**: Core actions (simulate, override, reset, copy link) must be fully usable on
   small touch screens.

### Business Rules

1. **"Simulate" Button Placement**: The button belongs on the quality profile scoring page
   (`/quality-profiles/[databaseId]/[id]/scoring`), in the `StickyCard` header alongside existing
   Info/Options/Save buttons.

2. **Deep-Link Context**: The button navigates to `/score-simulator/[databaseId]` with search
   params:
   - `profile` -- profile selector value (e.g., `pcd:Profile%20Name`)
   - `arrType` -- default to `radarr` (the scoring page shows all arr types; simulator requires one)
     The dirty store's navigation warning triggers if the user has unsaved changes.

3. **What-If Override Scope**: Users can override the `score` value for any CF contribution in the
   simulation response. Overrides are a `Map<cfName, number>` applied client-side by replacing
   `contribution.score` values and re-summing `totalScore`.

4. **What-If Isolation**: Overrides never persist to PCD. They exist only in client memory and
   optionally in URL state. Closing the tab or navigating away loses them unless encoded in a shared
   URL.

5. **What-If Recalculation**: When an override changes, `totalScore` and threshold state
   (`below`/`accepted`/`upgrade-reached`) recompute immediately from the full contributions array.
   No API call needed. In batch mode, ranking table re-sorts using overridden totals.

6. **What-If Coverage**: Only CFs that appear in the profile's `contributions[]` array can be
   overridden. Users cannot add new CF score mappings (that requires PCD ops). Override scores must
   be integers (negative values valid for blocking).

7. **URL State Read-on-Mount**: URL params are read once during `onMount`. They populate reactive
   state but do not create continuous two-way binding.

8. **URL State Write-on-Action**: Share actions serialize current state to URL params and copy the
   URL to clipboard. This is the only path that writes state to URL.

9. **URL Length Handling**: If encoded state exceeds ~2000 characters, degrade gracefully: omit
   batch titles and/or overrides from the URL, show a warning toast.

10. **URL Backward Compatibility**: Unknown params are silently ignored. Missing params fall back to
    defaults. Malformed values silently discarded.

11. **Decision Summary Requirement**: After every simulation, the page must display a plain-language
    summary card:
    - `Below minimum`: "This release would not be grabbed."
    - `Accepted`: "This release is eligible to grab."
    - `Upgrade reached`: "This release meets your upgrade target." The card must also show current
      score, minimum required score, and remaining gap (if any).

12. **Beginner-Friendly Labels**: UI copy must use user-facing wording:
    - "App type" instead of "arrType"
    - "Score rule" or "Rule score" instead of only "CF contribution" where space permits
    - "What-if change" instead of only "override"

13. **First-Run Guidance**: When no title/profile is selected, show a quick-start panel with:
    - 3-step checklist (select profile, paste title, run simulation)
    - "Try example" action wired to existing presets
    - short note that changes are not saved until scoring page save action

14. **Share Privacy Option**: Provide two share actions:
    - "Copy Full Link" (includes titles, batch, overrides)
    - "Copy Safe Link" (excludes titles/batch, keeps profile + app type + overrides) This protects
      users who do not want media titles in shared URLs.

15. **Mobile Interaction Rule**: On narrow screens, score editing must use full-width numeric inputs
    and 44x44 minimum touch targets for edit/reset actions.

### Edge Cases

| Scenario                          | Expected Behavior                                                    | Notes                                    |
| --------------------------------- | -------------------------------------------------------------------- | ---------------------------------------- |
| Profile from URL not found        | Load simulator with dropdown open, no profile selected, show warning | Other state (titles, arrType) preserved  |
| Database from URL not found       | Redirect to first available database                                 | Standard existing behavior               |
| Override for non-existent CF      | Silently ignored during URL state restoration                        | Filter against actual results            |
| URL too long for sharing          | Warn user, omit largest params (overrides first, then batch)         | "Copy Link" button shows truncation info |
| Clipboard API unavailable         | Show URL in readonly text input as fallback                          | Toast: "Copy URL from address bar"       |
| What-if + comparison mode         | Overrides apply to primary profile only                              | Comparison profile shows baseline        |
| What-if with zero-score CF        | Override from 0 to N shows delta, CF still listed                    | Distinguish override from non-match      |
| Dirty guard on scoring page       | Standard dirty warning before navigating to simulator                | Existing behavior, no change             |
| Parser unavailable with overrides | Overrides still work on any cached/previous simulation results       | What-if is response-level                |
| First-run user with empty state   | Show quick-start panel with guided steps and example action          | Avoid blank/confusing first screen       |
| Copy link but user wants privacy  | "Copy Safe Link" omits titles and batch data                         | Reduces accidental media-title sharing   |
| 20+ overrides active              | Show compact "N changes active" summary + sticky reset action        | Keep interface understandable            |
| Mobile inline edit tap accuracy   | Full-row tap target enters edit mode, no clipped input               | Touch-friendly interaction               |

### Success Criteria

- [ ] "Simulate" button on scoring page navigates to simulator with correct profile pre-filled
- [ ] Simulator reads URL params on mount and populates state correctly
- [ ] What-if score overrides update total score and threshold state in real-time (<1ms
      recalculation)
- [ ] What-if overrides apply across batch mode and re-sort ranking table
- [ ] Visual distinction between live scores and overridden scores is clear (amber/yellow
      indicators)
- [ ] Original score shown alongside override (strikethrough annotation)
- [ ] "Reset All Overrides" and per-CF reset work correctly
- [ ] "Copy Link" produces a URL that restores simulator state when opened
- [ ] URL gracefully degrades when state exceeds length limits
- [ ] All new helper functions have unit tests with full branch coverage
- [ ] Existing Phase 1/2 tests continue to pass unchanged
- [ ] E2E test covers QP scoring -> simulator -> what-if -> share flow
- [ ] No API changes, no new dependencies, no new database tables
- [ ] Decision summary card answers "would this be grabbed?" in plain language
- [ ] First-run quick-start panel reduces empty-state confusion
- [ ] "Copy Safe Link" excludes titles and batch state by default when user chooses it
- [ ] Core simulator workflow is fully usable on 360px mobile width without horizontal scrolling
- [ ] Keyboard-only and touch-only workflows both support edit, reset, and copy actions

## Technical Specifications

### Architecture Overview

```text
Quality Profile Scoring Page
  /quality-profiles/[databaseId]/[id]/scoring
    |
    | "Simulate" button (new SimulateButton.svelte)
    | goto('/score-simulator/{dbId}?profile=pcd:Name&arrType=radarr')
    v
Score Simulator Page
  /score-simulator/[databaseId]?profile=...&arrType=...
    |
    +-- URL State (urlState.ts)         -- read on mount, write on "Copy Link"
    |     parseUrlState(), serializeUrlState()
    |
    +-- What-If Layer                   -- per-CF score override
    |     ScoreOverrideMap: Record<cfName, number>
    |     applyScoreOverrides(contributions, overrides) -> contributions
    |     computeOverriddenTotal(contributions, overrides) -> number
    |
    +-- Existing Components (modified)
    |     ScoreBreakdown: inline-editable score cells with override indicators
    |     RankingTable: re-ranks using overridden totals
    |     ComparisonView: primary profile shows overrides, comparison shows baseline
    |
    v
API: POST /api/v1/simulate/score (UNCHANGED)
  Returns contributions[] with resolved scores
  Client applies overrides post-response
```

### Data Models

#### Score Override Types (In-Memory, Client-Side Only)

```typescript
/**
 * Map of CF name -> overridden score value.
 * Applied client-side to contributions[] from the API response.
 */
export type ScoreOverrideMap = Record<string, number>;

/**
 * All URL-encodable simulator state.
 */
export interface SimulatorUrlState {
  title?: string;
  mediaType?: 'movie' | 'series';
  profile?: string;
  compare?: string;
  arrType?: 'radarr' | 'sonarr';
  batch?: string[];
  batchMediaType?: 'movie' | 'series';
  overrides?: ScoreOverrideMap;
}
```

#### Existing Types to Reuse

- `SimulateScoreResponse`, `SimulateReleaseResult`, `SimulateProfileScore`,
  `SimulateScoreContribution` from `$api/v1.d.ts`
- `ScoreThresholdState` from `helpers.ts`
- `SimulatorProfileOption` from `+page.svelte`
- `RankedRelease` from `helpers.ts`

### API Design

**No API changes required.** The what-if feature operates on the existing API response:

1. Client sends standard `POST /api/v1/simulate/score` request
2. Server returns `contributions: [{ cfName, score }]` per profile (scores already resolved via
   arr-type precedence, TRaSH score sets, `all` fallback)
3. Client applies `ScoreOverrideMap`: replaces `score` for matching `cfName` entries
4. Client re-sums to compute overridden `totalScore`
5. Client recomputes `ScoreThresholdState` with overridden total

This approach is correct because what-if only changes _how much_ a matched CF contributes, not
_which_ CFs match or _which_ score resolution path is used. Those are already resolved server-side.

### System Integration

#### Files to Create

| File                                                                              | Purpose                                                                                              |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `.../score-simulator/[databaseId]/urlState.ts`                                    | URL state serialization/deserialization, `parseUrlState()`, `serializeUrlState()`, `copyShareLink()` |
| `.../quality-profiles/[databaseId]/[id]/scoring/components/SimulateButton.svelte` | Deep-link button for QP scoring page header                                                          |
| `.../tests/routes/scoreSimulatorPhase3Helpers.test.ts`                            | Unit tests for what-if override helpers                                                              |
| `.../tests/routes/scoreSimulatorUrlState.test.ts`                                 | Unit tests for URL state serialization round-trip                                                    |
| `.../tests/e2e/specs/4.1-score-simulator-deep-link.spec.ts`                       | E2E: scoring page -> simulate -> pre-fill verification                                               |
| `.../tests/e2e/specs/4.2-score-simulator-what-if.spec.ts`                         | E2E: override score -> verify recalculation                                                          |
| `.../tests/e2e/specs/4.3-score-simulator-url-state.spec.ts`                       | E2E: copy link -> open in new context -> verify state                                                |
| `.../tests/e2e/specs/4.4-score-simulator-ux-basics.spec.ts`                       | E2E: decision summary, quick-start, mobile-safe interactions                                         |

#### Files to Modify

| File                                                                | Changes                                                                                                                     |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `.../score-simulator/[databaseId]/+page.svelte`                     | Read URL state on mount, manage override state, pass overrides to ScoreBreakdown/RankingTable, add "Copy Link" button       |
| `.../score-simulator/[databaseId]/helpers.ts`                       | Add `applyScoreOverrides()`, `computeOverriddenTotal()`, `resolveThresholdWithOverrides()`                                  |
| `.../score-simulator/[databaseId]/components/ScoreBreakdown.svelte` | Inline-editable score cells, override visual indicators (amber border/background), original value annotation, delta display |
| `.../score-simulator/[databaseId]/components/ReleaseInput.svelte`   | Beginner copy updates, app-type label clarity, first-run quick-start trigger hooks                                          |
| `.../score-simulator/[databaseId]/components/RankingTable.svelte`   | Accept overrides prop, re-rank using overridden totals                                                                      |
| `.../score-simulator/[databaseId]/components/ComparisonView.svelte` | Show overrides on primary profile, baseline on comparison                                                                   |
| `.../quality-profiles/[databaseId]/[id]/scoring/+page.svelte`       | Import and render SimulateButton in StickyCard header                                                                       |
| `scripts/test.ts`                                                   | Add aliases: `url-state`, `what-if`, `phase3`                                                                               |

#### Configuration

- No new environment variables
- No new database tables or migrations
- No new dependencies
- No OpenAPI schema changes

## UX Considerations

### User Workflows

#### Workflow 1: QP Scoring -> Simulator Deep Link

1. **Browse scores**: User is on `/quality-profiles/[databaseId]/[id]/scoring` reviewing CF scores.
2. **Click "Simulate"**: User clicks the button in the `StickyCard` header (next to
   Info/Options/Save).
3. **Navigate**: System calls
   `goto('/score-simulator/{databaseId}?profile=pcd:{encodedName}&arrType=radarr')`.
4. **Land in simulator**: Profile pre-selected, release title input focused and ready.
5. **Return**: Browser back button returns to scoring page (server-loaded, fresh state).

#### Workflow 2: What-If Score Override

1. **View breakdown**: User has a simulation result with score contributions displayed.
2. **Click score**: User clicks a CF score value (e.g., "Remux Tier 01: +1700"). Cell transitions to
   inline number input, pre-filled with current score.
3. **Enter override**: User types "2000". Cell shows amber border + background. Original value shown
   as strikethrough annotation: "~~1700~~".
4. **See recalculation**: Total score updates instantly. Threshold badge updates if boundary
   crossed. Delta shown: "+300" in green.
5. **Batch impact**: In batch mode, ranking table re-sorts with overridden totals.
6. **Reset**: Click per-CF reset icon or "Reset All Overrides" button.
7. **Non-persistence**: Info banner: "What-if overrides are temporary and will not be saved."

#### Workflow 3: Share Simulator State via URL

1. **Configure simulation**: User has profile, titles, and optionally what-if overrides active.
2. **Click share action**: User chooses "Copy Full Link" or "Copy Safe Link". System serializes
   state and copies URL to clipboard.
3. **Toast feedback**: "Link copied to clipboard" with `aria-live="polite"`.
4. **If too large**: Warning toast with truncation info; omit overrides/batch from URL.
5. **Recipient opens link**: Simulator loads, reads params, reconstructs state.
6. **Graceful mismatch**: If profile not found, show warning, load with dropdown open.

#### Workflow 4: First-Run User (No Existing Context)

1. **Open simulator directly**: User lands on simulator without selected profile or title.
2. **See quick-start panel**: UI shows "Start in 3 steps" with plain-language checklist.
3. **Try example**: User clicks "Try example release", pre-filling one safe preset and media type.
4. **Understand result quickly**: Decision summary card states acceptance outcome in plain language.
5. **Explore details optionally**: User can expand contribution rows only if they want deeper
   detail.

### UI Patterns

| Component            | Pattern                                              | Notes                            |
| -------------------- | ---------------------------------------------------- | -------------------------------- |
| Simulate button      | `Button` with play/flask icon in `StickyCard` header | Secondary style (navigates away) |
| Inline score edit    | Click-to-edit number input in contribution cell      | Auto-select value on activation  |
| Override indicator   | Amber border-l-2 + bg-amber-50 dark:bg-amber-900/20  | Original value as strikethrough  |
| Total delta          | "1750 -> 2050 (+300)" with green/red delta           | In ScoreBreakdown header         |
| Override count badge | "N overrides active" next to results header          | Clickable to scroll to overrides |
| Copy Link button     | Clipboard icon + "Copy Link" label                   | In simulator toolbar             |
| Copy Safe Link       | Secondary action that omits titles/batch             | Privacy-preserving sharing       |
| Reset All button     | "Reset All Overrides" with undo icon                 | Visible when overrides active    |
| Decision summary     | Plain-language status card with score gap            | Visible above detailed breakdown |
| Quick-start panel    | 3-step checklist + example action                    | First-run and empty states       |

### Accessibility Requirements

- Color not sole indicator: sign prefixes, strikethrough text, "was: N" annotations (WCAG 1.4.1)
- `aria-live="polite"` on total score region for recalculation announcements
- Keyboard inline editing: Tab between cells, Enter to confirm, Escape to revert
- Auto-select input content on activation for immediate replacement typing
- Override count badge uses `aria-label` for screen readers
- Minimum 44x44 tap targets for mobile edit/reset actions (WCAG 2.5.5 target size guidance)
- Decision summary status text announced once after simulation completion (`aria-live="polite"`)

### Performance UX

- **What-if recalculation**: <1ms (client-side sum of ~5-20 contributions). No debounce needed.
- **URL state read on mount**: <5ms (param extraction + optional base64 decode)
- **URL state write on "Copy Link"**: <10ms (serialization + clipboard write)
- **Page transition from scoring**: Standard SvelteKit navigation, <200ms for cached PCD data
- **Override cell activation**: 150ms ease-out transition on border/background. No layout shift.

## Recommendations

### Implementation Approach

**Recommended Strategy**: Build as four incremental sub-phases that deliver value independently. The
what-if overlay operates entirely on the existing API response -- no server changes needed.

**Phasing:**

1. **Phase A - Deep-Link + URL State (Foundation)**: "Simulate" button on QP scoring page, URL param
   reading on simulator mount, "Copy Link" serialization. Immediate discoverability improvement.
2. **Phase B - What-If Scoring (Core Feature)**: Client-side override map, inline-editable score
   cells in ScoreBreakdown, override-aware ranking/comparison, Config Impact type contract.
3. **Phase C - User-First UX Layer (Adoption)**: Plain-language decision summary, first-run
   quick-start, privacy-safe share action, mobile touch ergonomics.
4. **Phase D - Testing + Integration (Quality)**: Unit tests for helpers and URL state, E2E tests
   for full workflow including user-first UX acceptance gates, test alias registration.

### Technology Decisions

| Decision               | Recommendation                                    | Rationale                                                                                                   |
| ---------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| What-if implementation | Client-side score overlay                         | API already returns resolved scores; override + re-sum is trivial; zero API changes; zero PCD mutation risk |
| URL state encoding     | Search params for simple, base64 JSON for complex | Clean deep-link URLs from scoring page; compact encoding for overrides/batch without new deps               |
| URL state sync         | Read-on-mount, write-on-action                    | Simplest mental model; no continuous bidirectional sync complexity                                          |
| URL compression        | None (no lz-string)                               | Typical state fits in ~3500-4000 chars; well within modern browser limits; avoids new dependency            |
| Inline editing         | Click-to-edit in contribution cells               | Follows PatternFly/enterprise data table patterns; preserves row context                                    |
| Override scope         | Per-CF globally (applies to all profiles equally) | A CF score override means "what if this CF contributed X?" -- applies regardless of profile                 |
| Result explanation     | Plain-language decision summary card              | Non-expert users should not parse raw score internals to understand outcome                                 |
| Share safety           | Full + safe link copy actions                     | Users can collaborate without always exposing release titles                                                |
| Testing framework      | Deno test + Playwright (existing)                 | Matches `scoreSimulatorHelpers.test.ts` and Playwright spec patterns                                        |

### Quick Wins

- "Simulate" button: Single `<a>` element with `goto()` -- 10-15 lines including the component
- URL param pre-selection: Add `$page.url.searchParams.get('profile')` to `onMount` -- 5-line change
- Test alias: Add entry to `scripts/test.ts` -- 1-line change

### Future Enhancements

- **Apply Overrides to Profile**: "Apply" button navigates back to scoring page with overrides as
  unsaved changes. Creates a complete feedback loop.
- **Score Override Persistence**: Save named override sets to localStorage for cross-session
  iteration.
- **Server-Side Sandbox (Config Impact #30)**: Convert `ScoreOverrideMap` to temporary ops for full
  PCD cache recompilation. The override map type contract established in Phase 3 feeds directly into
  this.
- **Score Distribution Chart**: Histogram of batch scores using lightweight chart library.
- **Threshold Overrides**: Allow overriding `minimum_custom_format_score` and `upgrade_until_score`.

### Plan Alignment Notes

- The implementation plan is authoritative on URL strategy: query params + base64 JSON, no
  `lz-string`.
- URL updates are explicit on "Copy Link" action only; no continuous URL synchronization.
- Research alternatives that mention hash-fragment compression remain documented as non-selected
  options, not phase requirements.

## Risk Assessment

### Technical Risks

| Risk                                                 | Likelihood | Impact | Mitigation                                                                                        |
| ---------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------- |
| URL state exceeds 2000 chars for batch scenarios     | Medium     | Medium | Truncate to first N titles that fit; show warning; overrides typically <400 chars                 |
| What-if recalculation diverges from server scoring   | Low        | Medium | Only replaces contribution scores and re-sums; same arithmetic server performs; unit tests verify |
| Profile name encoding breaks with special characters | Low        | Medium | Use `encodeURIComponent()`; add test cases for spaces, unicode, colons                            |
| E2E tests flaky due to parser dependency             | Medium     | Medium | Use `parserAvailable` check; tests work with or without parser                                    |
| Override UI adds visual noise to ScoreBreakdown      | Low        | Low    | Overrides hidden until first edit; amber indicators are subtle; "Reset All" clears quickly        |
| Stale URL shares after PCD updates                   | Medium     | Low    | Graceful degradation: unknown profiles/CFs silently filtered; warning shown                       |

### Integration Challenges

- **Scoring page data availability**: The scoring page has `profileName` and `databaseId` in route
  params. No additional data loading needed for the deep-link button.
- **What-if + comparison interaction**: Overrides apply to primary profile only; comparison profile
  shows unmodified baseline scores. This is the clearest mental model.
- **What-if + batch mode**: Override map applies uniformly to all releases (same CF score change
  affects all). This is correct since CF-profile score mappings are global, not per-release.

### Security Considerations

- URL state is client-controlled: validate all deserialized values before applying
- Score overrides are display-only: never sent to server as actual PCD mutations
- Release titles in URLs could contain sensitive info: document that shared URLs expose all state

## Task Breakdown Preview

### Phase A: Deep-Link + URL State

**Focus**: Make simulator discoverable from QP scoring; enable shareable URLs. **Tasks**:

- Create `SimulateButton.svelte` component with `goto()` deep-link
- Add button to QP scoring page `StickyCard` header
- Create `urlState.ts` with `parseUrlState()` and `serializeUrlState()`
- Read URL params in `+page.svelte` `onMount`, populate reactive state
- Add "Copy Link" button to simulator toolbar with clipboard + toast feedback
- Handle graceful fallback for invalid/missing URL params

**Parallelization**: SimulateButton component is independent of URL state module. Both can be
developed in parallel.

### Phase B: What-If Scoring

**Focus**: Temporary score overrides with instant recalculation. **Dependencies**: Phase A URL state
(overrides encoded in URL for sharing). **Tasks**:

- Add `applyScoreOverrides()`, `computeOverriddenTotal()` to `helpers.ts`
- Add `resolveThresholdWithOverrides()` for threshold state recalculation
- Extend `ScoreBreakdown.svelte` with inline-editable score cells
- Add override visual indicators (amber styling, original value annotation, delta)
- Add "Reset All Overrides" button and per-CF reset
- Wire overrides into `RankingTable` for re-ranking
- Wire overrides into `ComparisonView` (primary profile only)
- Add override state to `serializeUrlState()` encoding
- Define exported `ScoreOverrideMap` type as Config Impact (#30) contract

**Parallelization**: Helper functions and ScoreBreakdown UI can be developed in parallel.
RankingTable/ComparisonView integration depends on helper functions.

### Phase C: Testing + Integration

**Focus**: Comprehensive test coverage for all Phase 3 features. **Dependencies**: Phases A and B
complete. **Tasks**:

- Unit tests: `applyScoreOverrides()`, `computeOverriddenTotal()`, `resolveThresholdWithOverrides()`
- Unit tests: `parseUrlState()`, `serializeUrlState()` round-trip with edge cases
- Unit tests: Override with missing CFs, negative scores, empty overrides
- E2E: Navigate from scoring page -> simulator, verify profile pre-fill
- E2E: Apply override -> verify total recalculates -> verify ranking updates
- E2E: Copy link -> open in new context -> verify state restoration
- E2E: First-run quick-start flow and decision summary for non-expert users
- E2E: Mobile viewport checks for inline edit/reset usability
- Register test aliases in `scripts/test.ts`

**Parallelization**: All unit test files are independent. E2E tests are sequential (Playwright
`workers: 1`). Unit tests and E2E tests can be developed in parallel.

## Decisions Needed

1. **arrType for deep-link**: Default to `radarr` when navigating from scoring page (which shows all
   arr types). User can change in simulator.
   - Recommendation: Default `radarr`. Low risk, easy to change.

2. **Override persistence across reload**: URL-only (ephemeral unless shared) vs sessionStorage.
   - Recommendation: URL-only. Simplest mental model; overrides are temporary by nature.

3. **What-if + threshold overrides**: Should users also override `minimum_custom_format_score` and
   `upgrade_until_score`?
   - Recommendation: Defer to future enhancement. Phase 3 focuses on CF score overrides only.

4. **"Simulate" button target**: Same tab (standard) vs new tab (preserves scoring page context).
   - Recommendation: Same tab. Standard navigation; scoring page reloads from server on back.

5. **Config Impact Simulator (#30) depth**: How much sandbox infrastructure to build?
   - Recommendation: Type contract only (`ScoreOverrideMap` exported type). Full sandbox deferred.

6. **What-if override visibility**: Always visible or behind disclosure toggle?
   - Recommendation: Override editing activates on click (not visible until first interaction).
     Keeps default view clean.

7. **Share action defaults**: Should "Copy Full Link" or "Copy Safe Link" be the primary action?
   - Recommendation: Keep "Copy Full Link" primary, expose "Copy Safe Link" adjacent.

8. **Deep-link arrType behavior**: Hard default to `radarr` or prefer last used simulator app type?
   - Recommendation: Use last used simulator app type when available; fallback to `radarr`.

## Research References

For detailed findings, see:

- [research-external.md](./research-external.md): SvelteKit URL APIs, Deno testing, Playwright
  patterns
- [research-business.md](./research-business.md): User stories, business rules, workflows, codebase
  integration
- [research-technical.md](./research-technical.md): Architecture, data models, file paths, API
  analysis
- [research-ux.md](./research-ux.md): What-if editing patterns, competitive analysis, accessibility
- [research-recommendations.md](./research-recommendations.md): Phasing strategy, risks, alternative
  approaches
