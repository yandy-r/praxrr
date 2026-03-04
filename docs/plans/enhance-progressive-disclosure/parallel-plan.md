# Enhance Progressive Disclosure Implementation Plan (Second Pass)

This plan extends existing progressive-disclosure persistence to additional form-heavy pages without backend contract changes. The rollout is contract-first: establish a canonical section-key registry, disclosure primitives (`AdvancedSection`, `DisclosureSection`, `CollapsibleCard`), and shared SSR mode hydration utility before migrating route groups. After the foundation, route migrations are intentionally wide and parallel by feature family, with explicit handling for hidden-input risks in notification settings. Final hardening focuses on API/UI persistence regression coverage and hydration correctness.

## Critically Relevant Files and Documentation

- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/enhance-progressive-disclosure/shared.md: scope, priorities, and risks.
- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/enhance-progressive-disclosure/feature-spec.md: acceptance criteria and behavior contract.
- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/enhance-progressive-disclosure/analysis-context.md: architecture assumptions and rollout constraints.
- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/enhance-progressive-disclosure/analysis-code.md: integration map and conventions.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/form/AdvancedSection.svelte: current disclosure primitive.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/stores/userInterfacePreferences.ts: persistence lifecycle semantics.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/user_interface_preferences.ts: key validation and query logic.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/api/v1/ui-preferences/+server.ts: API behavior to preserve.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/custom-formats/[databaseId]/components/GeneralForm.svelte: baseline consumer migration target.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/components/MediaSettingsForm.svelte: baseline consumer migration target.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/general/+page.server.ts: SSR hydration pattern.

## Implementation Plan

### Phase 1: Foundation Contracts and Shared Primitives

#### Task 1.1: Create canonical disclosure section-key registry Depends on [none]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/enhance-progressive-disclosure/shared.md
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/user_interface_preferences.ts

**Instructions**

Files to Create

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/shared/disclosure/sectionKeys.ts

Files to Modify

- none

- Export constants for all existing and approved rollout keys.
- Export grouped key arrays for route families to reduce repeated inline lists.
- Keep all keys compatible with existing regex and length checks.

#### Task 1.2: Enhance AdvancedSection with motion and reduced-motion support Depends on [none]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/form/AdvancedSection.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/enhance-progressive-disclosure/research-ux.md

**Instructions**

Files to Create

- none

Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/form/AdvancedSection.svelte

- Replace hidden-only advanced rendering with transition-driven mount/unmount.
- Add chevron icon rotation and preserve current ARIA attributes.
- Respect reduced-motion users with zero-duration transition behavior.

#### Task 1.3: Add DisclosureSection wrapper component Depends on [1.1, 1.2]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/stores/userInterfacePreferences.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/form/AdvancedSection.svelte

**Instructions**

Files to Create

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/form/DisclosureSection.svelte

Files to Modify

- none

- Accept `sectionKey`, `initialMode`, and presentation labels/hints.
- Own section-store subscription lifecycle and invoke `cleanup()` on destroy.
- Forward default and `advanced` slots into `AdvancedSection`.

#### Task 1.4: Add CollapsibleCard for full-card settings disclosure Depends on [1.1]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/general/+page.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/security/+page.svelte

**Instructions**

Files to Create

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/card/CollapsibleCard.svelte

Files to Modify

- none

- Implement inline-settings-card-compatible collapse behavior.
- Support optional persisted `sectionKey` and non-persisted default-open mode.
- Keep markup compatible with existing settings card visual style.

#### Task 1.5: Add shared server section-mode hydration utility Depends on [1.1]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/general/+page.server.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/user_interface_preferences.ts

**Instructions**

Files to Create

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/disclosure/loadSectionModes.ts

Files to Modify

- none

- Return typed section-mode map (`basic|advanced`) for provided keys.
- Default absent rows to `basic`.
- Keep API aligned with existing loader return-shape expectations.

### Phase 2: Baseline Refactor and High-Priority Rollout

