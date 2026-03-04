# Shared Context: enhance-progressive-disclosure

## Overview

Enhance the progressive disclosure system from PR #164 by: (1) creating a `DisclosureSection` wrapper component that eliminates ~60-80 lines of per-page store wiring boilerplate, (2) adding `transition:slide` animations to `AdvancedSection`, (3) creating a `CollapsibleCard` for settings pages, (4) establishing a section key registry, and (5) rolling out disclosure across all form-heavy pages. Zero new dependencies required - entirely client-side component design and per-page integration work.

## Existing Infrastructure (from PR #164)

### Database Layer

**Table:** `user_interface_preferences` (migration 050)

| Column      | Type     | Constraints                              |
| ----------- | -------- | ---------------------------------------- |
| user_id     | INTEGER  | FK users(id) ON DELETE CASCADE           |
| section_key | TEXT     | NOT NULL, CHECK length 1-96              |
| mode        | TEXT     | NOT NULL, CHECK IN ('basic', 'advanced') |
| updated_at  | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP      |

**Indexes:**

- `idx_user_interface_preferences_user_section` UNIQUE on (user_id, section_key)
- `idx_user_interface_preferences_user_id` on (user_id)

**Queries file:** `$db/queries/user_interface_preferences.ts` (121 lines)

- `isValidSectionKey(sectionKey)` - regex `^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$`, max 96 chars
- `getByUserIdAndSectionKey(userId, sectionKey)` - single row
- `getByUserId(userId)` - all prefs for user
- `upsert(input)` - idempotent: no-op if mode unchanged

### API Endpoint

**File:** `routes/api/v1/ui-preferences/+server.ts` (315 lines)

- `GET ?section_key={key}&strict={true|false}` - strict=false returns synthetic default (`mode: 'basic'`, `persisted: false`)
- `PATCH { section_key, mode, expected_updated_at? }` - optimistic concurrency, rate limited 8 writes/30s per user+key
- Error codes: 400, 401, 404, 409, 429, 500

### Client Store

**File:** `$stores/userInterfacePreferences.ts` (451 lines)

```typescript
// Public API
export type UiPreferenceMode = 'basic' | 'advanced';

export interface UserInterfaceSectionPreferenceStore {
  readonly mode: Writable<UiPreferenceMode>;
  readonly persisted: Readable<boolean>;
  readonly isSyncing: Readable<boolean>;
  readonly updatedAt: Readable<string | null>;
  readonly refresh: () => Promise<void>;
  readonly cleanup: () => void;
}

export interface UserInterfacePreferenceStore {
  section: (
    sectionKey: string,
    defaultMode?: UiPreferenceMode
  ) => UserInterfaceSectionPreferenceStore;
  authRequired: Readable<boolean>;
  clearAuthRequired: () => void;
  clearOnAuthChange: () => void;
}

export const userInterfacePreferencesStore: UserInterfacePreferenceStore;
export const getUserInterfacePreferenceSectionStore: (
  sectionKey: string,
  defaultMode?: UiPreferenceMode
) => UserInterfaceSectionPreferenceStore;
```

**Key behaviors:**

- Singleton `Map<string, SectionState>` cache per section key, ref-counted
- Hydration on first access: `GET /api/v1/ui-preferences?section_key=...&strict=false`
- Debounced persistence (300ms) via PATCH
- Retry on 5xx/network: delays `[300, 600, 1200]ms`, rollback to `lastAckMode` if all fail
- Auth-required: on 401, sets `authRequired` store, clears all cache
- `clearOnAuthChange()`: purges all section states and timers (called from logout nav)
- `cleanup()`: decrements refCount, removes entry when zero

### AdvancedSection Component

**File:** `$ui/form/AdvancedSection.svelte` (82 lines)

**Props:**

- `sectionId: string = ''` - falls back to auto-counter `advanced-section-{N}`
- `sectionTitle = 'Advanced settings'`
- `sectionHint = 'These options are hidden by default and are optional.'`
- `showAdvancedLabel = 'Show Advanced'`
- `hideAdvancedLabel = 'Hide Advanced'`
- `mode: 'basic' | 'advanced' = 'basic'` - **two-way bindable**

