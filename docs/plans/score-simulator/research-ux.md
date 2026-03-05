# UX Research: Score Simulator

## Executive Summary

The score simulator should follow the proven **split-pane playground pattern** (input left, results right) used by tools like Regex101, GraphQL Playground, and CodePen -- adapted for Praxrr's scoring domain. The core UX challenge is making the relationship between release title attributes, custom format matching, and aggregate scoring intuitive through immediate visual feedback, progressive disclosure of complexity, and side-by-side comparison of scoring configurations. The simulator should prioritize teaching through interaction rather than documentation, using real-time scoring with color-coded breakdowns and contextual explanations.

**Confidence**: High -- based on established playground UX patterns from Regex101, GraphQL Playground, CodePen, and domain-specific analysis of TRaSH Guides, Notifiarr, and Recyclarr tooling gaps.

## User Workflows

### Primary Flow: Score Testing (Single Release)

1. **Enter release title**: User types or pastes a release title into the input field. System parses the title in real-time (debounced at 250-300ms) and shows parsed attributes (source, resolution, codec, release group, etc.) below the input.
2. **Select quality profile**: User selects an existing quality profile from a dropdown. System loads all custom format scores associated with that profile.
3. **View matching results**: System evaluates each custom format against the parsed release and displays: which formats matched, the score each contributes, and the total aggregate score.
4. **Understand the outcome**: System shows whether the release would be grabbed (total score vs minimum score), whether it would trigger an upgrade (total score vs upgrade-until score), and highlights the decisive factors with explanatory tooltips.

**Confidence**: High -- mirrors the mental model users already have from Radarr/Sonarr grab history, but makes it interactive and immediate.

### Alternative Flows

- **Batch comparison**: User enters multiple release titles (one per line or from a preset list) and sees a ranked table of all releases with their total scores, sorted by preference. This answers the common question: "Which release would Radarr/Sonarr actually pick?"
- **Profile comparison (side-by-side)**: User selects two quality profiles and enters a release title. System shows a split view with each profile's scoring breakdown, highlighting differences. This answers: "How would changing my profile affect what gets grabbed?"
- **What-if scoring**: User starts from an existing profile, modifies individual custom format scores inline, and immediately sees how the change affects results. This is the "sandbox" mode where experimentation happens without touching live configuration.
- **Learn from examples**: User selects from preset example release titles (e.g., "typical Blu-ray remux", "web-dl 1080p", "x265 encode with HDR") that demonstrate common scoring scenarios. Each preset includes a brief explanation of what makes it interesting for scoring.
- **Custom format deep dive**: User clicks on a matched custom format in the results to see exactly which conditions matched and why, linking to the existing testing page pattern already in the codebase.

**Confidence**: High -- these flows address the documented user confusion points around scoring and align with competitive tool gaps.

## UI/UX Best Practices

### Interactive Playground Patterns

**Split-pane layout (input/output)**: The dominant pattern for interactive tools. Regex101 uses a top-down split (pattern, test string, results). GraphQL Playground uses a left-right split (query, response). For the score simulator, a **left-right split on desktop** (input panel left, results panel right) with **stacked layout on mobile** is recommended.

- **Input panel**: Release title text input, quality profile selector, Arr type selector (Radarr/Sonarr), and optional advanced options behind a DisclosureSection (matching the existing progressive disclosure pattern in the codebase).
- **Output panel**: Parsed attributes display, matched custom formats list with scores, total score summary, and outcome verdict (grabbed/rejected/upgrade).

