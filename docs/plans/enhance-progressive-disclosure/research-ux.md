# UX Research: enhance-progressive-disclosure

## Executive Summary

Progressive disclosure is a proven UX pattern that reduces cognitive load by showing only essential options initially and revealing advanced features on demand. For Praxrr's configuration-heavy forms (quality profiles, custom formats, release profiles, media settings), the pattern should follow a section-based accordion model with persistent user preferences, accessible ARIA disclosure widgets, smooth 200-300ms CSS transitions, and automatic error surfacing in collapsed sections. The existing `userInterfacePreferencesStore` with server-synced `basic`/`advanced` modes provides a strong foundation; this enhancement should standardize a reusable `CollapsibleSection` component with consistent behavior across the entire application.

**Confidence**: High -- Based on NNGroup, WAI-ARIA APG, Baymard, GOV.UK, PatternFly, and Grafana design system consensus.

## User Workflows

### Primary Flow: Configuration with Progressive Disclosure

1. **Page load**: System renders form with sections collapsed to `basic` mode by default. User sees a clean overview of essential fields only. Section headers with chevron icons indicate expandable content exists.
2. **Scan and orient**: User reads visible section headers to understand what configuration categories exist. Section headers use descriptive labels (not generic "Advanced" text).
3. **Expand needed section**: User clicks a section header or "Show advanced" toggle. Section smoothly expands (200-300ms ease-out) revealing additional fields. Chevron rotates from right-pointing to downward.
4. **Configure fields**: User fills in fields. Inline validation provides immediate feedback. The mode preference (`advanced`) is debounced and persisted to the server via the existing `userInterfacePreferencesStore`.
5. **Save**: User submits form. If validation errors exist in collapsed sections, those sections auto-expand with error indicators. An error summary at the top links to specific problem sections.
6. **Return visit**: On next visit, the system hydrates persisted preferences. Sections the user previously expanded remain expanded, reducing friction for returning power users.

### Alternative Flows

- **Power user**: Lands on page, all previously-expanded sections are restored from persisted state. Can use a "Show all sections" action to expand everything at once. Rarely needs the basic view. Keyboard navigation (Tab/Enter/Space) provides efficient traversal without mouse.
- **First-time user**: Sees only essential fields in `basic` mode. Clear visual indicators (chevron icons, "Show advanced" labels, subtle section counts like "3 more options") signal that additional configuration exists without overwhelming. Tooltips or help text explain what advanced sections contain before expanding.
- **Mobile user**: Sections use full-width accordion layout. Touch targets are at least 44px. Only one section expanded at a time is acceptable on small screens to avoid excessive scrolling. Collapse animation is faster (150-200ms) to feel responsive on touch.
- **Keyboard-only user**: Tab navigates between section headers. Enter/Space toggles sections. Focus moves to first focusable element within newly expanded content. `aria-expanded` state is announced by screen readers.

**Confidence**: High -- Flows align with NNGroup progressive disclosure principles and WAI-ARIA disclosure widget patterns.

## UI/UX Best Practices

### Progressive Disclosure Patterns

#### Section-Based Accordion (Recommended for Praxrr)

**When to use**: Complex forms with logically groupable fields (quality profiles, custom format conditions, media settings).

**Pros**: Natural grouping, persistent state, supports multiple sections open simultaneously, scalable to any number of sections, familiar pattern for configuration apps.

**Cons**: Can lead to "accordion blindness" if overused; users may miss content in collapsed sections.

**Implementation**: Each form page defines named sections. Each section has a header, a chevron indicator, and collapsible content. Sections default to `basic` mode (collapsed) but respect persisted preferences.

**Confidence**: High -- Grafana, PatternFly, GOV.UK, and AWS all use this pattern for configuration forms.

#### "Show Advanced" Toggle (Recommended as Secondary Pattern)

**When to use**: Pages with a small number of additional fields (2-5) that do not warrant full section headers. Settings pages with a clear basic/advanced split.

**Pros**: Simple, clear affordance, minimal visual overhead.

**Cons**: Binary (basic/advanced) only; does not scale to many sections.

**Implementation**: A single toggle or link at the bottom of a basic form section. Text changes between "Show advanced options" and "Hide advanced options".

**Confidence**: High -- PatternFly specifically recommends dynamic toggle text for expandable sections.

#### Tabbed Layout (Use Sparingly)

**When to use**: Truly distinct configuration areas within a single page (e.g., "General" vs "Scoring" vs "Conditions" tabs on a custom format editor).

**Pros**: Clear separation, no scrolling between sections.

**Cons**: Baymard research shows tabs in form contexts confuse users about what gets saved vs. discarded. Users cannot see multiple sections simultaneously.

**Implementation**: Only use tabs for top-level page-section navigation where sections are independent, not for related form fields within the same submission context.

