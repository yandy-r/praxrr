# UX Research: score-simulator-phase3

## Executive Summary

Phase 3 bridges the gap between configuration editing (QP scoring page) and experimentation (score
simulator) through three interconnected UX surfaces: a contextual "Simulate" button, inline what-if
score overrides, and shareable URL state. The central design challenge is keeping what-if overrides
visually distinct from persisted scores while providing instant feedback -- the user must never
confuse temporary simulation values with saved configuration. Industry patterns from spreadsheet
what-if analysis (instant recalculation), Terraform plan (diff-style change previews), and Compiler
Explorer (compressed URL state) provide strong precedent for each surface. The recommended approach
uses inline click-to-edit cells with colored diff indicators for overrides, `replaceState`-based URL
synchronization with LZ-string compression, and a proximity-placed "Simulate" button in the QP
scoring page's `StickyCard` header.

## User Workflows

### Workflow 1: QP Scoring -> Simulator Deep Link

1. **Browse scores**: User is on `/quality-profiles/[databaseId]/[id]/scoring` reviewing CF score
   assignments for a quality profile.
2. **Click "Simulate"**: User clicks the "Simulate" button in the `StickyCard` header (next to the
   existing "Scoring", "Options", and "Save" buttons). The button is contextual -- it only appears
   when a quality profile is loaded.
3. **Navigate with context**: System navigates to
   `/score-simulator/[databaseId]?profile=[encodedProfileName]&arrType=[radarr|sonarr]`. The profile
   name and arr type are pre-filled from the current scoring page context.
4. **Land in simulator**: Simulator loads with the profile pre-selected in the dropdown. The release
   title input is focused and ready. If the user had unsaved scoring changes (dirty state), a toast
   warns: "Unsaved scoring changes were not carried to the simulator."
5. **Return to scoring**: User clicks browser back button or a breadcrumb link. The scoring page
   restores its previous state from the browser history stack.

**Confidence**: High -- This workflow follows established contextual navigation patterns (proximity
principle for button placement, deep-link with query parameters for state transfer). The
`StickyCard` header already contains action buttons, making it the natural location.

### Workflow 2: What-If Score Override

1. **View score breakdown**: User has a simulation result showing CF matches and their score
   contributions for a selected profile.
2. **Identify override target**: User sees "Remux Tier 01" contributing +1700 and wants to test
   "+2000" instead.
3. **Click score value**: User clicks the score value cell in the simulation results. The cell
   transitions to an inline edit mode: the static value is replaced by a compact number input,
   pre-filled with the current score.
4. **Enter override**: User types "2000". The cell border changes to a distinct color (amber/yellow)
   indicating an override is active. The original value appears as a small struck-through annotation
   below or beside the input (e.g., "~~1700~~ -> 2000").
5. **See instant recalculation**: The total score, threshold indicators, and ranking table update
   immediately (no network request -- overrides are applied client-side to the existing simulation
   result). The total score row also shows a diff indicator: "+300" in green.
6. **Add more overrides**: User can override multiple CF scores. Each override is tracked
   independently. A summary badge appears: "3 overrides active".
7. **Reset overrides**: User can click a "Reset All Overrides" button to clear all what-if changes,
   or click individual override indicators to reset a single CF. Alternatively, pressing Escape
   while focused on an override input reverts that single value.
8. **Overrides do NOT persist**: Navigating away or refreshing clears all overrides. Overrides are
   never written to PCD. This is communicated via a subtle info banner: "What-if overrides are
   temporary and will not be saved."

**Confidence**: High -- Inline editing with visual diff indicators is a well-established pattern
(PatternFly inline edit, spreadsheet what-if analysis). Client-side recalculation avoids network
latency and matches user expectation of instant feedback.

### Workflow 3: Share Simulator via URL

1. **Configure simulation**: User has entered release titles, selected a profile, chosen arr type,
   and potentially set what-if overrides.
2. **Click "Share" / "Copy Link"**: User clicks a share button (clipboard icon + "Copy Link" label)
   in the simulator toolbar.
