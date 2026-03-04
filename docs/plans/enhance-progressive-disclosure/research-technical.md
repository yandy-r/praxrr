# Technical Specifications: enhance-progressive-disclosure

## Executive Summary

The base progressive disclosure system from PR #164 is functional but limited to two form pages (Custom Formats General and Media Settings) with significant per-page boilerplate for store wiring. Enhancement requires three structural changes: (1) a higher-level wrapper component (`DisclosureSection`) that encapsulates the boilerplate store subscription, hydration sync, and cleanup lifecycle into a single component; (2) expansion of the `AdvancedSection` component to support CSS transitions, nested-slot flexibility, and icon-based disclosure affordances alongside the text-label pattern; and (3) identification and rollout of disclosure sections across all form-heavy pages in the application. The existing server-side persistence layer (DB table, API endpoint, store) is solid and needs no schema changes -- the work is almost entirely client-side component design and per-page integration.

## Architecture Design

### Component Diagram

```
userInterfacePreferencesStore (singleton, client)
  |
  +-- section(sectionKey) --> UserInterfaceSectionPreferenceStore
        |                        |
        |  hydrate (GET)         |  persist (PATCH)
        |        |               |        |
        v        v               v        v
  /api/v1/ui-preferences <---> user_interface_preferences (SQLite)
        |
        +-- per-user, per-section, per-mode persistence
        +-- rate limiting (8 writes / 30s per key)
        +-- optimistic concurrency via expected_updated_at

DisclosureSection (NEW - proposed wrapper)
  |
  +-- creates/subscribes/cleans up section store internally
  +-- passes mode to child AdvancedSection via bind:mode
  +-- eliminates 15-25 lines of boilerplate per section per page

AdvancedSection (EXISTING - at $ui/form/AdvancedSection.svelte)
  |
  +-- Renders basic slot (always visible)
  +-- Renders advanced slot (toggled by mode)
  +-- Toggle button with aria-expanded
  +-- No store awareness (dumb component, mode is a prop)
```

### Current Implementation (PR #164)

The PR delivered a complete vertical slice:

**Database Layer**

- Migration `050_create_user_interface_preferences` creates `user_interface_preferences` table with `user_id`, `section_key`, `mode`, `updated_at` columns
- Unique index on `(user_id, section_key)`, FK to `users(id)` with CASCADE delete
- Section key validated by regex `^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$`, max 96 chars

**Server Layer**

- `$db/queries/user_interface_preferences.ts`: CRUD queries with idempotent upsert
- `/api/v1/ui-preferences/+server.ts`: GET (read with strict/non-strict modes) and PATCH (write with optimistic concurrency, rate limiting at 8 req/30s per user+key)
- Server-side page loader hydration in `+page.server.ts` (Custom Formats General loads section modes on SSR)

**Client Store**

- `$stores/userInterfacePreferences.ts`: Singleton store factory with section-scoped sub-stores
- Each section store manages: mode (writable), persisted flag, isSyncing flag, updatedAt
- Debounced persistence (300ms), retry with exponential backoff (300/600/1200ms)
- Reference counting for cleanup, auth-change cache clearing

**UI Component**

- `$ui/form/AdvancedSection.svelte`: Stateless disclosure panel with basic/advanced slots
- Auto-generated section IDs, ARIA attributes, toggle button

**Integrated Pages**

- `custom-formats/[databaseId]/components/GeneralForm.svelte`: 3 sections (conditions, scoring, negation-and-groups)
- `media-management/[databaseId]/media-settings/components/MediaSettingsForm.svelte`: 3 sections (naming, folder-management, importing)

### Boilerplate Problem

Each section currently requires ~15-25 lines of per-page wiring:

1. Import `getUserInterfacePreferenceSectionStore` and `UiPreferenceMode`
2. Create the section store with key
3. Declare local mode variable + synced shadow variable
4. Subscribe to mode store, sync local variable on change
5. Reactive statement to detect local mode divergence and push to store
6. `onDestroy` to unsubscribe and cleanup

With 3 sections per page, this is 45-75 lines of repetitive code. Both existing consumer pages exhibit this pattern identically.

### New Components

- **`DisclosureSection`** (proposed: `$ui/form/DisclosureSection.svelte`): Higher-level wrapper that encapsulates the store subscription lifecycle. Accepts a `sectionKey` prop, internally creates/manages the section store, handles subscribe/unsubscribe/cleanup, and exposes the current mode to child content. This eliminates the boilerplate in consumer pages.

