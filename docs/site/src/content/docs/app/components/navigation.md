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
compact spacing, an ARIA `role` for the panel, and arrow-key navigation between menu items.

Import:

```svelte
import Dropdown from '$ui/dropdown/Dropdown.svelte';
```

| Prop             | Type                                         | Default     | Required | Description                                                                                                                                                                                                                                                            |
| ---------------- | -------------------------------------------- | ----------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `position`       | `'left' \| 'right' \| 'middle'`              | `'left'`    | No       | Horizontal alignment of the panel relative to the trigger.                                                                                                                                                                                                             |
| `mobilePosition` | `'left' \| 'right' \| 'middle' \| null`      | `null`      | No       | Alternate position applied below the md breakpoint. When set and different from `position`, a responsive class (e.g. `middle-to-right`) is used; ignored when `fixed` is true. Falls back to `positionClasses[position]` if no matching responsive combination exists. |
| `minWidth`       | `string`                                     | `'12rem'`   | No       | CSS min-width applied to the panel via inline style.                                                                                                                                                                                                                   |
| `compact`        | `boolean`                                    | `false`     | No       | Tighter layout: smaller top margin (mt-1 vs mt-3), 4px vs 12px trigger gap, and rounded-lg vs rounded-xl corners.                                                                                                                                                      |
| `fixed`          | `boolean`                                    | `false`     | No       | Use fixed positioning computed from the trigger's bounding rect (escapes overflow:hidden ancestors). Requires `triggerEl`. Recomputes on scroll (capture) and resize. When true, the hover-bridge div and absolute position classes are omitted.                       |
| `triggerEl`      | `HTMLElement \| null`                        | `null`      | No       | The trigger element used to compute fixed positioning. Only used when `fixed` is true.                                                                                                                                                                                 |
| `role`           | `'menu' \| 'listbox' \| 'dialog' \| 'group'` | `'menu'`    | No       | ARIA role of the panel. Arrow/Home/End navigation is active only for `'menu'` and `'listbox'`; use `'dialog'` or `'group'` for panels holding form controls.                                                                                                           |
| `label`          | `string \| undefined`                        | `undefined` | No       | Applied as the panel's `aria-label`.                                                                                                                                                                                                                                   |
| `id`             | `string \| undefined`                        | `undefined` | No       | Panel id. Set it to the value of the trigger's `aria-controls`.                                                                                                                                                                                                        |
| `onClose`        | `(() => void) \| null`                       | `null`      | No       | Called when Escape is pressed inside the panel (the event is prevented and stopped). Without it, Escape is not handled here. Typical handlers close the panel and refocus the trigger.                                                                                 |

Usage:

```svelte
<script>
  import { tick } from 'svelte';
  import { clickOutside } from '$lib/client/utils/clickOutside';
  import { focusOutside } from '$lib/client/utils/focusOutside';
  import { uniqueId } from '$lib/client/utils/uniqueId';

  let open = false;
  let triggerEl;
  let buttonEl;
  const menuId = uniqueId('row-menu');

  function close() {
    open = false;
    buttonEl?.focus();
  }

  async function toggle(event) {
    open = !open;
    // Keyboard activation (Enter/Space) reports event.detail === 0; move focus into the menu.
    if (open && event.detail === 0) {
      await tick();
      document
        .getElementById(menuId)
        ?.querySelector('[role="menuitem"]')
        ?.focus();
    }
  }
</script>

<div
  class="relative"
  bind:this={triggerEl}
  use:clickOutside={() => (open = false)}
  use:focusOutside={() => (open = false)}
>
  <button
    bind:this={buttonEl}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-controls={menuId}
    onclick={toggle}
  >
    Menu
  </button>
  {#if open}
    <Dropdown
      id={menuId}
      label="Row actions"
      onClose={close}
      position="right"
      minWidth="12rem"
      {triggerEl}
    >
      <DropdownItem label="Rename" on:click={rename} />
      <DropdownItem label="Delete" danger on:click={remove} />
    </Dropdown>
  {/if}
</div>
```

Slot: default slot (unnamed) holds the menu contents, typically `DropdownItem` rows.

Keyboard (handled on the panel):

| Key       | Behavior                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------- |
| ArrowDown | Focuses the next item, wrapping from last to first. With no item focused, focuses the first item.    |
| ArrowUp   | Focuses the previous item, wrapping from first to last. With no item focused, focuses the last item. |
| Home      | Focuses the first item.                                                                              |
| End       | Focuses the last item.                                                                               |
| Escape    | Calls `onClose` when provided.                                                                       |

Items are elements with role `menuitem`, `menuitemcheckbox`, `menuitemradio`, or `option`, excluding those
with `disabled` or `aria-disabled="true"`. Arrow, Home, and End keys apply only when `role` is `'menu'` or
`'listbox'`; handled keys call `preventDefault()` and `stopPropagation()`.

Notes:

- No events are dispatched. Open/close, click-outside, and initial focus are managed by the parent, commonly
  via the `clickOutside` and `focusOutside` actions on a wrapping `.relative` element. The trigger should
  carry `aria-haspopup`, `aria-expanded`, and `aria-controls` (matching `id`).
- Variants: position (left / right / middle), responsive `mobilePosition` switching at the md breakpoint,
  compact vs default spacing, and absolute (default) vs fixed positioning strategy.
- Panel styling is hard-coded: z-50, border, white/neutral-800 surface, shadow-lg, rounded corners.
- When not fixed it renders an invisible, `aria-hidden` hover-bridge div (`absolute top-full h-3 w-full`) to
  keep the menu open while moving the mouse down.
- Uses legacy Svelte slots and `$:` reactive statements (no runes), matching repo convention.