**Slots:**

- Default (unnamed): always-visible basic content, rendered in bordered card
- `advanced`: toggled content, hidden via `hidden={!isAdvanced}` attribute

**Toggle:** `toggleMode()` mutates `mode` directly, flows back to parent via `bind:mode`

**Accessibility:** `aria-expanded`, `aria-controls`, `role="region"`, `aria-labelledby`

**Animation:** NONE - uses `hidden` attribute (instant show/hide)

**Svelte patterns:** Svelte 4 throughout - `export let`, `$:` reactives, `on:click`

### Existing Consumers

#### GeneralForm.svelte (Custom Formats) - 3 sections, ~65 lines boilerplate

**File:** `routes/custom-formats/[databaseId]/components/GeneralForm.svelte` (401 lines)

Section keys: `custom-formats:general:conditions`, `custom-formats:general:scoring`, `custom-formats:general:negation-and-groups`

**Boilerplate pattern (repeated per section):**

1. `getUserInterfacePreferenceSectionStore(key)` - store creation (3 lines)
2. `let mode` + `let modeSynced` - local variable pair (2 lines)
3. `.mode.subscribe()` - sync store->local with divergence check (5 lines)
4. `$: if (mode !== modeSynced)` - reactive write-back local->store (3 lines)
5. `onDestroy` - unsubscribe + cleanup (2 lines)

**SSR hydration:** YES - reads `$page.data.customFormatSectionModes`, one-shot `hasHydratedSectionModes` gate

**Notable:** Default slot of `AdvancedSection` is UNUSED - all content goes in `slot="advanced"`. Empty bordered card renders in DOM for each section.

#### MediaSettingsForm.svelte (Media Management) - 3 sections, ~55 lines boilerplate

**File:** `routes/media-management/[databaseId]/media-settings/components/MediaSettingsForm.svelte` (373 lines)

Section keys: `media-management:media-settings:naming`, `media-management:media-settings:folder-management`, `media-management:media-settings:importing`

**SSR hydration:** ABSENT - `+page.server.ts` does not load section modes. Inconsistency vs. GeneralForm.

### SSR Hydration Pattern

**File:** `routes/custom-formats/[databaseId]/[id]/general/+page.server.ts` (225 lines)

```typescript
// Step 1: Define key-to-field mapping
const sectionKeys = [
    ['custom-formats:general:conditions', 'conditions'],
    ['custom-formats:general:scoring', 'scoring'],
    ['custom-formats:general:negation-and-groups', 'negationAndGroups'],
] as const;

// Step 2: Initialize defaults
const sectionModes = { conditions: 'basic', scoring: 'basic', negationAndGroups: 'basic' };

// Step 3: Load from DB if authenticated
if (locals.user) {
    for (const [sectionKey, modeKey] of sectionKeys) {
        const preference = userInterfacePreferencesQueries.getByUserIdAndSectionKey(
            locals.user.id, sectionKey
        );
        if (preference?.mode) {
            sectionModes[modeKey] = preference.mode;
        }
    }
}

// Step 4: Return in page data
return { ..., customFormatSectionModes: sectionModes };
```

### Existing Slide Transition Usage

**File:** `$ui/navigation/pageNav/group.svelte` (53 lines)

```svelte
import { slide } from 'svelte/transition';
{#if isOpen && hasItems}
  <div transition:slide={{ duration: 200 }}>...</div>
{/if}
```

Only usage of `svelte/transition` in the codebase. Uses `duration: 200` with default easing.

## Components to Create

### 1. DisclosureSection (`$ui/form/DisclosureSection.svelte`)

**Purpose:** Wrapper that encapsulates store lifecycle, eliminating per-page boilerplate.

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

**Props:**

- `sectionKey: string` (required) - validated against regex
- `sectionTitle: string` (default: `'Advanced settings'`)
- `sectionHint: string` (default: `'These options are hidden by default and are optional.'`)
- `initialMode: UiPreferenceMode` (default: `'basic'`) - SSR-hydrated
- `showAdvancedLabel: string` (default: `'Show Advanced'`)
- `hideAdvancedLabel: string` (default: `'Hide Advanced'`)