- **`CollapsibleCard`** (proposed: `$ui/card/CollapsibleCard.svelte`): A simpler disclosure variant for settings pages where the pattern is "card with header that can collapse/expand" rather than the basic/advanced split. Designed for the General Settings page where each settings card (Logging, Backup, AI, TMDB) could be independently collapsed.

### Integration Points

- **`AdvancedSection` <--> `DisclosureSection`**: `DisclosureSection` wraps `AdvancedSection`, providing it with the managed `mode` prop. Consumer pages use `DisclosureSection` directly and no longer touch the store API.
- **`+page.server.ts` loaders <--> `userInterfacePreferencesQueries`**: Server-side hydration pattern remains for SSR flicker prevention. Each page that uses disclosure sections loads initial modes from DB in its `load` function.
- **`groupItem.svelte` <--> `userInterfacePreferencesStore`**: Already integrated -- logout clears section cache via `clearOnAuthChange()`.
- **`alertStore` <--> persistence failures**: Auth-required signal from the store can trigger user-facing alerts when persistence fails due to session expiry.

## Component API Design

### DisclosureSection (NEW)

```svelte
<!-- Usage example -->
<DisclosureSection
  sectionKey="delay-profiles:general:bypass-conditions"
  sectionTitle="Bypass Conditions"
  sectionHint="Skip delay when special conditions are met."
  initialMode={serverSideMode}
  showAdvancedLabel="Show Bypass Options"
  hideAdvancedLabel="Hide Bypass Options"
>
  <!-- Basic content (always visible) -->
  <FormInput label="Name" name="name" value={name} />

  <!-- Advanced content (toggled) -->
  <div slot="advanced">
    <Toggle label="Bypass if Highest Quality" checked={bypass} />
  </div>
</DisclosureSection>
```

- **Props:**
  - `sectionKey: string` (required) -- canonical key, validated against regex
  - `sectionTitle: string` (default: `'Advanced settings'`)
  - `sectionHint: string` (default: `'These options are hidden by default and are optional.'`)
  - `initialMode: UiPreferenceMode` (default: `'basic'`) -- SSR-hydrated initial mode
  - `showAdvancedLabel: string` (default: `'Show Advanced'`)
  - `hideAdvancedLabel: string` (default: `'Hide Advanced'`)
- **Slots:**
  - default: basic content (always visible)
  - `advanced`: content shown only in advanced mode
- **Lifecycle:** Creates section store on init, subscribes to mode changes, calls `cleanup()` in `onDestroy`
- **Events:** None needed externally; mode changes are persisted automatically through the store

### AdvancedSection (EXISTING - enhancement)

Current component at `$ui/form/AdvancedSection.svelte` is already well-designed. Proposed enhancements:

- **Add `slide` transition** to the advanced panel for smooth expand/collapse animation (matches the existing `slide` usage in `$ui/navigation/pageNav/group.svelte`)
- **Add optional `icon` prop** for a chevron or custom icon next to the toggle button
- **Add `compact` prop** for reduced padding variant useful in dense settings pages
- Current `on:click` handler pattern is correct for Svelte 5 without runes (project convention)

### CollapsibleCard (NEW)

```svelte
<!-- Usage example in settings -->
<CollapsibleCard
  title="Logging Configuration"
  description="Configure how Praxrr handles application logs"
  defaultOpen={true}
>
  <LoggingSettings settings={data.logSettings} />
</CollapsibleCard>
```

- **Props:**
  - `title: string` (required)
  - `description: string` (optional)
  - `defaultOpen: boolean` (default: `true`)
  - `persistKey: string | null` (optional) -- if provided, uses disclosure store for persistence
- **Slots:**
  - default: card body content
  - `header-actions`: additional actions in the header (e.g., save button)
- **State:** Local boolean toggle, optionally persisted. Uses `slide` transition for body.

## State Management

### Disclosure Store (existing, no changes needed)

**Structure:**

```typescript
// Singleton instance
userInterfacePreferencesStore: {
  section(sectionKey, defaultMode?) -> UserInterfaceSectionPreferenceStore
  authRequired: Readable<boolean>
  clearAuthRequired(): void
  clearOnAuthChange(): void
}

// Per-section instance (created by section() factory)
UserInterfaceSectionPreferenceStore: {
  mode: Writable<UiPreferenceMode>      // 'basic' | 'advanced'
  persisted: Readable<boolean>           // whether server has acknowledged
  isSyncing: Readable<boolean>           // write in-flight
  updatedAt: Readable<string | null>     // last server ack timestamp
  refresh(): Promise<void>              // re-hydrate from server
  cleanup(): void                       // decrement refcount, release resources
}
```

