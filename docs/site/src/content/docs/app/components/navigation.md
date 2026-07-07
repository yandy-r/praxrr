---
title: Dropdowns & Tabs
description: Dropdown menus, select dropdowns, custom group managers, and tab navigation components.
---

This category covers the floating menu and tab navigation primitives used across the app. All of these are
reusable components under `$ui/` (source: `packages/praxrr-app/src/lib/client/ui/`). They follow the repo's
Svelte 5 convention: plain props with `onclick`/`on:click` handlers and legacy slots, never runes.

## Dropdown

A positioned menu container that renders its children in a floating panel below a trigger. It supports
absolute or fixed positioning (to escape overflow containers like tables), responsive position switching,
and compact spacing.

Import:

```svelte
import Dropdown from '$ui/dropdown/Dropdown.svelte';
```

| Prop             | Type                                    | Default   | Required | Description                                                                                                                                                                                                                                                            |
| ---------------- | --------------------------------------- | --------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `position`       | `'left' \| 'right' \| 'middle'`         | `'left'`  | No       | Horizontal alignment of the panel relative to the trigger.                                                                                                                                                                                                             |
| `mobilePosition` | `'left' \| 'right' \| 'middle' \| null` | `null`    | No       | Alternate position applied below the md breakpoint. When set and different from `position`, a responsive class (e.g. `middle-to-right`) is used; ignored when `fixed` is true. Falls back to `positionClasses[position]` if no matching responsive combination exists. |
| `minWidth`       | `string`                                | `'12rem'` | No       | CSS min-width applied to the panel via inline style.                                                                                                                                                                                                                   |
| `compact`        | `boolean`                               | `false`   | No       | Tighter layout: smaller top margin (mt-1 vs mt-3), 4px vs 12px trigger gap, and rounded-lg vs rounded-xl corners.                                                                                                                                                      |
| `fixed`          | `boolean`                               | `false`   | No       | Use fixed positioning computed from the trigger's bounding rect (escapes overflow:hidden ancestors). Requires `triggerEl`. Recomputes on scroll (capture) and resize. When true, the hover-bridge div and absolute position classes are omitted.                       |
| `triggerEl`      | `HTMLElement \| null`                   | `null`    | No       | The trigger element used to compute fixed positioning. Only used when `fixed` is true.                                                                                                                                                                                 |

Usage:

```svelte
<div class="relative" bind:this={triggerEl} use:clickOutside={() => (open = false)}>
  <button onclick={() => (open = !open)}>Menu</button>
  {#if open}
    <Dropdown position="right" minWidth="12rem" {triggerEl}>
      <DropdownItem label="Rename" on:click={rename} />
      <DropdownItem label="Delete" danger on:click={remove} />
    </Dropdown>
  {/if}
</div>
```

Slot: default slot (unnamed) holds the menu contents, typically `DropdownItem` rows.

Notes:

- No events are dispatched. Open/close and click-outside are managed by the parent, commonly via the
  `clickOutside` action on a wrapping `.relative` element.
- Variants: position (left / right / middle), responsive `mobilePosition` switching at the md breakpoint,
  compact vs default spacing, and absolute (default) vs fixed positioning strategy.
- Panel styling is hard-coded: z-50, border, white/neutral-800 surface, shadow-lg, rounded corners.
- When not fixed it renders an invisible hover-bridge div (`absolute top-full h-3 w-full`) to keep the menu
  open while moving the mouse down.
- Uses legacy Svelte slots and `$:` reactive statements (no runes), matching repo convention.

## DropdownItem

A single selectable row inside a `Dropdown`, rendered as a full-width button with an optional leading icon,
a label, and a trailing check when selected. It supports danger and disabled states plus compact sizing.

Import:

```svelte
import DropdownItem from '$ui/dropdown/DropdownItem.svelte';
```