**Confidence**: Medium -- Baymard's research found user confusion with inline tabs in forms. Use only where sections are truly independent.

#### Wizard / Multi-Step (Not Recommended for Praxrr)

**When to use**: One-time onboarding or setup flows.

**Pros**: Forces sequential completion, reduces visible complexity.

**Cons**: Poor for editing/revisiting configuration. Users cannot see full picture. Forces linear navigation.

**Implementation**: Not recommended for Praxrr's use case; configuration management requires non-linear access to all settings.

**Confidence**: High -- NNGroup explicitly notes wizards are poor for revisiting configuration.

### Visual Design

#### Collapse Indicators (Chevrons/Icons)

- **Use chevrons (carets)**: NNGroup research indicates chevrons are the most effective expand/collapse indicator. They outperform plus/minus icons and text-only indicators.
- **Direction convention**: Right-pointing chevron for collapsed state; downward-pointing chevron for expanded state. This matches the most common convention across web applications.
- **Rotation animation**: Rotate the chevron 90 degrees (from `rotate(0deg)` to `rotate(90deg)`) using a CSS transition of 200ms with `ease` timing. This is faster than the section expand itself, providing immediate feedback that the click registered.
- **Icon placement**: Position the chevron at the leading (left) edge of the section header, before the section title text. This follows the natural left-to-right reading pattern.
- **Icon size**: 16-20px for desktop; 20-24px for mobile touch targets.

**Confidence**: High -- NNGroup caret/chevron research, PatternFly toggle icon convention.

#### Section Headers Design

- **Typography**: Section headers should be slightly larger or bolder than field labels but smaller than page titles. Use the existing heading hierarchy (e.g., an `h3` or `h4` semantic level).
- **Clickable area**: The entire section header row should be clickable, not just the icon or text. Minimum 44px height for accessibility.
- **Visual separation**: Use a subtle bottom border or background color change on the header row to distinguish sections. Do not use heavy dividers that fragment the page.
- **State indication**: Optionally show a count of configured fields or a summary when collapsed (e.g., "Custom Format Scoring (3 formats configured)").
- **Hover state**: Subtle background color change on hover to indicate interactivity.

**Confidence**: High -- PatternFly and GOV.UK design system conventions.

#### Transition Animations

| Animation Type    | Duration  | Easing                               | Notes                                                     |
| ----------------- | --------- | ------------------------------------ | --------------------------------------------------------- |
| Section expand    | 200-300ms | `ease-out` (fast start, slow finish) | Appearance should feel like content "unfolds" naturally   |
| Section collapse  | 150-250ms | `ease-in` (slow start, fast exit)    | Exit should be slightly faster than entry per NNGroup     |
| Chevron rotation  | 200ms     | `ease`                               | Should match or be slightly faster than section animation |
| Error auto-expand | 200-300ms | `ease-out`                           | Same as regular expand; no special treatment needed       |
| Content fade-in   | 150ms     | `ease-out`                           | Optional; apply to content within expanded section        |

**Critical performance rule**: Never animate `height` directly. Use one of these approaches:

1. **Svelte `slide` transition**: Built-in, handles height animation with overflow clipping. Good default for Svelte components.
2. **CSS `interpolate-size: allow-keywords`**: Allows animating `height: 0` to `height: auto`. Supported in Chrome 129+, Edge 129+. Not yet in Firefox/Safari. Use with `@supports` feature detection.
3. **`transform: scaleY()`**: Most performant (compositor-only). Requires counter-scaling children to prevent distortion. Best for complex content.

**Reduced motion**: Always respect `prefers-reduced-motion: reduce`. When active, disable all expand/collapse animations and show content instantly. This is a WCAG 2.3.3 requirement.

```css
@media (prefers-reduced-motion: reduce) {
  .collapsible-section {
    transition: none !important;
    animation: none !important;
  }
}
```

**Confidence**: High -- NNGroup animation duration research, Chrome DevRel performant animations guide, WCAG 2.3.3.

#### Content Spacing

- **Padding between form title and body**: 40px (Grafana design system convention).
- **Padding between sections**: 24-32px vertical gap between collapsed section headers.
- **Padding within expanded content**: 16px padding inside the revealed content area.
- **Padding between section header and content**: 8-12px gap between the header row and the first field within.

**Confidence**: Medium -- Grafana design system uses 40px between major sections; 16px between form components. Adjust to match existing Praxrr spacing tokens.

### Accessibility (WCAG)

#### ARIA Disclosure Widget Pattern (WAI-ARIA APG)

