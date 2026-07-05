# Recommendations: Score Simulator Phase 2

## Executive Summary

Phase 2 should leverage the existing multi-release/multi-profile API contract
(`POST /api/v1/simulate/score` already accepts arrays of up to 50 releases and 10 profiles) to build
comparison and batch capabilities entirely as client-side UI work with minimal server changes. The
highest-impact deliverable is side-by-side profile comparison with score delta visualization, which
directly addresses the #1 user confusion around scoring trade-offs. The primary risks are rendering
performance at scale (50 releases x 10 profiles = 500 score computations displayed simultaneously)
and mobile layout complexity for comparison views.

## Implementation Recommendations

### Recommended Approach

The Phase 1 API is already designed for Phase 2 use cases. The `SimulateScoreRequest` accepts
`releases[]` (max 50) and `profileNames[]` (max 10), and the response returns a full matrix of
`SimulateReleaseResult[].profileScores[]`. Phase 1 currently sends exactly one release and one
profile, but the server handles multi-input natively. This means Phase 2 is primarily a UI build
with no API changes required.

The recommended strategy is to extend the existing `+page.svelte` with mode-switching (single vs
batch vs comparison) rather than creating separate routes. The page already manages `releaseTitle`,
`selectedProfileName`, and `simulationResult` state; Phase 2 extends these to arrays and adds a
second profile selector for comparison mode. This keeps all simulator state co-located and avoids
fragmenting the user experience across routes.

Key architectural decisions from Phase 1 that Phase 2 must respect:

- **Server-side scoring**: Unlike entity testing (which computes scores client-side from
  `cfScoresData`), the score simulator computes scores on the server in `+server.ts`. Phase 2 should
  maintain this pattern. It simplifies the client but means each profile/release combination change
  triggers an API call.
- **Request token pattern**: The `simulationRequestToken` counter in `+page.svelte` (line 35)
  handles race conditions from debounced input. Batch mode amplifies this concern since users may
  modify the title list while a large batch is in-flight.
- **Parser dependency**: The simulator returns empty results when the parser is unavailable (line
  128-133 of `+server.ts`). Batch mode makes parser latency more visible since uncached titles are
  parsed in parallel via `Promise.all` (line 320-339 of `client.ts`), not sequentially.

### Technology Choices

| Component              | Recommendation                                            | Rationale                                                                                                                        |
| ---------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Mode switching         | ViewToggle-style dropdown in ActionsBar                   | Matches existing `ViewToggle.svelte` pattern for table/cards; three modes: single, batch, comparison                             |
| Batch input            | Textarea with newline delimiter                           | Simpler than structured input; release titles are single-line strings with no special characters to escape                       |
| Profile comparison     | Dual `DropdownSelect` components                          | Reuse existing dropdown pattern from `ReleaseInput.svelte` (lines 143-176); no new component type needed                         |
| Ranking table          | `Table.svelte` with sortable columns                      | Existing `Table` component supports `sortable`, `sortAccessor`, `responsive`, and `pageSize` progressive loading                 |
| Presets                | Client-side constants module                              | Avoids PCD ops complexity; presets are static reference data (common release naming patterns); can be promoted to PCD later      |
| Progressive disclosure | `DisclosureSection.svelte` with `SS_ADVANCED_OPTIONS` key | Phase 1 already registered `SS_ADVANCED_OPTIONS` in `sectionKeys.ts` (line 58); extend with additional keys for Phase 2 sections |
| Score delta display    | Inline computed diff with color coding                    | Green for positive delta, red for negative; computed client-side from two `SimulateProfileScore` objects                         |

### Phasing Strategy

1. **Batch 1 - Foundation (Mode Infrastructure + Batch Input)**: Add mode state management to
   `+page.svelte`, create `BatchReleaseInput` component with textarea, wire batch titles through the
   existing API (which already accepts `releases[]`). This is the lowest-risk change since the API
   contract is already satisfied. Add new section keys to `sectionKeys.ts` for batch-specific
   disclosure sections.

2. **Batch 2 - Core Features (Comparison + Ranking)**: Build `ProfileComparison` component with dual
   profile selectors and delta visualization. Create `RankingTable` component using `Table.svelte`
   for batch results sorted by total score. These two features are independent and can be developed
   in parallel.

3. **Batch 3 - Polish (Presets + Progressive Disclosure + Mobile)**: Add example release title
   presets with categorization (movie/series, by quality tier). Wire progressive disclosure for
   advanced sections (per-condition details, raw parsed data). Optimize mobile layouts for
   comparison and ranking views.

### Quick Wins