| Prop       | Type                         | Default     | Required | Description                                                                                                           |
| ---------- | ---------------------------- | ----------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `icon`     | `ComponentType \| undefined` | `undefined` | No       | Optional leading Lucide/Svelte icon component rendered via `<svelte:component>`. Sized 12px compact / 16px default.   |
| `label`    | `string`                     | `—`         | Yes      | The row text (rendered in a flex-1 span).                                                                             |
| `disabled` | `boolean`                    | `false`     | No       | Disables the button and applies muted, not-allowed styling. Takes visual precedence over `danger`.                    |
| `danger`   | `boolean`                    | `false`     | No       | Red text with red hover background to signal destructive actions.                                                     |
| `selected` | `boolean`                    | `false`     | No       | Shows a trailing accent-colored Check icon.                                                                           |
| `compact`  | `boolean`                    | `false`     | No       | Smaller padding, text-xs, and lg corner rounding for first/last items; also shrinks icon size to 12px.                |
| `onSelect` | `(() => void) \| null`       | `null`      | No       | Callback prop invoked on click (before the dispatched `click` event). Optional alternative to listening for on:click. |

Usage:

```svelte
<DropdownItem
  icon={Trash2}
  label="Delete"
  danger
  selected={value === 'delete'}
  compact
  on:click={() => handleDelete()}
/>
```

Notes:

- `on:click` dispatches a `CustomEvent<MouseEvent>` via `createEventDispatcher` on button click. The click
  handler also invokes the `onSelect` callback prop first (`onSelect?.()`), then dispatches, so consumers can
  use either.
- Variants: state combinations (default / selected / danger / disabled) and sizing (compact vs default).
- Renders as a `<button>` with a bottom border between items (`last:border-b-0`) and first/last corner
  rounding.
- Uses legacy Svelte slots/events (no runes).

## DropdownSelect

A select widget composing `Button` + `Dropdown` + `DropdownItem` into a labeled value picker. It renders the
current option's label on a trigger button and a menu of options, then emits `change` with the chosen value.
It supports independent compact controls for button and menu, responsive/auto compaction, full-width, fixed
positioning, and a disabled state.

Import:

```svelte
import DropdownSelect from '$ui/dropdown/DropdownSelect.svelte';
```

| Prop                       | Type                                                       | Default       | Required | Description                                                                                                                     |
| -------------------------- | ---------------------------------------------------------- | ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `label`                    | `string \| undefined`                                      | `undefined`   | No       | Optional inline label shown to the left of the trigger button.                                                                  |
| `value`                    | `string`                                                   | `—`           | Yes      | The currently selected option value (typically two-way bound with bind:value).                                                  |
| `options`                  | `{ value: string; label: string; description?: string }[]` | `—`           | Yes      | Options to render. `label` is shown; `description` is accepted in the type but not rendered by this component.                  |
| `placeholder`              | `string`                                                   | `'Select...'` | No       | Button text shown when `value` matches no option; also triggers placeholder text color.                                         |
| `minWidth`                 | `string`                                                   | `'8rem'`      | No       | Passed to the inner Dropdown's min-width.                                                                                       |
| `position`                 | `'left' \| 'right' \| 'middle'`                            | `'left'`      | No       | Dropdown horizontal alignment (forwarded to Dropdown).                                                                          |
| `mobilePosition`           | `'left' \| 'right' \| 'middle' \| null`                    | `null`        | No       | Responsive dropdown position below md (forwarded to Dropdown).                                                                  |
| `compact`                  | `boolean`                                                  | `false`       | No       | Shorthand that compacts both the button and the dropdown menu unless overridden by the more specific compact props.             |
| `compactButton`            | `boolean \| undefined`                                     | `undefined`   | No       | Explicit override for button compaction. When undefined, resolves from `responsiveButton ? isSmallScreen : compact`.            |
| `compactDropdown`          | `boolean \| undefined`                                     | `undefined`   | No       | Explicit override for dropdown-menu compaction. When undefined, resolves from `compactDropdownThreshold` logic, else `compact`. |
| `compactDropdownThreshold` | `number`                                                   | `0`           | No       | Auto-compact the menu when options.length >= this value (0 disables). Only consulted when `compactDropdown` is undefined.       |
| `responsiveButton`         | `boolean`                                                  | `false`       | No       | Auto-compact the button on screens < 1280px via a matchMedia('(max-width: 1279px)') listener.                                   |
| `fullWidth`                | `boolean`                                                  | `false`       | No       | Stretch the control to full width; the trigger wrapper gets flex-1 and default justify becomes 'between'.                       |
| `fixed`                    | `boolean`                                                  | `false`       | No       | Forward fixed positioning to the Dropdown to escape overflow containers (e.g. tables).                                          |
| `width`                    | `string \| undefined`                                      | `undefined`   | No       | Custom width class applied to the outer container; overrides `fullWidth` width behavior and forces 'between' justify.           |
| `justify`                  | `'center' \| 'between' \| null`                            | `null`        | No       | Override button content justification. When null, resolves to 'between' if fullWidth/width else 'center'.                       |
| `disabled`                 | `boolean`                                                  | `false`       | No       | Disables the trigger button and prevents opening the menu.                                                                      |
| `buttonSize`               | `'xs' \| 'sm' \| 'md' \| null`                             | `null`        | No       | Explicit button size override. When null, resolves to 'xs' when the button is compact else 'sm'.                                |

