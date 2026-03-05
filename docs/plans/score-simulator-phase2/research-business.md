# Business Logic Research: Score Simulator Phase 2

## Executive Summary

Phase 2 extends the existing single-release scoring simulator (Phase 1) with three new capabilities:
side-by-side profile comparison, batch release evaluation with ranking, and example release title
presets. The core business value is that users can answer two questions Phase 1 cannot: "Which
profile scores this release better?" and "Which release would my profile prefer?" These capabilities
transform the simulator from a debugging tool into a decision-support and learning tool, directly
addressing the documented #1 adoption barrier -- scoring confusion.

## User Stories

### Primary User: Configuration Author (PCD Database Maintainer)

- As a PCD author, I want to compare how the same set of releases scores under two different quality
  profiles so that I can validate scoring trade-offs before publishing changes.
- As a PCD author, I want to paste 10-20 real release titles at once and see them ranked by total
  score so that I can verify my profile correctly prioritizes the intended quality tiers.
- As a PCD author, I want to see the score delta between profiles for each release so that I can
  identify exactly which custom formats cause ranking differences.

### Secondary User: Self-Hoster (End User)

- As a self-hoster, I want to compare my current profile against a TRaSH Guide recommended profile
  for the same releases so that I can decide whether to switch.
- As a self-hoster, I want to batch-test releases from my recent grab history so that I can verify
  my scoring configuration matches my expectations.
- As a self-hoster, I want to understand why a particular release was preferred over another by
  seeing them ranked with score breakdowns.

### Tertiary User: New User (Onboarding)

- As a new user, I want to load example release titles for movies or series so that I can see
  scoring in action without needing to know release naming conventions.
- As a new user, I want progressive disclosure that starts with a simple view and reveals advanced
  comparison features as I explore, so that I am not overwhelmed on first visit.
- As a new user, I want example presets with brief descriptions explaining what makes each release
  interesting for scoring (e.g., "Remux with HDR -- typically highest score").

## Business Rules

### Core Rules

1. **Profile Comparison**
   - Users select exactly two profiles from the same database for comparison mode.
   - Both profiles can be PCD profiles, both TRaSH Guide profiles, or one of each (the API already
     supports the `pcd:` and `trash:` profile selector prefixes).
   - CF matching is shared: the same release produces the same set of matching custom formats
     regardless of profile. Only score contributions differ.
   - The comparison view must display: profile name, total score per profile, per-CF score
     contribution per profile, and the delta (Profile A score - Profile B score).
   - Score precedence rules remain unchanged: specific `arr_type` score > `all` wildcard score > 0
     (no mapping). PCD profiles resolve via `scoring/read.ts`; TRaSH profiles resolve via
     `format_items[].score`.
   - Both profiles must be evaluated against the same `arrType` (radarr or sonarr). Cross-arr-type
     comparison is not meaningful and must not be allowed.

2. **Batch Input**
   - Maximum 50 releases per request (already enforced in the API at `+server.ts` line 106).
   - Maximum 10 profile names per request (already enforced at line 99).
   - Each release requires: `id` (client-generated correlation ID), `title` (non-empty string), and
     `type` (movie or series).
   - All releases in a single batch must share the same `arrType` (radarr or sonarr). Mixed
     movie/series in the same batch is supported at the API level (the `type` field is per-release),
     but the `arrType` is a single request-level field that governs score column resolution. This
     means a user could technically submit movie titles with `arrType: sonarr`, but results would be
     misleading. The UI should enforce that media type and `arrType` stay aligned.
   - Input format: one release title per line in a textarea. Client strips empty lines, trims
     whitespace, and assigns correlation IDs before submission.
   - Validation: reject titles longer than 500 characters (reasonable upper bound for release
     naming). Reject duplicate titles within the same batch (no point re-evaluating identical
     strings).
   - Debounce behavior changes in batch mode: do not auto-simulate on every keystroke. Instead,
     require explicit "Simulate" button click or Ctrl+Enter to trigger batch evaluation, because
     parsing 50 titles is non-trivial (~1-5s cold).