3. **URL encoded and copied**: System encodes the current state into the URL hash fragment using
   LZ-string compression, copies the full URL to clipboard via the Async Clipboard API, and shows a
   toast: "Link copied to clipboard".
4. **Recipient opens link**: Another user pastes the URL into their browser. The simulator page
   loads and decodes the hash fragment to restore: release titles, media type, arr type, selected
   profile name, and any what-if score overrides.
5. **Graceful mismatch handling**: If the recipient's Praxrr instance does not have the referenced
   profile or database, the simulator loads with available defaults and shows a warning: "Profile
   'HD Bluray + WEB' not found in your database. Select a profile to continue."

**Confidence**: High -- URL-as-state is a proven pattern (Compiler Explorer, Regex101, CodePen).
LZ-string compression keeps URLs under browser limits. Hash fragments avoid server-side state
storage.

### Alternative Flows

- **Keyboard-only what-if**: User tabs to a score value, presses Enter to activate edit mode, types
  new value, presses Enter to confirm or Escape to cancel. Focus moves to the next CF row on Enter.
- **Batch what-if**: User applies the same override to multiple CFs via a bulk action (select CFs
  with checkboxes, enter override value). This is a "nice to have" for Phase 3.
- **Share via native share**: On mobile, the share button uses the Web Share API
  (`navigator.share()`) instead of clipboard copy, presenting the OS-native share sheet.
- **Deep link from external source**: A Discord/forum user shares a simulator URL. The recipient may
  not be authenticated -- the simulator should redirect to login and then restore the URL state
  after auth completes.

## UI/UX Best Practices

### What-If / Draft Mode Patterns

