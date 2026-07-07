---
title: Cards
description: 'Card container components: base Card, CardGrid layout, collapsible cards, and sticky cards.'
---

Card components provide structural containers and layout scaffolding for grouping related content. These are reusable components under `$ui/` (source: packages/praxrr-app/src/lib/client/ui/), covering the base `Card`, the responsive `CardGrid` layout, a `CollapsibleCard` with optional persisted state, and a `StickyCard` toolbar bar.

## Card

Structural container with optional header, body, and footer slots separated by dividers. It supports padding sizes, hoverable and interactive states, a click handler, and a link mode that renders the card as an anchor element. It also participates in a `CardGrid` flush context for seamless nested styling.

Import:

```svelte
import Card from '$ui/card/Card.svelte';
```

Props:

| Prop        | Type                             | Default     | Required | Description                                                                                                                                                                                 |
| ----------- | -------------------------------- | ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `padding`   | `'none' \| 'sm' \| 'md' \| 'lg'` | `'md'`      | No       | Padding applied to header/body/footer regions. Maps to `none=''`, `sm='px-3 py-2'`, `md='px-4 py-3'`, `lg='px-5 py-4'`. Also controls the divider horizontal margin (`mx-3`/`mx-4`/`mx-5`). |
| `hoverable` | `boolean`                        | `false`     | No       | When true, applies a background transition on hover even if the card is not interactive.                                                                                                    |
| `href`      | `string \| undefined`            | `undefined` | No       | When set, the card renders as an `<a>` element with this href instead of a `<div>`. Makes the card interactive (cursor + hover).                                                            |
| `onclick`   | `(() => void) \| undefined`      | `undefined` | No       | Click callback for the non-href (div) card. Bound via `on:click`. Presence makes the card interactive (cursor + hover).                                                                     |
| `flush`     | `boolean`                        | `false`     | No       | Forces flush styling (neutral-50/neutral-900 background, stronger hover). Effective flush is `flush` OR the inherited `card-flush` context from a parent `CardGrid`.                        |
| `className` | `string`                         | `''`        | No       | Extra CSS classes appended to the card's root element class list.                                                                                                                           |

Usage:

```svelte
<Card hoverable onclick={() => goto('/profiles/1')}>
  <svelte:fragment slot="header">
    <h3 class="text-sm font-semibold">HD-1080p</h3>
  </svelte:fragment>
  <p class="text-sm text-neutral-600">Quality profile for 1080p content.</p>
  <svelte:fragment slot="footer">
    <Badge variant="success" size="sm">Active</Badge>
  </svelte:fragment>
</Card>
```

Slots and events:

- Default slot renders the body; the named `header` and `footer` slots are each rendered only when their slot has content (`$$slots.header` / `$$slots.footer`), separated from the body by a top/bottom border divider.
- `onclick` is a callback prop invoked on card click in div mode only (via `on:click`). In href mode the card navigates instead and does not fire `onclick`.

Variants and notes:

- Padding: `none` | `sm` | `md` | `lg`.
- Rendering modes: anchor (when `href` is set) versus div (default).
- States: interactive (`href` or `onclick`) gets `cursor-pointer` plus hover background; hoverable-only gets a hover background without the cursor; flush versus non-flush background and hover styling.
- This component uses the legacy Svelte slot API (`export let` props, `<slot>`, `$$slots`), not Svelte 5 runes. Root classes always include `rounded-xl border` and `overflow-hidden`.
- The interactive div card uses `on:click` and suppresses accessibility warnings via `svelte-ignore`; for keyboard-accessible navigation prefer href mode. `isFlush = flush || getContext('card-flush')`, and `getContext` is wrapped in try/catch so the card is safe to use outside a `CardGrid`.

## CardGrid

Responsive CSS Grid container for `Card` components. It adjusts column count by breakpoint (always 1 column on mobile, scaling up to the configured max) and sets a `card-flush` context that child cards inherit. Because it uses CSS Grid, cards in the same row share equal height.

Import:

```svelte
import CardGrid from '$ui/card/CardGrid.svelte';
```

Props:

| Prop        | Type                    | Default | Required | Description                                                                                                                                             |
| ----------- | ----------------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `columns`   | `1 \| 2 \| 3 \| 4 \| 5` | `3`     | No       | Maximum columns at the largest breakpoint. `1=grid-cols-1`; `2=1→md:2`; `3=1→md:2→lg:3`; `4=1→sm:2→md:3→lg:4`; `5=1→sm:2→md:3→lg:4→xl:5`.               |
| `gap`       | `'sm' \| 'md' \| 'lg'`  | `'md'`  | No       | Grid gap size. `sm='gap-2'`, `md='gap-4'`, `lg='gap-6'`.                                                                                                |
| `flush`     | `boolean`               | `false` | No       | Sets the `card-flush` context via `setContext('card-flush', flush)` so descendant cards render with flush styling without passing the prop to each one. |
| `className` | `string`                | `''`    | No       | Extra CSS classes appended to the grid container class list.                                                                                            |

Usage:

```svelte
<CardGrid columns={3} gap="md">
  <Card><p>Remux</p></Card>
  <Card><p>BR-DISK</p></Card>
  <Card><p>x264</p></Card>
</CardGrid>
```

Variants and notes:

- `columns` 1 through 5 (the showcase description mentions 1 through 4, but the type and `columnClasses` map support up to 5).
- `gap`: `sm` | `md` | `lg`.
- `flush` on or off.
- The default slot is where you place `Card` components (or any grid children).
- Legacy Svelte slot API. It reactively calls `setContext('card-flush', flush)`, which child cards read via `getContext` to enable flush styling. `columnClasses` and `gapClasses` are static lookup maps.

## CollapsibleCard

Bordered card with a clickable header (title, optional description, and chevron) that expands and collapses its body with a slide transition. It can optionally persist open/closed state across sessions via a user-interface-preference section store keyed by `sectionKey`.

Import:

```svelte
import CollapsibleCard from '$ui/card/CollapsibleCard.svelte';
```

Props:

| Prop          | Type                      | Default     | Required | Description                                                                                                                                                                                                                              |
| ------------- | ------------------------- | ----------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`       | `string`                  | —           | Yes      | Header heading text (rendered in an `<h2>`).                                                                                                                                                                                             |
| `description` | `string`                  | `''`        | No       | Optional sub-text shown beneath the title; only rendered when non-empty.                                                                                                                                                                 |
| `sectionKey`  | `SectionKey \| undefined` | `undefined` | No       | When provided, wires open state to `getUserInterfacePreferenceSectionStore(sectionKey, defaultMode)` so open/closed persists. `'advanced'` mode = open, `'basic'` mode = closed. Type imported from `$shared/disclosure/sectionKeys.ts`. |
| `defaultOpen` | `boolean`                 | `true`      | No       | Initial open state. Also determines the store's default mode when `sectionKey` is set: `true→'advanced'`, `false→'basic'`.                                                                                                               |

Usage:

```svelte
<CollapsibleCard
  title="Advanced settings"
  description="Optional tuning"
  sectionKey="quality-profile.advanced"
  defaultOpen={false}
>
  <FormInput label="Threshold" />
</CollapsibleCard>
```

Slots and events:

- Default slot holds the collapsible body content, rendered inside a `p-6` container only while open.
- Internal `toggle()` runs on header button click; there is no exposed callback prop. When `sectionKey` is set, toggling writes `sectionStore.mode.set('advanced' | 'basic')`.

Variants and notes:

- Persisted (`sectionKey` set, subscribes to store) versus ephemeral (local `isOpen` only).
- Respects `prefers-reduced-motion`: slide duration is 0 when reduced motion is requested, otherwise 200ms with `quintOut` easing.
- Uses a Svelte 5 `onclick` handler in markup but legacy `export let` props.
- Collapsed state UNMOUNTS the slot DOM (a source comment warns: use independent forms per card; do not wrap multiple cards in one parent form).
- Subscribes to `sectionStore.mode` and calls `sectionStore.cleanup()` plus `unsubscribe()` in `onDestroy`. `reducedMotion` is read from `window.matchMedia` guarded by `typeof window !== 'undefined'` for SSR safety.
- Not present in the dev/components showcase route.

## StickyCard

Sticky header/footer bar with left and right slots that pins to the top or bottom of its scroll container. It uses an `IntersectionObserver` sentinel to detect the stuck state and negative horizontal margins to bleed to the container edges. This is distinct from `Card` — it is a toolbar or heading bar, not a content container.

Import:

```svelte
import StickyCard from '$ui/card/StickyCard.svelte';
```

Props:

| Prop       | Type                                   | Default     | Required | Description                                                                                                                                                                               |
| ---------- | -------------------------------------- | ----------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `position` | `'top' \| 'bottom'`                    | `'top'`     | No       | Where the bar sticks. `'top'` pins to `top-0` with a bottom divider; `'bottom'` pins to `bottom-0` with a top divider. Also positions the `IntersectionObserver` sentinel.                |
| `variant`  | `'default' \| 'transparent' \| 'blur'` | `'default'` | No       | Background style. `default`=solid neutral-50/neutral-900 with a divider line; `blur`=`backdrop-blur-sm` with 50% translucent background; `transparent`=no background and no divider line. |

Usage:

```svelte
<StickyCard position="top" variant="default">
  <svelte:fragment slot="left">
    <h1>Page Title</h1>
    <p>Subtitle text</p>
  </svelte:fragment>
  <svelte:fragment slot="right">
    <Button text="Save" variant="primary" size="xs" />
    <Button text="Cancel" variant="ghost" size="xs" />
  </svelte:fragment>
</StickyCard>
```

Slots and events:

- Named slot `left` holds the title/subtitle area (it auto-styles a nested `h1` to `text-base`/semibold then `md:text-xl`, and a nested `p` to `text-xs` then `md:text-sm`).
- Named slot `right` holds the actions area, flex-wrapped. There is no default slot.
- No callback props. Internally it maintains `isStuck` via an `IntersectionObserver` on a sentinel element (`isStuck = !entry.isIntersecting`); the observer is disconnected on unmount.

Variants and notes:

- `position`: `top` | `bottom`.
- `variant`: `default` (divider shown) | `transparent` (no background or divider) | `blur` (translucent plus backdrop blur). The divider line only renders for `variant='default'`.
- Legacy Svelte slot API. Requires a positioned scrolling ancestor (relative container) for the sentinel and sticky behavior — the showcase wraps it in a relative `overflow-y-auto` container.
- Applies `-mx-4 md:-mx-8` negative margins and `z-10` to overlay content. `isStuck` is tracked but not currently bound to any visual class in this source. `onMount` registers the observer and returns the cleanup that disconnects it.