3. **Example Presets**
   - Two top-level categories: **Movie** (maps to `arrType: radarr`) and **Series** (maps to
     `arrType: sonarr`).
   - Each category contains curated subcategories representing common scoring scenarios:
     - **Movie**: "Remux Quality Tier" (BluRay Remux with various audio codecs), "WEB-DL Quality
       Tier" (WEB-DL at various resolutions), "Encode Quality Tier" (x264/x265 encodes with
       scene/P2P groups), "Edge Cases" (hybrid releases, multi-language, repack/proper).
     - **Series**: "WEB-DL Season Pack" (standard streaming rips), "BluRay Series" (disc-based
       releases), "Daily Shows / Anime" (atypical naming patterns), "Edge Cases" (dual-language,
       absolute numbering).
   - Each preset is a list of 3-8 release titles, not a single title. Loading a preset populates the
     batch input textarea.
   - Presets are hardcoded in the client initially (per Phase 1 spec decision). No PCD entity or
     database storage needed.
   - Each preset group includes a one-line description explaining the scoring scenario it
     demonstrates.

4. **Ranking Table**
   - Primary sort: total score descending (highest score = rank 1 = "most preferred release").
   - Tie-breaking: when two releases have the same total score, sort by number of matching CFs
     descending (more matches = richer metadata = higher confidence). If still tied, sort
     alphabetically by title.
   - Display columns: Rank (1-indexed), Release Title (truncated with tooltip for full title), Total
     Score (using `Score.svelte`), Matched CFs count, Threshold Status (below minimum / accepted /
     upgrade reached).
   - Each row is expandable to show per-CF score breakdown (reuses `ScoreBreakdown` contribution
     list pattern).
   - In comparison mode, the ranking table shows two score columns (one per profile) and two rank
     columns. Highlight rows where rank differs between profiles (e.g., release ranked #1 under
     Profile A but #3 under Profile B).
   - Per-profile ranking: each profile has its own independent ranking. There is no "cross-profile
     rank" -- rankings are always scoped to a single profile.

5. **Progressive Disclosure**
   - **Basic mode** (default): Single release input (textarea, single line), single profile
     selector, results table with CF matches and score breakdown. This is the current Phase 1
     experience.
   - **Advanced mode** (disclosed): Batch input (multi-line textarea), second profile selector for
     comparison, preset selector, ranking table. Advanced mode adds capabilities without removing or
     relocating basic mode elements.
   - Disclosure toggle uses the existing `DisclosureSection` component with section key
     `SS_ADVANCED_OPTIONS` (already registered in `sectionKeys.ts` at line 58).
   - The user's disclosure preference persists via the `userInterfacePreferences` store (already
     implemented for other sections).
   - When switching from advanced back to basic: if batch titles are present, keep only the first
     title. If two profiles are selected, keep the first profile. Do not lose state silently -- show
     a brief confirmation if data would be discarded.

### Edge Cases

- **Parser unavailable in batch mode**: Return `parserAvailable: false` with empty results (already
  handled by the API). The UI should show a single warning banner at the top, not per-release
  warnings.
- **Mixed PCD and TRaSH profiles in comparison**: Fully supported. PCD profiles use
  `scoring/read.ts` for score resolution; TRaSH profiles use `format_items[].score`. The API already
  handles both via `ResolvedPcdProfile` and `ResolvedTrashProfile` discriminated union.
- **Profile with no CF scores**: A profile that has no custom format score mappings produces
  `totalScore: 0` for every release. The ranking table should still display these results (all tied
  at 0) rather than hiding them.
- **All releases unparseable**: If the parser cannot parse any titles in a batch, all results have
  `parsed: null` and `cfMatches` with all CFs set to `matches: false`. The ranking table shows all
  releases tied at 0 with a banner explaining that parsing failed.
- **Preset titles that do not match any CFs**: This is expected for "edge case" presets. The UI
  should not treat zero matches as an error -- it is the correct demonstration of the scoring
  scenario.
- **Zero-score matched CFs in ranking**: A CF that matches but has a score of 0 in the selected
  profile counts toward "Matched CFs" count but contributes nothing to `totalScore`. This is a
  deliberately different signal: "this CF recognizes the release but the profile does not reward or
  penalize it."
