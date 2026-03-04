# Feature Spec: Enhance Progressive Disclosure

## Executive Summary

Praxrr's progressive disclosure infrastructure (PR #164) provides a solid foundation with server-persisted per-user preferences, a debounced client store, and an `AdvancedSection` component -- but it is currently deployed on only 2 of approximately 20+ candidate pages. The primary bottleneck is a ~30-line boilerplate pattern required per section for store wiring, which makes scaling untenable. This enhancement refactors `AdvancedSection` into a self-wiring `DisclosureSection` wrapper that eliminates boilerplate, adds smooth `transition:slide` animations, and systematically rolls out progressive disclosure across all form-heavy pages in the application. The work requires zero new dependencies and is almost entirely client-side component design and per-page integration.

## External Dependencies

### APIs and Services

No external APIs are needed. This is entirely an internal UI enhancement.

### Libraries and SDKs

| Library             | Version           | Purpose                                          | Installation             |
| ------------------- | ----------------- | ------------------------------------------------ | ------------------------ |
| `svelte/transition` | Built-in          | `slide` transition for expand/collapse animation | N/A (framework built-in) |
| `svelte/easing`     | Built-in          | `quintOut` easing for smooth deceleration        | N/A (framework built-in) |
| `lucide-svelte`     | Already installed | `ChevronDown` icon for disclosure toggle         | N/A (already in project) |

No new dependencies required. All animation and interaction patterns use Svelte built-ins and existing project dependencies.

### External Documentation

