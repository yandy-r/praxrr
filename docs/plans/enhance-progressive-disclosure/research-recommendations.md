# Recommendations: enhance-progressive-disclosure

## Executive Summary

The existing PR #164 implementation provides a solid foundation with a well-designed `AdvancedSection` component, server-persisted user preferences via `/api/v1/ui-preferences`, and a debounced client store with retry logic. However, it is currently deployed on only two of the approximately twelve form-bearing route families, and the per-section wiring pattern (three local variables plus three subscriptions plus three reactive sync blocks per section) creates significant boilerplate that will not scale. The primary recommendation is to refactor `AdvancedSection` into a self-contained component that internally manages store integration, then systematically roll it out across all applicable pages in three phases: foundation refactoring, core rollout, and polish features.

## Implementation Recommendations

### Recommended Approach

**Hybrid: Component-encapsulated with central store.** Keep the existing `userInterfacePreferencesStore` as the persistence and hydration backbone, but move all subscription, sync, and cleanup logic into the `AdvancedSection` component itself so that consumers only need to supply a `sectionId` prop. This eliminates the current boilerplate explosion where each consuming form must declare ~30 lines of store wiring per section.

The `AdvancedSection` component should:

1. Accept a `sectionId` prop (required, validated against the existing `route-family:route-section:ui-section` pattern).
2. Internally call `getUserInterfacePreferenceSectionStore(sectionId)` on mount.
3. Subscribe to the mode store internally and expose the current mode via `bind:mode` for consumers that need to react to it.
4. Call `cleanup()` in `onDestroy` automatically.
5. Continue using two-way `bind:mode` for the rare cases where a parent component needs programmatic mode control (e.g., "expand all" buttons).

### Technology Choices

| Component            | Recommendation                                               | Rationale                                                                                            |
| -------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| State persistence    | Keep existing SQLite `user_interface_preferences` table      | Already production-ready with concurrency handling, rate limiting, and auth integration              |
| Client store         | Keep `userInterfacePreferencesStore`                         | Well-designed with debounced writes, retry logic, reference counting, and auth-change cleanup        |
| Component            | Refactor `AdvancedSection.svelte` to self-wire               | Eliminates 30+ lines of boilerplate per section in consuming forms                                   |
| Animation            | CSS `transition` + `max-height` or Svelte `slide` transition | Lightweight, no new dependencies required                                                            |
| Section key registry | New `sectionKeys.ts` constants file                          | Prevents typos, enables "expand all" discovery, and provides a single source of truth for valid keys |
| Accessibility        | Extend existing ARIA attributes on `AdvancedSection`         | Already has `aria-expanded`, `aria-controls`, and `role="region"`                                    |

### Phasing Strategy

#### Phase 1 - Foundation (1 sprint)

**Scope:** Refactor `AdvancedSection` to self-manage store wiring; create section key registry; backport existing consumers to the simplified API; add CSS height transition.

1. Create `/packages/praxrr-app/src/lib/shared/disclosure/sectionKeys.ts` with all known and planned section keys as typed constants.
2. Refactor `AdvancedSection.svelte` to internally call `getUserInterfacePreferenceSectionStore`, subscribe, sync, and clean up. Keep `bind:mode` for backward compatibility but make external wiring optional.
3. Migrate `GeneralForm.svelte` (custom-formats) and `MediaSettingsForm.svelte` (media-management) to the simplified API, removing ~60 lines of boilerplate each.
4. Add a CSS-based expand/collapse transition (either Svelte `slide` or CSS `max-height` with `overflow: hidden`).
5. Add an optional `badge` slot or `badgeText` prop for section count/status indicators.

#### Phase 2 - Core Rollout (2 sprints)

**Scope:** Apply progressive disclosure to all remaining form-bearing routes, grouped by similarity.

- **Group A - Entity edit forms with optional fields:** Quality profiles general, delay profiles, regular expressions, metadata profiles.
- **Group B - Complex multi-section pages:** Arr sync configuration, arr upgrades, arr instance settings, database instance settings.
- **Group C - Settings pages:** General settings (AI, TMDB, Backup, Logging subsections), notification service form, security page.
- **Group D - Read-only/list pages with optional detail:** Custom format conditions, quality profile scoring, quality definitions, naming forms.