- **Large CF count performance**: The API already batch-loads all CFs via
  `getAllConditionsForEvaluation()` and batch-matches patterns via `matchPatternsBatch()`. For 50
  releases x 100+ CFs, expect 2-5 seconds cold, <500ms cached. The UI should show a progress
  indicator for batch operations.
- **Comparison with identical profiles**: Allow it (useful for verifying profile behavior). Both
  columns show identical values. No special handling needed.
- **Duplicate preset names across categories**: Each preset must have a unique `id` within its
  category. Cross-category duplicates are fine (e.g., both Movie and Series can have an "Edge Cases"
  subcategory).

## Workflows

### Profile Comparison Workflow

1. User is on the score simulator page with a release title already entered (Phase 1 state).
2. User expands the Advanced Options disclosure section.
3. A second profile selector ("Compare With") appears below the existing profile selector.
4. User selects a second profile from the dropdown (same database, filtered to exclude
   already-selected profile -- or allow same profile for validation).
5. Client sends `POST /api/v1/simulate/score` with `profileNames: [profileA, profileB]` (the API
   already supports multiple profile names).
6. Results panel switches from single-profile view to comparison view:
   - Side-by-side score cards showing total score, threshold status, and contribution list for each
     profile.
   - CF match table gains a second "Score" column showing contributions under each profile.
   - Delta column shows the difference (Profile A score - Profile B score) for each CF.
7. If batch titles are also present, the ranking table shows dual-rank columns.
8. User can dismiss comparison by clearing the second profile selector ("Compare With" set to
   "None").

### Batch Evaluation Workflow

1. User expands the Advanced Options disclosure section.
2. The release title textarea placeholder changes to indicate multi-line support: "Paste release
   titles, one per line..."
3. User pastes or types multiple release titles (one per line).
4. Client does NOT auto-simulate on each keystroke. Instead, a "Simulate All" button (or Ctrl+Enter)
   triggers batch evaluation.
5. Client validates: strip empty lines, trim whitespace, enforce max 50, deduplicate, generate
   correlation IDs.
6. Client sends a single `POST /api/v1/simulate/score` request with all releases.
7. Results panel switches from single-result view to ranking table view.
8. Ranking table shows all releases sorted by total score descending.
9. User can expand any row to see parsed metadata, CF matches, and score breakdown for that release.
10. If a profile is not selected, the ranking table is hidden and a prompt is shown.

### Preset Learning Workflow

1. User expands the Advanced Options disclosure section (or presets are visible in basic mode as a
   lightweight entry point -- decision needed).
2. A "Load Examples" dropdown or button group appears, organized by category: Movie | Series.
3. User selects a category, then a subcategory (e.g., Movie > Remux Quality Tier).
4. Client populates the batch input textarea with the preset's release titles (one per line).
5. Client auto-sets the media type to match the preset category (Movie -> movie, Series -> series).
6. Client does NOT auto-select a profile (user must choose one to see scores).
7. A brief description of the preset appears below the textarea: "These releases demonstrate BluRay
   Remux releases at various quality levels. Compare how your profile ranks them."
8. User selects a profile and clicks Simulate.
9. Results appear in the ranking table. The user can compare how different profiles rank the same
   preset by switching profiles or enabling comparison mode.

## Domain Model

### Key Entities

- **Release**: A parsed release title with correlation ID, raw title string, media type, and parsed
  metadata (source, resolution, modifier, languages, year, release group, edition). Ephemeral --
  exists only for the duration of a simulation request.
- **Custom Format Match**: The evaluation result of a single CF against a single release. Contains
  match boolean, per-condition results, and the CF name. Shared across profiles -- a CF either
  matches or it does not, regardless of scoring.
- **Profile Score**: The scoring result for a single release against a single quality profile.
  Contains total score, threshold values (minimum, upgrade-until), and per-CF contributions.
  Different profiles produce different scores for the same set of CF matches.
- **Score Contribution**: A single CF's score value for a specific profile. The same CF can have
  different scores across profiles and across arr types.
- **Ranking**: An ordering of releases by total score for a given profile. Rank is profile-scoped --
  the same set of releases can have different rankings under different profiles.
- **Preset**: A curated group of release titles associated with a category (movie/series) and
  subcategory. Static client-side data, not a PCD entity.

### Score Precedence (Critical Domain Rule)