**Slots:** default (always visible), `advanced` (toggled)

**Lifecycle:** Creates section store on init, subscribes internally, calls `cleanup()` in `onDestroy`.

### 2. CollapsibleCard (`$ui/card/CollapsibleCard.svelte`)

**Purpose:** Collapse entire card body for settings pages (different pattern from basic/advanced split).

```svelte
<CollapsibleCard
  title="Logging Configuration"
  description="Configure how Praxrr handles application logs"
  sectionKey="settings:general:logging"
>
  <LoggingSettings settings={data.logSettings} />
</CollapsibleCard>
```

**Props:**

- `title: string` (required)
- `description: string` (optional)
- `sectionKey: string` (optional) - if provided, persists via store
- `defaultOpen: boolean` (default: `true`)

### 3. Section Key Registry (`$shared/disclosure/sectionKeys.ts`)

**Purpose:** Canonical source of truth for all valid section keys. Prevents typos, enables autocomplete, supports "expand all" discovery.

## AdvancedSection Enhancement

**Changes needed:**

1. Replace `hidden={!isAdvanced}` with `{#if}` + `transition:slide` (200ms, `quintOut`)
2. Add `ChevronDown` icon from `lucide-svelte` with `rotate-180` CSS transition (200ms)
3. Respect `prefers-reduced-motion` (duration: 0)
4. Use `onclick` for native DOM handlers per project convention

**Animation specs:**

| Animation        | Duration | Easing     | Method             |
| ---------------- | -------- | ---------- | ------------------ |
| Section expand   | 200ms    | `quintOut` | `transition:slide` |
| Section collapse | 200ms    | `quintOut` | `transition:slide` |
| Chevron rotation | 200ms    | `ease`     | CSS transition     |
| Reduced motion   | 0ms      | none       | Instant show/hide  |

## Section Keys

### Existing (PR #164)

| Section Key                                         | Page                       |
| --------------------------------------------------- | -------------------------- |
| `custom-formats:general:conditions`                 | Custom Formats GeneralForm |
| `custom-formats:general:scoring`                    | Custom Formats GeneralForm |
| `custom-formats:general:negation-and-groups`        | Custom Formats GeneralForm |
| `media-management:media-settings:naming`            | Media Settings Form        |
| `media-management:media-settings:folder-management` | Media Settings Form        |
| `media-management:media-settings:importing`         | Media Settings Form        |

### New - High Priority

| Section Key                                | Page                    | Basic Fields                     | Advanced Fields                        |
| ------------------------------------------ | ----------------------- | -------------------------------- | -------------------------------------- |
| `arr:settings:connection-details`          | Arr InstanceForm        | Type, Name, Status, URL, API Key | External URL, Tags                     |
| `delay-profiles:general:bypass-conditions` | DelayProfileForm        | Name, Protocol, Delays           | Bypass Conditions                      |
| `settings:notifications:event-types`       | NotificationServiceForm | Type, Name, Service Config       | Notification Types grid                |
| `quality-profiles:general:metadata`        | QP GeneralForm          | Name                             | Description, Tags, Language            |
| `databases:config:manifest-advanced`       | Database Config         | Name, Desc, Version, Arr Types   | Min Version, Tags, License, Repo, Deps |

### New - Medium Priority

| Section Key                                | Page                    |
| ------------------------------------------ | ----------------------- |
| `settings:general:logging`                 | General Settings        |
| `settings:general:ai`                      | General Settings        |
| `settings:general:tmdb`                    | General Settings        |
| `settings:general:backup`                  | General Settings        |
| `settings:security:sessions`               | Security page           |
| `arr:upgrades:filter-settings`             | Arr Upgrades            |
| `regular-expressions:general:metadata`     | Regular Expression Form |
| `metadata-profiles:general:type-selection` | Metadata Profile Form   |

## Rollout Target Analysis

### 1. Arr InstanceForm (716 lines)

**File:** `routes/arr/components/InstanceForm.svelte`