#### Task 2.1: Refactor custom-formats GeneralForm to DisclosureSection Depends on [1.1, 1.3, 1.5]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/custom-formats/[databaseId]/components/GeneralForm.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/general/+page.server.ts

**Instructions**

Files to Create

- none

Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/custom-formats/[databaseId]/components/GeneralForm.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/general/+page.server.ts

- Replace manual section-store wiring with `DisclosureSection` instances.
- Source keys from registry constants.
- Keep return payload key for initial modes (`customFormatSectionModes`) intact.

#### Task 2.2: Refactor media-settings form and loader hydration Depends on [1.1, 1.3, 1.5]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/components/MediaSettingsForm.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/+page.server.ts

**Instructions**

Files to Create

- none

Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/components/MediaSettingsForm.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/+page.server.ts

- Replace manual local mode sync with `DisclosureSection`.
- Load section modes using `loadSectionModes` and return `mediaSettingsSectionModes` in page data.
- Preserve existing field validation and disabled-state behavior.

#### Task 2.3: Add Arr InstanceForm disclosure with explicit loader hydration Depends on [1.1, 1.3, 1.5]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/arr/new/+page.server.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts

**Instructions**

Files to Create

- none

Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/arr/new/+page.server.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts

- Move optional connection fields to advanced disclosure with key `arr:settings:connection-details`.
- Hydrate both create and edit flows with `arrSettingsSectionModes` payload.
- Keep test-connection and warning behavior unchanged.

#### Task 2.4: Add DelayProfileForm disclosure with explicit loader hydration Depends on [1.1, 1.3, 1.5]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/delay-profiles/[databaseId]/components/DelayProfileForm.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/delay-profiles/[databaseId]/new/+page.server.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/delay-profiles/[databaseId]/[name]/+page.server.ts

**Instructions**

Files to Create

- none

Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/delay-profiles/[databaseId]/components/DelayProfileForm.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/delay-profiles/[databaseId]/new/+page.server.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/delay-profiles/[databaseId]/[name]/+page.server.ts

- Keep name/protocol/delays in basic section and move bypass controls to advanced section.
- Use section key `delay-profiles:general:bypass-conditions`.
- Hydrate section mode in create/edit loaders via `delayProfileSectionModes`, defaulting to `basic`.

#### Task 2.5: Add NotificationServiceForm disclosure with hidden-input preservation Depends on [1.1, 1.3]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/notifications/components/NotificationServiceForm.svelte

**Instructions**

Files to Create

- none

Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/notifications/components/NotificationServiceForm.svelte

- Add disclosure for event types using key `settings:notifications:event-types`.
- Keep hidden/submitted values available when collapsed.
- Preserve existing service-type form submission semantics.

#### Task 2.6: Add quality-profile GeneralForm metadata disclosure Depends on [1.1, 1.3]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/components/GeneralForm.svelte

**Instructions**

Files to Create

- none

Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/components/GeneralForm.svelte

- Keep name in default slot and move description/tags/language to advanced slot.
- Use key `quality-profiles:general:metadata` from registry.
- Preserve existing hidden-input and language-option behavior.

#### Task 2.7: Add database-config advanced disclosure split Depends on [1.1, 1.3]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/databases/[id]/config/+page.svelte

**Instructions**

Files to Create

- none

Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/databases/[id]/config/+page.svelte

- Keep manifest essentials visible and move optional metadata/dependency details into advanced section.
- Use key `databases:config:manifest-advanced`.
- Preserve schema dependency error messaging inside advanced content.

### Phase 3: Settings/Remaining Rollout and Hardening

#### Task 3.1: Integrate CollapsibleCard wrapper points in settings/general page Depends on [1.1, 1.4]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/general/+page.svelte

**Instructions**

Files to Create

- none

Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/general/+page.svelte

- Wrap targeted cards with `CollapsibleCard` boundaries keyed to logging/ai/tmdb/backup section keys.
- Keep existing form submissions delegated to child settings components.
- Ensure collapse state props are passed into component blocks.