#### Phase 3 - Polish (1 sprint)

**Scope:** Cross-cutting UX improvements.

- "Expand all" / "Collapse all" controls on pages with 3+ sections.
- Keyboard shortcut support (e.g., `Alt+A` to toggle all advanced sections).
- Deep-link support via URL hash fragments (`#section-id`) that auto-expand the target section.
- User preference profiles (beginner/intermediate/advanced presets) in the UI settings page.
- Contextual hidden-content hints (e.g., "3 advanced settings hidden").

### Quick Wins

- **Badge counts on section headers**: Show "N fields" or "N configured" in the collapsed header to communicate what is hidden. Low effort, high discoverability impact.
- **Section key registry file**: Prevents typos, enables IDE autocomplete, and provides a single manifest of all disclosure-enabled sections. Can be implemented in under an hour.
- **CSS slide transition**: Adding a height transition to the `hidden` toggle on `AdvancedSection` is a ~10-line CSS change that dramatically improves perceived polish.
- **"Expand all" button**: A single button in `StickyCard` that toggles all sections on the page. Straightforward with the section key registry.

## Improvement Ideas

### Related Features

- **"Expand all" / "Collapse all" controls**: Pages like sync configuration and settings/general have 3-6 logical sections. A toolbar button that bulk-toggles all `AdvancedSection` instances on the page provides expert users with a fast way to see everything. Implementation: the section key registry groups keys by route family, and a new `DisclosureToolbar` component iterates and calls `.mode.set()` on each.
- **Search within collapsed sections**: When the user types in an existing search/filter bar (e.g., on scoring page, filter settings), auto-expand any `AdvancedSection` that contains a matching field. This prevents the "I searched but nothing appeared" frustration. Implementation: use an `IntersectionObserver`-like approach or expose a `containsMatch` callback prop.
- **Contextual hidden-content hints**: Display a subtle count ("3 advanced fields hidden") next to the section header when collapsed. This communicates value without visual clutter.
- **User preference profiles**: A dropdown on `/settings/general` (UI section) that lets users pick "Beginner / Intermediate / Advanced" and bulk-sets all section keys accordingly. This is a high-value feature for onboarding.
- **Deep linking to specific sections**: Support `#section-key` URL fragments that auto-expand the matching section on page load. Useful for documentation links and support workflows.

### Future Enhancements

- **Animated content height transitions**: Replace the `hidden` attribute with a CSS/Svelte transition for expand/collapse. Complexity: low. Value: significant polish improvement.
- **Section badges**: Show counts (e.g., "2 conditions configured"), status indicators (e.g., a dot for unsaved changes), or warnings in the section header bar. Complexity: medium (requires each section to communicate its summary state). Value: high for at-a-glance understanding.
- **Keyboard shortcuts**: `Alt+A` or a page-level shortcut to toggle all sections. Complexity: low. Value: moderate for power users.
- **Remembering expanded state during a page session**: Currently the store persists across sessions. Consider also maintaining in-memory "session expanded" state for sections the user manually opened during the current page visit, even if they are not persisted. Complexity: low (already handled by the mode store, but could be a distinct concept for temporary expansions).
- **Smart defaults based on entity state**: Auto-expand sections that have non-default values configured. For example, if a delay profile has bypass conditions configured, auto-expand the bypass section even if the user preference says "basic". Complexity: medium. Value: prevents confusion when editing entities with advanced config.

## Risk Assessment

### Technical Risks