| Requirement              | Implementation                                                                                                                    | WCAG Criterion                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Button role              | Section header toggle element must have `role="button"` (or be a native `<button>`)                                               | 4.1.2 Name, Role, Value                        |
| `aria-expanded`          | Set to `"true"` when content is visible, `"false"` when hidden                                                                    | 4.1.2 Name, Role, Value                        |
| `aria-controls`          | Optional but recommended; references the `id` of the content panel                                                                | 4.1.2 Name, Role, Value                        |
| Keyboard: Enter          | Toggles section expanded/collapsed                                                                                                | 2.1.1 Keyboard                                 |
| Keyboard: Space          | Toggles section expanded/collapsed                                                                                                | 2.1.1 Keyboard                                 |
| Focus management         | When expanding, optionally move focus to first focusable child within content. When collapsing, focus stays on the toggle button. | 2.4.3 Focus Order                              |
| Focus visible            | Toggle button must have a visible focus indicator (at least 2px outline)                                                          | 2.4.7 Focus Visible, 2.4.11 Focus Not Obscured |
| Content hidden           | Collapsed content must be hidden from assistive technology (use `hidden` attribute or `display: none`, not just `opacity: 0`)     | 1.3.2 Meaningful Sequence                      |
| `prefers-reduced-motion` | Respect system setting; disable animations                                                                                        | 2.3.3 Animation from Interactions              |
| Color not sole indicator | Do not use color alone to indicate expanded/collapsed state; icons + text provide redundant cues                                  | 1.4.1 Use of Color                             |

**Semantic HTML approach**: Prefer `<details>` / `<summary>` elements where possible, as they provide built-in disclosure behavior without JavaScript. For custom styling and animation, layer ARIA attributes onto `<button>` + `<div>` pairs.

**Confidence**: High -- WAI-ARIA Authoring Practices Guide (APG) disclosure pattern, WCAG 2.2 success criteria.

#### Screen Reader Behavior

- When the user focuses a section header button, the screen reader should announce: "[Section title], button, collapsed" or "[Section title], button, expanded".
- When the user activates the button, the state change should be announced: "expanded" or "collapsed".
- Content within collapsed sections must not be reachable via Tab or screen reader virtual cursor.

**Confidence**: High -- WAI-ARIA APG keyboard interaction specification.

### Responsive Design

#### Desktop (>1024px)

- Multiple sections can be open simultaneously.
- Section headers span the full form width.
- Inline "Expand all / Collapse all" control is visible in the actions bar or near the top of the form.
- Animation duration: 200-300ms.

#### Tablet (768-1024px)

- Same behavior as desktop but with slightly larger touch targets (minimum 44px height on headers).
- Consider single-column layout for form fields within sections.

#### Mobile (<768px)

- Only one section open at a time is acceptable to conserve vertical space.
- Section headers use full-width touch targets.
- Chevron and text are sized for touch (minimum 44px tap area per WCAG 2.5.8).
- Animation duration: 150-200ms (shorter for perceived responsiveness).
- Consider "sticky" section headers that remain visible when scrolling within long sections.

**Confidence**: Medium -- Mobile behavior recommendations are based on general responsive design best practices. Test with actual Praxrr form layouts for optimal behavior.

## Error Handling

### Error States in Hidden Sections

| Error Scenario                                  | System Behavior                                                       | Visual Indicator                                               | Recovery Action                                      |
| ----------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------- |
| Validation error in collapsed section on submit | Auto-expand the section, scroll to first error field, focus the field | Red error badge on section header + inline field error         | User corrects field, error clears inline             |
| Required field empty in collapsed section       | Show error badge count on collapsed section header (e.g., "2 errors") | Red dot or badge with count next to section title              | User expands section, sees inline errors             |
| Server-side validation error in collapsed field | Auto-expand section, display error summary at top of form with links  | Error summary links scroll to and expand the relevant section  | User follows link, section expands, field is focused |
| Multiple sections with errors                   | Expand all sections with errors simultaneously; scroll to first error | All error sections show badges; error summary lists all issues | User works through errors top-to-bottom              |
| Error in nested disclosure (avoid if possible)  | Auto-expand parent and child sections                                 | Badge propagates up to parent section header                   | User sees cascading expansion to the error           |

**Confidence**: High -- NNGroup 10 design guidelines for form errors, Smashing Magazine error UX research.

### Validation Patterns

#### Inline Validation

- Validate fields on blur (when the user leaves a field), not on keystroke.
- Do not validate while the user is still typing (NNGroup guideline: "avoid triggering errors until users finish entering data").
- Show success indicators only for complex fields (passwords, URLs) to avoid clutter.
- Error messages appear directly below the field, not in tooltips or modals.

#### Submit Validation with Collapsed Sections

1. User clicks Save/Submit.
2. Client-side validation runs across all fields, including those in collapsed sections.
3. If errors are found in collapsed sections:
   a. Auto-expand all sections containing errors.
   b. Display an error summary banner at the top of the form: "X errors found. [Link to Section A], [Link to Section B]."
   c. Scroll to and focus the first error field.
   d. Show a red error badge (count) on each section header that contains errors.
4. As the user corrects errors, the badge count decrements. When a section has no remaining errors, the badge disappears.

