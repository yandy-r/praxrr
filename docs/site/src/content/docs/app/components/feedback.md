---
title: Feedback & States
description: 'User-feedback components: alerts, mobile-nav alert, empty states, tooltips, and complexity progression hints.'
---

This category covers the reusable feedback and state components that surface transient
messages, empty collections, hover hints, and progressive-complexity nudges. They live
under `$ui/` (and the sibling alerts folder) in
`packages/praxrr-app/src/lib/client/ui/` and are wired to Svelte stores rather than
one-off local state.

## Alert

Single toast/alert card rendered inside `AlertContainer`. It shows a type-colored icon
plus message, dismisses on click or Enter/Space, and animates in (fly from top) and out
(fade).

Import:

```svelte
<script>
  import Alert from '$lib/client/alerts/Alert.svelte';
</script>
```

Props:

| Prop      | Type                                                      | Default | Required | Description                                                                                          |
| --------- | --------------------------------------------------------- | ------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `id`      | `string`                                                  | —       | Yes      | Alert id used to remove it from `alertStore` on dismiss.                                             |
| `type`    | `AlertType ('success' \| 'error' \| 'warning' \| 'info')` | —       | Yes      | Controls icon (CheckCircle/XCircle/AlertTriangle/Info) and the color scheme (emerald/red/amber/sky). |
| `message` | `string`                                                  | —       | Yes      | Text shown next to the icon.                                                                         |

Usage:

```svelte
<script>
  import Alert from '$lib/client/alerts/Alert.svelte';
</script>

<Alert id="abc-123" type="success" message="Profile saved" />
```

Variants and notes:

- Four color/icon variants driven by `type`: success (emerald + CheckCircle), error (red
  - XCircle), warning (amber + AlertTriangle), info (sky + Info). Full-size padded card
    (`px-4 py-3`, `rounded-xl`, `shadow-lg`, 18px icon).
- No callback props. Internally binds `on:click` and `on:keydown` (Enter/Space) to call
  `alertStore.remove(id)`, with `role="button"` and `tabindex=0`.
- Svelte 4 style (`export let`, `on:click`). Not meant to be instantiated directly in
  feature code — alerts are created via `alertStore.add(type, message, duration?)` and
  rendered by `AlertContainer`, which iterates `$alertStore`.
- `AlertType` is imported from `./store`. Transitions: `in:fly {y:-12,duration:200}`,
  `out:fade {duration:150}`.

## AlertContainer

Fixed-position overlay that subscribes to `alertStore` and renders one `Alert` per active
toast. It reads position from `alertSettingsStore` and adapts layout for auth pages versus
the main app shell.

Import:

```svelte
<script>
  import AlertContainer from '$lib/client/alerts/AlertContainer.svelte';
</script>
```

Props:

| Prop | Type | Default | Required | Description                        |
| ---- | ---- | ------- | -------- | ---------------------------------- |
| —    | —    | —       | —        | No props — fully driven by stores. |

Usage:

```svelte
<script>
  import AlertContainer from '$lib/client/alerts/AlertContainer.svelte';
</script>

<AlertContainer />
```

Variants and notes:

- Mount once in the root layout so every route shares one toast overlay.
- Six position placements resolved from `$alertSettingsStore.position` via `AlertPosition`
  (`top-left` | `top-center` | `top-right` | `bottom-left` | `bottom-center` |
  `bottom-right`); it falls back to `top-center`.
- On non-auth pages it is hidden on mobile and offsets for the sidebar (`md:pl-80`); on
  auth pages it renders without those offsets.
- Uses a `pointer-events-none` wrapper with `pointer-events-auto` per alert so clicks pass
  through empty areas. Keyed `each` block over `$alertStore` by `alert.id`. `AlertPosition`
  is imported from `./settings`; `$app/stores` `page` is used to detect `/auth/` pathnames.

## MobileNavAlert

Compact single-line alert variant sized for the mobile navigation bar. It has the same
dismiss behavior as `Alert` but is smaller (`text-xs`, truncated message, 14px icon).

Import:

```svelte
<script>
  import MobileNavAlert from '$lib/client/alerts/MobileNavAlert.svelte';
</script>
```

Props:

| Prop      | Type                                                      | Default | Required | Description                                              |
| --------- | --------------------------------------------------------- | ------- | -------- | -------------------------------------------------------- |
| `id`      | `string`                                                  | —       | Yes      | Alert id used to remove it from `alertStore` on dismiss. |
| `type`    | `AlertType ('success' \| 'error' \| 'warning' \| 'info')` | —       | Yes      | Controls icon and color scheme (emerald/red/amber/sky).  |
| `message` | `string`                                                  | —       | Yes      | Text shown; truncated with `min-w-0 truncate` when long. |

Usage:

```svelte
<script>
  import MobileNavAlert from '$lib/client/alerts/MobileNavAlert.svelte';
</script>

<MobileNavAlert id="abc-123" type="info" message="Syncing…" />
```

Variants and notes:

- Same four `type` variants as `Alert` but with a lighter compact style (`px-2.5 py-1.5`,
  `rounded-lg`, `text-xs font-semibold`, no shadow). Fade in/out only (`in:fade` 150ms,
  `out:fade` 100ms).
- No callback props. Internal `on:click` and `on:keydown` (Enter/Space) call
  `alertStore.remove(id)`, with `role="button"` and `tabindex=0`.
- Svelte 4 style. Differs from `Alert` only in sizing/typography and transition; text color
  uses the `-800`/`-200` shades versus `Alert`'s `-900`/`-100`, and it has no hover state.
  Intended for the mobile top bar where `AlertContainer` is hidden.

## EmptyState

Centered full-height empty-state placeholder with a circular icon, title, description, and
a single call-to-action link button. Use it when a list or collection has no items yet.