- **Batch input with zero API changes**: The existing API accepts `releases[]` up to 50. Simply
  collecting multiple titles and sending them in one request enables batch mode immediately. The
  response already contains per-release results with `id` correlation.
- **Multi-profile scoring with zero API changes**: The existing API accepts `profileNames[]` up
  to 10. Sending two profile names in the comparison request returns scores for both profiles per
  release, enabling delta computation entirely client-side.
- **Ranking is a sort operation**: The `SimulateReleaseResult` response already contains
  `profileScores[].totalScore`. A ranking table is just a `Table.svelte` instance with
  `sortAccessor: (row) => row.profileScores[selectedIndex].totalScore` and
  `defaultSortDirection: 'desc'`.
- **localStorage persistence for batch titles**: Phase 1 already persists `releaseTitle` to
  localStorage (line 101). Extend to persist the batch textarea content using the same pattern.

## Improvement Ideas

### Related Features

- **Score delta visualization with threshold context**: When comparing two profiles, show not just
  the raw score difference but whether the delta crosses a threshold boundary (e.g., Release X is
  "below minimum" in Profile A but "accepted" in Profile B). The `resolveScoreThresholdState()`
  helper in `helpers.ts` (line 25) already computes threshold states; apply it to both profiles and
  highlight transitions.
- **Smart preset categories by quality tier**: Group presets by resolution (2160p/1080p/720p) and
  source (remux/web-dl/bluray/hdtv) since these are the primary scoring differentiators. Include
  "problem" titles that exercise edge cases (dual-language, repack, proper, hardcoded subs) to teach
  users about non-obvious CF matches.
- **Batch import from clipboard**: Detect multi-line paste events in the batch textarea and
  auto-split into individual titles. This supports the common workflow of copying release lists from
  indexers or Arr activity logs.
- **Export comparison as JSON/CSV**: Add an export button that serializes the current comparison
  results. JSON for programmatic use, CSV for spreadsheet analysis. This feeds into the Phase 3
  shareable-state goal without requiring URL parameter work.

### Future Enhancements

- **Keyboard shortcuts for power users**: `Ctrl+Enter` to simulate immediately (bypassing debounce),
  `Ctrl+1`/`Ctrl+2` to switch between profiles in comparison mode, `Ctrl+Shift+V` to
  paste-and-simulate in batch mode. Implementation cost: low (event listeners on the page
  container). Value: high for PCD authors who test repeatedly.
- **Persistent comparison sessions**: Save named comparison configurations (title set + profile
  pair) to localStorage for quick recall. Complexity: low (JSON serialization of current state).
  Value: medium (PCD authors testing the same scenarios across database updates).
- **Score heatmap for batch results**: For batch mode with multiple profiles, render a heatmap grid
  (releases as rows, profiles as columns, cell color intensity by score). Complexity: medium (custom
  rendering, not an existing component). Value: high for understanding scoring patterns across
  profiles.
- **Connection to Phase 3 what-if**: Design the comparison component to accept a
  `scoreOverrides: Map<string, number>` prop that defaults to empty. Phase 3 can populate this map
  from a what-if editor, and the comparison view re-renders with hypothetical scores without any
  structural changes.

## Risk Assessment

### Technical Risks

| Risk | Likelihood | Impact | Mitigation |
| -------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rendering performance at 50 releases x 10 profiles | Medium | High | Use `Table.svelte` progressive loading (`pageSize` prop) to render in batches of 20; defer per-condition expansion to click events. The ExpandableTable already implements IntersectionObserver-based progressive loading via `createProgressiveList`. |
| Parser latency for 50 uncached titles | Medium | High | `parseWithCacheBatch` (line 285 of `client.ts`) fires all parse requests in parallel via `Promise.all`. For 50 uncached titles, this means 50 concurrent HTTP calls to the parser. Add chunking (batches of 10-15) to avoid overwhelming the parser service. Cached titles return instantly from SQLite. |
| Request token invalidation with rapid batch edits | Medium | Medium | The `simulationRequestToken` counter (line 35 of `+page.svelte`) handles this for single-input. For batch mode, extend with AbortController support to cancel in-flight fetch requests when the user modifies the batch, preventing stale results from overwriting current state. |
| Mobile layout for comparison view | High | Medium | Side-by-side comparison is fundamentally incompatible with narrow viewports. On mobile, switch to a stacked layout with a toggle between Profile A and Profile B results, reusing the existing `responsive` and `isMobile` media query pattern from `Table.svelte` (lines 27-46). |
| State management complexity with three modes | Medium | Medium | Keep mode as a simple string enum (`'single'                                                                                                                                                                                                                                                               | 'batch' | 'comparison'`). Each mode renders its own input component but shares the `simulate()`function and result display logic. Avoid a separate store; co-locate state in`+page.svelte` reactive declarations. |
| Memory pressure from large result sets | Low | Medium | A full 50-release x 10-profile response includes CF match data for every CF in the database (potentially 100+ CFs per release). At 50 releases, this is ~5000 CF match objects. Monitor with DevTools. If problematic, trim `cfMatches` from batch results and only fetch per-condition details on expand. |

