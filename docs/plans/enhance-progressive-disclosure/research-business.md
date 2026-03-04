# Business Logic Research: enhance-progressive-disclosure

## Executive Summary

Praxrr's progressive disclosure infrastructure (PR #164) provides a solid per-user, per-section persistence layer with server-backed `basic`/`advanced` mode toggling, currently deployed on only 2 of approximately 20+ candidate pages. This research maps every route in the application against progressive disclosure suitability, defines business rules for when and how sections should be disclosed, and identifies the patterns and components needed to roll the feature out site-wide while maintaining consistency and reducing cognitive load for home media server administrators.

## User Stories

### Primary User: Media Server Administrator

- As a user, I want complex configuration pages to show only essential fields by default so that I am not overwhelmed when I first visit a page.
- As a user, I want to reveal advanced options on demand with a clear "Show Advanced" control so that I know exactly what I am enabling.
- As a user, I want the app to remember which sections I have expanded so that I do not have to re-expand them every time I return.
- As a user, I want my disclosure preferences to persist across devices and browser sessions so that my customized view follows me.
- As a user, I want independent section controls so that expanding "Scoring" does not also expand "Conditions" or other unrelated sections.
- As a first-time user, I want all advanced sections collapsed by default so that I see a clean, approachable interface.
- As a power user, I want to be able to expand all relevant sections once and have them stay expanded permanently.
- As a user, I want clear visual separation between basic and advanced content so that I can quickly distinguish which controls are optional versus essential.

### Secondary User: Multi-Instance Administrator

- As a user managing multiple Radarr/Sonarr/Lidarr instances, I want the sync configuration page to collapse complex sections so that I can focus on one thing at a time.
- As a user, I want settings pages to hide infrequently changed options so that routine configuration tasks are fast.

## Business Rules

### Core Rules

1. **Default to Basic**: Every section with progressive disclosure starts in `basic` mode (collapsed) for all users until they explicitly change it. This is enforced server-side -- unpersisted preferences return `mode: 'basic'` with `persisted: false`.

2. **Explicit Toggle Only**: Sections expand and collapse only through explicit user action (clicking "Show Advanced" / "Hide Advanced"). No auto-expansion based on data state, navigation, or form validation.

3. **Per-User, Per-Section Persistence**: Each section key is scoped to a user ID. User A's expanded "Scoring" section does not affect User B's view. Section keys are namespaced as `route-family:route-section:ui-section` (e.g., `custom-formats:general:conditions`).

4. **Section Key Format**: All section keys must match `^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$` with a maximum length of 96 characters. Keys are validated on both client and server.

5. **Authentication Required**: Read/write of persisted preferences requires an authenticated session. Unauthenticated users always see `basic` defaults. A 401 response triggers the client to set `authRequired` and clear the section cache.

6. **Rate Limiting**: Write operations are rate-limited to 8 requests per 30-second window per user per section key to prevent abuse from rapid toggling.

7. **Optimistic UI with Server Reconciliation**: The client applies mode changes immediately (optimistic), then debounces persistence writes (300ms). On hydration, server state wins unless the user has a pending local change. Failed writes roll back to the last acknowledged mode.

8. **Concurrency Safety**: PATCH requests support `expected_updated_at` for optimistic concurrency control. The server detects conflicts but gracefully allows null `expected_updated_at` for pre-hydration writes.

9. **Basic Content Always Visible**: The basic (default) slot of every `AdvancedSection` is always rendered. The advanced slot is shown/hidden. Basic fields should be the minimum needed for a functional configuration.

10. **No Data Loss on Collapse**: Collapsing an advanced section does not clear or reset values in the hidden fields. Data persists regardless of visibility state.

### Edge Cases

- **Logout/Auth Change**: `clearOnAuthChange()` is called on logout to clear all cached section states and timers, preventing preference leakage between users.
- **Concurrent Tabs**: The debounce and revision tracking system handles multiple tabs toggling the same section. The last write wins with server reconciliation on next hydration.
- **New Sections Added**: When new section keys are introduced in a code update, users who have never interacted with them default to `basic`. No migration is needed.
- **Server Unreachable**: If the preference API is unreachable, the client uses local optimistic state. On next successful hydration, server state is reconciled.
- **First Visit After Feature Rollout**: Existing users who have never set preferences see all new advanced sections collapsed. This is the desired experience -- progressive disclosure reveals complexity only on demand.