- Single card, all fields in one `div.space-y-4`
- Basic: Type, Name+Status, URL, API Key + Test Connection
- Advanced: External URL, Tags
- Clean add - no existing store wiring
- Parent `+page.server.ts` files need hydration addition
- Has conditional rendering (`{#if enabled === 'false'}` warning) - stays in basic

### 2. DelayProfileForm (356 lines)

**File:** `routes/delay-profiles/[databaseId]/components/DelayProfileForm.svelte`

- Single `Card` with `space-y-6`
- Basic: Name, Protocol Preference (4 radio Toggles), Delays (Usenet/Torrent)
- Advanced: Bypass Conditions (two toggles + minimumCfScore input)
- Clean add - no existing store wiring
- Hidden form inputs (lines 180-186) always rendered outside toggle area - `{#if}` safe
- Conditional `disabled` states inside advanced slot stay as-is

### 3. NotificationServiceForm (199 lines)

**File:** `routes/settings/notifications/components/NotificationServiceForm.svelte`

- 3 separate bordered cards in `<form>`
- Basic: Service Type + Name + Service Configuration (Discord)
- Advanced: Notification Types card (category-grouped checkboxes)
- **CAUTION:** `enabledTypesState` managed via component `let` + hidden `<input>` elements inside toggled block. Collapsing with `{#if}` would remove hidden inputs, losing form data. Must keep hidden inputs rendered separately or use `hidden` attribute instead of `{#if}`.
- No StickyCard, no dirty store - uses inline submit

### 4. QP GeneralForm (354 lines)

**File:** `routes/quality-profiles/[databaseId]/components/GeneralForm.svelte`

- `space-y-6` form, no outer card
- Basic: Name (FormInput)
- Advanced: Description (MarkdownInput), Tags (TagInput), Language (conditional autocomplete)
- Hidden fields (description, tags, language, layer) always rendered above display section - `{#if}` safe
- Language already conditionally rendered `{#if availableLanguages.length > 0}`

### 5. Database Config (413 lines)

**File:** `routes/databases/[id]/config/+page.svelte`

- Single `div.space-y-5` inside card
- Basic: Name, Description, Version, Arr Types, README
- Advanced: Min Praxrr Version, Tags, License, Repository, Dependencies
- **Requires field reordering** so basic fields are contiguous before advanced split
- Conditional error block for `schemaDependencyError` stays adjacent to Dependencies in advanced

## Settings Page Patterns

### Card Anatomy (Settings Pages)

Settings pages use **inline cards** (NOT the `Card.svelte` component):

```html
<div
  class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
>
  <div class="border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
    <h2>Title</h2>
    <p>Description</p>
  </div>
  <div class="p-6"><!-- content --></div>
</div>
```

Note: Uses `rounded-lg` + `border-neutral-200`, different from `Card.svelte` which uses `rounded-xl` + `border-neutral-300`.

### General Settings (`settings/general/+page.svelte`)

- Pure composition: passes `data` props to sub-components
- Layout: `div.p-4.md:p-8` > heading > `div.space-y-8` of cards
- Each card is self-contained (own form, dirty tracking, save button)
- Cards: UISettings, ArrDefaultsSettings, BackupSettings, LoggingSettings, AISettings, TMDBSettings
- No StickyCard, no AdvancedSection, no disclosure store

### Security Settings (`settings/security/+page.svelte`)

- Same layout as general: heading + `div.space-y-8` of inline cards
- Cards are inline (not sub-components)
- "Active Sessions" card has action button in header (Revoke Others)
- No global dirty tracking - uses `enhance` with local loading state

### Arr Upgrades (`arr/[id]/upgrades/+page.svelte`)

- Uses `StickyCard` as page header with actions (Reset, Test, Save)
- Uses global dirty store: `initEdit` on mount, `clear()` on cleanup
- Content: `div.mt-6.space-y-6` with `<section>` elements headed by `<h2>` + Lucide icon
- Sections: Settings (CoreSettings), Filters (FilterSettings), Run History (RunHistory)
- No AdvancedSection usage currently

## Key Component Patterns

### StickyCard

**File:** `$ui/card/StickyCard.svelte`