- [WAI-ARIA Disclosure Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/): ARIA attributes and keyboard interaction spec
- [NNGroup Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/): UX research and guidelines
- [Svelte Transition API](https://svelte.dev/docs/svelte/svelte-transition): `slide` transition documentation
- [GOV.UK Accordion](https://design-system.service.gov.uk/components/accordion/): "Show all/Hide all" pattern reference
- [PatternFly Expandable Section](https://www.patternfly.org/components/expandable-section/design-guidelines/): Dynamic toggle text convention

## Business Requirements

### User Stories

**Primary User: Media Server Administrator**

- As a user, I want complex configuration pages to show only essential fields by default so that I am not overwhelmed when I first visit a page.
- As a user, I want to reveal advanced options on demand with a clear "Show Advanced" control so that I know exactly what I am enabling.
- As a user, I want the app to remember which sections I have expanded so that I do not have to re-expand them every time I return.
- As a user, I want my disclosure preferences to persist across devices and browser sessions so that my customized view follows me.
- As a user, I want independent section controls so that expanding "Scoring" does not also expand "Conditions" or other unrelated sections.
- As a first-time user, I want all advanced sections collapsed by default so that I see a clean, approachable interface.
- As a power user, I want to expand all sections at once without clicking each one individually.

**Secondary User: Multi-Instance Administrator**

- As a user managing multiple Arr instances, I want the sync configuration page to collapse complex sections so that I can focus on one thing at a time.
- As a user, I want settings pages to hide infrequently changed options so that routine configuration tasks are fast.

### Business Rules

1. **Default to Basic**: Every section starts in `basic` mode (collapsed) for all users until explicitly changed. Unpersisted preferences return `mode: 'basic'` with `persisted: false`.

2. **Explicit Toggle Only**: Sections expand/collapse only through explicit user action. No auto-expansion based on data state or navigation (exception: error auto-expand on form submit).

3. **Per-User, Per-Section Persistence**: Each section key is scoped to a user ID. Keys follow `route-family:route-section:ui-section` format (e.g., `custom-formats:general:conditions`).

4. **Section Key Validation**: Keys must match `^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$` with max 96 characters. Validated on both client and server.

5. **Authentication Required**: Read/write of preferences requires authenticated session. Unauthenticated users see `basic` defaults.

6. **Rate Limiting**: 8 writes per 30-second window per user per key.

7. **Optimistic UI**: Mode changes applied immediately; debounced persistence (300ms). Server state wins on hydration unless pending local change exists.

8. **No Data Loss**: Collapsing a section does not clear or reset hidden field values.

9. **Basic Content Always Visible**: The default slot is always rendered. Only the `advanced` named slot toggles visibility.

10. **SSR Hydration**: Pages with disclosure sections should load initial modes server-side to prevent flash-of-incorrect-state.

### Edge Cases

| Scenario                              | Expected Behavior                                                           | Notes                                     |
| ------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------- |
| Logout/auth change                    | `clearOnAuthChange()` clears all cached section states                      | Prevents preference leakage between users |
| Server unreachable                    | Client uses local optimistic state; reconciles on next successful hydration | Graceful degradation                      |
| New sections added in code update     | Users who have never interacted default to `basic`                          | No migration needed                       |
| Concurrent tabs toggling same section | Last write wins; server reconciliation on next hydration                    | Debounce + revision tracking handles this |
| `AUTH=off` dev mode                   | Preferences not persisted; sections always reset to basic on page load      | Expected behavior in dev                  |
| Validation error in collapsed section | Auto-expand section, show error badge on header                             | Form submit triggers expansion            |
| `prefers-reduced-motion` enabled      | All animations disabled; instant show/hide                                  | WCAG 2.3.3 compliance                     |

### Success Criteria

- [ ] `DisclosureSection` wrapper eliminates per-section store wiring boilerplate
- [ ] All HIGH PRIORITY pages have progressive disclosure with appropriate section keys
- [ ] All MEDIUM PRIORITY pages have progressive disclosure where justified
- [ ] Server-side pre-hydration prevents flash-of-incorrect-state on all disclosure pages
- [ ] No regressions on existing Custom Formats General and Media Settings pages
- [ ] Smooth 200-300ms expand/collapse animations with `prefers-reduced-motion` support
- [ ] ARIA-compliant disclosure widgets (aria-expanded, keyboard activation, screen reader announcements)
- [ ] Chevron icon with rotation animation on toggle buttons
- [ ] E2E tests cover at least one new page's disclosure behavior
- [ ] Section key registry provides canonical source of truth for all valid keys

## Technical Specifications

### Architecture Overview

```
userInterfacePreferencesStore (singleton, client)
  |
  +-- section(sectionKey) --> UserInterfaceSectionPreferenceStore
        |                        |
        |  hydrate (GET)         |  persist (PATCH, debounced 300ms)
        |        |               |        |
        v        v               v        v
  /api/v1/ui-preferences <---> user_interface_preferences (SQLite)

DisclosureSection (NEW wrapper component)
  |
  +-- creates/subscribes/cleans up section store internally
  +-- passes mode to child AdvancedSection via bind:mode
  +-- eliminates 15-25 lines of boilerplate per section per page

AdvancedSection (EXISTING, enhanced)
  |
  +-- Renders basic slot (always visible)
  +-- Renders advanced slot (toggled by mode, with transition:slide)
  +-- Toggle button with aria-expanded + ChevronDown icon
  +-- No store awareness (dumb component, mode is a prop)
```

### Data Models

No schema changes required. The existing `user_interface_preferences` table (migration 050) supports all planned section keys:

#### user_interface_preferences (existing)

| Field       | Type    | Constraints                             | Description                  |
| ----------- | ------- | --------------------------------------- | ---------------------------- |
| user_id     | INTEGER | FK users(id) CASCADE                    | User who owns the preference |
| section_key | TEXT    | NOT NULL, max 96 chars, regex validated | Canonical section identifier |
| mode        | TEXT    | NOT NULL, 'basic' or 'advanced'         | Current disclosure mode      |
| updated_at  | TEXT    | NOT NULL                                | Last modification timestamp  |

**Indexes:**

- `idx_user_interface_preferences_user_section` UNIQUE on (user_id, section_key)

### API Design

No new endpoints required. The existing `/api/v1/ui-preferences` endpoint handles all reads and writes:

- `GET /api/v1/ui-preferences?section_key={key}&strict=false` - Read preference
- `PATCH /api/v1/ui-preferences` - Write preference with optimistic concurrency

### New Components

#### DisclosureSection (`$ui/form/DisclosureSection.svelte`)

Purpose: Higher-level wrapper that encapsulates the entire store lifecycle, eliminating per-page boilerplate.

```svelte
<DisclosureSection
  sectionKey="delay-profiles:general:bypass-conditions"
  sectionTitle="Bypass Conditions"
  sectionHint="Skip delay when special conditions are met."
  initialMode={data.sectionModes?.['delay-profiles:general:bypass-conditions']}
>
  <!-- Basic content (always visible) -->
  <FormInput label="Name" name="name" value={name} />

  <!-- Advanced content (toggled) -->
  <div slot="advanced">
    <Toggle label="Bypass if Highest Quality" checked={bypass} />
  </div>
</DisclosureSection>
```

Props:

- `sectionKey: string` (required) - canonical key, validated against regex
- `sectionTitle: string` (default: `'Advanced settings'`)
- `sectionHint: string` (default: `'These options are hidden by default and are optional.'`)
- `initialMode: UiPreferenceMode` (default: `'basic'`) - SSR-hydrated initial mode
- `showAdvancedLabel: string` (default: `'Show Advanced'`)
- `hideAdvancedLabel: string` (default: `'Hide Advanced'`)

Slots:

- default: basic content (always visible)
- `advanced`: content shown only in advanced mode

Lifecycle: Creates section store on init, subscribes internally, calls `cleanup()` in `onDestroy`.

#### CollapsibleCard (`$ui/card/CollapsibleCard.svelte`)

Purpose: Simpler disclosure variant for settings pages where the pattern is "collapse entire card body" rather than basic/advanced split.

```svelte
<CollapsibleCard
  title="Logging Configuration"
  description="Configure how Praxrr handles application logs"
  sectionKey="settings:general:logging"
>
  <LoggingSettings settings={data.logSettings} />
</CollapsibleCard>
```

Props:

- `title: string` (required)
- `description: string` (optional)
- `sectionKey: string` (optional) - if provided, uses disclosure store for persistence
- `defaultOpen: boolean` (default: `true`)

#### Section Key Registry (`$shared/disclosure/sectionKeys.ts`)

Purpose: Canonical source of truth for all valid section keys. Prevents typos, enables IDE autocomplete, supports "expand all" discovery.

### Canonical Section Keys

#### Existing (PR #164)

| Section Key                                         | Page                       |
| --------------------------------------------------- | -------------------------- |
| `custom-formats:general:conditions`                 | Custom Formats GeneralForm |
| `custom-formats:general:scoring`                    | Custom Formats GeneralForm |
| `custom-formats:general:negation-and-groups`        | Custom Formats GeneralForm |
| `media-management:media-settings:naming`            | Media Settings Form        |
| `media-management:media-settings:folder-management` | Media Settings Form        |
| `media-management:media-settings:importing`         | Media Settings Form        |

#### New (High Priority)

| Section Key                                | Page                        |
| ------------------------------------------ | --------------------------- |
| `arr:settings:connection-details`          | Arr InstanceForm            |
| `delay-profiles:general:bypass-conditions` | DelayProfileForm            |
| `settings:notifications:event-types`       | NotificationServiceForm     |
| `quality-profiles:general:metadata`        | Quality Profile GeneralForm |
| `databases:config:manifest-advanced`       | Database Config             |

#### New (Medium Priority)

| Section Key                                | Page                            |
| ------------------------------------------ | ------------------------------- |
| `settings:general:logging`                 | General Settings - Logging card |
| `settings:general:ai`                      | General Settings - AI card      |
| `settings:general:tmdb`                    | General Settings - TMDB card    |
| `settings:general:backup`                  | General Settings - Backup card  |
| `settings:security:sessions`               | Security page                   |
| `arr:upgrades:filter-settings`             | Arr Upgrades                    |
| `regular-expressions:general:metadata`     | Regular Expression Form         |
| `metadata-profiles:general:type-selection` | Metadata Profile Form           |

### AdvancedSection Enhancement

The existing `AdvancedSection.svelte` needs these changes:

1. **Replace `hidden` with `{#if}` + `transition:slide`**: The `hidden` attribute prevents animation. Switch to conditional rendering with Svelte's built-in slide transition (200ms, `quintOut` easing).

2. **Add chevron icon**: Add `ChevronDown` from `lucide-svelte` with `rotate-180` transform when expanded (200ms CSS transition).

3. **Respect `prefers-reduced-motion`**: Detect the media query and set transition duration to 0 when reduced motion is preferred.

4. **Migrate event handlers to `onclick`**: Align with Svelte 5 convention per CLAUDE.md.

### Animation Specifications

| Animation        | Duration | Easing                         | Notes                      |
| ---------------- | -------- | ------------------------------ | -------------------------- |
| Section expand   | 200ms    | `quintOut` (fast deceleration) | Svelte `transition:slide`  |
| Section collapse | 200ms    | `quintOut`                     | Same transition, reverse   |
| Chevron rotation | 200ms    | `ease` via CSS                 | CSS `transition-transform` |
| Reduced motion   | 0ms      | none                           | Instant show/hide          |

### System Integration

#### Files to Create

- `$ui/form/DisclosureSection.svelte`: Wrapper that encapsulates store lifecycle
- `$ui/card/CollapsibleCard.svelte`: Collapsible card for settings pages
- `$shared/disclosure/sectionKeys.ts`: Section key constants and helpers

#### Files to Modify

**Component enhancements:**

- `$ui/form/AdvancedSection.svelte`: Add `transition:slide`, chevron icon, `prefers-reduced-motion`, `onclick` migration

**Existing consumer refactors (eliminate boilerplate):**

- `routes/custom-formats/[databaseId]/components/GeneralForm.svelte`: Replace ~60 lines of store wiring with 3x `DisclosureSection`
- `routes/media-management/[databaseId]/media-settings/components/MediaSettingsForm.svelte`: Replace ~60 lines of store wiring with 3x `DisclosureSection`

**New disclosure section rollout (priority order):**

1. `routes/arr/components/InstanceForm.svelte` (~715 lines) - External URL, Tags, Status
2. `routes/delay-profiles/[databaseId]/components/DelayProfileForm.svelte` - Bypass Conditions
3. `routes/settings/notifications/components/NotificationServiceForm.svelte` - Notification Types
4. `routes/quality-profiles/[databaseId]/components/GeneralForm.svelte` - Description, Tags, Language
5. `routes/databases/[id]/config/+page.svelte` (~410 lines) - Manifest advanced fields
6. `routes/settings/general/+page.svelte` - AI, TMDB, Logging, Backup cards (CollapsibleCard)
7. `routes/settings/security/+page.svelte` - Sessions section
8. `routes/arr/[id]/upgrades/+page.svelte` - Filter settings
9. `routes/regular-expressions/[databaseId]/components/RegularExpressionForm.svelte` - Metadata fields
10. `routes/metadata-profiles/[databaseId]/components/MetadataProfileForm.svelte` - Type selection

**Server-side hydration additions:**

- Each `+page.server.ts` for pages with disclosure sections should load initial modes via `userInterfacePreferencesQueries.getByUserIdAndSectionKey()` and pass as page data.

#### Pages NOT Candidates

List pages, read-only pages, and simple auth flows do not benefit from progressive disclosure:

- All list/index pages (`/custom-formats/[databaseId]`, `/arr`, `/databases`, etc.)
- Read-only pages (`/databases/[id]/changes`, `/arr/[id]/logs`, `/settings/about`)
- Auth flows (`/auth/login`, `/auth/setup`)
- Development pages (`/dev/components`)

## UX Considerations

### User Workflows

#### Primary Workflow: Configuration with Progressive Disclosure

1. **Page load**: System renders form with sections collapsed to `basic` mode. Section headers with chevron icons indicate expandable content.
2. **Scan and orient**: User reads section headers to understand available configuration categories.
3. **Expand needed section**: User clicks header or "Show Advanced" toggle. Section smoothly expands (200ms ease-out). Chevron rotates from right to down.
4. **Configure fields**: User fills in fields. Mode preference (`advanced`) is debounced and persisted server-side.
5. **Save**: User submits form. If errors exist in collapsed sections, those sections auto-expand with error badges.
6. **Return visit**: Persisted preferences restore sections to their previous state.

#### Error Recovery Workflow

1. **Error occurs**: User submits form with validation errors in collapsed sections.
2. **System auto-expands**: All sections containing errors expand automatically.
3. **Error badges**: Section headers show red error count badges.
4. **Recovery**: User corrects fields; badges clear as errors are resolved.

### UI Patterns

| Component       | Pattern                              | Notes                             |
| --------------- | ------------------------------------ | --------------------------------- |
| Section toggle  | Button with ChevronDown + text label | "Show Advanced" / "Hide Advanced" |
| Chevron         | Right-to-down rotation (200ms)       | CSS `transition-transform`        |
| Animation       | Svelte `transition:slide`            | 200ms, `quintOut` easing          |
| Error indicator | Red badge with count on header       | Auto-expand on submit             |
| Content spacing | 16px padding inside revealed content | Match existing card padding       |

### Accessibility Requirements

| Requirement              | Implementation                                  | WCAG Criterion                    |
| ------------------------ | ----------------------------------------------- | --------------------------------- |
| Button element           | Toggle must be native `<button>`                | 4.1.2 Name, Role, Value           |
| `aria-expanded`          | `true` when visible, `false` when hidden        | 4.1.2                             |
| `aria-controls`          | References content panel `id`                   | 4.1.2                             |
| Keyboard: Enter/Space    | Toggle disclosure                               | 2.1.1 Keyboard                    |
| `prefers-reduced-motion` | Disable all animations                          | 2.3.3 Animation from Interactions |
| Content hidden from AT   | Use `{#if}` (removes from DOM) or `hidden` attr | 1.3.2 Meaningful Sequence         |
| Color not sole indicator | Icon + text provide redundant cues              | 1.4.1 Use of Color                |
| Focus visible            | 2px outline on toggle button                    | 2.4.7 Focus Visible               |

### Performance UX

- **Loading States**: SSR-hydrated initial state prevents layout shift. Client store hydrates asynchronously for reconciliation.
- **Optimistic Updates**: Mode changes apply instantly; server persistence is debounced.
- **Animation Performance**: `transition:slide` handles height animation. No direct `height` property animation. `prefers-reduced-motion` eliminates all transitions.
- **Many Sections**: Pages with 4+ sections may benefit from a batch hydration API (`GET /api/v1/ui-preferences?section_keys=a,b,c`) in the future.

## Recommendations

### Implementation Approach

**Recommended Strategy**: Hybrid component-encapsulated with central store. Refactor `AdvancedSection` boilerplate into a `DisclosureSection` wrapper first (Phase 1), then roll out across all applicable pages (Phase 2), then add polish features (Phase 3).

**Phasing:**

1. **Phase 1 - Foundation**: Refactor AdvancedSection, create DisclosureSection wrapper, create section key registry, migrate existing consumers, add slide transitions.
2. **Phase 2 - Core Rollout**: Apply disclosure to all candidate pages grouped by similarity (entity forms, complex multi-section pages, settings pages).
3. **Phase 3 - Polish**: "Expand all / Collapse all" controls, contextual hidden-content hints, deep linking via URL hash, section content summaries.

### Technology Decisions

| Decision              | Recommendation                          | Rationale                                                                |
| --------------------- | --------------------------------------- | ------------------------------------------------------------------------ |
| Boilerplate reduction | `DisclosureSection` wrapper component   | Natural Svelte composition; encapsulates lifecycle                       |
| Animation             | Svelte `transition:slide`               | Already used in codebase (`group.svelte`), handles dynamic height        |
| Settings pages        | Separate `CollapsibleCard` component    | Different visual pattern (collapse entire body vs. basic/advanced split) |
| SSR hydration         | Load initial modes in `+page.server.ts` | Prevents flash-of-basic-then-switch-to-advanced                          |
| New dependencies      | None                                    | Svelte built-ins + existing deps are sufficient                          |
| Icon                  | `ChevronDown` from lucide-svelte        | Already in project; matches design system conventions                    |

### Quick Wins

- **Chevron icon on toggle buttons**: ChevronDown with `rotate-180` transform. ~10 lines of change, significant visual improvement.
- **Section key registry file**: Prevents typos, enables autocomplete. Under an hour to implement.
- **CSS slide transition**: Adding `transition:slide` to AdvancedSection is a ~15-line change that dramatically improves perceived polish.

### Future Enhancements

- **"Expand all / Collapse all"**: Toolbar button on pages with 3+ sections
- **Section content summaries**: Show current config summary when collapsed (e.g., "3 custom formats, min score: 10")
- **Deep linking**: URL hash fragments (`#section-key`) that auto-expand sections
- **User preference profiles**: Beginner/Intermediate/Advanced presets that bulk-set all section keys
- **Smart defaults**: Auto-expand sections with non-default configured values
- **Cross-tab sync**: BroadcastChannel for real-time disclosure sync across tabs
- **Batch hydration API**: `GET /api/v1/ui-preferences?section_keys=a,b,c` for pages with many sections

## Risk Assessment

### Technical Risks

| Risk                                        | Likelihood | Impact | Mitigation                                           |
| ------------------------------------------- | ---------- | ------ | ---------------------------------------------------- |
| Boilerplate explosion without refactor      | High       | Medium | Phase 1 refactors component before rollout           |
| Section key collisions                      | Low        | High   | Registry with compile-time validation                |
| SSR hydration flicker                       | Medium     | Low    | Extend `+page.server.ts` pattern to all pages        |
| Rate limit exhaustion on rapid toggle       | Low        | Low    | Already mitigated: 8 req/30s per key, 300ms debounce |
| Store memory leak from orphaned states      | Low        | Medium | Reference counting + cleanup already implemented     |
| Breaking existing consumers during refactor | Medium     | Medium | Maintain backward compatibility; keep `bind:mode`    |
| `transition:slide` + `min-height` conflict  | Medium     | Low    | Avoid `min-h-*` classes inside transition boundary   |
| Form state loss on `{#if}` toggle           | Low        | Medium | Form state lives in parent/dirty store, not DOM      |

### Integration Challenges

- **SSR hydration for many pages**: Each new disclosure page needs `+page.server.ts` updates. Create a utility function to keep it DRY.
- **Existing consumer migration**: GeneralForm and MediaSettingsForm have established patterns that must be preserved during migration.

### Security Considerations

- **Preference leakage**: `clearOnAuthChange()` already handles logout cache clearing.
- **Rate limiting**: Already enforced at 8 writes per 30s per user per key.

## Task Breakdown Preview

### Phase 1: Foundation

**Focus**: Eliminate boilerplate, establish reusable patterns, add animations.

**Tasks**:

- Create section key registry (`$shared/disclosure/sectionKeys.ts`)
- Create `DisclosureSection` wrapper component
- Enhance `AdvancedSection` with `transition:slide`, chevron icon, `prefers-reduced-motion`
- Migrate existing GeneralForm consumer to `DisclosureSection`
- Migrate existing MediaSettingsForm consumer to `DisclosureSection`
- Create `CollapsibleCard` component for settings pages
- Create SSR hydration utility for `+page.server.ts` loaders

**Parallelization**: Section key registry, component creation (DisclosureSection + CollapsibleCard), and AdvancedSection enhancement can run in parallel.

### Phase 2: Core Rollout

**Focus**: Apply disclosure to all candidate pages.
**Dependencies**: Phase 1 must complete first.

**Tasks**:

- Group A: Entity edit forms (QP general, delay profiles, notifications, regex, metadata)
- Group B: Complex pages (Arr instance settings, database config)
- Group C: Settings pages (general settings cards using CollapsibleCard)
- Group D: Remaining forms (Arr upgrades, security, naming forms)
- Add SSR hydration to each new disclosure page's `+page.server.ts`

**Parallelization**: Groups A, B, C, D can run in parallel once Phase 1 is complete.

### Phase 3: Polish

**Focus**: Cross-cutting UX improvements.
**Dependencies**: Phase 2 should be mostly complete.

**Tasks**:

- "Expand all / Collapse all" controls
- Hidden content hints (count/summary when collapsed)
- Deep linking via URL hash
- E2E test coverage for new disclosure pages

## Decisions Needed

1. **Wrapper Component vs. Helper Function**
   - Options: `DisclosureSection` component wrapper vs. `useSectionMode()` utility function
   - Impact: Component wrapper is more Svelte-idiomatic; utility function is lighter
   - Recommendation: Component wrapper (`DisclosureSection`) for consistency with existing component patterns

2. **DOM Destruction vs. CSS Hidden**
   - Options: `{#if}` (destroys DOM, enables `transition:slide`) vs. CSS grid `0fr/1fr` (keeps DOM)
   - Impact: `{#if}` is simpler and the dirty store handles form state; CSS grid avoids lifecycle overhead
   - Recommendation: `{#if}` + `transition:slide` as default (form state managed by parent, not DOM)

3. **CollapsibleCard Persistence**
   - Options: Server-persisted (same table) vs. client-only (localStorage)
   - Impact: Server = consistency across devices; localStorage = simpler
   - Recommendation: Server-persisted via same mechanism for uniformity

4. **Global "Expand All" Toggle**
   - Options: Per-page button vs. global keyboard shortcut vs. not needed yet
   - Impact: Useful for power users; requires section key registry
   - Recommendation: Implement in Phase 3 as a per-page button in StickyCard header

5. **Scoring Page Approach**
   - Options: Section-level disclosure vs. toolbar-level disclosure vs. skip for now
   - Impact: Scoring page is the most complex in the app (~1040 lines)
   - Recommendation: Skip for Phase 2; the page has unique structure that needs separate UX design

## Research References

For detailed findings, see:

- [research-external.md](./research-external.md): Svelte transition API, ARIA patterns, CSS animation techniques, library evaluations
- [research-business.md](./research-business.md): User stories, business rules, page-by-page analysis, existing implementation details
- [research-technical.md](./research-technical.md): Component architecture, API design, state management, file paths
- [research-ux.md](./research-ux.md): UX best practices, competitive analysis, accessibility requirements, animation specs
- [research-recommendations.md](./research-recommendations.md): Phasing strategy, risk assessment, task breakdown, alternative approaches