#### Error Badge on Section Headers

```
[v] Quality Settings (2 errors)     <-- red badge with count
[>] Scoring Options                  <-- no errors, collapsed
[v] Advanced Filters (1 error)       <-- red badge with count
```

The error badge should:

- Be a small red circle or pill with a white number inside.
- Appear to the right of the section title text.
- Be announced by screen readers (e.g., `aria-label="Quality Settings, 2 errors"`).
- Persist even when the section is expanded, until all errors in that section are resolved.

**Confidence**: High -- NNGroup, Smashing Magazine, and PatternFly error handling patterns.

## Performance UX

### Animation Best Practices

#### Svelte-Specific Implementation

Svelte provides built-in `slide` transition that handles height animation:

```svelte
{#if expanded}
  <div transition:slide={{ duration: 250, easing: quintOut }}>
    <!-- section content -->
  </div>
{/if}
```

**Known issues with Svelte `slide`**:

- `min-height` or `min-width` on the element breaks the transition (content slides to the min value then stops).
- If content height changes while the section is visible, the exit animation may "jump" to the original height before sliding out.
- **Workaround**: Use a custom Svelte action with the Web Animations API for dynamic content, or ensure content height is stable before triggering collapse.

**Recommended Svelte easing functions**:

- `quintOut` for expand (fast deceleration).
- `quintIn` for collapse (fast acceleration at exit).
- Duration: 200-250ms for standard sections; 150ms for small sections.

**Confidence**: High -- Svelte documentation, GitHub issues for known slide transition limitations.

#### CSS Approach (Progressive Enhancement)

For browsers that support `interpolate-size`:

```css
@supports (interpolate-size: allow-keywords) {
  .collapsible-content {
    interpolate-size: allow-keywords;
    height: 0;
    overflow: clip;
    transition:
      height 250ms ease-out,
      opacity 200ms ease-out;
  }

  .collapsible-content[data-expanded='true'] {
    height: auto;
    opacity: 1;
  }

  .collapsible-content[data-expanded='false'] {
    opacity: 0;
  }
}
```

**Browser support** (as of early 2026): Chrome 129+, Edge 129+. Firefox and Safari do not yet support `interpolate-size`. Use Svelte transitions as the primary approach with CSS as progressive enhancement.

**Confidence**: Medium -- `interpolate-size` is Chromium-only as of March 2026. Svelte transitions are the safer default.

#### Performance Rules

1. **Never animate `height` or `width` directly** via JavaScript on every frame. These trigger layout recalculation.
2. **Prefer `transform: scaleY()` or Svelte `slide`** for GPU-composited animations.
3. **Use `will-change: transform`** on the collapsible container to hint GPU acceleration.
4. **Apply `overflow: clip` (not `overflow: hidden`)** during animation to prevent scroll containers from forming.
5. **Remove `will-change`** after animation completes to free GPU memory.

**Confidence**: High -- Chrome DevRel performant animations guide.

### Lazy Loading Content in Collapsed Sections

#### When to Lazy Load

- Sections containing data tables with many rows (e.g., custom format scores list).
- Sections that fetch additional data from the server (e.g., loading available custom formats for a quality profile).
- Sections with heavy rendering (charts, complex nested components).

#### When NOT to Lazy Load

- Simple form fields (text inputs, checkboxes, toggles). These are lightweight and should render immediately.
- Content needed for client-side validation on submit. All validatable fields must be in the DOM even if visually hidden.

#### Implementation Pattern

```svelte
<!-- Render content only on first expand, then keep in DOM -->
{#if hasBeenExpanded}
  <div class:hidden={!expanded}>
    <!-- content stays in DOM for validation but hidden visually -->
  </div>
{/if}
```

This hybrid approach:

- Does not render heavy content until first expansion (performance).
- Keeps content in DOM after first expansion (validation, state preservation).
- Uses CSS `display: none` for subsequent hide/show (no re-rendering).

**Confidence**: Medium -- Lazy loading accordion content is a well-established pattern (PrimeNG, Angular Material), but the specific Svelte implementation should be validated with actual Praxrr form complexity.

### Perceived Performance

- **Immediate visual feedback**: Chevron rotation should start instantly on click, even before the content begins to expand. Use a separate, faster transition for the icon.
- **Skeleton states**: For lazy-loaded sections, show a brief skeleton placeholder (1-2 pulsing lines) during the 100-200ms data fetch. If content loads in under 100ms, skip the skeleton entirely.
- **Content pre-rendering**: For sections that are "likely" to be expanded (e.g., the user has them expanded in persisted preferences), consider rendering them server-side and using CSS to control visibility rather than conditional rendering.

**Confidence**: Medium -- Perceived performance principles from NNGroup. Skeleton implementation details are recommendation-level.

## Competitive Analysis

### Sonarr / Radarr (v4)