- Uses `IntersectionObserver` for sticky detection
- Props: `position: 'top' | 'bottom'`, `variant: 'default' | 'transparent' | 'blur'`
- Two named slots: `left` (title area), `right` (action buttons)
- Sticky via `sticky z-10` with negative horizontal margins for full-width bleed

### ActionsBar

**File:** `$ui/actions/ActionsBar.svelte`

- Thin layout wrapper grouping action buttons into visually unified bar
- CSS `:global()` selectors create pill-shaped grouped button appearance
- Used inside `AdvancedSection` for toggle button

### Dirty Store

**File:** `$stores/dirty.ts`

- Singleton with `originalSnapshot`, `currentData`, `isNewMode`, `showWarningModal`
- `isDirty` = `isNewMode || !deepEquals(original, current)`
- API: `initEdit()`, `initCreate()`, `update()`, `resetFromServer()`, `clear()`
- Navigation guard via `confirmNavigation()` + `DirtyModal`
- Form state lives in store, NOT in DOM - `{#if}` destruction is safe for most forms

## Critical Design Decisions

### 1. `{#if}` vs `hidden` for Advanced Content

**Decision:** Use `{#if}` + `transition:slide` as default (enables animation, form state in dirty store).

**Exception:** `NotificationServiceForm` uses hidden `<input>` elements inside the toggled block. For this form, either:

- Move hidden inputs outside the `{#if}` block, OR
- Use `hidden` attribute instead of `{#if}` for this specific form

### 2. Wrapper Component (DisclosureSection) vs Direct Refactor (AdvancedSection)

**Decision:** Create `DisclosureSection` as a NEW wrapper around `AdvancedSection`.

**Rationale:** `AdvancedSection` is a dumb presentational component. Adding store awareness to it violates separation of concerns and breaks backward compatibility for any consumer not using persistence. `DisclosureSection` composes `AdvancedSection` internally.

### 3. SSR Hydration Strategy

**Decision:** Create a DRY utility function for `+page.server.ts` loaders.

```typescript
// Proposed utility
function loadSectionModes(
  userId: number | undefined,
  sectionKeys: string[]
): Record<string, UiPreferenceMode>;
```

Apply to all pages with disclosure sections. Currently only Custom Formats General has SSR hydration.

### 4. Settings Pages Use CollapsibleCard (Not AdvancedSection)

**Decision:** Separate `CollapsibleCard` component for settings pages.

**Rationale:** Settings pages collapse entire card bodies (not basic/advanced split). Different visual pattern from `AdvancedSection`'s two-panel design. Settings cards are self-contained with own forms.

## Phasing Strategy

### Phase 1: Foundation

- Create section key registry (`$shared/disclosure/sectionKeys.ts`)
- Create `DisclosureSection` wrapper component
- Enhance `AdvancedSection`: `transition:slide`, chevron icon, `prefers-reduced-motion`
- Migrate GeneralForm consumer to `DisclosureSection` (~65 lines removed)
- Migrate MediaSettingsForm consumer to `DisclosureSection` (~55 lines removed)
- Create `CollapsibleCard` component
- Create SSR hydration utility function

**Parallelization:** Section key registry, DisclosureSection+CollapsibleCard creation, and AdvancedSection enhancement can run in parallel.

### Phase 2: Core Rollout

Dependencies: Phase 1 complete.

- **Group A - Entity Forms:** QP general, delay profiles, notifications, regex, metadata profiles
- **Group B - Complex Pages:** Arr instance settings, database config
- **Group C - Settings Pages:** General settings cards (CollapsibleCard), security page
- **Group D - Remaining:** Arr upgrades filter settings

**Parallelization:** Groups A, B, C, D can run in parallel.

### Phase 3: Polish

Dependencies: Phase 2 mostly complete.

- "Expand all / Collapse all" controls
- Hidden content hints
- Deep linking via URL hash
- E2E test coverage for new disclosure pages

## Files to Create