## DropdownItem

A single selectable row inside a `Dropdown`, rendered as a full-width button with an ARIA role, an optional
leading icon, a label, and a trailing check when selected. It supports danger and disabled states plus
compact sizing.

Import:

```svelte
import DropdownItem from '$ui/dropdown/DropdownItem.svelte';
```

| Prop       | Type                                                              | Default      | Required | Description                                                                                                                       |
| ---------- | ----------------------------------------------------------------- | ------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `icon`     | `ComponentType \| undefined`                                      | `undefined`  | No       | Optional leading Lucide/Svelte icon component rendered via `<svelte:component>`. Sized 12px compact / 16px default.               |
| `label`    | `string`                                                          | `—`          | Yes      | The row text (rendered in a flex-1 span).                                                                                         |
| `disabled` | `boolean`                                                         | `false`      | No       | Disables the button and applies muted, not-allowed styling. Takes visual precedence over `danger`.                                |
| `danger`   | `boolean`                                                         | `false`      | No       | Red text with red hover background to signal destructive actions.                                                                 |
| `selected` | `boolean`                                                         | `false`      | No       | Shows a trailing accent-colored Check icon and sets the ARIA state that matches `role` (see below).                               |
| `compact`  | `boolean`                                                         | `false`      | No       | Smaller padding, text-xs, and lg corner rounding for first/last items; also shrinks icon size to 12px.                            |
| `onSelect` | `(() => void) \| null`                                            | `null`       | No       | Callback prop invoked on click (before the dispatched `click` event). Optional alternative to listening for on:click.             |
| `role`     | `'menuitem' \| 'menuitemcheckbox' \| 'menuitemradio' \| 'option'` | `'menuitem'` | No       | ARIA role of the button. Match it to the parent `Dropdown` role: `option` inside a `listbox`, a `menuitem*` role inside a `menu`. |

`selected` maps to ARIA by role:

| `role`                              | ARIA attribute from `selected`                         |
| ----------------------------------- | ------------------------------------------------------ |
| `menuitem`                          | `aria-current="true"` when selected; omitted otherwise |
| `menuitemcheckbox`, `menuitemradio` | `aria-checked={selected}`                              |
| `option`                            | `aria-selected={selected}`                             |

Usage:

```svelte
<DropdownItem
  role="menuitemradio"
  icon={LayoutGrid}
  label="Cards"
  selected={view === 'cards'}
  compact
  on:click={() => (view = 'cards')}
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
current option's label on a trigger button and a `listbox` of options, then emits `change` with the chosen
value. It supports independent compact controls for button and menu, responsive/auto compaction, full-width,
fixed positioning, and a disabled state.

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
  options={[
    { value: 'radarr', label: 'Radarr' },
    { value: 'sonarr', label: 'Sonarr' },
  ]}
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
- Wraps in a `.relative` element with `use:clickOutside` and `use:focusOutside` to close. The trigger is a
  `Button` with `icon={ChevronDown}` and `iconPosition="right"`.
- Keyboard and ARIA: the trigger sets `aria-haspopup="listbox"`, `aria-expanded`, and `aria-controls`. The
  panel is a `Dropdown` with `role="listbox"`, labelled by `label` (or `placeholder` when no label is set);
  each option is a `DropdownItem` with `role="option"` and `aria-selected`. Opening with Enter/Space focuses
  the first option; ArrowUp/ArrowDown/Home/End move between options. Escape (on the trigger or in the list)
  and choosing an option close the list and return focus to the trigger. An empty `options` array renders a
  disabled "No options" item.
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
- Each group row's toggle is a `<button>` with `aria-pressed` reflecting selection; the IconCheckbox inside
  it (color="blue", shape="circle", icon={Check}) is `decorative`, so it renders as an `aria-hidden` span
  rather than a nested button. The delete button has `aria-label="Delete group {name}"`. Uses Lucide
  X/Plus icons. Legacy Svelte (no runes); the form uses `on:submit|preventDefault` and delete uses
  `on:click|stopPropagation`.

## Tabs

A responsive navigation tab bar with an active-state underline and optional per-tab icons. It can show a
trailing breadcrumb or back button, and (when responsive) collapses to a `Dropdown` menu on mobile.
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
    { label: 'Settings', href: '/x/settings', icon: Settings },
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
- Mobile mode builds a custom trigger button plus Dropdown (position="left", minWidth="100%", label "Tabs")
  of DropdownItems with tab icons; ChevronDown rotates 180deg when open. The active tab's item is marked
  with `aria-current="true"` (via `selected` on a `menuitem`).
- Mobile keyboard and ARIA: the trigger sets `aria-haspopup="menu"`, `aria-expanded`, and `aria-controls`.
  Opening with Enter/Space focuses the first menu item; ArrowUp/ArrowDown/Home/End move between tabs.
  Escape (on the trigger or in the menu) and choosing a tab close the menu and return focus to the
  trigger. Moving focus outside the wrapper closes the menu without moving focus.
- Uses clickOutside and focusOutside to close the mobile dropdown and onMount/onDestroy to manage the media
  query. Legacy Svelte (no runes).

## AccentPicker keyboard behavior

`AccentPicker` (documented under [Navigation Shell](/app/components/shell/#accentpicker)) follows the same
trigger pattern: the swatch button sets `aria-haspopup="menu"`, `aria-expanded`, and `aria-controls`, and
the `Dropdown` is labelled "Accent colors". Each swatch is a `role="menuitemradio"` button with
`aria-checked` and the color name as `aria-label`. Opening with Enter/Space focuses the first swatch;
ArrowUp/ArrowDown/Home/End move between swatches. Escape and choosing a color close the menu and return
focus to the swatch button.