**Confidence**: High -- this is the standard playground layout used by [Regex101](https://regex101.com), [GraphQL Playground](https://github.com/graphql/graphql-playground), [JSFiddle](https://jsfiddle.net/), and [CodePen](https://codepen.io/).

**Instant feedback loop**: The core value proposition of a playground is removing the deploy-and-wait cycle. Every input change should produce visible output within 300ms (parsing) to 500ms (full score calculation). Use optimistic UI -- show parsed attributes immediately even before scoring completes.

**Confidence**: High -- real-time feedback is the defining characteristic of playground tools, per [freeCodeCamp debouncing guide](https://www.freecodecamp.org/news/optimize-search-in-javascript-with-debouncing/) and [DEV.to debounce analysis](https://dev.to/raffizulvian/beyond-the-keystrokes-solving-real-time-suggestions-with-debounce-k18).

**Persistent state**: Save the last-used release title, profile selection, and comparison configuration to localStorage (consistent with the existing scoring page pattern that saves sort, grouping, and tiling preferences). This lets users return to the simulator without losing context.

**Confidence**: High -- the codebase already implements this pattern in the scoring page via `SCORING_STORAGE_KEY`, `TILING_STORAGE_KEY`, etc.

### Score Visualization

**Color-coded score breakdown**: Extend the existing `Score.svelte` component pattern:

- Green (`text-emerald-600`) for positive scores with `+` prefix
- Red (`text-red-600`) for negative scores
- Gray (`text-neutral-500`) for zero/neutral scores
- Use the same `font-mono font-medium` styling already established

**Confidence**: High -- the `Score.svelte` component already implements this exact pattern.

**Horizontal stacked bar for score composition**: Show a diverging stacked bar chart where positive-scoring custom formats stack to the right of a zero baseline and negative ones stack to the left. Each segment is clickable to reveal the matched custom format details. This is the most effective visualization for showing how individual scores compose into a total, per [Atlassian stacked bar guide](https://www.atlassian.com/data/charts/stacked-bar-chart-complete-guide) and [divergent bar chart analysis](https://www.datarevelations.com/rethinkingdivergent/).

**Confidence**: Medium -- effective visualization pattern, but implementation complexity is moderate. A simpler tabular breakdown could serve as the initial implementation.

**Score thermometer/gauge**: Show the total score on a horizontal scale with markers for:

- Minimum score threshold (below which the release is rejected)
- Upgrade-until score (above which no further upgrades occur)
- Current total score (the calculated result)

This provides an immediate visual answer to "would this release be grabbed?" without requiring the user to compare numbers mentally.

**Confidence**: Medium -- effective for quick comprehension, but requires careful responsive design.

**Tabular breakdown (primary view)**: A table listing each custom format with columns for:

- Format name
- Match status (checkmark/X icon, reusing the existing pass/fail pattern from the testing page)
- Score contribution (using `Score.svelte` styling)
- Match reason (truncated, expandable -- reusing the `ExpandableTable` pattern)

Sort matched formats to the top, unmatched below. Within matched, sort by absolute score descending.

**Confidence**: High -- aligns with existing codebase table patterns and is the simplest to implement.

### Comparison UI

**Side-by-side panels for profile comparison**: Following the [SAP Fiori Comparison Pattern](https://www.sap.com/design-system/fiori-design-web/ui-elements/comparison-pattern/), show two (or up to three) panels side by side, each representing a quality profile's scoring result for the same release title. Key guidelines from Fiori:

- Each panel must have a card header showing the profile name and total score
- Rows (custom formats) should be aligned across panels so differences are scannable
- Highlight rows where scores differ between panels using a subtle background color
- On mobile, use a swipeable carousel with 1 panel visible at a time, maintaining scroll position when swiping

**Confidence**: High -- the SAP Fiori comparison pattern is well-documented and proven for this exact use case.

**Diff highlighting for what-if mode**: When a user modifies a score in what-if mode, show the original value with strikethrough and the new value next to it (similar to git diff inline display). Highlight the row with a left border accent color to draw attention.

**Confidence**: Medium -- effective for showing changes, but needs careful implementation to avoid visual clutter.

**Release ranking table for batch comparison**: When multiple release titles are entered, show a ranked table with columns for: rank, release title (truncated), total score, matched format count, and outcome (grabbed/rejected). Each row is expandable to show the full scoring breakdown.

**Confidence**: High -- reuses the existing `ExpandableTable` component pattern.

### Industry Standards from Playground Tools

**From Regex101**:

- Immediate match highlighting as the user types
- Explanation panel that decodes what each part of the pattern does
- Shareable URLs for reproducing exact test configurations
- Example library with curated test cases

**From GraphQL Playground**:

- Tabbed interface for multiple queries (analogous to multiple release titles)
- Schema browser as a reference sidebar (analogous to browsing available custom formats)
- History of past queries for quick re-testing

**From CodePen/JSFiddle**:

- Clear separation of input and output areas
- Instant preview on every change
- Fork/clone functionality for iterating on configurations

**Confidence**: High -- these patterns are proven across millions of users.

### Accessibility (WCAG)

**Color is not the sole indicator (WCAG 1.4.1)**: The existing `Score.svelte` component uses color to indicate positive/negative/zero. Supplement with:

- The `+`/`-` sign prefix (already implemented)
- Icons: checkmark for matched formats, X for unmatched (already used in testing page)
- Text labels: "Grabbed", "Rejected", "Upgrade candidate" in addition to color

**Confidence**: High -- the codebase already partially implements this with sign prefixes; icons and labels complete the pattern per [Penn State accessibility guidance](https://accessibility.psu.edu/color/colorcoding/).

**Screen reader support for dynamic results**: Use `aria-live="polite"` on the results panel so screen readers announce score changes when the user modifies input. Use `aria-label` on score values to provide context (e.g., `aria-label="DTS-HD MA: positive 1500"`).

**Confidence**: High -- standard WCAG practice for real-time content updates.

**Keyboard navigation**: Ensure the release title input, profile selector, and all interactive elements are fully keyboard-accessible. Tab order should flow logically from input to results to comparison. Score modification inputs in what-if mode should support arrow key increment/decrement (already implemented in `NumberInput.svelte`).

**Confidence**: High -- the existing component library supports keyboard interaction.

**Focus management**: When results update after input change, do not steal focus from the input field. The results panel should update silently while the user continues typing.

**Confidence**: High -- standard UX for search-as-you-type interfaces.

### Responsive Design

**Desktop (1024px+)**: Side-by-side split pane layout. Input panel takes 40% width, results panel takes 60%. For comparison mode, split the results area into 2-3 equal columns. Use the existing `grid-cols-2`/`grid-cols-3` patterns from the scoring page.

**Tablet (768px-1023px)**: Stacked layout with input panel on top, results below. Comparison mode shows 2 columns at most. Consider a collapsible input panel that slides up when the user is focused on results.

**Mobile (<768px)**: Fully stacked layout. Input panel on top with a "Calculate" button (instead of real-time, to reduce parser load on mobile). Results appear below. Comparison mode shows one profile at a time with swipe navigation or tab switching.

**Confidence**: High -- consistent with the existing responsive patterns in the codebase (e.g., `md:grid-cols-3` usage in the scoring page).

## Error Handling

### Error States

| Error                         | User Message                                                                                   | Recovery Action                                                                                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parser service unavailable    | "Parser service unavailable. Score simulation requires the parser to evaluate release titles." | Show warning banner (reuse existing amber warning pattern from testing page). Disable the input or show a "Parser offline" badge. Offer a link to documentation on starting the parser.                 |
| Empty release title           | "Enter a release title to see scoring results."                                                | Show as placeholder text in the results panel. No error styling needed -- this is the default empty state.                                                                                              |
| Unparseable release title     | "Could not parse this release title. The title may not follow standard naming conventions."    | Show parsed attributes as "Unknown" where applicable. Still attempt custom format matching on the raw title (some regex-based formats may still match).                                                 |
| No quality profile selected   | "Select a quality profile to see how this release would be scored."                            | Show as instructional text in the results panel. Highlight the profile selector with a subtle pulse or border.                                                                                          |
| No custom formats match       | "No custom formats matched this release. Total score: 0."                                      | Show the full custom format list with all items showing "No match" status. This is informational, not an error. Include a hint: "Try a different release title or check your custom format conditions." |
| No quality profiles available | "No quality profiles found. Create a quality profile first to use the simulator."              | Show the `EmptyState` component (already exists) with a link to the quality profiles page.                                                                                                              |
| Parser timeout                | "Parsing took too long. Try a shorter release title or check the parser service."              | Show after a 10-second timeout. Allow retry with a button.                                                                                                                                              |
| API/network error             | "Failed to calculate scores. Check your connection and try again."                             | Show error with retry button. Preserve user input.                                                                                                                                                      |

**Confidence**: High -- error patterns are consistent with existing codebase patterns (amber warning banners, `EmptyState` component, `alertStore` for transient messages).

### Validation Patterns

- **Release title input**: No strict validation -- accept any string. Show a character count and a soft warning if the title is very short (<10 characters) or very long (>500 characters). Do not block submission.
- **Profile selection**: Required field. Disable the "Calculate" button (if not using real-time mode) until a profile is selected. On real-time mode, simply show the "select a profile" instructional state.
- **Score modification (what-if mode)**: Use the existing `NumberInput` component with step=1. Allow negative values. Show validation inline if a non-numeric value is entered.

**Confidence**: High -- reuses existing validation patterns from the codebase.

## Performance UX

### Loading States

- **Initial page load**: Show skeleton placeholders for the profile selector dropdown and the results panel. The release title input should be immediately interactive. Use the existing page loading patterns.
- **Parsing in progress**: Show a subtle spinner or pulsing indicator next to the release title input (not a full-page overlay). Display "Parsing..." text in the parsed attributes area. Keep previous results visible but slightly dimmed (opacity 0.6) to indicate staleness.
- **Score calculation**: Near-instant if parsing is already complete (pure client-side arithmetic). Show a brief transition animation on the total score to draw attention to the change.
- **Profile loading**: When switching profiles, show a brief loading state on the scores column only. The parsed attributes and matched formats should remain stable.
- **Comparison mode loading**: Load each profile's results independently. Show results for the first profile as soon as available, then fill in the second.

**Confidence**: High -- consistent with existing loading patterns in the codebase (e.g., `Loader2` icon usage on the scoring page save button).

### Real-Time Feedback

**Debouncing strategy**: Use 250-300ms debounce on the release title input, consistent with the existing `debounceMs: 200` pattern used in `getPersistentSearchStore` on the scoring page. This is fast enough to feel responsive but prevents excessive parser API calls.

Implementation approach for Svelte 5 (without runes, per codebase convention):

```
// Use the existing getPersistentSearchStore pattern
$: searchStore = getPersistentSearchStore('score-simulator-input', { debounceMs: 300 });
```

For the parser API call, add a cancellation mechanism: if a new keystroke arrives before the previous parse completes, cancel the in-flight request using `AbortController`.

**Confidence**: High -- the codebase already implements debouncing in the scoring page search, and the Svelte 5 debounce pattern is well-documented per [Svelte playground examples](https://svelte.dev/playground/f55e23d0bf4b43b1a221cf8b88ef9904) and [Minimalist Django Svelte snippet](https://minimalistdjango.com/snippets/2025-04-04-debounced-input-svelte/).

**Optimistic rendering**: Show parsed attributes as soon as parsing completes, before scoring calculation. This gives the user immediate feedback that their input was recognized.

**Score animation**: When the total score changes, use a brief number counter animation (counting up/down to the new value over 200ms) to make the change feel responsive rather than jarring.

**Confidence**: Medium -- animations are polish, not critical path. Implement after core functionality.

## Competitive Analysis

### TRaSH Guides

- **Approach**: TRaSH provides static documentation with curated scoring recommendations. Custom format definitions include `trash_regex` fields linking to [Regex101](https://regex101.com) for regex testing. No interactive scoring simulation exists -- users must manually apply scores, sync to their Arr instance, and observe behavior.
- **Strengths**: Comprehensive documentation. Well-tested score combinations that prevent download loops. Community-curated and actively maintained. The regex101 integration for individual format testing is clever.
- **Weaknesses**: No way to test aggregate scoring behavior. Users must trust the recommended scores without understanding why. No "what if I change this score?" capability. The gap between reading documentation and seeing results in their own system is large.
- **Key takeaway for Praxrr**: The simulator fills the exact gap TRaSH acknowledges -- "all scores are tested to get the desired results" -- by letting users verify this themselves.

**Confidence**: High -- based on direct analysis of [TRaSH Guides documentation](https://trash-guides.info/Radarr/radarr-setup-quality-profiles/) and [GitHub contribution guidelines](https://github.com/TRaSH-Guides/Guides/blob/master/CONTRIBUTING.md).

### Notifiarr

- **Approach**: Notifiarr provides TRaSH Guide sync automation with score multipliers and custom overrides. Users can set a multiplier (e.g., 2x) to adjust all TRaSH scores proportionally, or set individual custom scores while keeping the custom format definition in sync.
- **Strengths**: Automated sync eliminates manual score entry. Multiplier feature for quick global adjustments. Multiple instance support.
- **Weaknesses**: No simulation or preview -- changes are applied directly. No way to test "what would happen if I use this multiplier?" before syncing. The multiplier concept is powerful but opaque without visualization.
- **Key takeaway for Praxrr**: The multiplier/custom score override pattern is worth adopting in the what-if mode. Show both the "base score" and "adjusted score" when a multiplier is applied.

**Confidence**: High -- based on [Notifiarr TRaSH integration wiki](https://notifiarr.wiki/pages/integrations/trash/).

### Recyclarr / Configarr

- **Approach**: YAML-based configuration tools that sync TRaSH Guide custom formats and scores to Arr instances. Recyclarr uses configuration files; Configarr is container-native.
- **Strengths**: Reproducible configuration. Version-controlled scoring. Template system for common setups. Score overrides per custom format.
- **Weaknesses**: No simulation. Users must apply, wait for a grab, and inspect. Configuration errors (wrong score, wrong format) are only discovered at grab time. YAML-only interface is unfriendly for non-developers.
- **Key takeaway for Praxrr**: The template/preset concept is worth adopting for the simulator. Offer "TRaSH-recommended" presets as starting points.

**Confidence**: High -- based on [Recyclarr documentation](https://recyclarr.dev/reference/configuration/custom-formats/) and [Configarr documentation](https://configarr.de/docs/configuration/config-file/).

### Regex101 (Playground UX Reference)

- **Approach**: Real-time regex testing with instant match highlighting, explanation panel, and substitution preview.
- **Strengths**: Immediate visual feedback. Explanation panel that teaches regex concepts through the user's own input. Shareable permalinks. Comprehensive but non-overwhelming -- advanced features are tucked behind tabs.
- **Weaknesses**: Narrow scope (regex only). Not directly applicable to multi-format aggregate scoring.
- **Key takeaway for Praxrr**: The explanation panel concept is directly applicable. When a custom format matches, show _why_ it matched (which conditions evaluated to true, which regex patterns hit). This teaches users how scoring works through their own data.

**Confidence**: High -- [Regex101](https://regex101.com) is the gold standard for interactive testing UX per [Nisinsheep deep dive](https://nisinsheep.com/mastering-regular-expressions/).

### GraphQL Playground / GraphiQL

- **Approach**: IDE-like interface with query editor, response panel, documentation browser, and query history.
- **Strengths**: Split-pane layout is clean and intuitive. Schema browser provides reference without leaving the tool. History allows re-running past queries. Tabs for parallel exploration.
- **Weaknesses**: Can feel heavyweight for simple tasks. Initial learning curve.
- **Key takeaway for Praxrr**: The schema browser pattern maps to a "custom format browser" sidebar that lets users see all available formats and their scores without leaving the simulator. History maps to "recently tested titles."

**Confidence**: High -- based on [LogRocket GraphQL Playground guide](https://blog.logrocket.com/complete-guide-to-graphql-playground/) and [GraphiQL 2 design discussion](https://github.com/graphql/graphiql/discussions/2216).

### General Playground Best Practices to Adopt

- **From Regex101**: Shareable state URLs, explanation of matched patterns, example library
- **From GraphQL Playground**: Tabbed multi-query interface, reference sidebar, history
- **From CodePen/JSFiddle**: Instant preview, fork/clone for variations, clean input/output separation
- **From SAP Fiori**: Comparison pattern with aligned rows, scroll position preservation, responsive card layout

**Confidence**: High -- these are broadly established patterns across the developer tooling ecosystem.

## Recommendations

### Must Have

1. **Single release title input with real-time scoring**: The core playground experience. Input a title, select a profile, see instant results with parsed attributes and score breakdown. This is the minimum viable simulator.
2. **Tabular score breakdown**: Show each custom format's match status and score contribution in a sortable table. Reuse existing `ExpandableTable` and `Score.svelte` patterns.
3. **Outcome verdict display**: Clear visual indicator showing whether the release would be grabbed, rejected, or trigger an upgrade, based on profile thresholds (minimum score, upgrade-until score).
4. **Parser unavailable warning**: Reuse the existing amber warning banner pattern from the testing page. The simulator depends on the parser service.
5. **Example release title presets**: Curated list of common release title patterns (Blu-ray Remux, WEB-DL 1080p, x265 HDR encode, etc.) so users can start experimenting immediately without knowing release naming conventions.
6. **Progressive disclosure**: Use the existing `DisclosureSection` pattern to hide advanced options (batch mode, comparison mode, what-if scoring) behind an expandable section. First-time users see only the essential input and results.

### Should Have

7. **Quality profile comparison (side-by-side)**: Two-column comparison view showing how the same release scores under different profiles. Uses the existing grid layout patterns.
8. **What-if scoring mode**: Inline-editable scores in the results table that recalculate the total immediately. Changes are ephemeral (not saved to the database) unless explicitly applied.
9. **Batch release comparison**: Enter multiple titles, see them ranked by total score. Answers the practical question of which release would actually be selected.
10. **Parsed attributes display**: Show the parser's interpretation of the release title (source, resolution, codec, etc.) using the existing `Badge` component pattern from the testing page.
11. **Custom format match explanation**: Click on a matched format to see which conditions evaluated to true and why. Link to the existing custom format testing page for deeper investigation.
12. **Persistent input state**: Save the last-used release title and profile selection to localStorage.

### Nice to Have

13. **Score composition visualization**: Diverging stacked bar chart showing positive and negative score contributions visually.
14. **Score thermometer/gauge**: Visual scale showing where the total score falls relative to minimum and upgrade-until thresholds.
15. **Shareable URLs**: Encode the release title and profile selection into URL parameters so users can share specific test cases.
16. **Recently tested titles history**: Store the last 10-20 tested titles for quick re-testing, similar to GraphQL Playground's history feature.
17. **Score animation**: Counter animation when the total score changes, to make updates feel responsive.
18. **Export results**: Copy scoring breakdown as formatted text or JSON for sharing in Discord/forums.

## Open Questions

1. **Server-side vs client-side scoring**: Should the score calculation happen on the server (via API endpoint) or client-side (with all custom format data loaded upfront)? Server-side is simpler but adds latency. Client-side requires loading all custom format conditions and parser data into the browser. The parser microservice is already server-side -- recommend a hybrid approach where parsing is server-side and scoring is client-side.
2. **Parser dependency**: The C# parser microservice is optional in the current architecture. Should the simulator work without the parser (matching only regex-based custom formats against the raw title) or require it? Recommend: work in degraded mode without parser, with a warning that results are incomplete.
3. **Scope of comparison**: Should comparison be limited to quality profiles within the same database, or allow cross-database comparison? Cross-database adds complexity but has value for users migrating between PCD sources.
4. **What-if persistence**: If a user modifies scores in what-if mode and wants to keep them, should the simulator offer a "Save as user override" action that writes to the PCD, or only allow ephemeral experimentation? Recommend starting ephemeral-only, adding save later.
5. **Route structure**: Should the simulator be a new top-level route (`/score-simulator`) or nested under quality profiles (`/quality-profiles/.../simulator`)? A top-level route is more discoverable and doesn't require a pre-selected profile. Recommend: `/score-simulator` as top-level, with optional URL parameters for pre-selecting a profile.
6. **Arr type scoping**: The scoring page handles multi-Arr scoring (different scores per Arr type). Should the simulator require selecting an Arr type upfront, or show results for all Arr types simultaneously? Recommend: require Arr type selection upfront (Radarr vs Sonarr) since the parser behavior and custom format matching semantics differ per Arr type (per the Cross-Arr Semantic Validation Policy in CLAUDE.md).
7. **Mobile real-time vs on-demand**: Real-time scoring on every keystroke may be expensive on mobile devices. Should mobile use an explicit "Calculate" button instead of debounced real-time? Recommend: start with debounced real-time for all devices, optimize later if performance issues arise.

## Sources

### Playground UX Patterns

- [Regex101](https://regex101.com) -- real-time regex testing, match explanation
- [GraphQL Playground (GitHub)](https://github.com/graphql/graphql-playground) -- split-pane IDE pattern
- [LogRocket: Complete Guide to GraphQL Playground](https://blog.logrocket.com/complete-guide-to-graphql-playground/)
- [GraphiQL 2 Design Discussion](https://github.com/graphql/graphiql/discussions/2216)
- [JSFiddle](https://jsfiddle.net/) -- split-pane code playground
- [Snappify: 7 Best Code Playgrounds (2025)](https://snappify.com/blog/best-code-playgrounds)

### Arr Ecosystem Tools

- [TRaSH Guides: Quality Profiles](https://trash-guides.info/Radarr/radarr-setup-quality-profiles/)
- [TRaSH Guides: Custom Format Collection](https://trash-guides.info/Radarr/Radarr-collection-of-custom-formats/)
- [Notifiarr TRaSH Integration Wiki](https://notifiarr.wiki/pages/integrations/trash/)
- [Recyclarr Custom Formats Reference](https://recyclarr.dev/reference/configuration/custom-formats/)
- [Recyclarr Quality Profiles Reference](https://recyclarr.dev/reference/configuration/quality-profiles/)
- [Configarr Configuration File](https://configarr.de/docs/configuration/config-file/)
- [Servarr Wiki: Radarr Settings](https://wiki.servarr.com/radarr/settings)
- [DeepWiki: Custom Formats System Architecture](https://deepwiki.com/TRaSH-Guides/Guides/2-custom-formats-system-architecture)

### Score Visualization

- [Atlassian: Stacked Bar Chart Guide](https://www.atlassian.com/data/charts/stacked-bar-chart-complete-guide)
- [Data Revelations: Divergent Stacked Bar Charts](https://www.datarevelations.com/rethinkingdivergent/)

### Comparison UI

- [SAP Fiori: Comparison Pattern](https://www.sap.com/design-system/fiori-design-web/ui-elements/comparison-pattern/)

### Progressive Disclosure

- [NN/g: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
- [IxDF: Progressive Disclosure (2026)](https://ixdf.org/literature/topics/progressive-disclosure)
- [Lollypop: Progressive Disclosure in SaaS UX](https://lollypop.design/blog/2025/may/progressive-disclosure/)

### Debouncing and Performance

- [freeCodeCamp: Optimize Search with Debouncing](https://www.freecodecamp.org/news/optimize-search-in-javascript-with-debouncing/)
- [DEV.to: Debouncing and Throttling for Smooth UX](https://dev.to/abhirupa/the-art-of-smooth-ux-debouncing-and-throttling-for-a-more-performant-ui-m0h)
- [Svelte 5 Debounced Input Component](https://minimalistdjango.com/snippets/2025-04-04-debounced-input-svelte/)
- [Svelte Playground: Debounce Fundamentals](https://svelte.dev/playground/f55e23d0bf4b43b1a221cf8b88ef9904)

### Accessibility

- [Penn State: Color Coding Accessibility](https://accessibility.psu.edu/color/colorcoding/)
- [AllAccessible: Color Contrast WCAG 2025 Guide](https://www.allaccessible.org/blog/color-contrast-accessibility-wcag-guide-2025)

### Empty States

- [NN/g: Designing Empty States in Complex Applications](https://www.nngroup.com/articles/empty-state-interface-design/)
- [Toptal: Empty States in UX Design](https://www.toptal.com/designers/ux/empty-state-ux-design)
- [Carbon Design System: Empty States Pattern](https://carbondesignsystem.com/patterns/empty-states-pattern/)

### General UI/UX

- [UX Magazine: Playing in the Sandbox](https://uxmag.com/articles/playing-in-the-sandbox)
- [Mouseflow: SaaS UX Design Best Practices (2025)](https://mouseflow.com/blog/saas-ux-design-best-practices/)
