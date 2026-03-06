# UX Research: Score Simulator Phase 2

## Executive Summary

Phase 2 extends the simulator from a single-release testing tool into a multi-release evaluation and
profile comparison platform. The key UX challenge is managing increased complexity (batch input,
dual-profile comparison, ranking tables) without overwhelming users who are still learning the
scoring system. The recommended approach uses progressive disclosure to layer advanced features
behind expandable sections, a synchronized dual-column comparison layout with difference
highlighting for profile comparison, a textarea-based batch input with per-line validation feedback,
and categorized preset cards for guided learning. All patterns build on the existing Phase 1
split-pane layout and component library (ExpandableTable, Score, Badge, CustomFormatBadge).

**Confidence**: High -- based on established comparison UI patterns (SAP Fiori, diff2html),
progressive disclosure research (Nielsen Norman Group), and competitive analysis of playground tools
(Regex101, GraphQL Playground, Postman).

## User Workflows

### Profile Comparison Workflow

1. **Enter release title**: User enters a single release title in the existing input field (Phase 1
   flow unchanged).
2. **Enable comparison mode**: User clicks "Compare Profiles" toggle or expands the comparison
   section below the profile selector. System reveals a second profile dropdown alongside the first.
3. **Select two profiles**: User picks Profile A (already selected) and Profile B from the second
   dropdown. System immediately runs simulation for both profiles against the same release.
4. **View side-by-side results**: System displays two score breakdown columns, one per profile, with
   aligned custom format rows. Rows where scores differ are highlighted with a subtle left-border
   accent. Total score, minimum threshold, and upgrade-until values appear at the top of each
   column.