The `quality_profile_custom_formats` table stores scores with an `arr_type` column. Resolution order
(implemented in `scoring/read.ts` lines 80-88):

1. If a row exists with `arr_type = 'radarr'` (for movie simulation) or `arr_type = 'sonarr'` (for
   series), use that score.
2. Else if a row exists with `arr_type = 'all'`, use that score.
3. Else effective score is 0 (no mapping, CF is scored at zero).

For TRaSH Guide profiles, scores come from `format_items[].score` directly -- there is no arr-type
splitting because TRaSH profiles are already arr-type-specific.

### Threshold Indicators

Three threshold states exist (already implemented in `helpers.ts` as `ScoreThresholdState`):

- **below**: `totalScore < minimumScore` -- release would be rejected.
- **accepted**: `totalScore >= minimumScore && totalScore < upgradeUntilScore` -- release would be
  grabbed and upgrades are enabled.
- **upgrade-reached**: `totalScore >= upgradeUntilScore` -- release would be grabbed but no further
  upgrades occur for this quality.

### State Transitions

- **Basic -> Advanced**: User clicks disclosure toggle. Second profile selector and batch features
  appear. No data is lost.
- **Advanced -> Basic**: User clicks disclosure toggle. If batch titles exist (>1 line), prompt
  user: "Switching to basic mode will keep only the first title. Continue?" If confirmed, truncate
  to first title, clear second profile.
- **Single -> Comparison**: User selects a second profile. Results view morphs from single-profile
  layout to side-by-side.
- **Single -> Batch**: User enters multiple lines in the textarea and triggers simulate. Results
  view morphs from single-result layout to ranking table.
- **Comparison + Batch**: Both modes active simultaneously. Ranking table shows dual-rank columns.

## Existing Codebase Integration

### Current Phase 1 Implementation

Phase 1 delivers a complete single-release, single-profile scoring workflow:

- **API** (`+server.ts`): Already supports multiple releases (up to 50) and multiple profiles (up
  to 10) in a single request. The batch and comparison API surface is complete -- Phase 2 is purely
  a UI/UX expansion.
- **Page** (`+page.svelte`): Manages state for a single release title, single media type, single
  profile. Uses `simulate()` to call the API with `releases: [singleRelease]` and
  `profileNames: [singleProfile]`. Phase 2 extends this to pass arrays.
- **ReleaseInput**: Single-line textarea, media type toggle, single profile dropdown, debounced
  input dispatch. Phase 2 must evolve this to support multi-line input, second profile selector, and
  preset loading.
- **SimulationResults**: Renders parsed metadata, CF match table (using `ExpandableTable`), and
  condition details for a single release result (`result.results[0]`). Phase 2 must handle
  `result.results[N]` for ranking.
- **ScoreBreakdown**: Renders total score, threshold badge, and contribution list for a single
  profile. Phase 2 must render this side-by-side for comparison.
- **helpers.ts**: Contains `getSelectedProfileScore()` (extracts profile score from first result),
  `resolveScoreThresholdState()`, and `sortScoreContributionsByMagnitude()`. Phase 2 will add
  ranking logic and comparison delta computation.

### Patterns to Follow

- **ExpandableTable**: Used in `SimulationResults.svelte` for CF match rows with expandable
  condition detail. Reuse for the ranking table with expandable per-release breakdown.
- **Score component**: `$ui/arr/Score.svelte` handles sign-prefixed color-coded score display.
  Already used throughout.
- **Badge component**: `$ui/badge/Badge.svelte` with variants (success, danger, warning, neutral,
  info). Used for threshold indicators and metadata display.
- **CustomFormatBadge**: `$ui/arr/CustomFormatBadge.svelte` displays CF name with score context.
  Used in contribution lists.
- **DisclosureSection**: `$ui/form/DisclosureSection.svelte` wraps advanced content with persisted
  toggle state. Section key `SS_ADVANCED_OPTIONS` is already registered.
- **Dropdown/DropdownItem**: Used in `ReleaseInput.svelte` for profile selection. Reuse for preset
  selection and second profile selector.
