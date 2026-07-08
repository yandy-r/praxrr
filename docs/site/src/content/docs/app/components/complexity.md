---
title: Complexity Tiers
description: 'Progressive-complexity components: the tier provider/context, tier selector, and tier context helper.'
---

These progressive-complexity components let a section of the UI expose a Beginner / Intermediate / Advanced tier and share that state with its descendants. They are reusable components under `$ui/` (source: `packages/praxrr-app/src/lib/client/ui/`), built around a Svelte context so a provider, a selector, and any consuming form can stay in sync without prop drilling.

## ComplexityTierProvider

Wraps a section of UI and establishes the complexity-tier Svelte context for its descendants. It instantiates a per-section user tier store (keyed by `sectionKey`) and exposes tier state plus activity/suggestion callbacks via context, cleaning up the store on destroy.

Import:

```svelte
import ComplexityTierProvider from
'$ui/complexity/ComplexityTierProvider.svelte';
```

Props:

| Prop          | Type                                                            | Default      | Required | Description                                                                                                                          |
| ------------- | --------------------------------------------------------------- | ------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `sectionKey`  | `SectionKey` (from `$shared/complexity/tiers.ts`)               | `—`          | Yes      | Identifier for the section whose complexity tier state is managed. Passed to `getUserComplexityTierSectionStore` to scope the store. |
| `initialTier` | `ComplexityTier` (`'beginner' \| 'intermediate' \| 'advanced'`) | `'beginner'` | No       | Starting tier used when the section has no persisted tier yet. Provided as the initial value to the section store.                   |

Usage:

```svelte
<ComplexityTierProvider
  sectionKey={CF_CONDITIONS}
  initialTier={sectionTiers[CF_CONDITIONS] ?? 'beginner'}
>
  {#if enableComplexityTiers}
    <ComplexityTierSelector />
  {/if}
  <!-- section content that reads the tier context -->
</ComplexityTierProvider>
```

Notes:

- Uses the classic Svelte slot API (no runes; declares props with `export let`). The default slot renders child content (for example section forms and a `ComplexityTierSelector`) inside the provider so descendants can consume the tier context.
- On mount it calls `setComplexityTierContext({ tier, advancedToggleCount, lastSuggestedTier, suggestionDismissedAt, recordActivity, dismissSuggestion, tierToDefaultMode })`, sourced from the section store plus the imported `tierToDefaultMode` helper.
- The store comes from `getUserComplexityTierSectionStore(sectionKey, initialTier)` in `$stores/userComplexityTiers`, and the provider registers `onDestroy(() => sectionStore.cleanup())`.
- It exposes no event or callback props directly; callbacks (`recordActivity` and `dismissSuggestion`) are reached through the context object.
- Real usage in `routes/custom-formats/[databaseId]/components/GeneralForm.svelte` nests multiple providers (`CF_CONDITIONS`, `CF_SCORING`, `CF_NEGATION_AND_GROUPS`).

## ComplexityTierSelector

Segmented button control that lets the user switch the active complexity tier (Beginner / Intermediate / Advanced) for the surrounding section, plus a Reset button that returns the tier to `'beginner'`. Renders nothing unless a complexity-tier context is present.

Import:

```svelte
import ComplexityTierSelector from
'$ui/complexity/ComplexityTierSelector.svelte';
```

Props:

| Prop | Type | Default | Required | Description                                                           |
| ---- | ---- | ------- | -------- | --------------------------------------------------------------------- |
| `—`  | `—`  | `—`     | No       | Takes no props. It reads all state from `getComplexityTierContext()`. |

Usage:

```svelte
<ComplexityTierProvider sectionKey={CF_SCORING} initialTier={'beginner'}>
  <ComplexityTierSelector />
</ComplexityTierProvider>
```

Variants:

- Tier buttons render for each of `COMPLEXITY_TIERS` (`'beginner' | 'intermediate' | 'advanced'`) with labels Beginner / Intermediate / Advanced.
- The active tier button is highlighted (dark fill) and gets `aria-pressed={true}`.
- The Reset button (a `RotateCcw` icon) is disabled when the active tier is already `'beginner'`.