**Persistence mechanism:**

- Client-side: Debounced (300ms) PATCH to `/api/v1/ui-preferences`
- Server-side: SQLite `user_interface_preferences` table, per-user per-section
- Hydration: GET on store creation, non-strict mode returns defaults for missing keys
- SSR: Page loaders read from DB directly via `userInterfacePreferencesQueries.getByUserIdAndSectionKey`

**Per-route scoping:**

- Section keys encode route family: `{route-family}:{route-section}:{ui-section}`
- Keys are globally unique per user; no additional route scoping needed
- Multiple pages within the same route family share the same preferences (e.g., `/custom-formats/1/5/general` and `/custom-formats/2/10/general` share `custom-formats:general:conditions`)

### Cache Invalidation

- Auth change (logout): `clearOnAuthChange()` clears all cached section states and timers
- In-memory `sectionStates` Map is the cache; entries are ref-counted and removed when refCount hits 0
- No localStorage involved; persistence is entirely server-side
- Stale reads are handled by optimistic concurrency: writes include `expected_updated_at`, server rejects conflicts with 409

## Codebase Changes

### Files to Create

- `/packages/praxrr-app/src/lib/client/ui/form/DisclosureSection.svelte`: Wrapper component that encapsulates section store lifecycle, eliminating per-page boilerplate. Composes `AdvancedSection` internally.
- `/packages/praxrr-app/src/lib/client/ui/card/CollapsibleCard.svelte`: Collapsible card variant for settings pages. Uses `slide` transition, optionally persists open/closed state.

### Files to Modify

**Component enhancements:**

- `/packages/praxrr-app/src/lib/client/ui/form/AdvancedSection.svelte`: Add `slide` transition to advanced panel, add optional `icon` and `compact` props. Current `hidden` attribute approach prevents animation; switch to `{#if}` with `transition:slide`.

**Existing consumer refactors (reduce boilerplate by switching to `DisclosureSection`):**

- `/packages/praxrr-app/src/routes/custom-formats/[databaseId]/components/GeneralForm.svelte`: Replace 3x manual store wiring + `AdvancedSection` usage with 3x `DisclosureSection`.
- `/packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/components/MediaSettingsForm.svelte`: Replace 3x manual store wiring with 3x `DisclosureSection`.

**New disclosure section rollout (priority order):**

1. `/packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte`: Split into basic (Name, Type, URL, API Key) and advanced (External URL, Tags, Status toggle). Section key: `arr:settings:connection-details`.
2. `/packages/praxrr-app/src/routes/delay-profiles/[databaseId]/components/DelayProfileForm.svelte`: Wrap "Bypass Conditions" section. Section key: `delay-profiles:general:bypass-conditions`.
3. `/packages/praxrr-app/src/routes/settings/notifications/components/NotificationServiceForm.svelte`: Wrap "Notification Types" section. Section key: `settings:notifications:event-types`.
4. `/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/components/GeneralForm.svelte`: Wrap Description, Tags, Language fields. Section key: `quality-profiles:general:metadata`.
5. `/packages/praxrr-app/src/routes/regular-expressions/[databaseId]/components/RegularExpressionForm.svelte`: Wrap Description and Tags fields. Section key: `regular-expressions:general:metadata`.
6. `/packages/praxrr-app/src/routes/settings/general/+page.svelte`: Wrap lower-priority settings cards (AI, TMDB, Logging) with `CollapsibleCard` for visual density reduction.
7. `/packages/praxrr-app/src/routes/settings/security/+page.svelte`: Wrap "Active Sessions" section with `CollapsibleCard`. Section key: `settings:security:sessions`.
8. `/packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte`: Already uses section-based layout; evaluate wrapping each sync section (Quality Profiles, Delay Profiles, Media Management, Metadata Profiles) in `CollapsibleCard` for long-page navigation aid.

**Server-side hydration additions:**

- Each `+page.server.ts` that adds disclosure sections needs to load initial modes from `userInterfacePreferencesQueries` and pass them as page data (matching the pattern in `/routes/custom-formats/[databaseId]/[id]/general/+page.server.ts`).

### Proposed Canonical Section Keys (new)

Following the established `{route-family}:{route-section}:{ui-section}` format:

| Section Key                                | Owner Page                      |
| ------------------------------------------ | ------------------------------- |
| `arr:settings:connection-details`          | Arr InstanceForm                |
| `delay-profiles:general:bypass-conditions` | DelayProfileForm                |
| `settings:notifications:event-types`       | NotificationServiceForm         |
| `quality-profiles:general:metadata`        | Quality Profile GeneralForm     |
| `regular-expressions:general:metadata`     | RegularExpressionForm           |
| `settings:security:sessions`               | Security page                   |
| `settings:general:logging`                 | General Settings - Logging card |
| `settings:general:ai`                      | General Settings - AI card      |
| `settings:general:tmdb`                    | General Settings - TMDB card    |
| `settings:general:backup`                  | General Settings - Backup card  |

## Technical Decisions

### Decision 1: Wrapper Component vs. Svelte Action

- **Options:**
  - A: `DisclosureSection` wrapper component (compose around `AdvancedSection`)
  - B: Svelte action/use directive that attaches store behavior to existing elements
  - C: Keep current manual wiring pattern
- **Recommendation:** Option A
- **Rationale:** A wrapper component is the most natural Svelte composition pattern. It encapsulates lifecycle (subscribe/cleanup), avoids action-based DOM manipulation complexity, and follows the existing component-composition patterns seen throughout `$ui/`. Option C is untenable at scale -- the two existing consumer pages already have 45+ lines of identical boilerplate each.

### Decision 2: Animation Approach

- **Options:**
  - A: Svelte `transition:slide` (used by `group.svelte` in sidebar nav already)
  - B: CSS `max-height` transition
  - C: No animation (current: `hidden` attribute toggle)
- **Recommendation:** Option A
- **Rationale:** `svelte/transition` `slide` is already used in the codebase (`$ui/navigation/pageNav/group.svelte`), handles dynamic content height automatically, and is performant. CSS `max-height` requires an arbitrary max value and can look janky. Current `hidden` attribute provides no visual feedback on toggle.

### Decision 3: CollapsibleCard for Settings vs. AdvancedSection

- **Options:**
  - A: Use `AdvancedSection` everywhere including settings pages
  - B: Separate `CollapsibleCard` for settings, `AdvancedSection` for form-level disclosure
- **Recommendation:** Option B
- **Rationale:** Settings pages use a different visual pattern -- they are self-contained cards with headers, not inline form sections with basic/advanced splits. The `AdvancedSection` component has a two-panel design (basic always visible, advanced toggled) that does not fit the "collapse entire card" settings pattern. A `CollapsibleCard` is semantically different: it collapses the entire body, not a secondary advanced panel.

### Decision 4: Server-Side Hydration vs. Client-Only Hydration

- **Options:**
  - A: Load initial modes in `+page.server.ts` and pass as page data (current pattern)
  - B: Let client store hydrate entirely via API on mount (no SSR awareness)
- **Recommendation:** Option A
- **Rationale:** SSR hydration prevents the flash-of-basic-then-switch-to-advanced flicker. The current pattern in Custom Formats General demonstrates this correctly. However, for `CollapsibleCard` sections that are purely visual (no form-field implications), client-only hydration (Option B) is acceptable because there is no content shift, just a card expanding.

### Decision 5: Transition from `on:click` to `onclick`

- **Options:**
  - A: Keep `on:click` in existing and new components
  - B: Migrate to `onclick` throughout
- **Recommendation:** Option A (keep `on:click`)
- **Rationale:** CLAUDE.md explicitly states "Svelte 5, no runes. Use `onclick` handlers, not `$state`/`$derived`." However, the existing `AdvancedSection.svelte` uses `on:click` (Svelte 4 event syntax), and all consumer pages follow the same pattern. The instruction appears to be about preferring `onclick` for _new_ attribute-based handlers (like `onclick={handler}`) but the existing codebase overwhelmingly uses `on:click` dispatch syntax for component events. New components should use `on:click` for consistency with existing code, and use `onclick` only for native DOM element handlers where the codebase already does so.

## Edgecases

- The `AdvancedSection` component currently uses `hidden` attribute for panel visibility, which is incompatible with CSS/Svelte transitions. Switching to `{#if}` block with `transition:slide` will change behavior: `hidden` keeps DOM elements mounted (preserving form state), while `{#if}` destroys and recreates them. For sections containing form inputs, the wrapper must ensure form values are preserved in parent state (which is already the pattern -- all form state lives in the `dirty` store or parent component variables, not in DOM).