- **Approach**: Tabbed settings pages (Media Management, Profiles, Quality, etc.). Within each settings page, forms are displayed as flat lists of fields. Modal popups for adding/editing entities (download clients, custom formats). Quality profile editor uses inline toggles and scoring tables without section collapsing.
- **Strengths**: Familiar to the target user base. Direct, no-nonsense approach. Settings pages are logically categorized by tab.
- **Weaknesses**: No progressive disclosure within forms; all fields are visible at once. Custom format scoring tables can be very long and overwhelming. Modal-heavy workflow disrupts context. No persisted view preferences. Mobile experience is poor with many small controls.
- **Lessons for Praxrr**: Match the mental model of settings categories (quality, custom formats, media management) but add section-based disclosure within each form to reduce the wall-of-fields problem. Maintain familiarity while improving scannability.

**Confidence**: High -- Sonarr wiki documentation, TRaSH Guides screenshots, direct product knowledge.

### Recyclarr / TRaSH Guides

- **Approach**: YAML-based configuration. Complexity is managed through template abstraction: a single `trash_id` reference replaces many individual field configurations. Configuration files can be split across multiple YAML files for organization.
- **Strengths**: Extreme complexity reduction through templates/presets. Power users can override individual values. Version-controlled configuration.
- **Weaknesses**: Not a GUI; requires YAML knowledge. No visual feedback during configuration. Errors are discovered at sync time, not during editing. Steep learning curve.
- **Lessons for Praxrr**: The "template with overrides" model maps well to progressive disclosure: show the template/preset as the basic view, and expose individual override fields as the advanced view. Consider "preset" or "template" quick-start options that pre-fill forms, with progressive disclosure for customization.

**Confidence**: High -- Recyclarr documentation, GitHub repository.

### Profilarr (Dictionarry)

- **Approach**: Web UI for managing quality profiles and custom formats. Unified configuration language that compiles to Radarr/Sonarr-specific formats. Git-backed storage with append-only SQL operations.
- **Strengths**: Web-based GUI (accessible to non-CLI users). Unified cross-Arr configuration. Testing capabilities before sync.
- **Weaknesses**: Relatively new (v1.0.0 beta). Limited documentation on UI patterns. Similar form complexity challenges.
- **Lessons for Praxrr**: Praxrr's architecture is similar. Focus on the UX differentiation through progressive disclosure, which Profilarr does not yet implement.

**Confidence**: Medium -- Based on GitHub README and release notes; limited public UI documentation.

### Grafana

- **Approach**: Panel editor uses collapsible sections with consistent 40px spacing. Form elements placed in collapsible components. Dashboard rows are collapsible for organization. Dynamic forms with conditional fields based on data source selection.
- **Strengths**: Well-documented design system (Saga). Consistent collapsible section pattern throughout. Supports "Advanced options" expander pattern. Clear spacing and typography hierarchy.
- **Weaknesses**: Can feel overwhelming with many collapsible sections in the panel editor. Some settings are buried too deep (3+ levels).
- **Lessons for Praxrr**: Adopt Grafana's approach of grouping related settings into collapsible sections with consistent spacing. Use their 40px between-section spacing convention. Implement the "Advanced options" expander for simple cases and full collapsible sections for complex cases. Limit to maximum 2 levels of disclosure (NNGroup guideline).

**Confidence**: High -- Grafana Saga design system documentation, Grafana panel editor UI.

### GOV.UK Design System

- **Approach**: Accordion component with persistent session state, "Show all sections" / "Hide all sections" control, dynamic button text, and graceful degradation (all content visible without JavaScript).
- **Strengths**: Thoroughly researched accessibility. Session storage for state persistence. Unique `id` for persistent state. Graceful degradation. Clear when-to-use and when-not-to-use guidelines.
- **Weaknesses**: Conservative design (government context). No animation. Does not address form-specific use cases (explicitly recommends against accordions for "a series of form questions").
- **Lessons for Praxrr**: Adopt the "Show all / Hide all" control pattern. Use unique section IDs for state persistence (maps to existing `sectionKey` pattern). Implement graceful degradation. Note GOV.UK's caution against using accordions for sequential form questions, but Praxrr's forms are non-sequential configuration, making section-based disclosure appropriate.

**Confidence**: High -- GOV.UK Design System accordion component documentation.

### PatternFly (Red Hat)

- **Approach**: Expandable section component with dynamic toggle text ("Show more" / "Show less"). Progressive disclosure in forms using expandable sections and expandable field groups. Conditional field visibility based on user selections.
- **Strengths**: Explicit progressive disclosure documentation. Dynamic toggle text convention. Clear form integration guidelines. Recommends using expandable sections, accordions, and field groups together.
- **Weaknesses**: Component-library-specific implementation details.
- **Lessons for Praxrr**: Adopt dynamic toggle text for simple show/hide toggles. Use PatternFly's recommendation of combining expandable sections with conditional field visibility for the most effective progressive disclosure.