### Integration Challenges

- **Phase 1 state shape evolution**: Phase 1 stores `releaseTitle` (string) and
  `selectedProfileName` (string|null). Phase 2 needs `releaseTitles` (string[]) and
  `selectedProfileNames` (string[]). The migration must preserve localStorage backward compatibility
  -- read the old scalar keys and promote to arrays on first load, then write the new array keys
  going forward.
- **Debounce interaction with batch mode**: Phase 1 debounces at 300ms per keystroke in the textarea
  (line 40 of `ReleaseInput.svelte`). For batch mode, debouncing the entire textarea means every
  character in any line triggers a re-evaluation of all 50 titles. Consider debouncing at the
  simulate level (in `+page.svelte`) rather than at the input level, and increase the debounce
  interval to 500-800ms for batch mode.
- **ExpandableTable not designed for multi-column comparison**: The current
  `SimulationResults.svelte` uses `ExpandableTable` with a single score column. Comparison mode
  needs two score columns with delta. Either extend the `tableColumns` definition dynamically based
  on mode, or create a dedicated `ComparisonResults.svelte` component.

### Performance Concerns

- **Parser batch throughput**: The parser service processes titles sequentially per request (one
  `/parse` call per title). `parseWithCacheBatch` parallelizes via `Promise.all`, meaning 50
  uncached titles produce 50 simultaneous HTTP requests. The parser has a 30-second timeout per
  request (line 82 of `client.ts`). With dotnet's default thread pool, sustained 50 concurrent
  requests should complete in 2-5 seconds, but parser startup or GC pauses could push individual
  titles past the timeout. Mitigation: chunk parallel requests into groups of 10-15.
- **Pattern matching batch**: `matchPatternsBatch` sends all titles and all patterns in a single
  `/match/batch` request to the parser. For 50 titles x 500 patterns, the payload is ~50KB and the
  parser processes it in O(titles x patterns) time. This is already the optimized path; no further
  action needed.
- **DOM rendering**: 50 releases x 3 table columns = 150 cells in the ranking table, which is
  trivial. The concern is expanding a row to show CF matches (100+ rows in the inner table) for
  multiple releases simultaneously. The `disableExpandWhen` prop on ExpandableTable can be used to
  limit simultaneous expansions.

## Alternative Approaches

### Option A: Integrated Mode Toggle (Recommended)

Extend the existing `/score-simulator/[databaseId]/+page.svelte` with a mode switcher
(single/batch/comparison). All modes share the same page, API call pattern, and result display
components with mode-conditional rendering.

- **Pros**: Single page to maintain; shared state management; natural progressive disclosure (start
  in single mode, discover batch/comparison); preserves Phase 1 localStorage state; URL stays the
  same.
- **Cons**: Page component grows in complexity; mode-conditional rendering can become tangled;
  harder to lazy-load mode-specific components.

### Option B: Separate Comparison Page

Create a new route at `/score-simulator/[databaseId]/compare` (or
`/score-simulator/[databaseId]/batch`) with dedicated page components.

- **Pros**: Clean separation of concerns; each page is simpler; easier to lazy-load; independent
  state management per page.
- **Cons**: Duplicates page server load logic; user must navigate between modes; no way to "compare
  this" from the single-release view without a page transition; more routes to maintain; state lost
  during navigation.

### Option C: Textarea vs Structured Batch Input

**Textarea (recommended)**: Users paste or type newline-delimited release titles into a standard
textarea. Simple, flexible, and matches how users encounter release titles (copied from indexer
results, Arr logs, or forums).

**Structured input**: Individual text fields per release with add/remove controls. More explicit but
higher interaction cost for the primary batch use case (pasting a list). Could be added later as an
"advanced" batch mode.

### Option D: Static Presets vs PCD-Derived Presets

**Static presets (recommended for Phase 2)**: Hardcoded in a client-side `presets.ts` module
categorized by resolution + source + media type. Zero server overhead, instant loading,
version-controlled with the app.