Usage:

```svelte
<DropdownSelect
  label="Arr type"
  bind:value={selectedArr}
  options={[{ value: 'radarr', label: 'Radarr' }, { value: 'sonarr', label: 'Sonarr' }]}
  position="left"
  on:change={(e) => (selectedArr = e.detail)}
/>
```

Notes:

- `on:change` dispatches a `CustomEvent<string>` with the selected option value when an item is chosen (the
  menu then closes). With bind:value the component does NOT self-update `value`; the parent must apply the
  change (bind or `on:change` handler).
- Variants: compaction (compact, compactButton, compactDropdown, compactDropdownThreshold, responsiveButton);
  layout (fullWidth, custom width, justify center/between); positioning (left/right/middle, mobilePosition,
  fixed); states (disabled, placeholder when no match).
- Wraps in a `.relative` element with `use:clickOutside` to close. The trigger is a `Button` with
  `icon={ChevronDown}` and `iconPosition="right"`.
- Uses onMount/onDestroy to manage the responsiveButton media query. Legacy Svelte events/slots (no runes).

## CustomGroupManager

A specialized form section (used inside a dropdown/filter panel) for managing user-defined tag groups: an
add-group form (name plus comma-separated tags) and a list of existing groups with toggle-select and delete.
It delegates all state mutation to callback props.

Import:

```svelte
import CustomGroupManager from '$ui/dropdown/CustomGroupManager.svelte';
```

| Prop             | Type                                                                    | Default | Required | Description                                                                                                                                                                                             |
| ---------------- | ----------------------------------------------------------------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customGroups`   | `Array<{ name: string; key: string; tags: string[]; custom: boolean }>` | `[]`    | No       | The existing custom groups to list. Each has a display `name`, a unique `key`, its `tags`, and a `custom` flag.                                                                                         |
| `selectedGroups` | `Set<string>`                                                           | `—`     | Yes      | Set of currently selected group keys; drives the per-row IconCheckbox checked state via `selectedGroups.has(group.key)`.                                                                                |
| `onAdd`          | `(name: string, tags: string[]) => void`                                | `—`     | Yes      | Called on form submit with the trimmed group name and parsed tag array (comma-split, trimmed, empty removed). Only fires when both name and at least one tag are present. Inputs are cleared afterward. |
| `onDelete`       | `(key: string) => void`                                                 | `—`     | Yes      | Called with a group's key when its X (delete) button is clicked (click.stopPropagation).                                                                                                                |
| `onToggle`       | `(key: string) => void`                                                 | `—`     | Yes      | Called with a group's key when its row is clicked to toggle selection.                                                                                                                                  |

Usage:

```svelte
<CustomGroupManager
  customGroups={groups}
  selectedGroups={selectedKeys}
  onAdd={(name, tags) => addGroup(name, tags)}
  onDelete={(key) => removeGroup(key)}
  onToggle={(key) => toggleGroup(key)}