| File                                | Purpose                                           |
| ----------------------------------- | ------------------------------------------------- |
| `$ui/form/DisclosureSection.svelte` | Store lifecycle wrapper, composes AdvancedSection |
| `$ui/card/CollapsibleCard.svelte`   | Collapsible card for settings pages               |
| `$shared/disclosure/sectionKeys.ts` | Section key constants and helpers                 |

## Files to Modify

### Component Enhancements

| File                              | Changes                                                        |
| --------------------------------- | -------------------------------------------------------------- |
| `$ui/form/AdvancedSection.svelte` | Add `transition:slide`, chevron icon, `prefers-reduced-motion` |

### Existing Consumer Migration (Phase 1)

| File                                                                                      | Changes                                                  |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `routes/custom-formats/[databaseId]/components/GeneralForm.svelte`                        | Replace ~65 lines store wiring with 3x DisclosureSection |
| `routes/media-management/[databaseId]/media-settings/components/MediaSettingsForm.svelte` | Replace ~55 lines store wiring with 3x DisclosureSection |

### New Disclosure Rollout (Phase 2, priority order)

| #   | File                                                                              | Section Key                                   |
| --- | --------------------------------------------------------------------------------- | --------------------------------------------- |
| 1   | `routes/arr/components/InstanceForm.svelte`                                       | `arr:settings:connection-details`             |
| 2   | `routes/delay-profiles/[databaseId]/components/DelayProfileForm.svelte`           | `delay-profiles:general:bypass-conditions`    |
| 3   | `routes/settings/notifications/components/NotificationServiceForm.svelte`         | `settings:notifications:event-types`          |
| 4   | `routes/quality-profiles/[databaseId]/components/GeneralForm.svelte`              | `quality-profiles:general:metadata`           |
| 5   | `routes/databases/[id]/config/+page.svelte`                                       | `databases:config:manifest-advanced`          |
| 6   | `routes/settings/general/+page.svelte`                                            | CollapsibleCard for AI, TMDB, Logging, Backup |
| 7   | `routes/settings/security/+page.svelte`                                           | `settings:security:sessions`                  |
| 8   | `routes/arr/[id]/upgrades/+page.svelte`                                           | `arr:upgrades:filter-settings`                |
| 9   | `routes/regular-expressions/[databaseId]/components/RegularExpressionForm.svelte` | `regular-expressions:general:metadata`        |
| 10  | `routes/metadata-profiles/[databaseId]/components/MetadataProfileForm.svelte`     | `metadata-profiles:general:type-selection`    |

### Server-Side Hydration Additions

Each `+page.server.ts` for pages with disclosure sections needs to load initial modes via the utility function.

## Pages NOT Candidates

List pages, read-only pages, auth flows, and dev pages do not benefit from progressive disclosure:

- All list/index pages
- Read-only pages (changes, commits, conflicts, logs, about)
- Auth flows (login, setup)
- Development pages (dev/components)

## Risk Mitigations

| Risk                                       | Mitigation                                                   |
| ------------------------------------------ | ------------------------------------------------------------ |
| Boilerplate explosion without refactor     | Phase 1 refactors before rollout                             |
| Section key collisions                     | Registry with typed constants                                |
| SSR hydration flicker                      | DRY utility + extend to all pages                            |
| `transition:slide` + `min-height` conflict | Avoid `min-h-*` inside transition boundary                   |
| Form state loss on `{#if}` toggle          | Dirty store owns form state, not DOM                         |
| NotificationServiceForm hidden inputs      | Keep inputs outside `{#if}` or use `hidden` attr             |
| Breaking existing consumers                | DisclosureSection wraps AdvancedSection; backward compatible |

## Related Research Documents

- `docs/plans/enhance-progressive-disclosure/feature-spec.md` - Full feature specification
- `docs/plans/enhance-progressive-disclosure/research-technical.md` - Architecture and component design
- `docs/plans/enhance-progressive-disclosure/research-ux.md` - UX patterns, accessibility, animation specs
- `docs/plans/enhance-progressive-disclosure/research-business.md` - User stories, page-by-page analysis
- `docs/plans/enhance-progressive-disclosure/research-recommendations.md` - Phasing, risk, alternatives
- `docs/plans/progressive-disclosure/` - Original PR #164 planning documents