Import:

```svelte
<script>
  import EmptyState from '$ui/state/EmptyState.svelte';
</script>
```

Props:

| Prop          | Type                     | Default | Required | Description                                                                                                    |
| ------------- | ------------------------ | ------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `icon`        | `ComponentType (svelte)` | —       | Yes      | Icon component rendered large (`h-12 w-12`) inside the rounded neutral circle. Typically a lucide-svelte icon. |
| `title`       | `string`                 | —       | Yes      | Heading text (`text-2xl font-bold`).                                                                           |
| `description` | `string`                 | —       | Yes      | Supporting paragraph text under the title.                                                                     |
| `buttonText`  | `string`                 | —       | Yes      | Label for the action link/button.                                                                              |
| `buttonHref`  | `string`                 | —       | Yes      | `href` the action button navigates to (rendered as an `<a>`).                                                  |
| `buttonIcon`  | `ComponentType (svelte)` | `Plus`  | No       | Icon shown at 18px inside the action button; defaults to lucide-svelte `Plus`.                                 |

Usage:

```svelte
<script>
  import EmptyState from '$ui/state/EmptyState.svelte';
  import { Database, Plus } from 'lucide-svelte';
</script>

<EmptyState
  icon={Database}
  title="No databases yet"
  description="Link a PCD repository to get started."
  buttonText="Add database"
  buttonHref="/databases/new"
  buttonIcon={Plus}
/>
```

Variants and notes:

- Single layout; the only visual variation is via the `icon`/`buttonIcon` props.
  Accent-colored CTA button (`bg-accent-600 hover:bg-accent-700`).
- Svelte 4 style (`export let`). Renders `icon` and `buttonIcon` via
  `<svelte:component this={...}>`.
- The action is always an anchor (`href`), not a click handler — there is no `onclick`
  prop. `min-h-[calc(100vh-4rem)]` accounts for the app top bar.

## Tooltip

Hover tooltip that wraps any trigger content (default slot) and renders a fixed-position,
viewport-clamped label on `mouseenter`. It positions above or below the trigger and flips
if it would overflow.

Import:

```svelte
<script>
  import Tooltip from '$ui/tooltip/Tooltip.svelte';
</script>
```

Props:

| Prop       | Type                | Default    | Required | Description                                                                                                               |
| ---------- | ------------------- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `text`     | `string`            | `''`       | No       | Tooltip label. When empty, no tooltip renders (`show()` early-returns and the `{#if text && visible}` guard is false).    |
| `position` | `'top' \| 'bottom'` | `'bottom'` | No       | Preferred side of the trigger. Auto-flips to the opposite side if there isn't enough room within an 8px viewport padding. |

Usage:

```svelte
<script>
  import Tooltip from '$ui/tooltip/Tooltip.svelte';
</script>

<Tooltip text="Delete profile" position="top">
  <button aria-label="Delete">🗑</button>
</Tooltip>
```

Variants and notes:

- The default slot is the trigger element(s) the tooltip is attached to (wrapped in an
  `inline-flex` div).
- Two placements via `position` (top/bottom), each with automatic flip-on-overflow. Fixed
  `z-50` bubble, `pointer-events-none`, `rounded-xl`, light/dark styled.
- No callback props. Internally handles `on:mouseenter` (show) and `on:mouseleave` (hide)
  on the wrapper.
- Svelte 4 style. Computes position from the wrapper's `getBoundingClientRect`, renders,
  then awaits `tick()` and clamps horizontally within `PADDING=8px` of the viewport,
  flipping vertically if the preferred side overflows. Uses inline style plus a hardcoded
  `border-radius:0.75rem !important` override. The bubble is `pointer-events-none` so it
  never intercepts hover.

## ComplexityProgressionHint

Contextual inline nudge that suggests advancing the current area's complexity tier
(beginner → intermediate → advanced) after the user has opened advanced options enough
times. It offers Switch / Not now actions.

Import:

```svelte
<script>
  import ComplexityProgressionHint from '$ui/complexity/ComplexityProgressionHint.svelte';
</script>
```

Props:

| Prop | Type | Default | Required | Description                                                                 |
| ---- | ---- | ------- | -------- | --------------------------------------------------------------------------- |
| —    | —    | —       | —        | No exposed props; behavior comes entirely from the complexity-tier context. |

Usage:

```svelte
<script>
  import ComplexityProgressionHint from '$ui/complexity/ComplexityProgressionHint.svelte';
  // Requires an ancestor to have called setComplexityTierContext(...)
</script>

<ComplexityProgressionHint />
```

Variants and notes:

- Single amber advisory banner (`aria-live="polite"`). It renders nothing unless the
  complexity-tier context exists, a next tier is available, `advancedToggleCount >= 5`, and
  the suggestion has not already been shown/dismissed for that tier.
- Internal buttons: Switch (`acceptSuggestion`) sets `context.tier` to the suggested tier
  and calls `context.dismissSuggestion(suggestedTier)`; Not now (`dismissSuggestion`) calls
  `context.dismissSuggestion(suggestedTier)`.
- Svelte 5 handler style (`onclick`). Consumes the `ComplexityTierContext` via
  `getComplexityTierContext()` from `./complexityTierContext` — it returns `undefined` if
  no provider, in which case the hint never shows.
- Subscribes to context stores (`tier`, `advancedToggleCount`, `lastSuggestedTier`,
  `suggestionDismissedAt`) and unsubscribes `onDestroy`. Threshold constant
  `ADVANCED_TOGGLES_BEFORE_SUGGEST = 5`. `suggestedTier` is derived: beginner →
  intermediate, intermediate → advanced, advanced → null (no hint at the top tier).
  `ComplexityTier` type comes from `$shared/complexity/tiers.ts`.