| Risk                                                                         | Likelihood                    | Impact                                                                    | Mitigation                                                                                                         |
| ---------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Boilerplate explosion if AdvancedSection is not refactored first             | High (current pattern proven) | Medium - each new section adds ~30 lines of subscribe/sync/cleanup wiring | Phase 1 refactors the component before rollout begins                                                              |
| Section key collisions across route families                                 | Low                           | High - would cause cross-page state leakage                               | Section key registry with compile-time uniqueness validation; key format already enforced by regex                 |
| Hydration flicker on initial load (flash of basic then switch to advanced)   | Medium                        | Low - cosmetic but noticeable                                             | SSR-side hydration already exists in custom-formats `+page.server.ts`; extend pattern to all pages with disclosure |
| Rate limit exhaustion during rapid toggling                                  | Low                           | Low - user sees transient rollback                                        | Already mitigated: 8 requests per 30s per key, debounced at 300ms                                                  |
| Store memory leak from orphaned section states                               | Low                           | Medium - grows over long sessions                                         | Reference counting and cleanup already implemented; validate with Phase 1 testing                                  |
| Breaking existing custom-formats and media-management wiring during refactor | Medium                        | Medium - could temporarily break two pages                                | Maintain backward compatibility in Phase 1 by keeping `bind:mode` working alongside internal wiring                |

### UX Risks

- **Users missing hidden features**: Mitigate with (a) contextual hints showing what is hidden, (b) smart defaults that auto-expand sections with configured values, (c) user preference profiles that let advanced users see everything by default.
- **Inconsistent disclosure behavior across pages**: Mitigate by establishing a clear pattern in Phase 1 and using the section key registry as a rollout checklist to ensure every applicable page is covered.
- **Over-disclosure (too many collapsible sections on one page)**: Not every form field needs progressive disclosure. Apply only to genuinely advanced or infrequently-used sections. Naming forms (RadarrNamingForm, SonarrNamingForm) have very few fields and may not benefit from disclosure at all.
- **Cognitive load of remembering preferences**: Mitigate by making the preference profiles accessible from the settings page and by providing "expand all" as an escape hatch.
- **Mobile experience degradation**: Collapsible sections are actually beneficial on mobile (reduce scroll depth), but the toggle button must be large enough for touch targets (already 44px+ in current implementation).

### Accessibility Risks

- **Screen reader announcement gaps**: The current implementation has `aria-expanded`, `aria-controls`, and `role="region"`. Verify that toggling is announced by screen readers. Add `aria-live="polite"` to the panel container if needed.
- **Keyboard navigation**: Ensure the toggle button is focusable and operable with Enter/Space. The current `<button>` element handles this natively.
- **Focus management on expand**: When a section expands, consider moving focus to the first focusable element within the panel for keyboard users.
- **Reduced motion preferences**: Use `prefers-reduced-motion` media query to disable height transitions for users who have requested reduced motion.

## Alternative Approaches

### Option A: Component-Level Disclosure (Current Approach, Evolved)

Each `AdvancedSection` instance manages its own state via the shared store, but all wiring is internal to the component.

- **Pros**: Simple mental model; each page opts in by wrapping content in `<AdvancedSection>`. No coordination needed between sections. Matches existing implementation direction.
- **Cons**: "Expand all" requires iterating a registry. No page-level awareness of what is disclosed.

### Option B: Store-Driven Disclosure (Central Controller)

A page-level `disclosureController` store manages all sections on the current page, providing bulk operations and coordination.

- **Pros**: Enables "expand all", "collapse all", smart defaults, and search-triggered expansion natively. Single point of coordination.
- **Cons**: Requires each page to set up a controller and register its sections. More ceremony for simple cases. Risk of over-engineering.

### Option C: URL-Driven Disclosure

Section state is encoded in URL search params or hash fragments (e.g., `?disclosure=conditions,scoring` or `#conditions`).

- **Pros**: Deep-linkable, shareable, bookmarkable. Browser back/forward preserves state.
- **Cons**: Clutters URLs. Conflicts with existing SvelteKit routing. Does not support per-user persistence across sessions. Not suitable as the primary mechanism.

### Option D: Hybrid (Recommended)

Component-level disclosure (Option A) as the default, with an optional page-level `DisclosureController` context for pages that need bulk operations (Option B), and URL hash support as a progressive enhancement (Option C).

- **Pros**: Gradual adoption. Simple pages just use `<AdvancedSection sectionId="...">`. Complex pages can opt into the controller for "expand all" and smart defaults. URL hashes work as a non-breaking enhancement.
- **Cons**: Two patterns to learn (though the controller is optional).

### Recommendation