- **Inline cell editing with visual differentiation**: The most effective pattern for what-if
  scoring is inline click-to-edit within the existing score contribution table. When a cell enters
  edit mode, it shows a compact number input. Overridden values use a distinct visual treatment:
  amber/yellow border + background tint, with the original value shown as a small annotation
  (struck-through or parenthesized). This follows the
  [PatternFly inline edit guidelines](https://www.patternfly.org/components/inline-edit/design-guidelines/)
  and
  [enterprise data table patterns](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables).
  - **Confidence**: High

- **Diff-style change summary**: Aggregate the impact of all overrides into a summary row or badge.
  Show the delta between original total and overridden total (e.g., "Total: 1750 -> 2050 (+300)").
  Use green for positive deltas, red for negative. This mirrors Terraform plan's change summary
  pattern where users see "+2 to add, ~1 to change" before applying.
  - **Confidence**: High

- **Non-destructive by default**: Overrides never auto-save. The "Save" button on the QP scoring
  page remains the only path to persistence. The simulator's what-if mode is explicitly read-only
  with respect to PCD. Communicate this with a persistent (but dismissible) info banner in the
  override area.
  - **Confidence**: High

- **Undo granularity**: Support both individual override reset (click the override indicator on a
  single CF) and bulk reset ("Reset All Overrides" button). Do not use a modal confirmation for
  reset -- overrides are ephemeral by nature and low-cost to recreate.
  - **Confidence**: Medium -- Individual reset is standard, but bulk reset without confirmation is a
    judgment call. Since overrides are temporary and easily re-entered, the friction of a
    confirmation dialog outweighs the risk.

- **Avoid modal/overlay for editing**: Per
  [research on enterprise data tables](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables),
  inline editing preserves context (the user can see neighboring rows and columns) and reduces
  friction compared to modal forms. What-if overrides are lightweight, single-value changes -- a
  modal would be disproportionate.
  - **Confidence**: High

### Shareable State UX

- **Copy URL button placement**: Place the share/copy button in the simulator's main toolbar area,
  near the profile selector and arr type controls. Use a combined icon + text label: clipboard
  icon + "Copy Link".
  [Research shows](https://copyprogramming.com/howto/display-success-message-after-copying-url-to-clipboard)
  icon-text combinations increase recognition by approximately 89% over icon-only buttons.
  - **Confidence**: High

- **Toast feedback on copy**: After clicking "Copy Link", show a brief toast notification: "Link
  copied to clipboard" with `aria-live="polite"` for screen reader announcement. The toast should
  auto-dismiss after 3 seconds. Do not use a modal or alert. This follows the
  [Carbon Design System notification guidelines](https://carbondesignsystem.com/components/notification/accessibility/).
  - **Confidence**: High

- **URL encoding strategy**: Use the URL hash fragment (`#`) rather than query parameters for state
  encoding. This avoids triggering SvelteKit page reloads and keeps the state client-side only.
  Encode state as JSON, compress with [lz-string](https://github.com/pieroxy/lz-string)
  `compressToEncodedURIComponent()`, and place in the hash. This follows
  [Compiler Explorer's approach](https://xania.org/201808/compiler-explorer-new-state-storage) and
  keeps URLs under the 2,083-character practical limit for most browsers.
  - **Confidence**: High

- **Selective state encoding**: Not all state belongs in the URL. Encode: release titles, media
  type, arr type, selected profile name(s), and what-if overrides. Do NOT encode: UI preferences
  (disclosure section open/closed), scroll position, or theme.
  [Best practice](https://www.allaboutken.com/posts/20251226-url-state-management/) is to share
  state that provides consistent content but not state that provides consistent UI.
  - **Confidence**: High

- **URL update timing**: Update the URL hash on every meaningful state change (profile selection,
  title change, override change) using `replaceState` from `$app/navigation`. Debounce URL updates
  by 500ms to avoid excessive history manipulation during rapid typing. Use `replaceState` (not
  `pushState`) for most updates -- only use `pushState` for discrete actions like "load preset" that
  the user might want to undo via browser back.
  - **Confidence**: High -- This follows
    [SvelteKit's official guidance on shallow routing](https://svelte.dev/docs/kit/shallow-routing)
    and avoids the [known issues with pushState spam](https://github.com/sveltejs/kit/issues/11671).

### Deep-Link Navigation

- **"Simulate" button placement**: Add to the `StickyCard` header's right-side button group on the
  QP scoring page, positioned before the "Save" button but after "Options". Use a distinct icon
  (e.g., `Play` or `FlaskConical` from lucide-svelte) and label "Simulate". The button should be
  visually secondary (not primary accent color) since it navigates away rather than performing an
  action on the current page. This follows the
  [proximity principle](https://www.nngroup.com/articles/closeness-of-actions-and-objects-gui/): the
  button acts on the scoring data the user is currently viewing.
  - **Confidence**: High

- **Breadcrumb back-navigation**: When the simulator is reached via deep link from the scoring page,
  include a breadcrumb or back-link at the top: "Quality Profiles > [Profile Name] > Scoring | Score
  Simulator". This gives the user a clear path back without relying solely on browser back.
  - **Confidence**: Medium -- The existing simulator does not have breadcrumbs, so this would be a
    new pattern. A simpler alternative is relying on browser history (the back button works
    correctly with `pushState`-based navigation).

- **Pre-fill behavior**: The deep link should pre-select the profile in the simulator's dropdown and
  set the arr type. It should NOT auto-fill a release title -- the user should explicitly enter what
  they want to test. This follows the principle that deep links should set context but not assume
  intent.
  - **Confidence**: High

### Inline Score Editing

- **Click-to-edit activation**: Score values in the CF contribution table become editable on click.
  Visual affordance: on hover, the cell shows a subtle edit cursor and a faint pencil icon. This
  communicates editability without cluttering the default view.
  [In-place editor pattern](https://ui-patterns.com/patterns/InplaceEditor) recommends making the
  clickable area the entire cell, not just the text.
  - **Confidence**: High

- **Input constraints**: The inline input should be a number input with step=1, no min/max limits
  (scores can be negative). Width should match the cell width to avoid layout shift. Auto-select the
  input content on activation so the user can immediately type a replacement value.
  - **Confidence**: High

- **Confirmation behavior**: Override is applied immediately on input change (as the user types). No
  explicit "confirm" action needed -- the what-if nature means every keystroke is exploratory.
  Pressing Escape reverts to the original value. Clicking outside the cell confirms the current
  value. This matches
  [Excel/Sheets what-if data tables](https://support.microsoft.com/en-us/office/introduction-to-what-if-analysis-22bffa5f-e891-4acc-bf7a-e4645c446fb4)
  where cell changes instantly propagate to dependent calculations.
  - **Confidence**: High

- **Diff highlighting for changed values**: Override cells use a yellow/amber background tint
  (`bg-amber-50 dark:bg-amber-900/20`) with an amber left border (`border-l-2 border-amber-500`).
  The original value appears in a smaller font below: `was: 1700`. The total score row shows the
  delta: `1750 -> 2050 (+300)` with the delta in green (positive) or red (negative). This approach
  is inspired by [diff2html](https://diff2html.xyz/) and Terraform plan's red/green change
  highlighting.
  - **Confidence**: High

## Error Handling

### Error States

| Error                                        | User Message                                                                                                | Recovery Action                                                                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Invalid URL state (malformed hash)           | "Could not restore simulation state from this link. The link may be corrupted or from a different version." | Load simulator with defaults. Show warning banner with dismiss button. Log the error to console for debugging.                     |
| Broken share link (decompression fails)      | "This shared link could not be loaded. It may have been truncated or modified."                             | Same as invalid URL state -- load defaults with warning.                                                                           |
| Profile not found (from URL or deep link)    | "Profile '[name]' was not found in database '[dbName]'. Select a profile to continue."                      | Load simulator with profile dropdown open and no profile selected. Pre-fill other state (titles, arr type) if available.           |
| Database not found (from URL)                | "Database not found. Redirecting to available database."                                                    | Redirect to first available database's simulator page. If no databases exist, show the standard empty state.                       |
| Override on non-existent CF                  | Silently ignore during URL state restoration                                                                | Filter out overrides for CFs that don't exist in the current simulation results. No user-visible error.                            |
| URL too long (>2000 chars after compression) | "This simulation has too much state to share via URL. Try reducing the number of release titles."           | Disable the "Copy Link" button and show tooltip explaining the limitation. Alternatively, truncate to the first N titles that fit. |
| Clipboard API unavailable                    | "Could not copy to clipboard. Please copy the URL from the address bar manually."                           | Fall back to selecting the URL in the address bar. Show the URL in a readonly text input as backup.                                |

**Confidence**: High -- These error states cover the primary failure modes. The graceful degradation
approach (load defaults + show warning) follows
[established patterns for resilient UIs](https://www.smashingmagazine.com/2021/08/build-resilient-javascript-ui/).

### Validation Patterns

- **Release title length**: Validate on input; max 500 characters per title. Show inline error below
  input if exceeded.
- **Override score value**: Accept any integer (positive or negative). Reject non-numeric input via
  `<input type="number">`. No explicit validation message needed -- the input simply won't accept
  invalid characters.
- **Profile name from URL**: Validate against available profiles on page load. If not found, degrade
  gracefully (see error table above).
- **Arr type from URL**: Validate against `'radarr' | 'sonarr'`. If invalid, default to `'radarr'`.
- **Number of overrides**: No hard limit, but display a performance warning if >50 overrides are
  active: "Many overrides active. Consider resetting to improve readability."

## Performance UX

### Loading States

- **What-if recalculation**: Instant (client-side). Override values are applied to the existing
  `SimulateScoreResponse` data by replacing the relevant `SimulateScoreContribution.score` value and
  recalculating `totalScore`. No network request needed. Target: <1ms recalculation time.
  - **Confidence**: High -- The simulation response already contains all per-CF scores. Client-side
    sum recalculation is trivial.

- **URL state sync**: Debounced at 500ms using `replaceState` from `$app/navigation`. URL updates
  happen in the background and do not block the UI. No visual loading indicator needed for URL sync.
  - **Confidence**: High

- **Page transition from QP scoring**: Standard SvelteKit navigation via `goto()`. The simulator's
  `+page.server.ts` loads profile data server-side. Expected latency: <200ms for cached PCD data.
  Show the standard page loading indicator (existing SvelteKit `navigating` store pattern).
  - **Confidence**: High

- **URL state restoration on page load**: Decode and decompress the hash fragment in `onMount`.
  Apply state before the first simulation request fires. If decoding fails, fall back to defaults
  without delaying page load.
  - **Confidence**: High

### Optimistic Updates

- **What-if override application**: Apply the override value to the displayed results immediately as
  the user types. No loading spinner, no dimming. The recalculation is synchronous and deterministic
  -- there is no "optimistic" risk because the calculation is purely client-side.

- **Profile pre-selection from deep link**: Read the `profile` query parameter in `+page.server.ts`
  and return it as the initial selected profile. The simulator page renders with the profile already
  selected -- no flash of "Select profile..." followed by the actual profile.

- **Copy to clipboard**: Show the success toast immediately on `navigator.clipboard.writeText()`
  resolution. If the promise rejects (rare), replace the toast with an error message.

### Transition Animations

- **Override cell activation**: Transition from static value to input with a subtle 150ms ease-out
  animation on border color and background. Avoid layout shift by keeping the cell dimensions fixed.
- **Total score delta appearance**: Fade-in the delta indicator (+300) with a 200ms ease-in. This
  draws attention to the change without being disruptive.
- **Toast notification**: Slide in from top-right with 200ms ease-out, auto-dismiss with 300ms
  fade-out after 3 seconds. Matches existing `alertStore` toast behavior.

## Competitive Analysis

### Terraform Plan / Preview Mode

- **Approach**: Terraform plan generates a structured diff showing what will change before applying.
  Changes are categorized with symbols: `+` (create), `~` (update), `-` (destroy). Each resource
  shows attribute-level before/after values. A summary line reports total counts: "Plan: 2 to add, 1
  to change, 0 to destroy."
- **Relevance to Praxrr**: The what-if override summary should mirror this pattern -- show aggregate
  impact before the user navigates away. "3 overrides: total score changed from 1750 to 2050
  (+300)."
- **Strengths**: Clear visual hierarchy; users can scan the summary or drill into detail. The plan
  is non-destructive (does not apply changes). Risk assessment integration (tools like Overmind add
  safety analysis).
- **Weaknesses**: CLI-first UX; visualization tools like [Rover](https://github.com/im2nguyen/rover)
  and [Spacelift](https://spacelift.io/blog/terraform-gui) add browser-based UIs but they are
  bolt-on rather than native. The plan output can be overwhelming for large changesets.
- **Takeaway**: Use the `+`/`~`/`-` symbolism for override indicators. Show a compact summary badge
  ("3 overrides") that expands to a detailed diff view.
- **Confidence**: High

### Spreadsheet What-If Analysis (Excel/Sheets)

- **Approach**: Excel's what-if analysis uses Data Tables, Goal Seek, and Scenario Manager. Data
  Tables are most relevant: the user defines input cells and formula cells, then Excel recalculates
  all dependent formulas instantly when any input changes. Goal Seek works backwards from a desired
  output. Scenario Manager saves named sets of input values for comparison.
- **Relevance to Praxrr**: The inline what-if override pattern directly parallels Data Table
  behavior -- the user changes a CF score (input cell) and the total score (formula cell)
  recalculates instantly. The "Scenario Manager" pattern maps to the existing preset system and
  could extend to saving named override sets.
- **Strengths**: Instant recalculation is the gold standard for what-if UX. Users expect zero
  latency between input change and result update. The metaphor is universally understood.
- **Weaknesses**: Data Tables
  [can slow down performance](https://support.microsoft.com/en-us/office/introduction-to-what-if-analysis-22bffa5f-e891-4acc-bf7a-e4645c446fb4)
  with many entries, though this is not a concern for Praxrr's scale (~100 CFs). Scenario reports
  are not auto-recalculated, requiring manual refresh.
- **Takeaway**: Prioritize instant, synchronous recalculation for what-if overrides. Client-side
  computation ensures this. Consider a future "Scenarios" feature for saving named override sets.
- **Confidence**: High

### CodePen / JSFiddle / Regex101 Share-via-URL

- **Approach**: These tools encode the full editor state into a shareable URL. Regex101 stores the
  regex pattern, test string, flags, and substitution in URL parameters. CodePen and JSFiddle use
  server-side storage with short URL slugs (e.g., `codepen.io/pen/abc123`). Compiler Explorer
  evolved from
  [full URL encoding (LZ-string compressed state in the hash)](https://xania.org/201808/compiler-explorer-new-state-storage)
  to
  [server-side storage with `/z/` short URLs](https://xania.org/202505/compiler-explorer-urls-forever)
  as state grew too large for URLs.
- **Relevance to Praxrr**: Praxrr's simulation state is relatively compact (a few titles, profile
  name, arr type, and overrides). LZ-string compression in the hash fragment should suffice without
  server-side storage. If state grows beyond URL limits (unlikely for typical use), consider a
  server-side fallback.
- **Strengths**: No server-side storage needed for small state. URLs are self-contained and
  permanent (no expiration). The pattern is familiar to developer audiences.
- **Weaknesses**: URL length limits (~2000 chars practical) constrain the amount of state. Batch
  input with 50 titles may exceed this. Base64/LZ-string encoding makes URLs opaque and
  non-human-readable.
- **Takeaway**: Use LZ-string `compressToEncodedURIComponent()` in the hash fragment. If the
  compressed state exceeds 1500 characters, warn the user and suggest reducing the number of titles.
  Do not implement server-side short URLs in Phase 3 -- defer to a future phase if demand arises.
- **Confidence**: High

### GraphQL Playground / Postman

- **Approach**: GraphQL Playground's "Share" button generates a
  [Pastebin-style link](https://github.com/graphql/graphql-playground) that encodes the current
  query, variables, HTTP headers, and open tabs. Postman uses workspace-level sharing with team
  collaboration features -- collections of requests are shared as a unit, not individual request
  state.
- **Relevance to Praxrr**: GraphQL Playground's approach of encoding the entire workspace state into
  a single shareable link is closest to Praxrr's needs. The key difference is that GraphQL
  Playground uses server-side storage for the shared state, while Praxrr should prefer client-side
  URL encoding.
- **Strengths**: GraphQL Playground preserves full context (including headers and multiple tabs).
  Postman's workspace model supports complex multi-request scenarios.
- **Weaknesses**: GraphQL Playground's sharing depends on
  [server availability](https://github.com/graphql/graphql-playground/issues/727) -- if the server
  is down, shared links break. Postman's sharing requires a Postman account, adding friction.
- **Takeaway**: Prefer client-side URL encoding (no server dependency). Include enough context in
  the URL to reproduce the simulation but not so much that it becomes brittle. Profile names (not
  IDs) make shared links more portable across instances.
- **Confidence**: High

### Figma Playground / Prototyping

- **Approach**: Figma's prototyping mode allows designers to create interactive "playgrounds" with
  variables, conditional logic, and state transitions. Prototypes are shared via presentation mode
  URLs. The playground is explicitly a sandbox -- changes in the prototype do not affect the source
  design file.
- **Relevance to Praxrr**: The sandbox metaphor is directly applicable -- the score simulator is a
  playground where changes (overrides) do not affect the source (PCD scores). Figma's clear
  separation between "design mode" (editing) and "presentation mode" (testing/sharing) maps to
  Praxrr's "scoring page" (editing) and "simulator" (testing/sharing).
- **Strengths**: The sandbox/playground framing sets clear user expectations about persistence (or
  lack thereof). Sharing via URL in presentation mode is frictionless.
- **Weaknesses**: Figma's prototyping can be complex for advanced interactions. Not directly
  applicable to tabular data editing.
- **Takeaway**: Frame the what-if mode explicitly as a "sandbox" or "playground". Use language like
  "temporary overrides" and "will not be saved" rather than "draft" (which implies eventual
  persistence).
- **Confidence**: Medium -- The metaphor is useful for framing, but the implementation details
  differ significantly.

## Recommendations

### Must Have

1. **"Simulate" button on QP scoring page**: Place in `StickyCard` header. Navigate to
   `/score-simulator/[databaseId]?profile=[name]&arrType=[type]`. Use `goto()` from
   `$app/navigation`.
2. **Inline what-if score overrides**: Click-to-edit on score contribution cells. Client-side
   recalculation of totals. Amber/yellow visual differentiation for overrides. Show original value
   annotation and total delta.
3. **Override reset controls**: "Reset All Overrides" button and per-CF reset (click override
   indicator). No confirmation modal needed.
4. **Non-destructive framing**: Info banner in override area: "What-if overrides are temporary and
   will not be saved." Overrides cleared on navigation/refresh.
5. **URL state encoding**: Encode simulation state in URL hash using LZ-string compression. Update
   via `replaceState` debounced at 500ms.
6. **Copy Link button**: Clipboard icon + "Copy Link" label. Toast confirmation with
   `aria-live="polite"`. Fallback to readonly text input if Clipboard API unavailable.
7. **Graceful URL state restoration**: Decode hash on mount. Fall back to defaults on error with
   warning banner. Validate profile/database references against available data.

### Should Have

8. **Override count badge**: Show "N overrides active" badge near the simulation results header.
   Clicking the badge scrolls to (or highlights) the overridden cells.
9. **Total score diff summary**: Show before/after total with delta indicator in the
   `ScoreBreakdown` component.
10. **Pre-fill profile from deep link**: Read `profile` query parameter in `+page.server.ts` and
    return as initial selection.
11. **Keyboard support for inline editing**: Tab between override cells. Enter to confirm, Escape to
    revert. Auto-select input value on activation.
12. **Web Share API on mobile**: Use `navigator.share()` when available, clipboard copy as fallback.

### Nice to Have

13. **Saved override scenarios**: Save named sets of overrides to localStorage (like the existing
    "Profiles" feature on the scoring page). Load/compare scenarios.
14. **Breadcrumb navigation**: When arriving from QP scoring, show a breadcrumb trail for
    back-navigation.
15. **Bulk override action**: Select multiple CFs via checkboxes, apply the same override value to
    all.
16. **URL shortening**: Server-side short URL generation for very long state URLs. Defer unless URL
    length is a proven problem.
17. **Export overrides**: "Apply to Profile" button that navigates back to the QP scoring page with
    the overrides pre-filled as unsaved changes in the dirty store. This creates a round-trip
    workflow: Score -> Simulate -> Test overrides -> Apply back to Score.

## Open Questions

1. **Override scope -- per-profile or global?** If the user has two profiles selected (comparison
   mode), should overrides apply to both or be profile-specific? Recommendation: Apply to both (the
   override changes the CF score, which affects all profiles equally). This matches the mental model
   that a CF score is a property of the CF-profile mapping, and the user is asking "what if this
   mapping had a different value?"

2. **URL state versioning**: Should the URL hash include a version identifier (e.g., `v1`) to
   support future schema changes? Recommendation: Yes, include a version byte as the first character
   of the compressed state. This allows future migrations without breaking old links.

3. **What-if on threshold values?** Should users be able to override `minimum_custom_format_score`
   and `upgrade_until_score` in addition to individual CF scores? These thresholds are already
   visible in `ScoreBreakdown`. Recommendation: Yes, include threshold overrides in Phase 3 -- they
   are the most common "what if I changed the minimum from 0 to 100?" question.

4. **Shareable state and authentication**: If a shared URL is opened by an unauthenticated user,
   should the state be preserved through the login flow? Recommendation: Yes, store the hash
   fragment in `sessionStorage` during auth redirect and restore it after login completes.

5. **Config Impact Simulator integration depth**: How deeply should what-if overrides connect to the
   broader impact analysis framework (#30)? Recommendation: For Phase 3, keep it simple -- the
   simulator shows the scoring impact of overrides. A future phase can extend this to show sync
   impact (which Arr instances would be affected, which releases would change behavior).

## Sources

- [PatternFly Inline Edit Design Guidelines](https://www.patternfly.org/components/inline-edit/design-guidelines/)
- [Enterprise Data Table UX Patterns](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables)
- [In-Place Editor UI Pattern](https://ui-patterns.com/patterns/InplaceEditor)
- [Inline Editing Implementation Examples](https://apiko.com/blog/inline-editing/)
- [Modal UX Best Practices](https://www.eleken.co/blog-posts/modal-ux)
- [Your URL Is Your State](https://alfy.blog/2025/10/31/your-url-is-your-state.html)
- [URLs Are the State Management You Should Use](https://www.allaboutken.com/posts/20251226-url-state-management/)
- [TanStack Router: URL as State Discussion](https://github.com/TanStack/router/discussions/1249)
- [UX Considerations for Web Sharing (CSS-Tricks)](https://css-tricks.com/ux-considerations-for-web-sharing/)
- [Web Share API Patterns (web.dev)](https://web.dev/patterns/web-apps/share/)
- [Copy to Clipboard Success Message Best Practices](https://copyprogramming.com/howto/display-success-message-after-copying-url-to-clipboard)
- [Accessible Toast Notifications](https://www.scottohara.me/blog/2019/07/08/a-toast-to-a11y-toasts.html)
- [Carbon Design System Notification Accessibility](https://carbondesignsystem.com/components/notification/accessibility/)
- [Compiler Explorer State Storage](https://xania.org/201808/compiler-explorer-new-state-storage)
- [Compiler Explorer URLs That Last Forever](https://xania.org/202505/compiler-explorer-urls-forever)
- [LZ-String Compression for URLs](https://github.com/compiler-explorer/compiler-explorer/issues/597)
- [json-url: Compact Base64 URI Notation](https://github.com/masotime/json-url)
- [base64-compressor: URL-Safe Compression](https://github.com/eliot-akira/base64-compressor)
- [Terraform Plan Command Reference](https://developer.hashicorp.com/terraform/cli/commands/plan)
- [Terraform Plan Visualization Tools](https://spacelift.io/blog/terraform-gui)
- [Rover: Interactive Terraform Visualizer](https://github.com/im2nguyen/rover)
- [Excel What-If Analysis (Microsoft)](https://support.microsoft.com/en-us/office/introduction-to-what-if-analysis-22bffa5f-e891-4acc-bf7a-e4645c446fb4)
- [GraphQL Playground GitHub](https://github.com/graphql/graphql-playground)
- [Closeness of Actions and Objects in GUI Design (NN/g)](https://www.nngroup.com/articles/closeness-of-actions-and-objects-gui/)
- [Buttons on the Web: Placement and Order](https://uxdesign.cc/buttons-placement-and-order-bb1c4abadfcb)
- [SvelteKit Shallow Routing Docs](https://svelte.dev/docs/kit/shallow-routing)
- [SvelteKit State Management Docs](https://kit.svelte.dev/docs/state-management)
- [SvelteKit $app/navigation Docs](https://svelte.dev/docs/kit/$app-navigation)
- [How to Update Query Parameters in SvelteKit](https://www.codestudy.net/blog/how-to-update-the-page-and-query-parameters-in-sveltekit/)
- [Building Resilient JavaScript UIs (Smashing Magazine)](https://www.smashingmagazine.com/2021/08/build-resilient-javascript-ui/)
- [Graceful Degradation in Web Development (LogRocket)](https://blog.logrocket.com/guide-graceful-degradation-web-development/)
- [diff2html: Pretty Diff Rendering](https://diff2html.xyz/)