Notes:

- It exposes no event or callback props. Internal `onclick` handlers call `context.tier.set(tier)` to change the tier and `resetTier()` to reset to `'beginner'`.
- If no context exists (rendered outside a `ComplexityTierProvider`), the whole markup is guarded by `{#if context}` and renders nothing.
- It subscribes to `context.tier` to track the active tier and unsubscribes in `onDestroy`.
- The source notes that the UI Reset only sets the tier to `'beginner'`; clearing suggestion metadata is a separate server-side concern (`userComplexityTiersQueries.reset()`). The icon is imported as `RotateCcw` from `lucide-svelte`.

## complexityTierContext (module)

Svelte context helpers and the typed contract for sharing complexity-tier state between `ComplexityTierProvider` and consumers like `ComplexityTierSelector`. It defines the `ComplexityTierContext` interface and set/get functions keyed by a private `Symbol`, and re-exports `tierToDefaultMode`.

Import:

```svelte
import {
 setComplexityTierContext,
 getComplexityTierContext,
 tierToDefaultMode,
 type ComplexityTierContext
} from '$ui/complexity/complexityTierContext';
```

Exports:

| Prop                       | Type                                         | Default | Required | Description                                                                                                                                                                                                                                  |
| -------------------------- | -------------------------------------------- | ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ComplexityTierContext`    | `interface` (see fields below)               | `—`     | No       | Shape of the value stored in context. `recordActivity` has signature `(activity: { interaction?: number; advancedToggle?: number }) => Promise<void>`; `dismissSuggestion` has signature `(suggestedTier: ComplexityTier) => Promise<void>`. |
| `setComplexityTierContext` | `(value: ComplexityTierContext) => void`     | `—`     | No       | Stores the given context value under the private `COMPLEXITY_TIER_CONTEXT` `Symbol` via Svelte's `setContext`. Called by `ComplexityTierProvider` during init.                                                                               |
| `getComplexityTierContext` | `() => ComplexityTierContext \| undefined`   | `—`     | No       | Retrieves the context via `getContext`; returns `undefined` if called outside component initialization (the `getContext` call is wrapped in try/catch). Used by `ComplexityTierSelector`.                                                    |
| `tierToDefaultMode`        | `(tier: ComplexityTier) => UiPreferenceMode` | `—`     | No       | Re-exported from `$shared/complexity/tiers.ts`. Returns `'advanced'` when `tier === 'advanced'`, otherwise `'basic'`.                                                                                                                        |

The `ComplexityTierContext` interface fields:

- `tier: Writable<ComplexityTier>`
- `advancedToggleCount: Readable<number>`
- `lastSuggestedTier: Readable<ComplexityTier | null>`
- `suggestionDismissedAt: Readable<string | null>`
- `recordActivity: UserComplexityTierSectionStore['recordActivity']`
- `dismissSuggestion: UserComplexityTierSectionStore['dismissSuggestion']`
- `tierToDefaultMode: (tier: ComplexityTier) => UiPreferenceMode`

Usage:

```ts
import {
  setComplexityTierContext,
  getComplexityTierContext,
  tierToDefaultMode,
  type ComplexityTierContext,
} from '$ui/complexity/complexityTierContext';

// in a provider component
setComplexityTierContext({
  tier,
  advancedToggleCount,
  lastSuggestedTier,
  suggestionDismissedAt,
  recordActivity,
  dismissSuggestion,
  tierToDefaultMode,
});

// in a consumer component
const context = getComplexityTierContext();
if (context) context.tier.set('advanced');
```

Notes:

- The context key is a module-private `Symbol('complexity-tier-context')`, so the context is only reachable through these exported helpers.
- `ComplexityTier` (`'beginner' | 'intermediate' | 'advanced'`) and `tierToDefaultMode` originate in `$shared/complexity/tiers.ts`; `UiPreferenceMode` and `SectionKey` come from `$shared/disclosure/sectionKeys.ts`.
- The store types (`recordActivity` / `dismissSuggestion`) are indexed from `UserComplexityTierSectionStore` in `$stores/userComplexityTiers`.