**Confidence**: High -- PatternFly design guidelines documentation.

### AWS Console

- **Approach**: "Advanced container options" expander links in configuration forms. Tabbed service configuration. Collapsible sidebar navigation. "Additional configuration" sections in creation wizards.
- **Strengths**: Scales to extremely complex configuration. Clear "Advanced" labeling. Default values for basic use.
- **Weaknesses**: Notoriously complex. Many levels of nesting. Can feel disorienting.
- **Lessons for Praxrr**: Use AWS's pattern of smart defaults with "Additional configuration" sections, but limit disclosure depth to 2 levels maximum.

**Confidence**: Medium -- Based on general AWS console interaction patterns.

### Best Practices to Adopt

| Practice                                                | Source                                   | Priority     |
| ------------------------------------------------------- | ---------------------------------------- | ------------ |
| Section-based collapsible groups for form fields        | Grafana, PatternFly, GOV.UK              | Must Have    |
| Chevron icons with rotation animation                   | NNGroup, PatternFly                      | Must Have    |
| Persisted expand/collapse state per user                | GOV.UK (session), Praxrr (server-synced) | Must Have    |
| "Show all / Hide all" control                           | GOV.UK                                   | Should Have  |
| Dynamic toggle text ("Show advanced" / "Hide advanced") | PatternFly                               | Should Have  |
| Error badges on collapsed section headers               | NNGroup error guidelines                 | Must Have    |
| Auto-expand sections with validation errors             | Smashing Magazine, NNGroup               | Must Have    |
| Maximum 2 levels of disclosure                          | NNGroup                                  | Must Have    |
| `prefers-reduced-motion` support                        | WCAG 2.3.3                               | Must Have    |
| Template/preset quick-start with progressive override   | Recyclarr model                          | Nice to Have |

## Recommendations

### Must Have

1. **Reusable `CollapsibleSection` component**: A single Svelte component that encapsulates the ARIA disclosure pattern, chevron icon, animation, and integration with `userInterfacePreferencesStore`. All progressive disclosure across the app should use this component for consistency.

2. **ARIA-compliant disclosure pattern**: Every collapsible section must implement `role="button"`, `aria-expanded`, keyboard activation (Enter/Space), and proper content hiding (`display: none` or `hidden` attribute, not just `opacity: 0`).

3. **Error auto-expansion**: When form validation fails, all sections containing errors must auto-expand. Section headers must display an error count badge. An error summary at the top of the form must link to each error section.

4. **`prefers-reduced-motion` support**: All animations must be disabled when the user's OS-level motion preference is set to "reduce". Content should appear/disappear instantly.

5. **Maximum 2 disclosure levels**: Never nest collapsible sections more than 2 levels deep. If a form needs 3+ levels, simplify the information architecture instead.

6. **Server-persisted preference state**: Continue using the existing `userInterfacePreferencesStore` with server-synced mode preferences (`basic`/`advanced`). The debounced PATCH to `/api/v1/ui-preferences` with retry logic is already well-designed.

7. **Consistent animation timing**: 200-300ms expand (ease-out), 150-250ms collapse (ease-in), 200ms chevron rotation (ease). Use Svelte `slide` transition as the primary mechanism.

### Should Have

8. **"Show all / Collapse all" control**: A button in the page actions bar that toggles all sections on the current page. Useful for power users who want to see everything at once.

9. **Section content summaries**: When collapsed, show a brief summary of the section's current configuration state (e.g., "3 custom formats, min score: 10" or "Upgrades: enabled, until Bluray-1080p"). This helps users decide whether they need to expand without guessing.

10. **Dynamic toggle text**: For simple show/hide toggles (not full sections), use text that changes between "Show advanced options" and "Hide advanced options" per PatternFly convention.

11. **Inline help for collapsed sections**: Before expanding, users should be able to understand what a section contains. Use subtitle text under section headers (e.g., "Configure minimum score thresholds and upgrade behavior").

12. **Graceful degradation**: If JavaScript fails to load, all content should be visible (expanded by default). Use server-side rendering to deliver expanded content, then JavaScript collapses it on hydration.

### Nice to Have

