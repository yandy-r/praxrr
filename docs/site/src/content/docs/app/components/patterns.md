---
title: Store Patterns & Conventions
description: 'Client store patterns and conventions: dirty tracking, the alert system, theme/accent, search stores, and Tailwind CSS v4 utility conventions.'
---

This page documents the client-side store patterns and conventions used across the app. These are modules under `$stores/` (source: `packages/praxrr-app/src/lib/client/stores/`) and the alert system under `$lib/client/alerts/`. Most are module-level singletons; the search store is a factory. Usage examples follow the repo's Svelte 5 convention of plain props and `onclick`/`on:click` handlers rather than runes.

## dirty (form dirty-state store)

Singleton form dirty-tracking store using snapshot comparison. It stores an original snapshot and current data; changing a field and then changing it back registers as not dirty, and create mode is always dirty. It also drives an unsaved-changes navigation guard modal.

```svelte
import {(isDirty,
current,
showModal,
initEdit,
initCreate,
update,
resetFromServer,
clear,
confirmNavigation,
confirmDiscard,
cancelDiscard)} from '$stores/dirty';
```

| Prop                | Type                                                                     | Default | Required | Description                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------ | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `isDirty`           | `Readable<boolean>`                                                      | `—`     | Yes      | Derived store; true when isNewMode is set, or when currentData deep-differs from originalSnapshot (deep equality is order-sensitive for arrays). |
| `current`           | `Writable<Record<string, unknown>>`                                      | `—`     | Yes      | Re-export of the internal currentData store for reactive read/bind of the live form state.                                                       |
| `showModal`         | `Writable<boolean>`                                                      | `—`     | Yes      | Re-export of the internal showWarningModal store; bind to a DirtyModal open prop to show the unsaved-changes warning.                            |
| `initEdit`          | `<T extends FormData>(serverData: T) => void`                            | `—`     | Yes      | Enter edit mode: clears new-mode, structuredClones serverData into both snapshot and current.                                                    |
| `initCreate`        | `<T extends FormData>(defaults: T) => void`                              | `—`     | Yes      | Enter create mode: sets new-mode true (always dirty), null snapshot, current = clone of defaults.                                                |
| `update`            | `<T extends FormData, K extends keyof T>(field: K, value: T[K]) => void` | `—`     | Yes      | Immutably update a single field on currentData.                                                                                                  |
| `resetFromServer`   | `<T extends FormData>(newServerData: T) => void`                         | `—`     | Yes      | After a save + refetch, re-baseline snapshot and current to fresh server data (clears new-mode) so isDirty becomes false.                        |
| `clear`             | `() => void`                                                             | `—`     | Yes      | Reset all state on unmount/navigation-away; sets both stores to the same empty object so isDirty = false.                                        |
| `confirmNavigation` | `() => Promise<boolean>`                                                 | `—`     | Yes      | If not dirty, resolves true immediately; otherwise opens the warning modal and returns a promise resolved by confirmDiscard/cancelDiscard.       |
| `confirmDiscard`    | `() => void`                                                             | `—`     | Yes      | User confirms discarding: closes modal, re-baselines snapshot to current (isDirty false), resolves pending navigation promise with true.         |
| `cancelDiscard`     | `() => void`                                                             | `—`     | Yes      | User stays on page: closes modal and resolves pending navigation promise with false.                                                             |

```svelte
import { isDirty, showModal, initEdit, update, confirmNavigation, confirmDiscard, cancelDiscard } from '$stores/dirty';

initEdit(data.profile);
$: dirty = $isDirty;
function onNameInput(e) { update('name', e.currentTarget.value); }

// navigation guard (e.g. in beforeNavigate)
const proceed = await confirmNavigation();
if (!proceed) cancel();

<DirtyModal bind:open={$showModal} on:confirm={confirmDiscard} on:cancel={cancelDiscard} />
```

Notes:

- This is a module-level singleton, not a factory, so only one form's dirty state can be tracked at a time.
- `FormData` is `Record<string, unknown>`, and `deepEquals` is order-sensitive for arrays.
- The internal stores `originalSnapshot`, `isNewMode`, and the `resolveNavigation` callback are NOT exported.