## Workflows

### Primary Workflow: Toggle Advanced Section

1. User navigates to a page with an `AdvancedSection` component (e.g., Custom Formats General).
2. System renders the page with the section in its persisted mode (or `basic` if no preference exists).
3. Client hydrates by calling `GET /api/v1/ui-preferences?section_key={key}&strict=false`.
4. User clicks "Show Advanced" button.
5. Client immediately updates local store to `advanced` mode (optimistic).
6. Client schedules a debounced (300ms) `PATCH /api/v1/ui-preferences` with the new mode.
7. Server validates the section key, persists via upsert, returns the updated record.
8. Client acknowledges the write and updates `lastAckMode` and `lastAckUpdatedAt`.
9. On next page visit or refresh, the server-side `+page.server.ts` loader reads the preference and passes it as initial data, avoiding flash-of-incorrect-state.

### Secondary Workflow: First-Time User Experience

1. New user creates account and logs in.
2. User navigates to Custom Formats or Settings.
3. All `AdvancedSection` components render in `basic` mode (collapsed).
4. User sees only essential fields: Name, Description, Tags, etc.
5. User notices "Show Advanced" buttons with descriptive hints explaining what the advanced section contains.
6. User clicks to expand sections as needed, learning the interface incrementally.
7. Preferences persist -- next visit shows their chosen configuration.

### Tertiary Workflow: Server-Side Pre-Hydration

1. User navigates to a page with progressive disclosure sections.
2. `+page.server.ts` loader reads `locals.user.id` and calls `userInterfacePreferencesQueries.getByUserIdAndSectionKey()` for each section key relevant to the page.
3. Loader passes section modes as part of page data (e.g., `customFormatSectionModes`).
4. Svelte component receives server-provided modes as initial values, preventing a flash from `basic` to `advanced` on hydration.
5. Client-side store subscribes and hydrates asynchronously, but the server-provided value is used until hydration completes.

## Existing Codebase Integration

### Current Implementation (PR #164)

The base progressive disclosure system is fully implemented and includes:

- **Database**: Migration `050_create_user_interface_preferences` creates the `user_interface_preferences` table with `user_id`, `section_key`, `mode` (basic|advanced), and `updated_at` columns. Unique index on `(user_id, section_key)`.
- **Server Queries**: `/packages/praxrr-app/src/lib/server/db/queries/user_interface_preferences.ts` provides `getByUserIdAndSectionKey`, `getByUserId`, `upsert`, and `isValidSectionKey`.
- **API Endpoint**: `/api/v1/ui-preferences` with GET (read) and PATCH (write) handlers, including rate limiting, section key validation, and concurrency control.
- **Client Store**: `/packages/praxrr-app/src/lib/client/stores/userInterfacePreferences.ts` provides a singleton store with per-section substores, debounced persistence, retry logic, hydration, and auth-aware cache clearing.
- **UI Component**: `/packages/praxrr-app/src/lib/client/ui/form/AdvancedSection.svelte` provides the visual container with `Show Advanced`/`Hide Advanced` toggle, ARIA attributes, and slotted content.
- **Tests**: Unit tests in `uiPreferencesApi.test.ts` and E2E tests in `2.50-progressive-disclosure.spec.ts`.

### Pages Currently Using Progressive Disclosure

1. **Custom Formats General** (`/custom-formats/[databaseId]/[id]/general` and `/custom-formats/[databaseId]/new`): 3 sections -- Conditions, Scoring, Negation and Groups. Full server-side pre-hydration implemented.
2. **Media Settings Form** (`/media-management/[databaseId]/media-settings/{arrType}/[name]` and `/new`): 3 sections -- Naming, Folder Management, Importing.

### Pages That Would Benefit from Progressive Disclosure