5. **Interpret the delta**: A summary row at the top shows the score difference (e.g., "+350 for
   Profile B") with a brief explanation ("Profile B scores DTS-HD MA higher"). The user understands
   which profile would prefer this release and why.
6. **Drill into differences**: User clicks any highlighted row to expand condition details for that
   custom format, seeing exactly which conditions matched differently (if applicable) or simply that
   the score assignment differs.
7. **Exit comparison**: User collapses the comparison section or deselects the second profile to
   return to single-profile view.

**Confidence**: High -- mirrors the SAP Fiori comparison pattern and diff2html side-by-side model,
adapted for the scoring domain.

### Batch Evaluation Workflow

1. **Switch to batch mode**: User expands the "Batch Input" section below the single-release input.
   The single input remains visible but a textarea appears for multi-line entry.
2. **Enter multiple titles**: User types or pastes release titles, one per line, into the textarea
   (up to 50 lines). A line counter shows "12 / 50 titles" to indicate progress against the limit.
3. **Trigger evaluation**: User clicks "Simulate All" (batch mode uses explicit submission, not
   real-time debounce, to avoid excessive parser load). A progress indicator shows "Processing 5 /
   12..." as results stream in.
4. **View ranking table**: Results appear as a sorted table with columns: Rank, Release Title
   (truncated with tooltip for full title), Total Score, Matched CFs count, and Outcome
   (Grabbed/Rejected badge). Default sort is by total score descending.
5. **Drill into details**: User clicks any row to expand it, revealing the full score breakdown
   (reusing the existing SimulationResults layout) for that specific release.
6. **Re-sort and filter**: User clicks column headers to re-sort (by title alphabetically, by score,
   by match count). An optional toggle filters to "only show grabbed" or "only show rejected."
7. **Fix errors**: If any titles failed parsing, those rows appear at the bottom with an amber
   warning icon and the message "Could not parse." The user can edit the title inline or remove it.

**Confidence**: High -- follows Postman Collection Runner result display patterns and standard
sortable table UX.

### Preset Learning Workflow

1. **Discover presets**: A "Try Examples" button or link appears near the release title input.
   Clicking it opens a categorized dropdown or popover panel.
2. **Browse categories**: Presets are organized into categories:
   - **Movies**: Blu-ray Remux, WEB-DL 1080p, x265 HDR Encode, CAM/TS (low quality), Hybrid Remux
   - **Series**: WEB-DL Season Pack, HDTV 720p, WEB-DL 2160p DV, Daily Show Episode
   - **Edge Cases**: Multi-language release, Dual Audio, Repack/Proper, Scene vs P2P naming
3. **Preview before loading**: Each preset shows the release title text and 1-2 sentence description
   of what makes it interesting for scoring (e.g., "High-quality Remux with lossless audio -- tests
   HDR, audio, and source scoring").
4. **Load preset**: User clicks a preset. The title populates the input field and simulation runs
   automatically. For batch mode, a "Load All in Category" option adds all presets from that
   category to the batch textarea.
5. **Experiment from preset**: User modifies the loaded preset title (e.g., changes "DTS-HD.MA" to
   "AAC") and immediately sees how the score changes. This teaches cause-and-effect relationships.

**Confidence**: High -- follows the Regex101 example library pattern and GraphQL Playground saved
queries model. Curated presets solve the cold-start problem for new users.

### Progressive Disclosure Flow

1. **Default state (Basic Mode)**: User sees the existing Phase 1 interface: single release input,
   media type selector, profile dropdown, simulate button, results panel. No batch, comparison, or
   preset UI is visible.
2. **Discover advanced features**: Below the profile selector, a subtle "Advanced" section header
   with a chevron indicates expandable content. Alternatively, small icon-buttons for "Compare" and
   "Batch" appear in the input panel header.
3. **Expand comparison**: Clicking "Compare" reveals the second profile dropdown inline. The results
   panel splits into two columns. No page navigation required.
4. **Expand batch**: Clicking "Batch" transforms the single-line input into a multi-line textarea.
   The results panel switches from single-result view to ranking table view.
5. **Collapse back**: Each advanced section has a clear close/collapse control. Collapsing returns
   to the basic single-release view. User state (selected profiles, entered titles) is preserved in
   case they re-expand.
6. **Persistence**: The last-used mode (basic/comparison/batch) is saved to localStorage so
   returning users see their preferred view.

**Confidence**: High -- follows Nielsen Norman Group's progressive disclosure principles (limit to 2
levels, make progression obvious, maintain strong information scent).

## UI/UX Best Practices

### Side-by-Side Comparison

- **Synchronized dual-column layout**: Two columns sharing the same row grid, so custom format names
  align horizontally. Each column has its own header card showing profile name, total score, and
  threshold badges. Use CSS Grid with `grid-template-columns: 1fr 1fr` on the results area.
  - **Confidence**: High -- standard comparison table pattern per
    [LogRocket comparison design guide](https://blog.logrocket.com/ux-design/ui-design-comparison-features/).

- **Difference highlighting**: Rows where scores differ between profiles get a left border accent
  (e.g., `border-l-2 border-accent-500`) and a subtle background tint. Rows with identical scores
  remain unstyled. This draws the eye to meaningful differences without cluttering identical rows.
  - **Confidence**: High -- follows diff2html's approach of highlighting only changed lines.

- **Delta summary header**: Above the two columns, a summary bar shows: "Profile A: +2450 | Profile
  B: +2800 | Delta: +350 favoring Profile B". Use the existing `Score.svelte` component for the
  delta value with green/red coloring.
  - **Confidence**: Medium -- effective for quick comprehension but adds visual density.

- **Sticky column headers**: Profile name and total score remain fixed at the top of each column as
  the user scrolls through the custom format list. Implement with `position: sticky; top: 0`.
  - **Confidence**: High -- standard table UX per
    [W3C sortable table pattern](https://www.w3.org/WAI/ARIA/apg/patterns/table/examples/sortable-table/).

- **Mobile responsive**: On screens below 1024px, switch from side-by-side columns to tabbed view
  with "Profile A" and "Profile B" tabs. Maintain scroll position when switching tabs. On screens
  below 768px, use a swipeable carousel (CSS scroll-snap) with dot indicators.
  - **Confidence**: High -- follows
    [NN/g mobile tables guidance](https://www.nngroup.com/articles/mobile-tables/) and
    [Smashing Magazine responsive comparison tables](https://www.smashingmagazine.com/2017/08/designing-perfect-feature-comparison-table/).

### Batch Input Patterns

- **Textarea with line numbers (recommended)**: A `<textarea>` with a gutter showing line numbers,
  similar to a code editor. Each line is one release title. Advantages: familiar paste target, easy
  to scan, supports copy-paste from spreadsheets or text files. Display a counter below: "12 / 50
  titles".
  - Pros: Simple implementation, natural for paste workflows, minimal JS required.
  - Cons: No per-line rich validation UI (must use separate error list).
  - **Confidence**: High -- the existing `ReleaseInput.svelte` already uses a textarea; this extends
    naturally.

- **Alternative -- list of inputs**: Individual `<input>` fields stacked vertically with add/remove
  buttons. Each field can show inline validation (green check or red X). More control per item but
  heavier UI and slower for bulk paste.
  - Pros: Per-line validation inline, can show parsed metadata per line.
  - Cons: Slower for paste, more DOM nodes, awkward for 50 items.
  - **Confidence**: Medium -- better for small batches (5-10) but does not scale to 50.

- **CSV/paste detection**: When the user pastes multi-line content into the textarea, detect line
  breaks and show a confirmation: "Detected 15 release titles. Simulate all?" This prevents
  accidental batch simulation from a single long paste.
  - **Confidence**: Medium -- nice UX touch but not critical for MVP.

### Preset Systems

- **Categorized dropdown with descriptions (recommended)**: A dropdown triggered by a "Try Examples"
  button, organized into collapsible category headers (Movies, Series, Edge Cases). Each preset
  shows the title text and a one-line description. Selecting a preset populates the input.
  - Best for this use case because: minimal screen real estate, fast to browse, works in both basic
    and batch modes.
  - **Confidence**: High -- follows GraphQL Playground's query collection pattern.

- **Alternative -- card grid**: A grid of clickable cards, each showing a preset title with category
  tag and difficulty indicator. More visual but takes more space; better suited for a dedicated
  "Examples" page or modal rather than inline.
  - **Confidence**: Medium -- better for onboarding tutorials than inline use.

- **Preset data structure**: Each preset should include:
  ```typescript
  interface ReleasePreset {
    id: string;
    title: string; // The release title string
    category: 'movie' | 'series' | 'edge-case';
    mediaType: 'movie' | 'series';
    description: string; // What makes this interesting
    tags: string[]; // e.g., ['remux', 'hdr', 'lossless-audio']
  }
  ```
  Store presets as a static JSON array in the client bundle (no API call needed). Keep the list
  curated (20-30 presets total).
  - **Confidence**: High -- static data avoids API complexity and keeps presets fast.

### Sortable Ranking Tables

- **Column-header click sorting**: Click a column header to sort ascending; click again for
  descending. Show a directional arrow icon (chevron-up/chevron-down) next to the active sort
  column. Default sort: Total Score descending.
  - **Confidence**: High -- standard pattern per
    [W3C sortable table example](https://www.w3.org/WAI/ARIA/apg/patterns/table/examples/sortable-table/)
    and existing `ExpandableTable` component.

- **Expandable detail rows**: Each row in the ranking table has a chevron that expands to show the
  full score breakdown for that release. Reuse the existing `SimulationResults` component layout
  inside the expanded area.
  - **Confidence**: High -- directly reuses existing `ExpandableTable` with `slot="expanded"`.

- **Row styling by outcome**: Rows where the release would be grabbed get a subtle green left
  border. Rejected releases get a red left border. This provides at-a-glance scanning without
  requiring the user to read each outcome badge.
  - **Confidence**: High -- extends the existing Score color coding pattern.

- **Truncated titles with tooltip**: Release titles are often 60-100+ characters. Truncate to ~50
  characters with ellipsis in the table cell. Show full title on hover via `title` attribute or a
  custom tooltip.
  - **Confidence**: High -- standard table UX for long text.

- **Virtual scrolling consideration**: For the maximum 50 releases, virtual scrolling is
  unnecessary. Standard DOM rendering handles 50 expandable rows without performance issues. Reserve
  virtual scrolling (via `svelte-virtual-list` or TanStack Virtual) for a future increase beyond 100
  items.
  - **Confidence**: High -- 50 rows is well within browser rendering limits.

### Progressive Disclosure

- **Expandable section pattern (recommended)**: Use collapsible sections with clear headers:
  "Compare Profiles" and "Batch Input." Each section uses a chevron toggle and smooth height
  transition (`transition: max-height 200ms ease-out`). Closed by default for new users; last-used
  state persisted via localStorage.
  - **Confidence**: High -- follows the existing codebase pattern (see DisclosureSection) and NN/g
    recommendations.

- **Maximum 2 disclosure levels**: The main page shows basic input + results (level 1). Expanding
  "Compare" or "Batch" adds controls (level 2). Do not nest further (e.g., no expandable
  sub-sections within batch mode). NN/g explicitly warns that 3+ levels cause usability failures.
  - **Confidence**: High -- per
    [NN/g progressive disclosure guidelines](https://www.nngroup.com/articles/progressive-disclosure/).

- **Strong information scent on toggle labels**: Do not use generic labels like "Advanced" or "More
  Options." Use descriptive labels:
  - "Compare with another profile" (not "Compare")
  - "Test multiple releases" (not "Batch")
  - "Try example release titles" (not "Examples")
  - **Confidence**: High -- NN/g emphasizes that labels must clearly signal what users will find
    behind the disclosure.

- **Mode indicators**: When comparison or batch mode is active, show a subtle indicator (pill badge
  or icon) in the input panel header so users know they are in an advanced mode even if the expanded
  section scrolls out of view.
  - **Confidence**: Medium -- polish feature, not critical.

## Error Handling

### Error States

| Error                                    | User Message                                                                                        | Recovery Action                                                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Batch title exceeds 50-line limit        | "Maximum 50 release titles. Remove {n} titles to continue."                                         | Show counter in red. Disable "Simulate All" button. Highlight excess lines.                                     |
| Individual title parse failure (batch)   | "{title}: Could not parse this release title."                                                      | Show amber warning icon on that row in ranking table. Allow inline edit or removal. Do not block other results. |
| Second profile not selected (comparison) | "Select a second profile to compare scoring differences."                                           | Show placeholder in second column with instructional text. First profile results display normally.              |
| Parser timeout on large batch            | "Parsing is taking longer than expected ({n} remaining). Results will appear as they complete."     | Show partial results immediately. Display progress bar. Allow cancellation.                                     |
| All batch titles fail                    | "None of the release titles could be parsed. Check that titles follow standard naming conventions." | Show full list with error status. Offer "Load Examples" button as recovery path.                                |
| Network error during batch               | "Lost connection during batch simulation. {n} of {total} completed."                                | Show partial results. Offer "Retry remaining" button that picks up where it left off.                           |
| Mismatched profiles (comparison)         | "Profile '{name}' has no custom formats. Score comparison is not meaningful."                       | Show warning banner in that profile's column. Still display the other profile's results.                        |

**Confidence**: High -- error patterns extend existing Phase 1 error handling (amber warnings,
alertStore, retry buttons).

### Validation Patterns

- **Batch validation -- summary + inline**: On submission, validate all titles simultaneously. Show
  an error summary count at the top ("3 of 15 titles could not be parsed") with the ability to jump
  to each errored line. In the ranking table, errored rows appear at the bottom with amber styling.
  - **Confidence**: High -- follows the error summary + inline error pattern per
    [Smashing Magazine form validation guide](https://www.smashingmagazine.com/2022/09/inline-validation-web-forms-ux/).

- **Textarea line validation**: After batch simulation completes, highlight lines in the textarea
  that failed parsing with a red left-border gutter marker. Show the error inline (as a tooltip or
  adjacent text) so the user can correct without cross-referencing.
  - **Confidence**: Medium -- requires custom textarea overlay; could start with ranking-table-only
    error display.

- **Empty line handling**: Silently skip empty lines and lines that are only whitespace. Do not
  count them against the 50-line limit. Show the effective count: "12 titles (3 empty lines
  skipped)."
  - **Confidence**: High -- standard batch input behavior.

- **Duplicate detection**: If the same title appears multiple times, show a warning but do not
  block: "2 duplicate titles detected." Duplicates still simulate (user may want to verify
  consistency) but are flagged in the ranking table.
  - **Confidence**: Medium -- helpful but not critical for MVP.

## Performance UX

### Loading States

- **Batch processing**: Show a determinate progress bar (not a spinner) during batch simulation:
  "Simulating 5 of 12 releases..." Update the progress bar and render each result row as it
  completes. Use a skeleton row placeholder for pending results.
  - **Confidence**: High -- determinate progress indicators are preferred over indeterminate
    spinners for known-length operations per
    [NN/g skeleton screens guidance](https://www.nngroup.com/articles/skeleton-screens/).

- **Comparison loading**: Load both profiles in parallel. Show results for whichever profile
  completes first; show a skeleton placeholder in the other column. Highlight rows as "pending
  comparison" (dimmed) until both profiles have results.
  - **Confidence**: High -- progressive loading with independent panels avoids blocking on the
    slower profile.

- **Large result sets**: For 50 releases, render the first 10 rows immediately, then render the
  remaining 40 in a `requestAnimationFrame` loop (batches of 10) to avoid a long frame. This gives
  the appearance of instant rendering while spreading DOM work across frames.
  - **Confidence**: Medium -- may be unnecessary for 50 rows, but is a good defensive pattern.

### Progressive Loading

- **Staggered API calls for batch**: Instead of sending all 50 titles in a single API request, chunk
  into groups of 10. Send chunks sequentially. Render results as each chunk completes. This provides
  faster time-to-first-result and avoids parser timeout on large payloads.
  - When to use: Always for batches > 10 titles.
  - **Confidence**: High -- reduces perceived latency and avoids server-side timeout risks.

- **Skeleton rows in ranking table**: Before results arrive, show skeleton rows with pulsing
  placeholder bars for title, score, and outcome columns. Use the pulse animation pattern
  (`animate-pulse` in Tailwind) consistent with the waving placeholder recommendation for
  progressively loading lists.
  - **Confidence**: High -- skeleton screens improve perceived performance by ~20% per
    [Viget research cited by LogRocket](https://blog.logrocket.com/ux-design/skeleton-loading-screen-design/).

- **Optimistic comparison header**: When comparison mode is activated, immediately show the delta
  summary header with "Calculating..." placeholder values. Update with real values as each profile's
  results complete. This gives instant feedback that comparison mode is active.
  - **Confidence**: Medium -- polish enhancement.

### Debouncing and Request Management

- **Batch mode uses explicit submit**: Unlike single-release mode (which uses 300ms debounce), batch
  mode requires clicking "Simulate All." This prevents accidental simulation of incomplete paste
  operations and reduces unnecessary parser load.
  - **Confidence**: High -- explicit submission is the standard for batch operations per Postman
    Collection Runner UX.

- **AbortController for cancelled requests**: If the user modifies the batch textarea while
  simulation is in progress, abort in-flight requests for the previous batch. Show a brief
  "Cancelled -- re-submit to simulate" message.
  - **Confidence**: High -- the existing Phase 1 implementation already uses a
    `simulationRequestToken` pattern for request cancellation; extend with `AbortController` for
    proper HTTP cancellation.

## Competitive Analysis

### Regex101

- **Approach**: Regex101 tests a single pattern against a test string with real-time match
  highlighting. It does not support batch testing of multiple patterns or strings natively, but
  users can include multiple test strings separated by newlines. The "Unit Tests" feature allows
  defining multiple test cases with expected outcomes. A curated library of common regex patterns
  serves as presets.
- **Strengths to adopt**:
  - Real-time feedback as the user types (already implemented in Phase 1).
  - The explanation panel that decodes each match component maps to showing why each custom format
    matched.
  - The library/presets concept maps directly to example release title presets.
  - Unit test cases with pass/fail expectations map to batch mode with outcome badges.
- **Weaknesses to avoid**:
  - No side-by-side comparison of two patterns against the same string. Praxrr Phase 2 fills this
    gap with profile comparison.

**Confidence**: High -- based on direct analysis of [Regex101](https://regex101.com) and
[Regex101 GitHub issues #180](https://github.com/firasdib/Regex101/issues/180),
[#1031](https://github.com/firasdib/Regex101/issues/1031).

### GraphQL Playground / Postman

- **Approach (GraphQL Playground)**: IDE-like interface with query editor, response panel,
  documentation browser, and query history. Supports tabbed queries for parallel exploration. Query
  collections allow saving and sharing common queries. The Explorer panel provides a graphical query
  builder.
- **Approach (Postman)**: Collection Runner processes multiple API requests sequentially with
  data-driven variables. Results display as a pass/fail list with expandable detail rows showing
  request/response. CSV/JSON file upload drives iteration data. Filters for Passed/Failed/Skipped
  results.
- **Strengths to adopt**:
  - **History/collections**: Map to "recently tested titles" and curated preset collections.
  - **Tabbed interface**: Map to comparison mode (Profile A tab, Profile B tab) on mobile.
  - **Collection Runner results display**: Map to batch ranking table with expandable detail rows
    and pass/fail (grabbed/rejected) filtering.
  - **Data file upload**: Map to paste-from-clipboard or optional file upload for batch titles.
  - **Progress indicator**: Postman shows iteration progress during collection runs; map to batch
    simulation progress bar.
- **Weaknesses to avoid**:
  - GraphQL Playground's IDE heaviness is unnecessary for our simpler input model.
  - Postman's sequential-only execution misses the opportunity for parallel chunk processing.

**Confidence**: High -- based on
[LogRocket GraphQL Playground guide](https://blog.logrocket.com/complete-guide-to-graphql-playground/),
[Postman Collection Runner docs](https://learning.postman.com/docs/collections/running-collections/intro-to-collection-runs),
and
[Postman data file looping](https://blog.postman.com/looping-through-a-data-file-in-the-postman-collection-runner/).

### Config Diff Tools (diff2html, GitHub diff view)

- **Approach**: diff2html renders unified or side-by-side diffs with syntax highlighting. GitHub's
  pull request diff view shows changed lines with green (additions) and red (deletions) backgrounds.
  Both support synchronized scrolling in side-by-side mode. Unchanged lines are collapsed by default
  with "expand" controls.
- **Strengths to adopt**:
  - **Side-by-side synchronized scrolling**: Essential for profile comparison when the custom format
    list is long. Both columns should scroll together so aligned rows stay aligned.
  - **Change highlighting only**: Only highlight rows where values differ between profiles.
    Identical rows get no special styling. This reduces visual noise.
  - **Collapsed unchanged sections**: For long custom format lists, collapse sections where all
    scores are identical, showing only differences by default. An "Expand all" toggle reveals the
    full list.
  - **Sticky file headers**: Map to sticky profile headers that remain visible during scroll.
- **Weaknesses to avoid**:
  - diff2html is designed for text diffs with line-level granularity. Profile comparison operates at
    the row level (each custom format is a "row"), which is simpler. Do not over-engineer
    character-level diff highlighting.

**Confidence**: High -- based on [diff2html documentation](https://diff2html.xyz/) and
[GitHub diff2html repository](https://github.com/rtfpessoa/diff2html).

### Educational Tools with Presets

- **Approach**: Tools like freeCodeCamp, Codecademy, and interactive documentation sites (MDN,
  Svelte REPL) use curated examples as starting points. The Svelte REPL provides a dropdown of
  example categories, each containing multiple named examples. Selecting one populates the code
  editor and runs it immediately.
- **Strengths to adopt**:
  - **Categorized example menu**: Simple dropdown with category headers, not a modal or separate
    page.
  - **Immediate execution on selection**: Do not require an extra "Run" click after loading a
    preset.
  - **Educational descriptions**: Each example includes a brief explanation of what it demonstrates.
  - **Modifiable examples**: After loading, users can edit freely. The preset is a starting point,
    not read-only.

**Confidence**: High -- the Svelte REPL pattern is directly applicable and familiar to the target
audience.

## Recommendations

### Must Have

1. **Progressive disclosure for comparison and batch modes**: Advanced features must be hidden by
   default behind clearly labeled expandable sections. First-time users should see only the Phase 1
   interface. Rationale: NN/g research confirms that progressive disclosure reduces cognitive load
   and prevents feature overwhelm. Limit to 2 disclosure levels maximum.

2. **Side-by-side profile comparison with difference highlighting**: Two-column layout with aligned
   custom format rows, difference-highlighted rows, and a delta summary. Mobile fallback to tabbed
   view. Rationale: this is the core Phase 2 value proposition -- users currently cannot compare
   profiles without manually switching.

3. **Batch textarea input with line counter and explicit submit**: Multi-line textarea accepting one
   title per line (max 50). Explicit "Simulate All" button instead of real-time debounce. Counter
   showing "{n} / 50 titles." Rationale: paste workflows are the primary batch use case; textarea is
   the simplest implementation with the best paste compatibility.

4. **Ranking table with sortable columns and expandable detail rows**: Table showing Rank, Title,
   Total Score, Matched CF count, Outcome. Sortable by any column. Each row expandable to show full
   score breakdown. Reuse existing `ExpandableTable` component. Rationale: directly answers "which
   release would my Arr pick?"

5. **Example release title presets**: Curated list of 20-30 presets organized by category (Movie,
   Series, Edge Cases). Each preset includes a description. Selecting a preset populates the input
   and auto-simulates. Rationale: solves the cold-start problem and enables learning through guided
   experimentation.

6. **Batch error handling with summary + per-row status**: Show count of failed parses at the top.
   Failed rows appear at the bottom of the ranking table with amber warning styling. Allow inline
   editing or removal of failed titles. Rationale: users will paste imperfect data; graceful
   degradation is essential.

### Should Have

7. **Staggered batch processing with progress bar**: Chunk batch requests into groups of 10. Show
   determinate progress. Render results progressively as chunks complete. Rationale: improves
   perceived performance and prevents parser timeout.

8. **Skeleton loading rows for batch results**: Pulsing placeholder rows in the ranking table while
   results are pending. Rationale: skeleton screens reduce perceived wait time.

9. **Synchronized scrolling for comparison columns**: When scrolling one profile column, the other
   scrolls in sync. Rationale: essential for comparing long custom format lists.

10. **Collapsed identical rows in comparison view**: By default, collapse sections of the comparison
    where all scores are identical, showing only differences. "Show all" toggle reveals everything.
    Rationale: reduces noise for profiles that differ only in a few formats.

11. **"Load All in Category" for batch presets**: One-click to populate the batch textarea with all
    presets from a category. Rationale: enables rapid testing of a full category without individual
    selection.

12. **localStorage persistence of mode and selections**: Save whether comparison/batch mode was last
    used, which profiles were selected for comparison, and the last batch input. Rationale:
    consistent with Phase 1 state persistence pattern.

### Nice to Have

13. **Inline title editing in ranking table**: Click a title in the ranking table to edit it
    directly and re-simulate that single row. Rationale: faster iteration than modifying the
    textarea.

14. **Export ranking table as formatted text**: Copy button that outputs the ranking table as a
    formatted text block for sharing in Discord or forums. Rationale: community sharing is a common
    use case.

15. **Comparison delta sparkline**: Small inline visualization showing the magnitude and direction
    of score differences across all custom formats. Rationale: provides a quick visual summary but
    adds implementation complexity.

16. **Keyboard shortcuts for mode switching**: `Ctrl+B` for batch mode, `Ctrl+K` for comparison
    mode. Rationale: power user efficiency, but not discoverable.

17. **URL-encoded state for sharing**: Encode active mode, profile selections, and release titles
    into URL search parameters so users can share specific test configurations. Rationale: valuable
    for community support but complex to implement with batch data.

## Open Questions

1. **Comparison scope**: Should comparison be limited to two profiles, or support three? Two is
   simpler and fits the side-by-side layout. Three would require a different layout (tabbed or
   three-column, which gets narrow on desktop and unusable on mobile). Recommend: start with two,
   evaluate demand for three later.

2. **Batch + comparison intersection**: Should users be able to batch-simulate AND compare profiles
   simultaneously (50 releases x 2 profiles = 100 score calculations)? This is computationally
   expensive and creates a complex UI (ranking table with two score columns per row). Recommend:
   keep batch and comparison as separate modes initially. A combined mode could be a Phase 3
   feature.

3. **Preset source**: Should presets be hardcoded in the client bundle, or fetched from the PCD
   database? Hardcoded is simpler and faster. PCD-sourced presets could be customized per database
   but add API complexity. Recommend: hardcoded for Phase 2; PCD-sourced presets as a future
   enhancement.

4. **Batch size limit**: 50 titles is specified, but is this sufficient? Users copy-pasting from
   NZB/torrent search results may have 100+ results. Increasing the limit affects parser load and UI
   performance (though 100 rows is still well within DOM rendering limits). Recommend: start with
   50, monitor usage, increase if parser performance allows.

5. **Comparison with different databases**: Should comparison allow profiles from different PCD
   databases? This would enable comparing "TRaSH-recommended" vs "custom" scoring. Adds significant
   complexity (two database contexts, different custom format sets). Recommend: same-database only
   for Phase 2.

6. **Preset localization**: Release titles use English naming conventions universally, so preset
   text does not need localization. However, preset descriptions could be localized in the future.
   Recommend: English-only descriptions for Phase 2.

## Sources

### Comparison UI Patterns

- [LogRocket: How to design feature comparison tables](https://blog.logrocket.com/ux-design/ui-design-comparison-features/)
- [Smashing Magazine: Designing The Perfect Feature Comparison Table](https://www.smashingmagazine.com/2017/08/designing-perfect-feature-comparison-table/)
- [NN/g: Mobile Tables](https://www.nngroup.com/articles/mobile-tables/)
- [diff2html: Pretty diff to HTML](https://diff2html.xyz/)
- [GitHub: diff2html repository](https://github.com/rtfpessoa/diff2html)
- [W3C: Sortable Table Example (WAI-ARIA)](https://www.w3.org/WAI/ARIA/apg/patterns/table/examples/sortable-table/)

### Progressive Disclosure

- [NN/g: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
- [IxDF: Progressive Disclosure (updated 2026)](https://ixdf.org/literature/topics/progressive-disclosure)
- [LogRocket: Progressive disclosure in UX design](https://blog.logrocket.com/ux-design/progressive-disclosure-ux-types-use-cases/)
- [GitHub Primer: Progressive Disclosure](https://primer.style/ui-patterns/progressive-disclosure/)

### Batch Input and Validation

- [UX Patterns for Devs: Textarea Pattern](https://uxpatterns.dev/en/patterns/forms/textarea)
- [Smashing Magazine: Inline Validation in Web Forms](https://www.smashingmagazine.com/2022/09/inline-validation-web-forms-ux/)
- [Smart Interface Design Patterns: Inline Validation UX](https://smart-interface-design-patterns.com/articles/inline-validation-ux/)
- [NN/g: 10 Design Guidelines for Reporting Errors in Forms](https://www.nngroup.com/articles/errors-forms-design-guidelines/)

### Performance and Loading

- [NN/g: Skeleton Screens 101](https://www.nngroup.com/articles/skeleton-screens/)
- [LogRocket: Skeleton loading screen design](https://blog.logrocket.com/ux-design/skeleton-loading-screen-design/)
- [TanStack Virtual](https://tanstack.com/virtual/latest)
- [Svelte Virtual List](https://virtuallist.svelte.page/)

### Competitive Analysis

- [Regex101](https://regex101.com)
- [GraphQL Playground (GitHub)](https://github.com/graphql/graphql-playground)
- [LogRocket: Complete guide to GraphQL Playground](https://blog.logrocket.com/complete-guide-to-graphql-playground/)
- [Postman: Collection Runner docs](https://learning.postman.com/docs/collections/running-collections/intro-to-collection-runs)
- [Postman: Looping through data files](https://blog.postman.com/looping-through-a-data-file-in-the-postman-collection-runner/)

### Table Design

- [Stephanie Walter: Essential resources for complex data tables](https://stephaniewalter.design/blog/essential-resources-design-complex-data-tables/)
- [PatternFly: Table component](https://www.patternfly.org/components/table/)
- [UX Patterns for Devs: Data Table Pattern](https://uxpatterns.dev/patterns/data-display/table)

### Educational / Preset Patterns

- [Svelte REPL](https://svelte.dev/playground) -- example dropdown pattern
- [RegExr](https://regexr.com/) -- community pattern library