**Option D (Hybrid)** is the best fit. It preserves the simplicity of the current approach while enabling advanced features on pages that need them. The controller can be introduced in Phase 3 without changing any Phase 2 work.

## Task Breakdown Preview

### Phase 1: Foundation

#### Task Group 1.1: Section Key Registry

- Create `/packages/praxrr-app/src/lib/shared/disclosure/sectionKeys.ts`
- Define all existing keys as constants: `CUSTOM_FORMATS_GENERAL_CONDITIONS`, `CUSTOM_FORMATS_GENERAL_SCORING`, etc.
- Define all planned keys for Phase 2 targets
- Add a `getAllSectionKeys()` helper and a `getSectionKeysByRouteFamily(family: string)` helper
- **Complexity**: Low

#### Task Group 1.2: AdvancedSection Refactor

- Move store subscription, sync, and cleanup logic into `AdvancedSection.svelte`
- Accept `sectionId` as a required prop; call `getUserInterfacePreferenceSectionStore(sectionId)` internally on component init
- Subscribe to mode store internally; expose current mode via `bind:mode` for optional external access
- Call `cleanup()` in `onDestroy`
- Maintain backward compatibility: if no `sectionId` is provided, fall back to the existing auto-counter behavior (local-only, no persistence)
- **Complexity**: Medium

#### Task Group 1.3: Migrate Existing Consumers

- Simplify `custom-formats/[databaseId]/components/GeneralForm.svelte`: remove ~30 lines of store wiring
- Simplify `media-management/[databaseId]/media-settings/components/MediaSettingsForm.svelte`: remove ~30 lines of store wiring
- Verify SSR hydration still works for both pages
- **Complexity**: Low

#### Task Group 1.4: CSS Transition

- Add expand/collapse height transition to `AdvancedSection`
- Respect `prefers-reduced-motion`
- **Complexity**: Low

### Phase 2: Core Rollout

#### Task Group 2.1: Entity Edit Forms (Group A)

**Pages and section key candidates:**

| Page                     | File                                                                                                       | Candidate Sections                                                           | Complexity |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------- |
| Quality profile general  | `/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/components/GeneralForm.svelte`              | Language selection (advanced for most users), Tags, Description              | Low        |
| Quality profile scoring  | `/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/scoring/+page.svelte`                  | Score thresholds (min score, upgrade until, increment), custom group manager | Medium     |
| Delay profile edit       | `/packages/praxrr-app/src/routes/delay-profiles/[databaseId]/components/DelayProfileForm.svelte`           | Bypass conditions (bypass if highest quality, bypass if above CF score)      | Low        |
| Regular expression edit  | `/packages/praxrr-app/src/routes/regular-expressions/[databaseId]/components/RegularExpressionForm.svelte` | Regex101 ID field, description field                                         | Low        |
| Metadata profile edit    | `/packages/praxrr-app/src/routes/metadata-profiles/[databaseId]/components/MetadataProfileForm.svelte`     | Secondary types, release statuses (primary types are core)                   | Low        |
| Custom format conditions | `/packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/conditions/+page.svelte`                 | Individual condition cards could collapse per-condition advanced fields      | Medium     |

#### Task Group 2.2: Complex Multi-Section Pages (Group B)

**Pages and section key candidates:**

| Page                       | File                                                                               | Candidate Sections                                                                                                    | Complexity |
| -------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------- |
| Arr sync configuration     | `/packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte`                       | Entire metadata profiles section (Lidarr-only), TRaSH guide sources per sync category, cron configuration per section | High       |
| Arr upgrades               | `/packages/praxrr-app/src/routes/arr/[id]/upgrades/+page.svelte`                   | Filter settings (already expandable per-filter), run history                                                          | Medium     |
| Arr instance settings      | `/packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte`               | External URL, tags, stored API key reveal section                                                                     | Medium     |
| Arr rename settings        | `/packages/praxrr-app/src/routes/arr/[id]/rename/components/RenameSettings.svelte` | Rename folders, summary notifications, ignore tag (rarely changed after initial setup)                                | Low        |
| Database instance settings | `/packages/praxrr-app/src/routes/databases/components/InstanceForm.svelte`         | Git identity fields, local ops, conflict strategy, auto pull (advanced Git config)                                    | Medium     |