#### HIGH PRIORITY (Complex forms with many fields)

- **`/quality-profiles/[databaseId]/[id]/scoring`**: The scoring page is the most complex page in the app. It has profile-level score settings (Minimum Score, Upgrade Until Score, Upgrade Score Increment) as basic fields, plus an enormous custom format scoring table with search, sort, grouping, tiling, profiles, and custom groups. The action bar controls (Sort, Grouping, Tiling, Settings, Profiles) could be wrapped in an advanced toolbar section, or the profile-level score settings could be the basic view and the custom format table could be the advanced view.
  - Candidate keys: `quality-profiles:scoring:profile-settings` (basic score thresholds), `quality-profiles:scoring:display-options` (grouping/tiling/profiles toolbar)

- **`/quality-profiles/[databaseId]/[id]/qualities`**: The qualities page has drag-and-drop reordering, grouping (Ctrl+drag), and upgrade-until flags. The grouping mode toggle and info about Ctrl+drag could be hidden in an advanced section. The core "enable/disable and reorder" is the basic workflow; "create groups via drag" and "group management" are advanced.
  - Candidate keys: `quality-profiles:qualities:grouping-controls`

- **`/arr/[id]/sync`**: The sync configuration page has 4 major sections (Media Management, Quality Profiles, Delay Profiles, Metadata Profiles), each with their own profile selections, sync trigger configuration (manual/schedule/on-pull/on-change), cron expressions, and preview/sync buttons. The section-level sync trigger and cron configuration could be hidden behind advanced controls, with the basic view showing just profile selection.
  - Candidate keys: `arr:sync:media-management-schedule`, `arr:sync:quality-profiles-schedule`, `arr:sync:delay-profiles-schedule`, `arr:sync:metadata-profiles-schedule`

- **`/arr/[id]/settings` (InstanceForm)**: The instance form has Type, Name, Status, URL, External URL, API Key, Tags, Test Connection. External URL and Tags are secondary. API key reveal/copy is already somewhat progressive. The form could split basic (Name, URL, API Key, Type) from advanced (External URL, Tags, Status toggle, stored key management).
  - Candidate keys: `arr:settings:connection-advanced`

- **`/arr/new` (InstanceForm)**: Same form as above in create mode. Simpler since there is no stored key or delete/cleanup.
  - Candidate keys: Same as above -- `arr:settings:connection-advanced`

- **`/databases/[id]/config`**: The database config page has Name, Description, Version, Minimum Praxrr Version, Arr Types, Tags, License, Repository, Dependencies, and README. Version management, Dependencies, License, Repository, and Arr Types are advanced. Basic is Name, Description, and README.
  - Candidate keys: `databases:config:manifest-advanced`

- **`/custom-formats/[databaseId]/[id]/conditions`**: The conditions editor already has draft/confirmed condition separation. Individual condition cards have many fields (type, name, arr type, negate, required, patterns/sources/resolutions, etc.). While the page itself does not have a global advanced section, individual condition cards could benefit from progressive disclosure to hide less common condition types or advanced fields like negation and arr-type targeting.
  - Candidate keys: `custom-formats:conditions:card-advanced` (would need per-card or global toggle)

#### MEDIUM PRIORITY (Settings pages with multiple independent sections)

- **`/settings/general`**: This page already organizes settings into distinct cards (UI Preferences, Arr Instance Defaults, Backup Configuration, Logging, AI Configuration, TMDB Configuration). Each card is independently saveable. AI and TMDB settings are already somewhat progressive (AI only shows fields when enabled). Backup schedule/retention could be advanced; the enable/disable toggle is basic. Logging configuration details could be advanced.
  - Candidate keys: `settings:general:backup-advanced`, `settings:general:logging-advanced`, `settings:general:ai-advanced`, `settings:general:tmdb-advanced`

- **`/settings/security`**: Has Change Password, API Key, and Active Sessions sections. The sessions table and API key management are moderately complex but logically separated already. Could benefit from collapsing the sessions table behind an advanced toggle.
  - Candidate keys: `settings:security:sessions-advanced`