13. **Template/preset quick-start**: For new quality profiles or custom formats, offer preset configurations (similar to Recyclarr's `trash_id` model) that pre-fill the basic view, with progressive disclosure revealing individual override fields.

14. **Lazy loading for heavy sections**: Defer rendering of data-heavy sections (large scoring tables, format lists) until first expansion. Show a skeleton placeholder during the brief load.

15. **CSS `interpolate-size` progressive enhancement**: When browser support is sufficient, use native CSS `interpolate-size: allow-keywords` for height transitions as a performance upgrade over JavaScript-based animation.

16. **Animation customization**: Allow users to control animation speed or disable animations entirely through a UI preference (in addition to respecting OS-level `prefers-reduced-motion`).

17. **Section state indicators**: Small icons or badges on collapsed section headers that indicate the section has been configured (vs. using defaults). Helps users quickly identify which sections they have customized.

## Open Questions

1. **Single vs. multiple sections open**: Should the accordion allow multiple sections open simultaneously (recommended for configuration forms) or enforce single-section-at-a-time behavior? Recommendation: Allow multiple on desktop; consider single on mobile.

2. **Default expanded sections**: Which sections should default to expanded on first visit? Recommendation: Only the primary/essential section (e.g., "General" or "Name & Type"). All others start collapsed.

3. **Section key naming convention**: The existing `sectionKey` pattern is `page:area:section` (e.g., `quality-profiles:editor:scoring`). Should this convention be documented and enforced across all new progressive disclosure implementations?

4. **Transition from existing flat forms**: How should existing form pages be migrated? All at once, or incrementally by feature area? Recommendation: Incrementally, starting with the most complex forms (quality profile editor, custom format editor).

5. **Persisted state scope**: Should the preference persist globally (same collapse state for all quality profiles) or per-entity (each quality profile remembers its own collapse state)? Current implementation uses section keys that are page-scoped, not entity-scoped. Recommendation: Page-scoped is sufficient; entity-scoped adds complexity for minimal UX gain.

6. **Error badge clearing**: Should error badges on section headers clear in real-time as users fix errors (requires inline validation on every field), or only after the next submit attempt? Recommendation: Real-time clearing via inline validation on blur.

7. **Animation library**: Should Praxrr use Svelte's built-in `slide` transition, a custom action wrapping the Web Animations API, or CSS-only transitions? Recommendation: Svelte `slide` as the primary approach, with CSS `prefers-reduced-motion` override. Custom action only if `slide` limitations (dynamic content height) become blocking.

## Sources

### Primary Authoritative Sources

- [Progressive Disclosure -- Nielsen Norman Group](https://www.nngroup.com/articles/progressive-disclosure/)
- [Executing UX Animations: Duration and Motion Characteristics -- NNGroup](https://www.nngroup.com/articles/animation-duration/)
- [10 Design Guidelines for Reporting Errors in Forms -- NNGroup](https://www.nngroup.com/articles/errors-forms-design-guidelines/)
- [Disclosure (Show/Hide) Pattern -- WAI-ARIA APG, W3C](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/)
- [Accordion Pattern -- WAI-ARIA APG, W3C](https://www.w3.org/WAI/ARIA/apg/patterns/accordion/)
- [WCAG 2.2 -- W3C](https://www.w3.org/TR/WCAG22/)
- [C39: Using CSS prefers-reduced-motion -- W3C WAI](https://www.w3.org/WAI/WCAG21/Techniques/css/C39)
- [Understanding Animation from Interactions (2.3.3) -- W3C WAI](https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions.html)

### Design System References

- [Accordion Component -- GOV.UK Design System](https://design-system.service.gov.uk/components/accordion/)
- [Expandable Section -- PatternFly](https://www.patternfly.org/components/expandable-section/design-guidelines/)
- [Form Patterns -- PatternFly](https://www.patternfly.org/components/forms/form/design-guidelines/)
- [Forms -- Grafana Design System (Saga)](https://grafana.com/developers/saga/patterns/forms/)
- [Expansion Panels -- Material Design](https://m1.material.io/components/expansion-panels.html)

### Technical Implementation References

- [Building Performant Expand & Collapse Animations -- Chrome for Developers](https://developer.chrome.com/blog/performant-expand-and-collapse)
- [Animate to height: auto in CSS -- Chrome for Developers](https://developer.chrome.com/docs/css-ui/animate-to-height-auto)
- [interpolate-size -- MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/interpolate-size)
- [CSS Transitions Interactive Guide -- Josh W. Comeau](https://www.joshwcomeau.com/animation/css-transitions/)
- [prefers-reduced-motion -- MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)
- [svelte/transition -- Svelte Docs](https://svelte.dev/docs/svelte/svelte-transition)
- [Svelte slide transition accordion -- Svelte Playground](https://svelte.dev/playground/62a22abc6f2344388254ef5f874f073e)

### UX Research and Analysis

- [Accordion UX: Pitfalls of Inline Accordion and Tab Designs -- Baymard Institute](https://baymard.com/blog/accordion-and-tab-design)
- [Designing Better Error Messages UX -- Smashing Magazine](https://www.smashingmagazine.com/2022/08/error-messages-ux-design/)
- [A Complete Guide to Live Validation UX -- Smashing Magazine](https://www.smashingmagazine.com/2022/09/inline-validation-web-forms-ux/)
- [Designing Effective Accordion UIs -- LogRocket](https://blog.logrocket.com/ux-design/accordion-ui-design/)
- [Accessible Disclosure Widgets -- Access & Use](https://accessuse.eu/en/disclosure-widgets.html)
- [Building Accessible Disclosure Widget -- BrowserStack](https://www.browserstack.com/guide/wcag-disclosure-button)
- [Designing with Reduced Motion for Sensitivities -- Smashing Magazine](https://www.smashingmagazine.com/2020/09/design-reduced-motion-sensitivities/)

### Competitive References

- [Sonarr Settings -- Servarr Wiki](https://wiki.servarr.com/sonarr/settings)
- [Recyclarr Configuration Reference](https://recyclarr.dev/wiki/yaml/config-reference/)
- [Recyclarr Quality Profiles](https://recyclarr.dev/reference/configuration/quality-profiles/)
- [Profilarr -- GitHub (Dictionarry-Hub)](https://github.com/Dictionarry-Hub/profilarr)
- [Progressive Disclosure -- Interaction Design Foundation](https://www.interaction-design.org/literature/topics/progressive-disclosure)
- [Progressive Disclosure in SaaS UX Design -- Lollypop Design](https://lollypop.design/blog/2025/may/progressive-disclosure/)

### Queries Executed

1. `progressive disclosure UX best practices Nielsen Norman Group 2024 2025`
2. `WAI-ARIA disclosure widget pattern accessible expand collapse`
3. `progressive disclosure complex configuration forms web application UX patterns`
4. `CSS transition animation expand collapse best practices performance timing easing 2024`
5. `form validation errors hidden collapsed sections UX pattern auto-expand`
6. `Sonarr Radarr settings UI configuration form design UX`
7. `Grafana settings dashboard configuration progressive disclosure UI patterns`
8. `AWS console GCP cloud configuration form advanced settings UX design pattern`
9. `WordPress Ghost CMS settings progressive disclosure show advanced options pattern`
10. `Recyclarr TRaSH Guides configuration YAML complexity management`
11. `accordion expand collapse animation duration recommended milliseconds UX research`
12. `show advanced options button pattern settings page UX "show more" vs accordion vs tabs`
13. `WCAG 2.2 focus management disclosure widget keyboard navigation requirements`
14. `prefers-reduced-motion CSS animation accessibility best practices`
15. `chevron icon rotation animation expand collapse CSS best practice direction right down`
16. `"error badge" "error indicator" collapsed section form validation count hidden errors UX`
17. `lazy loading collapsed accordion content performance web application pattern`
18. `remember user preference collapse expand state localStorage UX pattern persist disclosure`
19. `Svelte 5 transition animate slide expand collapse component pattern`
20. `Svelte slide transition height auto dynamic content workaround`
21. `SvelteKit form progressive disclosure component pattern collapsible section store persist state`
22. `PatternFly expandable section design guidelines form progressive disclosure`
23. `Profilarr Dictionarry configuration management Radarr Sonarr UI web interface`
24. `Material Design 3 disclosure expansion panel form sections guidelines 2024`
25. `CSS height auto transition interpolate-size allow-keywords 2024 2025`
26. `Sonarr v4 UI settings tabs quality profiles custom formats form layout`
27. `Grafana UI design system panel editor settings collapsible sections form patterns`

## Uncertainties and Gaps

1. **Svelte 5 transition compatibility**: Praxrr uses Svelte 5 but "no runes" convention. The `slide` transition from `svelte/transition` should still work, but Svelte 5 migration may introduce subtle behavior changes. Needs verification with the actual Praxrr build.

2. **`interpolate-size` Firefox/Safari timeline**: No confirmed timeline for Firefox or Safari support of `interpolate-size: allow-keywords`. This limits its use as a primary strategy. Monitor [Can I Use](https://caniuse.com/css-interpolate-size) for updates.

3. **Baymard accordion paywall**: The full Baymard Institute research on accordion and tab design pitfalls was behind a paywall. The summary findings are referenced but the complete dataset of user testing results could not be extracted.

4. **Sonarr/Radarr v4 UI specifics**: Direct screenshots and detailed UI interaction flows for Sonarr v4's custom format and quality profile editors were not available from web research. These should be verified by interacting with a running Sonarr instance.

5. **Mobile form performance**: No specific benchmarks for Svelte `slide` transition performance on mobile devices with many form fields. This should be tested with actual Praxrr forms on representative devices.

6. **User preference conflict resolution**: The existing `userInterfacePreferencesStore` uses `expected_updated_at` for optimistic concurrency, but the UX for conflict resolution (e.g., preferences changed on another device) is not defined. This is an edge case but should be considered.

7. **Accessibility testing with screen readers**: The ARIA patterns are well-documented, but real-world behavior varies across screen reader / browser combinations (NVDA + Firefox, VoiceOver + Safari, JAWS + Chrome). Testing should be performed with at least 2 screen reader combinations.