#### Task Group 2.3: Settings Pages (Group C)

**Pages and section key candidates:**

| Page                      | File                                                                                               | Candidate Sections                                                                                                               | Complexity |
| ------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| General settings          | `/packages/praxrr-app/src/routes/settings/general/+page.svelte`                                    | AI configuration (rarely used), TMDB configuration (one-time setup)                                                              | Low        |
| AI settings               | `/packages/praxrr-app/src/routes/settings/general/components/AISettings.svelte`                    | API URL, model fields (show only when enabled) -- already has conditional rendering, could use AdvancedSection for consistent UX | Low        |
| Backup settings           | `/packages/praxrr-app/src/routes/settings/general/components/BackupSettings.svelte`                | Schedule/retention fields (show once enabled)                                                                                    | Low        |
| Logging settings          | `/packages/praxrr-app/src/routes/settings/general/components/LoggingSettings.svelte`               | Retention days, min level, file/console logging toggles                                                                          | Low        |
| Notification service form | `/packages/praxrr-app/src/routes/settings/notifications/components/NotificationServiceForm.svelte` | Notification type categories (often many, can group by category with disclosure)                                                 | Medium     |
| Security page             | `/packages/praxrr-app/src/routes/settings/security/+page.svelte`                                   | Change password section, API key management, session management                                                                  | Medium     |

#### Task Group 2.4: Naming and Quality Definition Forms (Group D)

**Pages and section key candidates:**

| Page                | File                                                                                                                         | Candidate Sections                                                                | Complexity |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------- |
| Radarr naming       | `/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/components/RadarrNamingForm.svelte`                    | Colon replacement, folder format (rarely changed)                                 | Low        |
| Sonarr naming       | `/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/components/SonarrNamingForm.svelte`                    | Similar to Radarr naming                                                          | Low        |
| Lidarr naming       | `/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/components/LidarrNamingForm.svelte`                    | Similar to Radarr naming                                                          | Low        |
| Quality definitions | `/packages/praxrr-app/src/routes/media-management/[databaseId]/quality-definitions/components/QualityDefinitionsForm.svelte` | Resolution groups could be collapsible (SD, Prereleases, Other are rarely edited) | Medium     |

### Phase 3: Polish

#### Task Group 3.1: Expand/Collapse All

- Create `DisclosureToolbar.svelte` component with "Expand All" / "Collapse All" buttons
- Integrate with section key registry to discover sections on current page
- Add to `StickyCard` on pages with 3+ sections
- **Complexity**: Medium

#### Task Group 3.2: Smart Defaults

- Auto-expand sections that contain non-default configured values
- Add an optional `hasContent` or `forceExpanded` prop to `AdvancedSection`
- **Complexity**: Medium

#### Task Group 3.3: Deep Linking

- Parse URL hash on page load, auto-expand matching section
- Scroll to expanded section after expansion
- Update URL hash when user manually expands a section (opt-in per page)
- **Complexity**: Medium

#### Task Group 3.4: User Preference Profiles

- Add "Disclosure Mode" dropdown to `/settings/general` UI section: Beginner / Intermediate / Advanced
- "Beginner" = all sections default to basic; "Advanced" = all sections default to advanced; "Intermediate" = current behavior (per-section persistence)
- Bulk-set all section keys when profile changes
- **Complexity**: Medium-High

#### Task Group 3.5: Hidden Content Hints

- Add optional `collapsedSummary` slot or prop to `AdvancedSection`
- Display count or status text when section is collapsed
- **Complexity**: Low

## Key Decisions Needed