- **`/settings/notifications/new` and `/settings/notifications/edit/[id]`**: The notification service form has Basic Settings (name, type), Discord Configuration (webhook URL, username, avatar, embed settings), and Notification Types (grouped by category with checkboxes). The notification type selection grid is long and could be an advanced section. Discord embed settings could be advanced.
  - Candidate keys: `settings:notifications:type-selection`, `settings:notifications:embed-config`

- **`/arr/[id]/upgrades`**: The upgrades page has Core Settings (enabled, dry run, schedule, filter mode) and Filter Settings. Core settings are basic; filter configuration is advanced.
  - Candidate keys: `arr:upgrades:filter-settings`

#### LOWER PRIORITY (Simpler forms or list pages)

- **`/delay-profiles/[databaseId]/[name]` and `/new`**: The delay profile form has name, preferred protocol, usenet delay, torrent delay, bypass conditions, and minimum CF score. This is a moderate-complexity form. The bypass conditions and minimum CF score could be advanced.
  - Candidate keys: `delay-profiles:edit:bypass-settings`

- **`/metadata-profiles/[databaseId]/[name]` and `/new`**: The metadata profile form has name, description, primary types, secondary types, and release statuses. The type/status selections could be collapsed.
  - Candidate keys: `metadata-profiles:edit:type-selection`

- **`/regular-expressions/[databaseId]/[id]` and `/new`**: Simple form (name, tags, pattern, description, regex101 ID). The regex101 ID and tags are minor fields. Likely too simple for progressive disclosure.

- **`/quality-profiles/[databaseId]/[id]/general`**: Simple form (name, description, tags, language). Likely too simple for progressive disclosure unless language selection is considered advanced.

- **`/quality-profiles/[databaseId]/new`**: Same as above.

- **`/databases/[id]/settings`**: Database instance settings form. Depends on complexity of the database InstanceForm.

- **`/databases/new/*`**: Database creation wizards. These are step-by-step flows that are already progressive by nature.

- **`/media-management/[databaseId]/naming/*` and `/quality-definitions/*`**: These sub-pages under media management may have their own form complexity worth evaluating individually.

#### NOT CANDIDATES (List pages, read-only pages, simple pages)

- `/custom-formats/[databaseId]` (list page)
- `/quality-profiles/[databaseId]` (list page)
- `/delay-profiles/[databaseId]` (list page)
- `/metadata-profiles/[databaseId]` (list page)
- `/regular-expressions/[databaseId]` (list page)
- `/databases` (list page)
- `/databases/[id]` (dashboard/overview)
- `/databases/[id]/changes` (read-only)
- `/databases/[id]/commits` (read-only)
- `/databases/[id]/conflicts` (read-only)
- `/databases/[id]/tweaks` (read-only)
- `/arr` (list page)
- `/arr/[id]/library` (read-only)
- `/arr/[id]/logs` (read-only)
- `/arr/[id]/rename` (action page)
- `/arr/upgrades/info` (read-only)
- `/settings/backups` (list page)
- `/settings/jobs` (list page)
- `/settings/logs` (read-only)
- `/settings/about` (read-only)
- `/settings/notifications` (list page)
- `/auth/login` and `/auth/setup` (auth flows)
- `/databases/trash/*` (read-only TRaSH guide views)
- `/dev/components` (development page)

### Patterns to Follow

- **AdvancedSection Component Pattern**: The `AdvancedSection.svelte` component accepts a `sectionId`, `sectionTitle`, `sectionHint`, and `mode` prop (bindable). The default slot renders always-visible "basic" content, the `advanced` named slot renders when mode is `advanced`. The component handles ARIA, toggle button text, and panel visibility. Consumers bind `mode` and connect it to the preference store.

- **Store Subscription Pattern (Custom Formats GeneralForm)**: The established pattern for connecting `AdvancedSection` to the preference store involves: (1) calling `getUserInterfacePreferenceSectionStore(key)` for each section, (2) subscribing to `section.mode` and syncing to a local reactive variable, (3) using reactive statements to detect local changes and push them back to the store via `section.mode.set()`, (4) cleaning up subscriptions and calling `section.cleanup()` in `onDestroy`. This pattern is verbose (~30 lines of boilerplate per section) and is a key candidate for simplification.