/>
```

Notes:

- No events are dispatched; interaction is delivered exclusively through the `onAdd` / `onDelete` / `onToggle`
  callback props.
- Internal `newGroupName` / `newGroupTags` state backs two hideLabel FormInputs (size sm). Submit is guarded:
  the Add button is disabled unless both fields are non-empty, and handleSubmit also filters to require at
  least one non-empty tag.
- The group list only renders when customGroups.length > 0.
- Uses IconCheckbox (color="blue", shape="circle", icon={Check}) for the selected indicator and Lucide
  X/Plus icons. Legacy Svelte (no runes); the form uses `on:submit|preventDefault` and delete uses
  `on:click|stopPropagation`.

## Tabs

A responsive navigation tab bar with an active-state underline and optional per-tab icons. It can show a
trailing breadcrumb or back button, and (when responsive) collapses to a `Dropdown` select on mobile.
Navigation happens via SvelteKit `goto`/anchor links.

Import:

```svelte
import Tabs from '$ui/navigation/tabs/Tabs.svelte';
```

| Prop                | Type                                                                                       | Default     | Required | Description                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------ | ----------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `tabs`              | `Tab[]` — `{ label: string; href: string; active?: boolean; icon?: ComponentType }`        | `[]`        | No       | The tab entries. `active` marks the current tab (defaults to first tab when none active); optional `icon` renders before the label. |
| `backButton`        | `BackButton \| undefined` — `{ label: string }`                                            | `undefined` | No       | When set (and no breadcrumb), shows a trailing back button with an ArrowLeft icon that calls history.back().                        |
| `breadcrumb`        | `Breadcrumb \| undefined` — `{ parent: { label: string; href: string }; current: string }` | `undefined` | No       | When set, shows a trailing parent-link > current breadcrumb (takes precedence over backButton).                                     |
| `responsive`        | `boolean`                                                                                  | `false`     | No       | Enable mobile mode: below 768px (matchMedia '(max-width: 767px)') the tab bar collapses to a Dropdown select of tabs.               |
| `hideWhenSingle`    | `boolean`                                                                                  | `true`      | No       | When true and there is <=1 tab with no backButton/breadcrumb, render only a spacer instead of the bar.                              |
| `hiddenSpacerClass` | `string`                                                                                   | `'h-1'`     | No       | Class for the spacer div rendered when the bar is hidden via hideWhenSingle.                                                        |

Usage:

```svelte
<Tabs
  responsive
  tabs={[
    { label: 'Overview', href: '/x/overview', active: true, icon: Info },
    { label: 'Settings', href: '/x/settings', icon: Settings }
  ]}
  breadcrumb={{ parent: { label: 'Dev', href: '/dev' }, current: 'Components' }}
>
  <svelte:fragment slot="actions">
    <Button text="Add" size="xs" icon={Plus} />
  </svelte:fragment>
</Tabs>
```

Slot: named slot `actions` renders extra action controls inline after the tab links in the desktop tab bar
(e.g. an "Add Instance" button). It is not rendered in mobile dropdown mode.

Notes:

- No events are dispatched. Desktop tabs are `<a href>` links (`data-sveltekit-preload-data="tap"`); mobile
  selection calls `goto(href)`; the back button calls history.back().
- Variants: desktop tab bar vs mobile dropdown (responsive); trailing region breadcrumb (priority) /
  backButton / none; hideWhenSingle spacer mode.
- activeTab resolves to the tab with `active: true`, else the first tab.
- Mobile mode builds a custom trigger button plus Dropdown (position="left", minWidth="100%") of
  DropdownItems with tab icons; ChevronDown rotates 180deg when open.
- Uses clickOutside to close the mobile dropdown and onMount/onDestroy to manage the media query. Legacy
  Svelte (no runes).