- **Refactor AdvancedSection before or during rollout?** Recommendation: before (Phase 1). The current boilerplate pattern will create significant maintenance burden if replicated across 12+ more pages.
- **Which sections are genuinely "advanced" vs. core?** Need product/UX input per page. The risk is hiding important fields. Recommendation: err on the side of fewer sections initially and expand based on user feedback.
- **Should the section key format change?** The current `route-family:route-section:ui-section` format is solid. Recommendation: keep it, but add a fourth optional segment for deeply nested cases (e.g., `arr:sync:quality-profiles:trigger`). This requires a regex change from exactly-three to three-or-four segments.
- **SSR hydration strategy for new pages:** Currently only `custom-formats/[databaseId]/[id]/general/+page.server.ts` reads preferences server-side. Should all pages do this to prevent flash? Recommendation: yes, but make it a utility function to keep it DRY.
- **Should `hidden` attribute be replaced with CSS for animation?** The current `hidden={!isAdvanced}` approach is semantically correct but not animatable. Recommendation: replace with `class:hidden` plus a CSS transition wrapper. Ensure screen readers still respect the hidden state via `aria-hidden`.

## Open Questions

- What is the desired default for new users who have never set preferences? Currently "basic" for all sections. Should this change per page or section type?
- Should the "Expand all" feature also persist (i.e., remembering that the user wants all sections expanded)?
- Is there a priority order for which pages to enhance first based on user pain points or support requests?
- Should disclosure state be included in database backups and restore, or is it ephemeral enough to be excluded?
- Are there any pages where progressive disclosure should be explicitly avoided (e.g., setup wizards, first-run flows)?

## Relevant Files

### Existing Implementation

- `/packages/praxrr-app/src/lib/client/ui/form/AdvancedSection.svelte`: Core disclosure component with ARIA attributes, toggle button, and named slots
- `/packages/praxrr-app/src/lib/client/stores/userInterfacePreferences.ts`: Client-side store with debounced persistence, retry logic, ref counting, auth-change cleanup
- `/packages/praxrr-app/src/routes/api/v1/ui-preferences/+server.ts`: Server API endpoint with GET/PATCH, rate limiting, concurrency detection
- `/packages/praxrr-app/src/lib/server/db/queries/user_interface_preferences.ts`: Database query layer with upsert, validation, and section key format enforcement
- `/packages/praxrr-app/src/lib/server/db/migrations/050_create_user_interface_preferences.ts`: Schema migration for the preferences table

### Current Consumers

- `/packages/praxrr-app/src/routes/custom-formats/[databaseId]/components/GeneralForm.svelte`: 3 AdvancedSection instances with full store wiring (~60 lines of boilerplate)
- `/packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/components/MediaSettingsForm.svelte`: 3 AdvancedSection instances with full store wiring (~60 lines of boilerplate)
- `/packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/general/+page.server.ts`: SSR-side preference hydration example

### Primary Rollout Targets

- `/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/components/GeneralForm.svelte`: No disclosure yet; Language/Tags/Description are candidates
- `/packages/praxrr-app/src/routes/delay-profiles/[databaseId]/components/DelayProfileForm.svelte`: No disclosure yet; Bypass Conditions section is a candidate
- `/packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte`: No disclosure yet; External URL, Tags, stored API key are candidates
- `/packages/praxrr-app/src/routes/databases/components/InstanceForm.svelte`: No disclosure yet; Git identity, Local Ops, Conflict Strategy are candidates
- `/packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte`: Complex page with 4+ sections that could benefit from disclosure
- `/packages/praxrr-app/src/routes/arr/[id]/upgrades/+page.svelte`: Filters section with expandable table, Run History section
- `/packages/praxrr-app/src/routes/settings/general/components/AISettings.svelte`: Already has conditional rendering; could use AdvancedSection for consistency
- `/packages/praxrr-app/src/routes/settings/notifications/components/NotificationServiceForm.svelte`: Notification type categories could be collapsible
- `/packages/praxrr-app/src/routes/settings/security/+page.svelte`: Change password, API key, sessions are distinct sections

### Existing Planning Documents

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/progressive-disclosure/requirements.md`: Original acceptance criteria and section key format spec
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/progressive-disclosure/custom-formats-rollout-notes.md`: Notes from custom-formats rollout
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/progressive-disclosure/media-management-rollout-notes.md`: Notes from media-management rollout
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/progressive-disclosure/quality-profiles-rollout-notes.md`: Planned but not yet implemented for quality profiles
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/progressive-disclosure/api-contract.md`: API contract documentation