- **Server-Side Pre-Hydration Pattern (Custom Formats +page.server.ts)**: The `+page.server.ts` loader reads UI preferences for the authenticated user and passes them as page data (`customFormatSectionModes`). The Svelte component uses these server-provided modes as initial values until client-side hydration completes, preventing flash-of-incorrect-state.

- **Section Key Naming Convention**: `route-family:route-section:ui-section` where each segment is lowercase alphanumeric with hyphens. Examples: `custom-formats:general:conditions`, `media-management:media-settings:naming`.

### Components to Leverage

- **`AdvancedSection.svelte`** (`/packages/praxrr-app/src/lib/client/ui/form/AdvancedSection.svelte`): The reusable visual container. Already supports slotted basic and advanced content, ARIA attributes, and configurable labels.
- **`userInterfacePreferences` store** (`/packages/praxrr-app/src/lib/client/stores/userInterfacePreferences.ts`): Singleton preference store with per-section substores, debounced persistence, retry, and auth handling.
- **`getUserInterfacePreferenceSectionStore()`**: Factory function to get or create a section-specific preference store.
- **`StickyCard`** (`/packages/praxrr-app/src/lib/client/ui/card/StickyCard.svelte`): Used for page headers with action buttons. Progressive disclosure toggles should be placed within or near these action bars for consistency.
- **`ActionsBar`** (`/packages/praxrr-app/src/lib/client/ui/actions/ActionsBar.svelte`): Shared action container used within `AdvancedSection` for the toggle button.

### Boilerplate Reduction Opportunity

The current pattern for wiring `AdvancedSection` to the preference store requires ~30 lines of boilerplate per section (subscribe, sync local variable, detect changes, push back, cleanup). With potentially 15-20+ new sections, this is a significant concern. Consider:

1. A helper Svelte component or action that encapsulates the subscribe/sync/cleanup pattern.
2. A reactive helper function that returns a bindable mode variable connected to the store.
3. A Svelte component wrapper that combines `AdvancedSection` + store wiring into a single `<PersistentAdvancedSection sectionKey="..." ... />`.

## Success Criteria

- [ ] All HIGH PRIORITY pages have progressive disclosure implemented with appropriate section keys
- [ ] All MEDIUM PRIORITY pages have progressive disclosure where justified by form complexity
- [ ] Every new `AdvancedSection` has a deterministic section key following the `route-family:route-section:ui-section` format
- [ ] Every new section key is registered in a canonical key registry document
- [ ] Server-side pre-hydration is implemented for all pages with progressive disclosure to prevent flash-of-incorrect-state
- [ ] No regressions in existing progressive disclosure behavior on Custom Formats General and Media Settings forms
- [ ] E2E tests cover at least one new page's progressive disclosure behavior
- [ ] Boilerplate for connecting `AdvancedSection` to the preference store is reduced (helper component or action)
- [ ] Basic mode shows sufficient controls for a user to complete the primary task on each page
- [ ] Advanced mode reveals all controls without requiring navigation to a different page
- [ ] All toggle buttons use explicit "Show Advanced" / "Hide Advanced" text labels
- [ ] All sections start collapsed (`basic`) for users with no persisted preference

## Open Questions

- **Global "Expand All" toggle**: Should there be a per-page or global button to expand/collapse all advanced sections at once? This would be useful for power users who want to see everything. The current per-section model does not support this.
- **Section grouping**: Should related sections (e.g., all three sync schedule sections) be able to share a single preference key, or should they always be independent?
- **Boilerplate approach**: Should the store wiring be simplified via a wrapper component (`<PersistentAdvancedSection>`), a Svelte action, or a composable utility function? This is a developer-experience question that affects rollout velocity.
- **Scoring page complexity**: The scoring page has a unique structure with an action bar containing multiple dropdowns (Sort, Grouping, Tiling, Settings, Profiles). Should progressive disclosure wrap the entire action bar, or should individual features be toggled? The current `AdvancedSection` component is designed for form sections, not toolbar features.
- **Per-condition-card disclosure**: Should individual condition cards on the conditions editor page support progressive disclosure (hiding advanced fields per card), or is a global page-level toggle sufficient?
- **Migration from localStorage**: The scoring page currently stores several preferences in localStorage (grouping, tiling, hide-unscored, profiles). Should these be migrated to the server-backed `user_interface_preferences` system as part of this enhancement, or kept separate?