- The auto-incrementing `autoSectionCounter` in `AdvancedSection` module script is SSR-safe because module-level `<script context="module">` runs once per import context, but the counter value will differ between server and client hydration. This is currently harmless since the IDs are only used for `aria-controls`/`aria-labelledby` attributes and are only referenced within the same component instance. However, if `sectionId` is always provided by `DisclosureSection` (which it will be), the auto-counter becomes dead code.

- Section keys must match the pattern `^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$`. This means keys like `arr:settings:connection-details` are valid but `arr-instance:settings:connection` is also valid. The key format does not encode database IDs or entity IDs, so preferences are shared across all entities within a route family. This is intentional: a user who prefers "advanced" mode for custom format conditions wants it everywhere, not per-format.

- Rate limiting (8 writes per 30 seconds per user+key) is per-server-process, stored in an in-memory `Map`. In the current single-process deployment this is fine, but would not work correctly if the app were horizontally scaled.

- The `clearOnAuthChange()` method is called from `groupItem.svelte` on logout navigation. If a user logs out and another user logs in without a full page reload, cached section states from the previous user are properly cleared.

- When `AUTH=off` (development mode), `locals.user` is null and all preference reads return defaults. Writes return 401. This means disclosure preferences are not persisted in dev-no-auth mode; sections always reset to basic on page load.

## Open Questions

- Should `CollapsibleCard` open/closed state be persisted server-side (via the same `user_interface_preferences` table) or client-only (localStorage)? Settings page cards do not affect form field visibility, so client-only persistence may be sufficient. However, using the same server-side mechanism keeps the pattern uniform.

- Should there be a global "Show All Advanced" toggle that expands all disclosure sections on a page simultaneously? This would be useful for power users who always want everything visible. If implemented, it should be a page-level action in `StickyCard` header actions, scoped per route family.

- For the sync configuration page (`/arr/[id]/sync`), each sync section is already quite large. Would `CollapsibleCard` actually improve UX, or would it make sections harder to find? This needs UX review before implementation.

## Relevant Files

- `/packages/praxrr-app/src/lib/client/ui/form/AdvancedSection.svelte`: Existing disclosure panel component (stateless, mode via prop)
- `/packages/praxrr-app/src/lib/client/stores/userInterfacePreferences.ts`: Singleton store factory with section-scoped sub-stores, debounced persistence, retry logic
- `/packages/praxrr-app/src/routes/api/v1/ui-preferences/+server.ts`: REST API for reading/writing preferences (GET/PATCH)
- `/packages/praxrr-app/src/lib/server/db/queries/user_interface_preferences.ts`: Database CRUD for preference records
- `/packages/praxrr-app/src/lib/server/db/migrations/050_create_user_interface_preferences.ts`: Schema migration for preferences table
- `/packages/praxrr-app/src/routes/custom-formats/[databaseId]/components/GeneralForm.svelte`: Consumer with 3 disclosure sections + full boilerplate
- `/packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/components/MediaSettingsForm.svelte`: Consumer with 3 disclosure sections + full boilerplate
- `/packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/general/+page.server.ts`: SSR hydration pattern for section modes
- `/packages/praxrr-app/src/lib/client/ui/navigation/pageNav/groupItem.svelte`: Calls `clearOnAuthChange()` on logout
- `/packages/praxrr-app/src/lib/client/ui/navigation/pageNav/group.svelte`: Existing `slide` transition usage pattern
- `/packages/praxrr-app/src/lib/client/stores/dirty.ts`: Form dirty tracking pattern (important for understanding form state lifecycle)
- `/packages/praxrr-app/src/lib/client/ui/card/StickyCard.svelte`: Sticky header component used by all form pages
- `/packages/praxrr-app/src/lib/client/ui/actions/ActionsBar.svelte`: Grouped action button container used by AdvancedSection
- `/packages/praxrr-app/src/tests/routes/uiPreferencesApi.test.ts`: Comprehensive test suite for preference API

## Other Docs

- `/docs/plans/progressive-disclosure/requirements.md`: Original acceptance criteria and section-key format specification
- `/docs/plans/progressive-disclosure/shared.md`: Original feature research and integration point analysis
- `/docs/plans/progressive-disclosure/research-architecture.md`: Architecture research from PR #164 implementation
- `/docs/plans/progressive-disclosure/custom-formats-rollout-notes.md`: Rollout notes for Custom Formats integration
- `/docs/plans/progressive-disclosure/media-management-rollout-notes.md`: Rollout notes for Media Settings integration