- **clickOutside directive**: `$lib/client/utils/clickOutside` used for dropdown dismissal.
- **localStorage persistence**: Phase 1 persists `lastTitle`, `lastProfileName`, and `database` to
  localStorage. Phase 2 should extend with `lastBatchTitles`, `lastCompareProfileName`, and
  `lastPresetId`.
- **Request token pattern**: `simulationRequestToken` in `+page.svelte` ensures only the latest
  request's results are applied, preventing race conditions. Must be maintained for batch requests.
- **Event dispatch**: `ReleaseInput.svelte` uses `createEventDispatcher` with typed events (`input`,
  `profileChange`). Phase 2 adds new events (`batchInput`, `compareProfileChange`, `presetLoad`).

### Components to Leverage

- **ExpandableTable** (`$ui/table/ExpandableTable.svelte`): Core ranking table component. Supports
  sortable columns, expandable rows, compact mode, responsive layout. Column type system
  (`Column<T>` in `types.ts`) supports custom sort accessors and comparators needed for rank/score
  sorting.
- **Score** (`$ui/arr/Score.svelte`): Score display with color coding. Used in ranking table score
  columns.
- **Badge** (`$ui/badge/Badge.svelte`): Threshold state indicators in ranking table rows.
- **DisclosureSection** (`$ui/form/DisclosureSection.svelte`): Advanced mode toggle. Section key
  `SS_ADVANCED_OPTIONS` already registered.
- **Tabs** (`$ui/navigation/tabs/Tabs.svelte`): Already used for database switching. Could be reused
  for Movie/Series preset category tabs.
- **Dropdown/DropdownItem** (`$ui/dropdown/`): Profile selection, preset selection.

### API Readiness

The `POST /api/v1/simulate/score` endpoint is already Phase 2-ready:

- Accepts `releases[]` array with max 50 items.
- Accepts `profileNames[]` array with max 10 items.
- Returns `results[]` with per-release CF matches and per-profile scores.
- Supports both PCD profiles (`pcd:Name`) and TRaSH profiles (`trash:sourceId:Name`).
- No API changes needed for Phase 2 -- all work is client-side.

## Success Criteria

- [ ] User can select two profiles and see side-by-side score comparison for the same release(s)
- [ ] User can paste up to 50 release titles and see them ranked by total score
- [ ] User can load curated example presets organized by movie and series categories
- [ ] Ranking table sorts by total score descending with tie-breaking by matched CF count then
      alphabetical
- [ ] In comparison mode, ranking table shows per-profile ranks and highlights rank differences
- [ ] Progressive disclosure hides batch/comparison features by default, reveals on toggle
- [ ] Disclosure preference persists across sessions via `userInterfacePreferences` store
- [ ] Switching from advanced to basic mode preserves first title and first profile with user
      confirmation if data would be lost
- [ ] Batch mode does not auto-simulate on keystroke; requires explicit action (button or
      Ctrl+Enter)
- [ ] All Phase 1 single-release functionality continues to work identically in basic mode
- [ ] No new API endpoints or schema changes needed (existing endpoint supports all Phase 2 use
      cases)
- [ ] Performance: batch of 50 releases x 2 profiles completes in <5s cold, <1s cached

## Open Questions

1. **Preset visibility**: Should example presets be visible in basic mode (as a lightweight entry
   point for new users) or only in advanced mode? Showing them in basic mode increases
   discoverability but adds UI complexity to the default view.
2. **Preset content ownership**: Who curates and maintains the preset release titles? Are they
   version-locked to the codebase, or should they eventually come from PCD data (e.g., a
   `test_releases` entity)?
3. **Comparison limit**: Should comparison support exactly 2 profiles, or up to 3? Two is simpler
   and covers the primary use case (A vs B). Three adds complexity to the layout but supports "my
   profile vs two TRaSH recommendations."
4. **Ranking persistence**: Should the ranking table results persist in localStorage so users can
   return to their last batch evaluation? Or is ephemeral-only appropriate given the read-only
   design?
5. **Advanced-to-basic data loss UX**: Is a confirmation dialog the right pattern, or should we
   allow lossless round-tripping (keep all batch titles in memory, just hide them, restore on
   re-expand)?
6. **Preset descriptions**: Should each individual release title in a preset have a
   tooltip/annotation explaining what it demonstrates, or only the preset group as a whole?