## Relevant Files

### Infrastructure (Existing)

- `/packages/praxrr-app/src/lib/client/ui/form/AdvancedSection.svelte`: Reusable UI component for progressive disclosure sections
- `/packages/praxrr-app/src/lib/client/stores/userInterfacePreferences.ts`: Client-side preference store with debounced server persistence
- `/packages/praxrr-app/src/lib/server/db/queries/user_interface_preferences.ts`: Server-side DB queries for preference CRUD
- `/packages/praxrr-app/src/lib/server/db/migrations/050_create_user_interface_preferences.ts`: DB migration for preferences table
- `/packages/praxrr-app/src/routes/api/v1/ui-preferences/+server.ts`: REST API endpoint for preference read/write
- `/packages/praxrr-app/src/tests/routes/uiPreferencesApi.test.ts`: Unit tests for the preferences API
- `/packages/praxrr-app/src/tests/e2e/specs/2.50-progressive-disclosure.spec.ts`: E2E tests for disclosure behavior

### Pages Currently Using Disclosure

- `/packages/praxrr-app/src/routes/custom-formats/[databaseId]/components/GeneralForm.svelte`: 3 sections (conditions, scoring, negation-and-groups)
- `/packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/general/+page.server.ts`: Server-side pre-hydration for custom format sections
- `/packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/components/MediaSettingsForm.svelte`: 3 sections (naming, folder-management, importing)

### High Priority Rollout Targets

- `/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/scoring/+page.svelte`: Complex scoring page (~1040 lines)
- `/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/qualities/+page.svelte`: Drag-and-drop quality ordering (~860 lines)
- `/packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte`: Multi-section sync configuration (~610 lines)
- `/packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte`: Arr instance settings form (~715 lines)
- `/packages/praxrr-app/src/routes/databases/[id]/config/+page.svelte`: Database manifest editor (~410 lines)

### Medium Priority Rollout Targets

- `/packages/praxrr-app/src/routes/settings/general/+page.svelte`: General settings aggregator
- `/packages/praxrr-app/src/routes/settings/general/components/BackupSettings.svelte`: Backup configuration
- `/packages/praxrr-app/src/routes/settings/general/components/AISettings.svelte`: AI configuration
- `/packages/praxrr-app/src/routes/settings/general/components/LoggingSettings.svelte`: Logging configuration
- `/packages/praxrr-app/src/routes/settings/security/+page.svelte`: Security settings with sessions table
- `/packages/praxrr-app/src/routes/settings/notifications/components/NotificationServiceForm.svelte`: Notification service editor
- `/packages/praxrr-app/src/routes/arr/[id]/upgrades/+page.svelte`: Upgrade configuration with filter settings

### Navigation Integration

- `/packages/praxrr-app/src/lib/client/ui/navigation/pageNav/groupItem.svelte`: Already calls `clearOnAuthChange()` on logout

## Other Docs

- `/docs/plans/progressive-disclosure/shared.md`: Original feature research with relevant files and patterns
- `/docs/plans/progressive-disclosure/requirements.md`: Acceptance criteria and canonical section key definitions
- `/docs/plans/progressive-disclosure/research-architecture.md`: Architecture research from initial implementation
- `/docs/plans/progressive-disclosure/research-patterns.md`: Pattern research from initial implementation
- `/docs/plans/progressive-disclosure/research-integration.md`: Integration research from initial implementation
- `/docs/plans/progressive-disclosure/parallel-plan.md`: Implementation plan from initial PR #164