#### Task 3.2: Apply CollapsibleCard usage to settings/general settings components Depends on [1.1, 1.4, 3.1]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/general/components/AISettings.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/general/components/LoggingSettings.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/general/components/TMDBSettings.svelte

**Instructions**

Files to Create

- none

Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/general/components/AISettings.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/general/components/LoggingSettings.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/general/components/TMDBSettings.svelte

- Normalize each component to be safely hosted in `CollapsibleCard` body content.
- Ensure current submit/loading/error state UX remains unchanged while collapsed/expanded.
- Use keys `settings:general:ai`, `settings:general:logging`, `settings:general:tmdb`.

#### Task 3.3: Apply CollapsibleCard usage to remaining settings/general components Depends on [1.1, 1.4, 3.1]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/general/components/BackupSettings.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/general/components/ArrDefaultsSettings.svelte

**Instructions**

Files to Create

- none

Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/general/components/BackupSettings.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/general/components/ArrDefaultsSettings.svelte

- Apply collapsible-host compatibility for backup card using key `settings:general:backup`.
- Keep ArrDefaultsSettings unaffected by disclosure persistence unless explicitly required by scope.
- Preserve existing save and dirty-state behavior.

#### Task 3.4: Add CollapsibleCard-based collapse for security sessions Depends on [1.1, 1.4]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/security/+page.svelte

**Instructions**

Files to Create

- none

Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/security/+page.svelte

- Implement `CollapsibleCard` for the sessions block only.
- Use key `settings:security:sessions`.
- Preserve revoke controls and feedback behavior.

#### Task 3.5: Add disclosure to remaining medium-priority form pages Depends on [1.1, 1.3]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/regular-expressions/[databaseId]/components/RegularExpressionForm.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/metadata-profiles/[databaseId]/components/MetadataProfileForm.svelte

**Instructions**

Files to Create

- none

Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/regular-expressions/[databaseId]/components/RegularExpressionForm.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/metadata-profiles/[databaseId]/components/MetadataProfileForm.svelte

- In regular expression form, keep core pattern fields visible and move metadata-only inputs into advanced slot with key `regular-expressions:general:metadata`.
- In metadata profile form, keep required type selection flow visible and move optional advanced selectors into disclosure with key `metadata-profiles:general:type-selection`.
- Preserve existing form submit contracts and hidden field behavior.

#### Task 3.6: Add disclosure to arr upgrades filter section Depends on [1.1, 1.4]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/arr/[id]/upgrades/+page.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/arr/[id]/upgrades/+page.server.ts

**Instructions**

Files to Create

- none

Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/arr/[id]/upgrades/+page.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/arr/[id]/upgrades/+page.server.ts

- Collapse filter settings with key `arr:upgrades:filter-settings` while preserving sticky action bar behavior.
- Add initial mode hydration payload `arrUpgradesSectionModes` from loader.
- Keep dirty-store update flow and save/reset semantics unchanged.

#### Task 3.7: Expand test coverage for rollout persistence and hydration Depends on [2.1, 2.2, 2.3, 2.4, 2.5, 3.2, 3.4, 3.5, 3.6]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/routes/uiPreferencesApi.test.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/e2e/specs/2.50-progressive-disclosure.spec.ts

**Instructions**

Files to Create

- none

Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/routes/uiPreferencesApi.test.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/e2e/specs/2.50-progressive-disclosure.spec.ts

- Add API coverage for newly introduced section keys.
- Add E2E checks for hydration and persistence across one high-priority form and one settings card.
- Add regression coverage for notification hidden-input preservation under collapse.

## Advice

- Keep key usage strict by importing registry constants everywhere and avoiding inline strings.
- For notification settings, decide collapse strategy around hidden-input persistence before broad copy/paste migrations.
- Require SSR hydration for each newly persistent disclosure section to prevent first-render state flips.
- Prefer parallel implementation lanes after Phase 1 to reduce merge risk and wall-clock time.
- Treat API/store behavior as fixed contracts for this initiative; the feature should be additive at UI/loader level.