**PCD-derived presets**: Read from PCD entity testing releases or a dedicated presets entity.
Enables community contributions but adds ops complexity, PCD schema changes, and a server
round-trip. Better suited for Phase 3 or a separate enhancement.

### Option E: Client-Side vs Server-Side Ranking

**Client-side ranking (recommended)**: The API response already contains all scores. Sorting is a
trivial `Array.sort()` call on `totalScore`. Table.svelte has built-in sort support with
`sortable: true` and `sortAccessor`.

**Server-side ranking**: Would require a new API field (`rank`) or a sorted response. Adds
unnecessary server complexity for no benefit since the client has all the data.

### Recommendation

**Option A (Integrated Mode Toggle)** with **textarea batch input**, **static presets**, and
**client-side ranking**. This combination minimizes server changes, maximizes code reuse from Phase
1, and delivers the best interactive experience. The mode toggle provides natural progressive
disclosure -- users start with single-release simulation (familiar from Phase 1) and discover batch
and comparison modes as their needs grow.

## Task Breakdown Preview

### Batch 1: Foundation (Mode Infrastructure + Batch Input)

- **Task group: Mode infrastructure**
  - Add mode state (`single | batch | comparison`) to `+page.svelte`
  - Create mode switcher UI (ViewToggle-style or segmented control in the input panel header)
  - Refactor `simulate()` to accept arrays of titles and profile names
  - Update localStorage persistence for multi-title/multi-profile state
  - Register new disclosure section keys (e.g., `score-simulator:batch:results-detail`,
    `score-simulator:comparison:delta-view`)
- **Task group: Batch release input**
  - Create `BatchReleaseInput.svelte` component (textarea with line-count indicator and clear
    button)
  - Parse textarea content into `SimulateReleaseInput[]` array (split by newline, trim, deduplicate,
    assign UUIDs)
  - Wire batch input to `simulate()` with adjusted debounce (500-800ms)
  - Handle empty lines and whitespace-only lines gracefully
- **Parallel opportunities**: Mode infrastructure and BatchReleaseInput are independent until
  wiring. Mode UI scaffold and input component can be developed simultaneously.

### Batch 2: Core Implementation (Comparison + Ranking)

- **Task group: Profile comparison**
  - Create `ProfileComparison.svelte` with dual profile selectors
  - Compute score deltas from two `SimulateProfileScore` objects
  - Render delta badges with threshold-crossing indicators (using `resolveScoreThresholdState`)
  - Build comparison results view: shared CF matches table with two score columns + delta column
  - Handle edge cases: same profile selected twice (show warning), one profile unselected (show
    single-profile view)
- **Task group: Ranking table**
  - Create `RankingTable.svelte` using `Table.svelte` with sortable total-score column
  - Map `SimulateReleaseResult[]` to ranking rows with parsed metadata summary
  - Support sorting by score, title, resolution, source
  - Add progressive loading (`pageSize: 20`) for large batch results
  - Click-to-expand row shows full CF match detail for that release
- **Parallel opportunities**: ProfileComparison and RankingTable are fully independent. They render
  different aspects of the same API response.

### Batch 3: Polish (Presets + Disclosure + Mobile)

- **Task group: Example presets**
  - Create `presets.ts` with categorized release title examples
  - Categories: movie-2160p, movie-1080p, series-2160p, series-1080p, edge-cases (repack, proper,
    dual-language, hardcoded subs)
  - Build preset selector UI (dropdown or tag-based category filter)
  - "Load preset" action that populates batch input textarea
- **Task group: Progressive disclosure**
  - Wrap per-condition detail tables in DisclosureSection (default: hidden)
  - Wrap raw parsed JSON in DisclosureSection (default: hidden)
  - Wrap advanced comparison metrics (per-CF delta breakdown) in DisclosureSection
- **Task group: Mobile optimization**
  - Comparison mode: stacked layout with profile toggle on mobile (reuse `isMobile` media query
    pattern)
  - Ranking table: responsive card layout via `Table.svelte` `responsive={true}`
  - Batch input: full-width textarea with collapsible results
- **Parallel opportunities**: Presets, disclosure, and mobile optimization are all independent.

## Key Decisions Needed

- **Mode toggle UX**: Should the mode switcher be a segmented control in the input panel header, a
  ViewToggle in an ActionsBar, or tabs within the page? The choice affects how discoverable
  batch/comparison modes are. Segmented control is most visible; ViewToggle matches existing
  patterns but is less prominent.
- **Debounce strategy for batch mode**: Should batch mode auto-simulate on every keystroke (with
  longer debounce) or require an explicit "Simulate" button click? Auto-simulate matches Phase 1
  behavior but is expensive for large batches. Explicit button click is more predictable but less
  interactive. A hybrid (auto-simulate for fewer than 5 titles, explicit button for more) could
  balance both.
