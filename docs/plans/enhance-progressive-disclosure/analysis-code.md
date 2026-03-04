### Executive Summary

Core persistence already exists, so implementation risk sits in UI integration consistency: replacing repeated per-page store wiring, preserving form semantics during collapse, and enforcing stable section-key usage. The most reusable code additions are `DisclosureSection`, `CollapsibleCard`, and a shared SSR mode loader utility. High-value modifications are route-local and can be split into small, parallel tasks once these contracts are stable.

### Related Components

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/user_interface_preferences.ts: validation and persistence query layer.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/api/v1/ui-preferences/+server.ts: endpoint behavior and write constraints.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/stores/userInterfacePreferences.ts: section store API and lifecycle.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/form/AdvancedSection.svelte: target for transition/accessibility enhancements.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/custom-formats/[databaseId]/components/GeneralForm.svelte: baseline migration pattern.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/components/MediaSettingsForm.svelte: baseline migration pattern.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/general/+page.svelte: settings card composition pattern.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/security/+page.svelte: inline settings card pattern.

### Implementation Patterns

**Manual Wiring Replacement**

- Example: `/routes/custom-formats/.../GeneralForm.svelte` and `/routes/media-management/.../MediaSettingsForm.svelte`.
- Apply to: route form migrations.

**SSR Mode Hydration Map**

- Example: `/routes/custom-formats/[databaseId]/[id]/general/+page.server.ts`.
- Apply to: all routes adopting disclosure persistence.

**Transition Pattern Reuse**

- Example: `/lib/client/ui/navigation/pageNav/group.svelte` using `transition:slide`.
- Apply to: `AdvancedSection` animated advanced-panel mount/unmount.

**Settings Card Composition**

- Example: `/routes/settings/security/+page.svelte` inline rounded cards.
- Apply to: `CollapsibleCard` and settings-page migration.

### Integration Points

#### Files to Create

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/shared/disclosure/sectionKeys.ts: canonical section-key exports.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/form/DisclosureSection.svelte: wrapper with internal store lifecycle.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/card/CollapsibleCard.svelte: full-card collapse component.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/disclosure/loadSectionModes.ts: shared server utility for initial disclosure modes.

#### Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/form/AdvancedSection.svelte: add slide animation + reduced-motion + chevron behavior.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/custom-formats/[databaseId]/components/GeneralForm.svelte: replace manual store wiring.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/components/MediaSettingsForm.svelte: replace manual store wiring.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte: add advanced split via disclosure.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/delay-profiles/[databaseId]/components/DelayProfileForm.svelte: add advanced split via disclosure.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/notifications/components/NotificationServiceForm.svelte: add disclosure with hidden-input safeguards.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/components/GeneralForm.svelte: add metadata disclosure.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/databases/[id]/config/+page.svelte: split basic vs advanced config sections.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/general/+page.svelte: apply `CollapsibleCard` for selected cards.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/security/+page.svelte: add session section collapse behavior.

### Conventions

- Section keys are lower-case, colon-delimited triples; export and consume constants.
- Fail fast on invalid key/mode where existing code already validates; do not add fallback key paths.
- Preserve existing Svelte conventions in project (`onclick`, no runes) and existing accessibility attributes.

### Gotchas and Warnings

- Notification form can lose submitted values if hidden inputs are inside an unmounted advanced block.
- Animated `{#if}` unmount/remount can break state if a field relies on DOM persistence rather than reactive/form state.
- SSR hydration remains inconsistent today; missing loader updates can produce mode flicker.

### Task Guidance by Area

- database: no schema changes; rely on existing preference table and query validators.
- api: keep `/api/v1/ui-preferences` behavior unchanged.
- ui: prioritize reusable wrapper + registry, then migrate pages in parallel groups.