## alertStore

Global toast/alert queue. `add()` pushes a typed message that auto-dismisses after a resolved duration (an explicit argument, else the user's alert-settings duration). This is the canonical user-feedback mechanism referenced across the app.

```svelte
import {alertStore} from '$lib/client/alerts/store';
```

| Prop        | Type                                                                            | Default | Required | Description                                                                                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------- | ------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subscribe` | `Writable<Alert[]>['subscribe']`                                                | `—`     | Yes      | Subscribe to the current array of active alerts. Alert = { id: string; type: AlertType; message: string; duration?: number }.                                                                                   |
| `add`       | `(type: AlertType, message: string, duration?: number) => string`               | `—`     | Yes      | Enqueue an alert and return its generated id (via $shared/utils/uuid). Duration resolves to the explicit arg when a number, else alertSettingsStore.durationMs; a resolved duration > 0 schedules auto-dismiss. |
| `remove`    | `(id: string) => void`                                                          | `—`     | Yes      | Remove a specific alert by id.                                                                                                                                                                                  |
| `clear`     | `() => void`                                                                    | `—`     | Yes      | Remove all alerts.                                                                                                                                                                                              |
| `AlertType` | `type = 'success' \| 'error' \| 'warning' \| 'info'`                            | `—`     | No       | Exported union of alert severities.                                                                                                                                                                             |
| `Alert`     | `interface { id: string; type: AlertType; message: string; duration?: number }` | `—`     | No       | Exported shape of a queued alert.                                                                                                                                                                               |

```svelte
import {alertStore} from '$lib/client/alerts/store'; alertStore.add('success', 'Profile
saved'); alertStore.add('error', 'Save failed', 8000); // explicit duration ms const
id = alertStore.add('info', 'Working...', 0); // 0 = no auto-dismiss alertStore.remove(id);
```

Variants and notes:

- `AlertType`: `success` | `error` | `warning` | `info`.
- Singleton. The default duration comes from `alertSettingsStore` (5000ms unless the user changed it). A duration of 0 (or negative) disables auto-dismiss.
- Depends on `$shared/utils/uuid` and `./settings`.

## alertSettingsStore

Persisted user preferences for alert position and default auto-dismiss duration. Hydrates from localStorage (`alertSettings`) with validation and writes back on every change.

```svelte
import {(alertSettingsStore,
ALERT_POSITIONS,
AlertPosition,
AlertSettings,
DEFAULT_ALERT_SETTINGS)} from '$lib/client/alerts/settings';
```

| Prop                     | Type                                                                                          | Default | Required | Description                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------- | ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `subscribe`              | `Writable<AlertSettings>['subscribe']`                                                        | `—`     | Yes      | Subscribe to { position: AlertPosition; durationMs: number }. Initializes from validated localStorage or DEFAULT_ALERT_SETTINGS. |
| `setSettings`            | `(next: AlertSettings) => void`                                                               | `—`     | Yes      | Replace settings and persist to localStorage (browser-guarded).                                                                  |
| `ALERT_POSITIONS`        | `readonly ['top-left','top-center','top-right','bottom-left','bottom-center','bottom-right']` | `—`     | No       | Exported const tuple of valid positions.                                                                                         |
| `AlertPosition`          | `type = (typeof ALERT_POSITIONS)[number]`                                                     | `—`     | No       | Exported union of the six position strings.                                                                                      |
| `AlertSettings`          | `interface { position: AlertPosition; durationMs: number }`                                   | `—`     | No       | Exported settings shape.                                                                                                         |
| `DEFAULT_ALERT_SETTINGS` | `AlertSettings`                                                                               | `—`     | No       | Exported defaults: { position: 'top-center', durationMs: 5000 }.                                                                 |

```svelte
import {(alertSettingsStore, ALERT_POSITIONS, DEFAULT_ALERT_SETTINGS)} from '$lib/client/alerts/settings';

<select
  value={$alertSettingsStore.position}
  on:change={(e) =>
    alertSettingsStore.setSettings({
      ...$alertSettingsStore,
      position: e.currentTarget.value,
    })}
>
  {#each ALERT_POSITIONS as pos}<option value={pos}>{pos}</option>{/each}
</select>
```

Variants and notes:

- Six positions (top/bottom x left/center/right); default `top-center` / 5000ms.
- `parseStoredSettings` validates position against `ALERT_POSITIONS` and requires a finite `durationMs >= 0` (rounded), falling back to defaults on any parse/validation failure.
- Persistence is browser-guarded. Consumed by `alertStore` for its default duration and by the alert renderer for placement.

## themeStore

Singleton light/dark theme store. Initializes from localStorage (`theme`) or the prefers-color-scheme media query, applies the theme class to `<html>` (using the View Transitions API when available), and persists on toggle.

```svelte
import {themeStore} from '$stores/theme';
```

| Prop        | Type                                       | Default | Required | Description                                                                                                                                                                               |
| ----------- | ------------------------------------------ | ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subscribe` | `Writable<'light' \| 'dark'>['subscribe']` | `—`     | Yes      | Svelte store subscription for the current theme ('light' \| 'dark'). Default initial value is 'dark' (used on server / before browser hydration).                                         |
| `toggle`    | `() => void`                               | `—`     | Yes      | Flip between light and dark; applies the class to document.documentElement (via document.startViewTransition when supported) and writes to localStorage (guarded against storage errors). |

```svelte
import {themeStore} from '$stores/theme';

<button on:click={themeStore.toggle}>
  {$themeStore === 'dark' ? 'Light mode' : 'Dark mode'}
</button>
```

Variants and notes:

- Theme values: `light` | `dark`.
- Only `subscribe` and `toggle` are exposed (no set/update). All DOM/localStorage access is guarded by the `$app/environment` browser flag. The `Theme` type is not exported.

## accentStore

Singleton accent-color store. Persists a chosen accent to localStorage (`accent`) and writes the matching Tailwind-shade palette (50–950) to CSS custom properties (`--accent-50` … `--accent-950`) on `<html>`.

```svelte
import {(accentStore, accentColors, AccentColor)} from '$stores/accent';
```

| Prop           | Type                                                                               | Default | Required | Description                                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subscribe`    | `Writable<AccentColor>['subscribe']`                                               | `—`     | Yes      | Subscription to the current AccentColor ('blue' \| 'yellow' \| 'green' \| 'orange' \| 'teal' \| 'purple' \| 'rose'). Initial value 'blue'.                    |
| `set`          | `(accent: AccentColor) => void`                                                    | `—`     | Yes      | setAccent: update the store, apply the palette CSS variables, and persist to localStorage. Replaces the store's default set with this side-effecting version. |
| `AccentColor`  | `type = 'blue' \| 'yellow' \| 'green' \| 'orange' \| 'teal' \| 'purple' \| 'rose'` | `—`     | No       | Exported union type of supported accent color keys.                                                                                                           |
| `accentColors` | `{ value: AccentColor; label: string; color: string }[]`                           | `—`     | No       | Exported list of accents with display label and a representative swatch hex (the 600 shade), for building pickers.                                            |

```svelte
import { accentStore, accentColors, type AccentColor } from '$stores/accent';

{#each accentColors as opt}
  <button style="background:{opt.color}" class:selected={$accentStore === opt.value}
    on:click={() => accentStore.set(opt.value)}>{opt.label}</button>
{/each}
```

Variants and notes:

- Seven accents: blue, yellow, green, orange, teal, purple, rose. Each maps to an 11-shade palette.
- `colorPalettes` (full shade maps) is module-internal and not exported. All browser side effects are guarded by the browser flag.
- `localStorage.setItem` in `setAccent` is NOT wrapped in try/catch (unlike `theme.ts`).

## createSearchStore / getPersistentSearchStore

Factory for a per-instance search + filter store with debounced query, arbitrary key/value filters, an `isActive` flag, and a generic array filter helper. `getPersistentSearchStore` returns a keyed singleton whose query is mirrored to localStorage.

```svelte
import {(createSearchStore, getPersistentSearchStore)} from '$stores/search';
```

| Prop                         | Type                                                                                                                                          | Default | Required | Description                                                                                                                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createSearchStore`          | `(config?: SearchStoreConfig) => SearchStore`                                                                                                 | `—`     | Yes      | Create a new search store. SearchStoreConfig = { debounceMs?: number (default 300); caseSensitive?: boolean (default false) }.                                                                                 |
| `getPersistentSearchStore`   | `(key: string, config?: SearchStoreConfig) => SearchStore`                                                                                    | `—`     | Yes      | Return a cached store for key (created once), hydrating query from localStorage[key] and persisting query changes back (removes the key when query is empty). In-memory Map cache is shared across the module. |
| `SearchStore.subscribe`      | `Readable<SearchState>['subscribe']`                                                                                                          | `—`     | Yes      | Subscribe to { query: string; filters: Record<string, unknown>; isActive: boolean }.                                                                                                                           |
| `SearchStore.debouncedQuery` | `{ subscribe: Readable<string>['subscribe'] }`                                                                                                | `—`     | Yes      | Read-only debounced query store, updated debounceMs after the last setQuery.                                                                                                                                   |
| `SearchStore.isActive`       | `{ subscribe: Readable<boolean>['subscribe'] }`                                                                                               | `—`     | Yes      | Read-only derived boolean; true when a query or filters are present.                                                                                                                                           |
| `SearchStore.filterCount`    | `{ subscribe: Readable<number>['subscribe'] }`                                                                                                | `—`     | Yes      | Read-only derived count of active filter keys.                                                                                                                                                                 |
| `SearchStore.setQuery`       | `(query: string) => void`                                                                                                                     | `—`     | Yes      | Set the (immediate) query, mark active when non-empty, and schedule the debounced update.                                                                                                                      |
| `SearchStore.setFilter`      | `(key: string, value: unknown) => void`                                                                                                       | `—`     | Yes      | Add/replace a filter key and mark the store active.                                                                                                                                                            |
| `SearchStore.removeFilter`   | `(key: string) => void`                                                                                                                       | `—`     | Yes      | Remove a filter key; isActive recomputed from remaining query/filters.                                                                                                                                         |
| `SearchStore.clearFilters`   | `() => void`                                                                                                                                  | `—`     | Yes      | Drop all filters; isActive stays true only if a query remains.                                                                                                                                                 |
| `SearchStore.clear`          | `() => void`                                                                                                                                  | `—`     | Yes      | Reset query, filters, isActive, debounced query, and cancel any pending debounce timer.                                                                                                                        |
| `SearchStore.filterItems`    | `<T extends object>(items: T[], searchFields: (keyof T)[], additionalFilter?: (item: T, filters: Record<string, unknown>) => boolean) => T[]` | `—`     | Yes      | Filter an array by the current debounced query across searchFields (respecting caseSensitive) plus an optional custom filter predicate; returns items unchanged when the store is inactive.                    |

```svelte
import { createSearchStore, getPersistentSearchStore } from '$stores/search';

const search = createSearchStore({ debounceMs: 250 });
const debouncedQuery = search.debouncedQuery;
$: visible = search.filterItems(rows, ['name', 'category']);

// consumed by SearchAction in the component showcase:
<SearchAction searchStore={search} placeholder="Search components..." responsive />

// persistent variant keyed to localStorage
const pageSearch = getPersistentSearchStore('customFormats.search');
```

Notes:

- `SearchState`, `SearchStoreConfig`, and `SearchStore` (ReturnType of `createSearchStore`) types are exported.
- The showcase (`routes/dev/components/+page.svelte`) passes the whole store to `SearchAction` via `searchStore={...}` and also reads `search.debouncedQuery` directly.
- `debouncedQuery` / `isActive` / `filterCount` are exposed as `{ subscribe }` wrappers, not full stores.

## userComplexityTiersStore / getUserComplexityTierSectionStore

Server-synced store for per-section UI complexity tiers (beginner/intermediate/etc.). It wraps a shared debounced section-sync engine that hydrates from and PATCHes to `/api/v1/complexity-tiers`, tracking interaction counts and tier-suggestion dismissals with optimistic-update auth handling.

```svelte
import {(userComplexityTiersStore, getUserComplexityTierSectionStore)} from '$stores/userComplexityTiers';
```

| Prop                                                | Type                                                                                                                                                                                                                                      | Default | Required | Description                                                                                                                                                                          |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `userComplexityTiersStore`                          | `UserComplexityTiersStore`                                                                                                                                                                                                                | `—`     | Yes      | Top-level singleton: { section(sectionKey, defaultTier?) => UserComplexityTierSectionStore; authRequired: Readable<boolean>; clearAuthRequired(): void; clearOnAuthChange(): void }. |
| `getUserComplexityTierSectionStore`                 | `(sectionKey: SectionKey, defaultTier?: ComplexityTier = 'beginner') => UserComplexityTierSectionStore`                                                                                                                                   | `—`     | Yes      | Convenience accessor equivalent to userComplexityTiersStore.section(...). Returns a ref-counted per-section store (created + hydrated on first use).                                 |
| `UserComplexityTierSectionStore.tier`               | `Writable<ComplexityTier>`                                                                                                                                                                                                                | `—`     | Yes      | Current tier; set/update route through the debounced sync (setPendingValue), not a raw store write.                                                                                  |
| `UserComplexityTierSectionStore (read-only stores)` | `interactionCount / advancedToggleCount: Readable<number>; lastSuggestedTier: Readable<ComplexityTier\|null>; suggestionDismissedAt: Readable<string\|null>; persisted / isSyncing: Readable<boolean>; updatedAt: Readable<string\|null>` | `—`     | Yes      | Reactive read-only projections of the synced section state.                                                                                                                          |
| `UserComplexityTierSectionStore.refresh`            | `() => Promise<void>`                                                                                                                                                                                                                     | `—`     | Yes      | Re-hydrate this section from the server (no-op when not in browser).                                                                                                                 |
| `UserComplexityTierSectionStore.recordActivity`     | `(activity: { interaction?: number; advancedToggle?: number }) => Promise<void>`                                                                                                                                                          | `—`     | Yes      | Immediately persist an interaction/advanced-toggle delta for the section.                                                                                                            |
| `UserComplexityTierSectionStore.dismissSuggestion`  | `(suggestedTier: ComplexityTier) => Promise<void>`                                                                                                                                                                                        | `—`     | Yes      | Persist dismissal of a suggested tier (records last_suggested_tier + suggestion_dismissed_at = now).                                                                                 |
| `UserComplexityTierSectionStore.cleanup`            | `() => void`                                                                                                                                                                                                                              | `—`     | Yes      | Decrement the section's ref count and tear down shared state when it reaches zero. Call on component destroy.                                                                        |

```svelte
import {getUserComplexityTierSectionStore} from '$stores/userComplexityTiers'; import
{onDestroy} from 'svelte'; const section = getUserComplexityTierSectionStore('quality-profiles',
'beginner'); const tier = section.tier; const isSyncing = section.isSyncing; onDestroy(section.cleanup);

<select bind:value={$tier}>...</select>
{#if $isSyncing}<Spinner />{/if}
```

Variants and notes:

- `ComplexityTier` values come from `$shared/complexity/tiers.ts` (`COMPLEXITY_TIERS`); the default tier is `beginner`.
- Depends on `./sectionDebouncedSync.ts` (`createDebouncedSectionSync`) and `$shared/complexity/tiers.ts`.
- Sections are ref-counted and shared by `sectionKey`, so calls with the same key return the same underlying state.
- `UserComplexityTierRecord`, `UserComplexityTiersStore`, and `UserComplexityTierSectionStore` interfaces are exported; the API layer uses snake_case (`section_key`, `interaction_count`, etc.) mapped to camelCase records.

## Tailwind CSS v4 utility conventions

The stores above integrate with Tailwind CSS v4 through CSS custom properties rather than hard-coded color classes.

- `accentStore` writes an 11-shade palette to `--accent-50` … `--accent-950` on `<html>`, so utilities and components can reference the live accent via those custom properties.
- `themeStore` toggles the theme class on `document.documentElement`, which is the anchor for Tailwind's dark-mode variants.
- Prefer referencing these CSS variables in component styles over duplicating shade values, so theme and accent changes propagate without rebuilds.