- **Comparison: two profiles vs N profiles**: The current API supports up to 10 profiles. Should
  comparison mode be limited to exactly 2 profiles (simpler delta visualization) or support N-way
  comparison (more powerful but harder to visualize)? Recommendation: start with 2, design the data
  flow for N.
- **Preset mutability**: Should loading a preset replace the current batch input or append to it?
  Replace is simpler and avoids confusion; append enables building custom sets from multiple preset
  categories.

## Open Questions

- Should the ranking table include a "grab verdict" column (would this release be grabbed based on
  minimum score threshold)? The data is available in `minimumScore` and `upgradeUntilScore`. This
  would require `resolveScoreThresholdState()` per release-profile pair.
- For comparison mode, should CF matches that differ between profiles be highlighted automatically,
  or should the user explicitly toggle a "show differences only" filter?
- Does the 50-release limit need to be increased for Phase 2, or is 50 sufficient for realistic
  batch testing? Parser performance degrades linearly with uncached titles.
- Should batch results persist across database tab switches, or should switching databases clear the
  simulation? Phase 1 clears results implicitly since the profile list changes.

## Relevant Files

### Phase 1 Implementation (extend these)

- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte`: Main page component;
  owns all state, API calls, and layout
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.server.ts`: Server load;
  databases, quality profiles, parser health
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/helpers.ts`:
  `getSelectedProfileScore()`, `resolveScoreThresholdState()`, `sortScoreContributionsByMagnitude()`
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ReleaseInput.svelte`:
  Single-release input with media type and profile selectors
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/SimulationResults.svelte`:
  CF match table with ExpandableTable, metadata badges
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/ScoreBreakdown.svelte`:
  Total score display with threshold badges and contribution list

### API (no changes expected)

- `packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts`: POST handler; already supports
  `releases[]` (max 50) and `profileNames[]` (max 10)
- `docs/api/v1/schemas/score-simulator.yaml`: OpenAPI schema for request/response types
- `docs/api/v1/paths/score-simulator.yaml`: API path definition
- `packages/praxrr-app/src/lib/api/v1.d.ts`: Generated TypeScript types (lines 694-736)

### Reusable UI Components

- `packages/praxrr-app/src/lib/client/ui/table/Table.svelte`: Sortable, responsive table with
  progressive loading
- `packages/praxrr-app/src/lib/client/ui/table/ExpandableTable.svelte`: Table with expandable rows,
  mobile card layout
- `packages/praxrr-app/src/lib/client/ui/form/DisclosureSection.svelte`: Progressive disclosure with
  persisted preferences
- `packages/praxrr-app/src/lib/client/ui/actions/ViewToggle.svelte`: Table/card view mode switcher
- `packages/praxrr-app/src/lib/client/ui/badge/Badge.svelte`: Score and status badges
- `packages/praxrr-app/src/lib/client/ui/arr/Score.svelte`: Score display component (used in
  breakdown and results)
- `packages/praxrr-app/src/lib/client/ui/arr/CustomFormatBadge.svelte`: CF name + score badge
- `packages/praxrr-app/src/lib/client/utils/progressiveList.ts`: IntersectionObserver-based
  progressive rendering

### Infrastructure

- `packages/praxrr-app/src/lib/shared/disclosure/sectionKeys.ts`: Section key registry;
  `SS_ADVANCED_OPTIONS` already registered (line 58)
- `packages/praxrr-app/src/lib/client/stores/userInterfacePreferences.ts`: Persisted disclosure mode
  store
- `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`: `parseWithCacheBatch()`
  (line 285) and `matchPatternsBatch()` (line 446); key performance characteristics documented in
  comments
- `packages/praxrr-app/src/lib/server/navigation/registry.ts`: Nav registration (line 195); score
  simulator already registered as top-level nav item

### Existing Research

- `docs/plans/score-simulator/research-recommendations.md`: Phase 1 research document (includes
  Phase 2/3 outline)
- `docs/plans/score-simulator/feature-spec.md`: Full feature spec with business rules and edge cases

## Other Docs

- GitHub Issue #13: [Feature] Score Simulator / Playground (Phase 2 scope defined in issue body)
- GitHub Issue #30: Configuration Impact Simulator (Phase 3 integration target)
- GitHub Issue #11: Progressive Disclosure (disclosure section infrastructure)
- `docs/plans/score-simulator/shared.md`: Shared context across all score simulator planning
